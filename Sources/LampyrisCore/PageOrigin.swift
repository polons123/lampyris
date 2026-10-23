import Foundation

/// Источник страницы в том виде, в каком его видит `location.origin` в JS (порт по умолчанию опускается).
/// Нужен, чтобы скрипт, который приложение выполняет на странице, сам сверял источник документа.
public enum PageOrigin {
    private static let safe = try! NSRegularExpression(pattern: #"^https?://[A-Za-z0-9.\-\[\]:]+$"#)

    /// nil для адресов без хоста и для хостов с необычными символами (их в скрипт не подставляем).
    public static func string(for url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", let host = url.host?.lowercased() else { return nil }
        let isDefault = url.port == nil || url.port == (scheme == "https" ? 443 : 80)
        let hostPart = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        let origin = "\(scheme)://\(hostPart)" + (isDefault ? "" : ":\(url.port!)")
        return safe.firstMatch(in: origin, range: NSRange(origin.startIndex..., in: origin)) != nil ? origin : nil
    }

    /// Скрипт, который выполняет `body` (выражение JS) только на странице с источником `origin`, иначе возвращает 'origin'.
    public static func guarded(_ body: String, origin: String) -> String {
        "(function(){if(location.origin!==\"\(origin)\")return 'origin';return \(body)})()"
    }
}
