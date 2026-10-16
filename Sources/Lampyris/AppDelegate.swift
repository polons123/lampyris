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
            let template = tr("""
            # mpv.conf плеера Lampa. Формат: опция=значение, по одной в строке.
            # Опции до первого [раздела] общие; [имя] — профиль, выбирается в Настройки → MPV
            # или клавишей P во время видео. Файл читается при каждом открытии видео.
            #
            # hwdec=videotoolbox
            #
            # [bright]
            # brightness=20
            #
            # ── Готовые профили (выбираются в Настройки → MPV или клавишей P) ──
            # Здесь рисует рендерер «gpu» поверх OpenGL 4.1, поэтому опции только для
            # gpu-next (libplacebo) не действуют. На Windows рендерер gpu-next, там работают все.

            [balanced]
            # Сбалансированное качество для фильмов и сериалов: лёгкая подчистка полос (deband),
            # чёткое увеличение. Подходит большинству видео, нагрузка умеренная.
            scale=ewa_lanczossharp
            cscale=ewa_lanczossharp
            dscale=mitchell
            scale-antiring=0.6
            correct-downscaling=yes
            linear-downscaling=yes
            sigmoid-upscaling=yes
            deband=yes
            deband-iterations=2
            deband-threshold=35
            deband-range=20
            deband-grain=5

            [quality]
            # Максимум качества для Apple Silicon Pro/Max и видео до 1080p: тяжёлое масштабирование,
            # сильный deband, тон-маппинг HDR → SDR. На слабых машинах возможны пропуски кадров.
            # hdr-compute-peak на macOS НЕ действует: для него нужны compute-шейдеры, а в OpenGL 4.1
            # их нет (mpv пишет «Disabling HDR peak computation»); пик яркости берётся из метаданных.
            # На Windows (gpu-next, D3D11) опция работает и считает пик по кадрам.
            scale=ewa_lanczossharp
            cscale=ewa_lanczossharp
            dscale=ewa_lanczos
            scale-antiring=0.6
            cscale-antiring=0.6
            correct-downscaling=yes
            linear-downscaling=yes
            sigmoid-upscaling=yes
            deband=yes
            deband-iterations=4
            deband-threshold=40
            deband-range=20
            deband-grain=8
            hdr-compute-peak=yes
            tone-mapping=bt.2390

            [fast]
            # Лёгкий: 4K, слабое железо, виртуальная машина. Простое масштабирование, без deband.
            scale=bilinear
            cscale=bilinear
            dscale=bilinear
            deband=no
            dither-depth=no
            correct-downscaling=no
            sigmoid-upscaling=no

            [hdr-sdr]
            # HDR-видео на обычном (SDR) мониторе: тон-маппинг bt.2390 сжимает яркость в диапазон экрана.
            # hdr-compute-peak на macOS не действует (см. [quality]), на Windows считает пик по кадрам.
            tone-mapping=bt.2390
            hdr-compute-peak=yes
            target-peak=auto
            deband=no

            [smooth]
            # Плавное движение 24→60 Гц: подгонка кадров под частоту экрана и интерполяция.
            # Нагружает GPU; если кадры пропускаются, вернитесь на [balanced].
            video-sync=display-resample
            interpolation=yes
            tscale=oversample

            [anime]
            # Аниме: сильнее подчистка полос без добавления зерна (на плоских заливках зерно заметно).
            scale=ewa_lanczossharp
            cscale=ewa_lanczossharp
            sigmoid-upscaling=yes
            deband=yes
            deband-iterations=3
            deband-threshold=48
            deband-range=16
            deband-grain=0

            [night]
            # Ночной режим: сжатие динамического диапазона и выравнивание громкости (тихие диалоги, громкие взрывы).
            af=acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11

            [dark]
            # Тёмная картинка: умеренно поднимает тени. Для ручного тюнинга меняйте значения ниже.
            # Диапазон каждого параметра от -100 до 100, 0 — без изменений. Менять по 5–10 за раз.
            # gamma      — главный параметр: поднимает полутона и тени, почти не трогая белое.
            # brightness — сдвигает всё, включая чёрный: слишком много даёт серую «дымку».
            # contrast   — растягивает яркость; после поднятия gamma чуть добавьте, чтобы вернуть глубину.
            # saturation — тёмные кадры выглядят блёклыми, +5…+10 возвращает цвет.
            # deband     — в поднятых тенях проступают полосы, поэтому подчистка включена сильнее.
            gamma=20
            brightness=8
            contrast=6
            saturation=6
            deband=yes
            deband-iterations=3
            deband-threshold=45
            deband-range=20
            deband-grain=6

            [dark-extreme]
            # Очень тёмная картинка (ночные сцены, плохая раскодировка, тёмный экран). Сильно поднимает
            # тени за счёт шума и потери глубины чёрного. Если слишком ярко, уменьшите gamma на 10.
            # Параметры те же, что в [dark]; начинать подбор стоит с gamma.
            gamma=45
            brightness=15
            contrast=12
            saturation=12
            deband=yes
            deband-iterations=4
            deband-threshold=55
            deband-range=24
            deband-grain=10
            dither-depth=auto

            """, """
            # mpv.conf of the Lampa player. Format: option=value, one per line.
            # Options before the first [section] are common; [name] is a profile, chosen in Settings → MPV
            # or with the P key during a video. The file is read each time a video is opened.
            #
            # hwdec=videotoolbox
            #
            # [bright]
            # brightness=20
            #
            # ── Ready-made profiles (chosen in Settings → MPV or with the P key) ──
            # Rendering here uses the "gpu" renderer on OpenGL 4.1, so options that exist only for
            # gpu-next (libplacebo) have no effect. On Windows the renderer is gpu-next and they all work.

            [balanced]
            # Balanced quality for movies and series: light deband,
            # sharp upscaling. Fits most videos, moderate load.
            scale=ewa_lanczossharp
            cscale=ewa_lanczossharp
            dscale=mitchell
            scale-antiring=0.6
            correct-downscaling=yes
            linear-downscaling=yes
            sigmoid-upscaling=yes
            deband=yes
            deband-iterations=2
            deband-threshold=35
            deband-range=20
            deband-grain=5

            [quality]
            # Maximum quality for Apple Silicon Pro/Max and video up to 1080p: heavy scaling,
            # strong deband, HDR → SDR tone mapping. Weak machines may drop frames.
            # hdr-compute-peak does NOT work on macOS: it needs compute shaders, and OpenGL 4.1 has none
            # (mpv logs "Disabling HDR peak computation"); the peak is taken from the metadata instead.
            # On Windows (gpu-next, D3D11) the option works and measures the peak per frame.
            scale=ewa_lanczossharp
            cscale=ewa_lanczossharp
            dscale=ewa_lanczos
            scale-antiring=0.6
            cscale-antiring=0.6
            correct-downscaling=yes
            linear-downscaling=yes
            sigmoid-upscaling=yes
            deband=yes
            deband-iterations=4
            deband-threshold=40
            deband-range=20
            deband-grain=8
            hdr-compute-peak=yes
            tone-mapping=bt.2390

            [fast]
            # Light: 4K, weak hardware, virtual machine. Simple scaling, no deband.
            scale=bilinear
            cscale=bilinear
            dscale=bilinear
            deband=no
            dither-depth=no
            correct-downscaling=no
            sigmoid-upscaling=no

            [hdr-sdr]
            # HDR video on a regular (SDR) display: bt.2390 tone mapping compresses brightness to the screen range.
            # hdr-compute-peak has no effect on macOS (see [quality]); on Windows it measures the peak per frame.
            tone-mapping=bt.2390
            hdr-compute-peak=yes
            target-peak=auto
            deband=no

            [smooth]
            # Smooth motion 24→60 Hz: frame timing matched to the display plus interpolation.
            # Loads the GPU; if frames drop, go back to [balanced].
            video-sync=display-resample
            interpolation=yes
            tscale=oversample

            [anime]
            # Anime: stronger deband without grain (grain is visible on flat fills).
            scale=ewa_lanczossharp
            cscale=ewa_lanczossharp
            sigmoid-upscaling=yes
            deband=yes
            deband-iterations=3
            deband-threshold=48
            deband-range=16
            deband-grain=0

            [night]
            # Night mode: dynamic range compression and loudness normalization (quiet dialogue, loud explosions).
            af=acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11

            [dark]
            # Dark picture: moderately lifts shadows. Edit the values below for manual tuning.
            # Each parameter ranges from -100 to 100, 0 means unchanged. Change by 5–10 at a time.
            # gamma      — the main knob: lifts midtones and shadows, barely touching whites.
            # brightness — shifts everything including black: too much gives a grey haze.
            # contrast   — stretches brightness; after raising gamma add a little to bring back depth.
            # saturation — dark frames look washed out, +5…+10 brings the colour back.
            # deband     — banding shows in lifted shadows, so debanding is stronger.
            gamma=20
            brightness=8
            contrast=6
            saturation=6
            deband=yes
            deband-iterations=3
            deband-threshold=45
            deband-range=20
            deband-grain=6

            [dark-extreme]
            # Very dark picture (night scenes, poor encodes, dim screen). Lifts shadows strongly
            # at the cost of noise and black depth. If too bright, lower gamma by 10.
            # Same parameters as in [dark]; start tuning with gamma.
            gamma=45
            brightness=15
            contrast=12
            saturation=12
            deband=yes
            deband-iterations=4
            deband-threshold=55
            deband-range=24
            deband-grain=10
            dither-depth=auto

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

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
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
