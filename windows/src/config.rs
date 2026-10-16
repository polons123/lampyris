//! Пользовательский mpv.conf: общие опции и профили `[имя]`. Файл лежит в
//! %APPDATA%\Lampyris\ и меняется только пользователем. Порт `MpvConfig.swift`.

use crate::i18n::tr;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub value: String,
    /// Суффикс списка: add, append, set, pre, clr, remove.
    pub op: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ignored {
    pub line: usize,
    pub text: String,
    pub reason: &'static str,
}

#[derive(Debug, Default, Clone)]
pub struct MpvConfig {
    pub global: Vec<Entry>,
    pub profiles: HashMap<String, Vec<Entry>>,
    /// Имена профилей в порядке появления в файле.
    pub profile_names: Vec<String>,
    pub ignored: Vec<Ignored>,
}

pub const MAX_BYTES: usize = 64 * 1024;

/// Опции, которые запускают код, читают чужие файлы или ломают встроенный рендер.
/// `profile` запрещён: профили выбираются настройкой приложения, а не из файла.
const BLOCKED: &[&str] = &[
    "include", "config", "config-dir", "profile", "script", "scripts", "load-scripts",
    "js-memory-limit", "input-conf", "input-commands", "input-ipc-server", "input-ipc-client",
    "ytdl", "ytdl-format", "ytdl-raw-options", "vo", "wid", "gpu-context", "gpu-api",
    "force-window", "idle", "player-operation-mode", "osc", "input-default-bindings",
    "input-vo-keyboard", "keep-open", "config-file", "scripts-append", "log-file",
    "watch-later-directory", "write-filename-in-watch-later-config", "save-position-on-quit",
    "icc-cache-dir", "gpu-shader-cache-dir", "cache-dir", "dump-stats", "screenshot-directory",
    "screenshot-template", "stream-dump", "record-file", "o",
];

const LIST_OPS: &[&str] = &["add", "append", "set", "pre", "clr", "remove"];

pub fn file_path() -> PathBuf {
    crate::settings::app_data_dir().join("mpv.conf")
}

pub fn read_text() -> String {
    // Некоторые редакторы сохраняют UTF-8 с BOM: он испортил бы имя первой опции.
    std::fs::read_to_string(file_path()).map(|s| s.trim_start_matches('\u{feff}').to_string()).unwrap_or_default()
}

pub fn write_text(text: &str) -> std::io::Result<()> {
    let path = file_path();
    if text.trim().is_empty() {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let body = if text.ends_with('\n') { text.to_string() } else { format!("{text}\n") };
    std::fs::write(path, body)
}

impl MpvConfig {
    pub fn load() -> MpvConfig {
        merged(&read_text())
    }

    /// Все записи применяемого набора: общие, затем выбранного профиля.
    pub fn entries(&self, profile: Option<&str>) -> Vec<Entry> {
        let mut v = self.global.clone();
        if let Some(p) = profile.and_then(|p| self.profiles.get(p)) {
            v.extend(p.iter().cloned());
        }
        v
    }
}

fn valid_profile_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
}

fn unquote(v: &str) -> String {
    let chars: Vec<char> = v.chars().collect();
    if chars.len() >= 2 && chars[0] == *chars.last().unwrap() && (chars[0] == '"' || chars[0] == '\'') {
        return chars[1..chars.len() - 1].iter().collect();
    }
    v.to_string()
}

/// `^(?:--)?([A-Za-z0-9][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$` без регулярных выражений.
fn split_line(line: &str) -> Option<(String, Option<String>)> {
    let s = line.strip_prefix("--").unwrap_or(line);
    let mut chars = s.char_indices();
    match chars.next() {
        Some((_, c)) if c.is_ascii_alphanumeric() => {}
        _ => return None,
    }
    let end = s.char_indices().find(|(_, c)| !(c.is_ascii_alphanumeric() || *c == '-')).map(|(i, _)| i).unwrap_or(s.len());
    let name = &s[..end];
    let rest = s[end..].trim_start();
    if rest.is_empty() {
        return Some((name.to_string(), None));
    }
    let value = rest.strip_prefix('=')?;
    Some((name.to_string(), Some(value.trim_start().to_string())))
}

/// Настройки пользователя вместе со встроенными профилями. Раздел пользователя с тем же именем целиком
/// заменяет встроенный; не переопределённые встроенные идут первыми, затем профили из файла.
pub fn merged(user_text: &str) -> MpvConfig {
    let mut cfg = parse(user_text);
    let builtin = parse(crate::mpv_profiles::BUILTIN);
    let own: Vec<String> = builtin.profile_names.iter().filter(|n| !cfg.profiles.contains_key(*n)).cloned().collect();
    for name in &own {
        if let Some(entries) = builtin.profiles.get(name) { cfg.profiles.insert(name.clone(), entries.clone()); }
    }
    let user_names = std::mem::take(&mut cfg.profile_names);
    cfg.profile_names = own.into_iter().chain(user_names).collect();
    cfg
}

pub fn parse(text: &str) -> MpvConfig {
    let mut cfg = MpvConfig::default();
    let mut section: Option<String> = None; // None — общие опции
    let mut section_ok = true;

    for (index, raw) in text.split('\n').enumerate() {
        let line = raw.trim_matches(|c: char| c == ' ' || c == '\t' || c == '\r');
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut skip = |reason: &'static str| cfg.ignored.push(Ignored { line: index + 1, text: line.to_string(), reason });

        if line.starts_with('[') && line.ends_with(']') && line.len() >= 2 {
            let name = line[1..line.len() - 1].trim().to_string();
            if name == "default" {
                section = None;
                section_ok = true;
                continue;
            }
            if !valid_profile_name(&name) {
                section = None;
                section_ok = false;
                skip(tr("недопустимое имя профиля", "invalid profile name"));
                continue;
            }
            section = Some(name.clone());
            section_ok = true;
            if !cfg.profiles.contains_key(&name) {
                cfg.profiles.insert(name.clone(), Vec::new());
                cfg.profile_names.push(name);
            }
            continue;
        }
        if !section_ok {
            skip(tr("внутри профиля с недопустимым именем", "inside a profile with an invalid name"));
            continue;
        }

        let Some((raw_name, raw_value)) = split_line(line) else {
            skip(tr("не похоже на «опция=значение»", "does not look like “option=value”"));
            continue;
        };
        let mut name = raw_name.to_lowercase();
        let value = match raw_value {
            Some(v) => unquote(v.trim_matches(|c: char| c == ' ' || c == '\t')),
            None => {
                if let Some(stripped) = name.strip_prefix("no-") {
                    let n = stripped.to_string();
                    name = n;
                    "no".to_string()
                } else {
                    "yes".to_string()
                }
            }
        };
        let mut op = None;
        if let Some(pos) = name.rfind('-') {
            let (base, suffix) = (&name[..pos], &name[pos + 1..]);
            if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_lowercase()) && LIST_OPS.contains(&suffix) {
                op = Some(suffix.to_string());
                name = base.to_string();
            }
        }
        if BLOCKED.contains(&name.as_str()) {
            skip(tr("опция запрещена", "option is not allowed"));
            continue;
        }
        if value.contains('\0') {
            skip(tr("недопустимые символы", "invalid characters"));
            continue;
        }
        let entry = Entry { name, value, op };
        match &section {
            Some(s) => cfg.profiles.entry(s.clone()).or_default().push(entry),
            None => cfg.global.push(entry),
        }
    }
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(name: &str, value: &str, op: Option<&str>) -> Entry {
        Entry { name: name.into(), value: value.into(), op: op.map(String::from) }
    }
    fn names(v: &[Entry]) -> Vec<&str> {
        v.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn empty_and_comments() {
        let cfg = parse("\n   \n# комментарий\n   # ещё один\n");
        assert!(cfg.global.is_empty() && cfg.profiles.is_empty() && cfg.ignored.is_empty());
    }

    #[test]
    fn key_value() {
        let cfg = parse("Volume = 40\nsub-font=\"Segoe UI\"\nsub-file-paths='a b'\n--hwdec=d3d11va");
        assert_eq!(cfg.global, vec![e("volume", "40", None), e("sub-font", "Segoe UI", None), e("sub-file-paths", "a b", None), e("hwdec", "d3d11va", None)]);
    }

    #[test]
    fn flags() {
        let cfg = parse("fs\nno-osd-bar");
        assert_eq!(cfg.global, vec![e("fs", "yes", None), e("osd-bar", "no", None)]);
    }

    #[test]
    fn list_operations() {
        let cfg = parse("vf-add=hflip\naf-append=loudnorm\nvf-set=a\nvf-pre=b\nvf-remove=c\naf-clr=");
        let ops: Vec<(String, String, String)> = cfg.global.iter().map(|x| (x.name.clone(), x.op.clone().unwrap_or("-".into()), x.value.clone())).collect();
        let want = [("vf", "add", "hflip"), ("af", "append", "loudnorm"), ("vf", "set", "a"), ("vf", "pre", "b"), ("vf", "remove", "c"), ("af", "clr", "")];
        assert_eq!(ops, want.iter().map(|(a, b, c)| (a.to_string(), b.to_string(), c.to_string())).collect::<Vec<_>>());
    }

    #[test]
    fn not_list_ops() {
        let cfg = parse("audio-delay=0.2\nsub-pos=90\nosd-bar=no");
        assert!(cfg.global.iter().all(|x| x.op.is_none()));
        assert_eq!(names(&cfg.global), ["audio-delay", "sub-pos", "osd-bar"]);
    }

    #[test]
    fn blocked_options() {
        let cfg = parse("script=/tmp/evil.lua\nvo=gpu\ninclude=/etc/other.conf\ninput-ipc-server=/tmp/s\nprofile=x\nscripts-append=/tmp/a.lua\nlog-file=/tmp/l\nvolume=50");
        assert_eq!(cfg.global, vec![e("volume", "50", None)]);
        assert_eq!(cfg.ignored.len(), 7);
        assert!(cfg.ignored.iter().all(|i| i.reason == tr("опция запрещена", "option is not allowed")));
        assert_eq!(cfg.ignored[0].line, 1);
    }

    #[test]
    fn profiles() {
        let cfg = parse("hwdec=d3d11va\n\n[bright]\nbrightness=30\ncontrast=5\n\n[dark]\nbrightness=-30\n[default]\nvolume=40");
        assert_eq!(cfg.profile_names, ["bright", "dark"]);
        assert_eq!(names(&cfg.global), ["hwdec", "volume"]);
        assert_eq!(names(&cfg.profiles["bright"]), ["brightness", "contrast"]);
        assert_eq!(cfg.profiles["dark"][0].value, "-30");
    }

    #[test]
    fn profile_merge() {
        let cfg = parse("[a]\nx=1\n[b]\ny=2\n[a]\nz=3");
        assert_eq!(cfg.profile_names, ["a", "b"]);
        assert_eq!(names(&cfg.profiles["a"]), ["x", "z"]);
    }

    #[test]
    fn entries_for_profile() {
        let cfg = parse("hwdec=no\n[p]\nbrightness=10");
        assert_eq!(names(&cfg.entries(Some("p"))), ["hwdec", "brightness"]);
        assert_eq!(names(&cfg.entries(None)), ["hwdec"]);
        assert_eq!(names(&cfg.entries(Some("нет"))), ["hwdec"]);
    }

    #[test]
    fn invalid_profile_name() {
        let cfg = parse("[bad name!]\nbrightness=1\n[ok]\ncontrast=2");
        assert_eq!(cfg.profile_names, ["ok"]);
        assert_eq!(names(&cfg.profiles["ok"]), ["contrast"]);
        assert_eq!(cfg.ignored.iter().map(|i| i.line).collect::<Vec<_>>(), [1, 2]);
        assert_eq!(cfg.ignored[0].reason, tr("недопустимое имя профиля", "invalid profile name"));
    }

    #[test]
    fn garbage() {
        let cfg = parse("volume=10\n=oops\n!!!\nsub-pos=90");
        assert_eq!(names(&cfg.global), ["volume", "sub-pos"]);
        assert_eq!(cfg.ignored.iter().map(|i| i.line).collect::<Vec<_>>(), [2, 3]);
    }

    #[test]
    fn nul_character() {
        let cfg = parse("volume=1\u{0}2");
        assert!(cfg.global.is_empty());
        assert_eq!(cfg.ignored[0].reason, tr("недопустимые символы", "invalid characters"));
    }

    #[test]
    fn bom_is_stripped_by_reader() {
        // parse() получает уже очищенный текст; read_text() убирает BOM при чтении файла
        let cfg = parse("\u{feff}volume=40".trim_start_matches('\u{feff}'));
        assert_eq!(names(&cfg.global), ["volume"]);
    }

    #[test]
    fn crlf() {
        let cfg = parse("volume=40\r\n[p]\r\nbrightness=5\r\n");
        assert_eq!(names(&cfg.global), ["volume"]);
        assert_eq!(cfg.profiles["p"][0].value, "5");
        // номера строк при CRLF считаются верно
        let cfg = parse("a=1\r\n=oops\r\n");
        assert_eq!(cfg.ignored[0].line, 2);
    }

    const BUILTIN_NAMES: [&str; 9] = ["balanced", "quality", "fast", "hdr-sdr", "smooth", "anime", "night", "dark", "dark-extreme"];

    #[test]
    fn builtin_profiles_are_valid() {
        let cfg = parse(crate::mpv_profiles::BUILTIN);
        assert_eq!(cfg.profile_names, BUILTIN_NAMES);
        assert!(cfg.ignored.is_empty());
        assert!(cfg.global.is_empty());
    }

    #[test]
    fn merged_without_user_file() {
        let cfg = merged("");
        assert_eq!(cfg.profile_names, BUILTIN_NAMES);
        assert!(cfg.entries(Some("dark")).contains(&e("gamma", "20", None)));
    }

    #[test]
    fn user_profile_overrides_builtin() {
        let cfg = merged("hwdec=no\n[dark]\ngamma=5\n[mine]\nvolume=30");
        let mut expected: Vec<&str> = BUILTIN_NAMES.iter().copied().filter(|n| *n != "dark").collect();
        expected.extend(["dark", "mine"]);
        assert_eq!(cfg.profile_names, expected);
        assert_eq!(cfg.profiles["dark"], vec![e("gamma", "5", None)]);
        assert_eq!(names(&cfg.global), ["hwdec"]);
        assert!(!cfg.profiles["balanced"].is_empty());
    }
}
