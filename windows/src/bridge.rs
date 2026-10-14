//! Мост JS ↔ mpv. Страница вызывает `webkit.messageHandlers.mpv.postMessage({m, a})` (шим поверх
//! `window.ipc`), ответ приходит промисом; события mpv уходят в `window.__mpvEvent(...)`.
//! Порт `MpvBridge.swift`: страница и плагины недоверенные, поэтому принимается только то,
//! что нужно плееру, и только от доверенного источника.

use crate::config::{self, MpvConfig};
use crate::http;
use crate::log;
use crate::player::Player;
use crate::smtc::NowPlaying;
use crate::{settings, UserEvent};
use serde_json::{json, Value};
use std::sync::Arc;
use tao::event_loop::EventLoopProxy;

const ALLOWED_COMMANDS: &[&str] = &["seek", "stop"];
const ALLOWED_SET_PROPERTIES: &[&str] = &[
    "aid", "sid", "vid", "mute", "pause", "speed", "volume", "audio-delay", "sub-delay", "sub-scale", "sub-pos",
    "sub-color", "sub-border-style", "sub-back-color",
];
const ALLOWED_OPEN_OPTIONS: &[&str] = &["sid", "demuxer-readahead-secs", "demuxer-max-bytes"];
/// Свойства, которые странице разрешено читать (всё, что использует mpvTube.js и playbackCover.js).
const ALLOWED_GET_PROPERTIES: &[&str] = &[
    "pause", "time-pos", "duration", "speed", "volume", "audio-delay", "sub-delay", "track-list", "video-params",
    "audio-params", "container-fps", "estimated-vf-fps", "video-bitrate", "audio-bitrate", "video-codec",
    "audio-codec-name", "hwdec-current", "frame-drop-count", "decoder-frame-drop-count", "vo-delayed-frame-count",
    "avsync", "demuxer-cache-state", "demuxer-cache-time",
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
}

/// «схема://хост:порт» адреса; None для внутренних (about:, data:).
pub fn origin_key(u: &url::Url) -> Option<String> {
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
        Bridge { player, proxy, now_playing }
    }

    /// Страница перезагружена или заменена: плеер, которым она управляла, останавливаем.
    pub fn page_did_reset(&self) {
        self.player.page_did_reset();
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
                match url::Url::parse(url) {
                    Ok(u) if matches!(u.scheme(), "http" | "https") => {}
                    _ => return reply(Err("bad url".into())),
                }
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
                    return reply(Ok(json!({"ok": false, "error": "файл больше 64 КиБ"})));
                }
                if let Err(e) = config::write_text(text) {
                    return reply(Ok(json!({"ok": false, "error": e.to_string()})));
                }
                let cfg = config::parse(text);
                let ignored: Vec<Value> = cfg.ignored.iter().map(|i| json!({"line": i.line, "text": i.text, "reason": i.reason})).collect();
                reply(Ok(json!({"ok": true, "profiles": cfg.profile_names, "ignored": ignored})));
            }
            "stop" => {
                player.stop();
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
    let Ok(url) = url::Url::parse(url_str) else { return json!({"ok": false, "error": "недопустимый адрес"}) };
    let host = url.host_str().unwrap_or("").to_lowercase();
    if url.scheme() != "https" || !(host == "strem.io" || host.ends_with(".strem.io")) {
        return json!({"ok": false, "error": "недопустимый адрес"});
    }
    let generation = player.generation();
    let data = match http::get(url.as_str(), 15, MAX_SUBTITLE_BYTES, false) {
        Ok(d) if !d.is_empty() => d,
        _ => return json!({"ok": false, "error": "не удалось скачать"}),
    };
    let dir = settings::local_dir().join("Cache").join("subs");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return json!({"ok": false, "error": e.to_string()});
    }
    let last = url.path_segments().and_then(|s| s.last()).unwrap_or("");
    let id: String = last.chars().filter(|c| c.is_alphanumeric()).collect();
    let name = if id.is_empty() { format!("sub{}", std::process::id()) } else { id };
    let file = dir.join(format!("{name}.srt"));
    if let Err(e) = std::fs::write(&file, data) {
        return json!({"ok": false, "error": e.to_string()});
    }
    // За время скачивания могли открыть другое видео: чужие субтитры не подключаем.
    if generation != player.generation() {
        return json!({"ok": false, "error": "видео уже сменилось"});
    }
    let clean_title: String = title.chars().filter(|c| *c != '\n' && *c != '\r').take(120).collect();
    let clean_lang: String = lang.chars().filter(|c| c.is_alphabetic()).take(3).collect();
    if !player.add_subtitle(&file.to_string_lossy(), &clean_title, &clean_lang) {
        return json!({"ok": false, "error": "mpv не принял файл"});
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
    fn origins() {
        let k = |s: &str| origin_key(&url::Url::parse(s).unwrap());
        assert_eq!(k("http://Example.com/x").as_deref(), Some("http://example.com:80"));
        assert_eq!(k("https://a.b:8443/").as_deref(), Some("https://a.b:8443"));
        assert!(k("data:text/html,x").is_none());
    }
}
