#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod bridge;
mod config;
mod filedialog;
mod http;
mod i18n;
mod log;
mod mpv;
mod mpv_profiles;
mod pages;
mod player;
mod settings;
mod smtc;
mod update;

use bridge::{origin_key, Bridge};
use i18n::tr;
use player::{Player, Sink};
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use muda::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tao::dpi::{PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::platform::windows::{IconExtWindows, WindowBuilderExtWindows, WindowExtWindows};
use tao::window::{Fullscreen, Icon, Window, WindowBuilder};
use windows::core::HSTRING;
use windows::Win32::Foundation::HWND;
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::UI::Controls::{TaskDialogIndirect, TASKDIALOGCONFIG, TASKDIALOG_BUTTON, TASKDIALOG_NOTIFICATIONS, TDF_ALLOW_DIALOG_CANCELLATION, TDF_ENABLE_HYPERLINKS, TDF_USE_COMMAND_LINKS, TDN_HYPERLINK_CLICKED};
use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_ICONINFORMATION, MB_ICONWARNING, MB_OK, MB_YESNO};
use wry::{NewWindowResponse, PageLoadEvent, WebContext, WebViewBuilder};

/// События для главного потока (WebView принадлежит ему): всё остальное шлёт их через прокси.
pub enum UserEvent {
    /// Выполнить JS на странице (ответы моста и события mpv).
    Js(String),
    /// Проверить доступность сервера и загрузить страницу.
    Load,
    /// Сервер доступен: загрузить страницу и доверить мост её источнику.
    Navigate(String),
    /// Показать страницу приложения (ошибка, ввод адреса).
    ShowHtml(String),
    /// Команда со страницы приложения: retry, change, server.
    App(String, Option<String>),
    /// Загрузить доверенный адрес (window.open внутри сервера).
    LoadPlain(String),
    /// Отладка (LAMPA_DEBUG + LAMPA_EVAL): выполнить JS из файла, результат в журнал.
    Eval(PathBuf),
    /// Медиаклавиша или команда «Сейчас играет».
    Media(MediaCmd),
    /// Оконная команда со страницы: fullscreen (true, false, "toggle"), reload, changeServer.
    Window(Vec<Value>),
    /// Пункт меню окна.
    Menu(String),
    /// Ход и результат проверки или установки обновления.
    Update(update::Msg),
    /// Данные страницы Lampa для резервной копии собраны (None — открыта не страница сервера).
    BackupCollected(Option<backup::Lampa>),
    /// Данные Lampa записаны в localStorage страницы: true — успешно, страницу нужно перезагрузить.
    LampaRestored(bool),
    /// Страница после восстановления адреса загрузилась: записать данные Lampa.
    ApplyPendingLampa,
}

/// Команды медиаклавиш (SMTC): пауза и перемотка выполняются в mpv, смена серии передаётся странице.
pub enum MediaCmd {
    Play,
    Pause,
    Seek(f64),
    SeekAbs(f64),
    Next,
    Prev,
}

const SHIM: &str = include_str!("shim.js");
const PLAYBACK_COVER: &str = include_str!("../../Sources/Lampyris/Resources/playbackCover.js");
const MPV_TUBE: &str = include_str!("../../Sources/Lampyris/Resources/mpvTube.js");
const WINDOW_JS: &str = include_str!("window.js");

/// Скрипты страницы Lampa на macOS внедряются в «конец документа»; здесь они ждут DOMContentLoaded.
fn at_document_end(src: &str) -> String {
    format!("(function(){{function go(){{{src}\n}}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();}})();")
}

/// Рядом с exe лежит libmpv-2.dll; путь можно переопределить через LAMPA_LIBMPV.
fn libmpv_path() -> PathBuf {
    if let Some(p) = std::env::var_os("LAMPA_LIBMPV") {
        return PathBuf::from(p);
    }
    std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("libmpv-2.dll"))).unwrap_or_else(|| "libmpv-2.dll".into())
}

fn open_externally(u: &str) {
    let Ok(parsed) = url::Url::parse(u) else { return };
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return;
    }
    // Без оболочки командной строки: адрес с & не разбирается как несколько команд.
    let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", parsed.as_str()]).spawn();
}

fn initial_server() -> Option<url::Url> {
    if let Some(u) = std::env::var("LAMPA_URL").ok().and_then(|s| settings::parse_server(&s)) {
        return Some(u);
    }
    settings::get_string("serverURL").and_then(|s| settings::parse_server(&s))
}

/// Положение и размер окна (в физических пикселях) для запоминания между запусками.
#[derive(Clone, Copy)]
struct WinState {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    maximized: bool,
    fullscreen: bool,
}

impl WinState {
    fn load() -> Option<WinState> {
        let v: Value = settings::get_value("window")?;
        Some(WinState {
            x: v["x"].as_i64()? as i32,
            y: v["y"].as_i64()? as i32,
            w: v["w"].as_u64()? as u32,
            h: v["h"].as_u64()? as u32,
            maximized: v["maximized"].as_bool().unwrap_or(false),
            fullscreen: v["fullscreen"].as_bool().unwrap_or(false),
        })
    }

    fn save(&self) {
        settings::set_value("window", serde_json::json!({
            "x": self.x, "y": self.y, "w": self.w, "h": self.h, "maximized": self.maximized, "fullscreen": self.fullscreen,
        }));
    }

    /// Окно должно хотя бы частично попадать на какой-нибудь экран (монитор могли отключить).
    fn visible_on(&self, monitors: &[(PhysicalPosition<i32>, PhysicalSize<u32>)]) -> bool {
        self.w >= 320 && self.h >= 240 && monitors.iter().any(|(p, s)| {
            let (right, bottom) = (p.x + s.width as i32, p.y + s.height as i32);
            self.x + 100 < right && self.x + self.w as i32 - 100 > p.x && self.y + 50 < bottom && self.y + 50 > p.y - 50
        })
    }

    /// Запоминаем обычное (не развёрнутое и не полноэкранное) положение.
    fn track(&mut self, window: &Window) {
        if window.is_maximized() || window.is_minimized() || window.fullscreen().is_some() {
            return;
        }
        let (size, pos) = (window.inner_size(), window.outer_position());
        if let (Ok(pos), true) = (pos, size.width > 0 && size.height > 0) {
            (self.x, self.y, self.w, self.h) = (pos.x, pos.y, size.width, size.height);
        }
    }
}

fn mpv_conf_template() -> String {
    let head = tr("# mpv.conf плеера Lampa. Формат: опция=значение, по одной в строке.\n\
# Опции до первого [раздела] общие; [имя] — профиль, выбирается в Настройки → MPV\n\
# или клавишей P во время видео. Файл читается при каждом открытии видео.\n#\n# hwdec=d3d11va\n#\n# [my-profile]\n# deband=yes\n",
       "# mpv.conf of the Lampa player. Format: option=value, one per line.\n\
# Options before the first [section] are common; [name] is a profile, chosen in Settings → MPV\n\
# or with the P key during a video. The file is read each time a video is opened.\n#\n# hwdec=d3d11va\n#\n# [my-profile]\n# deband=yes\n");
    format!("{head}#\n{}", tr(mpv_profiles::DOC_RU, mpv_profiles::DOC_EN))
}

fn open_mpv_conf(select_in_explorer: bool) {
    let path = config::file_path();
    if !path.exists() {
        if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
        let _ = std::fs::write(&path, mpv_conf_template());
    }
    if select_in_explorer {
        let _ = std::process::Command::new("explorer").arg(format!("/select,{}", path.display())).spawn();
    } else {
        let _ = std::process::Command::new("notepad").arg(&path).spawn();
    }
}

/// WebView2 Runtime не установлен или не запустился: вместо аварийного завершения объясняем, что делать.
fn webview_unavailable(hwnd: isize, err: &str) {
    log::error("app", &format!("WebView2 не запущен: {err}"));
    let text = tr("Не удалось запустить WebView2 Runtime — компонент Microsoft, в котором Lampyris показывает Lampa. В Windows 11 он есть всегда, в старой Windows 10 его нужно установить.\n\nОткрыть страницу загрузки Microsoft?", "Could not start WebView2 Runtime, the Microsoft component Lampyris uses to show Lampa. It is always present in Windows 11; on an older Windows 10 it has to be installed.\n\nOpen the Microsoft download page?");
    let answer = unsafe { MessageBoxW(Some(HWND(hwnd as *mut _)), &HSTRING::from(text), &HSTRING::from("Lampyris"), MB_YESNO | MB_ICONERROR) };
    if answer == IDYES {
        open_externally("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
    }
}

fn show_about(hwnd: isize) {
    let text = if i18n::is_ru() {
        format!("Lampyris {} ({})\n\nLampyris: неофициальный клиент Lampa для Windows на Rust, WebView2 и libmpv. Lampa — проект своих авторов, с Lampyris не связан.\n\n\
Лицензия: GNU GPL версии 3 или новее. Исходный код: github.com/polons123/lampyris. Сведения о сторонних компонентах (mpv, FFmpeg и др.) — в файле THIRD-PARTY.md.\n\n\
This product uses the TMDB API but is not endorsed or certified by TMDB.", update::VERSION, update::arch_label())
    } else {
        format!("Lampyris {} ({})\n\nLampyris: an unofficial Lampa client for Windows built with Rust, WebView2 and libmpv. Lampa is a project of its own authors and is not affiliated with Lampyris.\n\n\
License: GNU GPL version 3 or later. Source code: github.com/polons123/lampyris. Information about third-party components (mpv, FFmpeg, etc.) is in THIRD-PARTY.md.\n\n\
This product uses the TMDB API but is not endorsed or certified by TMDB.", update::VERSION, update::arch_label())
    };
    unsafe {
        MessageBoxW(Some(HWND(hwnd as *mut _)), &HSTRING::from(text), &HSTRING::from("Lampyris"), MB_OK | MB_ICONINFORMATION);
    }
}

/// Ответ на предложение обновиться.
enum UpdateAnswer {
    Install,
    Later,
    Skip,
}

/// Ссылки в окне обновления: открываем только https (адрес приходит из ответа сервера обновлений).
unsafe extern "system" fn update_dialog_callback(_hwnd: HWND, msg: TASKDIALOG_NOTIFICATIONS, _wparam: WPARAM, lparam: LPARAM, _data: isize) -> windows::core::HRESULT {
    if msg == TDN_HYPERLINK_CLICKED {
        let url = unsafe { windows::core::PCWSTR(lparam.0 as *const u16).to_string() }.unwrap_or_default();
        if url.starts_with("https://") { open_externally(&url); }
    }
    windows::core::HRESULT(0)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Окно с найденным обновлением (TaskDialog): кнопки «Установить», «Позже», «Пропустить эту версию» и ссылка на описание изменений.
fn ask_update(hwnd: isize, release: &update::Release, blocker: &Option<String>) -> UpdateAnswer {
    // Разметка TaskDialog понимает <a>: из описания релиза угловые скобки убираем.
    let notes: String = release.notes.trim().chars().filter(|c| !matches!(c, '<' | '>')).take(700).collect();
    let mut text = crate::trf!("Установлена версия {}.", "Installed version: {}.", update::VERSION);
    if !notes.is_empty() { text.push_str("\n\n"); text.push_str(&notes); }
    match blocker {
        None => text.push_str(tr("\n\nНастройки и адрес сервера сохранятся. Приложение закроется и откроется заново.", "\n\nYour settings and server address will be kept. The app will close and reopen.")),
        Some(b) => text.push_str(&crate::trf!("\n\nАвтоустановка недоступна: {b}.", "\n\nAutomatic installation is unavailable: {b}.")),
    }
    if let Ok(u) = url::Url::parse(&release.page_url) {
        if u.scheme() == "https" { text.push_str(&crate::trf!("\n\n<a href=\"{}\">Что изменилось в этой версии</a>", "\n\n<a href=\"{}\">What changed in this version</a>", u.as_str())); }
    }
    let title = wide(tr("Lampyris — обновление", "Lampyris — update"));
    let instruction = wide(&crate::trf!("Доступна версия {}", "Version {} is available", release.version));
    let content = wide(&text);
    let first = wide(if blocker.is_none() { tr("Установить и перезапустить", "Install and restart") } else { tr("Открыть страницу загрузки", "Open the download page") });
    let later = wide(tr("Напомнить позже", "Remind me later"));
    let skip = wide(tr("Пропустить эту версию", "Skip this version"));
    let buttons = [
        TASKDIALOG_BUTTON { nButtonID: 100, pszButtonText: windows::core::PCWSTR(first.as_ptr()) },
        TASKDIALOG_BUTTON { nButtonID: 101, pszButtonText: windows::core::PCWSTR(later.as_ptr()) },
        TASKDIALOG_BUTTON { nButtonID: 102, pszButtonText: windows::core::PCWSTR(skip.as_ptr()) },
    ];
    let mut cfg: TASKDIALOGCONFIG = unsafe { std::mem::zeroed() };
    cfg.cbSize = std::mem::size_of::<TASKDIALOGCONFIG>() as u32;
    cfg.hwndParent = HWND(hwnd as *mut _);
    cfg.dwFlags = TDF_ENABLE_HYPERLINKS | TDF_ALLOW_DIALOG_CANCELLATION | TDF_USE_COMMAND_LINKS;
    cfg.pszWindowTitle = windows::core::PCWSTR(title.as_ptr());
    cfg.pszMainInstruction = windows::core::PCWSTR(instruction.as_ptr());
    cfg.pszContent = windows::core::PCWSTR(content.as_ptr());
    cfg.cButtons = buttons.len() as u32;
    cfg.pButtons = buttons.as_ptr();
    cfg.nDefaultButton = 100;
    cfg.pfCallback = Some(update_dialog_callback);
    let mut pressed = 0i32;
    match unsafe { TaskDialogIndirect(&cfg, Some(&mut pressed), None, None) } {
        Ok(()) => match pressed { 100 => UpdateAnswer::Install, 102 => UpdateAnswer::Skip, _ => UpdateAnswer::Later },
        Err(e) => {
            log::error("update", &format!("TaskDialog не открылся: {e}"));
            UpdateAnswer::Later
        }
    }
}

fn message(hwnd: isize, title: &str, text: &str, icon: windows::Win32::UI::WindowsAndMessaging::MESSAGEBOX_STYLE) {
    unsafe { MessageBoxW(Some(HWND(hwnd as *mut _)), &HSTRING::from(text), &HSTRING::from(title), MB_OK | icon); }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Собирает настройки приложения для резервной копии (данные Lampa добавляются отдельно).
fn collect_backup(lampa: Option<backup::Lampa>) -> backup::Backup {
    let conf = config::read_text();
    backup::Backup {
        server_url: settings::get_string("serverURL"),
        history: settings::history(),
        verbose_log: Some(log::is_verbose_setting()),
        auto_update_check: Some(update::auto_check()),
        mpv_conf: (!conf.trim().is_empty()).then_some(conf),
        lampa,
    }
}

fn save_backup(hwnd: isize, lampa: Option<backup::Lampa>) {
    let day = &backup::iso_utc(now_secs())[..10];
    let Some(path) = filedialog::save(hwnd, tr("Сохранить настройки Lampyris", "Save Lampyris settings"), &crate::trf!("Lampyris-настройки-{day}.json", "Lampyris-settings-{day}.json")) else { return };
    let has_lampa = lampa.is_some();
    let text = collect_backup(lampa).to_json(update::VERSION, "windows", &backup::iso_utc(now_secs()));
    match std::fs::write(&path, text) {
        Ok(()) => {
            log::info("backup", "настройки сохранены в файл");
            let note = if has_lampa { "" } else { tr("\n\nДанные страницы Lampa не вошли: сейчас открыта не страница сервера. Откройте Lampa и повторите, если они нужны.", "\n\nLampa page data was not included: the server page is not open right now. Open Lampa and try again if you need it.") };
            message(hwnd, tr("Настройки сохранены", "Settings saved"), &crate::trf!("{}\n\nФайл содержит адрес сервера и данные Lampa (вход, закладки): храните его в надёжном месте.{note}", "{}\n\nThe file contains the server address and Lampa data (login, bookmarks): keep it somewhere safe.{note}", path.display()), MB_ICONINFORMATION);
        }
        Err(e) => message(hwnd, tr("Не удалось сохранить настройки", "Could not save settings"), &e.to_string(), MB_ICONERROR),
    }
}

/// Выбор файла, разбор и подтверждение; None — отказ или ошибка (о ней пользователь уже уведомлён).
fn pick_backup(hwnd: isize) -> Option<backup::Backup> {
    let path = filedialog::open(hwnd, tr("Выберите файл резервной копии Lampyris", "Choose a Lampyris backup file"))?;
    let parsed = std::fs::metadata(&path)
        .map_err(|e| e.to_string())
        .and_then(|m| if m.len() > backup::MAX_FILE_BYTES { Err(tr("файл слишком большой для резервной копии", "the file is too large for a backup").to_string()) } else { Ok(()) })
        .and_then(|_| std::fs::read(&path).map_err(|e| e.to_string()))
        .and_then(|bytes| backup::Backup::parse(&bytes));
    let b = match parsed {
        Ok(b) => b,
        Err(e) => {
            message(hwnd, tr("Не удалось прочитать файл", "Could not read the file"), &e, MB_ICONERROR);
            return None;
        }
    };
    let mut parts: Vec<String> = Vec::new();
    if let Some(s) = &b.server_url { parts.push(crate::trf!("адрес сервера: {s} и история адресов", "server address: {s} and address history")); }
    if b.verbose_log.is_some() || b.auto_update_check.is_some() { parts.push(tr("переключатели меню", "menu switches").into()); }
    if b.mpv_conf.is_some() { parts.push("mpv.conf".into()); }
    if let Some(l) = &b.lampa { parts.push(crate::trf!("данные Lampa ({} записей: вход, закладки, плагины)", "Lampa data ({} entries: login, bookmarks, plugins)", l.items.len())); }
    if parts.is_empty() {
        message(hwnd, tr("В файле нет настроек", "The file has no settings"), tr("Восстанавливать нечего.", "Nothing to restore."), MB_ICONINFORMATION);
        return None;
    }
    let text = crate::trf!("Будут заменены: {}.\n\nСтраница Lampa перезагрузится. Продолжить?", "Will be replaced: {}.\n\nThe Lampa page will reload. Continue?", parts.join("; "));
    let answer = unsafe { MessageBoxW(Some(HWND(hwnd as *mut _)), &HSTRING::from(text), &HSTRING::from(tr("Заменить текущие настройки?", "Replace the current settings?")), MB_YESNO | MB_ICONWARNING) };
    (answer == IDYES).then_some(b)
}

/// Наименьший размер рабочей области окна (логические пиксели).
const MIN_WIDTH: f64 = 674.0;
const MIN_HEIGHT: f64 = 371.0;

/// Метка на главном окне: по ней второй экземпляр находит первое окно (заголовок меняется, класс общий).
const MAIN_WINDOW_PROP: &str = "LampyrisMainWindow";

/// Занимает именованный мьютекс сеанса; true, если Lampyris уже запущена. Хэндл живёт до конца процесса.
fn another_instance_running() -> bool {
    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;
    unsafe {
        match CreateMutexW(None, false, &HSTRING::from("Local\\Lampyris-single-instance")) {
            Ok(_) => GetLastError() == ERROR_ALREADY_EXISTS,
            Err(_) => false,
        }
    }
}

/// Выводит на передний план окно уже запущенного экземпляра.
fn raise_existing_window() {
    use windows::core::BOOL;
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetPropW, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE};
    unsafe extern "system" fn each(hwnd: HWND, _: LPARAM) -> BOOL {
        unsafe {
            if !GetPropW(hwnd, &HSTRING::from(MAIN_WINDOW_PROP)).is_invalid() {
                if IsIconic(hwnd).as_bool() { let _ = ShowWindow(hwnd, SW_RESTORE); }
                let _ = SetForegroundWindow(hwnd);
                return BOOL(0);
            }
        }
        BOOL(1)
    }
    unsafe { let _ = EnumWindows(Some(each), LPARAM(0)); }
}

fn main() {
    log::init();
    // Мьютекс занимаем всегда (чтобы запретивший копии экземпляр видели другие), а выходим только при включённой настройке.
    if another_instance_running() && settings::single_instance() {
        log::info("app", "Lampyris уже запущена (включён запрет нескольких экземпляров), выход");
        raise_existing_window();
        return;
    }
    bridge::clean_subtitle_cache();
    update::clean_cache();
    let test_source = std::env::var("LAMPA_MPV_TEST").ok();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    // Размер и положение запоминаются в настройках; без сохранённых (или вне экранов) — 1280×720 по центру.
    let monitors: Vec<_> = event_loop.available_monitors().map(|m| (m.position(), m.size())).collect();
    let saved = WinState::load().filter(|w| w.visible_on(&monitors));
    // Значок окна берётся из ресурса exe (build.rs встраивает icons/icon.ico под номером 1).
    let mut builder = WindowBuilder::new().with_title("Lampyris")
        .with_window_icon(Icon::from_resource(1, Some(PhysicalSize::new(32, 32))).ok())
        // Значок на панели задач: крупный (Windows сама уменьшит под масштаб экрана).
        .with_taskbar_icon(Icon::from_resource(1, Some(PhysicalSize::new(256, 256))).ok());
    builder = match saved {
        Some(w) => builder.with_inner_size(PhysicalSize::new(w.w, w.h)).with_position(PhysicalPosition::new(w.x, w.y)).with_maximized(w.maximized),
        None => builder.with_inner_size(tao::dpi::LogicalSize::new(1280.0, 720.0)),
    }.with_min_inner_size(tao::dpi::LogicalSize::new(MIN_WIDTH, MIN_HEIGHT));
    let window = builder.build(&event_loop).expect("окно");
    let hwnd = window.hwnd() as isize;
    let want_inner = window.inner_size();
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::SetPropW;
        use windows::Win32::Foundation::HANDLE;
        let _ = SetPropW(HWND(hwnd as *mut _), &HSTRING::from(MAIN_WINDOW_PROP), Some(HANDLE(1 as *mut _)));
    }
    // Пока окна mpv нет (между потоками, при смене качества), прозрачная страница показывает фон главного окна: он должен быть чёрным, а не белым.
    unsafe {
        use windows::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH};
        use windows::Win32::UI::WindowsAndMessaging::{SetClassLongPtrW, GCLP_HBRBACKGROUND};
        SetClassLongPtrW(HWND(hwnd as *mut _), GCLP_HBRBACKGROUND, GetStockObject(BLACK_BRUSH).0 as isize);
    }
    let mut win_state = saved.unwrap_or(WinState { x: 0, y: 0, w: 0, h: 0, maximized: false, fullscreen: false });
    let start_fullscreen = saved.map(|w| w.fullscreen).unwrap_or(false);
    let is_full = Rc::new(Cell::new(false));

    let now_playing = match smtc::NowPlaying::new(proxy.clone()) {
        Ok(np) => Some(np),
        Err(e) => {
            log::warn("smtc", &format!("медиаклавиши недоступны: {e}"));
            None
        }
    };
    let sink: Sink = {
        let (proxy, np) = (proxy.clone(), now_playing.clone());
        Arc::new(move |msg: Value| {
            if let Some(np) = &np { np.handle(&msg); }
            let _ = proxy.send_event(UserEvent::Js(format!("window.__mpvEvent&&window.__mpvEvent({msg})")));
        })
    };
    let player: Option<Arc<Player>> = match Player::new(hwnd, &libmpv_path(), sink) {
        Ok(p) => Some(p),
        Err(e) => {
            log::error("app", &format!("mpv не запущен: {e}"));
            None
        }
    };
    let bridge = player.as_ref().map(|p| Bridge::new(p.clone(), proxy.clone(), now_playing.clone()));

    let trusted: Rc<RefCell<HashSet<String>>> = Rc::new(RefCell::new(HashSet::new()));
    let loading_own = Rc::new(Cell::new(false));
    let special = Rc::new(Cell::new(false)); // показана страница приложения (ошибка, ввод адреса)
    // Скрипт восстановления localStorage из резервной копии: выполняется один раз после загрузки страницы сервера.
    let pending_lampa: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));

    let mut web_context = WebContext::new(Some(settings::local_dir().join("WebView2")));
    let mut wb = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_transparent(true)
        .with_devtools(std::env::var_os("LAMPA_DEBUG").is_some())
        .with_initialization_script(format!("window.__lv = {};", log::is_verbose()))
        .with_initialization_script(WINDOW_JS);
    if bridge.is_some() {
        wb = wb
            .with_initialization_script(SHIM)
            .with_initialization_script(at_document_end(PLAYBACK_COVER))
            .with_initialization_script(at_document_end(MPV_TUBE));
    }
    let webview = wb
        .with_ipc_handler({
            let (proxy, bridge, trusted, special) = (proxy.clone(), bridge.clone(), trusted.clone(), special.clone());
            move |req| {
                let body = req.body();
                // Кнопки страниц приложения; принимаются только пока такая страница показана.
                if special.get() {
                    if let Ok(v) = serde_json::from_str::<Value>(body) {
                        if v["m"] == "app" {
                            let action = v["a"][0].as_str().unwrap_or("").to_string();
                            let arg = v["a"][1].as_str().map(String::from);
                            let _ = proxy.send_event(UserEvent::App(action, arg));
                            return;
                        }
                    }
                }
                let key = url::Url::parse(&req.uri().to_string()).ok().and_then(|u| origin_key(&u));
                let ok = key.as_ref().map(|k| trusted.borrow().contains(k)).unwrap_or(false);
                // Оконные команды и консоль страницы — только от доверенного источника.
                if let Ok(v) = serde_json::from_str::<Value>(body) {
                    match v["m"].as_str() {
                        Some("window") if ok => {
                            let _ = proxy.send_event(UserEvent::Window(v["a"].as_array().cloned().unwrap_or_default()));
                            return;
                        }
                        Some("log") => {
                            if ok && log::is_verbose() {
                                let (l, t) = (v["a"][0].as_str().unwrap_or("log"), v["a"][1].as_str().unwrap_or(""));
                                log::verbose(if l == "error" || l == "uncaught" || l == "rejection" { log::Level::Error } else if l == "warn" { log::Level::Warn } else { log::Level::Info }, "js", &format!("{l}: {t}"));
                            }
                            return;
                        }
                        Some("window") => return,
                        _ => {}
                    }
                }
                let Some(bridge) = &bridge else { return };
                bridge.handle(ok, key.as_deref().unwrap_or("?"), body);
            }
        })
        .with_navigation_handler({
            let (trusted, loading_own, special) = (trusted.clone(), loading_own.clone(), special.clone());
            move |target| {
                if let Some(key) = url::Url::parse(&target).ok().and_then(|u| origin_key(&u)) {
                    if loading_own.get() {
                        trusted.borrow_mut().insert(key);
                    } else if !special.get() && !trusted.borrow().contains(&key) {
                        log::warn("nav", &format!("страница перешла на другой источник {key}: мост mpv для него отключён"));
                    }
                }
                true
            }
        })
        .with_new_window_req_handler({
            let (proxy, trusted) = (proxy.clone(), trusted.clone());
            // window.open и target=_blank: свои страницы грузим в этом же окне, чужие открываем в браузере.
            move |target, _| {
                let own = url::Url::parse(&target).ok().and_then(|u| origin_key(&u)).map(|k| trusted.borrow().contains(&k)).unwrap_or(false);
                if own { let _ = proxy.send_event(UserEvent::LoadPlain(target)); } else { open_externally(&target); }
                NewWindowResponse::Deny
            }
        })
        .with_on_page_load_handler({
            let (bridge, loading_own, proxy, is_full, pending_lampa) = (bridge.clone(), loading_own.clone(), proxy.clone(), is_full.clone(), pending_lampa.clone());
            move |event, _| match event {
                // Новый документ в главном кадре: прежняя страница (а с ней и её тюб) уничтожена, плеер без неё не нужен.
                PageLoadEvent::Started => { if let Some(b) = &bridge { b.page_did_reset(); } }
                PageLoadEvent::Finished => {
                    loading_own.set(false);
                    if pending_lampa.borrow().is_some() { let _ = proxy.send_event(UserEvent::ApplyPendingLampa); }
                    // Страница не знает, что окно уже в полном экране (восстановлено при запуске или осталось с прошлой страницы).
                    if is_full.get() { let _ = proxy.send_event(UserEvent::Js("window.__setFullscreen&&window.__setFullscreen(true)".into())); }
                }
            }
        })
        .build(&window);
    let webview = match webview {
        Ok(w) => w,
        Err(e) => {
            webview_unavailable(hwnd, &e.to_string());
            return;
        }
    };

    // Проверка плеера без сервера: LAMPA_MPV_TEST=<файл или адрес>, LAMPA_MPV_PROFILE=<имя>.
    let mut server: Option<url::Url> = None;
    if let (Some(src), Some(p)) = (&test_source, &player) {
        let _ = webview.load_html(pages::TEST_PAGE);
        let (src, p) = (src.clone(), p.clone());
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let profile = std::env::var("LAMPA_MPV_PROFILE").ok();
            p.open(&src, &[], profile.as_deref());
            // Дымовой запуск (CI): через несколько секунд пишем в журнал, что mpv реально декодирует видео.
            std::thread::sleep(std::time::Duration::from_secs(5));
            let get = |n: &str| p.mpv.get_string(n).unwrap_or_else(|| "-".into());
            log::info("smoke", &format!("video-codec={} hwdec-current={} size={}x{} time-pos={}", get("video-codec"), get("hwdec-current"),
                get("video-params/w"), get("video-params/h"), get("time-pos")));
        });
    } else {
        server = if std::env::var_os("LAMPA_ASK_SERVER").is_some() { None } else { initial_server() };
        let _ = proxy.send_event(if server.is_some() { UserEvent::Load } else { UserEvent::App("change".into(), None) });
    }

    // Отладочный хук: LAMPA_EVAL=<файл.js;файл2.js> — файлы выполняются на странице по очереди с интервалом 3 с,
    // начиная через LAMPA_EVAL_DELAY секунд (по умолчанию 8).
    if let (Some(paths), true) = (std::env::var("LAMPA_EVAL").ok(), std::env::var_os("LAMPA_DEBUG").is_some()) {
        let delay: u64 = std::env::var("LAMPA_EVAL_DELAY").ok().and_then(|d| d.parse().ok()).unwrap_or(8);
        let proxy = proxy.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(delay));
            for path in paths.split(';').filter(|p| !p.is_empty()) {
                let _ = proxy.send_event(UserEvent::Eval(PathBuf::from(path)));
                std::thread::sleep(std::time::Duration::from_secs(3));
            }
        });
    }

    // Меню окна (в полном экране скрывается). Сочетания клавиш обрабатывает страница (window.js), поэтому здесь они только подписаны.
    let menu = Menu::new();
    // Все подписи меню хранятся парами (рус., англ.): при смене языка их выставляют заново.
    let mut menu_items: Vec<(MenuItem, &'static str, &'static str)> = Vec::new();
    let mut menu_checks: Vec<(CheckMenuItem, &'static str, &'static str)> = Vec::new();
    let mut menu_subs: Vec<(Submenu, &'static str, &'static str)> = Vec::new();
    let mut check = |id: &str, ru: &'static str, en: &'static str, on: bool| {
        let c = CheckMenuItem::with_id(id, tr(ru, en), true, on, None);
        menu_checks.push((c.clone(), ru, en));
        c
    };
    let verbose_item = check("verbose", "Подробный журнал", "Verbose log", log::is_verbose_setting());
    let single_item = check("single", "Запретить несколько экземпляров", "Prevent multiple instances", settings::single_instance());
    let auto_update_item = check("updateauto", "Проверять обновления автоматически", "Check for updates automatically", update::auto_check());
    let top_item = check("ontop", "Поверх других окон", "Float on top", false);
    let _ = top_item.set_accelerator("Ctrl+T".parse::<muda::accelerator::Accelerator>().ok());
    let lang_ru_item = check("lang_ru", "Русский", "Русский", i18n::is_ru());
    let lang_en_item = check("lang_en", "English", "English", !i18n::is_ru());
    {
        let mut sub = |ru: &'static str, en: &'static str| {
            let m = Submenu::new(tr(ru, en), true);
            menu_subs.push((m.clone(), ru, en));
            m
        };
        let file = sub("Файл", "File");
        let view = sub("Вид", "View");
        let tools = sub("Настройки", "Settings");
        let lang = Submenu::new("Язык / Language", true);
        let help = sub("Справка", "Help");
        let mut item = |id: &str, ru: &'static str, en: &'static str| {
            let m = MenuItem::with_id(id, tr(ru, en), true, None);
            menu_items.push((m.clone(), ru, en));
            m
        };
        let _ = lang.append_items(&[&lang_ru_item, &lang_en_item]);
        let _ = file.append_items(&[&item("server", "Изменить адрес сервера…\tCtrl+,", "Change server address…\tCtrl+,"), &item("reload", "Перезагрузить\tF5", "Reload\tF5"), &PredefinedMenuItem::separator(), &item("quit", "Выход\tAlt+F4", "Exit\tAlt+F4")]);
        let _ = view.append_items(&[&item("fullscreen", "Полный экран\tF11", "Full screen\tF11"), &top_item]);
        let _ = tools.append_items(&[&item("conf", "Открыть mpv.conf", "Open mpv.conf"), &item("confdir", "Показать mpv.conf в Проводнике", "Show mpv.conf in Explorer"), &PredefinedMenuItem::separator(), &item("backup", "Сохранить настройки в файл…", "Save settings to a file…"), &item("restore", "Восстановить настройки из файла…", "Restore settings from a file…"), &PredefinedMenuItem::separator(), &lang, &verbose_item, &single_item, &item("logdir", "Показать журнал в Проводнике", "Show log in Explorer")]);
        let _ = help.append_items(&[&item("update", "Проверить обновления…", "Check for updates…"), &auto_update_item, &PredefinedMenuItem::separator(), &item("about", "О программе Lampyris", "About Lampyris")]);
        let _ = menu.append_items(&[&file, &view, &tools, &help]);
        let _ = unsafe { menu.init_for_hwnd(hwnd) };
        // Меню отнимает высоту у рабочей области уже созданного окна; возвращаем запрошенный размер, иначе каждый запуск «съедает» полосу меню.
        let got = window.inner_size();
        if !window.is_maximized() && got.height < want_inner.height {
            use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER};
            let outer = window.outer_size();
            let height = outer.height + (want_inner.height - got.height);
            let _ = unsafe { SetWindowPos(HWND(hwnd as *mut _), None, 0, 0, outer.width as i32, height as i32, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE) };
        }
        let proxy = proxy.clone();
        MenuEvent::set_event_handler(Some(move |e: MenuEvent| { let _ = proxy.send_event(UserEvent::Menu(e.id.0)); }));
    }
    if start_fullscreen {
        window.set_fullscreen(Some(Fullscreen::Borderless(None)));
        is_full.set(true);
        let _ = unsafe { menu.hide_for_hwnd(hwnd) };
    }

    // Фоновая проверка обновлений: через несколько секунд после запуска, не чаще раза в сутки.
    if update::check_due() {
        let proxy = proxy.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(6));
            update::check(false, move |m| { let _ = proxy.send_event(UserEvent::Update(m)); });
        });
    }

    let mut current = server;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(ue) => match ue {
                UserEvent::Js(js) => { let _ = webview.evaluate_script(&js); }
                UserEvent::Load => {
                    if let Some(u) = current.clone() {
                        let proxy = proxy.clone();
                        std::thread::spawn(move || {
                            let ev = match http::reachable(u.as_str()) {
                                Ok(()) => UserEvent::Navigate(u.to_string()),
                                Err(e) => {
                                    log::error("nav", &format!("сервер недоступен: {e}"));
                                    UserEvent::ShowHtml(pages::error(u.as_str(), &e))
                                }
                            };
                            let _ = proxy.send_event(ev);
                        });
                    }
                }
                UserEvent::Navigate(u) => {
                    special.set(false);
                    loading_own.set(true);
                    trusted.borrow_mut().clear();
                    if let Some(k) = url::Url::parse(&u).ok().and_then(|u| origin_key(&u)) { trusted.borrow_mut().insert(k); }
                    if let Some(b) = &bridge { b.page_did_reset(); }
                    let _ = webview.load_url(&u);
                }
                UserEvent::LoadPlain(u) => { let _ = webview.load_url(&u); }
                UserEvent::Media(cmd) => {
                    if let Some(p) = &player {
                        match cmd {
                            MediaCmd::Play => { p.set("pause", "no"); }
                            MediaCmd::Pause => { p.set("pause", "yes"); }
                            MediaCmd::Seek(d) => p.command(&["seek", &d.to_string(), "relative+exact"]),
                            MediaCmd::SeekAbs(t) => p.command(&["seek", &t.to_string(), "absolute+exact"]),
                            MediaCmd::Next => { let _ = webview.evaluate_script("window.__mpvRemote && window.__mpvRemote('next')"); }
                            MediaCmd::Prev => { let _ = webview.evaluate_script("window.__mpvRemote && window.__mpvRemote('prev')"); }
                        }
                    }
                }
                UserEvent::Window(args) => match args.first().and_then(|v| v.as_str()) {
                    Some("fullscreen") => {
                        let on = match args.get(1) { Some(Value::Bool(b)) => *b, _ => window.fullscreen().is_none() };
                        win_state.track(&window);
                        window.set_fullscreen(if on { Some(Fullscreen::Borderless(None)) } else { None });
                        is_full.set(on);
                        let _ = unsafe { if on { menu.hide_for_hwnd(hwnd) } else { menu.show_for_hwnd(hwnd) } };
                        let _ = webview.evaluate_script(&format!("window.__setFullscreen&&window.__setFullscreen({on})"));
                    }
                    Some("reload") => { let _ = proxy.send_event(UserEvent::Load); }
                    Some("changeServer") => { let _ = proxy.send_event(UserEvent::App("change".into(), None)); }
                    _ => {}
                },
                UserEvent::Menu(id) => match id.as_str() {
                    "server" => { let _ = proxy.send_event(UserEvent::App("change".into(), None)); }
                    "reload" => { log::info("app", "перезагрузка страницы"); let _ = proxy.send_event(UserEvent::Load); }
                    "fullscreen" => { let _ = proxy.send_event(UserEvent::Window(vec![Value::from("fullscreen"), Value::from("toggle")])); }
                    "ontop" => {
                        let on = !window.is_always_on_top();
                        window.set_always_on_top(on);
                        top_item.set_checked(on);
                    }
                    "quit" => {
                        if let Some(p) = &player { p.shutdown(); }
                        win_state.maximized = window.is_maximized();
                        win_state.fullscreen = window.fullscreen().is_some();
                        win_state.track(&window);
                        if win_state.w > 0 { win_state.save(); }
                        *control_flow = ControlFlow::Exit;
                    }
                    "backup" => {
                        // Данные Lampa читаются со страницы, только если это страница доверенного сервера.
                        let trusted_page = !special.get() && webview.url().ok().and_then(|u| url::Url::parse(&u).ok()).and_then(|u| origin_key(&u)).is_some_and(|k| trusted.borrow().contains(&k));
                        if trusted_page {
                            let proxy = proxy.clone();
                            let _ = webview.evaluate_script_with_callback(backup::COLLECT_SCRIPT, move |res| {
                                let _ = proxy.send_event(UserEvent::BackupCollected(backup::parse_collected(&res)));
                            });
                        } else {
                            save_backup(hwnd, None);
                        }
                    }
                    "restore" => {
                        if let Some(b) = pick_backup(hwnd) {
                            if let Some(s) = &b.server_url { settings::set_value("serverURL", serde_json::json!(s)); }
                            if !b.history.is_empty() || b.server_url.is_some() { settings::set_value("serverHistory", serde_json::json!(b.history)); }
                            if let Some(v) = b.verbose_log {
                                log::set_verbose(v);
                                verbose_item.set_checked(log::is_verbose_setting());
                                let _ = webview.evaluate_script(&format!("window.__lv = {}", log::is_verbose()));
                            }
                            if let Some(a) = b.auto_update_check {
                                update::set_auto_check(a);
                                auto_update_item.set_checked(a);
                            }
                            if let Some(conf) = &b.mpv_conf { let _ = config::write_text(conf); }
                            if let Some(u) = b.server_url.as_deref().and_then(settings::parse_server) { current = Some(u); }
                            *pending_lampa.borrow_mut() = b.restore_script();
                            log::info("backup", "настройки восстановлены из файла");
                            let _ = proxy.send_event(UserEvent::Load);
                        }
                    }
                    "conf" => open_mpv_conf(false),
                    "confdir" => open_mpv_conf(true),
                    "verbose" => {
                        log::set_verbose(!log::is_verbose_setting());
                        verbose_item.set_checked(log::is_verbose_setting());
                        let _ = webview.evaluate_script(&format!("window.__lv = {}", log::is_verbose()));
                    }
                    "logdir" => {
                        let _ = std::fs::create_dir_all(log::folder());
                        let _ = std::process::Command::new("explorer").arg(log::folder()).spawn();
                    }
                    "about" => show_about(hwnd),
                    "update" => {
                        let proxy = proxy.clone();
                        update::check(true, move |m| { let _ = proxy.send_event(UserEvent::Update(m)); });
                    }
                    "single" => {
                        settings::set_single_instance(!settings::single_instance());
                        single_item.set_checked(settings::single_instance());
                    }
                    "updateauto" => update::set_auto_check(!update::auto_check()),
                    id @ ("lang_ru" | "lang_en") => {
                        i18n::set(id == "lang_ru");
                        for (m, ru, en) in &menu_items { m.set_text(tr(ru, en)); }
                        for (m, ru, en) in &menu_checks { m.set_text(tr(ru, en)); }
                        for (m, ru, en) in &menu_subs { m.set_text(tr(ru, en)); }
                        lang_ru_item.set_checked(i18n::is_ru());
                        lang_en_item.set_checked(!i18n::is_ru());
                        // Язык самой Lampa берётся из localStorage; записываем его и только потом перезагружаем страницу.
                        let p = proxy.clone();
                        let js = format!("try{{let l='{0}';localStorage.setItem('language',l);localStorage.setItem('tmdb_lang',l)}}catch(e){{}}", if i18n::is_ru() { "ru" } else { "en" });
                        let _ = webview.evaluate_script_with_callback(&js, move |_| { let _ = p.send_event(UserEvent::Load); });
                    }
                    _ => {}
                },
                UserEvent::Update(msg) => match msg {
                    update::Msg::Info(title, text) => message(hwnd, &title, &text, MB_ICONINFORMATION),
                    update::Msg::Error(text) => message(hwnd, tr("Не удалось установить обновление", "Could not install the update"), &text, MB_ICONERROR),
                    update::Msg::Status(s) => window.set_title(s.as_deref().unwrap_or("Lampyris")),
                    update::Msg::Found { release, .. } => {
                        let blocker = update::install_blocker();
                        let answer = ask_update(hwnd, &release, &blocker);
                        if let UpdateAnswer::Install = answer {
                            if blocker.is_none() {
                                let proxy = proxy.clone();
                                update::install(release, move |m| { let _ = proxy.send_event(UserEvent::Update(m)); });
                            } else {
                                open_externally(&release.page_url);
                            }
                        } else if let UpdateAnswer::Skip = answer {
                            update::skip_version(&release.version);
                        }
                    }
                    update::Msg::Launch(launch) => match update::spawn(&launch) {
                        Ok(()) => {
                            // Выходим так же, как из меню: останавливаем плеер и запоминаем окно; дальше работает установщик или скрипт замены.
                            if let Some(p) = &player { p.shutdown(); }
                            win_state.maximized = window.is_maximized();
                            win_state.fullscreen = window.fullscreen().is_some();
                            win_state.track(&window);
                            if win_state.w > 0 { win_state.save(); }
                            *control_flow = ControlFlow::Exit;
                        }
                        Err(e) => {
                            log::error("update", &format!("не удалось запустить установку: {e}"));
                            window.set_title("Lampyris");
                            message(hwnd, tr("Не удалось установить обновление", "Could not install the update"), &crate::trf!("Не удалось запустить установку: {e}\n\nУстановленная версия не изменена.", "Could not start the installation: {e}\n\nThe installed version was not changed."), MB_ICONERROR);
                        }
                    },
                },
                UserEvent::BackupCollected(lampa) => save_backup(hwnd, lampa),
                UserEvent::ApplyPendingLampa => {
                    let script = pending_lampa.borrow_mut().take();
                    if let Some(script) = script {
                        if special.get() {
                            message(hwnd, tr("Данные Lampa не восстановлены", "Lampa data was not restored"), tr("Настройки приложения восстановлены, но страница сервера не открылась. Откройте Lampa и восстановите копию ещё раз.", "App settings were restored, but the server page did not open. Open Lampa and restore the backup again."), MB_ICONERROR);
                        } else {
                            let proxy = proxy.clone();
                            let _ = webview.evaluate_script_with_callback(&script, move |res| { let _ = proxy.send_event(UserEvent::LampaRestored(res.trim_matches('"') == "ok")); });
                        }
                    }
                }
                UserEvent::LampaRestored(ok) => {
                    log::info("backup", if ok { "данные Lampa восстановлены" } else { "данные Lampa не восстановлены: страница открыта с другого источника" });
                    if ok {
                        let _ = proxy.send_event(UserEvent::Load);
                    } else {
                        message(hwnd, tr("Данные Lampa не восстановлены", "Lampa data was not restored"), tr("Настройки приложения восстановлены, но страница сервера открылась с другого адреса, чем в копии. Откройте Lampa и восстановите копию ещё раз.", "App settings were restored, but the server page opened from a different address than in the backup. Open Lampa and restore the backup again."), MB_ICONERROR);
                    }
                }
                UserEvent::Eval(path) => match std::fs::read_to_string(&path) {
                    Ok(js) => { let _ = webview.evaluate_script_with_callback(&js, |res| log::info("eval", &res)); }
                    Err(e) => log::error("eval", &format!("{}: {e}", path.display())),
                },
                UserEvent::ShowHtml(html) => {
                    special.set(true);
                    let _ = webview.load_html(&html);
                }
                UserEvent::App(action, arg) => match action.as_str() {
                    "retry" => { let _ = proxy.send_event(UserEvent::Load); }
                    "change" => {
                        let initial = current.as_ref().map(|u| u.to_string()).unwrap_or_default();
                        let _ = proxy.send_event(UserEvent::ShowHtml(pages::prompt(&initial, &settings::history(), "")));
                    }
                    "server" => match arg.as_deref().and_then(settings::parse_server) {
                        Some(u) => {
                            settings::remember_server(u.as_str());
                            current = Some(u);
                            let _ = proxy.send_event(UserEvent::Load);
                        }
                        None => {
                            let _ = proxy.send_event(UserEvent::ShowHtml(pages::prompt(arg.as_deref().unwrap_or(""), &settings::history(), tr("Не похоже на адрес сервера", "That does not look like a server address"))));
                        }
                    },
                    _ => {}
                },
            },
            Event::WindowEvent { event: WindowEvent::Moved(_) | WindowEvent::Resized(_), .. } => win_state.track(&window),
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                if let Some(p) = &player { p.shutdown(); }
                win_state.maximized = window.is_maximized();
                win_state.fullscreen = window.fullscreen().is_some();
                if win_state.w > 0 { win_state.save(); }
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}
