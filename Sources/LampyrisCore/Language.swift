import Foundation

/// Язык интерфейса приложения: русский или английский. Выбор хранится в настройках (UserDefaults, ключ `language`);
/// пока он не сделан, берётся язык системы (русский, если первым в списке языков стоит русский, иначе английский).
public enum Language: String, Sendable {
    case ru, en

    static let key = "language"

    public static var current: Language {
        if let saved = UserDefaults.standard.string(forKey: key), let l = Language(rawValue: saved) { return l }
        return (Locale.preferredLanguages.first ?? "").hasPrefix("ru") ? .ru : .en
    }

    public static func set(_ language: Language) {
        UserDefaults.standard.set(language.rawValue, forKey: key)
    }
}

/// Текст на выбранном языке: сначала русский, затем английский.
public func tr(_ ru: String, _ en: String) -> String {
    Language.current == .ru ? ru : en
}
