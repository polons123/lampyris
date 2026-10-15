import CryptoKit
import Foundation
import Testing
@testable import LampyrisCore

@Suite("Обновления: версии, подпись, контрольные суммы")
struct UpdateTests {
    @Test("версия разбирается строго: три числа, префикс v допустим")
    func versionParsing() {
        #expect(Update.parseVersion("v0.1.4") == [0, 1, 4])
        #expect(Update.parseVersion("1.20.3") == [1, 20, 3])
        for bad in ["1.2", "1.2.x", "1.2.3-beta", "-1.2.3", "+1.2.3", "", "1..3"] { #expect(Update.parseVersion(bad) == nil) }
    }

    @Test("сравнение версий числовое, а не строковое; понижение и равенство не обновление")
    func isNewer() {
        #expect(Update.isNewer("0.1.5", than: "0.1.4"))
        #expect(Update.isNewer("0.1.10", than: "0.1.9"))
        #expect(Update.isNewer("1.0.0", than: "0.9.9"))
        #expect(!Update.isNewer("0.1.4", than: "0.1.4"))
        #expect(!Update.isNewer("0.1.3", than: "0.1.4"))
        #expect(!Update.isNewer("мусор", than: "0.1.4"))
    }

    @Test("ответ GitHub: берутся тег, описание и страница; черновики и предварительные отбрасываются")
    func parseRelease() {
        let json = #"{"tag_name":"v0.1.5","body":"Что нового","html_url":"https://github.com/x/y/releases/tag/v0.1.5"}"#
        let r = Update.parseRelease(Data(json.utf8))
        #expect(r?.version == "0.1.5")
        #expect(r?.notes == "Что нового")
        #expect(Update.parseRelease(Data(#"{"tag_name":"nightly"}"#.utf8)) == nil)
        #expect(Update.parseRelease(Data(#"{"tag_name":"v0.1.5","prerelease":true}"#.utf8)) == nil)
        #expect(Update.parseRelease(Data("не json".utf8)) == nil)
    }

    @Test("имена и адреса файлов релиза строятся из версии, а не берутся из ответа")
    func assetNames() {
        #expect(Update.macAssetName(version: "0.1.5", arm64: true) == "Lampyris-0.1.5-arm64.zip")
        #expect(Update.macAssetName(version: "0.1.5", arm64: false) == "Lampyris-0.1.5-intel.zip")
        #expect(Update.assetURL(version: "0.1.5", name: "a.zip")?.absoluteString == "https://github.com/polons123/lampyris/releases/download/v0.1.5/a.zip")
    }

    @Test("SHA256SUMS: формат shasum, имя с «*», мусорные строки пропускаются")
    func parseSums() {
        let h = String(repeating: "ab", count: 32)
        let sums = Update.parseSums("\(h)  Lampyris-0.1.5-arm64.zip\n\(h.uppercased()) *Lampyris-0.1.5-intel.zip\nкороткая  строка\n")
        #expect(sums["Lampyris-0.1.5-arm64.zip"] == h)
        #expect(sums["Lampyris-0.1.5-intel.zip"] == h)
        #expect(sums.count == 2)
    }

    @Test("подпись Ed25519: верная проходит, чужое сообщение, обрезанная подпись и неверный ключ — нет")
    func signature() throws {
        let key = Curve25519.Signing.PrivateKey()
        let pub = key.publicKey.rawRepresentation.map { String(format: "%02x", $0) }.joined()
        let message = Data("sums".utf8)
        let sig = try key.signature(for: message)
        #expect(Update.verifySignature(message: message, signature: sig, publicKeyHex: pub))
        #expect(!Update.verifySignature(message: Data("другое".utf8), signature: sig, publicKeyHex: pub))
        #expect(!Update.verifySignature(message: message, signature: sig.dropLast(), publicKeyHex: pub))
        #expect(!Update.verifySignature(message: message, signature: sig, publicKeyHex: "не hex"))
        #expect(Update.hexData(Update.publicKeyHex).flatMap { try? Curve25519.Signing.PublicKey(rawRepresentation: $0) } != nil)
    }

    @Test("SHA-256 файла")
    func sha256File() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("lampyris-sha-\(UUID().uuidString)")
        try Data("abc".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        #expect(try Update.sha256Hex(of: url) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}
