import AppKit
import CMpv
import LampyrisCore

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation {
    private var window: NSWindow?
    private var webController: WebViewController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        // Страница Lampa получает нажатия раньше меню (и гасит часть из них), поэтому сочетания с ⌘
        // сначала отдаём главному меню: ⌘R, ⌘, ⌘H, ⌘M, ⌘W, ⌘Q и остальные.
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command) else { return event }
            return NSApp.mainMenu?.performKeyEquivalent(with: event) == true ? nil : event
        }
        Self.migrateLegacyData()
        Self.cleanSubtitleCache()
        Updater.cleanCache()
        if let src = ProcessInfo.processInfo.environment["LAMPA_MPV_TEST"] {
            runMpvTest(source: src)
            return
        }
        guard let url = ServerURL.resolve() else {
            NSApp.terminate(nil)
            return
        }
        let controller = WebViewController(url: url)
        webController = controller
        let window = NSWindow(contentViewController: controller)
        window.setContentSize(NSSize(width: 1280, height: 720))
        window.title = "Lampyris"
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        // Размер и положение запоминаются в UserDefaults; без сохранённых — по центру экрана.
        if !window.setFrameUsingName(Self.frameName) { window.center() }
        window.setFrameAutosaveName(Self.frameName)
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
        self.window = window
        Updater.shared.statusHandler = { [weak window] status in window?.title = status ?? "Lampyris" }
        // Проверка обновлений в фоне: не раньше, чем окно покажется и страница начнёт загружаться.
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { Updater.shared.checkOnLaunch() }
        NSApp.activate(ignoringOtherApps: true)
        // Полноэкранный режим восстанавливается после показа окна.
        if UserDefaults.standard.bool(forKey: Self.fullScreenKey) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { window.toggleFullScreen(nil) }
        }
    }

    /// Прежнее имя проекта (LampaSwift): если mpv.conf остался в старой папке, а в новой его нет — копируем один раз.
    private static func migrateLegacyData() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let old = base.appendingPathComponent("LampaSwift/mpv.conf"), new = MpvConfig.fileURL
        guard FileManager.default.fileExists(atPath: old.path), !FileManager.default.fileExists(atPath: new.path) else { return }
        try? FileManager.default.createDirectory(at: new.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.copyItem(at: old, to: new)
    }

    /// Скачанные субтитры нужны на время просмотра: файлы старше недели удаляем.
    private static func cleanSubtitleCache() {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Lampyris/subs")
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let limit = Date().addingTimeInterval(-7 * 86400)
        for f in files {
            if let d = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate, d < limit {
                try? FileManager.default.removeItem(at: f)
            }
        }
    }

    private static let frameName = "MainWindow"
    private static let fullScreenKey = "windowFullScreen"

    func windowDidEnterFullScreen(_ notification: Notification) {
        UserDefaults.standard.set(true, forKey: Self.fullScreenKey)
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        UserDefaults.standard.set(false, forKey: Self.fullScreenKey)
    }

    @objc func changeServer() { webController?.changeServer() }

    @objc func reloadPage() {
        Log.log(.info, "app", "перезагрузка страницы")
        webController?.reload()
    }

    /// Открывает mpv.conf в TextEdit; если файла ещё нет, создаёт с краткой памяткой.
    @objc func openMpvConf() {
        let url = MpvConfig.fileURL
        if !FileManager.default.fileExists(atPath: url.path) {
            let template = """
            # mpv.conf плеера Lampa. Формат: опция=значение, по одной в строке.
            # Опции до первого [раздела] общие; [имя] — профиль, выбирается в Настройки → MPV
            # или клавишей P во время видео. Файл читается при каждом открытии видео.
            #
            # hwdec=videotoolbox
            #
            # [bright]
            # brightness=20

            """
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? template.write(to: url, atomically: true, encoding: .utf8)
        }
        let textEdit = URL(fileURLWithPath: "/System/Applications/TextEdit.app")
        NSWorkspace.shared.open([url], withApplicationAt: textEdit, configuration: NSWorkspace.OpenConfiguration())
    }

    // MARK: Резервная копия настроек

    private var appVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "разработка" }

    private func infoAlert(_ title: String, _ text: String, style: NSAlert.Style = .informational) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.alertStyle = style
        alert.runModal()
    }

    /// Сохраняет настройки в выбранный файл: адрес сервера и история, переключатели, mpv.conf, данные страницы Lampa.
    @objc func saveBackup() {
        guard let web = webController else { return }
        web.collectLampaStorage { [weak self] lampa in self?.finishSaveBackup(lampa) }
    }

    private func finishSaveBackup(_ lampa: Backup.Lampa?) {
        var backup = Backup()
        backup.serverURL = ServerURL.saved
        backup.history = ServerURL.history
        backup.verboseLog = Log.isVerboseSetting
        backup.autoUpdateCheck = Updater.shared.autoCheck
        let conf = MpvConfig.readText()
        backup.mpvConf = conf.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : conf
        backup.lampa = lampa
        let day = DateFormatter()
        day.dateFormat = "yyyy-MM-dd"
        day.locale = Locale(identifier: "en_US_POSIX")
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.nameFieldStringValue = "Lampyris-настройки-\(day.string(from: Date())).json"
        panel.message = "Файл содержит адрес сервера и данные Lampa (вход, закладки): храните его в надёжном месте."
        guard panel.runModal() == .OK, let target = panel.url else { return }
        do {
            let data = try backup.jsonData(app: appVersion, platform: "macos")
            try data.write(to: target, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
            Log.log(.info, "backup", "настройки сохранены в файл")
            let note = lampa == nil ? "\n\nДанные страницы Lampa не вошли: сейчас открыта не страница сервера. Откройте Lampa и повторите, если они нужны." : ""
            infoAlert("Настройки сохранены", target.path + note)
        } catch {
            infoAlert("Не удалось сохранить настройки", error.localizedDescription, style: .warning)
        }
    }

    /// Восстанавливает настройки из файла, сохранённого «Сохранить настройки…» (на macOS или на Windows).
    @objc func restoreBackup() {
        guard let web = webController else { return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        panel.message = "Выберите файл резервной копии Lampyris"
        guard panel.runModal() == .OK, let file = panel.url else { return }
        let backup: Backup
        do {
            let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
            if size > Backup.maxFileBytes { throw Backup.ParseError(message: "файл слишком большой для резервной копии") }
            backup = try Backup.parse(try Data(contentsOf: file))
        } catch let e as Backup.ParseError {
            infoAlert("Не удалось прочитать файл", e.message, style: .warning)
            return
        } catch {
            infoAlert("Не удалось прочитать файл", error.localizedDescription, style: .warning)
            return
        }
        var parts: [String] = []
        if let s = backup.serverURL { parts.append("адрес сервера: \(s) и история адресов") }
        if backup.verboseLog != nil || backup.autoUpdateCheck != nil { parts.append("переключатели меню") }
        if backup.mpvConf != nil { parts.append("mpv.conf") }
        if let l = backup.lampa { parts.append("данные Lampa (\(l.items.count) записей: вход, закладки, плагины)") }
        if parts.isEmpty { infoAlert("В файле нет настроек", "Восстанавливать нечего."); return }
        let confirm = NSAlert()
        confirm.messageText = "Заменить текущие настройки?"
        confirm.informativeText = "Будут заменены: " + parts.joined(separator: "; ") + ".\n\nСтраница Lampa перезагрузится."
        confirm.alertStyle = .warning
        confirm.addButton(withTitle: "Восстановить")
        confirm.addButton(withTitle: "Отмена")
        guard confirm.runModal() == .alertFirstButtonReturn else { return }

        if backup.serverURL != nil || !backup.history.isEmpty { ServerURL.restore(current: backup.serverURL, history: backup.history) }
        if let v = backup.verboseLog { Log.setVerbose(v); web.setPageVerbose(Log.isVerbose) }
        if let a = backup.autoUpdateCheck { Updater.shared.autoCheck = a }
        if let conf = backup.mpvConf { try? MpvConfig.writeText(conf) }
        Log.log(.info, "backup", "настройки восстановлены из файла")
        let hasLampa = backup.lampa != nil
        web.restore(url: backup.serverURL.flatMap { URL(string: $0) }, lampaScript: backup.restoreScript()) { [weak self] ok in
            if hasLampa && !ok {
                self?.infoAlert("Данные Lampa не восстановлены", "Настройки приложения восстановлены, но страница сервера не открылась или открылась с другого адреса, чем в копии. Откройте Lampa и восстановите копию ещё раз.", style: .warning)
            }
        }
    }

    /// «О программе»: лицензия и обязательная строка TMDB.
    @objc func showAbout() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "разработка"
        #if arch(arm64)
        let arch = "Apple Silicon"
        #else
        let arch = "Intel"
        #endif
        let text = """
        Версия \(version) (\(arch))

        Lampyris: неофициальный клиент Lampa для macOS на Swift и libmpv. Lampa — проект своих авторов, с Lampyris не связан.

        Лицензия: GNU GPL версии 3 или новее. Исходный код: github.com/polons123/lampyris. \
        Сведения о сторонних компонентах (mpv, FFmpeg и др.) — в файле THIRD-PARTY.md.

        This product uses the TMDB API but is not endorsed or certified by TMDB.
        """
        let credits = NSAttributedString(string: text, attributes: [
            .font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.labelColor,
        ])
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Lampyris", .credits: credits])
    }

    @objc func checkForUpdates() { Updater.shared.checkManually() }

    @objc func toggleAutoUpdateCheck() { Updater.shared.autoCheck.toggle() }

    @objc func toggleVerboseLog() {
        let on = !Log.isVerboseSetting
        Log.setVerbose(on)
        webController?.setPageVerbose(Log.isVerbose)
    }

    @objc func showLogFolder() {
        try? FileManager.default.createDirectory(at: Log.folderURL, withIntermediateDirectories: true)
        NSWorkspace.shared.open(Log.folderURL)
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(toggleVerboseLog) { item.state = Log.isVerboseSetting ? .on : .off }
        if item.action == #selector(toggleAutoUpdateCheck) { item.state = Updater.shared.autoCheck ? .on : .off }
        return true
    }

    @objc func showMpvConfFolder() {
        NSWorkspace.shared.activateFileViewerSelecting([MpvConfig.fileURL])
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private var player: MpvPlayer?

    /// Отладочный режим: окно только с mpv, без Lampa. LAMPA_MPV_TEST=<файл или URL>.
    private func runMpvTest(source: String) {
        do {
            let p = try MpvPlayer()
            let view = MpvVideoView(videoFrame: NSRect(x: 0, y: 0, width: 1280, height: 720))
            view.autoresizingMask = [.width, .height]
            let window = NSWindow(contentRect: view.frame, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                                  backing: .buffered, defer: false)
            window.contentView = view
            window.title = "mpv test"
            window.center()
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            try p.attach(to: view)
            p.observe([("pause", MPV_FORMAT_FLAG)])
            p.onMessage = { if $0["event"] as? String != "property-change" { print("[mpv] \($0)") } }
            // LAMPA_MPV_SUBFILE=<файл.srt>: через 3 с подключить субтитры и вывести список дорожек (проверка sub-add).
            if let sub = ProcessInfo.processInfo.environment["LAMPA_MPV_SUBFILE"] {
                Timer.scheduledTimer(withTimeInterval: 3.0, repeats: false) { _ in
                    MainActor.assumeIsolated {
                        print("[mpv] sub-add: \(p.addSubtitle(path: sub, title: "RU · test", lang: "ru"))")
                        // LAMPA_MPV_SUBSTYLE="sub-scale=2,sub-color=#FFFF00": применить свойства стиля субтитров (проверка).
                        for pair in (ProcessInfo.processInfo.environment["LAMPA_MPV_SUBSTYLE"] ?? "").split(separator: ",") {
                            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
                            if kv.count == 2 { print("[mpv] set \(kv[0]): \(p.set(kv[0], kv[1]))") }
                        }
                        print("[mpv] tracks: \(String(describing: p.get("track-list")))")
                    }
                }
            }
            // LAMPA_MPV_NOWPLAYING=1: передать «Сейчас играет» и вывести то, что принято системой.
            if ProcessInfo.processInfo.environment["LAMPA_MPV_NOWPLAYING"] != nil {
                let np = NowPlaying(player: p) { print("[mpv] remote -> страница: \($0)") }
                p.observe([("pause", MPV_FORMAT_FLAG), ("time-pos", MPV_FORMAT_DOUBLE), ("duration", MPV_FORMAT_DOUBLE)])
                let previous = p.onMessage
                p.onMessage = { previous?($0); np.handle($0) }
                np.set(title: "Тестовый фильм", subtitle: "Сезон 1 · Серия 2 · Проверка", duration: 15, canNext: true, canPrev: false,
                       artwork: "https://image.tmdb.org/t/p/w185/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg")
                for delay in [2.0, 6.0] {
                    Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
                        MainActor.assumeIsolated { print("[mpv] nowplaying t=\(delay): \(np.debugDescription)") }
                    }
                }
                Timer.scheduledTimer(withTimeInterval: 4.0, repeats: false) { _ in
                    MainActor.assumeIsolated { _ = p.set("pause", "yes") }
                }
                Timer.scheduledTimer(withTimeInterval: 7.0, repeats: false) { _ in
                    MainActor.assumeIsolated { print("[mpv] nowplaying после паузы: \(np.debugDescription)") }
                }
            }
            if ProcessInfo.processInfo.environment["LAMPA_MPV_SHOT"] != nil {
                Timer.scheduledTimer(withTimeInterval: 4.0, repeats: false) { _ in
                    MainActor.assumeIsolated { print("[mpv] screenshot: \(p.screenshot())") }
                }
            }
            p.open(source, options: [:], profile: ProcessInfo.processInfo.environment["LAMPA_MPV_PROFILE"])
            self.window = window
            self.player = p
            // LAMPA_MPV_PROFILE2: через 6 с применить другой профиль на лету (проверка сброса опций).
            if let second = ProcessInfo.processInfo.environment["LAMPA_MPV_PROFILE2"] {
                Timer.scheduledTimer(withTimeInterval: 6.0, repeats: false) { _ in
                    MainActor.assumeIsolated { _ = p.applyConfig(profile: second.isEmpty ? nil : second) }
                }
            }
            for delay in [3.0, 9.0] {
                Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
                    MainActor.assumeIsolated {
                        print("[mpv] --- t=\(delay)s")
                        for k in ["video-codec", "hwdec-current", "video-params/w", "video-params/h", "container-fps",
                                  "estimated-vf-fps", "time-pos", "frame-drop-count", "decoder-frame-drop-count",
                                  "vo-delayed-frame-count", "avsync", "audio-codec-name", "current-ao", "mute", "volume", "brightness", "contrast", "sub-font-size", "hwdec", "script"] {
                            print("[mpv] \(k) = \(p.getString(k) ?? "-")")
                        }
                    }
                }
            }
        } catch {
            Log.log(.error, "app", "mpv init failed: \(error)")
            NSApp.terminate(nil)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        player?.shutdown()
        webController?.shutdownPlayer()
    }

    private func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "О программе Lampyris", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(withTitle: "Проверить обновления…", action: #selector(checkForUpdates), keyEquivalent: "")
        appMenu.addItem(withTitle: "Проверять обновления автоматически", action: #selector(toggleAutoUpdateCheck), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Изменить адрес сервера…", action: #selector(changeServer), keyEquivalent: ",")
        appMenu.addItem(withTitle: "Открыть mpv.conf", action: #selector(openMpvConf), keyEquivalent: "")
        appMenu.addItem(withTitle: "Показать mpv.conf в Finder", action: #selector(showMpvConfFolder), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Сохранить настройки в файл…", action: #selector(saveBackup), keyEquivalent: "")
        appMenu.addItem(withTitle: "Восстановить настройки из файла…", action: #selector(restoreBackup), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Подробный журнал", action: #selector(toggleVerboseLog), keyEquivalent: "")
        appMenu.addItem(withTitle: "Показать журнал в Finder", action: #selector(showLogFolder), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Скрыть Lampyris", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Выйти из Lampyris", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "Правка")
        editMenu.addItem(withTitle: "Отменить", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Повторить", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Вырезать", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Копировать", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Вставить", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Выбрать всё", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "Вид")
        let reload = viewMenu.addItem(withTitle: "Перезагрузить", action: #selector(reloadPage), keyEquivalent: "r")
        reload.target = self
        let full = viewMenu.addItem(withTitle: "Полный экран", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = viewMenu
        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Окно")
        windowMenu.addItem(withTitle: "Свернуть", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Закрыть", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu
        // Пункты, которые выполняет сам делегат, привязываем явно: не зависим от цепочки ответчиков и фокуса страницы.
        for item in main.items {
            for sub in item.submenu?.items ?? [] where sub.target == nil {
                if let action = sub.action, responds(to: action) { sub.target = self }
            }
        }
        NSApp.mainMenu = main
    }
}
