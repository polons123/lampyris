import Testing
@testable import LampyrisCore

@Suite("Разбор mpv.conf")
struct MpvConfigTests {
    @Test("пустой текст и комментарии не дают записей")
    func emptyAndComments() {
        let cfg = MpvConfig.parse("\n   \n# комментарий\n   # ещё один\n")
        #expect(cfg.global.isEmpty)
        #expect(cfg.profiles.isEmpty)
        #expect(cfg.ignored.isEmpty)
    }

    @Test("опция=значение: имя в нижнем регистре, пробелы убираются, кавычки снимаются")
    func keyValue() {
        let cfg = MpvConfig.parse("Volume = 40\nsub-font=\"Helvetica Neue\"\nsub-file-paths='a b'\n--hwdec=videotoolbox")
        #expect(cfg.global == [
            .init(name: "volume", value: "40", op: nil),
            .init(name: "sub-font", value: "Helvetica Neue", op: nil),
            .init(name: "sub-file-paths", value: "a b", op: nil),
            .init(name: "hwdec", value: "videotoolbox", op: nil),
        ])
    }

    @Test("флаги: имя без значения = yes, no-имя = no")
    func flags() {
        let cfg = MpvConfig.parse("fs\nno-osd-bar")
        #expect(cfg.global == [.init(name: "fs", value: "yes", op: nil), .init(name: "osd-bar", value: "no", op: nil)])
    }

    @Test("суффиксы списков: add, append, set, pre, clr, remove")
    func listOperations() {
        let cfg = MpvConfig.parse("vf-add=hflip\naf-append=loudnorm\nvf-set=a\nvf-pre=b\nvf-remove=c\naf-clr=")
        let ops = cfg.global.map { [$0.name, $0.op ?? "-", $0.value] }
        #expect(ops == [["vf", "add", "hflip"], ["af", "append", "loudnorm"], ["vf", "set", "a"], ["vf", "pre", "b"],
                        ["vf", "remove", "c"], ["af", "clr", ""]])
    }

    @Test("обычные опции с «похожими» окончаниями не считаются операциями списка")
    func notListOps() {
        let cfg = MpvConfig.parse("audio-delay=0.2\nsub-pos=90\nosd-bar=no")
        #expect(cfg.global.allSatisfy { $0.op == nil })
        #expect(cfg.global.map(\.name) == ["audio-delay", "sub-pos", "osd-bar"])
    }

    @Test("запрещённые опции отбрасываются с причиной, в том числе с суффиксом списка")
    func blockedOptions() {
        let text = "script=/tmp/evil.lua\nvo=gpu\ninclude=/etc/other.conf\ninput-ipc-server=/tmp/s\nprofile=x\nscripts-append=/tmp/a.lua\nlog-file=/tmp/l\nvolume=50"
        let cfg = MpvConfig.parse(text)
        #expect(cfg.global == [.init(name: "volume", value: "50", op: nil)])
        #expect(cfg.ignored.count == 7)
        #expect(cfg.ignored.allSatisfy { $0.reason == "опция запрещена" })
        #expect(cfg.ignored.first?.line == 1)
    }

    @Test("профили [имя]: опции до первого раздела общие, остальные в профиле")
    func profiles() {
        let text = "hwdec=videotoolbox\n\n[bright]\nbrightness=30\ncontrast=5\n\n[dark]\nbrightness=-30\n[default]\nvolume=40"
        let cfg = MpvConfig.parse(text)
        #expect(cfg.profileNames == ["bright", "dark"])
        #expect(cfg.global.map(\.name) == ["hwdec", "volume"])
        #expect(cfg.profiles["bright"]?.map(\.name) == ["brightness", "contrast"])
        #expect(cfg.profiles["dark"]?.first?.value == "-30")
    }

    @Test("повторный раздел дополняет профиль и не дублирует его в списке имён")
    func profileMerge() {
        let cfg = MpvConfig.parse("[a]\nx=1\n[b]\ny=2\n[a]\nz=3")
        #expect(cfg.profileNames == ["a", "b"])
        #expect(cfg.profiles["a"]?.map(\.name) == ["x", "z"])
    }

    @Test("entries(profile:): общие, затем профиль; неизвестный профиль даёт только общие")
    func entriesForProfile() {
        let cfg = MpvConfig.parse("hwdec=no\n[p]\nbrightness=10")
        #expect(cfg.entries(profile: "p").map(\.name) == ["hwdec", "brightness"])
        #expect(cfg.entries(profile: nil).map(\.name) == ["hwdec"])
        #expect(cfg.entries(profile: "нет").map(\.name) == ["hwdec"])
    }

    @Test("недопустимое имя профиля: раздел и его строки пропускаются до следующего корректного")
    func invalidProfileName() {
        let cfg = MpvConfig.parse("[bad name!]\nbrightness=1\n[ok]\ncontrast=2")
        #expect(cfg.profileNames == ["ok"])
        #expect(cfg.profiles["ok"]?.map(\.name) == ["contrast"])
        #expect(cfg.ignored.map(\.line) == [1, 2])
        #expect(cfg.ignored.first?.reason == "недопустимое имя профиля")
    }

    @Test("строки, не похожие на «опция=значение», пропускаются, номера строк с единицы")
    func garbage() {
        let cfg = MpvConfig.parse("volume=10\n=oops\n!!!\nsub-pos=90")
        #expect(cfg.global.map(\.name) == ["volume", "sub-pos"])
        #expect(cfg.ignored.map(\.line) == [2, 3])
    }

    @Test("символ NUL в значении недопустим")
    func nulCharacter() {
        let cfg = MpvConfig.parse("volume=1\u{0}2")
        #expect(cfg.global.isEmpty)
        #expect(cfg.ignored.first?.reason == "недопустимые символы")
    }

    @Test("переводы строк Windows (CRLF)")
    func crlf() {
        let cfg = MpvConfig.parse("volume=40\r\n[p]\r\nbrightness=5\r\n")
        #expect(cfg.global.map(\.name) == ["volume"])
        #expect(cfg.profiles["p"]?.first?.value == "5")
    }
}
