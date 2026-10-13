import AppKit
import WebKit

@MainActor
final class WebViewController: NSViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var url: URL
    private let webView: WKWebView
    private let videoView = MpvVideoView(videoFrame: NSRect(x: 0, y: 0, width: 1280, height: 720))
    private var player: MpvPlayer?
    private var bridge: MpvBridge?
    /// Источники, которым доверен мост mpv. Пополняется только пока идёт наша собственная загрузка
    /// адреса сервера (с редиректами); переход страницы на другой хост доверия не получает.
    private var trusted: Set<String> = []
    private var loadingOwn = false
    private var showingError = false

    init(url: URL) {
        self.url = url
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.isElementFullscreenEnabled = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let debug = ProcessInfo.processInfo.environment["LAMPA_DEBUG"] != nil
        // Консоль страницы пересылается в журнал только при включённом подробном журнале (флаг window.__lv).
        let js = """
        window.__lv = \(Log.isVerbose ? "true" : "false");
        ['log','warn','error'].forEach(function(l){var o=console[l];console[l]=function(){if(window.__lv){try{webkit.messageHandlers.dbg.postMessage(l+': '+Array.prototype.map.call(arguments,String).join(' '))}catch(e){}};o.apply(console,arguments)}});
        window.addEventListener('error',function(e){if(window.__lv)webkit.messageHandlers.dbg.postMessage('uncaught: '+e.message+' @'+e.filename+':'+e.lineno)});
        window.addEventListener('unhandledrejection',function(e){if(window.__lv)webkit.messageHandlers.dbg.postMessage('rejection: '+e.reason)});
        """
        config.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(nibName: nil, bundle: nil)
        config.userContentController.add(self, name: "dbg")
        config.userContentController.add(self, name: "appError")
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")  // видео рисуется под веб-видом
        webView.underPageBackgroundColor = .clear
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        // Web Inspector нужен только при отладке (LAMPA_DEBUG).
        if #available(macOS 13.3, *) { webView.isInspectable = debug }
    }

    required init?(coder: NSCoder) { fatalError() }

    override func loadView() {
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 720))
        for v in [videoView, webView] {
            v.frame = container.bounds
            v.autoresizingMask = [.width, .height]
            container.addSubview(v)
        }
        view = container
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        guard player == nil else { return }
        do {
            let p = try MpvPlayer()
            try p.attach(to: videoView)
            player = p
            let bridge = MpvBridge(player: p, webView: webView, trustedOrigins: { [weak self] in self?.trusted ?? [] })
            self.bridge = bridge
            webView.configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "mpv")
            for name in ["playbackCover", "mpvTube"] {
                if let url = Self.resourceURL(name, "js"),
                   let src = try? String(contentsOf: url, encoding: .utf8) {
                    webView.configuration.userContentController.addUserScript(
                        WKUserScript(source: src, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
                }
            }
            loadServer()
        } catch {
            Log.log(.error, "app", "mpv init failed: \(error)")
            loadServer()
        }
    }

    /// Включает или выключает пересылку консоли страницы в журнал (без перезагрузки страницы).
    func setPageVerbose(_ on: Bool) {
        webView.evaluateJavaScript("window.__lv = \(on ? "true" : "false")", completionHandler: nil)
    }

    /// Ресурс из Contents/Resources приложения (.app), а при запуске через swift run — из бандла SwiftPM.
    static func resourceURL(_ name: String, _ ext: String) -> URL? {
        Bundle.main.url(forResource: name, withExtension: ext) ?? Bundle.module.url(forResource: name, withExtension: ext)
    }

    func shutdownPlayer() { player?.shutdown() }

    override func viewDidLoad() {
        super.viewDidLoad()
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        if m.name == "appError" {
            // Кнопки страницы ошибки; принимаются только пока эта страница показана.
            guard showingError, let action = m.body as? String else { return }
            switch action {
            case "retry": loadServer()
            case "change": changeServer()
            default: break
            }
            return
        }
        Log.log(.info, "js", "\(m.body)", verboseOnly: true)
    }

    /// Страница вместо чёрного окна, когда адрес сервера не загрузился.
    private func showError(_ error: Error) {
        let ns = error as NSError
        // Отмена загрузки (новая навигация поверх старой) ошибкой не считается.
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return }
        func esc(_ s: String) -> String {
            s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        }
        let html = """
        <!doctype html><meta charset="utf-8"><meta name="color-scheme" content="dark">
        <style>
        html,body{height:100%;margin:0;background:#101014;color:#fff;font:16px -apple-system,BlinkMacSystemFont,sans-serif}
        body{display:flex;align-items:center;justify-content:center;text-align:center}
        main{max-width:30em;padding:2em}
        h1{font-size:1.6em;margin:0 0 .4em}
        p{opacity:.65;line-height:1.5;margin:.3em 0;word-break:break-word}
        .row{display:flex;gap:.9em;justify-content:center;margin-top:1.8em}
        button{font:600 1em -apple-system,sans-serif;padding:.7em 1.8em;border:0;border-radius:999px;color:#fff;
          background:rgba(255,255,255,.12);cursor:pointer}
        button.main{background:#fff;color:#000}
        button:hover,button:focus{outline:0;transform:scale(1.05)}
        </style>
        <main>
        <h1>Не удалось загрузить Lampa</h1>
        <p>\(esc(url.absoluteString))</p>
        <p>\(esc(error.localizedDescription))</p>
        <div class="row">
        <button class="main" autofocus onclick="webkit.messageHandlers.appError.postMessage('retry')">Повторить</button>
        <button onclick="webkit.messageHandlers.appError.postMessage('change')">Изменить адрес сервера</button>
        </div>
        </main>
        """
        showingError = true
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func loadServer() {
        bridge?.pageDidReset()
        showingError = false
        loadingOwn = true
        trusted = Set([MpvBridge.originKey(url)].compactMap { $0 })
        webView.load(URLRequest(url: url))
    }

    @objc func reload() { loadServer() }

    /// Диалог смены адреса сервера; при подтверждении страница загружается заново.
    func changeServer() {
        if let new = ServerURL.change(current: url) { url = new; loadServer() }
    }

    func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
        if loadingOwn, let u = webView.url, let key = MpvBridge.originKey(u) { trusted.insert(key) }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // Новый документ в главном кадре: прежняя страница (а с ней и её тюб) уничтожена, плеер без неё не нужен.
        bridge?.pageDidReset()
        if loadingOwn, let u = webView.url, let key = MpvBridge.originKey(u) { trusted.insert(key) }
        else if !showingError, let u = webView.url, let key = MpvBridge.originKey(u), !trusted.contains(key) {
            Log.log(.warn, "nav", "страница перешла на другой источник \(key): мост mpv для него отключён")
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loadingOwn = false }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadingOwn = false
        Log.log(.error, "nav", "navigation failed: \(error.localizedDescription)")
        showError(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadingOwn = false
        Log.log(.error, "nav", "provisional navigation failed: \(error.localizedDescription)")
        showError(error)
    }

    /// window.open и target=_blank: свои страницы грузим в этом же окне, чужие открываем в браузере по умолчанию.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let target = navigationAction.request.url else { return nil }
        if isTrustedURL(target) { webView.load(navigationAction.request) } else { openExternally(target) }
        return nil
    }

    /// Щелчок по ссылке на чужой сайт в главном окне уходит в браузер: страница Lampa остаётся на месте.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated, navigationAction.targetFrame?.isMainFrame == true,
           let target = navigationAction.request.url, !isTrustedURL(target) {
            openExternally(target)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    private func isTrustedURL(_ u: URL) -> Bool {
        guard let key = MpvBridge.originKey(u) else { return true }  // about:, blob:, data: — внутренние
        return trusted.contains(key)
    }

    private func openExternally(_ u: URL) {
        guard let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https" || scheme == "mailto" else { return }
        NSWorkspace.shared.open(u)
    }
}
