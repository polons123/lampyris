import CryptoKit
import Foundation

/// Логика проверки обновлений без UI и сети: версии, разбор ответа GitHub, контрольные суммы и подпись релиза.
/// Порядок доверия: подпись Ed25519 файла SHA256SUMS.txt (открытый ключ вшит в приложение) → SHA-256 нужного файла из этого списка.
public enum Update {
    /// Открытый ключ Ed25519 (32 байта, hex), которым подписан SHA256SUMS.txt каждого релиза. Закрытый ключ лежит только в секретах GitHub.
    public static let publicKeyHex = "6ec850da7be700aed5b6a5650da56f2731d21f92aaa440a39129ba4f71fbc54e"

    public static let repo = "polons123/lampyris"
    public static let latestURL = "https://api.github.com/repos/\(repo)/releases/latest"
    public static let downloadBase = "https://github.com/\(repo)/releases/download"
    /// Предел размера скачиваемого файла и служебных ответов.
    public static let maxPackageBytes = 400_000_000
    public static let maxMetaBytes = 1_000_000

    /// Версия вида 1.2.3 (допускается префикс v).
    public static func parseVersion(_ s: String) -> [Int]? {
        let t = s.hasPrefix("v") ? String(s.dropFirst()) : s
        let parts = t.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }) else { return nil }
        let nums = parts.compactMap { Int($0) }
        return nums.count == 3 && nums.allSatisfy { $0 >= 0 } ? nums : nil
    }

    public static func isNewer(_ candidate: String, than current: String) -> Bool {
        guard let a = parseVersion(candidate), let b = parseVersion(current) else { return false }
        return !a.lexicographicallyPrecedes(b) && a != b
    }

    public struct Release: Equatable, Sendable {
        public let version: String
        public let notes: String
        public let pageURL: String
    }

    /// Ответ GET /releases/latest: нужны только тег, описание и страница релиза (адреса файлов строим сами).
    public static func parseRelease(_ data: Data) -> Release? {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let tag = obj["tag_name"] as? String, parseVersion(tag) != nil else { return nil }
        if (obj["draft"] as? Bool) == true || (obj["prerelease"] as? Bool) == true { return nil }
        let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
        return Release(version: version, notes: (obj["body"] as? String) ?? "",
                       pageURL: (obj["html_url"] as? String) ?? "https://github.com/\(repo)/releases")
    }

    public static func assetURL(base: String = downloadBase, version: String, name: String) -> URL? {
        URL(string: "\(base)/v\(version)/\(name)")
    }

    /// Имя файла обновления для macOS: Lampyris-<версия>-arm64.zip или -intel.zip.
    public static func macAssetName(version: String, arm64: Bool) -> String {
        "Lampyris-\(version)-\(arm64 ? "arm64" : "intel").zip"
    }

    /// Строки вида «<sha256>  <имя>» (формат shasum); имя может начинаться с «*».
    public static func parseSums(_ text: String) -> [String: String] {
        var result: [String: String] = [:]
        for line in text.split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
            guard parts.count == 2, parts[0].count == 64, parts[0].allSatisfy(\.isHexDigit) else { continue }
            var name = parts[1].trimmingCharacters(in: .whitespaces)
            if name.hasPrefix("*") { name.removeFirst() }
            result[name] = parts[0].lowercased()
        }
        return result
    }

    public static func verifySignature(message: Data, signature: Data, publicKeyHex: String = Update.publicKeyHex) -> Bool {
        guard signature.count == 64, let keyData = hexData(publicKeyHex),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData) else { return false }
        return key.isValidSignature(signature, for: message)
    }

    public static func sha256Hex(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func hexData(_ s: String) -> Data? {
        guard s.count % 2 == 0 else { return nil }
        var data = Data(capacity: s.count / 2)
        var index = s.startIndex
        while index < s.endIndex {
            let next = s.index(index, offsetBy: 2)
            guard let byte = UInt8(s[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        return data
    }
}
