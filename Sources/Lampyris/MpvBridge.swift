import CMpv
import Foundation
import WebKit
import LampyrisCore

/// Мост JS ↔ mpv. Страница вызывает `webkit.messageHandlers.mpv.postMessage({m, a})`,
/// ответ приходит промисом; события mpv уходят в `window.__mpvEvent(...)`.
@MainActor
final class MpvBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let player: MpvPlayer
    private weak var webView: WKWebView?
    /// Источники («схема://хост:порт»), которым разрешено управлять mpv: главный кадр страницы нашего
    /// сервера Lampa, включая хосты, на которые сервер перенаправил при загрузке (задаёт WebViewController).
    private let trustedOrigins: @MainActor () -> Set<String>
    private var nowPlaying: NowPlaying?

    /// Страница (в том числе код плагинов) — недоверенная сторона, поэтому мост принимает только
    /// то, что нужно плееру: перемотку/остановку, несколько свойств, чтение свойств и открытие http(s)/file.
    private static let allowedCommands: Set<String> = ["seek", "stop"]
    private static let allowedSetProperties: Set<String> = ["aid", "sid", "vid", "mute", "pause", "speed", "volume", "audio-delay", "sub-delay",
                                                                  "sub-scale", "sub-pos", "sub-color", "sub-border-style", "sub-back-color",
                                                                  "sub-border-size", "sub-shadow-offset", "sub-font", "sub-margin-y",
                                                                  "gamma", "brightness", "contrast", "saturation"]
    private static let allowedOpenOptions: Set<String> = ["sid", "demuxer-readahead-secs", "demuxer-max-bytes"]
    private static let allowedSchemes: Set<String> = ["http", "https", "file"]
    /// Файлы, выбранные пользователем в самом приложении (меню, перетаскивание): только их путь можно открыть через `file://`.
    private var localFiles: Set<String> = []
    /// Свойства, которые странице разрешено читать (всё, что использует mpvTube.js и playbackCover.js).
    private static let allowedGetProperties: Set<String> = [
        "pause", "time-pos", "duration", "speed", "volume", "audio-delay", "sub-delay", "track-list", "video-params",
        "audio-params", "container-fps", "estimated-vf-fps", "video-bitrate", "audio-bitrate", "video-codec",
        "audio-codec-name", "hwdec-current", "frame-drop-count", "decoder-frame-drop-count", "vo-delayed-frame-count",
        "avsync", "demuxer-cache-state", "demuxer-cache-time", "gamma", "brightness", "contrast", "saturation",
        "cache-speed", "chapter-list",
    ]
    /// Потолок размера ответов внешних сервисов (TheIntroDB, субтитры).
    private static let maxResponseBytes = 2_000_000
    private static let optionValue = try! NSRegularExpression(pattern: #"^[A-Za-z0-9.]+$"#)

    /// Подбор частоты экрана под видео (nil или 0 — вернуть прежний режим); задаёт WebViewController.
    var displayRate: (@MainActor (Double?) -> Void)?

    init(player: MpvPlayer, webView: WKWebView, trustedOrigins: @escaping @MainActor () -> Set<String>) {
        self.player = player
        self.webView = webView
        self.trustedOrigins = trustedOrigins
        super.init()
        player.observe([
            ("time-pos", MPV_FORMAT_DOUBLE), ("duration", MPV_FORMAT_DOUBLE),
            ("demuxer-cache-time", MPV_FORMAT_DOUBLE), ("pause", MPV_FORMAT_FLAG),
            ("paused-for-cache", MPV_FORMAT_FLAG), ("eof-reached", MPV_FORMAT_FLAG),
            ("hwdec-current", MPV_FORMAT_STRING), ("video-params", MPV_FORMAT_NODE),
            ("track-list", MPV_FORMAT_NODE), ("aid", MPV_FORMAT_STRING), ("sid", MPV_FORMAT_STRING),
        ])
        player.onMessage = { [weak self] msg in self?.forward(msg) }
        nowPlaying = NowPlaying(player: player) { [weak self] cmd in
            self?.webView?.evaluateJavaScript("window.__mpvRemote && window.__mpvRemote('\(cmd)')", completionHandler: nil)
        }
        do {
            statsTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, self.rawCount > 0 else { return }
                    Log.log(.info, "mpv", "события позиции за 5 с: от mpv \(self.rawCount), на страницу time-pos \(self.sentCount)", verboseOnly: true)
                    self.rawCount = 0
                    self.sentCount = 0
                }
            }
        }
    }

    /// Частые свойства (mpv обновляет их на каждый кадр) отправляем на страницу не чаще чем раз в 150 мс.
    /// Скачок значения (перемотка) уходит сразу, подавленное последнее значение досылается после паузы.
    private static let throttledProperties: Set<String> = ["time-pos", "demuxer-cache-time"]
    private static let throttleInterval = 0.15
    private static let throttleJump = 0.5
    private var lastSent: [String: (time: CFAbsoluteTime, value: Double?)] = [:]
    private var pendingMessages: [String: [String: Any]] = [:]
    private var flushScheduled: Set<String> = []
    /// Счётчики для LAMPA_DEBUG: сколько событий пришло от mpv и сколько ушло на страницу.
    private var rawCount = 0
    private var sentCount = 0
    private var statsTimer: Timer?

    private var lastLog = ""

    /// Страница перезагружена или заменена: плеер, которым она управляла, останавливаем (иначе звук остаётся без интерфейса).
    func pageDidReset() {
        player.stop()
        displayRate?(nil)
        nowPlaying?.clear()
        localFiles.removeAll()
        lastSent.removeAll()
        pendingMessages.removeAll()
    }

    private func forward(_ msg: [String: Any]) {
        nowPlaying?.handle(msg)
        if msg["event"] as? String == "log-message" {
            // Предупреждения и ошибки mpv (декодер, сеть, субтитры) — только в режиме отладки, без подряд идущих повторов.
            if Log.isVerbose, let text = msg["text"] as? String, !text.isEmpty {
                let level = msg["level"] as? String ?? ""
                let line = "mpv/\(msg["prefix"] as? String ?? ""): \(level): \(text)"
                if line != lastLog {
                    Log.log(level == "error" || level == "fatal" ? .error : .warn, "mpv/\(msg["prefix"] as? String ?? "")", "\(level): \(text)", verboseOnly: true)
                    lastLog = line
                }
            }
            return
        }
        if msg["event"] as? String == "property-change", let name = msg["name"] as? String, Self.throttledProperties.contains(name) {
            rawCount += 1
            let now = CFAbsoluteTimeGetCurrent()
            let value = msg["data"] as? Double
            if let last = lastSent[name] {
                let jump = (value != nil && last.value != nil) ? abs(value! - last.value!) : 0
                if now - last.time < Self.throttleInterval && jump < Self.throttleJump {
                    pendingMessages[name] = msg
                    if flushScheduled.insert(name).inserted {
                        DispatchQueue.main.asyncAfter(deadline: .now() + Self.throttleInterval) { [weak self] in
                            MainActor.assumeIsolated { self?.flush(name) }
                        }
                    }
                    return
                }
            }
            lastSent[name] = (now, value)
            pendingMessages[name] = nil
        }
        send(msg)
    }

    private func flush(_ name: String) {
        flushScheduled.remove(name)
        guard let msg = pendingMessages.removeValue(forKey: name) else { return }
        lastSent[name] = (CFAbsoluteTimeGetCurrent(), msg["data"] as? Double)
        send(msg)
    }

    private func send(_ msg: [String: Any]) {
        guard let json = Self.json(msg) else { return }
        if msg["name"] as? String == "time-pos" { sentCount += 1 }
        webView?.evaluateJavaScript("window.__mpvEvent && window.__mpvEvent(\(json))", completionHandler: nil)
    }

    /// JSON без NaN/inf (их JSONSerialization не принимает).
    private static func json(_ value: Any) -> String? {
        func clean(_ v: Any) -> Any {
            switch v {
            case let d as Double: return d.isFinite ? d : NSNull()
            case let a as [Any]: return a.map(clean)
            case let m as [String: Any]: return m.mapValues(clean)
            default: return v
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: clean(value)) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Возвращает JSON-строку ответа сервиса (или {"error": …}).
    private static func fetchIntroDB(tmdb: Int, season: Int?, episode: Int?) async -> String {
        var c = URLComponents(string: "https://api.theintrodb.org/v3/media")!
        var items = [URLQueryItem(name: "tmdb_id", value: String(tmdb))]
        if let season, let episode, season > 0, episode > 0 {
            items.append(URLQueryItem(name: "season", value: String(season)))
            items.append(URLQueryItem(name: "episode", value: String(episode)))
        }
        c.queryItems = items
        var request = URLRequest(url: c.url!, timeoutInterval: 6)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else { return "{\"error\": \"HTTP \(status)\"}" }
            guard data.count <= maxResponseBytes else { return "{\"error\": \"response too large\"}" }
            return String(data: data, encoding: .utf8) ?? "{\"error\": \"encoding\"}"
        } catch {
            return "{\"error\": \"\(error.localizedDescription.replacingOccurrences(of: "\"", with: "'"))\"}"
        }
    }

    private static let imdbId = try! NSRegularExpression(pattern: #"^tt\d{6,10}$"#)

    /// Возвращает JSON-строку ответа аддона (или {"error": …}).
    private static func searchSubtitles(imdb: String, season: Int, episode: Int) async -> String {
        let path = season > 0 && episode > 0 ? "series/\(imdb):\(season):\(episode)" : "movie/\(imdb)"
        guard let url = URL(string: "https://opensubtitles-v3.strem.io/subtitles/\(path).json") else { return "{\"error\": \"url\"}" }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else { return "{\"error\": \"HTTP \(status)\"}" }
            guard data.count <= maxResponseBytes else { return "{\"error\": \"response too large\"}" }
            return String(data: data, encoding: .utf8) ?? "{\"error\": \"encoding\"}"
        } catch {
            return "{\"error\": \"\(error.localizedDescription.replacingOccurrences(of: "\"", with: "'"))\"}"
        }
    }

    /// Скачивает субтитры (только https с *.strem.io, до 3 МБ) в кэш и подключает к mpv.
    private func loadSubtitle(urlString: String, title: String, lang: String) async -> [String: Any] {
        guard let url = URL(string: urlString), url.scheme == "https", let host = url.host?.lowercased(),
              host == "strem.io" || host.hasSuffix(".strem.io") else { return ["ok": false, "error": tr("недопустимый адрес", "invalid address")] }
        let generation = player.openGeneration
        do {
            let (data, response) = try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 15))
            guard (response as? HTTPURLResponse)?.statusCode == 200, data.count > 0, data.count <= 3_000_000 else {
                return ["ok": false, "error": tr("не удалось скачать", "could not download")]
            }
            let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("Lampyris/subs", isDirectory: true)
            try FileManager.default.createDirectory(at: caches, withIntermediateDirectories: true)
            let id = url.lastPathComponent.filter { $0.isLetter || $0.isNumber }
            let file = caches.appendingPathComponent("\(id.isEmpty ? UUID().uuidString : id).srt")
            try data.write(to: file)
            // За время скачивания могли открыть другое видео: чужие субтитры не подключаем.
            guard generation == player.openGeneration else { return ["ok": false, "error": tr("видео уже сменилось", "the video has already changed")] }
            let cleanTitle = String(title.filter { !$0.isNewline }.prefix(120))
            let cleanLang = String(lang.filter { $0.isLetter }.prefix(3))
            guard player.addSubtitle(path: file.path, title: cleanTitle, lang: cleanLang) else { return ["ok": false, "error": tr("mpv не принял файл", "mpv did not accept the file")] }
            return ["ok": true]
        } catch {
            return ["ok": false, "error": error.localizedDescription]
        }
    }

    /// Видео и звук, которые приложение умеет открывать с диска.
    static let localExtensions: Set<String> = ["mkv", "mp4", "m4v", "mov", "avi", "webm", "ts", "m2ts", "mts", "mpg", "mpeg", "wmv", "flv", "ogv",
                                               "3gp", "mp3", "m4a", "aac", "flac", "ogg", "opus", "wav", "wma", "ac3", "dts", "mka"]

    /// Запоминает выбранные файлы и просит страницу открыть их плейлистом Lampa. `done` получает ответ страницы ("ok" или причину отказа).
    func openLocalFiles(_ urls: [URL], done: @escaping @MainActor (String) -> Void) {
        let files = urls.filter { $0.isFileURL && Self.localExtensions.contains($0.pathExtension.lowercased()) }
            .map(\.standardizedFileURL)
        guard !files.isEmpty else { return done("no-files") }
        let items: [[String: String]] = files.map { ["title": $0.deletingPathExtension().lastPathComponent, "url": $0.absoluteString] }
        guard let json = Self.json(items) else { return done("error") }
        // Пути запоминаются только после того, как страница ответила «ok»: недоверенная страница их не увидит.
        guard let web = webView else { return done("no-page") }
        let paths = files.map(\.path)
        localFiles.formUnion(paths)
        web.evaluateJavaScript("window.__lampyrisOpenLocal ? window.__lampyrisOpenLocal(\(json)) : 'no-lampa'") { [weak self] result, _ in
            MainActor.assumeIsolated {
                let answer = (result as? String) ?? "error"
                if answer != "ok" { self?.localFiles.subtract(paths) }
                done(answer)
            }
        }
    }

    private func isTrusted(_ frame: WKFrameInfo) -> Bool {
        frame.isMainFrame && trustedOrigins().contains(Self.originKey(frame.securityOrigin))
    }

    static func originKey(_ o: WKSecurityOrigin) -> String {
        let port = o.port == 0 ? (o.protocol == "https" ? 443 : 80) : o.port
        return "\(o.protocol)://\(o.host):\(port)"
    }

    static func originKey(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
        return "\(scheme)://\(host):\(url.port ?? (scheme == "https" ? 443 : 80))"
    }

    private static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard isTrusted(message.frameInfo) else {
            Log.log(.warn, "mpv", "сообщение отклонено: недоверенный источник \(message.frameInfo.securityOrigin.host)")
            replyHandler(nil, "forbidden origin")
            return
        }
        guard let body = message.body as? [String: Any], let method = body["m"] as? String else {
            replyHandler(nil, "bad message")
            return
        }
        let args = body["a"] as? [Any] ?? []
        switch method {
        case "available":
            replyHandler(true, nil)
        case "open":
            guard var url = args.first as? String, let parsed = URL(string: url), let scheme = parsed.scheme?.lowercased(),
                  Self.allowedSchemes.contains(scheme) else { return replyHandler(nil, "bad url") }
            if scheme == "file" {
                // Страница и плагины не выбирают файлы: открывается только то, что пользователь выбрал в приложении.
                guard localFiles.contains(parsed.standardizedFileURL.path) else {
                    Log.log(.warn, "mpv", "локальный файл отклонён: не выбран в приложении")
                    return replyHandler(nil, "file not allowed")
                }
                url = parsed.standardizedFileURL.path
            }
            let o = args.count > 1 ? args[1] as? [String: Any] ?? [:] : [:]
            if let v = o["volume"] as? Double { player.set("volume", String(Int(v))) }
            var opts: [String: String] = [:]
            if let start = o["start"] as? Double, start > 0 { opts["start"] = String(start) }
            for (k, v) in (o["mpvOptions"] as? [String: Any] ?? [:]) {
                // Значение попадает в строку «опция=значение,…» для loadfile: без запятых и прочих символов.
                guard Self.allowedOpenOptions.contains(k), Self.matches(Self.optionValue, "\(v)") else {
                    Log.log(.warn, "mpv", "опция открытия отклонена: \(k)")
                    continue
                }
                opts[k] = "\(v)"
            }
            player.open(url, options: opts, profile: (o["profile"] as? String).flatMap { $0.isEmpty ? nil : $0 })
            replyHandler(["ok": true], nil)
        case "command":
            let cmd = (args.first as? [Any] ?? []).map { "\($0)" }
            guard let name = cmd.first, Self.allowedCommands.contains(name) else {
                Log.log(.warn, "mpv", "команда отклонена: \(cmd.first ?? "")")
                return replyHandler(nil, "command not allowed")
            }
            player.command(cmd)
            replyHandler(true, nil)
        case "get":
            guard let name = args.first as? String, Self.allowedGetProperties.contains(name) else {
                Log.log(.warn, "mpv", "чтение свойства отклонено: \((args.first as? String) ?? "?")")
                return replyHandler(nil, "property not readable")
            }
            replyHandler(player.get(name), nil)
        case "set":
            guard args.count == 2, let name = args[0] as? String, Self.allowedSetProperties.contains(name) else {
                Log.log(.warn, "mpv", "свойство отклонено: \((args.first as? String) ?? "?")")
                return replyHandler(nil, "property not allowed")
            }
            // Булевы значения JS заранее превращает в "yes"/"no".
            replyHandler(player.set(name, "\(args[1])"), nil)
        case "subsSearch":
            // Поиск субтитров: Stremio OpenSubtitles v3, без ключа. Нужен IMDb-id (tt…), для серии ещё сезон и номер.
            guard let imdb = args.first as? String, Self.matches(Self.imdbId, imdb) else { return replyHandler(nil, "bad imdb") }
            let season = args.count > 1 ? ((args[1] as? Int) ?? (args[1] as? Double).map(Int.init) ?? 0) : 0
            let episode = args.count > 2 ? ((args[2] as? Int) ?? (args[2] as? Double).map(Int.init) ?? 0) : 0
            Task { @MainActor in replyHandler(await Self.searchSubtitles(imdb: imdb, season: season, episode: episode), nil) }
        case "subsLoad":
            guard args.count >= 3, let url = args[0] as? String, let title = args[1] as? String, let lang = args[2] as? String else {
                return replyHandler(nil, "bad args")
            }
            Task { @MainActor in replyHandler(await self.loadSubtitle(urlString: url, title: title, lang: lang), nil) }
        case "tidbMedia":
            // Запрос к TheIntroDB делает приложение (без ключа: чтение таймкодов авторизации не требует).
            guard let tmdb = (args.first as? Int) ?? (args.first as? Double).map(Int.init), tmdb > 0 else { return replyHandler(nil, "bad id") }
            let season = (args.count > 1 ? (args[1] as? Int) ?? (args[1] as? Double).map(Int.init) : nil)
            let episode = (args.count > 2 ? (args[2] as? Int) ?? (args[2] as? Double).map(Int.init) : nil)
            Task { @MainActor in replyHandler(await Self.fetchIntroDB(tmdb: tmdb, season: season, episode: episode), nil) }
        case "nowPlaying":
            guard let d = args.first as? [String: Any], let title = d["title"] as? String else { return replyHandler(nil, "bad args") }
            nowPlaying?.set(title: title, subtitle: (d["subtitle"] as? String) ?? "", duration: (d["duration"] as? Double) ?? 0,
                            canNext: (d["canNext"] as? Bool) ?? false, canPrev: (d["canPrev"] as? Bool) ?? false,
                            artwork: d["artwork"] as? String)
            replyHandler(true, nil)
        case "nowPlayingClear":
            nowPlaying?.clear()
            replyHandler(true, nil)
        case "screenshot":
            replyHandler(player.screenshot(), nil)
        case "profile":
            let name = (args.first as? String).flatMap { $0.isEmpty ? nil : $0 }
            replyHandler(Array(player.applyConfig(profile: name)), nil)
        case "getConfig":
            let cfg = MpvConfig.load()
            replyHandler(["path": MpvConfig.fileURL.path, "text": MpvConfig.readText(), "profiles": cfg.profileNames], nil)
        case "setConfig":
            guard let text = args.first as? String else { return replyHandler(nil, "no text") }
            if text.utf8.count > MpvConfig.maxBytes { return replyHandler(["ok": false, "error": tr("файл больше 64 КиБ", "the file is larger than 64 KiB")], nil) }
            do { try MpvConfig.writeText(text) } catch { return replyHandler(["ok": false, "error": error.localizedDescription], nil) }
            let cfg = MpvConfig.merged(userText: text)
            replyHandler(["ok": true, "profiles": cfg.profileNames,
                          "ignored": cfg.ignored.map { ["line": $0.line, "text": $0.text, "reason": $0.reason] }], nil)
        case "audioFx":
            // Эквалайзер, речь, ночной режим: страница присылает числа, цепочку фильтров собирает приложение.
            guard let d = args.first as? [String: Any] else { return replyHandler(nil, "bad args") }
            let bands = (d["bands"] as? [Any] ?? []).prefix(AudioFx.bandFrequencies.count).map { Int(($0 as? Double) ?? Double(($0 as? Int) ?? 0)) }
            let dialogue = Int((d["dialogue"] as? Double) ?? Double((d["dialogue"] as? Int) ?? 0))
            let graph = AudioFx.graph(bands: bands, dialogue: dialogue, night: (d["night"] as? Bool) ?? false)
            for c in AudioFx.commands(graph: graph) { player.commandQuiet(c) }
            replyHandler(graph != nil, nil)
        case "displayRate":
            // Частота кадров видео (10…120) или 0: страница не задаёт режим экрана, подбор делает приложение.
            let fps = (args.first as? Double) ?? Double((args.first as? Int) ?? 0)
            guard fps == 0 || (fps >= 10 && fps <= 120) else { return replyHandler(nil, "bad fps") }
            displayRate?(fps)
            replyHandler(true, nil)
        case "stop":
            player.stop()
            displayRate?(nil)
            replyHandler(true, nil)
        default:
            replyHandler(nil, "unknown method \(method)")
        }
    }
}
