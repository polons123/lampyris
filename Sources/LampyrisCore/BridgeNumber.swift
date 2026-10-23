import Foundation

/// Разбор чисел из сообщений страницы. Страница недоверенная: `Int(Double)` в Swift аварийно завершает приложение
/// на NaN, бесконечности и значениях вне диапазона, поэтому все числа моста проходят через эту проверку.
public enum BridgeNumber {
    /// Целое из значения JSON (дробная часть отбрасывается). nil, если это не число (в том числе булево),
    /// число не конечное или результат вне `range`.
    public static func int(_ value: Any?, in range: ClosedRange<Int>) -> Int? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        guard d.isFinite else { return nil }
        let t = d.rounded(.towardZero)
        guard t >= Double(range.lowerBound), t <= Double(range.upperBound) else { return nil }
        return Int(t)
    }

    /// Как `int`, но вне диапазона значение прижимается к границе (для громкости и подобного); nil только для не-чисел.
    public static func clampedInt(_ value: Any?, in range: ClosedRange<Int>) -> Int? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        guard !d.isNaN else { return nil }
        let t = max(Double(range.lowerBound), min(Double(range.upperBound), d.rounded(.towardZero)))
        return Int(t)
    }
}
