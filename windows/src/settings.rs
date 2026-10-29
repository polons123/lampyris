//! Каталоги приложения и настройки (адрес сервера, история адресов, подробный журнал).
//! Хранятся в %APPDATA%\Lampyris\settings.json (в портативном режиме — в data\Roaming рядом с программой), в репозиторий не попадают.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static LOCK: Mutex<()> = Mutex::new(());
const HISTORY_LIMIT: usize = 10;

fn env_dir(var: &str) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

/// Имя файла-маркера рядом с Lampyris.exe: полностью портативный режим, все данные лежат в папке `data` рядом с программой.
pub const PORTABLE_MARKER: &str = "portable.txt";

/// Папка `data` полностью портативной копии (рядом с exe лежит `portable.txt`); иначе None.
pub fn portable_data_dir() -> Option<PathBuf> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        portable_data_in(&exe_dir)
    })
    .clone()
}

fn portable_data_in(exe_dir: &Path) -> Option<PathBuf> {
    exe_dir.join(PORTABLE_MARKER).is_file().then(|| exe_dir.join("data"))
}

/// %APPDATA%\Lampyris (в портативном режиме `data\Roaming`) — mpv.conf и настройки.
pub fn app_data_dir() -> PathBuf {
    match portable_data_dir() {
        Some(d) => d.join("Roaming"),
        None => env_dir("APPDATA").join("Lampyris"),
    }
}

/// %LOCALAPPDATA%\Lampyris (в портативном режиме `data\Local`) — журнал, кэш субтитров, данные WebView2.
pub fn local_dir() -> PathBuf {
    match portable_data_dir() {
        Some(d) => d.join("Local"),
        None => env_dir("LOCALAPPDATA").join("Lampyris"),
    }
}

fn file() -> PathBuf {
    app_data_dir().join("settings.json")
}

fn read() -> Value {
    // BOM в начале файла (его добавляют некоторые редакторы и Windows PowerShell) серде не принимает.
    std::fs::read_to_string(file()).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_else(|| json!({}))
}

fn write(v: &Value) {
    let _ = std::fs::create_dir_all(app_data_dir());
    if let Ok(bytes) = serde_json::to_vec_pretty(v) {
        if let Err(e) = atomic_write(&file(), &bytes) { crate::log::warn("settings", &format!("не удалось сохранить настройки: {e}")); }
    }
}

pub fn get_string(key: &str) -> Option<String> {
    let _g = LOCK.lock().ok();
    read().get(key).and_then(|v| v.as_str()).map(String::from)
}

pub fn get_value(key: &str) -> Option<Value> {
    let _g = LOCK.lock().ok();
    read().get(key).cloned()
}

pub fn get_bool(key: &str) -> bool {
    let _g = LOCK.lock().ok();
    read().get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

pub fn set_value(key: &str, value: Value) {
    let _g = LOCK.lock().ok();
    let mut v = read();
    v[key] = value;
    write(&v);
}

pub fn history() -> Vec<String> {
    let _g = LOCK.lock().ok();
    read().get("serverHistory").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// Запоминает адрес как текущий и ставит первым в историю.
pub fn remember_server(address: &str) {
    let mut list: Vec<String> = history().into_iter().filter(|a| a != address).collect();
    list.insert(0, address.to_string());
    list.truncate(HISTORY_LIMIT);
    set_value("serverURL", json!(address));
    set_value("serverHistory", json!(list));
}

/// Адрес сервера из ввода пользователя: без схемы подставляется http://.
pub fn parse_server(s: &str) -> Option<url::Url> {
    let mut t = s.trim().to_string();
    if t.is_empty() {
        return None;
    }
    if !t.contains("://") {
        t = format!("http://{t}");
    }
    let u = url::Url::parse(&t).ok()?;
    matches!(u.scheme(), "http" | "https").then_some(u).filter(|u| u.host_str().is_some())
}

#[cfg(test)]
mod tests {
    use super::{parse_server, portable_data_in, PORTABLE_MARKER};

    #[test]
    fn server_addresses() {
        assert_eq!(parse_server("192.168.1.10:9118").map(|u| u.to_string()).as_deref(), Some("http://192.168.1.10:9118/"));
        assert_eq!(parse_server(" https://example.org/lampa ").map(|u| u.to_string()).as_deref(), Some("https://example.org/lampa"));
        assert!(parse_server("").is_none());
        assert!(parse_server("ftp://host").is_none());
    }

    #[test]
    fn portable_marker() {
        let d = std::env::temp_dir().join(format!("lampyris-portable-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        assert_eq!(portable_data_in(&d), None);
        std::fs::write(d.join(PORTABLE_MARKER), b"").unwrap();
        assert_eq!(portable_data_in(&d), Some(d.join("data")));
        let _ = std::fs::remove_dir_all(&d);
    }
}

/// Разрешён ли только один запущенный экземпляр (по умолчанию выключено); действует со следующего запуска.
pub fn single_instance() -> bool {
    get_bool("singleInstance")
}

pub fn set_single_instance(on: bool) {
    set_value("singleInstance", Value::Bool(on));
}

/// Записываем рядом с целевым файлом и заменяем его только после полной записи.
/// Межпроцессные конфликты значений это не устраняет, но прерванная запись не обнуляет старый файл.
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let parent = path.parent().ok_or_else(|| std::io::Error::other("missing parent"))?;
    std::fs::create_dir_all(parent)?;
    let (temp, mut file) = loop {
        let temp = parent.join(format!(".lampyris-{}-{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => break (temp, file),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    };
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        #[cfg(windows)] {
            use std::os::windows::ffi::OsStrExt;
            use windows::core::PCWSTR;
            use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
            let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            unsafe { MoveFileExW(PCWSTR(from.as_ptr()), PCWSTR(to.as_ptr()), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) }
                .map_err(std::io::Error::other)
        }
        #[cfg(not(windows))] { std::fs::rename(&temp, path) }
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temp); }
    result
}

#[cfg(test)]
mod atomic_tests {
    use super::*;
    #[test]
    fn replaces_existing_file_and_preserves_it_on_failure() {
        let dir = std::env::temp_dir().join(format!("lampyris-atomic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        atomic_write(&path, b"old").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        let target_dir = dir.join("directory");
        std::fs::create_dir_all(&target_dir).unwrap();
        assert!(atomic_write(&target_dir, b"invalid").is_err());
        assert!(target_dir.is_dir());
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert!(!std::fs::read_dir(&dir).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
