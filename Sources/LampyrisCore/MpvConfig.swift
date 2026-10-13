import Foundation

/// Пользовательский mpv.conf: общие опции и профили `[имя]`. Файл лежит в
/// ~/Library/Application Support/Lampyris/ и меняется только пользователем.
public struct MpvConfig {
    public struct Entry: Equatable {
        public let name: String
        public let value: String
        /// Суффикс списка: add, append, set, pre, clr, remove.
        public let op: String?
    }

    public struct Ignored: Equatable {
        public let line: Int
        public let text: String
        public let reason: String
    }

    public var global: [Entry] = []
    public var profiles: [String: [Entry]] = [:]
    /// Имена профилей в порядке появления в файле.
    public var profileNames: [String] = []
    public var ignored: [Ignored] = []

    public static let maxBytes = 64 * 1024

    /// Опции, которые запускают код, читают чужие файлы или ломают встроенный рендер.
    /// `profile` запрещён: профили выбираются настройкой приложения, а не из файла.
    private static let blocked: Set<String> = [
        "include", "config", "config-dir", "profile", "script", "scripts", "load-scripts",
        "js-memory-limit", "input-conf", "input-commands", "input-ipc-server", "input-ipc-client",
        "ytdl", "ytdl-format", "ytdl-raw-options", "vo", "wid", "gpu-context", "gpu-api",
        "force-window", "idle", "player-operation-mode", "osc", "input-default-bindings",
        "input-vo-keyboard", "keep-open", "config-file", "scripts-append", "log-file",
        "watch-later-directory", "write-filename-in-watch-later-config", "save-position-on-quit",
        "icc-cache-dir", "gpu-shader-cache-dir", "cache-dir", "dump-stats", "screenshot-directory",
        "screenshot-template", "stream-dump", "record-file", "o",
    ]

    private static let listOps: Set<String> = ["add", "append", "set", "pre", "clr", "remove"]

    public static var fileURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Lampyris", isDirectory: true).appendingPathComponent("mpv.conf")
    }

    public static func readText() -> String {
        (try? String(contentsOf: fileURL, encoding: .utf8)) ?? ""
    }

    public static func writeText(_ text: String) throws {
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try (text.hasSuffix("\n") ? text : text + "\n").write(to: fileURL, atomically: true, encoding: .utf8)
    }

    public static func load() -> MpvConfig { parse(readText()) }

    /// Все записи применяемого набора: общие, затем выбранного профиля.
    public func entries(profile: String?) -> [Entry] {
        global + (profile.flatMap { profiles[$0] } ?? [])
    }

    public static func parse(_ text: String) -> MpvConfig {
        var cfg = MpvConfig()
        var section: String?  // nil — общие опции
        var sectionOK = true
        let lineRe = try! NSRegularExpression(pattern: #"^(?:--)?([A-Za-z0-9][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$"#)
        let suffixRe = try! NSRegularExpression(pattern: #"^(.*)-([a-z]+)$"#)
        let nameRe = try! NSRegularExpression(pattern: #"^[A-Za-z0-9_.-]+$"#)

        for (index, raw) in text.components(separatedBy: .newlines).enumerated() {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            func skip(_ reason: String) { cfg.ignored.append(Ignored(line: index + 1, text: line, reason: reason)) }

            if line.hasPrefix("[") && line.hasSuffix("]") {
                let name = String(line.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
                if name == "default" { section = nil; sectionOK = true; continue }
                let full = NSRange(name.startIndex..., in: name)
                if nameRe.firstMatch(in: name, range: full) == nil {
                    section = nil
                    sectionOK = false
                    skip("недопустимое имя профиля")
                    continue
                }
                section = name
                sectionOK = true
                if cfg.profiles[name] == nil { cfg.profiles[name] = []; cfg.profileNames.append(name) }
                continue
            }
            if !sectionOK { skip("внутри профиля с недопустимым именем"); continue }

            let range = NSRange(line.startIndex..., in: line)
            guard let m = lineRe.firstMatch(in: line, range: range), let nr = Range(m.range(at: 1), in: line) else {
                skip("не похоже на «опция=значение»")
                continue
            }
            var name = line[nr].lowercased()
            var value: String
            if let vr = Range(m.range(at: 2), in: line) {
                value = unquote(line[vr].trimmingCharacters(in: .whitespaces))
            } else if name.hasPrefix("no-") {
                name = String(name.dropFirst(3))
                value = "no"
            } else {
                value = "yes"
            }
            var op: String?
            if let sm = suffixRe.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)),
               let a = Range(sm.range(at: 1), in: name), let b = Range(sm.range(at: 2), in: name),
               listOps.contains(String(name[b])) {
                op = String(name[b])
                name = String(name[a])
            }
            if blocked.contains(name) { skip("опция запрещена"); continue }
            if value.contains("\0") { skip("недопустимые символы"); continue }
            let entry = Entry(name: name, value: value, op: op)
            if let s = section { cfg.profiles[s, default: []].append(entry) } else { cfg.global.append(entry) }
        }
        return cfg
    }

    private static func unquote(_ v: String) -> String {
        guard v.count >= 2, let f = v.first, f == v.last, f == "\"" || f == "'" else { return v }
        return String(v.dropFirst().dropLast())
    }
}
