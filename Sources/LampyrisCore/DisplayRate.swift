import Foundation

/// Выбор частоты обновления экрана под частоту кадров видео (против дрожания картинки на 24, 25 и 30 к/с).
/// Одинаковая логика в `windows/src/display_rate.rs`: менять оба сразу.
public enum DisplayRate {
    /// Допуск совпадения: 23.976 к/с и режим 24 Гц отличаются на 0.1 %, такие режимы считаются подходящими.
    static let tolerance = 0.002
    static let maxMultiple = 4

    /// Из доступных частот `rates` берёт ту, что равна частоте кадров или кратна ей (1×, 2×, 3×, 4×); при равных кратностях
    /// побеждает меньшая. nil, если ничего не подошло (тогда режим экрана не трогаем) или частота кадров неправдоподобна.
    public static func pick(fps: Double, rates: [Double]) -> Double? {
        guard fps.isFinite, fps >= 10, fps <= 120 else { return nil }
        for m in 1...maxMultiple {
            let target = fps * Double(m)
            let hits = rates.filter { $0 > 0 && abs($0 - target) / target < tolerance }
            if let best = hits.min(by: { abs($0 - target) < abs($1 - target) }) { return best }
        }
        return nil
    }
}
