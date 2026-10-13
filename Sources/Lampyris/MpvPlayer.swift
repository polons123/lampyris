import AppKit
import CMpv
import IOKit.pwr_mgt
import OpenGL.GL3

private func glGetProcAddress(_ ctx: UnsafeMutableRawPointer?, _ name: UnsafePointer<CChar>?) -> UnsafeMutableRawPointer? {
    guard let name else { return nil }
    let bundle = CFBundleGetBundleWithIdentifier("com.apple.opengl" as CFString)
    return CFBundleGetFunctionPointerForName(bundle, String(cString: name) as CFString)
}

// Колбэки libmpv приходят из потоков mpv, поэтому объявлены вне @MainActor.
private func mpvRenderUpdateCallback(_ ctx: UnsafeMutableRawPointer?) {
    guard let ctx else { return }
    let addr = UInt(bitPattern: ctx)
    DispatchQueue.main.async {
        MainActor.assumeIsolated {
            Unmanaged<MpvPlayer>.fromOpaque(UnsafeRawPointer(bitPattern: addr)!).takeUnretainedValue().renderUpdate()
        }
    }
}

private func mpvWakeupCallback(_ ctx: UnsafeMutableRawPointer?) {
    guard let ctx else { return }
    let addr = UInt(bitPattern: ctx)
    DispatchQueue.main.async {
        MainActor.assumeIsolated {
            Unmanaged<MpvPlayer>.fromOpaque(UnsafeRawPointer(bitPattern: addr)!).takeUnretainedValue().drainEvents()
        }
    }
}

/// NSOpenGLView, в который libmpv рисует кадры через render API.
@MainActor
final class MpvVideoView: NSOpenGLView {
    fileprivate var renderContext: OpaquePointer?

    init(videoFrame frame: NSRect) {
        let attrs: [NSOpenGLPixelFormatAttribute] = [
            UInt32(NSOpenGLPFAOpenGLProfile), UInt32(NSOpenGLProfileVersion3_2Core),
            UInt32(NSOpenGLPFADoubleBuffer), UInt32(NSOpenGLPFAAccelerated), 0,
        ]
        let format = NSOpenGLPixelFormat(attributes: attrs)!
        super.init(frame: frame, pixelFormat: format)!
        wantsBestResolutionOpenGLSurface = true
        var swap: GLint = 1
        openGLContext?.setValues(&swap, for: .swapInterval)
    }

    required init?(coder: NSCoder) { fatalError() }

    /// Запрошенный снимок: draw() после отрисовки кадра читает буфер окна и передаёт PNG сюда.
    /// Штатный screenshot-to-file не годится: с hwdec=videotoolbox кадр лежит в видеопамяти, libswscale его не читает.
    fileprivate var snapshotCrop: (ml: Double, mt: Double, mr: Double, mb: Double, w: Double, h: Double)?
    fileprivate var snapshotResult: Data?
    fileprivate var snapshotRequested = false

    /// Снимок видимой картинки (в размере окна на экране, без чёрных полей).
    func snapshotPNG(crop: (ml: Double, mt: Double, mr: Double, mb: Double, w: Double, h: Double)?) -> Data? {
        snapshotCrop = crop
        snapshotResult = nil
        snapshotRequested = true
        display()  // синхронный draw
        snapshotRequested = false
        return snapshotResult
    }

    private func readSnapshot(width: Int, height: Int) -> Data? {
        glPixelStorei(GLenum(GL_PACK_ALIGNMENT), 1)
        glReadBuffer(GLenum(GL_BACK))
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        glReadPixels(0, 0, GLsizei(width), GLsizei(height), GLenum(GL_RGBA), GLenum(GL_UNSIGNED_BYTE), &pixels)
        // Область картинки в пикселях буфера (начало координат OpenGL — снизу слева).
        var x0 = 0, x1 = width, yTop = 0, yBottom = height
        if let c = snapshotCrop, c.w > 0, c.h > 0 {
            let sx = Double(width) / c.w, sy = Double(height) / c.h
            x0 = max(0, min(width - 1, Int((c.ml * sx).rounded())))
            x1 = max(x0 + 1, min(width, width - Int((c.mr * sx).rounded())))
            yTop = max(0, min(height - 1, Int((c.mt * sy).rounded())))
            yBottom = max(yTop + 1, min(height, height - Int((c.mb * sy).rounded())))
        }
        let outW = x1 - x0, outH = yBottom - yTop
        var rows = [UInt8](repeating: 255, count: outW * outH * 4)
        for y in 0..<outH {
            // Строка y результата (сверху вниз) лежит в буфере с конца.
            let srcRow = height - 1 - (yTop + y)
            let src = (srcRow * width + x0) * 4
            for i in 0..<(outW * 4) { rows[y * outW * 4 + i] = pixels[src + i] }
            for x in 0..<outW { rows[(y * outW + x) * 4 + 3] = 255 }
        }
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: outW, pixelsHigh: outH, bitsPerSample: 8,
                                         samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                         bytesPerRow: outW * 4, bitsPerPixel: 32), let data = rep.bitmapData else { return nil }
        rows.withUnsafeBufferPointer { data.update(from: $0.baseAddress!, count: rows.count) }
        return rep.representation(using: .png, properties: [:])
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = openGLContext else { return }
        ctx.makeCurrentContext()
        if let rc = renderContext {
            let size = convertToBacking(bounds).size
            var fbo = mpv_opengl_fbo(fbo: 0, w: Int32(size.width), h: Int32(size.height), internal_format: 0)
            var flip: Int32 = 1
            withUnsafeMutablePointer(to: &fbo) { fboPtr in
                withUnsafeMutablePointer(to: &flip) { flipPtr in
                    var params = [
                        mpv_render_param(type: MPV_RENDER_PARAM_OPENGL_FBO, data: fboPtr),
                        mpv_render_param(type: MPV_RENDER_PARAM_FLIP_Y, data: flipPtr),
                        mpv_render_param(type: MPV_RENDER_PARAM_INVALID, data: nil),
                    ]
                    mpv_render_context_render(rc, &params)
                }
            }
        } else {
            glClearColor(0, 0, 0, 1)
            glClear(GLbitfield(GL_COLOR_BUFFER_BIT))
        }
        if snapshotRequested {
            let size = convertToBacking(bounds).size
            snapshotResult = readSnapshot(width: Int(size.width), height: Int(size.height))
        }
        ctx.flushBuffer()
    }
}

enum MpvError: Error, CustomStringConvertible {
    case failed(String, Int32)
    var description: String {
        switch self {
        case let .failed(what, code): return "\(what): \(String(cString: mpv_error_string(code)))"
        }
    }
}

@MainActor
final class MpvPlayer {
    private var handle: OpaquePointer?
    private weak var view: MpvVideoView?
    /// События mpv в виде словаря: {event, ...}. Для property-change: {event, name, data}.
    var onMessage: (([String: Any]) -> Void)?

    init() throws {
        guard let h = mpv_create() else { throw MpvError.failed("mpv_create", MPV_ERROR_GENERIC.rawValue) }
        handle = h
        // config=no: штатный mpv.conf не читаем; свой файл с профилями применяет MpvConfig.
        for (k, v) in [("vo", "libmpv"), ("hwdec", "videotoolbox"), ("input-default-bindings", "no"),
                       ("input-vo-keyboard", "no"), ("osc", "no"), ("config", "no"),
                       ("keep-open", "yes"), ("idle", "yes"), ("ytdl", "no"), ("load-scripts", "no")] {
            mpv_set_option_string(h, k, v)
        }
        // Общие опции из mpv.conf — до инициализации, чтобы подействовали и «стартовые» (например, hwdec).
        for e in MpvConfig.load().global {
            // Значение до mpv.conf (выставленное приложением или заводское) — к нему вернёмся, если опцию уберут из файла.
            if baseline[e.name] == nil, let c = mpv_get_property_string(h, "options/\(e.name)") {
                baseline[e.name] = String(cString: c)
                mpv_free(c)
            }
            appliedNames.append(e.name)
            mpv_set_option_string(h, e.op.map { "\(e.name)-\($0)" } ?? e.name, e.value)
        }
        let rc = mpv_initialize(h)
        if rc < 0 { throw MpvError.failed("mpv_initialize", rc) }
        mpv_request_log_messages(h, "warn")
    }

    /// Привязывает рендер к GL-виду. Вызывать после добавления вида в окно.
    func attach(to view: MpvVideoView) throws {
        guard let h = handle else { return }
        self.view = view
        view.openGLContext?.makeCurrentContext()
        var initParams = mpv_opengl_init_params(get_proc_address: glGetProcAddress, get_proc_address_ctx: nil)
        var rc: Int32 = 0
        var rcCtx: OpaquePointer?
        "opengl".withCString { api in
            withUnsafeMutablePointer(to: &initParams) { ip in
                var params = [
                    mpv_render_param(type: MPV_RENDER_PARAM_API_TYPE, data: UnsafeMutableRawPointer(mutating: api)),
                    mpv_render_param(type: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, data: ip),
                    mpv_render_param(type: MPV_RENDER_PARAM_INVALID, data: nil),
                ]
                rc = mpv_render_context_create(&rcCtx, h, &params)
            }
        }
        if rc < 0 { throw MpvError.failed("mpv_render_context_create", rc) }
        view.renderContext = rcCtx
        let me = Unmanaged.passUnretained(self).toOpaque()
        mpv_render_context_set_update_callback(rcCtx, mpvRenderUpdateCallback, me)
        mpv_set_wakeup_callback(h, mpvWakeupCallback, me)
    }

    fileprivate func renderUpdate() {
        guard let rc = view?.renderContext else { return }
        if mpv_render_context_update(rc) & UInt64(MPV_RENDER_UPDATE_FRAME.rawValue) != 0 {
            view?.needsDisplay = true
        }
    }

    fileprivate func drainEvents() {
        guard let h = handle else { return }
        while let ev = mpv_wait_event(h, 0), ev.pointee.event_id != MPV_EVENT_NONE {
            var msg: [String: Any] = ["event": String(cString: mpv_event_name(ev.pointee.event_id))]
            switch ev.pointee.event_id {
            case MPV_EVENT_LOG_MESSAGE:
                let m = ev.pointee.data.assumingMemoryBound(to: mpv_event_log_message.self).pointee
                msg["level"] = String(cString: m.level)
                msg["prefix"] = String(cString: m.prefix)
                msg["text"] = String(cString: m.text).trimmingCharacters(in: .whitespacesAndNewlines)
            case MPV_EVENT_START_FILE, MPV_EVENT_FILE_LOADED:
                fileActive = true
                updateSleepAssertion()
            case MPV_EVENT_END_FILE:
                fileActive = false
                updateSleepAssertion()
                let e = ev.pointee.data.assumingMemoryBound(to: mpv_event_end_file.self).pointee
                msg["reason"] = Int(e.reason.rawValue)
                if e.error < 0 { msg["error"] = String(cString: mpv_error_string(e.error)) }
            case MPV_EVENT_PROPERTY_CHANGE:
                let p = ev.pointee.data.assumingMemoryBound(to: mpv_event_property.self).pointee
                msg["name"] = String(cString: p.name)
                msg["data"] = propertyValue(p) ?? NSNull()
                if msg["name"] as? String == "pause", let flag = msg["data"] as? Bool {
                    paused = flag
                    updateSleepAssertion()
                }
            default:
                break
            }
            onMessage?(msg)
        }
    }

    private func propertyValue(_ p: mpv_event_property) -> Any? {
        guard let data = p.data else { return nil }
        switch p.format {
        case MPV_FORMAT_FLAG: return data.assumingMemoryBound(to: Int32.self).pointee != 0
        case MPV_FORMAT_INT64: return Int(data.assumingMemoryBound(to: Int64.self).pointee)
        case MPV_FORMAT_DOUBLE: return data.assumingMemoryBound(to: Double.self).pointee
        case MPV_FORMAT_STRING:
            guard let c = data.assumingMemoryBound(to: UnsafeMutablePointer<CChar>?.self).pointee else { return nil }
            return String(cString: c)
        case MPV_FORMAT_NODE: return nodeValue(data.assumingMemoryBound(to: mpv_node.self))
        default: return nil
        }
    }

    private func nodeValue(_ n: UnsafePointer<mpv_node>) -> Any? {
        switch n.pointee.format {
        case MPV_FORMAT_STRING: return String(cString: n.pointee.u.string)
        case MPV_FORMAT_FLAG: return n.pointee.u.flag != 0
        case MPV_FORMAT_INT64: return Int(n.pointee.u.int64)
        case MPV_FORMAT_DOUBLE: return n.pointee.u.double_
        case MPV_FORMAT_NODE_ARRAY:
            guard let list = n.pointee.u.list else { return [] }
            return (0..<Int(list.pointee.num)).map { nodeValue(list.pointee.values + $0) ?? NSNull() }
        case MPV_FORMAT_NODE_MAP:
            guard let list = n.pointee.u.list else { return [:] }
            var d: [String: Any] = [:]
            for i in 0..<Int(list.pointee.num) {
                d[String(cString: list.pointee.keys[i]!)] = nodeValue(list.pointee.values + i) ?? NSNull()
            }
            return d
        default: return nil
        }
    }

    /// Подписка на свойства, изменения приходят в onMessage как property-change.
    func observe(_ props: [(String, mpv_format)]) {
        guard let h = handle else { return }
        for (i, (name, format)) in props.enumerated() { mpv_observe_property(h, UInt64(i + 1), name, format) }
    }

    func get(_ name: String) -> Any? {
        guard let h = handle else { return nil }
        var node = mpv_node()
        guard mpv_get_property(h, name, MPV_FORMAT_NODE, &node) >= 0 else { return nil }
        defer { mpv_free_node_contents(&node) }
        return withUnsafePointer(to: &node) { nodeValue($0) }
    }

    @discardableResult
    func set(_ name: String, _ value: String) -> Bool {
        guard let h = handle else { return false }
        return mpv_set_property_string(h, name, value) >= 0
    }

    /// Не даём macOS гасить дисплей и включать заставку, пока видео открыто и не на паузе
    /// (у mpv в нашем окне нет собственного «вывода», как у <video> в браузере).
    private var sleepAssertion: IOPMAssertionID = 0
    private var fileActive = false
    private var paused = false

    private func updateSleepAssertion() {
        let need = fileActive && !paused
        if need, sleepAssertion == 0 {
            var id: IOPMAssertionID = 0
            let rc = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
                                                 IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                                 "Lampyris video playback" as CFString, &id)
            if rc == kIOReturnSuccess { sleepAssertion = id }
        } else if !need, sleepAssertion != 0 {
            IOPMAssertionRelease(sleepAssertion)
            sleepAssertion = 0
        }
    }

    /// Растёт при каждом открытии видео: отложенные результаты (скачанные субтитры) сверяются с ним, чтобы не попасть в другое видео.
    private(set) var openGeneration = 0

    /// Имена опций, изменённых mpv.conf при предыдущем открытии: перед новым применением их надо вернуть.
    private var appliedNames: [String] = []
    /// Значения опций до первого вмешательства mpv.conf (то, что выставило приложение или осталось по
    /// умолчанию): именно к ним возвращаемся при смене или снятии профиля, а не к заводским значениям mpv.
    private var baseline: [String: String] = [:]

    /// Открывает URL; options — пары для loadfile (start, demuxer-readahead-secs и т.п.).
    /// mpv.conf читается заново при каждом открытии; его опции важнее настроек приложения.
    func open(_ url: String, options: [String: String], profile: String? = nil) {
        openGeneration += 1
        let names = applyConfig(profile: profile)
        let opts = options.filter { !names.contains($0.key) }.map { "\($0.key)=\($0.value)" }.joined(separator: ",")
        command(["loadfile", url, "replace", "-1", opts])
    }

    /// Применяет общие опции mpv.conf и профиль к текущему состоянию mpv, в том числе во время
    /// воспроизведения (перезапуск плеера не нужен). Возвращает имена затронутых опций.
    @discardableResult
    func applyConfig(profile: String?) -> Set<String> {
        let cfg = MpvConfig.load()
        let entries = cfg.entries(profile: profile)
        for name in appliedNames {
            if let v = baseline[name] { set(name, v) }
        }
        for e in entries where baseline[e.name] == nil {
            // Запоминаем до изменения. Опцию без значения запоминать нечем: вернём заводское.
            baseline[e.name] = getString(e.name) ?? getString("option-info/\(e.name)/default-value")
        }
        for e in entries {
            let rc: Int32
            if let op = e.op {
                rc = commandStatus(["change-list", e.name, op, e.value])
            } else {
                rc = handle.map { mpv_set_property_string($0, e.name, e.value) } ?? -1
            }
            if rc < 0 { Log.log(.warn, "mpv", "mpv.conf: \(e.name)=\(e.value): \(String(cString: mpv_error_string(rc)))") }
        }
        appliedNames = Array(Set(entries.map(\.name)))
        return Set(appliedNames)
    }

    /// Подключает внешние субтитры (файл формирует приложение) и сразу включает их.
    func addSubtitle(path: String, title: String, lang: String) -> Bool {
        commandStatus(["sub-add", path, "select", title, lang]) >= 0
    }

    /// Снимок текущего кадра в родном размере видео в ~/Pictures/Lampyris. Путь формирует только приложение.
    func screenshot() -> [String: Any] {
        guard handle != nil else { return ["ok": false, "error": "mpv не запущен"] }
        let pictures = FileManager.default.urls(for: .picturesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Lampyris", isDirectory: true)
        do { try FileManager.default.createDirectory(at: pictures, withIntermediateDirectories: true) } catch {
            return ["ok": false, "error": error.localizedDescription]
        }
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd HH.mm.ss"
        let pos = Int(Double(getString("time-pos") ?? "") ?? 0)
        let name = String(format: "Lampyris %@ (%d.%02d.%02d).png", df.string(from: Date()), pos / 3600, pos / 60 % 60, pos % 60)
        let path = pictures.appendingPathComponent(name).path
        var crop: (ml: Double, mt: Double, mr: Double, mb: Double, w: Double, h: Double)?
        if let o = get("osd-dimensions") as? [String: Any], let w = (o["w"] as? Double) ?? (o["w"] as? Int).map(Double.init),
           let h = (o["h"] as? Double) ?? (o["h"] as? Int).map(Double.init) {
            func num(_ k: String) -> Double { (o[k] as? Double) ?? (o[k] as? Int).map(Double.init) ?? 0 }
            crop = (num("ml"), num("mt"), num("mr"), num("mb"), w, h)
        }
        guard let data = view?.snapshotPNG(crop: crop) else {
            return ["ok": false, "error": "не удалось снять кадр"]
        }
        do { try data.write(to: URL(fileURLWithPath: path)) } catch { return ["ok": false, "error": error.localizedDescription] }
        return ["ok": true, "path": path, "folder": pictures.path, "name": name]
    }

    private func commandStatus(_ args: [String]) -> Int32 {
        guard let h = handle else { return -1 }
        var cstrs: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) }
        cstrs.append(nil)
        defer { cstrs.forEach { free($0) } }
        var ptrs = cstrs.map { UnsafePointer<CChar>($0) }
        return mpv_command(h, &ptrs)
    }

    func stop() { command(["stop"]) }

    func command(_ args: [String]) {
        guard let h = handle else { return }
        var cstrs: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) }
        cstrs.append(nil)
        defer { cstrs.forEach { free($0) } }
        var ptrs = cstrs.map { UnsafePointer<CChar>($0) }
        let rc = mpv_command(h, &ptrs)
        if rc < 0 { onMessage?(["event": "command-failed", "command": args.first ?? "", "error": String(cString: mpv_error_string(rc))]) }
    }

    func load(_ url: String) { command(["loadfile", url]) }

    func getString(_ name: String) -> String? {
        guard let h = handle, let s = mpv_get_property_string(h, name) else { return nil }
        defer { mpv_free(s) }
        return String(cString: s)
    }

    func shutdown() {
        fileActive = false
        updateSleepAssertion()
        if let h = handle { mpv_set_wakeup_callback(h, nil, nil) }
        if let rc = view?.renderContext {
            mpv_render_context_set_update_callback(rc, nil, nil)
            view?.openGLContext?.makeCurrentContext()
            mpv_render_context_free(rc)
            view?.renderContext = nil
        }
        if let h = handle { mpv_terminate_destroy(h); handle = nil }
    }
}
