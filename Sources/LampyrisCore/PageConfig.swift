import Foundation

extension MpvConfig {
    private static func pageNumber(_ value: String, low: Double, high: Double) -> Bool {
        guard value.range(of: "^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$", options: .regularExpression) != nil,
              let number = Double(value), number.isFinite else { return false }
        return number >= low && number <= high
    }

    /// Запись из недоверенной страницы: только известные параметры картинки и звука.
    /// Ручное редактирование файла по-прежнему использует общий parse(). Политика совпадает с Windows.
    public static func isSafeForPage(_ text: String) -> Bool {
        guard text.utf8.count <= maxBytes else { return false }
        let config = parse(text)
        guard config.ignored.isEmpty else { return false }
        return (config.global + config.profiles.values.flatMap { $0 }).allSatisfy { entry in
            guard entry.op == nil, entry.value.count <= 160 else { return false }
            switch entry.name {
            case "gamma": return pageNumber(entry.value, low: -100, high: 100)
            case "brightness": return pageNumber(entry.value, low: -100, high: 100)
            case "contrast": return pageNumber(entry.value, low: -100, high: 100)
            case "saturation": return pageNumber(entry.value, low: -100, high: 100)
            case "hue": return pageNumber(entry.value, low: -100, high: 100)
            case "volume": return pageNumber(entry.value, low: 0, high: 100)
            case "speed": return pageNumber(entry.value, low: 0.25, high: 4)
            case "audio-delay": return pageNumber(entry.value, low: -30, high: 30)
            case "sub-delay": return pageNumber(entry.value, low: -120, high: 120)
            case "sub-scale": return pageNumber(entry.value, low: 0.25, high: 4)
            case "sub-pos": return pageNumber(entry.value, low: 0, high: 150)
            case "sub-border-size": return pageNumber(entry.value, low: 0, high: 10)
            case "sub-shadow-offset": return pageNumber(entry.value, low: 0, high: 10)
            case "sub-margin-y": return pageNumber(entry.value, low: 0, high: 200)
            case "scale-antiring": return pageNumber(entry.value, low: 0, high: 1)
            case "cscale-antiring": return pageNumber(entry.value, low: 0, high: 1)
            case "deband-iterations": return pageNumber(entry.value, low: 1, high: 16)
            case "deband-threshold": return pageNumber(entry.value, low: 0, high: 100)
            case "deband-range": return pageNumber(entry.value, low: 1, high: 64)
            case "deband-grain": return pageNumber(entry.value, low: 0, high: 100)
            case "deband": return ["yes", "no"].contains(entry.value)
            case "correct-downscaling": return ["yes", "no"].contains(entry.value)
            case "linear-downscaling": return ["yes", "no"].contains(entry.value)
            case "sigmoid-upscaling": return ["yes", "no"].contains(entry.value)
            case "hdr-compute-peak": return ["yes", "no"].contains(entry.value)
            case "interpolation": return ["yes", "no"].contains(entry.value)
            case "mute": return ["yes", "no"].contains(entry.value)
            case "scale": return ["bilinear", "bicubic", "lanczos", "mitchell", "spline36", "ewa_lanczos", "ewa_lanczossharp"].contains(entry.value)
            case "cscale": return ["bilinear", "bicubic", "lanczos", "mitchell", "spline36", "ewa_lanczos", "ewa_lanczossharp"].contains(entry.value)
            case "dscale": return ["bilinear", "bicubic", "lanczos", "mitchell", "spline36", "ewa_lanczos", "ewa_lanczossharp"].contains(entry.value)
            case "tone-mapping": return ["auto", "clip", "mobius", "reinhard", "hable", "bt.2390", "gamma", "linear"].contains(entry.value)
            case "video-sync": return ["audio", "display-resample", "display-resample-vdrop", "display-vdrop"].contains(entry.value)
            case "tscale": return ["oversample", "linear", "box", "triangle"].contains(entry.value)
            case "dither-depth": return ["no", "auto", "8", "10", "12", "16"].contains(entry.value)
            case "target-peak": return ["auto", "100", "120", "200", "400", "600", "1000"].contains(entry.value)
            case "sub-border-style": return ["outline-and-shadow", "background-box", "opaque-box", "none"].contains(entry.value)
            case "sub-font": return ["sans-serif", "Arial", "Verdana", "Georgia", "Courier New"].contains(entry.value)
            case "hwdec": return ["auto", "auto-safe", "no", "videotoolbox", "d3d11va", "dxva2-copy"].contains(entry.value)
            case "af": return ["acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11"].contains(entry.value)
            case "sub-color", "sub-back-color":
                return entry.value.range(of: "^#[A-Fa-f0-9]{6}([A-Fa-f0-9]{2})?$", options: .regularExpression) != nil
            default: return false
            }
        }
    }
}
