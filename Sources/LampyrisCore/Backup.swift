import Foundation

/// Резервная копия настроек: один JSON-файл, общий формат для macOS и Windows (windows/src/backup.rs).
/// Содержит адрес сервера, историю адресов, переключатели, mpv.conf и данные страницы Lampa (localStorage:
/// вход, закладки, плагины, настройки Lampa). Положение окна не входит: оно зависит от экрана.
public struct Backup: Equatable {
    public struct Lampa: Equatable {
        public var origin: String
        public var items: [String: String]
        public init(origin: String, items: [String: String]) { self.origin = origin; self.items = items }
    }

    public var serverURL: String?
    public var history: [String] = []
    public var verboseLog: Bool?
    public var autoUpdateCheck: Bool?
    public var mpvConf: String?
    public var lampa: Lampa?

    public init() {}

    public static let format = "lampyris-backup"
    public static let version = 1
    public static let maxFileBytes = 32 * 1024 * 1024
    static let maxLampaBytes = 16 * 1024 * 1024
    static let maxLampaItems = 20_000
    static let maxHistory = 10
    static let maxMpvConfBytes = 64 * 1024

    /// Адрес сервера в разумном виде (http или https, есть хост); как и в приложении, без схемы подставляется http://.
    public static func normalizedServer(_ s: String) -> String? {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty || t.count > 2048 { return nil }
        if !t.contains("://") { t = "http://" + t }
        guard let u = URLComponents(string: t), let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = u.host, !host.isEmpty else { return nil }
        return t
    }

    /// Источник страницы вида схема://хост[:порт] без пути.
    public static func normalizedOrigin(_ s: String) -> String? {
        guard let u = URLComponents(string: s), let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = u.host, !host.isEmpty, u.user == nil, u.password == nil, u.query == nil, u.fragment == nil,
              u.path.isEmpty || u.path == "/" else { return nil }
        let port = u.port
        if let port, !(0...65535).contains(port) { return nil }
        let canonicalHost = host.lowercased()
        let authority = canonicalHost.contains(":") && !canonicalHost.hasPrefix("[") ? "[\(canonicalHost)]" : canonicalHost
        let defaultPort = scheme == "https" ? 443 : 80
        return "\(scheme)://\(authority)" + (port.flatMap { $0 == defaultPort ? nil : ":\($0)" } ?? "")
    }

    // MARK: Запись

    public func jsonData(app: String, platform: String, date: Date = Date()) throws -> Data {
        var root: [String: Any] = [
            "format": Self.format, "version": Self.version, "app": app, "platform": platform,
            "createdAt": ISO8601DateFormatter().string(from: date),
        ]
        if let serverURL { root["serverURL"] = serverURL }
        root["serverHistory"] = history
        if let verboseLog { root["verboseLog"] = verboseLog }
        if let autoUpdateCheck { root["autoUpdateCheck"] = autoUpdateCheck }
        if let mpvConf { root["mpvConf"] = mpvConf }
        if let lampa { root["lampa"] = ["origin": lampa.origin, "localStorage": lampa.items] }
        return try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    }

    // MARK: Чтение

    public struct ParseError: Error, Equatable {
        public let message: String
        public init(message: String) { self.message = message }
    }

    /// Разбор файла с проверкой: неизвестные поля пропускаются, значения проверяются и ограничиваются по размеру.
    public static func parse(_ data: Data) throws -> Backup {
        func fail(_ m: String) -> ParseError { ParseError(message: m) }
        if data.count > maxFileBytes { throw fail(tr("файл слишком большой для резервной копии", "the file is too large for a backup")) }
        var bytes = data
        if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { bytes = bytes.dropFirst(3) }
        guard let root = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any], root["format"] as? String == format else {
            throw fail(tr("это не файл резервной копии Lampyris", "this is not a Lampyris backup file"))
        }
        guard let v = root["version"] as? Int, v >= 1 else { throw fail(tr("в файле не указана версия формата", "the file does not specify a format version")) }
        if v > version { throw fail(tr("файл создан более новой версией Lampyris: обновите приложение", "the file was created by a newer version of Lampyris: update the app")) }

        var b = Backup()
        if let s = root["serverURL"] as? String, !s.isEmpty {
            guard let n = normalizedServer(s) else { throw fail(tr("в файле неверный адрес сервера", "the file has an invalid server address")) }
            b.serverURL = n
        }
        if let list = root["serverHistory"] as? [Any] {
            for item in list.prefix(maxHistory) {
                if let s = item as? String, let n = normalizedServer(s), !b.history.contains(n) { b.history.append(n) }
            }
        }
        b.verboseLog = root["verboseLog"] as? Bool
        b.autoUpdateCheck = root["autoUpdateCheck"] as? Bool
        if let conf = root["mpvConf"] as? String {
            if conf.utf8.count > maxMpvConfBytes { throw fail(tr("mpv.conf в файле слишком большой", "mpv.conf in the file is too large")) }
            b.mpvConf = conf
        }
        if let l = root["lampa"] as? [String: Any], let origin = l["origin"] as? String, let items = l["localStorage"] as? [String: Any] {
            guard let o = normalizedOrigin(origin) else { throw fail(tr("в файле неверный источник данных Lampa", "the file has an invalid Lampa data origin")) }
            if items.count > maxLampaItems { throw fail(tr("в файле слишком много записей Lampa", "the file has too many Lampa entries")) }
            var map: [String: String] = [:]
            var total = 0
            for (k, any) in items {
                guard let value = any as? String, k.utf8.count <= 4096 else { throw fail(tr("в данных Lampa есть запись неверного вида", "the Lampa data has a malformed entry")) }
                total += k.utf8.count + value.utf8.count
                map[k] = value
            }
            if total > maxLampaBytes { throw fail(tr("данные Lampa в файле слишком велики", "the Lampa data in the file is too large")) }
            b.lampa = Lampa(origin: o, items: map)
        }
        return b
    }

    // MARK: Страница Lampa

    /// JS для чтения localStorage страницы: строка JSON {origin, items}.
    public static let collectScript =
        "(function(){var o={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);o[k]=localStorage.getItem(k)}return JSON.stringify({origin:location.origin,items:o})})()"

    /// Разбор ответа `collectScript`.
    public static func parseCollected(_ json: String) -> Lampa? {
        guard let d = json.data(using: .utf8), let root = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let origin = root["origin"] as? String, let o = normalizedOrigin(origin), let items = root["items"] as? [String: String] else { return nil }
        return Lampa(origin: o, items: items)
    }

    /// Итог восстановления данных Lampa на странице.
    public enum RestoreOutcome: Equatable, Sendable {
        case ok
        /// Страница сервера не открылась.
        case pageNotOpen
        /// Страница открыта с другого источника, чем в копии: ничего не изменено.
        case wrongOrigin
        /// Запись не удалась (например, квота хранилища); прежние данные возвращены. Строка — имя ошибки JS.
        case failedRolledBack(String)
        /// Запись не удалась, и вернуть прежние данные тоже не удалось.
        case failedDataLost(String)
        case unknown
    }

    /// Разбор ответа скрипта восстановления: "ok", "origin", "error:<имя>" или "lost:<имя>".
    public static func parseRestoreResult(_ result: String?) -> RestoreOutcome {
        guard let result else { return .unknown }
        if result == "ok" { return .ok }
        if result == "origin" { return .wrongOrigin }
        func reason(_ prefix: String) -> String? {
            guard result.hasPrefix(prefix) else { return nil }
            let name = String(result.dropFirst(prefix.count))
            return name.count <= 40 && name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" }) ? name : ""
        }
        if let r = reason("error:") { return .failedRolledBack(r) }
        if let r = reason("lost:") { return .failedDataLost(r) }
        return .unknown
    }

    /// JS для восстановления: заменяет localStorage, только если страница открыта с нужного источника.
    /// Прежнее содержимое сохраняется заранее; если запись прервалась (квота и т. п.), оно возвращается.
    /// Ответ: "ok", "origin", "error:<имя ошибки>" (прежние данные возвращены) или "lost:<имя>" (вернуть не удалось).
    public func restoreScript() -> String? {
        guard let lampa, let payload = try? JSONSerialization.data(withJSONObject: lampa.items, options: [.withoutEscapingSlashes]),
              let literal = Self.jsLiteral(String(decoding: payload, as: UTF8.self)), let origin = Self.jsLiteral(lampa.origin) else { return nil }
        return "(function(o,d){if(location.origin!==o)return 'origin';d=JSON.parse(d);var old={},i,k;"
            + "try{for(i=0;i<localStorage.length;i++){k=localStorage.key(i);old[k]=localStorage.getItem(k)}"
            + "localStorage.clear();for(k in d)localStorage.setItem(k,d[k]);return 'ok'}"
            + "catch(e){try{localStorage.clear();for(k in old)localStorage.setItem(k,old[k])}catch(e2){return 'lost:'+e2.name}return 'error:'+e.name}})(\(origin),\(literal))"
    }

    /// Строка в виде литерала JS (JSON-строка; U+2028/2029 экранируются).
    static func jsLiteral(_ s: String) -> String? {
        guard let d = try? JSONSerialization.data(withJSONObject: [s], options: [.withoutEscapingSlashes]),
              var arr = String(data: d, encoding: .utf8), arr.hasPrefix("["), arr.hasSuffix("]") else { return nil }
        arr.removeFirst(); arr.removeLast()
        return arr.replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }
}
