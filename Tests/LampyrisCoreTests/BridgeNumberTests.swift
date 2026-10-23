import Testing
@testable import LampyrisCore

@Suite("Числа из сообщений страницы")
struct BridgeNumberTests {
    @Test("обычные значения принимаются, дробная часть отбрасывается")
    func normal() {
        #expect(BridgeNumber.int(50, in: 0...100) == 50)
        #expect(BridgeNumber.int(50.9, in: 0...100) == 50)
        #expect(BridgeNumber.int(-3.5, in: -10...10) == -3)
    }

    @Test("NaN, бесконечность, огромные значения и вне диапазона отклоняются без падения")
    func rejected() {
        #expect(BridgeNumber.int(Double.nan, in: 0...100) == nil)
        #expect(BridgeNumber.int(Double.infinity, in: 0...100) == nil)
        #expect(BridgeNumber.int(1e100, in: 0...100) == nil)
        #expect(BridgeNumber.int(-1e100, in: 0...100) == nil)
        #expect(BridgeNumber.int(101, in: 0...100) == nil)
    }

    @Test("не числа и булевы значения отклоняются")
    func notNumbers() {
        #expect(BridgeNumber.int("5", in: 0...100) == nil)
        #expect(BridgeNumber.int(true, in: 0...100) == nil)
        #expect(BridgeNumber.int(nil, in: 0...100) == nil)
        #expect(BridgeNumber.int([1], in: 0...100) == nil)
    }

    @Test("clampedInt прижимает к границам, но не принимает NaN и не-числа")
    func clamped() {
        #expect(BridgeNumber.clampedInt(1e100, in: 0...100) == 100)
        #expect(BridgeNumber.clampedInt(-1e100, in: 0...100) == 0)
        #expect(BridgeNumber.clampedInt(Double.infinity, in: 0...100) == 100)
        #expect(BridgeNumber.clampedInt(Double.nan, in: 0...100) == nil)
        #expect(BridgeNumber.clampedInt(false, in: 0...100) == nil)
    }
}
