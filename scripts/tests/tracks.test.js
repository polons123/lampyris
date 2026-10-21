// Тесты подписей дорожек и сопоставления выбора. Выполняются внутри функции вместе с блоком @pure.
let failed = 0;
function eq(actual, expected, name) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { failed++; print("FAIL " + name + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected)); }
}

eq(normLang("rus"), "ru", "normLang rus");
eq(normLang("ru-RU"), "ru", "normLang регион");
eq(normLang("und"), "", "normLang und");

eq(studioOf("LF"), "LostFilm", "LF");
eq(studioOf("Lostfilm 5.1"), "LostFilm", "Lostfilm");
eq(studioOf("Кубик в Кубе"), "Кубик в Кубе", "Кубик");
eq(studioOf("Original"), "", "не студия");
eq(studioOf("alf"), "", "lf внутри слова не студия");

const ac3 = { type: "audio", id: 1, lang: "rus", title: "LF", codec: "ac3", "demux-channel-count": 6 };
eq(audioLabel(ac3, "Русский"), "LostFilm · AC3 5.1", "подпись звука");
eq(audioLabel({ type: "audio", id: 2, lang: "eng", title: "English", codec: "aac", "demux-channel-count": 2 }, "English"), "AAC 2.0", "название = язык");

eq(subLabel({ type: "sub", lang: "rus", forced: true, codec: "subrip" }, "Русский", true), "Форсированные", "forced");
eq(subLabel({ type: "sub", lang: "rus", title: "SDH", "hearing-impaired": true, codec: "subrip" }, "Русский", true), "SDH", "sdh без повтора");
eq(subLabel({ type: "sub", lang: "eng", codec: "hdmv_pgs_subtitle" }, "English", false), "Full · Graphic", "графические");
eq(subLabel({ type: "sub", lang: "rus", title: "LostFilm", external: true, codec: "subrip" }, "Русский", true), "LostFilm · Полные · Внешние", "внешние");

const aud = [
  { type: "audio", id: 1, lang: "eng", title: "" },
  { type: "audio", id: 2, lang: "rus", title: "Кубик в Кубе" },
  { type: "audio", id: 3, lang: "rus", title: "LF" },
];
eq(matchAudio(aud, { lang: "ru", studio: "LostFilm", title: "LostFilm" }), 3, "студия важнее порядка");
eq(matchAudio(aud, { lang: "rus", title: "Кубик в Кубе" }), 2, "старый формат prefs");
eq(matchAudio(aud, { lang: "ja", title: "" }), undefined, "нет такого языка");

const subs = [
  { type: "sub", id: 1, lang: "rus", forced: true },
  { type: "sub", id: 2, lang: "rus", title: "Full" },
  { type: "sub", id: 3, lang: "eng" },
];
eq(matchSub(subs, { off: true }), "no", "отключено");
eq(matchSub(subs, { lang: "ru", kind: "full" }), 2, "тот же тип");
eq(matchSub(subs, { lang: "rus", forced: true }), 1, "старый формат forced");
eq(matchSub([subs[0]], { lang: "ru", kind: "full" }), undefined, "другой тип не подменяем");

eq(pickByOrder(aud, "ru/LostFilm, ru, en"), 3, "порядок: студия");
eq(pickByOrder(aud, "ja, en"), 1, "порядок: второй язык");
eq(pickByOrder(aud, ""), undefined, "порядок пуст");
eq(pickByOrder(subs, "ru"), 2, "порядок: полные раньше форсированных");

eq(smartSubs(subs, { lang: "eng" }, "ru"), 2, "умный: чужой звук → полные");
eq(smartSubs(subs, { lang: "rus" }, "ru"), "no", "умный: свой звук → выкл");
eq(smartSubs([subs[0], subs[2]], { lang: "eng" }, "ru"), 1, "умный: только форсированные");
eq(smartSubs([subs[2]], { lang: "jpn" }, "ru"), undefined, "умный: нет языка");

eq(networkLabel(1250000, 0, 5, false, true), "10.00 Mbit/s", "сеть: cache-speed");
eq(networkLabel(0, 500000, 5, false, true), "4.00 Mbit/s", "сеть: raw-input-rate");
eq(networkLabel(0, 0, 30, false, true), "буфер заполнен", "сеть: буфер полон");
eq(networkLabel(0, 0, 30, true, false), "file loaded", "сеть: файл загружен");
eq(networkLabel(undefined, undefined, NaN, false, true), "—", "сеть: нет данных");

const ch = [{ time: 0, title: "A" }, { time: 100, title: "B" }, { time: 200, title: "C" }];
eq(chapterTarget(ch, 50, 1), { index: 1, time: 100 }, "глава вперёд");
eq(chapterTarget(ch, 250, 1), undefined, "после последней");
eq(chapterTarget(ch, 150, -1), { index: 1, time: 100 }, "назад: начало текущей");
eq(chapterTarget(ch, 101, -1), { index: 0, time: 0 }, "назад: сразу после начала → предыдущая");
eq(chapterTarget([], 5, 1), undefined, "глав нет");

eq(studioOf("Невафильм"), "Невафильм", "студия: Невафильм");
eq(studioOf("AniLibria.TV"), "AniLibria", "студия: аниме");
eq(studioOf("Дубляж Netflix"), "Netflix", "студия: платформа");
eq(studioOf("Кинопоиск HD"), "Кинопоиск", "студия: Кинопоиск");
eq(studioOf("Нарезка"), "", "нет ложной «резки»");
eq(studioOf("Первый"), "", "слово не равно «Первый канал»");
eq(studioOf("Telegram"), "", "gram не студия");
eq(studioOf("Jam session"), "JAM", "короткое слово целиком");
eq(studioOf("Jammer"), "", "jam внутри слова не студия");

if (failed) throw new Error("провалено тестов: " + failed);
