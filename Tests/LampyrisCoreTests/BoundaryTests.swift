import Foundation
import Testing
@testable import LampyrisCore

@Suite("Границы страницы и адресов")
struct BoundaryTests {
    @Test("страница сохраняет только безопасные параметры и встроенные профили")
    func pageConfig() {
        #expect(MpvConfig.isSafeForPage(MpvConfig.builtinProfiles))
        #expect(MpvConfig.isSafeForPage("volume=40\nsub-color=#FFFFFFFF\n[p]\nhwdec=auto-safe"))
        for text in ["http-proxy=http://127.0.0.1", "tls-verify=no", "sub-file=/tmp/private", "vf=lavfi=movie=/tmp/private", "af=lavfi=amovie=/tmp/private", "volume=nan", "volume=0x1p3", "volume=101", "speed=1e100", "scale=unknown", "vf-add=hflip", "include=/tmp/config", "[bad name]\nvolume=30"] {
            #expect(!MpvConfig.isSafeForPage(text), "\(text)")
        }
        // Ограничение моста не меняет возможности ручного файла.
        #expect(MpvConfig.parse("http-proxy=http://127.0.0.1").global.count == 1)
    }

    @Test("origin совпадает с браузером: регистр, порты, IPv6")
    func origins() {
        #expect(Backup.normalizedOrigin("http://EXAMPLE.org:80") == "http://example.org")
        #expect(Backup.normalizedOrigin("https://EXAMPLE.org:443/") == "https://example.org")
        #expect(Backup.normalizedOrigin("https://example.org:8443") == "https://example.org:8443")
        #expect(Backup.normalizedOrigin("http://[::1]:80") == "http://[::1]")
        #expect(Backup.normalizedOrigin("http://[::1]:9118") == "http://[::1]:9118")
        #expect(Backup.normalizedOrigin("http://example.org:99999") == nil)
        #expect(Backup.normalizedOrigin("http://example.org:0") == "http://example.org:0")
    }

    @Test("нативная загрузка не обращается к посторонним адресам")
    func mediaURLs() {
        #expect(RemoteMediaURL.subtitle(URL(string: "https://a.strem.io/sub.srt")!))
        #expect(RemoteMediaURL.artwork(URL(string: "https://image.tmdb.org/t/p/w500/p.jpg")!))
        for text in ["http://a.strem.io/s", "https://strem.io.evil.example/s", "https://127.0.0.1/s", "https://a.strem.io:8443/s", "https://user:pass@a.strem.io/s", "file:///tmp/s"] {
            #expect(!RemoteMediaURL.subtitle(URL(string: text)!))
            #expect(!RemoteMediaURL.artwork(URL(string: text)!))
        }
    }
}
