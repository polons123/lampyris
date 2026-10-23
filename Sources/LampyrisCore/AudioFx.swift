import Foundation

/// Звуковые эффекты плеера: эквалайзер, усиление речи, ночной режим. Страница присылает только числа,
/// строку фильтра ffmpeg собирает приложение (произвольные фильтры страница задать не может).
/// Одинаковая логика в `windows/src/audio_fx.rs`: менять оба сразу.
public enum AudioFx {
    /// Метка фильтра в цепочке `af`: по ней он снимается и ставится заново, не затрагивая `af` из mpv.conf и профилей.
    public static let label = "lyfx"
    public static let bandFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    public static let maxGain = 12
    public static let maxDialogue = 3
    static let nightChain = "acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11"

    /// Строка для `lavfi=[…]` либо nil, когда эффекты не нужны. `bands` — усиление полос в дБ (целые, от -12 до 12),
    /// `dialogue` — сила усиления речевого диапазона 0…3, `night` — сжатие громкости ночного профиля.
    public static func graph(bands: [Int], dialogue: Int, night: Bool) -> String? {
        var parts: [String] = []
        var boosted = false
        for (i, f) in bandFrequencies.enumerated() where i < bands.count {
            let g = max(-maxGain, min(maxGain, bands[i]))
            if g == 0 { continue }
            if g > 0 { boosted = true }
            parts.append("equalizer=f=\(f):t=q:w=1.4:g=\(g)")
        }
        let d = max(0, min(maxDialogue, dialogue))
        if d > 0 {
            boosted = true
            parts.append("equalizer=f=1000:t=q:w=1:g=\(d)")
            parts.append("equalizer=f=2500:t=q:w=0.8:g=\(d * 2)")
        }
        if night { parts.append(nightChain) }
        if parts.isEmpty { return nil }
        // Подъём полос может дать перегрузку: ограничитель держит пик ниже предела.
        if boosted { parts.append("alimiter=limit=0.95") }
        return parts.joined(separator: ",")
    }

    /// Аргументы команды mpv для замены метки: сначала `af remove @lyfx`, затем (если нужно) `af add @lyfx:lavfi=[…]`.
    public static func commands(graph: String?) -> [[String]] {
        var out = [["af", "remove", "@\(label)"]]
        if let graph { out.append(["af", "add", "@\(label):lavfi=[\(graph)]"]) }
        return out
    }
}
