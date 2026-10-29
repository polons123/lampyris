import Foundation

/// Только сервисы, от которых плеер ожидает субтитры и постеры; без учётных данных и нестандартных портов.
public enum RemoteMediaURL {
    public static func subtitle(_ url: URL) -> Bool {
        guard valid(url), let host = url.host?.lowercased() else { return false }
        return host == "strem.io" || host.hasSuffix(".strem.io")
    }

    public static func artwork(_ url: URL) -> Bool {
        valid(url) && url.host?.lowercased() == "image.tmdb.org"
    }

    private static func valid(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.user == nil && url.password == nil && (url.port == nil || url.port == 443)
    }
}
