//! Резервная копия настроек: один JSON-файл, общий формат с macOS (Sources/LampyrisCore/Backup.swift).
//! Содержит адрес сервера, историю адресов, переключатели, mpv.conf и данные страницы Lampa (localStorage:
//! вход, закладки, плагины, настройки Lampa). Положение окна не входит: оно зависит от экрана.

use crate::i18n::tr;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

pub const FORMAT: &str = "lampyris-backup";
pub const VERSION: u64 = 1;
pub const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_LAMPA_BYTES: usize = 16 * 1024 * 1024;
const MAX_LAMPA_ITEMS: usize = 20_000;
const MAX_HISTORY: usize = 10;
const MAX_MPV_CONF: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Lampa {
    pub origin: String,
    pub items: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Backup {
    pub server_url: Option<String>,
    pub history: Vec<String>,
    pub verbose_log: Option<bool>,
    pub auto_update_check: Option<bool>,
    pub mpv_conf: Option<String>,
    pub lampa: Option<Lampa>,
}

/// JS для чтения localStorage страницы: объект {origin, items}.
pub const COLLECT_SCRIPT: &str =
    "(function(){var o={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);o[k]=localStorage.getItem(k)}return {origin:location.origin,items:o}})()";

fn normalized_server(s: &str) -> Option<String> {
    if s.trim().len() > 2048 {
        return None;
    }
    crate::settings::parse_server(s).map(|u| u.to_string())
}

/// Источник вида схема://хост[:порт] без пути, имени и запроса.
pub fn normalized_origin(s: &str) -> Option<String> {
    let u = url::Url::parse(s).ok()?;
    let clean = matches!(u.scheme(), "http" | "https") && u.host_str().is_some() && u.username().is_empty() && u.password().is_none()
        && u.query().is_none() && u.fragment().is_none() && (u.path().is_empty() || u.path() == "/");
    clean.then(|| u.origin().ascii_serialization())
}

impl Backup {
    pub fn to_json(&self, app: &str, platform: &str, created_at: &str) -> String {
        let mut root = Map::new();
        root.insert("format".into(), json!(FORMAT));
        root.insert("version".into(), json!(VERSION));
        root.insert("app".into(), json!(app));
        root.insert("platform".into(), json!(platform));
        root.insert("createdAt".into(), json!(created_at));
        if let Some(s) = &self.server_url { root.insert("serverURL".into(), json!(s)); }
        root.insert("serverHistory".into(), json!(self.history));
        if let Some(b) = self.verbose_log { root.insert("verboseLog".into(), json!(b)); }
        if let Some(b) = self.auto_update_check { root.insert("autoUpdateCheck".into(), json!(b)); }
        if let Some(c) = &self.mpv_conf { root.insert("mpvConf".into(), json!(c)); }
        if let Some(l) = &self.lampa { root.insert("lampa".into(), json!({"origin": l.origin, "localStorage": l.items})); }
        serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default()
    }

    /// Разбор файла с проверкой: неизвестные поля пропускаются, значения проверяются и ограничиваются по размеру.
    pub fn parse(bytes: &[u8]) -> Result<Backup, String> {
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err(tr("файл слишком большой для резервной копии", "the file is too large for a backup").into());
        }
        let text = std::str::from_utf8(bytes).map_err(|_| tr("это не файл резервной копии Lampyris", "this is not a Lampyris backup file").to_string())?;
        let root: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| tr("это не файл резервной копии Lampyris", "this is not a Lampyris backup file").to_string())?;
        if root.get("format").and_then(Value::as_str) != Some(FORMAT) {
            return Err(tr("это не файл резервной копии Lampyris", "this is not a Lampyris backup file").into());
        }
        let v = root.get("version").and_then(Value::as_u64).filter(|v| *v >= 1).ok_or(tr("в файле не указана версия формата", "the file does not specify a format version"))?;
        if v > VERSION {
            return Err(tr("файл создан более новой версией Lampyris: обновите приложение", "the file was created by a newer version of Lampyris: update the app").into());
        }
        let mut b = Backup::default();
        if let Some(s) = root.get("serverURL").and_then(Value::as_str).filter(|s| !s.is_empty()) {
            b.server_url = Some(normalized_server(s).ok_or(tr("в файле неверный адрес сервера", "the file has an invalid server address"))?);
        }
        if let Some(list) = root.get("serverHistory").and_then(Value::as_array) {
            for item in list.iter().take(MAX_HISTORY) {
                if let Some(n) = item.as_str().and_then(normalized_server) {
                    if !b.history.contains(&n) { b.history.push(n); }
                }
            }
        }
        b.verbose_log = root.get("verboseLog").and_then(Value::as_bool);
        b.auto_update_check = root.get("autoUpdateCheck").and_then(Value::as_bool);
        if let Some(conf) = root.get("mpvConf").and_then(Value::as_str) {
            if conf.len() > MAX_MPV_CONF {
                return Err(tr("mpv.conf в файле слишком большой", "mpv.conf in the file is too large").into());
            }
            b.mpv_conf = Some(conf.to_string());
        }
        if let Some(l) = root.get("lampa") {
            if let (Some(origin), Some(items)) = (l.get("origin").and_then(Value::as_str), l.get("localStorage").and_then(Value::as_object)) {
                let origin = normalized_origin(origin).ok_or(tr("в файле неверный источник данных Lampa", "the file has an invalid Lampa data origin"))?;
                if items.len() > MAX_LAMPA_ITEMS {
                    return Err(tr("в файле слишком много записей Lampa", "the file has too many Lampa entries").into());
                }
                let mut map = BTreeMap::new();
                let mut total = 0usize;
                for (k, val) in items {
                    let val = val.as_str().filter(|_| k.len() <= 4096).ok_or(tr("в данных Lampa есть запись неверного вида", "the Lampa data has a malformed entry"))?;
                    total += k.len() + val.len();
                    map.insert(k.clone(), val.to_string());
                }
                if total > MAX_LAMPA_BYTES {
                    return Err(tr("данные Lampa в файле слишком велики", "the Lampa data in the file is too large").into());
                }
                b.lampa = Some(Lampa { origin, items: map });
            }
        }
        Ok(b)
    }

    /// JS для восстановления: заменяет localStorage, только если страница открыта с нужного источника. Возвращает "ok" или "origin".
    pub fn restore_script(&self) -> Option<String> {
        let l = self.lampa.as_ref()?;
        let data = serde_json::to_string(&l.items).ok()?;
        let lit = |s: &str| serde_json::to_string(s).map(|t| t.replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029"));
        Some(format!(
            "(function(o,d){{if(location.origin!==o)return 'origin';d=JSON.parse(d);localStorage.clear();for(var k in d)localStorage.setItem(k,d[k]);return 'ok'}})({},{})",
            lit(&l.origin).ok()?, lit(&data).ok()?
        ))
    }
}

/// Разбор ответа `COLLECT_SCRIPT` (JSON объекта {origin, items}).
pub fn parse_collected(json_text: &str) -> Option<Lampa> {
    let v: Value = serde_json::from_str(json_text).ok()?;
    let origin = normalized_origin(v.get("origin")?.as_str()?)?;
    let mut items = BTreeMap::new();
    for (k, val) in v.get("items")?.as_object()? {
        items.insert(k.clone(), val.as_str()?.to_string());
    }
    Some(Lampa { origin, items })
}

/// Дата и время UTC в виде 2026-10-15T12:34:56Z (без внешних зависимостей).
pub fn iso_utc(secs: u64) -> String {
    let (days, rem) = ((secs / 86400) as i64, secs % 86400);
    // Гражданская дата по числу дней от 1970-01-01 (алгоритм Говарда Хиннанта).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Backup {
        Backup {
            server_url: Some("http://192.0.2.1:9118/".into()),
            history: vec!["http://192.0.2.1:9118/".into(), "https://example.org/lampa".into()],
            verbose_log: Some(true),
            auto_update_check: Some(false),
            mpv_conf: Some("hwdec=auto\n[bright]\nbrightness=20\n".into()),
            lampa: Some(Lampa {
                origin: "http://192.0.2.1:9118".into(),
                items: BTreeMap::from([("a".into(), "1".into()), ("plugins".into(), "[{\"url\":\"x\"}]".into()), ("рус".into(), "зн\u{2028}ач".into())]),
            }),
        }
    }

    #[test]
    fn round_trip() {
        let text = sample().to_json("0.1.5", "windows", "2026-10-15T00:00:00Z");
        assert_eq!(Backup::parse(text.as_bytes()).unwrap(), sample());
    }

    #[test]
    fn rejects_foreign_files() {
        for t in ["", "не json", "[]", r#"{"format":"другой","version":1}"#, r#"{"format":"lampyris-backup"}"#, r#"{"format":"lampyris-backup","version":99}"#] {
            assert!(Backup::parse(t.as_bytes()).is_err(), "{t}");
        }
        assert!(Backup::parse(&[0xff, 0xfe, 0x00]).is_err());
    }

    #[test]
    fn validates_values() {
        let head = r#"{"format":"lampyris-backup","version":1,"#;
        for tail in [
            r#""serverURL":"ftp://h"}"#,
            r#""lampa":{"origin":"javascript:1","localStorage":{}}}"#,
            r#""lampa":{"origin":"http://h/путь","localStorage":{}}}"#,
            r#""lampa":{"origin":"http://h","localStorage":{"k":5}}}"#,
        ] {
            assert!(Backup::parse(format!("{head}{tail}").as_bytes()).is_err(), "{tail}");
        }
        let big = "a".repeat(MAX_MPV_CONF + 1);
        assert!(Backup::parse(format!(r#"{head}"mpvConf":"{big}"}}"#).as_bytes()).is_err());
        let ok = format!("\u{feff}{head}\"serverURL\":\"192.0.2.1:9118\",\"новое\":1}}");
        assert_eq!(Backup::parse(ok.as_bytes()).unwrap().server_url.as_deref(), Some("http://192.0.2.1:9118/"));
    }

    #[test]
    fn history_is_limited_and_deduplicated() {
        let items: Vec<String> = (0..20).map(|i| format!("\"h{}.example.org\"", i % 3)).chain(["5".into(), "\"\"".into()]).collect();
        let text = format!(r#"{{"format":"lampyris-backup","version":1,"serverHistory":[{}]}}"#, items.join(","));
        assert_eq!(Backup::parse(text.as_bytes()).unwrap().history, ["http://h0.example.org/", "http://h1.example.org/", "http://h2.example.org/"]);
    }

    #[test]
    fn restore_script_is_a_literal() {
        let s = sample().restore_script().unwrap();
        assert!(s.contains("location.origin!==o") && !s.contains('\u{2028}'));
        assert!(Backup::default().restore_script().is_none());
    }

    #[test]
    fn collected_answer() {
        let l = parse_collected(r#"{"origin":"http://192.0.2.1:9118","items":{"k":"v"}}"#).unwrap();
        assert_eq!((l.origin.as_str(), l.items["k"].as_str()), ("http://192.0.2.1:9118", "v"));
        assert!(parse_collected(r#"{"origin":"null","items":{}}"#).is_none());
        assert!(parse_collected(r#"{"origin":"http://h","items":{"k":1}}"#).is_none());
        assert!(parse_collected("мусор").is_none());
    }

    #[test]
    fn iso_dates() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(1_781_000_000), "2026-06-09T10:13:20Z");
        assert_eq!(iso_utc(951_782_400), "2000-02-29T00:00:00Z");
    }
}
