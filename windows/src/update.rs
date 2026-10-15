//! Проверка и установка обновлений из GitHub Releases (порт `Update.swift` и `Updater.swift`).
//! Цепочка доверия: подпись Ed25519 файла SHA256SUMS.txt (открытый ключ вшит) → SHA-256 нужного файла из него.
//! Настройки (%APPDATA%\Lampyris) и данные WebView2 (%LOCALAPPDATA%\Lampyris) лежат вне папки программы (в портативном режиме — в `data` рядом с ней) и при обновлении не затрагиваются.
//! Установленная копия (рядом есть unins000.exe) обновляется тихим запуском нового установщика; portable-копия из .zip — заменой файлов
//! после выхода приложения.

use crate::i18n::tr;
use crate::{http, log, settings};
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};

/// Открытый ключ Ed25519 (32 байта, hex), которым подписан SHA256SUMS.txt каждого релиза. Закрытый ключ лежит только в секретах GitHub.
pub const PUBLIC_KEY_HEX: &str = "6ec850da7be700aed5b6a5650da56f2731d21f92aaa440a39129ba4f71fbc54e";
/// Версия приложения (scripts/VERSION, подставляет build.rs).
pub const VERSION: &str = env!("LAMPYRIS_VERSION");

const REPO: &str = "polons123/lampyris";
const MAX_PACKAGE_BYTES: usize = 400_000_000;
const MAX_META_BYTES: usize = 1_000_000;
const CHECK_INTERVAL_SECS: u64 = 24 * 3600;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// AppId установщика (windows/installer/lampyris.iss).
const INNO_APP_ID: &str = "{6B6F0A52-3E6C-4D58-9A2C-5C6B1F6A2D11}";

const KEY_AUTO: &str = "updateAutoCheck";
const KEY_LAST: &str = "updateLastCheck";
const KEY_SKIPPED: &str = "updateSkippedVersion";

pub struct Release {
    pub version: String,
    pub notes: String,
    pub page_url: String,
}

/// Что делать главному потоку, когда загрузка готова: запустить процесс и выйти.
pub struct Launch {
    pub program: PathBuf,
    pub raw_args: String,
}

pub enum Msg {
    /// Найдена новая версия; спросить пользователя.
    Found { release: Release, manual: bool },
    /// Сообщение пользователю (только при ручной проверке).
    Info(String, String),
    /// Ход загрузки (заголовок окна); None — вернуть обычный.
    Status(Option<String>),
    Error(String),
    Launch(Launch),
}

// ---------- Чистая логика (тесты ниже) ----------

pub fn parse_version(s: &str) -> Option<[u64; 3]> {
    let t = s.strip_prefix('v').unwrap_or(s);
    let parts: Vec<&str> = t.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    Some([parts[0].parse().ok()?, parts[1].parse().ok()?, parts[2].parse().ok()?])
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse_version(candidate), parse_version(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

/// Ответ GET /releases/latest: нужны тег, описание и страница релиза (адреса файлов строим сами). Черновики и предварительные версии отбрасываются.
pub fn parse_release(data: &[u8]) -> Option<Release> {
    let v: Value = serde_json::from_slice(data).ok()?;
    let tag = v.get("tag_name")?.as_str()?;
    parse_version(tag)?;
    if v.get("draft").and_then(Value::as_bool) == Some(true) || v.get("prerelease").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    Some(Release {
        version: tag.strip_prefix('v').unwrap_or(tag).to_string(),
        notes: v.get("body").and_then(Value::as_str).unwrap_or("").to_string(),
        page_url: v.get("html_url").and_then(Value::as_str).map(String::from).unwrap_or_else(|| format!("https://github.com/{REPO}/releases")),
    })
}

/// Строки вида «<sha256>  <имя>» (формат shasum); имя может начинаться с «*».
pub fn parse_sums(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        let Some((hash, name)) = line.split_once(char::is_whitespace) else { continue };
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        let name = name.trim().trim_start_matches('*');
        map.insert(name.to_string(), hash.to_ascii_lowercase());
    }
    map
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 || !s.is_ascii() {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

pub fn verify_signature(message: &[u8], signature: &[u8], public_key_hex: &str) -> bool {
    let Some(key) = hex_decode(public_key_hex).and_then(|b| <[u8; 32]>::try_from(b).ok()).and_then(|b| VerifyingKey::from_bytes(&b).ok()) else {
        return false;
    };
    let Ok(sig) = Signature::from_slice(signature) else { return false };
    key.verify_strict(message, &sig).is_ok()
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

pub fn arch_label() -> &'static str {
    if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" }
}

/// Строка параметров тихого установщика Inno Setup: тот же каталог и тот же режим установки (для пользователя или для всех), перезапуск после обновления.
pub fn installer_args(dir: &Path, per_user: bool, log: &Path) -> String {
    format!(
        "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /relaunch=1 {} /DIR=\"{}\" /LOG=\"{}\"",
        if per_user { "/CURRENTUSER" } else { "/ALLUSERS" },
        dir.display(),
        log.display()
    )
}

// ---------- Настройки ----------

pub fn auto_check() -> bool {
    settings::get_value(KEY_AUTO).and_then(|v| v.as_bool()).unwrap_or(true)
}

pub fn set_auto_check(on: bool) {
    settings::set_value(KEY_AUTO, json!(on));
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Пора ли проверять в фоне: включено и с прошлой проверки прошли сутки.
pub fn check_due() -> bool {
    auto_check() && now_secs().saturating_sub(settings::get_value(KEY_LAST).and_then(|v| v.as_u64()).unwrap_or(0)) > CHECK_INTERVAL_SECS
}

pub fn skip_version(version: &str) {
    settings::set_value(KEY_SKIPPED, json!(version));
}

// ---------- Проверка ----------

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

/// LAMPA_UPDATE_VERSION подменяет версию для проверки обновления.
fn current_version() -> String {
    env("LAMPA_UPDATE_VERSION").unwrap_or_else(|| VERSION.to_string())
}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

/// Установленная копия (есть деинсталлятор Inno Setup) или portable из .zip.
fn is_installed() -> bool {
    exe_dir().is_some_and(|d| d.join("unins000.exe").exists())
}

fn dir_writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".lampyris-write-test-{}", std::process::id()));
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

/// Почему автоустановка невозможна (None — можно). Для установленной копии нужен установщик (он сам запросит права), для portable — запись в папку.
pub fn install_blocker() -> Option<String> {
    let Some(dir) = exe_dir() else { return Some(tr("не найдена папка программы", "the program folder was not found").into()) };
    if is_installed() || dir_writable(&dir) { None } else { Some(crate::trf!("нет прав на запись в папку {}", "no write permission for the folder {}", dir.display())) }
}

/// Проверка в отдельном потоке; результат приходит через `emit`.
pub fn check(manual: bool, emit: impl Fn(Msg) + Send + 'static) {
    std::thread::spawn(move || {
        let current = current_version();
        match fetch_release() {
            Ok(release) => {
                settings::set_value(KEY_LAST, json!(now_secs()));
                if !is_newer(&release.version, &current) {
                    log::info("update", &format!("версия {current} актуальна"));
                    if manual {
                        emit(Msg::Info(tr("У вас последняя версия", "You are up to date").into(), crate::trf!("Lampyris {current} — самая новая.", "Lampyris {current} is the latest version.")));
                    }
                    return;
                }
                if !manual && settings::get_string(KEY_SKIPPED).as_deref() == Some(release.version.as_str()) {
                    return;
                }
                log::info("update", &format!("доступна версия {} (установлена {current})", release.version));
                emit(Msg::Found { release, manual });
            }
            Err(e) => {
                log::warn("update", &format!("проверка не удалась: {e}"));
                if manual {
                    emit(Msg::Info(tr("Не удалось проверить обновления", "Could not check for updates").into(), e));
                }
            }
        }
    });
}

fn fetch_release() -> Result<Release, String> {
    let api = env("LAMPA_UPDATE_API").unwrap_or_else(|| format!("https://api.github.com/repos/{REPO}/releases/latest"));
    let data = http::get(&api, 15, MAX_META_BYTES, true)?;
    parse_release(&data).ok_or_else(|| tr("не удалось разобрать ответ сервера обновлений", "could not parse the update server response").to_string())
}

// ---------- Установка ----------

/// Загрузка, проверка и подготовка запуска; ход и результат приходят через `emit`.
pub fn install(release: Release, emit: impl Fn(Msg) + Send + 'static) {
    std::thread::spawn(move || match prepare(&release, &emit) {
        Ok(launch) => emit(Msg::Launch(launch)),
        Err(e) => {
            log::error("update", &format!("установка не удалась: {e}"));
            emit(Msg::Status(None));
            emit(Msg::Error(crate::trf!("{e}\n\nУстановленная версия не изменена.", "{e}\n\nThe installed version was not changed.")));
        }
    });
}

fn prepare(release: &Release, emit: &impl Fn(Msg)) -> Result<Launch, String> {
    let v = &release.version;
    let installed = is_installed();
    let dir = exe_dir().ok_or(tr("не найдена папка программы", "the program folder was not found"))?;
    let arch = arch_label();
    // Полностью портативная копия (рядом portable.txt) обновляется своим архивом: данные в `data` остаются на месте.
    let portable_full = settings::portable_data_dir().is_some();
    let name = if installed {
        format!("Lampyris-{v}-windows-{arch}-setup.exe")
    } else if portable_full {
        format!("Lampyris-{v}-windows-{arch}-portable.zip")
    } else {
        format!("Lampyris-{v}-windows-{arch}.zip")
    };
    let base = env("LAMPA_UPDATE_BASE").unwrap_or_else(|| format!("https://github.com/{REPO}/releases/download"));
    let url = |n: &str| format!("{base}/v{v}/{n}");

    // 1. Подписанный список контрольных сумм.
    emit(Msg::Status(Some(tr("Lampyris — проверка обновления…", "Lampyris — checking the update…").into())));
    let sums = http::get(&url("SHA256SUMS.txt"), 30, MAX_META_BYTES, false)?;
    let sig = http::get(&url("SHA256SUMS.txt.sig"), 30, MAX_META_BYTES, false)?;
    let key = env("LAMPA_UPDATE_PUBKEY").unwrap_or_else(|| PUBLIC_KEY_HEX.to_string());
    if !verify_signature(&sums, &sig, &key) {
        return Err(tr("подпись списка контрольных сумм не прошла проверку: файлы релиза не заслуживают доверия", "the checksum list signature did not verify: the release files cannot be trusted").into());
    }
    let expected = parse_sums(&String::from_utf8_lossy(&sums)).remove(&name).ok_or_else(|| crate::trf!("в списке контрольных сумм нет файла {name}", "{name} is not in the checksum list"))?;

    // 2. Загрузка и сверка SHA-256.
    let stage = std::env::temp_dir().join("Lampyris-update").join(v);
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| crate::trf!("не удалось создать временную папку: {e}", "could not create a temporary folder: {e}"))?;
    let file = stage.join(&name);
    let mut last = u64::MAX;
    emit(Msg::Status(Some(tr("Lampyris — загрузка обновления 0%", "Lampyris — downloading the update 0%").into())));
    http::download(&url(&name), &file, MAX_PACKAGE_BYTES, |done, total| {
        let pct = total.filter(|t| *t > 0).map(|t| done * 100 / t).unwrap_or(0);
        if pct != last {
            last = pct;
            emit(Msg::Status(Some(crate::trf!("Lampyris — загрузка обновления {pct}%", "Lampyris — downloading the update {pct}%"))));
        }
    })?;
    if sha256_file(&file).map_err(|e| e.to_string())? != expected {
        return Err(tr("контрольная сумма загруженного файла не совпала", "the downloaded file's checksum does not match").into());
    }

    if installed {
        // Режим установки сохраняем (для пользователя или для всех); во втором случае установщик сам запросит права.
        let per_user = installed_per_user();
        log::info("update", &format!("запуск установщика версии {v}"));
        return Ok(Launch { program: file, raw_args: installer_args(&dir, per_user, &stage.join("setup.log")) });
    }
    prepare_portable(&stage, &file, release, &dir, arch, portable_full)
}

/// Запись об установке Inno Setup есть в HKCU — установка для пользователя; только в HKLM — для всех; нигде — считаем для пользователя.
fn installed_per_user() -> bool {
    let has = |hive: &str| {
        std::process::Command::new(system32("reg.exe"))
            .args(["query", &format!(r"{hive}\Software\Microsoft\Windows\CurrentVersion\Uninstall\{INNO_APP_ID}_is1")])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok_and(|o| o.status.success())
    };
    has("HKCU") || !has("HKLM")
}

fn system32(exe: &str) -> PathBuf {
    PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into())).join("System32").join(exe)
}

/// Portable-копия: распаковываем архив и готовим скрипт, который после выхода приложения заменит файлы и запустит новую версию.
fn prepare_portable(stage: &Path, zip: &Path, release: &Release, dir: &Path, arch: &str, portable_full: bool) -> Result<Launch, String> {
    let out = stage.join("new");
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let status = std::process::Command::new(system32("tar.exe"))
        .arg("-xf").arg(zip).arg("-C").arg(&out)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| crate::trf!("не удалось распаковать архив: {e}", "could not unpack the archive: {e}"))?;
    if !status.success() {
        return Err(tr("не удалось распаковать архив", "could not unpack the archive").into());
    }
    let _ = std::fs::remove_file(zip);
    let src = out.join(format!("Lampyris-{}-windows-{arch}{}", release.version, if portable_full { "-portable" } else { "" }));
    if !src.join("Lampyris.exe").is_file() || !src.join("libmpv-2.dll").is_file() {
        return Err(tr("в архиве нет Lampyris.exe или libmpv-2.dll", "the archive has no Lampyris.exe or libmpv-2.dll").into());
    }
    let script = stage.join("replace.cmd");
    std::fs::write(&script, REPLACE_SCRIPT.replace('\n', "\r\n")).map_err(|e| e.to_string())?;
    log::info("update", &format!("обновление portable-копии до {}", release.version));
    Ok(Launch {
        program: system32("cmd.exe"),
        raw_args: format!("/D /C \"\"{}\" {} \"{}\" \"{}\"\"", script.display(), std::process::id(), src.display(), dir.display()),
    })
}

/// Ждёт выхода приложения, меняет Lampyris.exe и libmpv-2.dll (прежние сохраняются до успеха), запускает новую версию; при ошибке возвращает прежнюю.
const REPLACE_SCRIPT: &str = r#"@echo off
setlocal
set "PID=%~1"
set "SRC=%~2"
set "DST=%~3"
powershell -NoProfile -NonInteractive -Command "try { Wait-Process -Id %PID% -Timeout 30 -ErrorAction Stop } catch {}" >nul 2>&1
ping -n 2 127.0.0.1 >nul
move /y "%DST%\Lampyris.exe" "%DST%\Lampyris.exe.old" >nul 2>&1
if not exist "%DST%\Lampyris.exe.old" goto start
if exist "%DST%\libmpv-2.dll" move /y "%DST%\libmpv-2.dll" "%DST%\libmpv-2.dll.old" >nul 2>&1
copy /y "%SRC%\Lampyris.exe" "%DST%\Lampyris.exe" >nul || goto rollback
copy /y "%SRC%\libmpv-2.dll" "%DST%\libmpv-2.dll" >nul || goto rollback
copy /y "%SRC%\LICENSE" "%DST%\LICENSE" >nul 2>&1
copy /y "%SRC%\THIRD-PARTY.md" "%DST%\THIRD-PARTY.md" >nul 2>&1
del /f /q "%DST%\Lampyris.exe.old" "%DST%\libmpv-2.dll.old" >nul 2>&1
goto start
:rollback
del /f /q "%DST%\Lampyris.exe" "%DST%\libmpv-2.dll" >nul 2>&1
move /y "%DST%\Lampyris.exe.old" "%DST%\Lampyris.exe" >nul 2>&1
if exist "%DST%\libmpv-2.dll.old" move /y "%DST%\libmpv-2.dll.old" "%DST%\libmpv-2.dll" >nul 2>&1
:start
start "" "%DST%\Lampyris.exe"
"#;

/// Запуск подготовленного процесса (установщик или скрипт замены); приложение после этого должно завершиться.
pub fn spawn(launch: &Launch) -> Result<(), String> {
    std::process::Command::new(&launch.program).raw_arg(&launch.raw_args).creation_flags(CREATE_NO_WINDOW).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Папки обновлений во временном каталоге хранятся неделю.
pub fn clean_cache() {
    let dir = std::env::temp_dir().join("Lampyris-update");
    let Ok(items) = std::fs::read_dir(&dir) else { return };
    let limit = std::time::Duration::from_secs(7 * 86400);
    for item in items.flatten() {
        let old = item.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > limit);
        if old {
            let _ = std::fs::remove_dir_all(item.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn versions() {
        assert_eq!(parse_version("v0.1.4"), Some([0, 1, 4]));
        assert_eq!(parse_version("1.20.3"), Some([1, 20, 3]));
        for bad in ["1.2", "1.2.x", "1.2.3-beta", "-1.2.3", "+1.2.3", "", "1..3"] {
            assert_eq!(parse_version(bad), None, "{bad}");
        }
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(!is_newer("0.1.4", "0.1.4"));
        assert!(!is_newer("0.1.3", "0.1.4"));
        assert!(!is_newer("мусор", "0.1.4"));
    }

    #[test]
    fn release_json() {
        let r = parse_release(r#"{"tag_name":"v0.1.5","body":"Что нового","html_url":"https://github.com/x/y/releases/tag/v0.1.5"}"#.as_bytes()).unwrap();
        assert_eq!((r.version.as_str(), r.notes.as_str()), ("0.1.5", "Что нового"));
        assert!(parse_release(br#"{"tag_name":"nightly"}"#).is_none());
        assert!(parse_release(br#"{"tag_name":"v0.1.5","prerelease":true}"#).is_none());
        assert!(parse_release(br#"{"tag_name":"v0.1.5","draft":true}"#).is_none());
        assert!(parse_release("не json".as_bytes()).is_none());
    }

    #[test]
    fn sums() {
        let h = "ab".repeat(32);
        let text = format!("{h}  Lampyris-0.1.5-windows-x64.zip\n{} *Lampyris-0.1.5-windows-x64-setup.exe\nкороткая  строка\n", h.to_uppercase());
        let m = parse_sums(&text);
        assert_eq!(m.len(), 2);
        assert_eq!(m["Lampyris-0.1.5-windows-x64.zip"], h);
        assert_eq!(m["Lampyris-0.1.5-windows-x64-setup.exe"], h);
    }

    #[test]
    fn signature() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let pub_hex: String = key.verifying_key().to_bytes().iter().map(|b| format!("{b:02x}")).collect();
        let sig = key.sign(b"sums").to_bytes();
        assert!(verify_signature(b"sums", &sig, &pub_hex));
        assert!(!verify_signature("другое".as_bytes(), &sig, &pub_hex));
        assert!(!verify_signature(b"sums", &sig[..63], &pub_hex));
        assert!(!verify_signature(b"sums", &sig, "не hex"));
        // Вшитый ключ должен быть корректным открытым ключом.
        assert!(hex_decode(PUBLIC_KEY_HEX).and_then(|b| <[u8; 32]>::try_from(b).ok()).and_then(|b| VerifyingKey::from_bytes(&b).ok()).is_some());
    }

    #[test]
    fn installer_command_line() {
        let s = installer_args(Path::new(r"C:\Program Files\Lampyris"), false, Path::new(r"C:\t\setup.log"));
        assert!(s.contains("/ALLUSERS") && s.contains(r#"/DIR="C:\Program Files\Lampyris""#) && s.contains("/relaunch=1") && s.contains(r#"/LOG="C:\t\setup.log""#));
        assert!(installer_args(Path::new(r"C:\x"), true, Path::new(r"C:\l")).contains("/CURRENTUSER"));
    }

    #[test]
    fn sha256_of_file() {
        let p = std::env::temp_dir().join(format!("lampyris-sha-{}", std::process::id()));
        std::fs::write(&p, b"abc").unwrap();
        assert_eq!(sha256_file(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = std::fs::remove_file(&p);
    }
}
