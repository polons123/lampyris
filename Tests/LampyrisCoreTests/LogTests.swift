import Testing
@testable import LampyrisCore

@Suite("Журнал: сокращение адресов")
struct LogTests {
    @Test("адрес сокращается до схемы и хоста, ключи и токены не остаются")
    func urlsAreTrimmed() {
        let line = Log.sanitize("GET https://jackett.example.org/api/v2.0/indexers/all/results?apikey=SECRET123&Query=Fall done")
        #expect(line == "GET https://jackett.example.org/… done")
        #expect(!line.contains("SECRET123"))
    }

    @Test("несколько адресов в строке, порт сохраняется")
    func severalURLs() {
        let line = Log.sanitize("a http://192.168.1.10:9118/path?token=abc b https://cdn.example.com/x/y.m3u8?sig=zzz c")
        #expect(line == "a http://192.168.1.10:9118/… b https://cdn.example.com/… c")
    }

    @Test("текст без адресов не меняется")
    func plainTextUntouched() {
        let text = "[mpv] событий за 5 с: от mpv 138, на страницу 31"
        #expect(Log.sanitize(text) == text)
    }

    @Test("параметры сразу после хоста, учётные данные, решётка не остаются")
    func credentialsAndBareQuery() {
        #expect(Log.sanitize("GET https://host.example?token=SECRET done") == "GET https://host.example/… done")
        #expect(Log.sanitize("https://host.example#key=SECRET") == "https://host.example/…")
        #expect(Log.sanitize("https://user:pa55@host.example:8443/path?x=1") == "https://host.example:8443/…")
        #expect(Log.sanitize("http://user@10.0.0.5?k=v") == "http://10.0.0.5/…")
    }
}
