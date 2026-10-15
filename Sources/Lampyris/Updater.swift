import AppKit
import LampyrisCore

/// Проверка и установка обновлений из GitHub Releases.
/// Цепочка доверия: подпись SHA256SUMS.txt (ключ вшит в приложение) → SHA-256 архива → проверка распакованного .app (bundle id, версия, подпись).
/// Настройки (UserDefaults, данные WKWebView) лежат вне .app и при замене пакета не затрагиваются.
@MainActor
final class Updater {
    static let shared = Updater()

    /// Показывает ход загрузки (заголовок окна); nil — вернуть обычный заголовок.
    var statusHandler: ((String?) -> Void)?

    private let defaults = UserDefaults.standard
    private let autoKey = "updateAutoCheck", lastKey = "updateLastCheck", skippedKey = "updateSkippedVersion"
    private let checkInterval: TimeInterval = 24 * 3600
    private var busy = false

    private struct Failure: Error { let text: String }

    private var env: [String: String] { ProcessInfo.processInfo.environment }

    /// Версия запущенного приложения; без Info.plist (swift run) обновления отключены. LAMPA_UPDATE_VERSION подменяет её для проверки.
    private var currentVersion: String? {
        env["LAMPA_UPDATE_VERSION"] ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    var autoCheck: Bool {
        get { defaults.object(forKey: autoKey) as? Bool ?? true }
        set { defaults.set(newValue, forKey: autoKey) }
    }

    /// Фоновая проверка при запуске: не чаще раза в сутки, без сообщений, если обновлений нет или произошла ошибка.
    func checkOnLaunch() {
        guard autoCheck, currentVersion != nil else { return }
        let last = defaults.double(forKey: lastKey)
        guard Date().timeIntervalSince1970 - last > checkInterval else { return }
        Task { await run(manual: false) }
    }

    func checkManually() {
        Task { await run(manual: true) }
    }

    /// Чистка кэша обновлений: распакованные версии и копии прежних версий хранятся неделю.
    static func cleanCache() {
        let dir = cacheDir
        guard let items = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let limit = Date().addingTimeInterval(-7 * 86400)
        for f in items {
            if let d = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate, d < limit {
                try? FileManager.default.removeItem(at: f)
            }
        }
    }

    private static var cacheDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Lampyris/update", isDirectory: true)
    }

    // MARK: - Проверка

    private func run(manual: Bool) async {
        guard !busy else { return }
        guard let current = currentVersion, Update.parseVersion(current) != nil else {
            if manual { alert(tr("Обновления недоступны", "Updates unavailable"), tr("Не удалось определить версию приложения (запуск не из пакета .app).", "Could not determine the app version (not running from an .app bundle).")) }
            return
        }
        busy = true
        defer { busy = false; statusHandler?(nil) }
        do {
            let release = try await fetchRelease()
            defaults.set(Date().timeIntervalSince1970, forKey: lastKey)
            guard Update.isNewer(release.version, than: current) else {
                Log.log(.info, "update", "версия \(current) актуальна")
                if manual { alert(tr("У вас последняя версия", "You are up to date"), tr("Lampyris \(current) — самая новая.", "Lampyris \(current) is the latest version.")) }
                return
            }
            if !manual && defaults.string(forKey: skippedKey) == release.version { return }
            Log.log(.info, "update", "доступна версия \(release.version) (установлена \(current))")
            await offer(release, current: current)
        } catch let e as Failure {
            Log.log(.warn, "update", "проверка не удалась: \(e.text)")
            if manual { alert(tr("Не удалось проверить обновления", "Could not check for updates"), e.text) }
        } catch {
            Log.log(.warn, "update", "проверка не удалась: \(error.localizedDescription)")
            if manual { alert(tr("Не удалось проверить обновления", "Could not check for updates"), error.localizedDescription) }
        }
    }

    private func fetchRelease() async throws -> Update.Release {
        let api = env["LAMPA_UPDATE_API"] ?? Update.latestURL
        guard let url = URL(string: api) else { throw Failure(text: tr("неверный адрес проверки", "invalid update check address")) }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let data = try await fetch(req)
        guard let release = Update.parseRelease(data) else { throw Failure(text: tr("не удалось разобрать ответ сервера обновлений", "could not parse the update server response")) }
        return release
    }

    private func fetch(_ req: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw Failure(text: tr("сервер обновлений ответил кодом \((response as? HTTPURLResponse)?.statusCode ?? 0)", "the update server replied with code \((response as? HTTPURLResponse)?.statusCode ?? 0)"))
        }
        guard data.count <= Update.maxMetaBytes else { throw Failure(text: tr("ответ слишком большой", "the response is too large")) }
        return data
    }

    // MARK: - Предложение и установка

    /// Установка в пакет на месте возможна, если приложение запущено из .app вне карантинного «переноса» и рядом можно писать.
    private var installBlocker: String? {
        let url = Bundle.main.bundleURL
        guard url.pathExtension == "app" else { return tr("приложение запущено не из пакета .app", "the app is not running from an .app bundle") }
        if url.path.contains("/AppTranslocation/") {
            return tr("приложение запущено прямо из загрузок: переместите Lampyris в «Программы» и запустите оттуда", "the app is running straight from Downloads: move Lampyris to Applications and launch it from there")
        }
        if !FileManager.default.isWritableFile(atPath: url.deletingLastPathComponent().path) {
            return tr("нет прав на запись в папку \(url.deletingLastPathComponent().path)", "no write permission for the folder \(url.deletingLastPathComponent().path)")
        }
        return nil
    }

    private func offer(_ release: Update.Release, current: String) async {
        let blocker = installBlocker
        let a = NSAlert()
        a.messageText = tr("Доступна версия \(release.version)", "Version \(release.version) is available")
        var info = tr("Установлена версия \(current).", "Installed version: \(current).")
        let notes = release.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !notes.isEmpty { info += "\n\n" + String(notes.prefix(700)) }
        if let blocker { info += tr("\n\nАвтоустановка недоступна: \(blocker).", "\n\nAutomatic installation is unavailable: \(blocker).") }
        else { info += tr("\n\nНастройки и адрес сервера сохранятся. Приложение закроется и откроется заново.", "\n\nYour settings and server address will be kept. The app will close and reopen.") }
        a.informativeText = info
        // Ссылка на описание изменений (только https).
        if let page = URL(string: release.pageURL), page.scheme == "https" {
            let link = NSTextField(labelWithAttributedString: NSAttributedString(
                string: tr("Что изменилось в этой версии", "What changed in this version"),
                attributes: [.link: page, .font: NSFont.systemFont(ofSize: NSFont.systemFontSize)]))
            link.allowsEditingTextAttributes = true
            link.isSelectable = true
            link.sizeToFit()
            a.accessoryView = link
        }
        a.addButton(withTitle: blocker == nil ? tr("Установить и перезапустить", "Install and Restart") : tr("Открыть страницу загрузки", "Open Download Page"))
        a.addButton(withTitle: tr("Позже", "Later"))
        a.addButton(withTitle: tr("Пропустить эту версию", "Skip This Version"))
        NSApp.activate(ignoringOtherApps: true)
        switch a.runModal() {
        case .alertFirstButtonReturn:
            if blocker == nil { await install(release) }
            else if let u = URL(string: release.pageURL) { NSWorkspace.shared.open(u) }
        case .alertThirdButtonReturn:
            defaults.set(release.version, forKey: skippedKey)
        default: break
        }
    }

    private func install(_ release: Update.Release) async {
        busy = true
        defer { busy = false; statusHandler?(nil) }
        do {
            try await downloadVerifyAndApply(release)
        } catch let e as Failure {
            Log.log(.error, "update", "установка не удалась: \(e.text)")
            alert(tr("Не удалось установить обновление", "Could not install the update"), e.text + tr("\n\nУстановленная версия не изменена.", "\n\nThe installed version was not changed."))
        } catch {
            Log.log(.error, "update", "установка не удалась: \(error.localizedDescription)")
            alert(tr("Не удалось установить обновление", "Could not install the update"), error.localizedDescription + tr("\n\nУстановленная версия не изменена.", "\n\nThe installed version was not changed."))
        }
    }

    private func downloadVerifyAndApply(_ release: Update.Release) async throws {
        let base = env["LAMPA_UPDATE_BASE"] ?? Update.downloadBase
        #if arch(arm64)
        let isArm = true
        #else
        let isArm = false
        #endif
        let name = Update.macAssetName(version: release.version, arm64: isArm)
        guard let sumsURL = Update.assetURL(base: base, version: release.version, name: "SHA256SUMS.txt"),
              let sigURL = Update.assetURL(base: base, version: release.version, name: "SHA256SUMS.txt.sig"),
              let zipURL = Update.assetURL(base: base, version: release.version, name: name) else { throw Failure(text: tr("неверный адрес файла обновления", "invalid update file address")) }

        // 1. Подписанный список контрольных сумм.
        statusHandler?(tr("Lampyris — проверка обновления…", "Lampyris — checking the update…"))
        let sums = try await fetch(URLRequest(url: sumsURL, timeoutInterval: 30))
        let sig = try await fetch(URLRequest(url: sigURL, timeoutInterval: 30))
        let key = env["LAMPA_UPDATE_PUBKEY"] ?? Update.publicKeyHex
        guard Update.verifySignature(message: sums, signature: sig, publicKeyHex: key) else {
            throw Failure(text: tr("подпись списка контрольных сумм не прошла проверку: файлы релиза не заслуживают доверия", "the checksum list signature did not verify: the release files cannot be trusted"))
        }
        guard let expected = Update.parseSums(String(decoding: sums, as: UTF8.self))[name] else {
            throw Failure(text: tr("в списке контрольных сумм нет файла \(name)", "\(name) is not in the checksum list"))
        }

        // 2. Загрузка архива и сверка SHA-256.
        let stage = Self.cacheDir.appendingPathComponent(release.version, isDirectory: true)
        try? FileManager.default.removeItem(at: stage)
        try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: true)
        let zip = stage.appendingPathComponent(name)
        try await download(zipURL, to: zip)
        guard (try? Update.sha256Hex(of: zip)) == expected else { throw Failure(text: tr("контрольная сумма загруженного файла не совпала", "the downloaded file's checksum does not match")) }

        // 3. Распаковка и проверка пакета.
        statusHandler?(tr("Lampyris — подготовка обновления…", "Lampyris — preparing the update…"))
        let unpacked = stage.appendingPathComponent("new", isDirectory: true)
        try FileManager.default.createDirectory(at: unpacked, withIntermediateDirectories: true)
        guard await Self.exec("/usr/bin/ditto", ["-x", "-k", zip.path, unpacked.path]) == 0 else { throw Failure(text: tr("не удалось распаковать архив", "could not unpack the archive")) }
        try? FileManager.default.removeItem(at: zip)
        let newApp = unpacked.appendingPathComponent("Lampyris.app")
        let plist = newApp.appendingPathComponent("Contents/Info.plist")
        guard let info = NSDictionary(contentsOf: plist),
              info["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
              info["CFBundleShortVersionString"] as? String == release.version else {
            throw Failure(text: tr("в архиве не тот пакет (идентификатор или версия не совпали)", "the archive has the wrong package (identifier or version mismatch)"))
        }
        guard await Self.exec("/usr/bin/codesign", ["--verify", "--strict", "--deep", newApp.path]) == 0 else {
            throw Failure(text: tr("подпись пакета в архиве нарушена", "the package signature in the archive is broken"))
        }

        // 4. Замена пакета отдельным процессом после выхода из приложения.
        let target = Bundle.main.bundleURL
        let backup = Self.cacheDir.appendingPathComponent("previous-\(currentVersion ?? "old")", isDirectory: true).appendingPathComponent("Lampyris.app")
        let script = stage.appendingPathComponent("replace.sh")
        try Self.replaceScript.write(to: script, atomically: true, encoding: .utf8)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = [script.path, String(ProcessInfo.processInfo.processIdentifier), newApp.path, target.path, backup.path, Log.folderURL.path]
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try p.run()
        Log.log(.info, "update", "обновление до \(release.version) подготовлено, перезапуск")
        NSApp.terminate(nil)
    }

    private final class ProgressToken: @unchecked Sendable { var observation: NSKeyValueObservation? }

    private func download(_ url: URL, to dest: URL) async throws {
        statusHandler?(tr("Lampyris — загрузка обновления 0%", "Lampyris — downloading the update 0%"))
        let limit = Update.maxPackageBytes
        let box = ProgressToken()
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let task = URLSession.shared.downloadTask(with: url) { tmp, response, error in
                box.observation?.invalidate()
                if let error { cont.resume(throwing: Failure(text: tr("загрузка не удалась: \(error.localizedDescription)", "download failed: \(error.localizedDescription)"))); return }
                guard let tmp, (response as? HTTPURLResponse)?.statusCode == 200 else {
                    cont.resume(throwing: Failure(text: tr("сервер ответил кодом \((response as? HTTPURLResponse)?.statusCode ?? 0)", "the server replied with code \((response as? HTTPURLResponse)?.statusCode ?? 0)"))); return
                }
                let size = (try? FileManager.default.attributesOfItem(atPath: tmp.path)[.size] as? Int) ?? nil
                guard let size, size <= limit else { cont.resume(throwing: Failure(text: tr("файл обновления слишком большой", "the update file is too large"))); return }
                do { try FileManager.default.moveItem(at: tmp, to: dest); cont.resume() }
                catch { cont.resume(throwing: Failure(text: tr("не удалось сохранить файл: \(error.localizedDescription)", "could not save the file: \(error.localizedDescription)"))) }
            }
            box.observation = task.progress.observe(\.fractionCompleted) { progress, _ in
                if task.countOfBytesReceived > Int64(limit) { task.cancel() }
                let percent = Int(progress.fractionCompleted * 100)
                Task { @MainActor in Updater.shared.statusHandler?(tr("Lampyris — загрузка обновления \(percent)%", "Lampyris — downloading the update \(percent)%")) }
            }
            task.resume()
        }
    }

    nonisolated private static func exec(_ path: String, _ args: [String]) async -> Int32 {
        await withCheckedContinuation { cont in
            let p = Process()
            p.executableURL = URL(fileURLWithPath: path)
            p.arguments = args
            p.standardOutput = FileHandle.nullDevice
            p.standardError = FileHandle.nullDevice
            p.terminationHandler = { cont.resume(returning: $0.terminationStatus) }
            do { try p.run() } catch { cont.resume(returning: -1) }
        }
    }

    /// Ждёт выхода приложения, меняет пакет (прежний сохраняется), снимает карантин и запускает новую версию; при ошибке возвращает прежнюю.
    private static let replaceScript = """
    #!/bin/sh
    # Аргументы: pid приложения, новый .app, текущий .app, куда сохранить прежний .app, папка журнала.
    PID="$1"; NEW="$2"; TARGET="$3"; BACKUP="$4"; LOGDIR="$5"
    mkdir -p "$LOGDIR"
    LOG="$LOGDIR/update.log"
    say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
    n=0
    while kill -0 "$PID" 2>/dev/null; do
      n=$((n+1)); [ "$n" -gt 150 ] && { say "приложение не закрылось, обновление отменено"; exit 1; }
      sleep 0.2
    done
    mkdir -p "$(dirname "$BACKUP")"
    rm -rf "$BACKUP"
    if ! mv "$TARGET" "$BACKUP"; then say "не удалось убрать прежнюю версию"; open "$TARGET"; exit 1; fi
    if ! mv "$NEW" "$TARGET"; then
      say "не удалось поставить новую версию, возвращаю прежнюю"
      rm -rf "$TARGET"; mv "$BACKUP" "$TARGET"; open "$TARGET"; exit 1
    fi
    xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
    say "обновлено: $TARGET"
    open "$TARGET"
    """

    private func alert(_ title: String, _ text: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }
}
