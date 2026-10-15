//! Язык интерфейса: русский или английский. Выбор хранится в settings.json (ключ `language`: "ru" или "en");
//! пока он не сделан, берётся язык интерфейса Windows (русский → русский, остальные → английский).

use std::sync::atomic::{AtomicU8, Ordering};

use crate::settings;

const KEY: &str = "language";
/// 0 — ещё не определён, 1 — русский, 2 — английский.
static LANG: AtomicU8 = AtomicU8::new(0);

fn detect() -> u8 {
    match settings::get_string(KEY).as_deref() {
        Some("ru") => return 1,
        Some("en") => return 2,
        _ => {}
    }
    // Основной язык интерфейса Windows: младшие 10 бит идентификатора, 0x19 — русский.
    let id = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
    if id & 0x3ff == 0x19 { 1 } else { 2 }
}

pub fn is_ru() -> bool {
    let mut v = LANG.load(Ordering::Relaxed);
    if v == 0 {
        v = detect();
        LANG.store(v, Ordering::Relaxed);
    }
    v == 1
}

/// Запоминает выбор пользователя.
pub fn set(ru: bool) {
    LANG.store(if ru { 1 } else { 2 }, Ordering::Relaxed);
    settings::set_value(KEY, serde_json::json!(if ru { "ru" } else { "en" }));
}

/// Текст на выбранном языке: сначала русский, затем английский.
pub fn tr(ru: &'static str, en: &'static str) -> &'static str {
    if is_ru() { ru } else { en }
}

/// То же для форматируемых строк: `trf!("Версия {v}", "Version {v}")`; возвращает String.
#[macro_export]
macro_rules! trf {
    ($ru:literal, $en:literal $(, $arg:expr)* $(,)?) => {
        if $crate::i18n::is_ru() { format!($ru $(, $arg)*) } else { format!($en $(, $arg)*) }
    };
}
