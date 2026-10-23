import Testing
import Foundation
@testable import LampyrisCore

@Suite("Источник страницы для скриптов")
struct PageOriginTests {
    @Test("порт по умолчанию опускается, нестандартный остаётся, регистр хоста понижается")
    func ports() {
        #expect(PageOrigin.string(for: URL(string: "https://Example.com/x")!) == "https://example.com")
        #expect(PageOrigin.string(for: URL(string: "https://example.com:443/")!) == "https://example.com")
        #expect(PageOrigin.string(for: URL(string: "http://192.0.2.1:9118/path?q=1")!) == "http://192.0.2.1:9118")
        #expect(PageOrigin.string(for: URL(string: "http://192.0.2.1:80")!) == "http://192.0.2.1")
    }

    @Test("не http(s) и адреса без хоста отклоняются")
    func rejected() {
        #expect(PageOrigin.string(for: URL(string: "file:///tmp/x")!) == nil)
        #expect(PageOrigin.string(for: URL(string: "about:blank")!) == nil)
        #expect(PageOrigin.string(for: URL(string: "javascript:alert(1)")!) == nil)
    }

    @Test("скрипт сверяет location.origin")
    func guardedScript() {
        let s = PageOrigin.guarded("f()", origin: "https://example.com")
        #expect(s == "(function(){if(location.origin!==\"https://example.com\")return 'origin';return f()})()")
    }
}
