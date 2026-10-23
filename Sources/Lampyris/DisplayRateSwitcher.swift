import AppKit
import CoreGraphics
import LampyrisCore

/// Переключает режим экрана на частоту кадров видео и возвращает прежний. Работает только в полноэкранном окне:
/// в оконном режиме смена режима затронула бы весь рабочий стол. Изменение действует «только для приложения»
/// (kCGConfigureForAppOnly): если Lampyris завершится аварийно, система сама вернёт прежний режим.
@MainActor
final class DisplayRateSwitcher {
    private var original: (display: CGDirectDisplayID, mode: CGDisplayMode)?
    private weak var window: NSWindow?
    private var observer: NSObjectProtocol?

    init(window: @escaping @MainActor () -> NSWindow?) {
        self.windowProvider = window
    }

    private let windowProvider: @MainActor () -> NSWindow?

    /// Подбирает режим под `fps`; 0 или nil возвращает прежний режим.
    func match(fps: Double?) {
        guard let fps, fps > 0 else { return restore() }
        guard let window = windowProvider(), window.styleMask.contains(.fullScreen),
              let number = window.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return }
        let display = CGDirectDisplayID(number.uint32Value)
        // Базой считается режим до первого переключения, чтобы повторные подборы не накапливались.
        let base = original?.mode ?? CGDisplayCopyDisplayMode(display)
        guard let base else { return }
        let options = [kCGDisplayShowDuplicateLowResolutionModes: true] as CFDictionary
        let modes = (CGDisplayCopyAllDisplayModes(display, options) as? [CGDisplayMode] ?? []).filter {
            $0.width == base.width && $0.height == base.height && $0.pixelWidth == base.pixelWidth && $0.pixelHeight == base.pixelHeight
        }
        guard let rate = DisplayRate.pick(fps: fps, rates: modes.map(\.refreshRate)),
              let target = modes.first(where: { $0.refreshRate == rate }) else {
            Log.log(.info, "display", "режима под \(fps) к/с нет: частота экрана не меняется")
            return
        }
        if let current = CGDisplayCopyDisplayMode(display), current.refreshRate == target.refreshRate, original == nil { return }
        if apply(target, on: display) {
            if original == nil { original = (display, base) }
            watchFullScreenExit(window)
            Log.log(.info, "display", "частота экрана \(target.refreshRate) Гц под \(fps) к/с")
        }
    }

    func restore() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        guard let o = original else { return }
        original = nil
        _ = apply(o.mode, on: o.display)
        Log.log(.info, "display", "режим экрана возвращён")
    }

    private func apply(_ mode: CGDisplayMode, on display: CGDirectDisplayID) -> Bool {
        var config: CGDisplayConfigRef?
        guard CGBeginDisplayConfiguration(&config) == .success else { return false }
        CGConfigureDisplayWithDisplayMode(config, display, mode, nil)
        if CGCompleteDisplayConfiguration(config, .forAppOnly) != .success {
            CGCancelDisplayConfiguration(config)
            return false
        }
        return true
    }

    private func watchFullScreenExit(_ window: NSWindow) {
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(forName: NSWindow.willExitFullScreenNotification, object: window, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.restore() }
        }
    }
}
