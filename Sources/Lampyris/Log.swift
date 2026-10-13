import Foundation
import os

enum LogLevel: String, Sendable {
    case info = "INFO", warn = "WARN", error = "ERROR"
}

/// Журнал приложения.
/// - Всегда: короткие сообщения приложения идут в системный журнал macOS (Console.app, subsystem io.github.polons123.lampyris).
/// - «Подробный журнал» (меню Lampa, по умолчанию выключен): дополнительно всё, что помечено verboseOnly (консоль страницы, предупреждения mpv,
///   статистика), и всё записывается в ~/Library/Logs/Lampyris/lampa.log с ротацией. В файл адреса сокращаются до хоста:
///   в ссылках бывают ключи и токены.
/// - LAMPA_DEBUG=1: подробный режим плюс вывод в стандартный вывод (для запуска из терминала).
enum Log {
    private static let logger = Logger(subsystem: "io.github.polons123.lampyris", category: "app")
    private static let queue = DispatchQueue(label: "io.github.polons123.lampyris.log")
    private static let defaultsKey = "verboseLog"
    private static let debugEnv = ProcessInfo.processInfo.environment["LAMPA_DEBUG"] != nil
    private static let verboseFlag = OSAllocatedUnfairLock(initialState: UserDefaults.standard.bool(forKey: "verboseLog"))
    private static let maxBytes = 2_000_000
    private static let keepFiles = 3

    static var isVerbose: Bool { debugEnv || verboseFlag.withLock { $0 } }
    static var isVerboseSetting: Bool { verboseFlag.withLock { $0 } }

    static var folderURL: URL {
        FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs/Lampyris", isDirectory: true)
    }

    static func setVerbose(_ on: Bool) {
        verboseFlag.withLock { $0 = on }
        UserDefaults.standard.set(on, forKey: defaultsKey)
        if on { log(.info, "app", "подробный журнал включён (в файле адреса сокращены до хоста)") }
    }

    static func log(_ level: LogLevel, _ category: String, _ message: String, verboseOnly: Bool = false) {
        let verbose = isVerbose
        if verboseOnly && !verbose { return }
        if debugEnv { print("[\(category)] \(message)") }
        if !verboseOnly {
            let line = "[\(category)] \(message)"
            switch level {
            case .info: logger.info("\(line, privacy: .public)")
            case .warn: logger.warning("\(line, privacy: .public)")
            case .error: logger.error("\(line, privacy: .public)")
            }
        }
        guard verbose else { return }
        let text = sanitize("\(timestamp()) \(level.rawValue) [\(category)] \(message)\n")
        queue.async { append(text) }
    }

    // MARK: файл

    private static func timestamp() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }

    /// Адреса http(s) сокращаются до схемы и хоста: токены и ключи бывают и в пути, и в запросе.
    static func sanitize(_ s: String) -> String {
        guard let re = try? NSRegularExpression(pattern: #"(https?://[^/\s"'<>)\]]+)[^\s"'<>)\]]*"#) else { return s }
        return re.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: "$1/…")
    }

    private static func append(_ text: String) {
        let fm = FileManager.default
        let dir = folderURL
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("lampa.log")
        if let size = (try? fm.attributesOfItem(atPath: file.path))?[.size] as? Int, size > maxBytes { rotate(dir) }
        if !fm.fileExists(atPath: file.path) { fm.createFile(atPath: file.path, contents: nil) }
        guard let handle = try? FileHandle(forWritingTo: file) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data(text.utf8))
    }

    private static func rotate(_ dir: URL) {
        let fm = FileManager.default
        for i in stride(from: keepFiles - 1, through: 1, by: -1) {
            let from = dir.appendingPathComponent("lampa.\(i).log"), to = dir.appendingPathComponent("lampa.\(i + 1).log")
            try? fm.removeItem(at: to)
            if fm.fileExists(atPath: from.path) { try? fm.moveItem(at: from, to: to) }
        }
        let first = dir.appendingPathComponent("lampa.1.log")
        try? fm.removeItem(at: first)
        try? fm.moveItem(at: dir.appendingPathComponent("lampa.log"), to: first)
        // самый старый (keepFiles+1) не храним
        try? fm.removeItem(at: dir.appendingPathComponent("lampa.\(keepFiles + 1).log"))
    }
}
