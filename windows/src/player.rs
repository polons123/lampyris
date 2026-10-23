//! Плеер: обёртка над libmpv с потоком событий. Порт `MpvPlayer.swift`.
//! Видео рисует сам mpv в дочернем окне главного окна (`--wid`); страница лежит над ним
//! прозрачным WebView2, поэтому окно mpv опускается на дно z-порядка.

use crate::config::MpvConfig;
use crate::log::{self, Level};
use crate::mpv::{self, Mpv};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED};
use windows::Win32::System::SystemInformation::GetLocalTime;
use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE};

/// Приёмник событий mpv (сообщения вида {event, …}); вызывается из потока событий.
pub type Sink = Arc<dyn Fn(Value) + Send + Sync>;

/// Частые свойства (mpv обновляет их на каждый кадр) уходят на страницу не чаще чем раз в 150 мс.
/// Скачок значения (перемотка) уходит сразу, подавленное последнее значение досылается после паузы.
const THROTTLED: &[&str] = &["time-pos", "demuxer-cache-time"];
const THROTTLE_INTERVAL: Duration = Duration::from_millis(150);
const THROTTLE_JUMP: f64 = 0.5;

#[derive(Default)]
struct ConfigState {
    /// Имена опций, изменённых mpv.conf при предыдущем открытии: перед новым применением их надо вернуть.
    applied: Vec<String>,
    /// Значения опций до первого вмешательства mpv.conf (то, что выставило приложение или осталось по умолчанию).
    baseline: HashMap<String, String>,
}

pub struct Player {
    pub mpv: Arc<Mpv>,
    hwnd: isize,
    cfg: Mutex<ConfigState>,
    generation: AtomicU64,
    closing: Arc<AtomicBool>,
    reset_throttle: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
    sink: Sink,
}

impl Player {
    pub fn new(hwnd: isize, libmpv: &Path, sink: Sink) -> Result<Arc<Player>, String> {
        let m = Mpv::load(libmpv)?;
        let vo = std::env::var("LAMPA_MPV_VO").unwrap_or_else(|_| "gpu-next".into());
        // config=no: штатный mpv.conf не читаем; свой файл с профилями применяет MpvConfig.
        for (k, v) in [
            ("wid", hwnd.to_string()), ("vo", vo), ("hwdec", "auto-safe".into()), ("input-default-bindings", "no".into()),
            ("input-vo-keyboard", "no".into()), ("osc", "no".into()), ("config", "no".into()), ("keep-open", "yes".into()),
            ("idle", "yes".into()), ("ytdl", "no".into()), ("load-scripts", "no".into()), ("screenshot-high-bit-depth", "no".into()), ("screenshot-format", "png".into()),
            // Тихое переподключение ffmpeg при обрыве и ответах 429/5xx (пауза растёт до 5 с); mpv.conf может заменить значение.
            ("stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_on_http_error=%7%429,5xx,reconnect_delay_max=5".into()),
        ] {
            m.option(k, &v);
        }
        let mut state = ConfigState::default();
        // Общие опции из mpv.conf — до инициализации, чтобы подействовали и «стартовые» (например, hwdec).
        for e in MpvConfig::load().global {
            if !state.baseline.contains_key(&e.name) {
                if let Some(v) = m.get_string(&format!("options/{}", e.name)) {
                    state.baseline.insert(e.name.clone(), v);
                }
            }
            state.applied.push(e.name.clone());
            let key = match &e.op {
                Some(op) => format!("{}-{}", e.name, op),
                None => e.name.clone(),
            };
            m.option(&key, &e.value);
        }
        m.initialize().map_err(|e| format!("mpv_initialize: {e}"))?;
        m.request_log_messages("warn");
        m.observe(&[
            ("time-pos", mpv::FORMAT_DOUBLE), ("duration", mpv::FORMAT_DOUBLE), ("demuxer-cache-time", mpv::FORMAT_DOUBLE),
            ("pause", mpv::FORMAT_FLAG), ("paused-for-cache", mpv::FORMAT_FLAG), ("eof-reached", mpv::FORMAT_FLAG),
            ("hwdec-current", mpv::FORMAT_STRING), ("video-params", mpv::FORMAT_NODE), ("track-list", mpv::FORMAT_NODE),
            ("aid", mpv::FORMAT_STRING), ("sid", mpv::FORMAT_STRING),
        ]);
        let mpv = Arc::new(m);
        let closing = Arc::new(AtomicBool::new(false));
        let reset_throttle = Arc::new(AtomicBool::new(false));
        let thread = {
            let (mpv, closing, reset, sink) = (mpv.clone(), closing.clone(), reset_throttle.clone(), sink.clone());
            std::thread::Builder::new().name("mpv-events".into()).spawn(move || event_loop(mpv, hwnd, closing, reset, sink)).map_err(|e| e.to_string())?
        };
        Ok(Arc::new(Player {
            mpv, hwnd, cfg: Mutex::new(state), generation: AtomicU64::new(0), closing, reset_throttle,
            thread: Mutex::new(Some(thread)), sink,
        }))
    }

    /// Растёт при каждом открытии видео: отложенные результаты (скачанные субтитры) сверяются с ним.
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Открывает URL; options — пары для loadfile (start, demuxer-readahead-secs и т.п.).
    /// mpv.conf читается заново при каждом открытии; его опции важнее настроек приложения.
    pub fn open(&self, url: &str, options: &[(String, String)], profile: Option<&str>) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        let names = self.apply_config(profile);
        let opts: Vec<String> = options.iter().filter(|(k, _)| !names.contains(k)).map(|(k, v)| format!("{k}={v}")).collect();
        self.command(&["loadfile", url, "replace", "-1", &opts.join(",")]);
    }

    /// Применяет общие опции mpv.conf и профиль к текущему состоянию mpv, в том числе во время
    /// воспроизведения. Возвращает имена затронутых опций.
    pub fn apply_config(&self, profile: Option<&str>) -> HashSet<String> {
        let cfg = MpvConfig::load();
        let entries = cfg.entries(profile);
        let mut st = self.cfg.lock().unwrap();
        for name in st.applied.clone() {
            if let Some(v) = st.baseline.get(&name) {
                self.mpv.set_property(&name, v);
            }
        }
        for e in &entries {
            if !st.baseline.contains_key(&e.name) {
                // Запоминаем до изменения. Опцию без значения запоминать нечем: вернём заводское.
                let v = self.mpv.get_string(&e.name).or_else(|| self.mpv.get_string(&format!("option-info/{}/default-value", e.name)));
                if let Some(v) = v {
                    st.baseline.insert(e.name.clone(), v);
                }
            }
        }
        for e in &entries {
            let rc = match &e.op {
                Some(op) => self.mpv.command(&["change-list", &e.name, op, &e.value]),
                None => self.mpv.set_property(&e.name, &e.value),
            };
            if rc < 0 {
                log::warn("mpv", &format!("mpv.conf: {}={}: {}", e.name, e.value, self.mpv.error_string(rc)));
            }
        }
        let names: HashSet<String> = entries.iter().map(|e| e.name.clone()).collect();
        st.applied = names.iter().cloned().collect();
        names
    }

    /// Подключает внешние субтитры (файл формирует приложение) и сразу включает их.
    pub fn add_subtitle(&self, path: &str, title: &str, lang: &str) -> bool {
        self.mpv.command(&["sub-add", path, "select", title, lang]) >= 0
    }

    pub fn command(&self, args: &[&str]) {
        let rc = self.mpv.command(args);
        if rc < 0 {
            (self.sink)(json!({"event": "command-failed", "command": args.first().unwrap_or(&""), "error": self.mpv.error_string(rc)}));
        }
    }

    pub fn set(&self, name: &str, value: &str) -> bool {
        self.mpv.set_property(name, value) >= 0
    }

    pub fn get(&self, name: &str) -> Option<Value> {
        self.mpv.get(name)
    }

    pub fn stop(&self) {
        self.command(&["stop"]);
    }

    /// Новый документ в главном кадре: сбрасываем подавленные значения предыдущей страницы.
    pub fn page_did_reset(&self) {
        self.reset_throttle.store(true, Ordering::SeqCst);
        self.stop();
    }

    /// Снимок текущего кадра (с субтитрами) в Pictures\Lampyris. Путь формирует только приложение.
    pub fn screenshot(&self) -> Value {
        let pictures: PathBuf = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default().join("Pictures").join("Lampyris");
        if let Err(e) = std::fs::create_dir_all(&pictures) {
            return json!({"ok": false, "error": e.to_string()});
        }
        let t = unsafe { GetLocalTime() };
        let pos = self.mpv.get_string("time-pos").and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0) as u64;
        let name = format!(
            "Lampyris {:04}-{:02}-{:02} {:02}.{:02}.{:02} ({}.{:02}.{:02}).png",
            t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, pos / 3600, pos / 60 % 60, pos % 60
        );
        let path = pictures.join(&name);
        let rc = self.mpv.command(&["screenshot-to-file", &path.to_string_lossy(), "subtitles"]);
        if rc < 0 {
            return json!({"ok": false, "error": self.mpv.error_string(rc)});
        }
        json!({"ok": true, "path": path.to_string_lossy(), "folder": pictures.to_string_lossy(), "name": name})
    }

    /// Останавливает поток событий и освобождает mpv (после этого обращения к нему безопасно ничего не делают).
    pub fn shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.lock().unwrap().take() {
            let _ = t.join();
        }
        // Поток событий остановлен; освобождение ждёт вызовы из других потоков (субтитры, мост), поздние вызовы безопасны.
        self.mpv.destroy();
        let _ = self.hwnd;
    }
}

unsafe extern "system" fn lower_mpv_window(hwnd: HWND, _: LPARAM) -> BOOL {
    let mut name = [0u16; 64];
    let n = GetClassNameW(hwnd, &mut name).max(0) as usize;
    if String::from_utf16_lossy(&name[..n]) == "mpv" {
        let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    BOOL(1)
}

fn lower_video_window(hwnd: isize) {
    unsafe {
        let _ = EnumChildWindows(Some(HWND(hwnd as *mut _)), Some(lower_mpv_window), LPARAM(0));
    }
}

/// Сколько держать дисплей включённым на паузе: потом снова действуют обычные настройки сна Windows.
const PAUSE_SLEEP_HOLD: Duration = Duration::from_secs(10 * 60);

/// Не даём Windows гасить дисплей и включать заставку, пока видео открыто; на паузе не дольше PAUSE_SLEEP_HOLD.
/// Состояние привязано к потоку, поэтому вызывается только из потока событий.
fn update_sleep(file_active: bool, paused_since: Option<Instant>, held: &mut bool) {
    let need = file_active && paused_since.map_or(true, |t| t.elapsed() < PAUSE_SLEEP_HOLD);
    if need != *held {
        unsafe { SetThreadExecutionState(if need { ES_CONTINUOUS | ES_DISPLAY_REQUIRED } else { ES_CONTINUOUS }) };
        *held = need;
    }
}

struct Throttle {
    last: HashMap<String, (Instant, Option<f64>)>,
    pending: HashMap<String, Value>,
}

fn event_loop(mpv: Arc<Mpv>, hwnd: isize, closing: Arc<AtomicBool>, reset: Arc<AtomicBool>, sink: Sink) {
    let mut th = Throttle { last: HashMap::new(), pending: HashMap::new() };
    let (mut file_active, mut paused_since, mut sleep_held) = (false, None::<Instant>, false);
    let mut last_log = String::new();
    let mut last_lower = Instant::now();
    while !closing.load(Ordering::SeqCst) {
        if reset.swap(false, Ordering::SeqCst) {
            th.last.clear();
            th.pending.clear();
        }
        // Досылаем подавленные значения, у которых прошёл интервал.
        let due: Vec<String> = th.pending.keys().filter(|k| th.last.get(*k).map(|(t, _)| t.elapsed() >= THROTTLE_INTERVAL).unwrap_or(true)).cloned().collect();
        for name in due {
            if let Some(msg) = th.pending.remove(&name) {
                th.last.insert(name, (Instant::now(), msg["data"].as_f64()));
                sink(msg);
            }
        }
        // Пока файл открыт, mpv может пересоздать своё окно (смена потока, например качества): новое окно создаётся
        // поверх страницы и белым закрывает её до события VIDEO_RECONFIG. Опускаем его сразу, не дожидаясь события.
        if file_active && last_lower.elapsed() >= Duration::from_millis(30) {
            lower_video_window(hwnd);
            last_lower = Instant::now();
        }
        let ev = mpv.wait_event(0.03);
        if ev.id == mpv::EVENT_NONE {
            // Таймаут паузы истекает без событий mpv.
            update_sleep(file_active, paused_since, &mut sleep_held);
            continue;
        }
        let mut msg = json!({"event": ev.name});
        match ev.id {
            mpv::EVENT_SHUTDOWN => break,
            mpv::EVENT_LOG_MESSAGE => {
                // Предупреждения и ошибки mpv — только в подробном журнале, без подряд идущих повторов.
                if let Some((prefix, level, text)) = ev.log {
                    if log::is_verbose() && !text.is_empty() {
                        let line = format!("{prefix}: {level}: {text}");
                        if line != last_log {
                            let lv = if level == "error" || level == "fatal" { Level::Error } else { Level::Warn };
                            log::verbose(lv, &format!("mpv/{prefix}"), &format!("{level}: {text}"));
                            last_log = line;
                        }
                    }
                }
                continue;
            }
            mpv::EVENT_START_FILE => {
                file_active = true;
                update_sleep(file_active, paused_since, &mut sleep_held);
            }
            mpv::EVENT_FILE_LOADED | mpv::EVENT_VIDEO_RECONFIG => {
                if ev.id == mpv::EVENT_FILE_LOADED {
                    file_active = true;
                    update_sleep(file_active, paused_since, &mut sleep_held);
                }
                lower_video_window(hwnd);
            }
            mpv::EVENT_END_FILE => {
                file_active = false;
                update_sleep(file_active, paused_since, &mut sleep_held);
                if let Some((reason, error)) = ev.end_file {
                    msg["reason"] = json!(reason);
                    if let Some(e) = error {
                        msg["error"] = json!(e);
                    }
                }
            }
            mpv::EVENT_PROPERTY_CHANGE => {
                if let Some((name, data)) = ev.property {
                    if name == "pause" {
                        if let Some(flag) = data.as_bool() {
                            paused_since = if flag { Some(Instant::now()) } else { None };
                            update_sleep(file_active, paused_since, &mut sleep_held);
                        }
                    }
                    msg["name"] = json!(name);
                    msg["data"] = data;
                    if THROTTLED.contains(&name.as_str()) {
                        let value = msg["data"].as_f64();
                        if let Some((time, prev)) = th.last.get(&name) {
                            let jump = match (value, prev) { (Some(a), Some(b)) => (a - b).abs(), _ => 0.0 };
                            if time.elapsed() < THROTTLE_INTERVAL && jump < THROTTLE_JUMP {
                                th.pending.insert(name, msg);
                                continue;
                            }
                        }
                        th.last.insert(name.clone(), (Instant::now(), value));
                        th.pending.remove(&name);
                    }
                }
            }
            _ => {}
        }
        sink(msg);
    }
    update_sleep(false, None, &mut sleep_held);
}

