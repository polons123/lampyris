//! Журнал приложения. Короткие сообщения (отклонения моста, навигация, ошибки) пишутся всегда,
//! подробные (консоль страницы, предупреждения mpv, статистика) только при включённом «Подробном журнале».
//! Файл %LOCALAPPDATA%\Lampyris\Logs\lampa.log, ротация 2 МБ × 3 файла. Адреса http(s) сокращаются
//! до схемы и хоста: в ссылках бывают ключи и токены. LAMPA_DEBUG=1 включает подробный режим и вывод в stderr.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

static VERBOSE: AtomicBool = AtomicBool::new(false);
static DEBUG_ENV: AtomicBool = AtomicBool::new(false);
static FILE_LOCK: Mutex<()> = Mutex::new(());
const MAX_BYTES: u64 = 2_000_000;
const KEEP_FILES: u32 = 3;

pub fn init() {
    DEBUG_ENV.store(std::env::var_os("LAMPA_DEBUG").is_some(), Ordering::Relaxed);
    VERBOSE.store(crate::settings::get_bool("verboseLog"), Ordering::Relaxed);
}

pub fn is_verbose() -> bool {
    DEBUG_ENV.load(Ordering::Relaxed) || VERBOSE.load(Ordering::Relaxed)
}

pub fn is_verbose_setting() -> bool {
    VERBOSE.load(Ordering::Relaxed)
}

pub fn set_verbose(on: bool) {
    VERBOSE.store(on, Ordering::Relaxed);
    crate::settings::set_value("verboseLog", serde_json::json!(on));
    if on {
        log(Level::Info, "app", "подробный журнал включён (в файле адреса сокращены до хоста)", false);
    }
}

pub fn folder() -> PathBuf {
    crate::settings::local_dir().join("Logs")
}

pub fn log(level: Level, category: &str, message: &str, verbose_only: bool) {
    let verbose = is_verbose();
    if verbose_only && !verbose {
        return;
    }
    if DEBUG_ENV.load(Ordering::Relaxed) {
        eprintln!("[{category}] {message}");
    }
    let tag = match level {
        Level::Info => "INFO",
        Level::Warn => "WARN",
        Level::Error => "ERROR",
    };
    let line = sanitize(&format!("{} {tag} [{category}] {message}\n", timestamp()));
    append(&line);
}

pub fn info(category: &str, message: &str) {
    log(Level::Info, category, message, false)
}
pub fn warn(category: &str, message: &str) {
    log(Level::Warn, category, message, false)
}
pub fn error(category: &str, message: &str) {
    log(Level::Error, category, message, false)
}
pub fn verbose(level: Level, category: &str, message: &str) {
    log(level, category, message, true)
}

/// UTC в формате ISO 8601 с миллисекундами (без внешних зависимостей).
fn timestamp() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let (secs, ms) = (d.as_secs() as i64, d.subsec_millis());
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // гражданская дата по дню от эпохи (алгоритм Говарда Хиннанта)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{ms:03}Z", rem / 3600, rem / 60 % 60, rem % 60)
}

/// Адреса http(s) сокращаются до схемы и хоста: токены и ключи бывают и в пути, и в запросе.
pub fn sanitize(s: &str) -> String {
    let stop_host = |c: char| matches!(c, '/' | '?' | '#') || c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | ')' | ']');
    let stop_rest = |c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | ')' | ']');
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let rest = &s[i..];
        let scheme = if rest.starts_with("https://") { 8 } else if rest.starts_with("http://") { 7 } else { 0 };
        if scheme > 0 {
            let after = &rest[scheme..];
            let host_len = after.find(stop_host).unwrap_or(after.len());
            if host_len > 0 {
                let tail = &after[host_len..];
                let tail_len = tail.find(stop_rest).unwrap_or(tail.len());
                // Учётные данные (user:password@) в журнал не попадают: оставляем только хост и порт.
                let host = &after[..host_len];
                let host = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
                out.push_str(&rest[..scheme]);
                out.push_str(host);
                out.push_str("/…");
                i += scheme + host_len + tail_len;
                continue;
            }
        }
        let c = rest.chars().next().unwrap();
        out.push(c);
        i += c.len_utf8();
    }
    out
}

fn append(text: &str) {
    let _g = FILE_LOCK.lock();
    let dir = folder();
    let _ = fs::create_dir_all(&dir);
    let file = dir.join("lampa.log");
    if fs::metadata(&file).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        rotate(&dir);
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&file) {
        let _ = f.write_all(text.as_bytes());
    }
}

fn rotate(dir: &PathBuf) {
    for i in (1..KEEP_FILES).rev() {
        let (from, to) = (dir.join(format!("lampa.{i}.log")), dir.join(format!("lampa.{}.log", i + 1)));
        let _ = fs::remove_file(&to);
        if from.exists() {
            let _ = fs::rename(&from, &to);
        }
    }
    let first = dir.join("lampa.1.log");
    let _ = fs::remove_file(&first);
    let _ = fs::rename(dir.join("lampa.log"), &first);
    let _ = fs::remove_file(dir.join(format!("lampa.{}.log", KEEP_FILES + 1)));
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn shortens_urls() {
        assert_eq!(sanitize("open https://host.example:8443/path/x?key=SECRET end"), "open https://host.example:8443/… end");
        assert_eq!(sanitize("http://10.0.0.5:9118/lampa?token=1"), "http://10.0.0.5:9118/…");
        assert_eq!(sanitize("(https://a.b/c) и 'http://d.e/f'"), "(https://a.b/…) и 'http://d.e/…'");
    }

    #[test]
    fn hides_query_without_path_and_credentials() {
        assert_eq!(sanitize("GET https://host.example?token=SECRET done"), "GET https://host.example/… done");
        assert_eq!(sanitize("https://host.example#key=SECRET"), "https://host.example/…");
        assert_eq!(sanitize("https://user:pa55@host.example:8443/path?x=1"), "https://host.example:8443/…");
        assert_eq!(sanitize("http://user@10.0.0.5?k=v"), "http://10.0.0.5/…");
    }

    #[test]
    fn leaves_other_text() {
        assert_eq!(sanitize("без адресов: привет"), "без адресов: привет");
    }
}
