//! Мост JS ↔ mpv. Страница вызывает `webkit.messageHandlers.mpv.postMessage({m, a})` (шим поверх
//! `window.ipc`), ответ приходит промисом; события mpv уходят в `window.__mpvEvent(...)`.
//! Порт `MpvBridge.swift`: страница и плагины недоверенные, поэтому принимается только то,
//! что нужно плееру, и только от доверенного источника.

use crate::audio_fx;
use crate::i18n::tr;
use crate::config::{self, MpvConfig};
use crate::http;
use crate::log;
use crate::player::Player;
use crate::smtc::NowPlaying;
use crate::{settings, UserEvent};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tao::event_loop::EventLoopProxy;

const ALLOWED_COMMANDS: &[&str] = &["seek", "stop"];
const ALLOWED_SET_PROPERTIES: &[&str] = &[
    "aid", "sid", "vid", "mute", "pause", "speed", "volume", "audio-delay", "sub-delay", "sub-scale", "sub-pos",
    "sub-color", "sub-border-style", "sub-back-color", "sub-border-size", "sub-shadow-offset", "sub-font", "sub-margin-y",
    "gamma", "brightness", "contrast", "saturation",
];
/// Видео и звук, которые приложение умеет открывать с диска (общий список для диалога, перетаскивания и моста).
pub const LOCAL_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "m4v", "mov", "avi", "webm", "ts", "m2ts", "mts", "mpg", "mpeg", "wmv", "flv", "ogv", "3gp", "mp3", "m4a", "aac", "flac", "ogg",
    "opus", "wav", "wma", "ac3", "dts", "mka",
];
const ALLOWED_OPEN_OPTIONS: &[&str] = &["sid", "demuxer-readahead-secs", "demuxer-max-bytes"];
/// Свойства, которые странице разрешено читать (всё, что использует mpvTube.js и playbackCover.js).
const ALLOWED_GET_PROPERTIES: &[&str] = &[
    "pause", "time-pos", "duration", "speed", "volume", "audio-delay", "sub-delay", "track-list", "video-params",
    "audio-params", "container-fps", "estimated-vf-fps", "video-bitrate", "audio-bitrate", "video-codec",
    "audio-codec-name", "hwdec-current", "frame-drop-count", "decoder-frame-drop-count", "vo-delayed-frame-count",
    "avsync", "demuxer-cache-state", "demuxer-cache-time", "gamma", "brightness", "contrast", "saturation",
    "cache-speed", "chapter-list",
];
/// Потолок размера ответов внешних сервисов (TheIntroDB, субтитры).
const MAX_RESPONSE_BYTES: usize = 2_000_000;
const MAX_SUBTITLE_BYTES: usize = 3_000_000;

type Reply = Box<dyn FnOnce(Result<Value, String>) + Send + 'static>;

#[derive(Clone)]
pub struct Bridge {
    player: Arc<Player>,
    proxy: EventLoopProxy<UserEvent>,
    now_playing: Option<Arc<NowPlaying>>,
    /// Файлы, выбранные пользователем в самом приложении (диалог, перетаскивание, аргумент запуска): только их можно открыть через `file://`.
    local_files: Arc<Mutex<HashSet<String>>>,
}

/// Ключ для сравнения путей: Windows не различает регистр.
fn path_key(p: &std::path::Path) -> String {
    p.to_string_lossy().to_lowercase()
}

/// Файл с поддерживаемым расширением.
pub fn is_local_media(p: &std::path::Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| LOCAL_EXTENSIONS.contains(&e.to_lowercase().as_str()))
}

/// Источник страницы в том виде, в каком его видит `location.origin` в JS (порт по умолчанию опускается); None не для http(s).
pub fn page_origin(u: &url::Url) -> Option<String> {
    matches!(u.scheme(), "http" | "https").then(|| u.origin().ascii_serialization()).filter(|o| o != "null")
}

/// «схема://хост:порт» адреса; None для внутренних (about:, data:).
pub fn origin_key(u: &url::Url) -> Option<String> {
    if !matches!(u.scheme(), "http" | "https") { return None; }
    let host = u.host_str()?.to_lowercase();
    Some(format!("{}://{}:{}", u.scheme().to_lowercase(), host, u.port_or_known_default()?))
}

fn is_imdb_id(s: &str) -> bool {
    s.len() >= 8 && s.len() <= 12 && s.starts_with("tt") && s[2..].chars().all(|c| c.is_ascii_digit()) && s.len() - 2 >= 6
}

/// Значение опции loadfile: буквы, цифры, точка (иначе попадёт в строку «опция=значение,…»).
fn option_value(v: &Value) -> Option<String> {
    let s = match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return None,
    };
    (!s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')).then_some(s)
}

fn int_arg(args: &[Value], i: usize) -> Option<i64> {
    args.get(i).and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|d| d as i64)))
}

fn error_json(msg: &str) -> String {
    json!({ "error": msg.replace('"', "'") }).to_string()
}

impl Bridge {
    pub fn new(player: Arc<Player>, proxy: EventLoopProxy<UserEvent>, now_playing: Option<Arc<NowPlaying>>) -> Bridge {
        Bridge { player, proxy, now_playing, local_files: Arc::new(Mutex::new(HashSet::new())) }
    }

    /// Забывает пути (страница не приняла список или это был чужой источник).
    pub fn forget_local(&self, paths: &[PathBuf]) {
        let mut set = self.local_files.lock().unwrap();
        for p in paths {
            set.remove(&path_key(p));
        }
    }

    /// Запоминает выбранные файлы и возвращает скрипт для страницы: плейлист Lampa. None, если подходящих файлов нет.
    /// Скрипт сам сверяет `location.origin` с `origin` (источник страницы, на которую приложение собирается его отправить):
    /// страница могла уйти на другой источник между проверкой и выполнением, а чужая страница пути видеть не должна.
    pub fn local_script(&self, paths: &[PathBuf], origin: &str) -> Option<String> {
        let files: Vec<&PathBuf> = paths.iter().filter(|p| p.is_file() && is_local_media(p)).collect();
        if files.is_empty() {
            return None;
        }
        let items: Vec<Value> = files
            .iter()
            .filter_map(|p| {
                let url = url::Url::from_file_path(p).ok()?;
                Some(json!({"title": p.file_stem()?.to_string_lossy(), "url": url.as_str()}))
            })
            .collect();
        let mut set = self.local_files.lock().unwrap();
        for p in &files {
            set.insert(path_key(p));
        }
        Some(format!(
            "(function(){{if(location.origin!=={})return 'origin';return window.__lampyrisOpenLocal ? window.__lampyrisOpenLocal({}) : 'no-lampa'}})()",
            Value::String(origin.to_string()), Value::Array(items)
        ))
    }

    /// Страница перезагружена или заменена: плеер, которым она управляла, останавливаем.
    pub fn page_did_reset(&self) {
        self.player.page_did_reset();
        self.local_files.lock().unwrap().clear();
        let _ = self.proxy.send_event(UserEvent::DisplayRate(None));
        if let Some(np) = &self.now_playing {
            np.clear();
        }
    }

    fn reply_fn(&self, id: u64) -> Reply {
        let proxy = self.proxy.clone();
        Box::new(move |r| {
            let js = match r {
                Ok(v) => format!("window.__mpvReply({id},true,{v})"),
                Err(e) => format!("window.__mpvReply({id},false,{})", Value::String(e)),
            };
            let _ = proxy.send_event(UserEvent::Js(js));
        })
    }

    /// Сообщение от страницы. `trusted` и `origin` определяет вызывающий по источнику отправителя.
    pub fn handle(&self, trusted: bool, origin: &str, body: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(body) else { return };
        let Some(id) = msg["id"].as_u64() else { return };
        let reply = self.reply_fn(id);
        if !trusted {
            log::warn("mpv", &format!("сообщение отклонено: недоверенный источник {origin}"));
            return reply(Err("forbidden origin".into()));
        }
        let Some(method) = msg["m"].as_str() else { return reply(Err("bad message".into())) };
        let args: Vec<Value> = msg["a"].as_array().cloned().unwrap_or_default();
        self.dispatch(method, &args, reply);
    }

    fn dispatch(&self, method: &str, args: &[Value], reply: Reply) {
        let player = &self.player;
        match method {
            "available" => reply(Ok(json!(true))),
            "open" => {
                let Some(url) = args.first().and_then(|v| v.as_str()) else { return reply(Err("bad url".into())) };
                let mut url = url.to_string();
                match url::Url::parse(&url) {
                    Ok(u) if matches!(u.scheme(), "http" | "https") => {}
                    Ok(u) if u.scheme() == "file" => {
                        // Страница и плагины не выбирают файлы: открывается только то, что пользователь выбрал в приложении.
                        let allowed = u.to_file_path().ok().filter(|p| self.local_files.lock().unwrap().contains(&path_key(p)));
                        match allowed {
                            Some(p) => url = p.to_string_lossy().into_owned(),
                            None => {
                                log::warn("mpv", "локальный файл отклонён: не выбран в приложении");
                                return reply(Err("file not allowed".into()));
                            }
                        }
                    }
                    _ => return reply(Err("bad url".into())),
                }
                let url = url.as_str();
                let empty = json!({});
                let o = args.get(1).filter(|v| v.is_object()).unwrap_or(&empty);
                if let Some(v) = o["volume"].as_f64() {
                    player.set("volume", &(v as i64).to_string());
                }
                let mut opts: Vec<(String, String)> = Vec::new();
                if let Some(start) = o["start"].as_f64().filter(|s| *s > 0.0) {
                    opts.push(("start".into(), start.to_string()));
                }
                if let Some(map) = o["mpvOptions"].as_object() {
                    for (k, v) in map {
                        match (ALLOWED_OPEN_OPTIONS.contains(&k.as_str()), option_value(v)) {
                            (true, Some(val)) => opts.push((k.clone(), val)),
                            _ => log::warn("mpv", &format!("опция открытия отклонена: {k}")),
                        }
                    }
                }
                let profile = o["profile"].as_str().filter(|p| !p.is_empty());
                player.open(url, &opts, profile);
                reply(Ok(json!({"ok": true})));
            }
            "command" => {
                let cmd: Vec<String> = args.first().and_then(|v| v.as_array()).map(|a| a.iter().map(|x| x.as_str().map(String::from).unwrap_or_else(|| x.to_string())).collect()).unwrap_or_default();
                match cmd.first() {
                    Some(name) if ALLOWED_COMMANDS.contains(&name.as_str()) => {
                        let refs: Vec<&str> = cmd.iter().map(String::as_str).collect();
                        player.command(&refs);
                        reply(Ok(json!(true)));
                    }
                    other => {
                        log::warn("mpv", &format!("команда отклонена: {}", other.map(String::as_str).unwrap_or("")));
                        reply(Err("command not allowed".into()));
                    }
                }
            }
            "get" => match args.first().and_then(|v| v.as_str()) {
                Some(name) if ALLOWED_GET_PROPERTIES.contains(&name) => reply(Ok(player.get(name).unwrap_or(Value::Null))),
                other => {
                    log::warn("mpv", &format!("чтение свойства отклонено: {}", other.unwrap_or("?")));
                    reply(Err("property not readable".into()));
                }
            },
            "set" => {
                let name = args.first().and_then(|v| v.as_str());
                match (args.len() == 2, name) {
                    (true, Some(name)) if ALLOWED_SET_PROPERTIES.contains(&name) => {
                        // Булевы значения JS заранее превращает в "yes"/"no".
                        let value = match &args[1] {
                            Value::String(s) => s.clone(),
                            Value::Number(n) => n.to_string(),
                            Value::Bool(b) => if *b { "yes" } else { "no" }.into(),
                            _ => return reply(Err("bad value".into())),
                        };
                        reply(Ok(json!(player.set(name, &value))));
                    }
                    _ => {
                        log::warn("mpv", &format!("свойство отклонено: {}", name.unwrap_or("?")));
                        reply(Err("property not allowed".into()));
                    }
                }
            }
            "subsSearch" => {
                // Поиск субтитров: Stremio OpenSubtitles v3, без ключа. Нужен IMDb-id (tt…), для серии ещё сезон и номер.
                let Some(imdb) = args.first().and_then(|v| v.as_str()).filter(|s| is_imdb_id(s)).map(String::from) else {
                    return reply(Err("bad imdb".into()));
                };
                let (season, episode) = (int_arg(args, 1).unwrap_or(0), int_arg(args, 2).unwrap_or(0));
                std::thread::spawn(move || reply(Ok(Value::String(search_subtitles(&imdb, season, episode)))));
            }
            "subsLoad" => {
                let (Some(url), Some(title), Some(lang)) = (args.first().and_then(|v| v.as_str()), args.get(1).and_then(|v| v.as_str()), args.get(2).and_then(|v| v.as_str())) else {
                    return reply(Err("bad args".into()));
                };
                let (url, title, lang, player) = (url.to_string(), title.to_string(), lang.to_string(), player.clone());
                std::thread::spawn(move || reply(Ok(load_subtitle(&player, &url, &title, &lang))));
            }
            "tidbMedia" => {
                // Запрос к TheIntroDB делает приложение (без ключа: чтение таймкодов авторизации не требует).
                let Some(tmdb) = int_arg(args, 0).filter(|t| *t > 0) else { return reply(Err("bad id".into())) };
                let (season, episode) = (int_arg(args, 1), int_arg(args, 2));
                std::thread::spawn(move || reply(Ok(Value::String(fetch_intro_db(tmdb, season, episode)))));
            }
            "nowPlaying" => {
                let Some(d) = args.first() else { return reply(Err("bad args".into())) };
                let Some(title) = d["title"].as_str() else { return reply(Err("bad args".into())) };
                if let Some(np) = &self.now_playing {
                    np.set(title, d["subtitle"].as_str().unwrap_or(""), d["duration"].as_f64().unwrap_or(0.0),
                           d["canNext"].as_bool().unwrap_or(false), d["canPrev"].as_bool().unwrap_or(false), d["artwork"].as_str());
                }
                reply(Ok(json!(true)));
            }
            "nowPlayingClear" => {
                if let Some(np) = &self.now_playing {
                    np.clear();
                }
                reply(Ok(json!(true)));
            }
            "screenshot" => reply(Ok(player.screenshot())),
            "profile" => {
                let name = args.first().and_then(|v| v.as_str()).filter(|s| !s.is_empty());
                reply(Ok(json!(player.apply_config(name).into_iter().collect::<Vec<_>>())));
            }
            "getConfig" => {
                let cfg = MpvConfig::load();
                reply(Ok(json!({"path": config::file_path().to_string_lossy(), "text": config::read_text(), "profiles": cfg.profile_names})));
            }
            "setConfig" => {
                let Some(text) = args.first().and_then(|v| v.as_str()) else { return reply(Err("no text".into())) };
                if text.len() > config::MAX_BYTES {
                    return reply(Ok(json!({"ok": false, "error": tr("файл больше 64 КиБ", "the file is larger than 64 KiB")})));
                }
                if !config::is_safe_for_page(text) {
                    return reply(Ok(json!({"ok": false, "error": tr("Запись из страницы разрешена только для безопасных параметров картинки и звука. Другие опции измените в файле mpv.conf.", "The page can save only safe picture and sound settings. Edit other options in the mpv.conf file.")})));
                }
                if let Err(e) = config::write_text(text) {
                    return reply(Ok(json!({"ok": false, "error": e.to_string()})));
                }
                let cfg = config::merged(text);
                let ignored: Vec<Value> = cfg.ignored.iter().map(|i| json!({"line": i.line, "text": i.text, "reason": i.reason})).collect();
                reply(Ok(json!({"ok": true, "profiles": cfg.profile_names, "ignored": ignored})));
            }
            "audioFx" => {
                // Эквалайзер, речь, ночной режим: страница присылает числа, цепочку фильтров собирает приложение.
                let Some(d) = args.first().filter(|v| v.is_object()) else { return reply(Err("bad args".into())) };
                let bands: Vec<i64> = d["bands"].as_array().map(|a| a.iter().take(audio_fx::BAND_FREQUENCIES.len()).map(|v| v.as_f64().unwrap_or(0.0) as i64).collect()).unwrap_or_default();
                let dialogue = d["dialogue"].as_f64().unwrap_or(0.0) as i64;
                let graph = audio_fx::graph(&bands, dialogue, d["night"].as_bool().unwrap_or(false));
                for c in audio_fx::commands(graph.as_deref()) {
                    let refs: Vec<&str> = c.iter().map(String::as_str).collect();
                    // Отказ (снять фильтр, которого нет) ошибкой не считается: событие command-failed не отправляем.
                    let _ = player.mpv.command(&refs);
                }
                reply(Ok(json!(graph.is_some())));
            }
            "displayRate" => {
                // Частота кадров видео (10…120) или 0: страница не задаёт режим экрана, подбор делает приложение.
                let fps = args.first().and_then(|v| v.as_f64()).unwrap_or(-1.0);
                if !(fps == 0.0 || (10.0..=120.0).contains(&fps)) {
                    return reply(Err("bad fps".into()));
                }
                let _ = self.proxy.send_event(UserEvent::DisplayRate(if fps > 0.0 { Some(fps) } else { None }));
                reply(Ok(json!(true)));
            }
            "stop" => {
                player.stop();
                let _ = self.proxy.send_event(UserEvent::DisplayRate(None));
                reply(Ok(json!(true)));
            }
            other => reply(Err(format!("unknown method {other}"))),
        }
    }
}

/// Возвращает JSON-строку ответа сервиса (или {"error": …}).
fn fetch_intro_db(tmdb: i64, season: Option<i64>, episode: Option<i64>) -> String {
    let mut url = format!("https://api.theintrodb.org/v3/media?tmdb_id={tmdb}");
    if let (Some(s), Some(e)) = (season, episode) {
        if s > 0 && e > 0 {
            url.push_str(&format!("&season={s}&episode={e}"));
        }
    }
    match http::get(&url, 6, MAX_RESPONSE_BYTES, true) {
        Ok(body) => String::from_utf8(body).unwrap_or_else(|_| error_json("encoding")),
        Err(e) => error_json(&e),
    }
}

/// Возвращает JSON-строку ответа аддона (или {"error": …}).
fn search_subtitles(imdb: &str, season: i64, episode: i64) -> String {
    let path = if season > 0 && episode > 0 { format!("series/{imdb}:{season}:{episode}") } else { format!("movie/{imdb}") };
    match http::get(&format!("https://opensubtitles-v3.strem.io/subtitles/{path}.json"), 10, MAX_RESPONSE_BYTES, true) {
        Ok(body) => String::from_utf8(body).unwrap_or_else(|_| error_json("encoding")),
        Err(e) => error_json(&e),
    }
}

/// Скачивает субтитры (только https с *.strem.io, до 3 МБ) в кэш и подключает к mpv.
fn load_subtitle(player: &Player, url_str: &str, title: &str, lang: &str) -> Value {
    let Ok(url) = url::Url::parse(url_str) else { return json!({"ok": false, "error": tr("недопустимый адрес", "invalid address")}) };
    if !http::subtitle_url(&url) {
        return json!({"ok": false, "error": tr("недопустимый адрес", "invalid address")});
    }
    let generation = player.generation();
    let data = match http::get_media(url.as_str(), 15, MAX_SUBTITLE_BYTES, http::subtitle_url) {
        Ok(d) if !d.is_empty() => d,
        _ => return json!({"ok": false, "error": tr("не удалось скачать", "could not download")}),
    };
    // За время скачивания могли открыть другое видео: чужие субтитры не записываем и не подключаем.
    if generation != player.generation() {
        return json!({"ok": false, "error": tr("видео уже сменилось", "the video has already changed")});
    }
    let dir = settings::local_dir().join("Cache").join("subs");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return json!({"ok": false, "error": e.to_string()});
    }
    // Уникальное имя на каждую загрузку: разные адреса с одинаковым концом пути и запоздавшие запросы не перезаписывают друг друга.
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let file = dir.join(format!("sub-{}-{nanos}-{}.srt", std::process::id(), COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    if let Err(e) = std::fs::write(&file, data) {
        return json!({"ok": false, "error": e.to_string()});
    }
    let clean_title: String = title.chars().filter(|c| *c != '\n' && *c != '\r').take(120).collect();
    let clean_lang: String = lang.chars().filter(|c| c.is_alphabetic()).take(3).collect();
    if !player.add_subtitle(&file.to_string_lossy(), &clean_title, &clean_lang) {
        let _ = std::fs::remove_file(&file);
        return json!({"ok": false, "error": tr("mpv не принял файл", "mpv did not accept the file")});
    }
    json!({"ok": true})
}

/// Удаляет из кэша субтитров файлы старше недели (при запуске).
pub fn clean_subtitle_cache() {
    let dir = settings::local_dir().join("Cache").join("subs");
    let week = std::time::Duration::from_secs(7 * 24 * 3600);
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|age| age > week).unwrap_or(false);
            if old {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imdb_ids() {
        assert!(is_imdb_id("tt1234567"));
        assert!(is_imdb_id("tt0123456789"));
        assert!(!is_imdb_id("tt123"));
        assert!(!is_imdb_id("xx1234567"));
        assert!(!is_imdb_id("tt12345a7"));
    }

    #[test]
    fn option_values() {
        assert_eq!(option_value(&json!("12.5")).as_deref(), Some("12.5"));
        assert_eq!(option_value(&json!(1000)).as_deref(), Some("1000"));
        assert!(option_value(&json!("1,start=5")).is_none());
        assert!(option_value(&json!("")).is_none());
        assert!(option_value(&json!(true)).is_none());
    }

    #[test]
    fn page_origins() {
        let o = |s: &str| page_origin(&url::Url::parse(s).unwrap());
        assert_eq!(o("https://Example.com/x").as_deref(), Some("https://example.com"));
        assert_eq!(o("https://example.com:443/").as_deref(), Some("https://example.com"));
        assert_eq!(o("http://192.0.2.1:9118/p?q=1").as_deref(), Some("http://192.0.2.1:9118"));
        assert!(o("file:///tmp/x").is_none() && o("about:blank").is_none() && o("data:text/html,x").is_none());
    }

    #[test]
    fn origins() {
        let k = |s: &str| origin_key(&url::Url::parse(s).unwrap());
        assert_eq!(k("http://Example.com/x").as_deref(), Some("http://example.com:80"));
        assert_eq!(k("https://a.b:8443/").as_deref(), Some("https://a.b:8443"));
        assert!(k("data:text/html,x").is_none());
    }
}
