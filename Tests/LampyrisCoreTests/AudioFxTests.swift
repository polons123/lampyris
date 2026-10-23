import Testing
@testable import LampyrisCore

@Suite("Звуковые эффекты")
struct AudioFxTests {
    @Test("без эффектов фильтра нет")
    func empty() {
        #expect(AudioFx.graph(bands: Array(repeating: 0, count: 10), dialogue: 0, night: false) == nil)
        #expect(AudioFx.graph(bands: [], dialogue: 0, night: false) == nil)
    }

    @Test("полосы с нулём пропускаются, усиление ограничивается ±12, ставится ограничитель")
    func bands() {
        let g = AudioFx.graph(bands: [20, 0, -30, 0, 0, 0, 0, 0, 0, 0], dialogue: 0, night: false)
        #expect(g == "equalizer=f=31:t=q:w=1.4:g=12,equalizer=f=125:t=q:w=1.4:g=-12,alimiter=limit=0.95")
    }

    @Test("только ослабление не даёт ограничителя")
    func cutOnly() {
        #expect(AudioFx.graph(bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, -6], dialogue: 0, night: false) == "equalizer=f=16000:t=q:w=1.4:g=-6")
    }

    @Test("речь и ночной режим")
    func dialogueAndNight() {
        #expect(AudioFx.graph(bands: [], dialogue: 9, night: true)
            == "equalizer=f=1000:t=q:w=1:g=3,equalizer=f=2500:t=q:w=0.8:g=6,acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95")
    }

    @Test("команды: снять метку и добавить новую")
    func commands() {
        #expect(AudioFx.commands(graph: nil) == [["af", "remove", "@lyfx"]])
        #expect(AudioFx.commands(graph: "x") == [["af", "remove", "@lyfx"], ["af", "add", "@lyfx:lavfi=[x]"]])
    }
}
