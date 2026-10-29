import AppKit
import LampyrisCore

/// Адрес сервера Lampa: переменная LAMPA_URL, затем UserDefaults, затем запрос у пользователя.
/// Адрес хранится только в UserDefaults, в репозиторий не попадает.
@MainActor
enum ServerURL {
    private static let key = "serverURL"

    static func resolve() -> URL? {
        // LAMPA_ASK_SERVER=1: всегда показать окно ввода адреса (с историей).
        if ProcessInfo.processInfo.environment["LAMPA_ASK_SERVER"] != nil { return prompt() }
        if let s = ProcessInfo.processInfo.environment["LAMPA_URL"], let u = parse(s) { return u }
        if let s = UserDefaults.standard.string(forKey: key), let u = parse(s) { return u }
        return prompt()
    }

    private static func parse(_ s: String) -> URL? {
        Backup.normalizedServer(s).flatMap(URL.init(string:))
    }

    /// Диалог смены адреса (с текущим значением в поле); при отмене возвращает nil.
    static func change(current: URL) -> URL? { prompt(initial: current.absoluteString) }

    private static let historyKey = "serverHistory"
    private static let historyLimit = 10

    /// Ранее введённые адреса, последний первым. Хранятся только в UserDefaults.
    static var history: [String] { UserDefaults.standard.stringArray(forKey: historyKey) ?? [] }

    private static func remember(_ address: String) {
        var list = history.filter { $0 != address }
        list.insert(address, at: 0)
        UserDefaults.standard.set(Array(list.prefix(historyLimit)), forKey: historyKey)
    }

    /// Восстановление из резервной копии: текущий адрес и история заменяются.
    static func restore(current: String?, history list: [String]) {
        if let current { UserDefaults.standard.set(current, forKey: key) }
        UserDefaults.standard.set(Array(list.prefix(historyLimit)), forKey: historyKey)
    }

    /// Сохранённый адрес для резервной копии (без LAMPA_URL и без запроса).
    static var saved: String? { UserDefaults.standard.string(forKey: key) }

    private static func prompt(initial: String = "") -> URL? {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = tr("Адрес сервера Lampa", "Lampa server address")
        alert.informativeText = tr("Например: 192.168.1.10:9118. Ранее введённые адреса — в выпадающем списке.", "For example: 192.168.1.10:9118. Previously entered addresses are in the drop-down list.")
        let field = NSComboBox(frame: NSRect(x: 0, y: 0, width: 320, height: 26))
        field.completes = true
        field.numberOfVisibleItems = 10
        var known = history
        if let saved = UserDefaults.standard.string(forKey: key), !known.contains(saved) { known.append(saved) }
        field.addItems(withObjectValues: known)
        field.stringValue = initial.isEmpty ? (known.first ?? "") : initial
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: tr("Отмена", "Cancel"))
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn, let u = parse(field.stringValue) else { return nil }
        UserDefaults.standard.set(u.absoluteString, forKey: key)
        remember(u.absoluteString)
        return u
    }
}
