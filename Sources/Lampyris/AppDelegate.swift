import AppKit
import CMpv
import LampyrisCore
import UniformTypeIdentifiers

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
        window.contentMinSize = NSSize(width: 674, height: 371)
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

    /// Меню «Файл → Открыть видео…» (⌘O): локальные видео и звук проигрываются тем же плеером, что и онлайн.
    @objc func openVideoFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.title = tr("Открыть видео", "Open Video")
        panel.allowedContentTypes = MpvBridge.localExtensions.sorted().compactMap { UTType(filenameExtension: $0) }
        guard panel.runModal() == .OK else { return }
        webController?.openLocalVideos(panel.urls)
    }

    /// Finder: «Открыть с помощью Lampyris» и файл, перетащенный на значок.
    func application(_ application: NSApplication, open urls: [URL]) {
        webController?.openLocalVideos(urls)
    }

    @objc func reloadPage() {
        Log.log(.info, "app", "перезагрузка страницы")
        webController?.reload()
    }

    /// Открывает mpv.conf в TextEdit; если файла ещё нет, создаёт с краткой памяткой.
    @objc func openMpvConf() {
        let url = MpvConfig.fileURL
        if !FileManager.default.fileExists(atPath: url.path) {
            let template = tr("""
            # mpv.conf плеера Lampa. Формат: опция=значение, по одной в строке.
            # Опции до первого [раздела] общие; [имя] — профиль, выбирается в Настройки → MPV
            # или клавишей P во время видео. Файл читается при каждом открытии видео.
            #
            # hwdec=videotoolbox
            #
            # [my-profile]
            # deband=yes
            #
            # ── Встроенные профили (выбираются в Настройки → MPV или клавишей P) ──
            # Они есть всегда, копировать их в этот файл не нужно. Чтобы изменить встроенный профиль,
            # добавьте здесь раздел с тем же именем: он целиком заменит встроенный.
            #
            # balanced     — фильмы и сериалы: лёгкая подчистка полос (deband), чёткое увеличение, умеренная нагрузка.
            # quality      — максимум качества для мощного железа и видео до 1080p: тяжёлое масштабирование,
            #                сильный deband, тон-маппинг HDR → SDR. На слабых машинах возможны пропуски кадров.
            # fast         — лёгкий: 4K, слабое железо, виртуальная машина. Простое масштабирование, без deband.
            # hdr-sdr      — HDR-видео на обычном (SDR) мониторе: тон-маппинг bt.2390 сжимает яркость в диапазон экрана.
            # smooth       — плавное движение 24→60 Гц: подгонка кадров под частоту экрана и интерполяция.
            #                Нагружает GPU; если кадры пропускаются, вернитесь на balanced.
            # anime        — аниме: сильнее подчистка полос без зерна (на плоских заливках зерно заметно).
            # night        — ночной режим: сжатие динамического диапазона и выравнивание громкости (тихие диалоги, громкие взрывы).
            #
            # Яркость, контраст, гамму и насыщенность (например, для тёмного видео) настраивают во время просмотра
            # клавишей C: ползунки применяются сразу, запоминаются и не зависят от выбранного профиля.
            # Там же «Автокоррекция SDR»: свои гамма и насыщенность, только для SDR-видео (HDR не трогает).
            #
            # На macOS hdr-compute-peak не действует (рендерер gpu, OpenGL 4.1 без compute-шейдеров); на Windows работает.
            """, """
            # mpv.conf of the Lampa player. Format: option=value, one per line.
            # Options before the first [section] are common; [name] is a profile, chosen in Settings → MPV
            # or with the P key during a video. The file is read each time a video is opened.
            #
            # hwdec=videotoolbox
            #
            # [my-profile]
            # deband=yes
            #
            # ── Built-in profiles (chosen in Settings → MPV or with the P key) ──
            # They are always available, there is no need to copy them into this file. To change a built-in profile,
            # add a section with the same name here: it replaces the built-in one entirely.
            #
            # balanced     — movies and series: light deband, sharp upscaling, moderate load.
            # quality      — maximum quality for powerful hardware and video up to 1080p: heavy scaling,
            #                strong deband, HDR → SDR tone mapping. Weak machines may drop frames.
            # fast         — light: 4K, weak hardware, virtual machine. Simple scaling, no deband.
            # hdr-sdr      — HDR video on a regular (SDR) display: bt.2390 tone mapping compresses brightness to the screen range.
            # smooth       — smooth motion 24→60 Hz: frame timing matched to the display plus interpolation.
            #                Loads the GPU; if frames drop, go back to balanced.
            # anime        — anime: stronger deband without grain (grain is visible on flat fills).
            # night        — night mode: dynamic range compression and loudness normalization (quiet dialogue, loud explosions).
            #
            # Brightness, contrast, gamma and saturation (for example, for a dark video) are tuned during playback
            # with the C key: the sliders apply immediately, are remembered and do not depend on the chosen profile.
            # It also has “SDR auto-correction”: its own gamma and saturation, only for SDR video (HDR is untouched).
            #
            # On macOS hdr-compute-peak has no effect (gpu renderer, OpenGL 4.1 has no compute shaders); on Windows it works.
            """)
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? template.write(to: url, atomically: true, encoding: .utf8)
        }
        let textEdit = URL(fileURLWithPath: "/System/Applications/TextEdit.app")
        NSWorkspace.shared.open([url], withApplicationAt: textEdit, configuration: NSWorkspace.OpenConfiguration())
    }

    // MARK: Резервная копия настроек

    private var appVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? tr("разработка", "development") }

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
        panel.nameFieldStringValue = tr("Lampyris-настройки-\(day.string(from: Date())).json", "Lampyris-settings-\(day.string(from: Date())).json")
        panel.message = tr("Файл содержит адрес сервера и данные Lampa (вход, закладки): храните его в надёжном месте.", "The file contains the server address and Lampa data (login, bookmarks): keep it somewhere safe.")
        guard panel.runModal() == .OK, let target = panel.url else { return }
        do {
            let data = try backup.jsonData(app: appVersion, platform: "macos")
            try data.write(to: target, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
            Log.log(.info, "backup", "настройки сохранены в файл")
            let note = lampa == nil ? tr("\n\nДанные страницы Lampa не вошли: сейчас открыта не страница сервера. Откройте Lampa и повторите, если они нужны.", "\n\nLampa page data was not included: the server page is not open right now. Open Lampa and try again if you need it.") : ""
            infoAlert(tr("Настройки сохранены", "Settings saved"), target.path + note)
        } catch {
            infoAlert(tr("Не удалось сохранить настройки", "Could not save settings"), error.localizedDescription, style: .warning)
        }
    }

    /// Восстанавливает настройки из файла, сохранённого «Сохранить настройки…» (на macOS или на Windows).
    @objc func restoreBackup() {
        guard let web = webController else { return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        panel.message = tr("Выберите файл резервной копии Lampyris", "Choose a Lampyris backup file")
        guard panel.runModal() == .OK, let file = panel.url else { return }
        let backup: Backup
        do {
            let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
            if size > Backup.maxFileBytes { throw Backup.ParseError(message: tr("файл слишком большой для резервной копии", "the file is too large for a backup")) }
            backup = try Backup.parse(try Data(contentsOf: file))
        } catch let e as Backup.ParseError {
            infoAlert(tr("Не удалось прочитать файл", "Could not read the file"), e.message, style: .warning)
            return
        } catch {
            infoAlert(tr("Не удалось прочитать файл", "Could not read the file"), error.localizedDescription, style: .warning)
            return
        }
        var parts: [String] = []
        if let s = backup.serverURL { parts.append(tr("адрес сервера: \(s) и история адресов", "server address: \(s) and address history")) }
        if backup.verboseLog != nil || backup.autoUpdateCheck != nil { parts.append(tr("переключатели меню", "menu switches")) }
        if backup.mpvConf != nil { parts.append("mpv.conf") }
        if let l = backup.lampa { parts.append(tr("данные Lampa (\(l.items.count) записей: вход, закладки, плагины)", "Lampa data (\(l.items.count) entries: login, bookmarks, plugins)")) }
        if parts.isEmpty { infoAlert(tr("В файле нет настроек", "The file has no settings"), tr("Восстанавливать нечего.", "Nothing to restore.")); return }
        let confirm = NSAlert()
        confirm.messageText = tr("Заменить текущие настройки?", "Replace the current settings?")
        confirm.informativeText = tr("Будут заменены: ", "Will be replaced: ") + parts.joined(separator: "; ") + tr(".\n\nСтраница Lampa перезагрузится.", ".\n\nThe Lampa page will reload.")
        confirm.alertStyle = .warning
        confirm.addButton(withTitle: tr("Восстановить", "Restore"))
        confirm.addButton(withTitle: tr("Отмена", "Cancel"))
        guard confirm.runModal() == .alertFirstButtonReturn else { return }

        if backup.serverURL != nil || !backup.history.isEmpty { ServerURL.restore(current: backup.serverURL, history: backup.history) }
        if let v = backup.verboseLog { Log.setVerbose(v); web.setPageVerbose(Log.isVerbose) }
        if let a = backup.autoUpdateCheck { Updater.shared.autoCheck = a }
        if let conf = backup.mpvConf { try? MpvConfig.writeText(conf) }
        Log.log(.info, "backup", "настройки восстановлены из файла")
        let hasLampa = backup.lampa != nil
        web.restore(url: backup.serverURL.flatMap { URL(string: $0) }, lampaScript: backup.restoreScript()) { [weak self] ok in
            if hasLampa && !ok {
                self?.infoAlert(tr("Данные Lampa не восстановлены", "Lampa data was not restored"), tr("Настройки приложения восстановлены, но страница сервера не открылась или открылась с другого адреса, чем в копии. Откройте Lampa и восстановите копию ещё раз.", "App settings were restored, but the server page did not open or opened from a different address than in the backup. Open Lampa and restore the backup again."), style: .warning)
            }
        }
    }

    /// «О программе»: лицензия и обязательная строка TMDB.
    @objc func showAbout() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? tr("разработка", "development")
        #if arch(arm64)
        let arch = "Apple Silicon"
        #else
        let arch = "Intel"
        #endif
        let text = tr("""
        Версия \(version) (\(arch))

        Lampyris: неофициальный клиент Lampa для macOS на Swift и libmpv. Lampa — проект своих авторов, с Lampyris не связан.

        Лицензия: GNU GPL версии 3 или новее. Исходный код: github.com/polons123/lampyris. \
        Сведения о сторонних компонентах (mpv, FFmpeg и др.) — в файле THIRD-PARTY.md.

        This product uses the TMDB API but is not endorsed or certified by TMDB.
        """, """
        Version \(version) (\(arch))

        Lampyris: an unofficial Lampa client for macOS built with Swift and libmpv. Lampa is a project of its own authors and is not affiliated with Lampyris.

        License: GNU GPL version 3 or later. Source code: github.com/polons123/lampyris. \
        Information about third-party components (mpv, FFmpeg, etc.) is in THIRD-PARTY.md.

        This product uses the TMDB API but is not endorsed or certified by TMDB.
        """)
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

    /// Поверх других окон (как «Float on Top» в IINA); при перезапуске не запоминается.
    @objc func toggleFloatOnTop() {
        guard let window else { return }
        window.level = window.level == .floating ? .normal : .floating
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(toggleFloatOnTop) { item.state = window?.level == .floating ? .on : .off }
        if item.action == #selector(toggleVerboseLog) { item.state = Log.isVerboseSetting ? .on : .off }
        if item.action == #selector(setLanguage(_:)) { item.state = (item.tag == 0) == (Language.current == .ru) ? .on : .off }
        if item.action == #selector(toggleAutoUpdateCheck) { item.state = Updater.shared.autoCheck ? .on : .off }
        return true
    }

    /// Переключает язык интерфейса: меню собирается заново, страница перезагружается (язык плеера и страницы ошибки применяется при загрузке).
    @objc func setLanguage(_ sender: NSMenuItem) {
        let new: Language = sender.tag == 0 ? .ru : .en
        guard new != Language.current else { return }
        Language.set(new)
        buildMenu()
        // Язык самой Lampa берётся из localStorage: записываем его и только потом перезагружаем страницу.
        webController?.setLampaLanguage(new == .ru ? "ru" : "en") { [weak self] in self?.webController?.reload() }
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
        appMenu.addItem(withTitle: tr("О программе Lampyris", "About Lampyris"), action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(withTitle: tr("Проверить обновления…", "Check for Updates…"), action: #selector(checkForUpdates), keyEquivalent: "")
        appMenu.addItem(withTitle: tr("Проверять обновления автоматически", "Check for Updates Automatically"), action: #selector(toggleAutoUpdateCheck), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: tr("Изменить адрес сервера…", "Change Server Address…"), action: #selector(changeServer), keyEquivalent: ",")
        appMenu.addItem(withTitle: tr("Открыть mpv.conf", "Open mpv.conf"), action: #selector(openMpvConf), keyEquivalent: "")
        appMenu.addItem(withTitle: tr("Показать mpv.conf в Finder", "Show mpv.conf in Finder"), action: #selector(showMpvConfFolder), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: tr("Сохранить настройки в файл…", "Save Settings to File…"), action: #selector(saveBackup), keyEquivalent: "")
        appMenu.addItem(withTitle: tr("Восстановить настройки из файла…", "Restore Settings from File…"), action: #selector(restoreBackup), keyEquivalent: "")
        appMenu.addItem(.separator())
        let langItem = NSMenuItem(title: "Язык / Language", action: nil, keyEquivalent: "")
        let langMenu = NSMenu(title: "Язык / Language")
        for (title, tag) in [("Русский", 0), ("English", 1)] {
            let it = langMenu.addItem(withTitle: title, action: #selector(setLanguage(_:)), keyEquivalent: "")
            it.tag = tag
            it.target = self
        }
        langItem.submenu = langMenu
        appMenu.addItem(langItem)
        appMenu.addItem(withTitle: tr("Подробный журнал", "Verbose Log"), action: #selector(toggleVerboseLog), keyEquivalent: "")
        appMenu.addItem(withTitle: tr("Показать журнал в Finder", "Show Log in Finder"), action: #selector(showLogFolder), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: tr("Скрыть Lampyris", "Hide Lampyris"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: tr("Выйти из Lampyris", "Quit Lampyris"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem()
        main.addItem(fileItem)
        let fileMenu = NSMenu(title: tr("Файл", "File"))
        fileMenu.addItem(withTitle: tr("Открыть видео…", "Open Video…"), action: #selector(openVideoFiles), keyEquivalent: "o")
        fileItem.submenu = fileMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: tr("Правка", "Edit"))
        editMenu.addItem(withTitle: tr("Отменить", "Undo"), action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: tr("Повторить", "Redo"), action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: tr("Вырезать", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: tr("Копировать", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: tr("Вставить", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: tr("Выбрать всё", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: tr("Вид", "View"))
        let reload = viewMenu.addItem(withTitle: tr("Перезагрузить", "Reload"), action: #selector(reloadPage), keyEquivalent: "r")
        reload.target = self
        let full = viewMenu.addItem(withTitle: tr("Полный экран", "Enter Full Screen"), action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        let top = viewMenu.addItem(withTitle: tr("Поверх других окон", "Float on Top"), action: #selector(toggleFloatOnTop), keyEquivalent: "t")
        top.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = viewMenu
        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: tr("Окно", "Window"))
        windowMenu.addItem(withTitle: tr("Свернуть", "Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: tr("Закрыть", "Close"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
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
