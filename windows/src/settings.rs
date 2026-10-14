//! Каталоги приложения и настройки (адрес сервера, история адресов, подробный журнал).
//! Хранятся в %APPDATA%\Lampyris\settings.json, в репозиторий не попадают.

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());
const HISTORY_LIMIT: usize = 10;

fn env_dir(var: &str) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

/// %APPDATA%\Lampyris — mpv.conf и настройки.
pub fn app_data_dir() -> PathBuf {
    env_dir("APPDATA").join("Lampyris")
}

/// %LOCALAPPDATA%\Lampyris — журнал, кэш субтитров, данные WebView2.
pub fn local_dir() -> PathBuf {
    env_dir("LOCALAPPDATA").join("Lampyris")
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
    let _ = std::fs::write(file(), serde_json::to_string_pretty(v).unwrap_or_default());
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
    use super::parse_server;

    #[test]
    fn server_addresses() {
        assert_eq!(parse_server("192.168.1.10:9118").map(|u| u.to_string()).as_deref(), Some("http://192.168.1.10:9118/"));
        assert_eq!(parse_server(" https://example.org/lampa ").map(|u| u.to_string()).as_deref(), Some("https://example.org/lampa"));
        assert!(parse_server("").is_none());
        assert!(parse_server("ftp://host").is_none());
    }
}
