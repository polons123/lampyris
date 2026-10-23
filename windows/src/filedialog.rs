//! Системные окна выбора файла (comdlg32) для резервной копии настроек.

use std::path::PathBuf;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Controls::Dialogs::{GetOpenFileNameW, GetSaveFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST, OPENFILENAMEW};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn run(hwnd: isize, title: &str, default_name: &str, save: bool) -> Option<PathBuf> {
    let title = wide(title);
    let ext = wide("json");
    // Фильтр: пары «название\0маска\0», в конце два нуля.
    let filter: Vec<u16> = format!("{}\0*.json\0{}\0*.*\0\0", crate::i18n::tr("Резервная копия Lampyris (*.json)", "Lampyris backup (*.json)"), crate::i18n::tr("Все файлы", "All files")).encode_utf16().collect();
    let mut buf = vec![0u16; 1024];
    for (i, c) in default_name.encode_utf16().take(buf.len() - 1).enumerate() {
        buf[i] = c;
    }
    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: HWND(hwnd as *mut _),
        lpstrFilter: PCWSTR(filter.as_ptr()),
        lpstrFile: PWSTR(buf.as_mut_ptr()),
        nMaxFile: buf.len() as u32,
        lpstrTitle: PCWSTR(title.as_ptr()),
        lpstrDefExt: PCWSTR(ext.as_ptr()),
        Flags: if save { OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | OFN_OVERWRITEPROMPT } else { OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST },
        ..Default::default()
    };
    let ok = unsafe { if save { GetSaveFileNameW(&mut ofn) } else { GetOpenFileNameW(&mut ofn) } }.as_bool();
    if !ok {
        return None;
    }
    let len = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    Some(PathBuf::from(String::from_utf16_lossy(&buf[..len])))
}

/// Окно «Сохранить как»; None, если пользователь отказался.
pub fn save(hwnd: isize, title: &str, default_name: &str) -> Option<PathBuf> {
    run(hwnd, title, default_name, true)
}

/// Окно «Открыть»; None, если пользователь отказался.
pub fn open(hwnd: isize, title: &str) -> Option<PathBuf> {
    run(hwnd, title, "", false)
}

/// Окно «Открыть видео» с выбором нескольких файлов; пустой список, если пользователь отказался.
pub fn open_videos(hwnd: isize, title: &str) -> Vec<PathBuf> {
    use windows::Win32::UI::Controls::Dialogs::OFN_ALLOWMULTISELECT;
    let title = wide(title);
    let exts = crate::bridge::LOCAL_EXTENSIONS.iter().map(|e| format!("*.{e}")).collect::<Vec<_>>().join(";");
    let filter: Vec<u16> = format!("{}\0{exts}\0{}\0*.*\0\0", crate::i18n::tr("Видео и звук", "Video and audio"), crate::i18n::tr("Все файлы", "All files")).encode_utf16().collect();
    // Для нескольких файлов нужен большой буфер: «каталог\0файл1\0файл2\0\0».
    let mut buf = vec![0u16; 32 * 1024];
    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: HWND(hwnd as *mut _),
        lpstrFilter: PCWSTR(filter.as_ptr()),
        lpstrFile: PWSTR(buf.as_mut_ptr()),
        nMaxFile: buf.len() as u32,
        lpstrTitle: PCWSTR(title.as_ptr()),
        Flags: OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_ALLOWMULTISELECT,
        ..Default::default()
    };
    if !unsafe { GetOpenFileNameW(&mut ofn) }.as_bool() {
        return Vec::new();
    }
    let parts: Vec<String> = buf.split(|c| *c == 0).take_while(|p| !p.is_empty()).map(String::from_utf16_lossy).collect();
    match parts.as_slice() {
        [] => Vec::new(),
        [one] => vec![PathBuf::from(one)],
        [dir, files @ ..] => files.iter().map(|f| PathBuf::from(dir).join(f)).collect(),
    }
}
