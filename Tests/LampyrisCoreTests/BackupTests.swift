import Foundation
import Testing
@testable import LampyrisCore

@Suite("Резервная копия настроек")
struct BackupTests {
    private func sample() -> Backup {
        var b = Backup()
        b.serverURL = "http://192.0.2.1:9118"
        b.history = ["http://192.0.2.1:9118", "https://example.org/lampa"]
        b.verboseLog = true
        b.autoUpdateCheck = false
        b.mpvConf = "hwdec=auto\n[bright]\nbrightness=20\n"
        b.lampa = Backup.Lampa(origin: "http://192.0.2.1:9118", items: ["a": "1", "plugins": "[{\"url\":\"x\"}]", "рус": "знач\u{2028}ение"])
        return b
    }

    @Test("запись и чтение возвращают то же самое")
    func roundTrip() throws {
        let data = try sample().jsonData(app: "0.1.5", platform: "macos")
        #expect(try Backup.parse(data) == sample())
    }

    @Test("не файл копии, пустая и более новая версия отклоняются")
    func rejects() {
        for text in ["", "не json", "[]", #"{"format":"другой","version":1}"#, #"{"format":"lampyris-backup"}"#, #"{"format":"lampyris-backup","version":99}"#] {
            #expect(throws: Backup.ParseError.self) { try Backup.parse(Data(text.utf8)) }
        }
    }

    @Test("плохой адрес, чужая схема и огромный mpv.conf отклоняются; лишние поля и BOM допустимы")
    func validation() throws {
        let head = #"{"format":"lampyris-backup","version":1,"#
        #expect(throws: Backup.ParseError.self) { try Backup.parse(Data((head + #""serverURL":"ftp://h"}"#).utf8)) }
        #expect(throws: Backup.ParseError.self) { try Backup.parse(Data((head + #""lampa":{"origin":"javascript:1","localStorage":{}}}"#).utf8)) }
        #expect(throws: Backup.ParseError.self) { try Backup.parse(Data((head + #""lampa":{"origin":"http://h/путь","localStorage":{}}}"#).utf8)) }
        #expect(throws: Backup.ParseError.self) { try Backup.parse(Data((head + #""lampa":{"origin":"http://h","localStorage":{"k":5}}}"#).utf8)) }
        let big = String(repeating: "a", count: Backup.maxMpvConfBytes + 1)
        #expect(throws: Backup.ParseError.self) { try Backup.parse(Data((head + #""mpvConf":"\#(big)"}"#).utf8)) }
        var ok = Data([0xEF, 0xBB, 0xBF])
        ok.append(Data((head + #""serverURL":"192.0.2.1:9118","новое":1}"#).utf8))
        #expect(try Backup.parse(ok).serverURL == "http://192.0.2.1:9118")
    }

    @Test("история ограничена, дубликаты и мусор отбрасываются")
    func history() throws {
        let items = (0..<20).map { "\"h\($0 % 3).example.org\"" } + ["5", "\"\""]
        let text = #"{"format":"lampyris-backup","version":1,"serverHistory":[\#(items.joined(separator: ","))]}"#
        let h = try Backup.parse(Data(text.utf8)).history
        #expect(h == ["http://h0.example.org", "http://h1.example.org", "http://h2.example.org"])
    }

    @Test("скрипт восстановления кодирует значения как литералы и проверяет источник")
    func restoreScript() throws {
        let s = try #require(sample().restoreScript())
        #expect(s.contains("location.origin!==o"))
        #expect(!s.contains("\u{2028}"))
        #expect(s.contains("\\\"plugins\\\"") || s.contains("plugins"))
        #expect(Backup.jsLiteral("a\"b</script>") == "\"a\\\"b</script>\"")
        var empty = Backup(); empty.lampa = nil
        #expect(empty.restoreScript() == nil)
    }

    @Test("скрипт восстановления сохраняет прежнее содержимое и возвращает его при сбое записи")
    func restoreScriptRollsBack() throws {
        let s = try #require(sample().restoreScript())
        // Прежнее содержимое читается до clear(), откат пишет его обратно, причина сообщается в ответе.
        #expect(s.range(of: "getItem")!.lowerBound < s.range(of: "localStorage.clear()")!.lowerBound)
        #expect(s.contains("catch(e)"))
        #expect(s.contains("'error:'+e.name"))
        #expect(s.contains("'lost:'+e2.name"))
    }

    @Test("ответ скрипта восстановления разбирается")
    func restoreResult() {
        #expect(Backup.parseRestoreResult("ok") == .ok)
        #expect(Backup.parseRestoreResult("origin") == .wrongOrigin)
        #expect(Backup.parseRestoreResult("error:QuotaExceededError") == .failedRolledBack("QuotaExceededError"))
        #expect(Backup.parseRestoreResult("lost:QuotaExceededError") == .failedDataLost("QuotaExceededError"))
        #expect(Backup.parseRestoreResult("error:<script>") == .failedRolledBack(""))
        #expect(Backup.parseRestoreResult(nil) == .unknown)
        #expect(Backup.parseRestoreResult("что-то") == .unknown)
    }

    @Test("ответ страницы разбирается; чужая схема источника отклоняется")
    func collected() {
        let l = Backup.parseCollected(#"{"origin":"http://192.0.2.1:9118","items":{"k":"v"}}"#)
        #expect(l == Backup.Lampa(origin: "http://192.0.2.1:9118", items: ["k": "v"]))
        #expect(Backup.parseCollected(#"{"origin":"null","items":{}}"#) == nil)
        #expect(Backup.parseCollected("мусор") == nil)
    }
}
