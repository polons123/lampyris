import Testing
@testable import LampyrisCore

@Suite("Подбор частоты экрана")
struct DisplayRateTests {
    @Test("23.976 к/с выбирает 24 Гц, а при их отсутствии 48 Гц")
    func film() {
        #expect(DisplayRate.pick(fps: 23.976, rates: [24, 30, 50, 60]) == 24)
        #expect(DisplayRate.pick(fps: 23.976, rates: [48, 60]) == 48)
    }

    @Test("25 к/с без режима 25 Гц берёт 50 Гц, подходящих нет — nil")
    func pal() {
        #expect(DisplayRate.pick(fps: 25, rates: [24, 50, 60]) == 50)
        #expect(DisplayRate.pick(fps: 23.976, rates: [30, 50, 60]) == nil)
    }

    @Test("при равной кратности берётся ближайшая к точной частоте, неправдоподобные значения отвергаются")
    func closest() {
        #expect(DisplayRate.pick(fps: 29.97, rates: [24, 29.97, 30, 60]) == 29.97)
        #expect(DisplayRate.pick(fps: 5, rates: [60]) == nil)
        #expect(DisplayRate.pick(fps: .nan, rates: [60]) == nil)
    }
}
