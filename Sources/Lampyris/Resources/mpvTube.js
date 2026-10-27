// Встроенный плеер mpv для Lampa: «тюб» для Lampa.PlayerVideo, повторяющий часть
// интерфейса HTMLVideoElement. Видео рисует libmpv в нативном виде под этой
// (прозрачной) страницей; команды и события идут через WKScriptMessageHandler.
(function () {
  if (window.desktopMpvInstalled) return;
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mpv;
  if (!handler) return;

  const norm = (v) => (typeof v === "boolean" ? (v ? "yes" : "no") : v);
  const call = (m, ...a) => handler.postMessage({ m, a: a.map(norm) });
  const api = {
    open: (url, opts) => call("open", url, opts),
    command: (args) => call("command", args.map(String)),
    get: (name) => call("get", name),
    set: (name, value) => call("set", name, value),
    stop: () => call("stop"),
    profile: (name) => call("profile", name),
    screenshot: () => call("screenshot"),
    subsSearch: (imdb, season, episode) => call("subsSearch", imdb, season || 0, episode || 0),
    subsLoad: (url, title, lang) => call("subsLoad", url, title, lang),
    nowPlaying: (info) => call("nowPlaying", info),
    nowPlayingClear: () => call("nowPlayingClear"),
    tidbMedia: (id, season, episode) => call("tidbMedia", id, season == null ? 0 : season, episode == null ? 0 : episode),
    audioFx: (fx) => call("audioFx", fx),
    displayRate: (fps) => call("displayRate", fps),
    pickLocal: () => call("pickLocal"),
    getConfig: () => call("getConfig"),
    setConfig: (text) => call("setConfig", text),
  };

  // @pure-begin
  // Чистая логика дорожек (без DOM и без моста): подписи, сопоставление запомненного выбора, порядок предпочтений.
  // Проверяется scripts/test-js.sh: этот блок вырезается по маркерам и запускается в jsc.
  const LANG3 = { rus: "ru", eng: "en", ukr: "uk", bel: "be", jpn: "ja", deu: "de", ger: "de", fra: "fr", fre: "fr", spa: "es", ita: "it",
    kor: "ko", zho: "zh", chi: "zh", por: "pt", pol: "pl", tur: "tr", ces: "cs", cze: "cs", swe: "sv", nld: "nl", dut: "nl", hin: "hi" };
  function normLang(code) {
    const raw = String(code || "").trim().toLowerCase().split(/[-_]/)[0];
    if (!raw || raw === "und" || raw === "unk" || raw === "mis" || raw === "zxx") return "";
    return LANG3[raw] || raw;
  }

  // Студии озвучки: [название, подстроки без пробелов и знаков, короткие слова целиком].
  const STUDIOS = [
    // Сериальные студии и фанатские группы.
    ["LostFilm", ["lostfilm", "лостфильм"], ["lf"]],
    ["NewStudio", ["newstudio", "ньюстудио"], ["ns"]],
    ["Кубик в Кубе", ["кубикв", "kubikv", "kubik"], []],
    ["HDRezka Studio", ["hdrezka", "rezkastudio"], []],
    ["Jaskier", ["jaskier", "яскер"], []],
    ["Baibako", ["baibako", "байбако"], []],
    ["NovaFilm", ["novafilm", "новафильм"], []],
    ["ColdFilm", ["coldfilm", "колдфильм"], []],
    ["AlexFilm", ["alexfilm", "алексфильм"], []],
    ["Kerob", ["kerob", "кероб"], []],
    ["TVShows", ["tvshows"], []],
    ["Gears Media", ["gearsmedia"], []],
    ["Good People", ["goodpeople"], []],
    ["Кураж-Бамбей", ["куражбамбей", "kurazhbambey"], []],
    ["Пифагор", ["пифагор", "pifagor"], []],
    ["Amedia", ["amedia", "амедиа"], []],
    ["SDI Media", ["sdimedia"], []],
    ["Paramount Comedy", ["paramountcomedy"], []],
    // Дубляжи и озвучки кинопрокатных и телестудий.
    ["Мосфильм-Мастер", ["мосфильммастер", "mosfilmmaster"], []],
    ["Невафильм", ["невафильм", "nevafilm"], []],
    ["Союз Видео", ["союзвидео", "soyuzvideo"], []],
    ["Селена Интернешнл", ["селена", "selena"], []],
    ["Варус Видео", ["варусвидео", "varusvideo"], []],
    ["Studio Band", ["studioband"], []],
    ["Первый канал", ["первыйканал", "1tv"], []],
    ["РЕН ТВ", ["рентв", "rentv"], []],
    ["ТВ-3", ["тв3"], []],
    ["СТС", [], ["стс", "sts"]],
    ["ТНТ", [], ["тнт", "tnt"]],
    // Аниме-группы.
    ["AniLibria", ["anilibria", "анилибрия"], []],
    ["AniDub", ["anidub", "анидаб"], []],
    ["SovetRomantica", ["sovetromantica", "советромантика"], []],
    ["Shiza Project", ["shiza", "шиза"], []],
    ["AniStar", ["anistar", "анистар"], []],
    ["Dream Cast", ["dreamcast"], []],
    ["Persona99", ["persona99"], []],
    ["Reanimedia", ["reanimedia"], []],
    ["JAM", [], ["jam"]],
    // Платформы и стриминги.
    ["Netflix", ["netflix", "нетфликс"], ["nf"]],
    ["Amazon", ["amazon", "амазон"], []],
    ["Disney+", ["disney", "дисней"], []],
    ["Apple TV+", ["appletv"], []],
    ["HBO", ["hbo"], []],
    ["Кинопоиск", ["кинопоиск", "kinopoisk"], []],
    ["Okko", ["okko", "окко"], []],
    ["ivi", ["иви"], ["ivi"]],
    ["Premier", ["premier", "премьер"], []],
    ["Wink", ["wink"], []],
    ["Crunchyroll", ["crunchyroll", "кранчиролл"], []],
    ["Wakanim", ["wakanim"], []],
  ];


  // Студия по названию дорожки ("" — не узнана).
  function studioOf(title) {
    const words = String(title || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const flat = words.join("");
    for (const [name, subs, shorts] of STUDIOS) {
      if (subs.some((s) => flat.includes(s)) || shorts.some((s) => words.includes(s))) return name;
    }
    return "";
  }

  const AUDIO_CODECS = { ac3: "AC3", eac3: "E-AC3", dts: "DTS", truehd: "TrueHD", aac: "AAC", opus: "Opus", flac: "FLAC", mp3: "MP3", vorbis: "Vorbis", pcm_s16le: "PCM", pcm_s24le: "PCM" };
  function channelsText(t) {
    const n = Number(t["demux-channel-count"]);
    if (!(n > 0)) return String(t["demux-channels"] || "");
    return { 1: "1.0", 2: "2.0", 3: "2.1", 6: "5.1", 7: "6.1", 8: "7.1" }[n] || n + "ch";
  }

  // Название озвучки: студия, иначе название дорожки без повтора языка.
  function trackName(t, language) {
    const title = String(t.title || "").trim();
    if (!title) return "";
    const studio = studioOf(title);
    if (studio) return studio;
    return title.toLowerCase() === String(language || "").toLowerCase() ? "" : title;
  }

  // Подпись звуковой дорожки (язык показывается отдельно): «студия · кодек каналы».
  function audioLabel(t, language) {
    const codec = AUDIO_CODECS[String(t.codec || "").toLowerCase()] || String(t.codec || "").toUpperCase();
    const tech = [codec, channelsText(t)].filter(Boolean).join(" ");
    return [trackName(t, language), tech].filter(Boolean).join(" · ");
  }

  const GRAPHIC_SUBS = /^(dvd_subtitle|dvb_subtitle|hdmv_pgs_subtitle|dvb_teletext|xsub|vobsub)$/i;
  // Тип субтитров: forced, sdh или full (флаги mpv или слова в названии).
  function subKind(t) {
    const title = String(t.title || "");
    if (t.forced || /forced|форс/i.test(title)) return "forced";
    if (t["hearing-impaired"] || /\bsdh\b|\bcc\b|hearing|для\s*глухих/i.test(title)) return "sdh";
    return "full";
  }

  // Подпись субтитров: «название · тип · графические · внешние».
  function subLabel(t, language, ru) {
    const kind = subKind(t);
    const names = { forced: ru ? "Форсированные" : "Forced", sdh: "SDH", full: ru ? "Полные" : "Full" };
    // Слова о типе из названия не повторяем.
    let title = trackName(t, language).replace(/forced|форсированные|форс\.?|full|полные|\bsdh\b|\bcc\b/gi, "").replace(/[\s·,()\-–—]+/g, " ").trim();
    if (title.toLowerCase() === String(language || "").toLowerCase()) title = "";
    const parts = [title, names[kind]];
    if (GRAPHIC_SUBS.test(String(t.codec || ""))) parts.push(ru ? "Графические" : "Graphic");
    if (t.external) parts.push(ru ? "Внешние" : "External");
    return parts.filter(Boolean).join(" · ");
  }

  // Отпечатки выбранных дорожек для запоминания.
  function audioPref(t) {
    return { lang: normLang(t.lang), studio: studioOf(t.title), title: t.title || "" };
  }
  // Субтитры, загруженные из интернета (названия «RU · …», «EN · …» задаёт applySubtitle): для следующей серии ищутся заново.
  function isOnlineSub(t) {
    return Boolean(t && t.external && /^(RU|EN) · /.test(String(t.title || "")));
  }
  function subPref(t) {
    return t ? { lang: normLang(t.lang), studio: studioOf(t.title), title: t.title || "", kind: subKind(t), online: isOnlineSub(t) } : { off: true };
  }

  // Подходящая озвучка среди текущих (язык, затем студия и название), либо undefined.
  function matchAudio(tracks, pref) {
    if (!pref) return undefined;
    const lang = normLang(pref.lang);
    const same = tracks.filter((t) => normLang(t.lang) === lang);
    const found = (pref.studio && same.find((t) => studioOf(t.title) === pref.studio)) ||
      same.find((t) => (t.title || "") === (pref.title || "")) || same[0];
    return found ? found.id : undefined;
  }

  // Субтитры: "no" для «отключено», иначе дорожка с тем же языком и типом; другой тип не подменяем.
  function matchSub(tracks, pref) {
    if (!pref) return undefined;
    if (pref.off) return "no";
    if (pref.online) return undefined;
    const lang = normLang(pref.lang);
    const kind = pref.kind || (pref.forced ? "forced" : "full");
    const same = tracks.filter((t) => normLang(t.lang) === lang && subKind(t) === kind);
    const found = (pref.studio && same.find((t) => studioOf(t.title) === pref.studio)) ||
      same.find((t) => (t.title || "") === (pref.title || "")) || same[0];
    return found ? found.id : undefined;
  }

  // Порядок предпочтений «ru/LostFilm, ru, en»: побеждает первая подошедшая запись.
  function parseOrder(text) {
    return String(text || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const [lang, ...rest] = s.split("/");
      return { lang: normLang(lang), studio: rest.join("/").trim().toLowerCase() };
    }).filter((e) => e.lang);
  }
  function pickByOrder(tracks, text) {
    for (const e of parseOrder(text)) {
      const same = tracks.filter((t) => normLang(t.lang) === e.lang);
      const hit = e.studio
        ? same.find((t) => studioOf(t.title).toLowerCase() === e.studio || String(t.title || "").toLowerCase().includes(e.studio))
        : same.find((t) => subKind(t) === "full") || same[0];
      if (hit) return hit.id;
    }
    return undefined;
  }

  // Умный выбор субтитров: звук на языке пользователя — субтитры выключены, иначе полные (затем форсированные, SDH) на его языке.
  function smartSubs(tracks, audio, lang) {
    lang = normLang(lang);
    if (!lang || !audio) return undefined;
    if (normLang(audio.lang) === lang) return "no";
    const mine = tracks.filter((t) => normLang(t.lang) === lang);
    for (const kind of ["full", "forced", "sdh"]) {
      const hit = mine.find((t) => subKind(t) === kind && !GRAPHIC_SUBS.test(String(t.codec || ""))) || mine.find((t) => subKind(t) === kind);
      if (hit) return hit.id;
    }
    return undefined;
  }

  // Скорость сети для окна статистики: cache-speed (байт/с, mpv сам усредняет), иначе мгновенная raw-input-rate.
  // Нулевая скорость при уже набранном буфере — не обрыв, а «буфер заполнен» (mpv перестал читать); без данных — прочерк.
  function networkLabel(cacheSpeed, rawRate, bufferAhead, eof, ru) {
    const speed = [cacheSpeed, rawRate].map(Number).find((x) => Number.isFinite(x) && x > 0);
    if (speed) return (speed * 8 / 1e6).toFixed(2) + " Mbit/s";
    if (eof) return ru ? "файл загружен" : "file loaded";
    if (Number.isFinite(bufferAhead) && bufferAhead > 1) return ru ? "буфер заполнен" : "buffer full";
    return "—";
  }

  // Глава для перехода: вперёд — следующая; назад — начало текущей, а если с её начала прошло меньше 3 с, то предыдущей.
  // Возвращает {index, time} или undefined, когда идти некуда.
  function chapterTarget(chapters, t, dir) {
    if (!Array.isArray(chapters) || !chapters.length) return undefined;
    let cur = -1;
    chapters.forEach((c, i) => { if (Number(c.time) <= t + 0.3) cur = i; });
    if (dir > 0) return cur + 1 < chapters.length ? { index: cur + 1, time: Number(chapters[cur + 1].time) } : undefined;
    if (cur < 0) return undefined;
    const idx = t - Number(chapters[cur].time) > 3 || cur === 0 ? cur : cur - 1;
    return { index: idx, time: Number(chapters[idx].time) };
  }

  // Сегменты пропуска по названиям глав файла («Opening», «Intro», «Credits», «Заставка», «Титры»…): запасной
  // источник, когда в TheIntroDB нет таймкодов. Сегмент идёт от начала главы до начала следующей (последняя — до конца).
  const CHAPTER_KINDS = [
    ["recap", /^(?:recap|previously|пересказ|ранее)(?![\p{L}\p{N}])/iu],
    ["intro", /^(?:opening|intro|op|заставка|опенинг|вступление)(?![\p{L}\p{N}])/iu],
    ["credits", /^(?:ending|end credits|credits|outro|ed|титры|эндинг|окончание|конец)(?![\p{L}\p{N}])/iu],
    ["preview", /^(?:preview|next|превью|анонс)(?![\p{L}\p{N}])/iu],
  ];
  function chapterSegments(chapters, duration) {
    if (!Array.isArray(chapters)) return [];
    const out = [];
    chapters.forEach((c, i) => {
      const title = String(c && c.title || "").trim();
      const kind = CHAPTER_KINDS.find((k) => k[1].test(title));
      const start = Number(c && c.time);
      if (!kind || !Number.isFinite(start)) return;
      const next = i + 1 < chapters.length ? Number(chapters[i + 1].time) : NaN;
      const end = Number.isFinite(next) ? next : (duration > 0 ? null : NaN);
      if (end !== null && !(end - start >= 3)) return;
      out.push({ type: kind[0], start, end });
    });
    return out;
  }
  // @pure-end

  const CLASS = "mpv-active";
  const COMPONENT = "mpv_settings";
  const ONLINE_SETTING = "mpv_online_enabled";
  const PROFILE_SETTING = "mpv_profile";
  const CONFIG_BUTTON = "mpv_config_edit";
  const BUFFER_SETTING = "mpv_buffer_secs";
  const SEEK_SETTING = "mpv_seek_step";
  const SKIP_SETTING = "mpv_skip_mode";
  const SUBS_SETTING = "mpv_online_subs";
  const STILL_SETTING = "mpv_still_watching";
  const REFRESH_SETTING = "mpv_refresh_match";
  const LOCAL_BUTTON = "mpv_open_local";
  const SMART_SUBS_SETTING = "mpv_smart_subs";
  const AUDIO_ORDER = "mpv_audio_order";
  const SUB_ORDER = "mpv_sub_order";
  // Вид субтитров в mpv (настройки субтитров самой Lampa относятся к HTML5-плееру и на mpv не действуют).
  // Один список на «Настройки → MPV» и окно субтитров в плеере (клавиша Y): оба пишут в одни ключи mpv_sub_*.
  const SUB_CHOICES = [
    { name: "mpv_sub_size", title: "app_settings_mpv_substyle_size", property: "sub-scale", def: "1",
      values: ["0.7", "0.85", "1", "1.25", "1.5", "2"],
      ru: ["Мелкий", "Меньше", "Обычный", "Крупный", "Очень крупный", "Огромный"], en: ["Small", "Smaller", "Normal", "Large", "Very large", "Huge"] },
    { name: "mpv_sub_pos", title: "app_settings_mpv_substyle_pos", property: "sub-pos", def: "100",
      values: ["100", "95", "90", "85"],
      ru: ["Внизу", "Чуть выше", "Выше", "Высоко"], en: ["Bottom", "A bit higher", "Higher", "High"] },
    { name: "mpv_sub_color", title: "app_settings_mpv_substyle_color", property: "sub-color", def: "#FFFFFF",
      values: ["#FFFFFF", "#FFFF00", "#00FFFF"],
      ru: ["Белый", "Жёлтый", "Голубой"], en: ["White", "Yellow", "Cyan"] },
    { name: "mpv_sub_box", title: "app_settings_mpv_substyle_box", property: "sub-border-style", def: "outline-and-shadow",
      values: ["outline-and-shadow", "background-box"],
      ru: ["Обводка", "Плашка"], en: ["Outline", "Box"] },
    { name: "mpv_sub_border", title: "app_settings_mpv_substyle_border", property: "sub-border-size", def: "3",
      values: ["0", "1.5", "3", "4.5", "6"],
      ru: ["Без обводки", "Тонкая", "Обычная", "Толстая", "Очень толстая"], en: ["None", "Thin", "Normal", "Thick", "Very thick"] },
    { name: "mpv_sub_shadow", title: "app_settings_mpv_substyle_shadow", property: "sub-shadow-offset", def: "0",
      values: ["0", "1", "2", "4"],
      ru: ["Без тени", "Лёгкая", "Средняя", "Глубокая"], en: ["None", "Light", "Medium", "Deep"] },
    { name: "mpv_sub_font", title: "app_settings_mpv_substyle_font", property: "sub-font", def: "sans-serif",
      values: ["sans-serif", "Arial", "Verdana", "Georgia", "Courier New"],
      ru: ["Системный", "Arial", "Verdana", "Georgia", "Courier New"], en: ["System", "Arial", "Verdana", "Georgia", "Courier New"] },
    { name: "mpv_sub_margin", title: "app_settings_mpv_substyle_margin", property: "sub-margin-y", def: "22",
      values: ["22", "40", "60", "90"],
      ru: ["Обычный", "Больше", "Большой", "Очень большой"], en: ["Normal", "More", "Large", "Very large"] },
  ];
  const SUB_STYLE = Object.fromEntries(SUB_CHOICES.map((c) => [c.name, { property: c.property, def: c.def }]));
  // Ставит одно свойство вида субтитров (плашка ещё меняет цвет подложки).
  function applySubStyleValue(name, value) {
    api.set(SUB_STYLE[name].property, value);
    if (name === "mpv_sub_box") api.set("sub-back-color", value === "background-box" ? "#B0000000" : "#00000000");
  }
  const VOLUME_STEP = 0.05;
  // Оболочка Android задаёт window.__lampyrisTV (true для ТВ) до загрузки скрипта; на macOS и Windows его нет.
  const ANDROID = typeof window.__lampyrisTV === "boolean";
  const BUFFER_MAX_BYTES = ANDROID ? "128MiB" : "512MiB";
  let active = null;

  function whenReady(fn) {
    const t = setInterval(() => {
      const L = window.Lampa;
      if (L && L.PlayerVideo && L.PlayerVideo.registerTube && L.Storage && L.Player) {
        clearInterval(t);
        fn(L);
      }
    }, 500);
  }

  // mpv включён по умолчанию; в настройках его можно выключить и играть встроенным <video>.
  function mpvEnabled(L) {
    const v = L.Storage.get(ONLINE_SETTING, true);
    return v === true || v === "true";
  }

  function addSettings(L) {
    L.Lang.add({
      app_settings_mpv: { ru: "MPV", en: "MPV" },
      app_settings_mpv_online: { ru: "Использовать mpv для видео", en: "Use mpv for video" },
      app_settings_mpv_online_descr: {
        ru: "Выключите, чтобы играть встроенным плеером " + (ANDROID ? "Android WebView" : "WebKit") + ". Он не воспроизводит MKV и ряд кодеков. Действует со следующего запуска видео.",
        en: "Turn off to play with the built-in " + (ANDROID ? "Android WebView" : "WebKit") + " player. It cannot play MKV and some codecs. Applies from the next video.",
      },
      app_settings_mpv_skip: { ru: "Пропуск заставок (TheIntroDB)", en: "Skip intros (TheIntroDB)" },
      app_settings_mpv_skip_descr: {
        ru: "Таймкоды заставок, пересказов, титров и анонсов из theintrodb.org (по TMDB-id, сезону и серии). «Кнопка» — показывать «Пропустить…» (клавиша N); «Автоматически» — сразу пропускать заставку и пересказ, а титры и анонс по кнопке. Данные есть не для всех видео.",
        en: "Timestamps for intros, recaps, credits and previews from theintrodb.org (by TMDB id, season and episode). Button shows “Skip…” (N key); Automatic skips intros and recaps at once, credits and previews stay on the button. Not every video has data.",
      },
      app_settings_mpv_substyle_size: { ru: "Субтитры: размер", en: "Subtitles: size" },
      app_settings_mpv_substyle_pos: { ru: "Субтитры: положение", en: "Subtitles: position" },
      app_settings_mpv_substyle_color: { ru: "Субтитры: цвет текста", en: "Subtitles: text color" },
      app_settings_mpv_substyle_box: { ru: "Субтитры: фон", en: "Subtitles: background" },
      app_settings_mpv_substyle_border: { ru: "Субтитры: обводка", en: "Subtitles: outline" },
      app_settings_mpv_substyle_shadow: { ru: "Субтитры: тень", en: "Subtitles: shadow" },
      app_settings_mpv_substyle_font: { ru: "Субтитры: шрифт", en: "Subtitles: font" },
      app_settings_mpv_substyle_margin: { ru: "Субтитры: отступ снизу", en: "Subtitles: bottom margin" },
      app_settings_mpv_substyle_descr: {
        ru: "Относится к субтитрам, которые рисует mpv. Действует со следующего видео; опции из mpv.conf важнее.",
        en: "Applies to subtitles drawn by mpv. Takes effect from the next video; options from mpv.conf take priority.",
      },
      app_settings_mpv_subs: { ru: "Субтитры из интернета", en: "Online subtitles" },
      app_settings_mpv_subs_descr: {
        ru: "Поиск субтитров (OpenSubtitles через Stremio, без ключа) для видео без них. «По запросу» — из меню плеера или клавишей U; «Авто» — сам найти и включить, если в видео нет субтитров на этом языке.",
        en: "Subtitle search (OpenSubtitles through Stremio, no key) for videos without them. Manual: from the player menu or the U key; Auto: find and enable on its own when the video has no subtitles in that language.",
      },
      app_settings_mpv_smart: { ru: "Умный выбор субтитров", en: "Smart subtitle choice" },
      app_settings_mpv_smart_descr: {
        ru: "Для нового сериала или фильма: если звук на другом языке, включить субтитры выбранного языка (полные, иначе форсированные); если звук на этом языке, выключить. Явный выбор в сериале важнее.",
        en: "For a new series or film: if the audio is in another language, turn on subtitles in the chosen language (full, else forced); if the audio is in that language, turn them off. A choice you made in a series wins.",
      },
      app_settings_mpv_smart_off: { ru: "Выключен", en: "Off" },
      app_settings_mpv_smart_ru: { ru: "Для русского", en: "For Russian" },
      app_settings_mpv_smart_en: { ru: "Для English", en: "For English" },
      app_settings_mpv_audio_order: { ru: "Порядок озвучек", en: "Audio preference order" },
      app_settings_mpv_audio_order_descr: {
        ru: "Для нового сериала или фильма: языки и студии через запятую, например «ru/LostFilm, ru, en». Побеждает первая подошедшая запись.",
        en: "For a new series or film: languages and studios, comma separated, for example “ru/LostFilm, ru, en”. The first matching entry wins.",
      },
      app_settings_mpv_sub_order: { ru: "Порядок субтитров", en: "Subtitle preference order" },
      app_settings_mpv_sub_order_descr: {
        ru: "То же для субтитров, например «ru, en». Если заполнено, заменяет умный выбор.",
        en: "The same for subtitles, for example “ru, en”. When filled, it replaces the smart choice.",
      },
      app_settings_mpv_subs_manual: { ru: "По запросу", en: "On request" },
      app_settings_mpv_subs_auto_ru: { ru: "Авто: русские", en: "Auto: Russian" },
      app_settings_mpv_subs_auto_en: { ru: "Авто: English", en: "Auto: English" },
      app_settings_mpv_skipped_intro: { ru: "Заставка пропущена", en: "Intro skipped" },
      app_settings_mpv_skipped_recap: { ru: "Пересказ пропущен", en: "Recap skipped" },
      app_settings_mpv_skip_off: { ru: "Выключено", en: "Off" },
      app_settings_mpv_still: { ru: "Вопрос «Вы ещё смотрите?»", en: "“Are you still watching?”" },
      app_settings_mpv_still_descr: {
        ru: "Если три серии подряд сменились сами, без единого нажатия, следующая ставится на паузу, чтобы не играть всю ночь. Выключено по умолчанию.",
        en: "If three episodes in a row start on their own with no input, the next one is paused so it does not play all night. Off by default.",
      },
      app_settings_mpv_still_on: { ru: "Включено", en: "On" },
      app_settings_mpv_local: { ru: "Открыть видео с устройства…", en: "Open a video from this device…" },
      app_settings_mpv_local_descr: {
        ru: "Выбор видео или звука из памяти устройства; несколько файлов становятся плейлистом. Играет встроенный mpv со всеми функциями плеера (дорожки, субтитры, главы). Файлы также открываются через «Открыть с помощью» в файловом менеджере.",
        en: "Pick a video or audio file from the device storage; several files become a playlist. The built-in mpv plays it with all player features (tracks, subtitles, chapters). Files also open through “Open with” in a file manager.",
      },
      app_settings_mpv_refresh: { ru: "Частота экрана под видео", en: "Match screen refresh rate" },
      app_settings_mpv_refresh_descr: {
        ru: "Переключает режим экрана на частоту кадров видео (24 к/с на 24 или 48 Гц), чтобы не было дрожания. Только в полноэкранном режиме; режим возвращается при остановке видео. Работает, если экран или ТВ предлагает такой режим. Выключено по умолчанию.",
        en: "Switches the display mode to the video frame rate (24 fps to 24 or 48 Hz) to avoid judder. Full screen only; the mode is restored when the video stops. Works if the display or TV offers such a mode. Off by default.",
      },
      app_settings_mpv_skip_button: { ru: "Кнопка", en: "Button" },
      app_settings_mpv_skip_auto: { ru: "Автоматически", en: "Automatic" },
      app_settings_mpv_seek: { ru: "Шаг перемотки", en: "Seek step" },
      app_settings_mpv_seek_descr: {
        ru: "На сколько секунд перематывают кнопки «−/+» на панели плеера и стрелки влево/вправо. Стрелки вверх/вниз меняют громкость; Shift+вверх/вниз открывает панель плеера.",
        en: "How many seconds the −/+ panel buttons and the left/right arrows seek. Up/down arrows change the volume; Shift+up/down opens the player panel.",
      },
      app_settings_mpv_keys: {
        ru: "Клавиши плеера: [ ] скорость (\\ — сбросить), , . задержка звука, Z X задержка субтитров, S скриншот в «Изображения/Lampyris», I статистика, P профиль.",
        en: "Player keys: [ ] speed (\\ resets), , . audio delay, Z X subtitle delay, S screenshot to Pictures/Lampyris, I statistics, P profile.",
      },
      app_settings_mpv_second: { ru: "с", en: "s" },
      app_settings_mpv_volume: { ru: "Громкость", en: "Volume" },
      app_settings_mpv_buffer: { ru: "Размер буфера mpv", en: "mpv buffer size" },
      app_settings_mpv_buffer_descr: {
        ru: "Сколько видео mpv заранее держит в памяти. «Авто» — заполнять буфер до лимита 512 МиБ. Действует со следующего видео.",
        en: "How much video mpv keeps buffered in memory. Auto fills the buffer up to the 512 MiB limit. Applies from the next video.",
      },
      app_settings_mpv_buffer_auto: { ru: "Авто", en: "Auto" },
      app_settings_mpv_profile: { ru: "Профиль mpv", en: "mpv profile" },
      app_settings_mpv_profile_descr: {
        ru: "Набор опций из раздела [имя] в mpv.conf. Во время видео — кнопка на панели плеера или клавиша P, профиль применяется сразу.",
        en: "Options from a [name] section of mpv.conf. During playback: the player panel button or the P key, applied immediately.",
      },
      app_settings_mpv_minute: { ru: "мин", en: "min" },
      app_settings_mpv_profile_none: { ru: "Без профиля", en: "No profile" },
      app_settings_mpv_profile_empty: {
        ru: "В mpv.conf нет профилей. Добавьте раздел [имя] и опции под ним.",
        en: "No profiles in mpv.conf. Add a [name] section with options below it.",
      },
      app_settings_mpv_config: { ru: "Конфигурация mpv (mpv.conf)", en: "mpv configuration (mpv.conf)" },
      app_settings_mpv_config_descr: {
        ru: "Вставьте содержимое mpv.conf. Опции до первого [раздела] общие, разделы [имя] — профили. Файл важнее настроек приложения, действует со следующего видео.",
        en: "Paste the contents of mpv.conf. Options before the first [section] are global, [name] sections are profiles. The file overrides the app's settings and applies from the next video.",
      },
      app_settings_mpv_config_hint: {
        ru: "Формат mpv.conf: опция=значение, по одной в строке; # начинает комментарий. Опции запуска кода и выбора вывода игнорируются. Файл:",
        en: "mpv.conf format: option=value, one per line; # starts a comment. Options that run code or pick the output are ignored. File:",
      },
      app_settings_mpv_config_save: { ru: "Сохранить", en: "Save" },
      app_settings_mpv_config_cancel: { ru: "Отмена", en: "Cancel" },
      app_settings_mpv_config_clear: { ru: "Очистить", en: "Clear" },
      app_settings_mpv_config_saved: { ru: "Конфигурация mpv сохранена", en: "mpv configuration saved" },
      app_settings_mpv_config_error: { ru: "Не удалось сохранить", en: "Could not save" },
      app_settings_mpv_config_ignored: {
        ru: "Эти строки будут пропущены. Нажмите «Сохранить» ещё раз, чтобы закрыть окно:",
        en: "These lines will be skipped. Press Save again to close:",
      },
    });
    L.SettingsApi.addComponent({
      component: COMPONENT,
      name: L.Lang.translate("app_settings_mpv"),
      icon: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M8 5v14l11-7L8 5zM5 20h14v2H5z"/></svg>',
    });
    // Новые разделы добавляются в конец списка; переносим этот под «Плеер».
    L.Settings.listener.follow("open", (event) => {
      if (event.name !== "main") return;
      const mine = event.body.find(`[data-component="${COMPONENT}"]`);
      const player = event.body.find('[data-component="player"]');
      if (mine.length && player.length) player.after(mine);
    });
    L.SettingsApi.addParam({
      component: COMPONENT,
      param: { name: ONLINE_SETTING, type: "trigger", default: true },
      field: {
        name: L.Lang.translate("app_settings_mpv_online"),
        description: L.Lang.translate("app_settings_mpv_online_descr"),
      },
    });
    const minutes = (n) => n + " " + L.Lang.translate("app_settings_mpv_minute");
    L.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        name: BUFFER_SETTING,
        type: "select",
        values: { 0: L.Lang.translate("app_settings_mpv_buffer_auto"), 60: minutes(1), 120: minutes(2), 180: minutes(3), 240: minutes(4), 300: minutes(5) },
        default: "0",
      },
      field: {
        name: L.Lang.translate("app_settings_mpv_buffer"),
        description: L.Lang.translate("app_settings_mpv_buffer_descr"),
      },
    });
    L.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        name: SKIP_SETTING,
        type: "select",
        values: { off: L.Lang.translate("app_settings_mpv_skip_off"), button: L.Lang.translate("app_settings_mpv_skip_button"), auto: L.Lang.translate("app_settings_mpv_skip_auto") },
        default: "button",
      },
      field: {
        name: L.Lang.translate("app_settings_mpv_skip"),
        description: L.Lang.translate("app_settings_mpv_skip_descr"),
      },
    });
    L.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        name: STILL_SETTING,
        type: "select",
        values: { off: L.Lang.translate("app_settings_mpv_skip_off"), on: L.Lang.translate("app_settings_mpv_still_on") },
        default: "off",
      },
      field: {
        name: L.Lang.translate("app_settings_mpv_still"),
        description: L.Lang.translate("app_settings_mpv_still_descr"),
      },
    });
    L.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        name: REFRESH_SETTING,
        type: "select",
        values: { off: L.Lang.translate("app_settings_mpv_skip_off"), on: L.Lang.translate("app_settings_mpv_still_on") },
        default: "off",
      },
      field: {
        name: L.Lang.translate("app_settings_mpv_refresh"),
        description: L.Lang.translate("app_settings_mpv_refresh_descr"),
      },
    });
    // На Android нет меню приложения: файл с устройства выбирается кнопкой в настройках (на macOS и Windows — «Файл → Открыть видео»).
    if (ANDROID) {
      L.SettingsApi.addParam({
        component: COMPONENT,
        param: { name: LOCAL_BUTTON, type: "button" },
        field: {
          name: L.Lang.translate("app_settings_mpv_local"),
          description: L.Lang.translate("app_settings_mpv_local_descr"),
        },
        onChange: () => { api.pickLocal().catch((e) => showToast(String((e && e.message) || e))); },
      });
    }
    L.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        name: SUBS_SETTING,
        type: "select",
        values: { manual: L.Lang.translate("app_settings_mpv_subs_manual"), auto_ru: L.Lang.translate("app_settings_mpv_subs_auto_ru"), auto_en: L.Lang.translate("app_settings_mpv_subs_auto_en") },
        default: "manual",
      },
      field: {
        name: L.Lang.translate("app_settings_mpv_subs"),
        description: L.Lang.translate("app_settings_mpv_subs_descr"),
      },
    });
    L.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        name: SMART_SUBS_SETTING,
        type: "select",
        values: { off: L.Lang.translate("app_settings_mpv_smart_off"), ru: L.Lang.translate("app_settings_mpv_smart_ru"), en: L.Lang.translate("app_settings_mpv_smart_en") },
        default: "off",
      },
      field: {
        name: L.Lang.translate("app_settings_mpv_smart"),
        description: L.Lang.translate("app_settings_mpv_smart_descr"),
      },
    });
    [[AUDIO_ORDER, "audio_order", "ru/LostFilm, ru, en"], [SUB_ORDER, "sub_order", "ru, en"]].forEach(([name, key, placeholder]) => {
      L.SettingsApi.addParam({
        component: COMPONENT,
        param: { name, type: "input", values: "", placeholder, default: "" },
        field: {
          name: L.Lang.translate("app_settings_mpv_" + key),
          description: L.Lang.translate("app_settings_mpv_" + key + "_descr"),
        },
      });
    });
    {
      const lang = String(L.Storage.get("language", "ru")) === "ru" ? "ru" : "en";
      SUB_CHOICES.forEach((c) => {
        const values = Object.fromEntries(c.values.map((v, i) => [v, c[lang][i]]));
        L.SettingsApi.addParam({
          component: COMPONENT,
          param: { name: c.name, type: "select", values, default: c.def },
          field: { name: L.Lang.translate(c.title), description: L.Lang.translate("app_settings_mpv_substyle_descr") },
        });
      });
    }
    const seconds = (n) => n + " " + L.Lang.translate("app_settings_mpv_second");
    L.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        name: SEEK_SETTING,
        type: "select",
        values: { 1: seconds(1), 2: seconds(2), 3: seconds(3), 5: seconds(5), 10: seconds(10), 15: seconds(15), 30: seconds(30), 60: seconds(60) },
        default: "1",
      },
      field: {
        name: L.Lang.translate("app_settings_mpv_seek"),
        description: L.Lang.translate("app_settings_mpv_seek_descr") + " " + L.Lang.translate("app_settings_mpv_keys"),
      },
    });
    L.SettingsApi.addParam({
      component: COMPONENT,
      param: { name: PROFILE_SETTING, type: "button" },
      field: {
        name: L.Lang.translate("app_settings_mpv_profile"),
        description: L.Lang.translate("app_settings_mpv_profile_descr"),
      },
      onChange: () => void chooseProfile(L, false),
    });
    L.SettingsApi.addParam({
      component: COMPONENT,
      param: { name: CONFIG_BUTTON, type: "button" },
      field: {
        name: L.Lang.translate("app_settings_mpv_config"),
        description: L.Lang.translate("app_settings_mpv_config_descr"),
      },
      onChange: () => void openConfigEditor(L),
    });
  }

  // Буфер в памяти: «Авто» — только лимит по байтам, иначе ещё и глубина в секундах.
  function bufferOptions() {
    const L = window.Lampa;
    const secs = parseInt(L && L.Storage ? L.Storage.get(BUFFER_SETTING, "0") : "0", 10) || 0;
    const opts = { sid: "no", "demuxer-max-bytes": BUFFER_MAX_BYTES };
    if (secs > 0) opts["demuxer-readahead-secs"] = secs;
    return opts;
  }

  // Профиль из раздела [имя] mpv.conf; пустая строка — без профиля.
  function currentProfile(L) {
    return String(L.Storage.get(PROFILE_SETTING, "") || "");
  }

  const GLASS = "background:rgba(40,40,46,.62);-webkit-backdrop-filter:blur(30px) saturate(180%);backdrop-filter:blur(30px) saturate(180%);";

  function addUiStyle() {
    if (document.getElementById("mpv-ui-style")) return;
    const style = document.createElement("style");
    style.id = "mpv-ui-style";
    style.textContent = `
      .mpv-pick { position:fixed; inset:0; z-index:120; display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,.15); color:#fff; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
      .mpv-pick__box { min-width:20em; max-width:90%; max-height:80%; display:flex; flex-direction:column; gap:.9em;
        padding:1.6em 1.8em; border-radius:1.6em; background:rgba(40,40,46,.3);
        -webkit-backdrop-filter:blur(30px) saturate(180%); backdrop-filter:blur(30px) saturate(180%); }
      .mpv-pick__title { font-size:1.5em; font-weight:700; text-align:center; }
      .mpv-pick__hint { font-size:.85em; opacity:.6; text-align:center; }
      .mpv-pick__list { display:flex; flex-direction:column; gap:.6em; overflow:auto; padding:.2em; }
      .mpv-pick__item { display:flex; align-items:center; justify-content:space-between; gap:1.5em; padding:.65em 1.8em;
        border-radius:999px; background:rgba(255,255,255,.07); font-size:1.15em; font-weight:600; cursor:pointer;
        transition:transform .2s, background-color .15s; }
      .mpv-pick__item small { opacity:.6; font-size:.7em; font-weight:500; max-width:26em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .mpv-pick__item.focus small { opacity:.7; }
      .mpv-pick__item.is-current::after { content:"✓"; opacity:.8; }
      .mpv-pick__item.focus { background:#fff; color:#000; transform:scale(1.04); }
      .mpv-toast { position:fixed; left:50%; bottom:9%; z-index:130; transform:translateX(-50%); padding:.65em 1.8em;
        border-radius:999px; ${GLASS} color:#fff; font:600 1.15em -apple-system,BlinkMacSystemFont,sans-serif;
        white-space:nowrap; pointer-events:none; opacity:0; transition:opacity .25s; }
      .mpv-toast.is-shown { opacity:1; }
      .mpv-statpanel { position:fixed; top:19%; left:3%; z-index:125; min-width:22em; padding:1em 1.3em; border-radius:1.2em;
        background:rgba(40,40,46,.3); -webkit-backdrop-filter:blur(30px) saturate(180%); backdrop-filter:blur(30px) saturate(180%);
        color:#fff; font:.95em -apple-system,BlinkMacSystemFont,sans-serif; pointer-events:none; }
      .mpv-statpanel div { display:flex; justify-content:space-between; gap:2em; padding:.15em 0; }
      .mpv-statpanel span { opacity:.6; white-space:nowrap; }
      .mpv-statpanel b { font-weight:600; text-align:right; max-width:34em; overflow:hidden; text-overflow:ellipsis; }
      .mpv-skip { position:fixed; right:3%; bottom:14%; z-index:126; display:flex; align-items:center; gap:.8em; padding:.7em 1.6em;
        border-radius:999px; ${GLASS} color:#fff; font:600 1.15em -apple-system,BlinkMacSystemFont,sans-serif; cursor:pointer;
        opacity:0; transform:translateY(.4em); transition:opacity .25s, transform .25s; }
      .mpv-skip.is-shown { opacity:1; transform:none; }
      .mpv-skip:hover { background:#fff; color:#000; }
      .mpv-skip kbd { padding:.05em .5em; border-radius:.45em; background:rgba(255,255,255,.2); font:600 .85em ui-monospace,Menlo,monospace; }
      .mpv-skip:hover kbd { background:rgba(0,0,0,.12); }
      .mpv-help { width:min(94%, 64em); max-height:92%; padding:1.2em 1.5em; gap:.6em; }
      .mpv-help .mpv-pick__list { display:grid; grid-template-columns:1fr 1fr; gap:.5em 2.2em; }
      .mpv-help__row { display:flex; align-items:flex-start; gap:1em; padding:.2em .2em; }
      .mpv-help__keys { flex:0 0 6.2em; display:flex; gap:.3em; flex-wrap:wrap; padding-top:.1em; }
      .mpv-help__keys kbd { padding:.1em .6em; border-radius:.5em; background:rgba(255,255,255,.16); font:600 .95em ui-monospace,Menlo,monospace; }
      .mpv-help__text { line-height:1.35; }
      .mpv-help__text b { font-size:1.05em; }
      .mpv-help__text div { opacity:.65; font-size:.85em; margin-top:.1em; }
      .mpv-help .mpv-pick__title { font-size:1.3em; }
      .mpv-pic { background:none; align-items:flex-end; padding-bottom:3em; pointer-events:none; }
      .mpv-pic .mpv-pick__box { pointer-events:auto; box-sizing:border-box; width:min(24em,90%); min-width:0; padding:1.2em 1.2em; background:rgba(30,30,36,.62); }
      .mpv-pic__row { display:grid; grid-template-columns:10.4em 1fr 2.9em; align-items:center; gap:.7em; padding:.4em .8em; font-size:.9em;
        border-radius:999px; font-weight:600; cursor:pointer; }
      .mpv-pic__row.focus { background:rgba(255,255,255,.16); }
      .mpv-pic__track { position:relative; height:.5em; border-radius:999px; background:rgba(255,255,255,.25); touch-action:none; }
      .mpv-pic__fill { position:absolute; top:0; bottom:0; border-radius:999px; background:#fff; }
      .mpv-pic__zero { position:absolute; left:50%; top:-.25em; bottom:-.25em; width:2px; background:rgba(255,255,255,.6); }
      .mpv-pic__knob { position:absolute; top:50%; width:1.1em; height:1.1em; margin:-.55em 0 0 -.55em; border-radius:50%;
        background:#fff; box-shadow:0 0 6px rgba(0,0,0,.5); }
      .mpv-pic__val { text-align:right; font-variant-numeric:tabular-nums; }
      /* Строки с текстовым значением (пресет, речь, ночной режим): значение целиком, без переноса и обрезки. */
      .mpv-pic__row--text { grid-template-columns:10.4em 1fr auto; }
      .mpv-pic__row--text .mpv-pic__val { white-space:nowrap; }
      .mpv-pic__row > span:first-child { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
      .mpv-pic__row > div { min-width:0; }
      .mpv-pic__switch { position:relative; width:2.6em; height:1.3em; border-radius:999px; background:rgba(255,255,255,.25); transition:background-color .15s; }
      .mpv-pic__switch.on { background:#fff; }
      .mpv-pic__dot { position:absolute; top:.15em; left:.15em; width:1em; height:1em; border-radius:50%; background:#fff;
        box-shadow:0 0 4px rgba(0,0,0,.5); transition:left .15s, background-color .15s; }
      .mpv-pic__switch.on .mpv-pic__dot { left:1.45em; background:#000; }
      .mpv-pic .mpv-pick__hint { font-size:.75em; }
      .mpv-chapters { position:absolute; inset:0; pointer-events:none; }
      .mpv-chapter-mark { position:absolute; top:0; bottom:0; width:2px; margin-left:-1px; background:rgba(255,255,255,.75); }
      .mpv-subst { align-items:flex-start; padding-top:3em; }
      .mpv-subst .mpv-pic__row { grid-template-columns:1fr auto; }
      .mpv-subpreview { position:fixed; left:50%; transform:translateX(-50%); z-index:124; padding:.1em .5em; text-align:center;
        white-space:nowrap; font-weight:700; pointer-events:none; }`;
    document.head.appendChild(style);
  }

  // Уведомление внизу экрана в виде капсулы, как кнопки «Продолжить / Сначала».
  let toastTimer = null;
  function showToast(text, ms = 2200) {
    addUiStyle();
    let el = document.querySelector(".mpv-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "mpv-toast";
      document.body.appendChild(el);
    }
    el.textContent = text;
    requestAnimationFrame(() => el.classList.add("is-shown"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("is-shown");
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  // Кнопка «Пропустить…» (заставка, пересказ, титры, анонс) внизу справа.
  let skipHideTimer = null;
  function showSkipButton(text, onClick) {
    addUiStyle();
    let el = document.querySelector(".mpv-skip");
    if (!el) {
      el = document.createElement("div");
      el.className = "mpv-skip";
      document.body.appendChild(el);
    }
    el.textContent = "";
    const label = document.createElement("span");
    label.textContent = text;
    const key = document.createElement("kbd");
    key.textContent = "N";
    el.appendChild(label);
    el.appendChild(key);
    el.onclick = onClick;
    requestAnimationFrame(() => el.classList.add("is-shown"));
    clearTimeout(skipHideTimer);
    skipHideTimer = setTimeout(hideSkipButton, 12000);
  }

  function hideSkipButton() {
    clearTimeout(skipHideTimer);
    const el = document.querySelector(".mpv-skip");
    if (!el) return;
    el.classList.remove("is-shown");
    setTimeout(() => { if (!el.classList.contains("is-shown")) el.remove(); }, 300);
  }


  // Общее окно выбора из списка: rows = [{ title, sub?, value }]; промис с выбранным value или null.
  // Стрелки и Enter, Esc/Backspace закрывают; keyup закрывающей клавиши гасится, чтобы Lampa не поставила паузу.
  function pickList(L, title, rows, selectedIndex) {
    return new Promise((resolve) => {
      if (document.querySelector(".mpv-pick")) return resolve(null);
      addUiStyle();
      const overlay = document.createElement("div");
      overlay.className = "mpv-pick";
      overlay.innerHTML = '<div class="mpv-pick__box"><div class="mpv-pick__title"></div><div class="mpv-pick__list"></div><div class="mpv-pick__hint"></div></div>';
      overlay.querySelector(".mpv-pick__title").textContent = title;
      overlay.querySelector(".mpv-pick__hint").textContent = "↑ ↓ · Enter · Esc";
      const list = overlay.querySelector(".mpv-pick__list");
      const items = rows.map((r) => {
        const row = document.createElement("div");
        row.className = "mpv-pick__item";
        const name = document.createElement("span");
        name.textContent = r.title;
        row.appendChild(name);
        if (r.sub) {
          const sub = document.createElement("small");
          sub.textContent = r.sub;
          row.appendChild(sub);
        }
        list.appendChild(row);
        return row;
      });
      let index = Math.max(0, Math.min(items.length - 1, selectedIndex || 0));
      const focus = (i) => {
        index = (i + items.length) % items.length;
        items.forEach((r, k) => r.classList.toggle("focus", k === index));
        items[index].scrollIntoView({ block: "nearest" });
      };
      let swallowDone = null;
      function swallow(e) { e.preventDefault(); e.stopImmediatePropagation(); if (swallowDone) swallowDone(e); }
      const close = (value) => {
        window.removeEventListener("keydown", onKey, true);
        overlay.remove();
        const timer = setTimeout(release, 1000);
        function release() { clearTimeout(timer); window.removeEventListener("keyup", swallow, true); window.removeEventListener("keypress", swallow, true); }
        swallowDone = (e) => { if (e.type === "keyup") setTimeout(release, 0); };
        resolve(value);
      };
      function onKey(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat && !/^Arrow/.test(e.key)) return;
        if (e.key === "ArrowUp") focus(index - 1);
        else if (e.key === "ArrowDown") focus(index + 1);
        else if (e.key === "Enter") close(rows[index].value);
        else if (/^(Escape|Backspace|BrowserBack)$/.test(e.key)) close(null);
      }
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("keyup", swallow, true);
      window.addEventListener("keypress", swallow, true);
      items.forEach((r, k) => {
        r.addEventListener("mouseenter", () => focus(k));
        r.addEventListener("click", () => close(rows[k].value));
      });
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
      document.body.appendChild(overlay);
      focus(index);
    });
  }

  // Окно выбора профиля. Выбор сохраняется (действует и на следующие видео); если видео играет,
  // профиль применяется сразу, без перезапуска плеера. Стрелки и Enter, Esc/Backspace/P закрывают.
  // Краткие описания встроенных профилей для окна выбора (список профилей — MpvProfiles.swift / mpv_profiles.rs).
  const BUILTIN_PROFILE_DESCR = {
    balanced: ["Фильмы и сериалы: чёткость, лёгкая подчистка полос", "Movies and series: sharp, light deband"],
    quality: ["Максимум качества, тяжёлый: для мощного железа", "Maximum quality, heavy: for powerful hardware"],
    fast: ["Лёгкий: 4K, слабое железо, виртуальная машина", "Light: 4K, weak hardware, virtual machine"],
    "hdr-sdr": ["HDR-видео на обычном мониторе", "HDR video on a regular display"],
    smooth: ["Плавное движение 24→60 Гц, нагружает GPU", "Smooth 24→60 Hz motion, loads the GPU"],
    anime: ["Аниме: подчистка полос без зерна", "Anime: deband without grain"],
    night: ["Ночь: сжатие динамики и выравнивание громкости", "Night: compression and loudness normalization"],
  };

  async function chooseProfile(L, live) {
    if (document.querySelector(".mpv-pick")) return;
    const info = await api.getConfig().catch(() => null);
    const names = (info && info.profiles) || [];
    if (!names.length) return showToast(L.Lang.translate("app_settings_mpv_profile_empty"));
    addUiStyle();
    const none = L.Lang.translate("app_settings_mpv_profile_none");
    const saved = names.includes(currentProfile(L)) ? currentProfile(L) : "";
    const options = [{ title: none, value: "" }].concat(names.map((n) => ({ title: n, value: n })));
    const overlay = document.createElement("div");
    overlay.className = "mpv-pick";
    overlay.innerHTML = '<div class="mpv-pick__box"><div class="mpv-pick__title"></div><div class="mpv-pick__list"></div><div class="mpv-pick__hint"></div></div>';
    overlay.querySelector(".mpv-pick__title").textContent = L.Lang.translate("app_settings_mpv_profile");
    overlay.querySelector(".mpv-pick__hint").textContent = "↑ ↓ · Enter · Esc";
    const list = overlay.querySelector(".mpv-pick__list");
    const rows = options.map((o) => {
      const row = document.createElement("div");
      row.className = "mpv-pick__item" + (o.value === saved ? " is-current" : "");
      row.appendChild(document.createTextNode(o.title));
      const descr = BUILTIN_PROFILE_DESCR[o.value];
      if (descr) {
        const small = document.createElement("small");
        small.textContent = ruLang(L) ? descr[0] : descr[1];
        row.appendChild(small);
      }
      list.appendChild(row);
      return row;
    });
    let index = Math.max(0, options.findIndex((o) => o.value === saved));
    const focus = (i) => {
      index = (i + rows.length) % rows.length;
      rows.forEach((r, k) => r.classList.toggle("focus", k === index));
      rows[index].scrollIntoView({ block: "nearest" });
    };
    const close = () => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      // Enter закрывает окно на keydown; его keyup дошёл бы до Lampa как нажатие на кнопку паузы.
      // Поэтому keyup/keypress гасим, пока клавиша не отпущена (но не дольше секунды).
      const timer = setTimeout(release, 1000);
      function release() {
        clearTimeout(timer);
        window.removeEventListener("keyup", swallow, true);
        window.removeEventListener("keypress", swallow, true);
      }
      swallowDone = (event) => { if (event.type === "keyup") setTimeout(release, 0); };
    };
    let swallowDone = null;
    function swallow(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (swallowDone) swallowDone(event);
    }
    const choose = (i) => {
      const item = options[i];
      close();
      L.Storage.set(PROFILE_SETTING, item.value);
      if (live) api.profile(item.value).then(() => { applyPicture(L); applyAudioFx(L); }, () => {});
      showToast(L.Lang.translate("app_settings_mpv_profile") + ": " + item.title);
    };
    function onKey(event) {
      // Пока окно открыто, клавиши не доходят до Lampa.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat && !/^Arrow/.test(event.key)) return;
      if (event.key === "ArrowUp") focus(index - 1);
      else if (event.key === "ArrowDown") focus(index + 1);
      else if (event.key === "Enter") choose(index);
      else if (event.key === "Escape" || event.key === "Backspace" || event.key === "BrowserBack" || event.code === "KeyP") close();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", swallow, true);
    window.addEventListener("keypress", swallow, true);
    rows.forEach((r, k) => {
      r.addEventListener("mouseenter", () => focus(k));
      r.addEventListener("click", () => choose(k));
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    focus(index);
  }

  // Кнопка «Профиль mpv» на панели плеера, пока играет mpv.
  let profileButtonTimer = null;
  let nativeSubsHome = null;
  function startProfileButton(L) {
    stopProfileButton();
    api.getConfig().then((info) => {
      const hasProfiles = Boolean(info && info.profiles && info.profiles.length);
      let tries = 0;
      profileButtonTimer = setInterval(() => {
        const host = document.querySelector(".player-panel__tracks");
        if (document.querySelector(".player-panel__mpvhelp")) return clearInterval(profileButtonTimer);
        if (!host && ++tries < 40) return;
        clearInterval(profileButtonTimer);
        if (!host) return;
        const ru = ruLang(L);
        const help = window.$(
          `<div class="player-panel__mpvhelp button selector"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg><div class="tooltip"></div></div>`
        );
        help.find(".tooltip").text(ru ? "Горячие клавиши (H)" : "Shortcuts (H)");
        bindPlayerButton(help, () => openHelp(L));
        window.$(host).before(help);
        const subs = window.$(
          `<div class="player-panel__mpvsubs button selector"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM5 12h4v2H5v-2zm9 6H5v-2h9v2zm5 0h-3v-2h3v2zm0-4h-8v-2h8v2z"/></svg><div class="tooltip"></div></div>`
        );
        subs.find(".tooltip").text(ru ? "Субтитры из интернета (U)" : "Online subtitles (U)");
        bindPlayerButton(subs, () => active && active.__subsMenu && active.__subsMenu());
        const substyle = window.$(
          `<div class="player-panel__mpvsubstyle button selector"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z"/></svg><div class="tooltip"></div></div>`
        );
        substyle.find(".tooltip").text(ru ? "Вид субтитров (Y)" : "Subtitle style (Y)");
        bindPlayerButton(substyle, () => openSubStyle(L));
        // Всё про субтитры живёт слева от кнопок управления воспроизведением: выбор дорожки, поиск в интернете, вид.
        const left = window.$(".player-panel__left").first();
        if (left.length) {
          const box = window.$('<div class="player-panel__box-buttons player-panel__mpvsubbox"></div>');
          const native = window.$(".player-panel__subs").first();
          if (native.length) { nativeSubsHome = { parent: native.parent(), next: native.next() }; box.append(native); }
          box.append(subs);
          box.append(substyle);
          left.append(box);
        } else {
          window.$(host).before(subs);
          window.$(host).before(substyle);
        }
        const picture = window.$(
          `<div class="player-panel__mpvpicture button selector"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg><div class="tooltip"></div></div>`
        );
        picture.find(".tooltip").text(ru ? "Картинка (V)" : "Picture (V)");
        bindPlayerButton(picture, () => openPicture(L));
        window.$(host).before(picture);
        if (ANDROID) {
          // Без клавиатуры окно статистики открывается кнопкой.
          const info = window.$(
            `<div class="player-panel__mpvinfo button selector"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg><div class="tooltip"></div></div>`
          );
          info.find(".tooltip").text(ru ? "Информация о файле (I)" : "File information (I)");
          bindPlayerButton(info, () => toggleStatsPanel(L));
          window.$(host).before(info);
        }
        if (!hasProfiles) return;
        const btn = window.$(
          `<div class="player-panel__mpvprofile button selector"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg></div>`
        );
        bindPlayerButton(btn, () => chooseProfile(L, true));
        window.$(host).before(btn);
      }, 300);
    }).catch(() => {});
  }

  // Кнопка «картинка в картинке» плеера Lampa рассчитана на элемент video, а играет mpv: переименовываем её в PiP
  // и отдаём нажатие приложению (window.__lampyrisPip задаёт каждая платформа).
  function installPipButton() {
    if (typeof window.__lampyrisPip !== "function") return;
    setInterval(() => {
      const btn = document.querySelector(".player-panel__pip");
      if (!btn) return;
      // Lampa прячет кнопку, если браузер не умеет PiP для video; здесь PiP делает приложение.
      btn.classList.remove("hide");
      if (btn.__lampyrisPip) return;
      btn.__lampyrisPip = true;
      const tip = btn.querySelector(".tooltip");
      if (tip) tip.textContent = "PiP";
      btn.setAttribute("title", "PiP");
      btn.addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); window.__lampyrisPip(); }, true);
      if (window.$) window.$(btn).on("hover:enter", () => window.__lampyrisPip());
    }, 500);
  }

  // Горячая клавиша P (и «з» в русской раскладке): окно выбора профиля, пока играет mpv.
  function installProfileHotkey(L) {
    window.addEventListener("keydown", (event) => {
      if (event.code !== "KeyP" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (!active || !document.documentElement.classList.contains(CLASS)) return;
      const t = event.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector(".mpv-conf, .mpv-pick") || document.body.classList.contains("selectbox--open")) return;
      event.preventDefault();
      event.stopPropagation();
      chooseProfile(L, true);
    }, true);
  }


  // Панель «Картинка» (клавиша C): ползунки gamma, brightness, contrast и saturation для ручной подстройки,
  // например тёмного видео, и «Автокоррекция SDR» (свои gamma и saturation, только для SDR-видео, не HDR).
  // Ручные ползунки — поправки поверх профиля и автокоррекции (итог = профиль + автокоррекция SDR + поправка, от -100 до 100),
  // поэтому автокоррекция всегда видна. Значения запоминаются и ставятся при открытии каждого видео.
  const PICTURE_SETTING = "mpv_picture";
  const AUTOSDR_SETTING = "mpv_autosdr";
  const PICTURE_PROPS = [
    { name: "gamma", ru: "Гамма", en: "Gamma" },
    { name: "brightness", ru: "Яркость", en: "Brightness" },
    { name: "contrast", ru: "Контраст", en: "Contrast" },
    { name: "saturation", ru: "Насыщенность", en: "Saturation" },
  ];
  const AUTOSDR_DEFAULTS = { on: false, gamma: 8, saturation: 4 };
  // Пресеты картинки — готовые ручные поправки поверх профиля (те же ползунки, что и в панели; «Свои» — любое другое сочетание).
  const PICTURE_PRESETS = [
    { id: "none", ru: "Без поправок", en: "None", v: { gamma: 0, brightness: 0, contrast: 0, saturation: 0 } },
    { id: "vivid", ru: "Яркая", en: "Vivid", v: { gamma: 0, brightness: 0, contrast: 8, saturation: 20 } },
    { id: "cinema", ru: "Кино", en: "Cinema", v: { gamma: -4, brightness: -2, contrast: 6, saturation: -6 } },
    { id: "bright", ru: "Светлая", en: "Bright", v: { gamma: 10, brightness: 12, contrast: 0, saturation: 4 } },
    { id: "dark", ru: "Тёмная комната", en: "Dark room", v: { gamma: 8, brightness: -8, contrast: -8, saturation: -8 } },
  ];
  const clampPicture = (v) => Math.max(-100, Math.min(100, Math.round(Number(v)) || 0));

  // Lampa.Storage.get сам разбирает JSON и возвращает уже объект, поэтому принимаем и объект, и строку.
  function readJson(L, key) {
    const v = L.Storage.get(key, "");
    if (v && typeof v === "object") return v;
    try { return JSON.parse(String(v || "{}")) || {}; } catch (e) { return {}; }
  }

  // Сохранённые ручные значения: только то, что пользователь менял (в том числе явный 0).
  function readPicture(L) {
    const raw = readJson(L, PICTURE_SETTING);
    const out = {};
    PICTURE_PROPS.forEach((p) => { if (raw[p.name] !== null && Number.isFinite(Number(raw[p.name]))) out[p.name] = clampPicture(raw[p.name]); });
    return out;
  }

  function readAutoSdr(L) {
    const raw = readJson(L, AUTOSDR_SETTING);
    return {
      on: raw.on === true,
      gamma: raw.gamma === undefined ? AUTOSDR_DEFAULTS.gamma : clampPicture(raw.gamma),
      saturation: raw.saturation === undefined ? AUTOSDR_DEFAULTS.saturation : clampPicture(raw.saturation),
    };
  }

  const isSdr = (params) => Boolean(params && params.gamma && params.gamma !== "pq" && params.gamma !== "hlg");

  // Ставит картинку: значения профиля, плюс автокоррекция (для SDR), плюс ручные поправки.
  // Вызывается при открытии видео, смене параметров видео и профиля, изменении панели.
  // pictureBase — профиль + автокоррекция без ручных поправок: от него ползунки считают итог.
  let pictureRun = 0;
  let pictureDirty = false;
  let pictureBase = null;
  async function applyPicture(L) {
    const run = ++pictureRun;
    const manual = readPicture(L);
    const auto = readAutoSdr(L);
    if (!auto.on && !Object.keys(manual).length && !pictureDirty) { pictureBase = null; return; }
    for (const p of PICTURE_PROPS) await api.set(p.name, 0).catch(() => {});
    await api.profile(currentProfile(L)).catch(() => {});
    if (run !== pictureRun) return;
    const profileValues = {};
    for (const p of PICTURE_PROPS) profileValues[p.name] = clampPicture(await api.get(p.name).catch(() => 0));
    const base = Object.assign({}, profileValues);
    if (auto.on && isSdr(await api.get("video-params").catch(() => null))) {
      base.gamma = clampPicture(base.gamma + auto.gamma);
      base.saturation = clampPicture(base.saturation + auto.saturation);
    }
    if (run !== pictureRun) return;
    pictureBase = base;
    for (const p of PICTURE_PROPS) {
      const target = clampPicture(base[p.name] + (manual[p.name] || 0));
      if (target !== profileValues[p.name]) await api.set(p.name, target).catch(() => {});
    }
    pictureDirty = auto.on || Object.keys(manual).length > 0;
  }

  // Закрывает открытую панель «Картинка» (при остановке видео): окно не должно оставаться на экране.
  let pictureCloser = null;

  async function openPicture(L) {
    if (document.querySelector(".mpv-pick")) return;
    addUiStyle();
    const ru = ruLang(L);
    const touched = readPicture(L);
    const auto = readAutoSdr(L);
    // Ручные ползунки показывают поправку (0 — без изменений), а не итоговое значение.
    const values = {};
    for (const p of PICTURE_PROPS) values[p.name] = touched[p.name] || 0;
    if (!pictureBase) {
      // Ничего ещё не настраивалось: свойства сейчас равны значениям профиля.
      pictureBase = {};
      for (const p of PICTURE_PROPS) pictureBase[p.name] = clampPicture(await api.get(p.name).catch(() => 0));
    }
    if (document.querySelector(".mpv-pick")) return;

    let refreshTimer = null;
    const scheduleApply = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { applyPicture(L); }, 150);
    };
    const saveManual = () => L.Storage.set(PICTURE_SETTING, JSON.stringify(touched));
    const saveAuto = () => L.Storage.set(AUTOSDR_SETTING, JSON.stringify(auto));

    // Какой пресет совпадает с текущими поправками (иначе «Свои», а без изменений — «Без поправок»).
    const presetIndex = () => PICTURE_PRESETS.findIndex((pr) => PICTURE_PROPS.every((p) => pr.v[p.name] === values[p.name]));
    const setPreset = (i) => {
      const pr = PICTURE_PRESETS[(i + PICTURE_PRESETS.length) % PICTURE_PRESETS.length];
      PICTURE_PROPS.forEach((p) => { values[p.name] = pr.v[p.name]; touched[p.name] = pr.v[p.name]; });
      saveManual();
      scheduleApply();
    };
    // Строки панели: пресет, ползунки (value, set), переключатель автокоррекции и сброс.
    const defs = [{
      kind: "preset",
      label: ru ? "Пресет" : "Preset",
      text: () => { const i = presetIndex(); return i < 0 ? (ru ? "Свои" : "Custom") : (ru ? PICTURE_PRESETS[i].ru : PICTURE_PRESETS[i].en); },
      step: (dir) => { const i = presetIndex(); setPreset(i < 0 ? (dir > 0 ? 0 : PICTURE_PRESETS.length - 1) : i + dir); },
    }].concat(PICTURE_PROPS.map((p) => ({
      kind: "slider",
      label: ru ? p.ru : p.en,
      value: () => values[p.name],
      set: (v) => {
        v = clampPicture(v);
        if (values[p.name] === v && p.name in touched) return;
        values[p.name] = v;
        touched[p.name] = v;
        api.set(p.name, clampPicture(((pictureBase && pictureBase[p.name]) || 0) + v)).catch(() => {});
        saveManual();
      },
    })));
    defs.push({
      kind: "toggle",
      label: ru ? "Автокоррекция SDR" : "SDR auto-correction",
      text: () => (auto.on ? (ru ? "вкл" : "on") : (ru ? "выкл" : "off")),
      toggle: () => { auto.on = !auto.on; saveAuto(); scheduleApply(); },
    });
    [["gamma", ru ? "SDR · Гамма" : "SDR · Gamma"], ["saturation", ru ? "SDR · Насыщенность" : "SDR · Saturation"]].forEach(([name, label]) => {
      defs.push({ kind: "slider", label, value: () => auto[name], set: (v) => { auto[name] = clampPicture(v); saveAuto(); if (auto.on) scheduleApply(); } });
    });
    defs.push({ kind: "reset", label: ru ? "Сбросить всё" : "Reset all" });

    const overlay = document.createElement("div");
    overlay.className = "mpv-pick mpv-pic";
    overlay.innerHTML = '<div class="mpv-pick__box"><div class="mpv-pick__title"></div><div class="mpv-pick__list"></div><div class="mpv-pick__hint"></div></div>';
    overlay.querySelector(".mpv-pick__title").textContent = ru ? "Картинка" : "Picture";
    overlay.querySelector(".mpv-pick__hint").textContent = ru
      ? "↑ ↓ выбор · ← → изменить (Shift — точнее; на пресете — сменить) · 0 — в ноль · R — сброс · Esc. Ручные ползунки — поправка поверх профиля и автокоррекции"
      : "↑ ↓ select · ← → change (Shift — finer; on the preset — switch) · 0 — zero · R — reset · Esc. Manual sliders adjust on top of the profile and auto-correction";
    const list = overlay.querySelector(".mpv-pick__list");

    let index = 0;
    const rows = defs.map((def, i) => {
      const row = document.createElement("div");
      row.className = "mpv-pic__row";
      if (def.kind === "preset") row.classList.add("mpv-pic__row--text");
      const label = document.createElement("span");
      label.textContent = def.label;
      const val = document.createElement("span");
      val.className = "mpv-pic__val";
      // Lampa подменяет Element.prototype.append версией с одним аргументом, поэтому только appendChild.
      row.appendChild(label);
      def.val = val;
      if (def.kind === "slider") {
        const track = document.createElement("div");
        track.className = "mpv-pic__track";
        const fill = document.createElement("div");
        fill.className = "mpv-pic__fill";
        const zero = document.createElement("div");
        zero.className = "mpv-pic__zero";
        const knob = document.createElement("div");
        knob.className = "mpv-pic__knob";
        [fill, zero, knob].forEach((n) => track.appendChild(n));
        row.appendChild(track);
        def.fill = fill;
        def.knob = knob;
        const fromPointer = (e) => {
          const r = track.getBoundingClientRect();
          def.set(((e.clientX - r.left) / r.width) * 200 - 100);
          paint(def);
          paint(defs[0]);
        };
        track.addEventListener("pointerdown", (e) => {
          focus(i);
          track.setPointerCapture(e.pointerId);
          fromPointer(e);
          track.onpointermove = fromPointer;
        });
        const release = () => { track.onpointermove = null; };
        track.addEventListener("pointerup", release);
        track.addEventListener("pointercancel", release);
      } else {
        // Переключатель и «Сбросить всё» — в том же шаблоне: подпись, элемент управления, значение.
        const control = document.createElement("div");
        if (def.kind === "toggle") {
          control.className = "mpv-pic__switch";
          const dot = document.createElement("div");
          dot.className = "mpv-pic__dot";
          control.appendChild(dot);
          def.switchEl = control;
        }
        row.appendChild(control);
        row.addEventListener("click", () => { focus(i); if (def.kind === "toggle") { def.toggle(); paint(def); } else if (def.kind === "preset") { def.step(1); paintAll(); } else resetAll(); });
      }
      row.appendChild(val);
      row.addEventListener("click", () => focus(i));
      list.appendChild(row);
      def.row = row;
      return row;
    });

    function focus(i) {
      index = (i + rows.length) % rows.length;
      rows.forEach((r, k) => r.classList.toggle("focus", k === index));
    }
    function paint(def) {
      if (def.kind === "toggle") { def.val.textContent = def.text(); def.switchEl.classList.toggle("on", auto.on); return; }
      if (def.kind === "reset") { def.val.textContent = "R"; return; }
      if (def.kind === "preset") { def.val.textContent = "‹ " + def.text() + " ›"; return; }
      const v = def.value();
      const pct = (v + 100) / 2;
      def.fill.style.left = Math.min(50, pct) + "%";
      def.fill.style.width = Math.abs(pct - 50) + "%";
      def.knob.style.left = pct + "%";
      def.val.textContent = (v > 0 ? "+" : "") + v;
    }
    function paintAll() { defs.forEach(paint); }

    async function resetAll() {
      Object.keys(touched).forEach((k) => delete touched[k]);
      Object.assign(auto, AUTOSDR_DEFAULTS);
      L.Storage.set(PICTURE_SETTING, "");
      L.Storage.set(AUTOSDR_SETTING, "");
      for (const p of PICTURE_PROPS) values[p.name] = 0;
      await applyPicture(L);
      paintAll();
      showToast(ru ? "Картинка сброшена" : "Picture reset");
    }

    const close = () => {
      pictureCloser = null;
      clearTimeout(refreshTimer);
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      // keyup закрывающей клавиши не должен дойти до Lampa (Enter поставил бы паузу).
      const timer = setTimeout(release, 1000);
      function release() { clearTimeout(timer); window.removeEventListener("keyup", swallow, true); window.removeEventListener("keypress", swallow, true); }
      swallowDone = (e) => { if (e.type === "keyup") setTimeout(release, 0); };
    };
    let swallowDone = null;
    function swallow(e) { e.preventDefault(); e.stopImmediatePropagation(); if (swallowDone) swallowDone(e); }
    function onKey(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const def = defs[index];
      const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (e.key === "ArrowUp") focus(index - 1);
      else if (e.key === "ArrowDown") focus(index + 1);
      else if (dir && def.kind === "slider") { def.set(def.value() + dir * (e.shiftKey ? 1 : 5)); paint(def); paint(defs[0]); }
      else if (dir && def.kind === "toggle") { def.toggle(); paint(def); }
      else if (dir && def.kind === "preset") { def.step(dir); paintAll(); }
      else if (e.repeat) return;
      else if (e.key === "0" && def.kind === "slider") { def.set(0); paint(def); }
      else if (e.code === "KeyR" || (e.key === "Enter" && def.kind === "reset")) resetAll();
      else if (e.key === "Enter" && def.kind === "toggle") { def.toggle(); paint(def); }
      else if (e.key === "Enter" && def.kind === "preset") { def.step(1); paintAll(); }
      else if (e.key === "Escape" || e.key === "Backspace" || e.key === "BrowserBack" || e.code === "KeyC" || e.key === "Enter") close();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", swallow, true);
    window.addEventListener("keypress", swallow, true);
    pictureCloser = close;
    document.body.appendChild(overlay);
    paintAll();
    focus(0);
  }

  // ---- Звук (клавиша E): эквалайзер на 10 полос, усиление речи, ночной режим ----
  // Страница присылает только числа, цепочку фильтров собирает приложение (AudioFx в LampyrisCore, audio_fx.rs в Windows).
  // Фильтр стоит под своей меткой и не трогает `af` из mpv.conf и профилей; профиль «night» уже сжимает громкость,
  // поэтому при нём ночной режим из панели не добавляется (иначе двойное сжатие).
  const AUDIOFX_SETTING = "mpv_audiofx";
  const EQ_BANDS = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
  const EQ_PRESETS = [
    { id: "flat", ru: "Выкл", en: "Off", v: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: "film", ru: "Фильм", en: "Film", v: [4, 3, 1, 0, -1, 0, 1, 2, 3, 3] },
    { id: "voice", ru: "Голос", en: "Voice", v: [-4, -3, -2, 0, 2, 4, 4, 2, 0, -2] },
    { id: "bass", ru: "Бас", en: "Bass", v: [8, 7, 5, 3, 1, 0, 0, 0, 0, 0] },
    { id: "treble", ru: "Высокие", en: "Treble", v: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7] },
    { id: "tv", ru: "ТВ (меньше баса)", en: "TV (less bass)", v: [-6, -4, -2, 0, 0, 1, 2, 2, 1, 0] },
  ];
  const clampGain = (v) => Math.max(-12, Math.min(12, Math.round(Number(v)) || 0));

  function readAudioFx(L) {
    const raw = readJson(L, AUDIOFX_SETTING);
    const bands = EQ_BANDS.map((_, i) => clampGain(Array.isArray(raw.bands) ? raw.bands[i] : 0));
    return { bands, dialogue: Math.max(0, Math.min(3, Math.round(Number(raw.dialogue)) || 0)), night: raw.night === true };
  }

  let audioFxApplied = false;
  async function applyAudioFx(L) {
    const fx = readAudioFx(L);
    const empty = !fx.night && !fx.dialogue && fx.bands.every((g) => g === 0);
    if (empty && !audioFxApplied) return;
    audioFxApplied = !empty;
    const night = fx.night && currentProfile(L) !== "night";
    await api.audioFx({ bands: fx.bands, dialogue: fx.dialogue, night }).catch(() => {});
  }

  async function openAudioFx(L) {
    if (document.querySelector(".mpv-pick")) return;
    addUiStyle();
    const ru = ruLang(L);
    const fx = readAudioFx(L);
    let timer = null;
    const save = () => { L.Storage.set(AUDIOFX_SETTING, JSON.stringify(fx)); clearTimeout(timer); timer = setTimeout(() => applyAudioFx(L), 120); };
    const presetIndex = () => EQ_PRESETS.findIndex((pr) => pr.v.every((g, i) => g === fx.bands[i]));
    const defs = [{
      kind: "preset",
      label: ru ? "Эквалайзер" : "Equalizer",
      text: () => { const i = presetIndex(); return i < 0 ? (ru ? "Свой" : "Custom") : (ru ? EQ_PRESETS[i].ru : EQ_PRESETS[i].en); },
      step: (dir) => {
        const i = presetIndex();
        const pr = EQ_PRESETS[i < 0 ? (dir > 0 ? 0 : EQ_PRESETS.length - 1) : (i + dir + EQ_PRESETS.length) % EQ_PRESETS.length];
        fx.bands = pr.v.slice();
        save();
      },
    }].concat(EQ_BANDS.map((name, i) => ({
      kind: "slider",
      label: name + (ru ? " Гц" : " Hz"),
      value: () => fx.bands[i],
      set: (v) => { fx.bands[i] = clampGain(v); save(); },
    })));
    defs.push({
      kind: "preset",
      label: ru ? "Усиление речи" : "Dialogue boost",
      text: () => [ru ? "выкл" : "off", ru ? "слабое" : "low", ru ? "среднее" : "medium", ru ? "сильное" : "high"][fx.dialogue],
      step: (dir) => { fx.dialogue = (fx.dialogue + dir + 4) % 4; save(); },
    });
    defs.push({
      kind: "preset",
      label: ru ? "Ночной режим" : "Night mode",
      text: () => (fx.night ? (ru ? "вкл" : "on") : (ru ? "выкл" : "off")) + (fx.night && currentProfile(L) === "night" ? (ru ? " (уже в профиле)" : " (already in profile)") : ""),
      step: () => { fx.night = !fx.night; save(); },
    });
    defs.push({ kind: "reset", label: ru ? "Сбросить всё" : "Reset all" });

    const overlay = document.createElement("div");
    overlay.className = "mpv-pick mpv-pic";
    overlay.innerHTML = '<div class="mpv-pick__box"><div class="mpv-pick__title"></div><div class="mpv-pick__list"></div><div class="mpv-pick__hint"></div></div>';
    overlay.querySelector(".mpv-pick__title").textContent = ru ? "Звук" : "Audio";
    overlay.querySelector(".mpv-pick__hint").textContent = ru
      ? "↑ ↓ выбор · ← → изменить (Shift — точнее) · 0 — в ноль · R — сброс · Esc. Не действует на звук, который передаётся без декодирования"
      : "↑ ↓ select · ← → change (Shift — finer) · 0 — zero · R — reset · Esc. Has no effect on audio passed through undecoded";
    const list = overlay.querySelector(".mpv-pick__list");

    let index = 0;
    const rows = defs.map((def, i) => {
      const row = document.createElement("div");
      row.className = "mpv-pic__row";
      if (def.kind === "preset") row.classList.add("mpv-pic__row--text");
      const label = document.createElement("span");
      label.textContent = def.label;
      const val = document.createElement("span");
      val.className = "mpv-pic__val";
      row.appendChild(label);
      def.val = val;
      if (def.kind === "slider") {
        const track = document.createElement("div");
        track.className = "mpv-pic__track";
        const fill = document.createElement("div");
        fill.className = "mpv-pic__fill";
        const zero = document.createElement("div");
        zero.className = "mpv-pic__zero";
        const knob = document.createElement("div");
        knob.className = "mpv-pic__knob";
        [fill, zero, knob].forEach((n) => track.appendChild(n));
        row.appendChild(track);
        def.fill = fill;
        def.knob = knob;
        const fromPointer = (e) => {
          const r = track.getBoundingClientRect();
          def.set(((e.clientX - r.left) / r.width) * 24 - 12);
          paintAll();
        };
        track.addEventListener("pointerdown", (e) => { focus(i); track.setPointerCapture(e.pointerId); fromPointer(e); track.onpointermove = fromPointer; });
        const release = () => { track.onpointermove = null; };
        track.addEventListener("pointerup", release);
        track.addEventListener("pointercancel", release);
      } else {
        row.appendChild(document.createElement("div"));
        row.addEventListener("click", () => { focus(i); if (def.kind === "preset") { def.step(1); paintAll(); } else resetAll(); });
      }
      row.appendChild(val);
      row.addEventListener("click", () => focus(i));
      list.appendChild(row);
      def.row = row;
      return row;
    });

    function focus(i) {
      index = (i + rows.length) % rows.length;
      rows.forEach((r, k) => r.classList.toggle("focus", k === index));
    }
    function paint(def) {
      if (def.kind === "reset") { def.val.textContent = "R"; return; }
      if (def.kind === "preset") { def.val.textContent = "‹ " + def.text() + " ›"; return; }
      const v = def.value();
      const pct = ((v + 12) / 24) * 100;
      def.fill.style.left = Math.min(50, pct) + "%";
      def.fill.style.width = Math.abs(pct - 50) + "%";
      def.knob.style.left = pct + "%";
      def.val.textContent = (v > 0 ? "+" : "") + v + (ru ? " дБ" : " dB");
    }
    function paintAll() { defs.forEach(paint); }
    function resetAll() {
      fx.bands = EQ_BANDS.map(() => 0);
      fx.dialogue = 0;
      fx.night = false;
      L.Storage.set(AUDIOFX_SETTING, "");
      applyAudioFx(L);
      paintAll();
      showToast(ru ? "Звук сброшен" : "Audio reset");
    }

    const close = () => {
      pictureCloser = null;
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      // keyup закрывающей клавиши не должен дойти до Lampa (Enter поставил бы паузу).
      const t = setTimeout(release, 1000);
      function release() { clearTimeout(t); window.removeEventListener("keyup", swallow, true); window.removeEventListener("keypress", swallow, true); }
      swallowDone = (e) => { if (e.type === "keyup") setTimeout(release, 0); };
    };
    let swallowDone = null;
    function swallow(e) { e.preventDefault(); e.stopImmediatePropagation(); if (swallowDone) swallowDone(e); }
    function onKey(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const def = defs[index];
      const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (e.key === "ArrowUp") focus(index - 1);
      else if (e.key === "ArrowDown") focus(index + 1);
      else if (dir && def.kind === "slider") { def.set(def.value() + dir * (e.shiftKey ? 1 : 2)); paintAll(); }
      else if (dir && def.kind === "preset") { def.step(dir); paintAll(); }
      else if (e.repeat) return;
      else if (e.key === "0" && def.kind === "slider") { def.set(0); paintAll(); }
      else if (e.code === "KeyR" || (e.key === "Enter" && def.kind === "reset")) resetAll();
      else if (e.key === "Enter" && def.kind === "preset") { def.step(1); paintAll(); }
      else if (e.key === "Escape" || e.key === "Backspace" || e.key === "BrowserBack" || e.code === "KeyE" || e.key === "Enter") close();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", swallow, true);
    window.addEventListener("keypress", swallow, true);
    pictureCloser = close;
    document.body.appendChild(overlay);
    paintAll();
    focus(0);
  }

  // ---- Локальные файлы ----
  // Файлы выбирает приложение (меню «Открыть видео…», перетаскивание в окно, «Открыть с помощью»): оно же запоминает
  // их пути, и мост открывает file:// только из этого списка, поэтому страница или плагин не могут читать другие файлы.
  // Здесь файлы становятся обычным плейлистом Lampa: дальше работают все функции плеера (дорожки, главы, статистика).
  function installLocalFiles(L) {
    window.__lampyrisOpenLocal = (items) => {
      if (!L.Player || !L.Player.play || !Array.isArray(items) || !items.length) return "no-lampa";
      if (!mpvEnabled(L)) return "mpv-off";
      const list = items.map((it) => {
        const item = { title: String(it.title || ""), url: String(it.url || ""), local: true };
        try {
          if (L.Utils && L.Utils.hash && L.Timeline && L.Timeline.view) item.timeline = L.Timeline.view(L.Utils.hash(item.title));
        } catch (e) { /* без запоминания места просмотра */ }
        return item;
      });
      try {
        if (list.length > 1 && L.Player.playlist) L.Player.playlist(list);
        L.Player.play(list[0]);
        return "ok";
      } catch (e) {
        console.log(`[mpv] локальный файл не открылся: ${e}`);
        return "error";
      }
    };
  }

  // ---- Таймер сна (клавиша T) и вопрос «Вы ещё смотрите?» ----
  // Таймер ставит на паузу через выбранное время (один раз, потом выключается); клавиша T листает 15, 30, 45, 60, 90 минут и «выкл».
  const SLEEP_STEPS = [0, 15, 30, 45, 60, 90];
  let sleepIndex = 0;
  let sleepTimeout = null;
  let sleepEndsAt = 0;
  function cycleSleepTimer(L) {
    const ru = ruLang(L);
    sleepIndex = (sleepIndex + 1) % SLEEP_STEPS.length;
    clearTimeout(sleepTimeout);
    sleepTimeout = null;
    const min = SLEEP_STEPS[sleepIndex];
    if (!min) {
      sleepEndsAt = 0;
      return showToast(ru ? "Таймер сна выключен" : "Sleep timer off");
    }
    sleepEndsAt = Date.now() + min * 60000;
    sleepTimeout = setTimeout(() => {
      sleepTimeout = null;
      sleepIndex = 0;
      sleepEndsAt = 0;
      if (!active || !document.documentElement.classList.contains(CLASS)) return;
      if (active.__pauseExternal) active.__pauseExternal();
      showToast(ru ? "Таймер сна: пауза" : "Sleep timer: paused", 6000);
    }, min * 60000);
    showToast((ru ? "Таймер сна: пауза через " : "Sleep timer: pause in ") + min + (ru ? " мин" : " min"));
  }

  // Серии подряд без участия человека: любое нажатие, касание или колесо между открытиями сбрасывает счётчик.
  let autoEpisodes = 0;
  let inputSinceOpen = false;
  function installActivityTracker() {
    const mark = () => { inputSinceOpen = true; };
    ["keydown", "pointerdown", "wheel"].forEach((t) => window.addEventListener(t, mark, true));
  }
  // Вызывается при каждом новом (не повторном) открытии видео; true — пора спросить.
  function stillWatchingDue(L) {
    if (String(L.Storage.get(STILL_SETTING, "off")) !== "on") { autoEpisodes = 0; inputSinceOpen = false; return false; }
    autoEpisodes = inputSinceOpen ? 0 : autoEpisodes + 1;
    inputSinceOpen = false;
    if (autoEpisodes < 3) return false;
    autoEpisodes = 0;
    return true;
  }

  // ---- Окно «Субтитры» (клавиша Y, кнопка на панели): вид и режим онлайн-поиска ----
  // Пишет в те же ключи mpv_sub_* и mpv_online_subs, что и «Настройки → MPV»; изменения видны сразу,
  // а пример субтитра поверх видео показывает, как они будут выглядеть (приблизительно: рисует страница, не mpv).
  function openSubStyle(L) {
    if (document.querySelector(".mpv-pick")) return;
    // Закрывается вместе с видео, как панель «Картинка».
    addUiStyle();
    const ru = ruLang(L);
    const current = (c) => {
      const v = String(L.Storage.get(c.name, c.def) || c.def);
      return Math.max(0, c.values.indexOf(v));
    };
    const onlineValues = ["manual", "auto_ru", "auto_en"];
    const online = () => Math.max(0, onlineValues.indexOf(String(L.Storage.get(SUBS_SETTING, "manual"))));
    const defs = SUB_CHOICES.map((c) => ({
      label: L.Lang.translate(c.title).replace(/^[^:]+:\s*/, "").replace(/^./, (ch) => ch.toUpperCase()),
      count: c.values.length,
      index: () => current(c),
      text: (i) => c[ru ? "ru" : "en"][i],
      set: (i) => {
        L.Storage.set(c.name, c.values[i]);
        applySubStyleValue(c.name, c.values[i]);
      },
      reset: () => { L.Storage.set(c.name, c.def); applySubStyleValue(c.name, c.def); },
    }));
    defs.push({
      label: ru ? "Поиск в интернете" : "Online search",
      count: onlineValues.length,
      index: online,
      text: (i) => L.Lang.translate("app_settings_mpv_subs_" + onlineValues[i]),
      set: (i) => L.Storage.set(SUBS_SETTING, onlineValues[i]),
      reset: () => L.Storage.set(SUBS_SETTING, "manual"),
    });

    const overlay = document.createElement("div");
    overlay.className = "mpv-pick mpv-pic mpv-subst";
    overlay.innerHTML = '<div class="mpv-pick__box"><div class="mpv-pick__title"></div><div class="mpv-pick__list"></div><div class="mpv-pick__hint"></div></div>';
    overlay.querySelector(".mpv-pick__title").textContent = ru ? "Субтитры" : "Subtitles";
    overlay.querySelector(".mpv-pick__hint").textContent = ru
      ? "↑ ↓ выбор · ← → изменить · R — сброс · Esc"
      : "↑ ↓ select · ← → change · R — reset · Esc";
    const list = overlay.querySelector(".mpv-pick__list");
    const preview = document.createElement("div");
    preview.className = "mpv-subpreview";
    preview.textContent = ru ? "Пример субтитра" : "Sample subtitle";

    // Размеры mpv заданы для кадра высотой 720: пересчитываем на высоту окна.
    function paintPreview() {
      const get = (n) => String(L.Storage.get(n, SUB_STYLE[n].def) || SUB_STYLE[n].def);
      const k = window.innerHeight / 720;
      const box = get("mpv_sub_box") === "background-box";
      const border = Number(get("mpv_sub_border")) * k;
      const shadow = Number(get("mpv_sub_shadow")) * k;
      const st = preview.style;
      st.fontSize = 55 * Number(get("mpv_sub_size")) * k + "px";
      st.bottom = (100 - Number(get("mpv_sub_pos"))) / 100 * window.innerHeight + Number(get("mpv_sub_margin")) * k + "px";
      st.color = get("mpv_sub_color");
      st.fontFamily = get("mpv_sub_font") + ", sans-serif";
      st.background = box ? "rgba(0,0,0,.69)" : "none";
      st.webkitTextStroke = box ? "0" : border * 2 + "px #000";
      st.paintOrder = "stroke fill";
      st.textShadow = shadow ? `${shadow}px ${shadow}px 0 rgba(0,0,0,.8)` : "none";
    }

    let index = 0;
    const rows = defs.map((def, i) => {
      const row = document.createElement("div");
      row.className = "mpv-pic__row";
      const label = document.createElement("span");
      label.textContent = def.label;
      const val = document.createElement("span");
      val.className = "mpv-pic__val";
      row.appendChild(label);
      row.appendChild(val);
      row.addEventListener("click", () => { focus(i); change(1); });
      list.appendChild(row);
      def.val = val;
      return row;
    });
    function paint(def) { def.val.textContent = "‹ " + def.text(def.index()) + " ›"; }
    function focus(i) {
      index = (i + rows.length) % rows.length;
      rows.forEach((r, k) => r.classList.toggle("focus", k === index));
    }
    function change(dir) {
      const def = defs[index];
      def.set((def.index() + dir + def.count) % def.count);
      paint(def);
      paintPreview();
    }
    function resetAll() {
      defs.forEach((d) => { d.reset(); paint(d); });
      paintPreview();
      showToast(ru ? "Субтитры сброшены" : "Subtitles reset");
    }

    const close = () => {
      pictureCloser = null;
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      preview.remove();
      // keyup закрывающей клавиши не должен дойти до Lampa (Enter поставил бы паузу).
      const timer = setTimeout(release, 1000);
      function release() { clearTimeout(timer); window.removeEventListener("keyup", swallow, true); window.removeEventListener("keypress", swallow, true); }
      swallowDone = (e) => { if (e.type === "keyup") setTimeout(release, 0); };
    };
    let swallowDone = null;
    function swallow(e) { e.preventDefault(); e.stopImmediatePropagation(); if (swallowDone) swallowDone(e); }
    function onKey(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "ArrowUp") focus(index - 1);
      else if (e.key === "ArrowDown") focus(index + 1);
      else if (e.key === "ArrowRight") change(1);
      else if (e.key === "ArrowLeft") change(-1);
      else if (e.repeat) return;
      else if (e.code === "KeyR") resetAll();
      else if (e.key === "Escape" || e.key === "Backspace" || e.key === "BrowserBack" || e.code === "KeyY" || e.key === "Enter") close();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", swallow, true);
    window.addEventListener("keypress", swallow, true);
    pictureCloser = close;
    document.body.appendChild(preview);
    document.body.appendChild(overlay);
    defs.forEach(paint);
    paintPreview();
    focus(0);
  }

  // Клавиши плеера (пока играет mpv): [ ] — скорость на 0.25 (\ — сброс), , . — задержка звука на 0.1 с,
  // Z X — задержка субтитров, S — скриншот, I — окно статистики, C — панель «Картинка». Работают при видео и при панели плеера.
  let speedTouched = false;
  let delaysTouched = false;
  let statsPanelTimer = null;

  function ruLang(L) { return String(L.Storage.get("language", "ru")) === "ru"; }

  async function changeDelay(L, prop, delta, titleRu, titleEn) {
    const current = Number(await api.get(prop).catch(() => 0)) || 0;
    const next = Math.round((current + delta) * 10) / 10;
    api.set(prop, next);
    delaysTouched = true;
    if (prop === "sub-delay" && active && active.__rememberSubDelay) active.__rememberSubDelay(next);
    showToast((ruLang(L) ? titleRu : titleEn) + ": " + (next > 0 ? "+" : "") + next.toFixed(1) + " " + L.Lang.translate("app_settings_mpv_second"));
  }

  function changeSpeed(L, delta) {
    if (!active) return;
    const next = delta === 0 ? 1 : Math.min(4, Math.max(0.25, Math.round((Number(active.playbackRate) + delta) * 100) / 100));
    active.playbackRate = next;
    speedTouched = next !== 1;
    showToast((ruLang(L) ? "Скорость" : "Speed") + ": " + next + "×");
  }

  async function takeScreenshot(L) {
    const r = await api.screenshot().catch(() => null);
    showToast(r && r.ok ? (ruLang(L) ? "Скриншот: Изображения/Lampyris" : "Screenshot: Pictures/Lampyris") : (ruLang(L) ? "Не удалось снять кадр" : "Screenshot failed"));
  }

  // Статистика TorrServer для окна «I»: тот же запрос, что делает Lampa (&stat; для gst — heartbeat).
  let torrentStat = null;
  let torrentStatBusy = false;
  async function pollTorrentStat(L) {
    const pd = L.Player.playdata && L.Player.playdata();
    if (!pd || !pd.torrent_hash || !pd.url || torrentStatBusy) return;
    let url = String(pd.url).replace("&preload", "&stat").replace("&play", "&stat");
    try {
      if (L.Torserver && L.Torserver.gstWork && L.Torserver.gstWork()) url = L.Torserver.url() + "/gst/" + pd.torrent_hash + "/heartbeat";
    } catch (e) { /* без gst */ }
    torrentStatBusy = true;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const data = await r.json();
      torrentStat = data.Torrent || data;
    } catch (e) { /* TorrServer недоступен: оставляем прошлое значение */ } finally { torrentStatBusy = false; }
  }

  function torrentRows(L, ru) {
    const t = torrentStat;
    if (!t) return [];
    const mbit = (bytesPerSec) => (Number(bytesPerSec) * 8 / 1e6).toFixed(2) + " Mbit/s";
    const size = (b) => (Number(b) > 0 ? (Number(b) / 1073741824 >= 1 ? (Number(b) / 1073741824).toFixed(2) + " GiB" : (Number(b) / 1048576).toFixed(0) + " MiB") : "");
    return [
      [ru ? "Раздача" : "Torrent", [t.title || t.name, size(t.torrent_size)].filter(Boolean).join(" · ")],
      [ru ? "Пиры" : "Peers", (t.active_peers || 0) + " / " + (t.total_peers || 0) + " · " + (t.connected_seeders || 0) + (ru ? " сидов" : " seeds") + (t.pending_peers ? " · " + t.pending_peers + (ru ? " в ожидании" : " pending") : "")],
      [ru ? "Загрузка торрента" : "Torrent download", mbit(t.download_speed || 0) + (t.upload_speed ? " · ↑ " + mbit(t.upload_speed) : "")],
      [ru ? "Прочитано" : "Read", size(t.bytes_read || t.preloaded_bytes)],
    ];
  }

  function closeStatsPanel() {
    clearInterval(statsPanelTimer);
    statsPanelTimer = null;
    torrentStat = null;
    const el = document.querySelector(".mpv-statpanel");
    if (el) el.remove();
  }

  function toggleStatsPanel(L) {
    if (document.querySelector(".mpv-statpanel")) return closeStatsPanel();
    addUiStyle();
    const el = document.createElement("div");
    el.className = "mpv-statpanel";
    el.addEventListener("click", closeStatsPanel);
    if (ANDROID) el.style.pointerEvents = "auto";
    document.body.appendChild(el);
    const names = ["video-codec", "hwdec-current", "video-params", "container-fps", "estimated-vf-fps", "video-bitrate",
      "frame-drop-count", "decoder-frame-drop-count", "vo-delayed-frame-count", "avsync", "audio-codec-name", "audio-params",
      "audio-bitrate", "track-list", "cache-speed", "demuxer-cache-state", "demuxer-cache-time", "time-pos", "speed", "volume", "audio-delay", "sub-delay"];
    const ru = ruLang(L);
    const tick = async () => {
      if (!active || !el.isConnected) return closeStatsPanel();
      pollTorrentStat(L);
      const vals = await Promise.all(names.map((n) => api.get(n).catch(() => null)));
      const v = Object.fromEntries(names.map((n, i) => [n, vals[i]]));
      const num = (x, d = 0) => (Number.isFinite(Number(x)) && x !== null ? Number(x).toFixed(d) : "—");
      const bufferAhead = Number(v["demuxer-cache-time"]) - Number(v["time-pos"]);
      const params = v["video-params"] || {};
      const aparams = v["audio-params"] || {};
      const cache = v["demuxer-cache-state"] || {};
      // Значения из шапки Lampa (имя файла, статистика торрента): шапка в плеере скрыта, читаем её из DOM.
      const text = (sel) => ((document.querySelector(sel) || {}).textContent || "").trim().replace(/\s+/g, " ");
      const rows = [
        [ru ? "Файл" : "File", text(".player-info__values .value--name") || text(".player-info__name")],
        [ru ? "Видео" : "Video", [v["video-codec"], params.w && params.h ? params.w + "×" + params.h : null, fpsLabel(v["container-fps"], v["estimated-vf-fps"]), rangeLabel(params, v["track-list"])].filter(Boolean).join(" · ")],
        [ru ? "Декодер" : "Decoder", v["hwdec-current"] && v["hwdec-current"] !== "no" ? v["hwdec-current"] : (ru ? "программный" : "software")],
        [ru ? "Пропущено кадров" : "Dropped frames", (num(v["decoder-frame-drop-count"]) + " / " + num(v["frame-drop-count"]) + " / " + num(v["vo-delayed-frame-count"])) + (ru ? "  (декодер / вывод / задержано)" : "  (decoder / output / delayed)")],
        [ru ? "Рассинхрон A/V" : "A/V sync", num(v.avsync, 3) + " " + L.Lang.translate("app_settings_mpv_second")],
        [ru ? "Аудио" : "Audio", [[codecLabel(v["track-list"]), channelsLabel(aparams, v["track-list"])].filter(Boolean).join(" "), aparams.samplerate ? Math.round(aparams.samplerate / 1000 * 10) / 10 + " kHz" : null].filter(Boolean).join(" · ")],
        [ru ? "Битрейт" : "Bitrate", (Number(v["video-bitrate"]) > 0 ? num(v["video-bitrate"] / 1e6, 2) : "—") + " + " + (Number(v["audio-bitrate"]) > 0 ? num(v["audio-bitrate"] / 1e6, 2) : "—") + " Mbit/s"],
        [ru ? "Сеть" : "Network", networkLabel(v["cache-speed"], cache["raw-input-rate"], bufferAhead, cache.eof, ru)],
        [ru ? "Буфер вперёд" : "Buffer ahead", Number.isFinite(bufferAhead) ? num(bufferAhead, 1) + " " + L.Lang.translate("app_settings_mpv_second") : "—"],
        ...(torrentStat ? torrentRows(L, ru) : [[ru ? "Торрент" : "Torrent", [text(".player-info__values .value--speed"), text(".player-info__values .value--stat")].filter(Boolean).join(" · ")]]),
        [ru ? "Скорость / громкость" : "Speed / volume", num(v.speed, 2) + "× / " + num(v.volume) + "%"],
        [ru ? "Задержки аудио / субтитров" : "Audio / sub delay", num(v["audio-delay"], 1) + " / " + num(v["sub-delay"], 1) + " " + L.Lang.translate("app_settings_mpv_second")],
      ];
      const shown = rows.filter(([, val]) => val);
      el.innerHTML = shown.map(([k]) => `<div><span>${k}</span><b></b></div>`).join("");
      el.querySelectorAll("b").forEach((b, i) => { b.textContent = shown[i][1]; });
    };
    statsPanelTimer = setInterval(tick, 1000);
    tick();
  }


  // Справка по горячим клавишам плеера.
  function openHelp(L) {
    if (document.querySelector(".mpv-pick")) return;
    addUiStyle();
    const ru = ruLang(L);
    const step = seekStep(L);
    // [клавиши, заголовок, пояснение]
    const rows = ru ? [
      [["←", "→"], "Перемотка", `Назад и вперёд на ${step} с (шаг задаётся в настройках «MPV»). При удержании повторяется. Не работает, пока открыта панель плеера.`],
      [["↑", "↓"], "Громкость", "Громче и тише на 5%. Значение запоминается."],
      [["Shift", "↑ ↓"], "Панель плеера", "Кнопки, шкала времени, дорожки. Обычные ↑ ↓ меняют громкость, поэтому панель открывается с Shift или мышью."],
      [["[", "]"], "Скорость", "Медленнее и быстрее на 0.25× (от 0.25× до 4×). С началом следующего видео возвращается 1×."],
      [["\\"], "Обычная скорость", "Вернуть 1×."],
      [[",", "."], "Задержка звука", "Звук опережает картинку — нажимайте «.», отстаёт — «,». Шаг 0.1 с, значение видно внизу экрана."],
      [["Z", "X"], "Задержка субтитров", "Субтитры раньше речи — нажимайте X, позже речи — Z. Шаг 0.1 с."],
      [["S"], "Скриншот", "Сохраняет текущий кадр в папку «Изображения/Lampyris» (PNG, в размере картинки на экране)."],
      [["I"], "Статистика", "Окно с кодеками, декодером, пропущенными кадрами, сетью, буфером и данными торрента. Повторное нажатие закрывает."],
      [["P"], "Профиль mpv", "Выбор набора опций из mpv.conf. Применяется сразу и запоминается."],
      [["C"], "Картинка", "Пресеты (Яркая, Кино, Светлая, Тёмная комната), ползунки гаммы, яркости, контраста и насыщенности для ручной подстройки (например, тёмного видео) и «Автокоррекция SDR» (свои гамма и насыщенность, только для SDR-видео, не HDR). Значения запоминаются и ставятся при каждом открытии видео; «Сбросить всё» возвращает профиль."],
      [["T"], "Таймер сна", "Пауза через 15, 30, 45, 60 или 90 минут; повторное нажатие выбирает следующее значение, после 90 минут таймер выключается. Срабатывает один раз."],
      [["E"], "Звук", "Эквалайзер на 10 полос (пресеты «Фильм», «Голос», «Бас», «Высокие», «ТВ»), усиление речи и ночной режим (сжатие громкости). Значения запоминаются; профиль «night» уже сжимает громкость, при нём ночной режим из этого окна не добавляется. Не действует на звук без декодирования (passthrough)."],
      [["Y"], "Вид субтитров", "Размер, положение, цвет, фон, обводка, тень, шрифт, отступ снизу и режим поиска в интернете. Пример субтитра показывается поверх видео. Те же значения, что в «Настройки → MPV». Есть и кнопка на панели плеера."],
      [["V"], "Картинка", "То же, что C. Есть и кнопка на панели плеера."],
      [["A"], "Следующая озвучка", "Переключает звуковую дорожку по кругу и показывает её название. Выбор запоминается для сериала."],
      [["J"], "Следующие субтитры", "Переключает субтитры по кругу, после последних они выключаются. Выбор запоминается для сериала."],
      [["PgUp", "PgDn"], "Главы", "Предыдущая и следующая глава файла (метки видны на шкале времени, если глав несколько)."],
      [["U"], "Субтитры из интернета", "Поиск русских или английских субтитров (OpenSubtitles), выбор варианта и включение. Есть и кнопка на панели плеера."],
      [["N"], "Пропустить", "Пропускает заставку, пересказ, титры или анонс, пока внизу справа показана кнопка «Пропустить…» (таймкоды TheIntroDB)."],
      [["H"], "Справка", "Это окно. Закрыть: Esc, Enter или H."],
    ] : [
      [["←", "→"], "Seek", `Back and forward ${step} s (step is set in MPV settings). Repeats while held. Disabled while the player panel is open.`],
      [["↑", "↓"], "Volume", "Louder and quieter by 5%. The value is remembered."],
      [["Shift", "↑ ↓"], "Player panel", "Buttons, timeline, tracks. Plain ↑ ↓ change the volume, so the panel opens with Shift or the mouse."],
      [["[", "]"], "Speed", "Slower and faster by 0.25× (0.25× to 4×). The next video starts at 1×."],
      [["\\"], "Normal speed", "Back to 1×."],
      [[",", "."], "Audio delay", "Sound ahead of the picture: press “.”, sound behind: press “,”. 0.1 s steps, the value shows at the bottom."],
      [["Z", "X"], "Subtitle delay", "Subtitles before the speech: press X, after the speech: press Z. 0.1 s steps."],
      [["S"], "Screenshot", "Saves the current frame to Pictures/Lampyris (PNG, at the on-screen picture size)."],
      [["I"], "Statistics", "Window with codecs, decoder, dropped frames, network, buffer and torrent data. Press again to close."],
      [["P"], "mpv profile", "Pick a set of options from mpv.conf. Applies immediately and is remembered."],
      [["C"], "Picture", "Presets (Vivid, Cinema, Bright, Dark room), sliders for gamma, brightness, contrast and saturation for manual tuning (for example, a dark video), and “SDR auto-correction” (its own gamma and saturation, only for SDR video, not HDR). Values are remembered and set whenever a video opens; “Reset all” brings back the profile."],
      [["T"], "Sleep timer", "Pause after 15, 30, 45, 60 or 90 minutes; each press picks the next value, after 90 minutes the timer turns off. Fires once."],
      [["E"], "Audio", "10-band equalizer (presets Film, Voice, Bass, Treble, TV), dialogue boost and night mode (loudness compression). Values are remembered; the “night” profile already compresses loudness, so the window’s night mode is not added on top of it. No effect on audio passed through undecoded."],
      [["Y"], "Subtitle style", "Size, position, color, background, outline, shadow, font, bottom margin and the online search mode. A sample subtitle is shown over the video. The same values as in Settings → MPV. A panel button does the same."],
      [["V"], "Picture", "Same as C. A panel button does the same."],
      [["A"], "Next audio track", "Cycles the audio track and shows its name. The choice is remembered for the series."],
      [["J"], "Next subtitles", "Cycles the subtitles; after the last one they turn off. The choice is remembered for the series."],
      [["PgUp", "PgDn"], "Chapters", "Previous and next chapter of the file (marks show on the timeline when there are several)."],
      [["U"], "Online subtitles", "Search Russian or English subtitles (OpenSubtitles), pick a variant and turn it on. A panel button does the same."],
      [["N"], "Skip", "Skips the intro, recap, credits or preview while the “Skip…” button is shown at the bottom right (TheIntroDB timestamps)."],
      [["H"], "Help", "This window. Close: Esc, Enter or H."],
    ];
    const overlay = document.createElement("div");
    overlay.className = "mpv-pick";
    overlay.innerHTML = '<div class="mpv-pick__box"><div class="mpv-pick__title"></div><div class="mpv-pick__list"></div></div>';
    overlay.querySelector(".mpv-pick__title").textContent = ru ? "Горячие клавиши" : "Keyboard shortcuts";
    const list = overlay.querySelector(".mpv-pick__list");
    overlay.firstChild.classList.add("mpv-help");
    rows.forEach(([keys, title, text]) => {
      const row = document.createElement("div");
      row.className = "mpv-help__row";
      const k = document.createElement("div");
      k.className = "mpv-help__keys";
      keys.forEach((key) => { const kbd = document.createElement("kbd"); kbd.textContent = key; k.appendChild(kbd); });
      const t = document.createElement("div");
      t.className = "mpv-help__text";
      const name = document.createElement("b");
      name.textContent = title;
      const descr = document.createElement("div");
      descr.textContent = text;
      // Lampa подменяет Element.prototype.append версией с одним аргументом, поэтому только appendChild.
      t.appendChild(name);
      t.appendChild(descr);
      row.appendChild(k);
      row.appendChild(t);
      list.appendChild(row);
    });
    const close = () => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      // keyup закрывающей клавиши (Enter) не должен дойти до Lampa и поставить паузу.
      const timer = setTimeout(release, 1000);
      function release() { clearTimeout(timer); window.removeEventListener("keyup", swallow, true); window.removeEventListener("keypress", swallow, true); }
      swallowDone = (e) => { if (e.type === "keyup") setTimeout(release, 0); };
    };
    let swallowDone = null;
    function swallow(e) { e.preventDefault(); e.stopImmediatePropagation(); if (swallowDone) swallowDone(e); }
    function onKey(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        list.scrollBy({ top: (e.key === "ArrowDown" ? 1 : -1) * 60 });
        return;
      }
      if (e.repeat) return;
      if (/^(Escape|Backspace|Enter|Space|BrowserBack)$/.test(e.key) || e.code === "KeyH" || e.code === "Escape") close();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", swallow, true);
    window.addEventListener("keypress", swallow, true);
    overlay.addEventListener("click", close);
    document.body.appendChild(overlay);
  }

  // Колесо в плеере Lampa превращает в «следующая/предыдущая серия», даже когда открыто меню.
  // Поэтому Lampa колесо не отдаём: в меню Lampa оно листает пункты (как стрелки), в наших окнах — прокручивает список.
  function installPlayerWheel() {
    let last = 0;
    window.addEventListener("wheel", (event) => {
      if (!active || !document.documentElement.classList.contains(CLASS)) return;
      if (event.ctrlKey || event.metaKey) return;
      if (document.querySelector(".mpv-conf, .mpv-pick")) { event.stopImmediatePropagation(); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!document.body.classList.contains("selectbox--open") || !event.deltaY) return;
      const now = Date.now();
      if (now - last < 60) return;
      last = now;
      const key = event.deltaY > 0 ? "ArrowDown" : "ArrowUp";
      const keyCode = event.deltaY > 0 ? 40 : 38;
      const target = document.activeElement || document.body;
      ["keydown", "keyup"].forEach((type) => {
        target.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true }));
      });
    }, { capture: true, passive: false });
  }

  function installPlayerKeys(L) {
    window.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!active || !document.documentElement.classList.contains(CLASS)) return;
      const t = event.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector(".mpv-conf, .mpv-pick") || document.body.classList.contains("selectbox--open")) return;
      // Esc сначала закрывает панель статистики (она не модальная), и только потом Lampa закроет плеер.
      if (event.key === "Escape" && document.querySelector(".mpv-statpanel")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        // Отпускание Esc тоже не должно дойти до Lampa: по нему она закрывает плеер.
        const release = () => { clearTimeout(timer); window.removeEventListener("keyup", swallowUp, true); window.removeEventListener("keypress", swallowUp, true); };
        const swallowUp = (e) => { e.preventDefault(); e.stopImmediatePropagation(); if (e.type === "keyup") release(); };
        const timer = setTimeout(release, 1000);
        window.addEventListener("keyup", swallowUp, true);
        window.addEventListener("keypress", swallowUp, true);
        return closeStatsPanel();
      }
      const code = event.code;
      const handlers = {
        BracketLeft: () => changeSpeed(L, -0.25),
        BracketRight: () => changeSpeed(L, 0.25),
        Backslash: () => changeSpeed(L, 0),
        Comma: () => changeDelay(L, "audio-delay", -0.1, "Задержка звука", "Audio delay"),
        Period: () => changeDelay(L, "audio-delay", 0.1, "Задержка звука", "Audio delay"),
        KeyZ: () => changeDelay(L, "sub-delay", -0.1, "Задержка субтитров", "Subtitle delay"),
        KeyX: () => changeDelay(L, "sub-delay", 0.1, "Задержка субтитров", "Subtitle delay"),
        KeyS: () => !event.repeat && takeScreenshot(L),
        KeyI: () => !event.repeat && toggleStatsPanel(L),
        KeyE: () => !event.repeat && openAudioFx(L),
        KeyT: () => !event.repeat && cycleSleepTimer(L),
        KeyC: () => !event.repeat && openPicture(L),
        KeyV: () => !event.repeat && openPicture(L),
        KeyY: () => !event.repeat && openSubStyle(L),
        KeyH: () => !event.repeat && openHelp(L),
        KeyN: () => !event.repeat && active && active.__skipNow && active.__skipNow(),
        KeyU: () => !event.repeat && active && active.__subsMenu && active.__subsMenu(),
        KeyA: () => !event.repeat && active && active.__cycleTrack && active.__cycleTrack("audio"),
        PageUp: () => active && active.__chapter && active.__chapter(-1),
        PageDown: () => active && active.__chapter && active.__chapter(1),
        KeyJ: () => !event.repeat && active && active.__cycleTrack && active.__cycleTrack("sub"),
      };
      if (!handlers[code] || event.shiftKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handlers[code]();
    }, true);
  }

  function seekStep(L) {
    return parseInt(L.Storage.get(SEEK_SETTING, "1"), 10) || 1;
  }

  // Перемотка на delta секунд от текущей позиции (с учётом ещё не обновлённой позиции при повторах).
  function seekBy(delta) {
    if (!active) return 0;
    const dur = Number(active.duration) || 0;
    const target = (Number(active.currentTime) || 0) + delta;
    active.currentTime = Math.max(0, dur > 0 ? Math.min(target, Math.max(0, dur - 0.5)) : target);
    return active.currentTime;
  }

  // Стрелки на видео без панели: влево/вправо — перемотка на шаг из настроек, вверх/вниз — громкость.
  // Shift+вверх/вниз отдаёт клавишу Lampa (она открывает панель плеера). В панели, меню и на IPTV клавиши родные.
  function installArrowKeys(L) {
    window.addEventListener("keydown", (event) => {
      if (!/^Arrow(Left|Right|Up|Down)$/.test(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!active || !document.documentElement.classList.contains(CLASS)) return;
      if ((window.__lampyrisTV || event.shiftKey) && /^Arrow(Up|Down)$/.test(event.key)) return;
      if (document.querySelector(".mpv-conf, .mpv-pick") || document.body.classList.contains("selectbox--open")) return;
      const controller = L.Controller.enabled && L.Controller.enabled();
      if (!controller || controller.name !== "player") return;
      const playdata = L.Player.playdata && L.Player.playdata();
      if (playdata && playdata.iptv) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const step = seekStep(L) * (event.key === "ArrowRight" ? 1 : -1);
        const to = seekBy(step);
        showToast((step > 0 ? "+" : "−") + Math.abs(step) + " " + L.Lang.translate("app_settings_mpv_second") + " · " + L.Utils.secondsToTime(Math.round(to), true));
      } else {
        const now = Number(active.volume);
        const next = Math.min(1, Math.max(0, Math.round((now + (event.key === "ArrowUp" ? VOLUME_STEP : -VOLUME_STEP)) * 100) / 100));
        if (L.PlayerVideo.volume) L.PlayerVideo.volume(next);
        else active.volume = next;
        L.Storage.set("player_volume", next);
        const range = document.querySelector(".player-panel__volume-range");
        if (range) range.value = next;
        showToast(L.Lang.translate("app_settings_mpv_volume") + ": " + Math.round(next * 100) + "%");
      }
    }, true);
  }

  // Кнопки перемотки по бокам от «пуск/пауза»: в начало, −1 с, +1 с, в конец. Идут через currentTime тюба,
  // чтобы Lampa и mpv видели одну и ту же позицию. Для IPTV (прямой эфир) не нужны.
  let seekButtonsTimer = null;
  const SEEK_ICONS = {
    start: '<path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>',
    back: '<path d="M11 18V6l-8.5 6zm.5-6 8.5 6V6z"/>',
    forward: '<path d="M4 18l8.5-6L4 6zm9-12v12l8.5-6z"/>',
    end: '<path d="M6 18l8.5-6L6 6zM16 6v12h2V6z"/>',
  };

  // Кнопка панели плеера. На Android касание даёт и click, и hover:enter: один обработчик без двойного запуска.
  function bindPlayerButton(button, action) {
    if (!ANDROID) return void button.on("hover:enter", action);
    let last = 0;
    const run = () => { const now = performance.now(); if (now - last < 250) return; last = now; action(); };
    button.on("hover:enter", run);
    button[0].addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); run(); }, true);
  }

  function startSeekButtons(L) {
    stopSeekButtons();
    if (L.Player.playdata && L.Player.playdata() && L.Player.playdata().iptv) return;
    const label = (ru, en) => (String(L.Storage.get("language", "ru")) === "ru" ? ru : en);
    const defs = [
      { key: "start", tip: label("В начало", "To start") },
      { key: "back", tip: "−" + seekStep(L) + " " + label("с", "s"), step: -1 },
      { key: "forward", tip: "+" + seekStep(L) + " " + label("с", "s"), step: 1 },
      { key: "end", tip: label("В конец", "To end") },
    ];
    let tries = 0;
    seekButtonsTimer = setInterval(() => {
      const play = document.querySelector(".player-panel__center .player-panel__playpause");
      if (document.querySelector(".player-panel__seekbtn")) return clearInterval(seekButtonsTimer);
      if (!play && ++tries < 40) return;
      clearInterval(seekButtonsTimer);
      if (!play) return;
      const make = (d) => {
        const b = window.$(
          `<div class="player-panel__seekbtn button selector"><svg viewBox="0 0 24 24" fill="currentColor">${SEEK_ICONS[d.key]}</svg><div class="tooltip"></div></div>`
        );
        b.find(".tooltip").text(d.tip);
        bindPlayerButton(b, () => {
          if (!active) return;
          if (d.step) return void seekBy(d.step * seekStep(L));
          const dur = Number(active.duration) || 0;
          active.currentTime = d.key === "start" ? 0 : Math.max(0, dur - 0.5);
        });
        return b;
      };
      const box = (a, b) => {
        const host = window.$('<div class="player-panel__box-buttons player-panel__seekbtn-box"></div>');
        host[0].appendChild(make(a)[0]);
        host[0].appendChild(make(b)[0]);
        return host;
      };
      const pp = window.$(play);
      pp.before(box(defs[0], defs[1]).css("margin-right", "0.5em"));
      pp.after(box(defs[2], defs[3]).css("margin-left", "0.5em"));
    }, 300);
  }

  function stopSeekButtons() {
    clearInterval(seekButtonsTimer);
    seekButtonsTimer = null;
    document.querySelectorAll(".player-panel__seekbtn-box").forEach((n) => n.remove());
  }

  function stopProfileButton() {
    clearInterval(profileButtonTimer);
    profileButtonTimer = null;
    // Родная кнопка субтитров возвращается на своё место, а наш блок слева убирается.
    const nativeSubs = document.querySelector(".player-panel__mpvsubbox .player-panel__subs");
    if (nativeSubs && nativeSubsHome) {
      if (nativeSubsHome.next && nativeSubsHome.next.length) nativeSubsHome.next.before(nativeSubs);
      else nativeSubsHome.parent.append(nativeSubs);
    }
    nativeSubsHome = null;
    document.querySelectorAll(".player-panel__mpvsubbox").forEach((n) => n.remove());
    document.querySelectorAll(".player-panel__mpvprofile, .player-panel__mpvhelp, .player-panel__mpvsubs, .player-panel__mpvsubstyle, .player-panel__mpvpicture, .player-panel__mpvinfo").forEach((n) => n.remove());
  }

  // Стили окон с полем ввода (редактор mpv.conf и ввод API-ключа).
  function addConfStyle() {
  if (!document.getElementById("mpv-conf-style")) {
    const style = document.createElement("style");
    style.id = "mpv-conf-style";
    style.textContent = `
      .mpv-conf { position: fixed; inset: 0; z-index: 120; display: flex; align-items: center;
        justify-content: center; background: rgba(0, 0, 0, 0.75); color: #fff; }
      .mpv-conf__box { width: min(90%, 52em); max-height: 90%; display: flex; flex-direction: column;
        gap: 0.8em; padding: 1.6em; border-radius: 1em; background: rgba(30, 30, 30, 0.95); }
      .mpv-conf__title { font-size: 1.5em; }
      .mpv-conf__hint, .mpv-conf__msg { font-size: 0.9em; opacity: 0.7; white-space: pre-wrap;
        line-height: 1.4; word-break: break-word; }
      .mpv-conf__msg { min-height: 1.4em; max-height: 8em; overflow: auto; }
      .mpv-conf__text { height: 20em; resize: none; padding: 0.8em; border: 0; border-radius: 0.6em;
        background: rgba(255, 255, 255, 0.1); color: #fff; font: 0.95em/1.4 ui-monospace, Menlo, monospace; }
      .mpv-conf__buttons { display: flex; gap: 0.8em; justify-content: flex-end; }
      .mpv-conf__buttons button { padding: 0.6em 1.4em; border: 0; border-radius: 2em;
        background: rgba(255, 255, 255, 0.15); color: #fff; font-size: 1em; cursor: pointer; }
      .mpv-conf__buttons button:hover, .mpv-conf__buttons button:focus { background: rgba(255, 255, 255, 0.3); outline: 0; }`;
    document.head.appendChild(style);
  }
  }

  // Редактор mpv.conf: обычное окно с textarea, чтобы клавиши Lampa не мешали вводу и вставке.
  async function openConfigEditor(L) {
    const info = await api.getConfig().catch(() => null);
    if (!info || document.querySelector(".mpv-conf")) return;
    addConfStyle();
    const t = (key) => L.Lang.translate(key);
    const overlay = document.createElement("div");
    overlay.className = "mpv-conf";
    overlay.innerHTML = `
      <div class="mpv-conf__box">
        <div class="mpv-conf__title"></div>
        <div class="mpv-conf__hint"></div>
        <textarea class="mpv-conf__text" spellcheck="false" autocapitalize="off" autocomplete="off"
          placeholder="${ANDROID ? "# gamma=3&#10;&#10;[tablet]&#10;scale=bilinear&#10;deband=no" : "# hwdec=videotoolbox&#10;&#10;[hdr]&#10;tone-mapping=bt.2446a"}"></textarea>
        <div class="mpv-conf__msg"></div>
        <div class="mpv-conf__buttons">
          <button data-act="clear"></button><button data-act="cancel"></button><button data-act="save"></button>
        </div>
      </div>`;
    const q = (sel) => overlay.querySelector(sel);
    q(".mpv-conf__title").textContent = t("app_settings_mpv_config");
    q(".mpv-conf__hint").textContent = t("app_settings_mpv_config_hint") + "\n" + info.path;
    q('[data-act="clear"]').textContent = t("app_settings_mpv_config_clear");
    q('[data-act="cancel"]').textContent = t("app_settings_mpv_config_cancel");
    q('[data-act="save"]').textContent = t("app_settings_mpv_config_save");
    const text = q(".mpv-conf__text");
    text.value = info.text;

    const close = () => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      L.Controller.toggle("settings_component");
    };
    // Глобальные обработчики клавиш Lampa гасят действия по умолчанию: не пускаем их к редактору.
    function onKey(event) {
      if (!overlay.contains(event.target)) return;
      event.stopImmediatePropagation();
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey, true);

    let warned = null;
    overlay.addEventListener("click", async (event) => {
      const act = event.target && event.target.dataset && event.target.dataset.act;
      if (event.target === overlay || act === "cancel") return close();
      if (act === "clear") { text.value = ""; text.focus(); }
      if (act !== "save") return;
      const result = await api.setConfig(text.value).catch(() => null);
      if (!result || !result.ok) {
        q(".mpv-conf__msg").textContent = t("app_settings_mpv_config_error") + (result && result.error ? ": " + result.error : "");
        return;
      }
      // Сохранённый профиль, которого больше нет в файле, сбрасываем.
      if (currentProfile(L) && !result.profiles.includes(currentProfile(L))) L.Storage.set(PROFILE_SETTING, "");
      // Файл уже записан; список пропущенных строк показываем один раз, повторное «Сохранить» закрывает окно.
      const key = JSON.stringify(result.ignored);
      if (result.ignored.length && warned !== key) {
        warned = key;
        q(".mpv-conf__msg").textContent = t("app_settings_mpv_config_ignored") + "\n" +
          result.ignored.map((i) => `${i.line}: ${i.text} — ${i.reason}`).join("\n");
        return;
      }
      close();
      showToast(t("app_settings_mpv_config_saved"));
    });
    document.body.appendChild(overlay);
    text.focus();
  }

  // mpv встроен в приложение, поэтому пункт «MPV» (внешний плеер Lampa для macOS) в списках плееров
  // (онлайн, IPTV, торренты) не нужен, а «Встроенный» подписан «Встроенный (MPV)»: через него
  // видео и играет mpv (тюб ниже обслуживает встроенный плеер Lampa, в том числе для IPTV).
  function hideExternalMpv(L) {
    const values = L.Params && L.Params.values;
    if (!L.Params || !L.Params.select || (!values && !ANDROID)) return;
    const inner = L.Lang.translate("settings_param_player_inner") + " (MPV)";
    ["player", "player_iptv", "player_torrent"].forEach((name) => {
      // На Android внешних плееров нет совсем: остаётся один встроенный.
      if (ANDROID) {
        L.Params.select(name, { inner }, "inner");
        if (L.Storage.get(name) !== "inner") L.Storage.set(name, "inner");
        return;
      }
      if (!values[name] || typeof values[name] !== "object") return;
      const rest = Object.assign({}, values[name]);
      delete rest.mpv;
      rest.inner = inner;
      L.Params.select(name, rest, "inner");
      if (L.Storage.get(name) === "mpv") L.Storage.set(name, "inner");
    });
  }

  // Постоянная боковая панель: у значка есть правый отступ под подпись, из-за него кружок фокуса сдвигался влево от значка.
  // Стиль нужен всегда, а не только во время воспроизведения, поэтому добавляется при регистрации.
  function addMenuStyle() {
    if (document.getElementById("mpv-menu-style")) return;
    const style = document.createElement("style");
    style.id = "mpv-menu-style";
    style.textContent =
      `body.menu--always:not(.menu--open):not(.light--version) .menu__list { padding-left: 0; }`+
      `body.menu--always:not(.menu--open):not(.light--version) .menu__item { justify-content: center; width: fit-content; padding-left: .6em; padding-right: .6em; margin-left: auto; margin-right: auto; }`+
      `body.menu--always:not(.menu--open):not(.light--version) .menu__item .menu__ico { margin-right: 0; }`;
    document.head.appendChild(style);
  }

  function addStyle() {
    if (document.getElementById("mpv-builtin-style")) return;
    const style = document.createElement("style");
    style.id = "mpv-builtin-style";
    // Lampa закрывает интерфейс непрозрачным плеером; пока играет mpv, делаем его прозрачным.
    style.textContent =
      `html.${CLASS}, html.${CLASS} body, html.${CLASS} .player,
       html.${CLASS} .player-video, html.${CLASS} .player-video__display { background: transparent !important; }
       html.${CLASS} #app { visibility: hidden !important; }
       html.${CLASS} .wrap__left, html.${CLASS} .menu { visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }
       html.${CLASS} .player-info__values { display: none !important; }
       html.${CLASS} .mpv-epline { font-size: 1.5em; margin-top: 0.25em; opacity: 0.85; text-shadow: 0 0 0.2em rgba(0, 0, 0, 0.5); }
       html.${CLASS} .player-video__overlay { display: none !important; background: none !important; }`;
    document.head.appendChild(style);
  }

  // Видео рисуется под веб-видом. Крупные полноэкранные слои, лежащие не выше плеера
  // (размытый постер плагина, окно выбора раздачи), закрывали бы его, поэтому на время
  // воспроизведения они скрываются, а после восстанавливаются.
  const PLAYER_Z = 50;
  const hidden = new Map();
  const HIDE_PROPS = [["visibility", "hidden"], ["opacity", "0"], ["pointer-events", "none"]];
  let sweepTimer = null;

  function sweep() {
    const player = document.querySelector(".player");
    if (!player) return;
    const inspect = (el) => {
      if (el === player || hidden.has(el)) return;
      if (el.contains(player)) { Array.from(el.children).forEach(inspect); return; }
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return;
      const z = parseInt(st.zIndex, 10);
      if ((Number.isNaN(z) ? 0 : z) > PLAYER_Z) return;
      const r = el.getBoundingClientRect();
      if (r.width < innerWidth * 0.5 || r.height < innerHeight * 0.5) return;
      // Только visibility мало: Lampa сама ставит visibility: visible на свои элементы layer--visible
      // (карточки файлов торрента), и они остаются видны поверх скрытого родителя. opacity скрывает всё поддерево.
      const saved = {};
      HIDE_PROPS.forEach(([name, value]) => {
        saved[name] = { value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) };
        el.style.setProperty(name, value, "important");
      });
      hidden.set(el, saved);
    };
    Array.from(document.body.children).forEach(inspect);
  }

  function startSweep() {
    sweep();
    if (!sweepTimer) sweepTimer = setInterval(sweep, 1000);
  }

  function stopSweep() {
    clearInterval(sweepTimer);
    sweepTimer = null;
    hidden.forEach((saved, el) => {
      HIDE_PROPS.forEach(([name]) => {
        el.style.removeProperty(name);
        if (saved[name].value) el.style.setProperty(name, saved[name].value, saved[name].priority);
      });
    });
    hidden.clear();
  }

  // Динамический диапазон по свойствам исходного видео: gamma pq → HDR10, hlg → HLG, иначе SDR;
  // Dolby Vision определяется по профилю в track-list.
  function rangeLabel(params, tracks) {
    const video = Array.isArray(tracks) ? tracks.find((t) => t.type === "video" && t.selected) : null;
    const dv = video && video["dolby-vision-profile"];
    if (dv) return "Dolby Vision P" + dv;
    const gamma = params && params.gamma;
    if (gamma === "pq") return "HDR10";
    if (gamma === "hlg") return "HLG";
    return params ? "SDR" : "";
  }

  function fpsLabel(containerFps, estimatedFps) {
    const fps = Number(containerFps) > 0 ? Number(containerFps) : Number(estimatedFps);
    if (!(fps > 0)) return "";
    return parseFloat(fps.toFixed(3)) + " fps";
  }

  // Кодек выбранной аудиодорожки: «AC3», «E-AC3», «TrueHD Atmos», «DTS-HD MA», «AAC» и т.д.
  const CODEC_NAMES = { ac3: "AC3", eac3: "E-AC3", truehd: "TrueHD", mlp: "MLP", dts: "DTS", aac: "AAC", mp3: "MP3",
    mp2: "MP2", opus: "Opus", vorbis: "Vorbis", flac: "FLAC", alac: "ALAC", wmav2: "WMA" };
  function codecLabel(tracks) {
    const t = Array.isArray(tracks) ? tracks.find((x) => x.type === "audio" && x.selected) : null;
    if (!t || !t.codec) return "";
    const codec = String(t.codec).toLowerCase();
    const profile = String(t["codec-profile"] || "");
    let name = CODEC_NAMES[codec] || codec.replace(/^pcm_.*/, "PCM").toUpperCase();
    if (codec === "dts" && /DTS/i.test(profile)) name = profile.replace(/^DTS-HD\s+Master Audio$/i, "DTS-HD MA").replace(/^DTS-HD\s+High Resolution.*$/i, "DTS-HD HRA");
    else if (/atmos/i.test(profile) && !/atmos/i.test(name)) name += " Atmos";
    return name;
  }

  // «5.1»: раскладка каналов, «mono»/«stereo» заменяются на 1.0/2.0.
  function channelsLabel(params, tracks) {
    let layout = params && params["hr-channels"] ? String(params["hr-channels"]).replace(/\(.*\)/, "") : "";
    if (!layout) {
      const t = Array.isArray(tracks) ? tracks.find((x) => x.type === "audio" && x.selected) : null;
      const n = t && Number(t["demux-channel-count"]);
      layout = n ? ({ 1: "1.0", 2: "2.0", 6: "5.1", 8: "7.1" }[n] || n + "ch") : "";
    }
    return layout === "mono" ? "1.0" : layout === "stereo" ? "2.0" : layout;
  }

  // «AC3 5.1 • 640 kbps • 48 kHz»: кодек и каналы, битрейт аудиодорожки (mpv отдаёт не сразу), частота.
  function statsAudioLabel(bitrate, params, tracks) {
    const parts = [];
    const head = [codecLabel(tracks), channelsLabel(params, tracks)].filter(Boolean).join(" ");
    if (head) parts.push(head);
    if (Number(bitrate) > 0) parts.push(Math.round(Number(bitrate) / 1000) + " kbps");
    const rate = params && Number(params.samplerate);
    if (rate > 0) parts.push(parseFloat((rate / 1000).toFixed(1)) + " kHz");
    return parts.join(" &nbsp;•&nbsp; ");
  }

  function createShim(L) {
    const el = document.createElement("div");
    el.className = "player-video__video";
    el.style.background = "transparent";
    const listeners = {};
    const state = {
      src: "", time: 0, duration: 0, paused: true, loaded: false, width: 0, height: 0,
      volume: 1, muted: false, rate: 1, error: null, pendingSeek: null,
      metadataSent: false, destroyed: false, lastTimeEvent: 0,
      waiting: false, waitTime: 0, openingStart: 0, seekTarget: null, tracksKnown: false, tracksTimedOut: false,
      audio: [], subs: [], levels: [], chapters: [], pendingSubOff: null, dvWarned: false,
    };
    const playback = (L.Player.playdata && L.Player.playdata()) || {};

    el.addEventListener = (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); };
    el.removeEventListener = (name, fn) => { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); };
    const emit = (type, extra) => {
      const event = Object.assign({ type }, extra);
      (listeners[type] || []).slice().forEach((fn) => {
        try { fn(event); } catch (e) { console.error("mpv shim listener", type, e); }
      });
    };

    const define = (name, get, set) =>
      Object.defineProperty(el, name, { configurable: true, get, set: set || (() => {}) });
    define("src", () => state.src, (v) => (state.src = String(v || "")));
    define("currentSrc", () => state.src);
    define("currentTime", () => state.time, (v) => {
      const t = Math.max(0, Number(v) || 0);
      state.time = t;
      state.seekTarget = t;
      if (!state.loaded) state.pendingSeek = t;
      else api.command(["seek", String(t), "absolute+exact"]);
    });
    define("duration", () => state.duration);
    define("paused", () => state.paused);
    define("videoWidth", () => state.width);
    define("videoHeight", () => state.height);
    define("error", () => state.error);
    define("buffered", () => ({ length: 0 }));
    define("volume", () => state.volume, (v) => {
      state.volume = Math.min(1, Math.max(0, Number(v) || 0));
      if (state.loaded) api.set("volume", Math.round(state.volume * 100));
    });
    define("muted", () => state.muted, (v) => {
      state.muted = Boolean(v);
      if (state.loaded) api.set("mute", state.muted);
    });
    define("playbackRate", () => state.rate, (v) => {
      state.rate = Number(v) || 1;
      api.set("speed", state.rate);
    });
    define("audioTracks", () => state.audio);
    define("textTracks", () => state.subs);
    el.canPlayType = () => "maybe";
    el.speed = (v) => (el.playbackRate = v);

    // Откуда начинать: Lampa сама перематывает по первому timeupdate, но тогда видео сначала
    // стартует с нуля. Повторяем её правила и открываем mpv сразу с нужной позиции.
    function initialPosition() {
      if (state.pendingSeek !== null) return state.pendingSeek;
      const tl = playback.timeline;
      const policy = L.Storage.field("player_timecode");
      if (!tl || policy === "again" || tl.waiting_for_user || tl.stop_recording || tl.continued_bloc ||
          (policy === "ask" && Number(tl.percent) > 0) || Number(tl.percent) >= 90) return 0;
      const duration = Number(tl.duration);
      let position = Number(tl.time);
      if ((!Number.isFinite(position) || position <= 0) && duration > 0) position = (duration * Number(tl.percent)) / 100;
      if (!Number.isFinite(position) || position <= 10) return 0;
      return duration > 15 ? Math.min(position, duration - 15) : position;
    }

    // Пока перемотка не долетела, время не публикуем: иначе Lampa запишет в таймкод 0.
    function publishPosition() {
      if (!state.loaded || !state.metadataSent || state.duration <= 0) return;
      if (state.seekTarget !== null) {
        if (Math.abs(state.time - state.seekTarget) > 2) return;
        state.seekTarget = null;
        if (state.openingStart > 0 && playback.timeline) playback.timeline.continued = true;
      }
      emit("timeupdate");
    }

    // Lampa читает дорожки в момент loadeddata, поэтому ждём track-list от mpv.
    function announceLoaded(firstFrame) {
      if (!state.loaded || state.metadataSent) return;
      if (!state.tracksKnown && !state.tracksTimedOut) return;
      if (!firstFrame && state.duration <= 0) return;
      state.metadataSent = true;
      emit("loadedmetadata");
      emit("durationchange");
      emit("loadeddata");
      emit("canplay");
      sendLevels();
      publishPosition();
    }

    // Lampa рисует список под кнопкой «AUTO» из события levels (так же, как для hls.js).
    function sendLevels() {
      if (!state.levels.length || !L.PlayerVideo.listener) return;
      const current = state.levels.find((l) => l.selected) || state.levels[0];
      L.PlayerVideo.listener.send("levels", { levels: state.levels, current: current.quality });
    }

    // Название языка по коду mpv (rus, eng, ru…) на языке Lampa. Без знания кода возвращаем его как есть.
    const langNamers = {};
    function langName(code) {
      const raw = String(code || "").trim();
      if (!raw || /^(und|unk|mis|zxx)$/i.test(raw)) return "";
      const ui = ruLang(L) ? "ru" : "en";
      try {
        langNamers[ui] = langNamers[ui] || new Intl.DisplayNames([ui], { type: "language" });
        const name = langNamers[ui].of(normLang(raw) || raw.toLowerCase());
        if (name && name.toLowerCase() !== raw.toLowerCase()) return name.charAt(0).toUpperCase() + name.slice(1);
      } catch (e) { /* неизвестный код — покажем как есть */ }
      return raw;
    }

    // HLS-плейлист с вариантами качества mpv показывает как набор «дорожек»: у каждого варианта своя
    // пара видео+аудио (program-id, hls-bitrate). Это не озвучки, а уровни качества; настоящие озвучки
    // и субтитры у плейлиста имеют язык или название.
    function variantPrograms(list) {
      const programs = new Set(
        list.filter((t) => t.type === "video" && t["hls-bitrate"] !== undefined).map((t) => t["program-id"]),
      );
      return programs.size >= 2 ? programs : null;
    }

    function dropQualityVariants(list) {
      const programs = variantPrograms(list);
      if (!programs) return list;
      return list.filter((t) => !(t.type === "audio" && programs.has(t["program-id"]) && !t.lang && !t.title));
    }

    // Подпись уровня как у Lampa для hls.js: 240p…2160p по ширине или высоте кадра.
    function levelTitle(v) {
      const w = v["demux-w"] || 0;
      const h = v["demux-h"] || 0;
      const size = [240, 360, 480, 720, 1080, 1440, 2160].find(
        (q) => Math.abs(w - Math.round(q * 1.777)) < 50 || Math.abs(h - q) < 50,
      );
      if (size) return size + "p";
      return h ? h + "p" : Math.round((v["hls-bitrate"] || 0) / 1000) + " kbps";
    }

    // Уровни качества для кнопки «AUTO» в панели Lampa. mpv сам не переключает качество на лету
    // по сети (берёт лучший вариант), выбор уровня — это выбор пары vid+aid нужного варианта.
    function buildLevels(list) {
      const programs = variantPrograms(list);
      if (!programs) return [];
      return list
        .filter((t) => t.type === "video" && programs.has(t["program-id"]))
        .map((v) => {
          const audio = list.find((a) => a.type === "audio" && a["program-id"] === v["program-id"]);
          const title = levelTitle(v);
          const item = {
            title, quality: title, bitrate: v["hls-bitrate"], width: v["demux-w"], height: v["demux-h"],
            selected: Boolean(v.selected),
          };
          Object.defineProperty(item, "enabled", {
            enumerable: true,
            get: () => item.selected,
            set: (on) => {
              if (!on) return;
              api.set("vid", v.id);
              if (audio) api.set("aid", audio.id);
            },
          });
          return item;
        })
        .sort((a, b) => b.bitrate - a.bitrate);
    }

    // Озвучка и субтитры запоминаются для сериала (id карточки TMDB): на следующей серии выбирается
    // дорожка с тем же языком (и названием); у субтитров ещё и с тем же типом (forced / полные).
    const PREFS_KEY = "mpv_track_prefs";
    const readPrefs = () => {
      try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; }
    };

    // Онлайн-плагины передают в playdata только season/episode, без карточки, поэтому карточку берём
    // из активной страницы Lampa (экран фильма/сериала, поверх которого открыт плеер).
    function activeCard() {
      // Локальный файл не относится к открытой карточке Lampa: ни таймкоды, ни запомненные дорожки к нему не привязываем.
      if (/^file:/i.test(state.src || "")) return null;
      try {
        const a = L.Activity && L.Activity.active && L.Activity.active();
        return (a && (a.card || a.movie)) || null;
      } catch (e) { return null; }
    }

    function seriesKey() {
      // Карточку фиксируем при первом определении: к концу серии активной страницей Lampa может быть уже другая.
      if (state.seriesKey) return state.seriesKey;
      const card = playback.card || activeCard();
      const id = card && card.id;
      const isSeries = (playback.season !== undefined && playback.season !== null && Number.isFinite(Number(playback.season))) ||
        Boolean(card && (card.name || card.original_name || card.first_air_date || card.number_of_seasons));
      if (!id || !isSeries) {
        console.log(`[mpv] prefs: сериал не определён (id=${id}, season=${playback.season}, card keys = ${card ? Object.keys(card).slice(0, 12).join(",") : "-"})`);
        return null;
      }
      return (state.seriesKey = String(id));
    }

    function remember(kind, value, force = false) {
      // После восстановления Lampa сама «включает дорожку по умолчанию» и повторно вызывает переключатели;
      // это не выбор пользователя, поэтому запомненное не перезаписываем.
      if (!force && Date.now() - (state.restoredAt || 0) < 2500) return;
      const key = seriesKey();
      if (!key) return;
      try {
        const prefs = readPrefs();
        const prev = prefs[key] && prefs[key].audio;
        prefs[key] = Object.assign({}, prefs[key], { [kind]: value });
        // Другая озвучка — другой тайминг субтитров: прежнюю задержку не переносим.
        if (kind === "audio" && prev && (prev.studio || prev.title) !== (value.studio || value.title)) delete prefs[key].subDelay;
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        console.log(`[mpv] remembered ${kind}: ${JSON.stringify(value)}`);
      } catch (e) { /* хранилище недоступно: просто не запоминаем */ }
    }

    const rememberAudio = (t) => remember("audio", audioPref(t));
    const rememberSub = (t) => remember("sub", subPref(t));

    // Задержка субтитров (Z/X) запоминается для сериала и ставится на следующих сериях.
    el.__rememberSubDelay = (value) => {
      const key = seriesKey();
      if (!key) return;
      try {
        const prefs = readPrefs();
        prefs[key] = Object.assign({}, prefs[key]);
        if (value) prefs[key].subDelay = value; else delete prefs[key].subDelay;
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch (e) { /* хранилище недоступно */ }
    };

    function savedPref(kind) {
      const key = seriesKey();
      const all = key && readPrefs()[key];
      return all && all[kind];
    }

    // id запомненной дорожки среди текущих, либо undefined (сопоставление — matchAudio/matchSub).
    const savedAudioId = (tracks) => matchAudio(tracks, savedPref("audio"));
    const savedSubId = (tracks) => matchSub(tracks, savedPref("sub"));

    // Элементы повторяют то, что Lampa ждёт от audioTracks/textTracks у <video>.
    // Подпись в плеере: «номер / язык / название / каналы / кодек».
    // Dolby Vision Profile 5 не имеет совместимого базового слоя, а рендерер libmpv (OpenGL) не применяет RPU:
    // картинка получается зелёно-фиолетовой. Предупреждаем один раз на файл.
    function warnDolbyVision(list) {
      if (state.dvWarned || !Array.isArray(list)) return;
      const video = list.find((t) => t.type === "video" && t.selected);
      if (!video || Number(video["dolby-vision-profile"]) !== 5) return;
      state.dvWarned = true;
      console.log("[mpv] Dolby Vision profile 5: цвета будут искажены");
      showToast(ruLang(L) ? "Dolby Vision Profile 5 не поддерживается: цвета будут искажены" : "Dolby Vision Profile 5 is not supported: colors will be wrong", 6000);
    }

    function buildTracks(list) {
      // Сразу после появления дорожек Lampa сама «включает дорожку по умолчанию» (язык из её настроек, параметр плейлиста):
      // это не выбор пользователя, поэтому первые секунды ничего не запоминаем.
      state.restoredAt = Date.now();
      const audio = [];
      const subs = [];
      const tracks = dropQualityVariants(Array.isArray(list) ? list : []);
      let restoreId;
      if (!state.audioRestored) {
        const audioTracks = tracks.filter((t) => t.type === "audio");
        if (audioTracks.length > 1) {
          state.audioRestored = true;
          // Явный выбор для сериала важнее порядка предпочтений из настроек.
          restoreId = savedPref("audio") ? savedAudioId(audioTracks) : pickByOrder(audioTracks, String(L.Storage.get(AUDIO_ORDER, "") || ""));
          const current = audioTracks.find((t) => t.selected);
          if (restoreId !== undefined && current && current.id === restoreId) restoreId = undefined;
          if (restoreId !== undefined) {
            state.restoredAt = Date.now();
            api.set("aid", restoreId);
            console.log(`[mpv] restored audio track ${restoreId}`);
          }
        }
      }
      let restoreSub;
      if (!state.subsRestored) {
        const subTracks = tracks.filter((t) => t.type === "sub");
        if (subTracks.length > 0) {
          state.subsRestored = true;
          if (savedPref("sub")) restoreSub = savedSubId(subTracks);
          else {
            const chosenId = restoreId !== undefined ? restoreId : (tracks.find((t) => t.type === "audio" && t.selected) || {}).id;
            const chosen = tracks.find((t) => t.type === "audio" && t.id === chosenId);
            const order = String(L.Storage.get(SUB_ORDER, "") || "");
            const smart = String(L.Storage.get(SMART_SUBS_SETTING, "off"));
            restoreSub = order.trim() ? pickByOrder(subTracks, order) : (smart === "off" ? undefined : smartSubs(subTracks, chosen, smart));
          }
          const current = subTracks.find((t) => t.selected);
          if (restoreSub === "no" ? !current : current && current.id === restoreSub) restoreSub = undefined;
          if (restoreSub !== undefined) {
            state.restoredAt = Date.now();
            api.set("sid", restoreSub);
            console.log(`[mpv] restored subtitle track ${restoreSub}`);
          }
        }
      }
      const ru = ruLang(L);
      tracks.forEach((t) => {
        const language = langName(t.lang);
        if (t.type === "audio") {
          const item = {
            index: audio.length, language, label: audioLabel(t, language), studio: trackName(t, language),
            selected: restoreId !== undefined ? t.id === restoreId : Boolean(t.selected),
          };
          Object.defineProperty(item, "enabled", {
            enumerable: true,
            get: () => item.selected,
            set: (v) => { if (v) { api.set("aid", t.id); rememberAudio(t); } },
          });
          audio.push(item);
        } else if (t.type === "sub") {
          const item = {
            index: subs.length, language,
            label: subLabel(t, language, ru),
            extra: { codec: t.codec },
            selected: restoreSub !== undefined ? t.id === restoreSub : Boolean(t.selected),
          };
          Object.defineProperty(item, "mode", {
            enumerable: true,
            get: () => (item.selected ? "showing" : "disabled"),
            set: (v) => {
              clearTimeout(state.pendingSubOff);
              if (v === "showing") { api.set("sid", t.id); rememberSub(t); }
              // Lampa гасит все дорожки и включает выбранную; если после этого ничего не включено, выключаем субтитры.
              else state.pendingSubOff = setTimeout(() => { api.set("sid", "no"); rememberSub(null); }, 0);
            },
          });
          subs.push(item);
        }
      });
      state.audio = audio;
      state.subs = subs;
      // Меню Lampa берёт названия из переводов плейлиста (язык и метка от сервера, например «rus / LF»); подменяем их нашими.
      try { L.PlayerPanel.setTranslate({ tracks: audio.slice(), subs: subs.slice() }); } catch (e) { /* панели нет — остаются названия Lampa */ }
      if (!state.levels.length) state.levels = buildLevels(Array.isArray(list) ? list : []);
      console.log(`[mpv] tracks: audio=${audio.length} subs=${subs.length}`);
    }

    function fail(message) {
      state.error = { code: 4, message };
      emit("error");
    }



    // ---- Заголовок плеера: название из главной карточки, сезон, серия и её название ----
    // Онлайн-источники иногда передают вместо названия имя озвучки, поэтому название всегда берём из карточки.
    function cardTitle() {
      const c = activeCard() || playback.card;
      return (c && (c.title || c.name || c.original_title || c.original_name)) || "";
    }

    function parseEpisode() {
      const card = activeCard() || playback.card;
      if (!card) return null;
      const cardTv = Boolean(card.first_air_date || card.number_of_seasons || card.seasons || (card.name && !card.title));
      let season = Number(playback.season);
      let episode = Number(playback.episode);
      const given = Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0;
      if (!given) {
        const hay = [playback.title, playback.fname, playback.name, playback.url].filter(Boolean).join(" ");
        const m = /s(\d{1,2})\s*[._ -]?e(\d{1,3})/i.exec(hay) || /(\d{1,2})x(\d{2,3})/i.exec(hay) ||
          /(\d{1,2})\s*(?:сезон|season)\D{0,6}(\d{1,3})\s*(?:сери|эпиз|episode)/i.exec(hay) ||
          /(?:сезон|season)\s*(\d{1,2})\D{0,8}(?:сери[яи]|эпизод|episode)\s*(\d{1,3})/i.exec(hay);
        if (m) { season = Number(m[1]); episode = Number(m[2]); }
        else return cardTv ? { season: 0, episode: Number.isFinite(episode) && episode > 0 ? episode : 0, card } : null;
      }
      if (!cardTv && !given) return null;
      return { season, episode, card };
    }

    const episodesCache = window.__mpvEpisodes || (window.__mpvEpisodes = new Map());
    function loadEpisodes(id, season) {
      const key = id + ":" + season;
      if (!episodesCache.has(key)) {
        const lang = String(L.Storage.field ? L.Storage.field("tmdb_lang") : "ru") || "ru";
        const url = L.TMDB.api(`tv/${id}/season/${season}?api_key=${L.TMDB.key()}&language=${lang}`);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 6000);
        episodesCache.set(key, fetch(url, { signal: controller.signal }).then((r) => (r.ok ? r.json() : null)).then((j) => (j && j.episodes) || []).catch(() => {
          episodesCache.delete(key);
          return [];
        }));
      }
      return episodesCache.get(key);
    }

    async function renderHeader() {
      const titleEl = document.querySelector(".player-info__title");
      if (!titleEl) return;
      const t = cardTitle();
      if (t) titleEl.textContent = t;
      const ep = parseEpisode();
      let line = document.querySelector(".mpv-epline");
      if (!ep || (!ep.season && !ep.episode)) { if (line) line.remove(); return; }
      if (!line) {
        line = document.createElement("div");
        line.className = "mpv-epline";
        titleEl.parentNode.insertBefore(line, titleEl.nextSibling);
      }
      const ru = ruLang(L);
      const base = [ep.season ? (ru ? "Сезон " : "Season ") + ep.season : "", ep.episode ? (ru ? "Серия " : "Episode ") + ep.episode : ""].filter(Boolean).join(" · ");
      line.textContent = base;
      // Название серии из TMDB, если есть (не «Серия N»).
      if (ep.season > 0 && ep.episode > 0 && ep.card && ep.card.id) {
        const episodes = await loadEpisodes(ep.card.id, ep.season);
        const info = episodes.find((e) => Number(e.episode_number) === ep.episode);
        const name = info && String(info.name || "").trim();
        if (name && !/^(серия|эпизод|episode)\s*\d+$/i.test(name) && !state.destroyed && document.querySelector(".mpv-epline") === line) {
          line.textContent = base + " · " + name;
        }
      }
    }


    // ---- Субтитры из интернета (Stremio OpenSubtitles v3: поиск по IMDb-id, без ключа) ----
    const SUB_LANGS = { ru: { code: "rus", label: ["Русские субтитры", "Russian subtitles"] }, en: { code: "eng", label: ["Английские субтитры", "English subtitles"] } };
    const subsCache = window.__mpvSubsCache || (window.__mpvSubsCache = new Map());
    const imdbCache = window.__mpvImdbCache || (window.__mpvImdbCache = new Map());

    async function imdbFor(card) {
      if (!card || !card.id) return null;
      const direct = card.imdb_id || (card.external_ids && card.external_ids.imdb_id);
      if (direct) return String(direct);
      const tv = Boolean(card.first_air_date || card.number_of_seasons || card.seasons || (card.name && !card.title));
      const key = (tv ? "tv" : "movie") + ":" + card.id;
      if (!imdbCache.has(key)) {
        const url = L.TMDB.api(`${tv ? "tv" : "movie"}/${card.id}/external_ids?api_key=${L.TMDB.key()}`);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 6000);
        imdbCache.set(key, fetch(url, { signal: controller.signal }).then((r) => (r.ok ? r.json() : null)).then((j) => (j && j.imdb_id) || null).catch(() => null));
      }
      return imdbCache.get(key);
    }

    // Подходящие субтитры на языке: серия — только эта серия; сортировка по совпадению с именем раздачи и по рейтингу.
    async function findSubtitles(lang) {
      const ep = parseEpisode();
      const card = activeCard() || playback.card;
      const imdb = await imdbFor(card);
      if (!imdb) throw new Error(ruLang(L) ? "не найден IMDb-id" : "no IMDb id");
      const season = ep && ep.season > 0 && ep.episode > 0 ? ep.season : 0;
      const episode = season ? ep.episode : 0;
      const key = `${imdb}:${season}:${episode}`;
      if (!subsCache.has(key)) {
        subsCache.set(key, api.subsSearch(imdb, season, episode).then((raw) => {
          const data = JSON.parse(raw);
          if (data.error) throw new Error(data.error);
          return Array.isArray(data.subtitles) ? data.subtitles : [];
        }).catch((e) => { subsCache.delete(key); throw e; }));
      }
      const all = await subsCache.get(key);
      const wanted = SUB_LANGS[lang].code;
      const hay = [playback.title, playback.fname, playback.name, String(playback.url || "").split("/").pop()].filter(Boolean).join(" ").toLowerCase();
      const tokens = new Set(hay.split(/[^a-zа-я0-9]+/i).filter((x) => x.length >= 3));
      const score = (x) => {
        const words = String(x.movieReleaseName || x.subtitleFileName || "").toLowerCase().split(/[^a-zа-я0-9]+/i).filter((w) => w.length >= 3);
        return words.filter((w) => tokens.has(w)).length;
      };
      return all
        .filter((x) => x.lang === wanted && (!season || (Number(x.season) === season && Number(x.episode) === episode)))
        .map((x) => ({ x, s: score(x) }))
        .sort((a, b) => b.s - a.s || (Number(b.x.g) || 0) - (Number(a.x.g) || 0))
        .map((e) => e.x);
    }

    async function applySubtitle(x, lang, explicit = false) {
      const title = (lang === "ru" ? "RU" : "EN") + " · " + String(x.movieReleaseName || x.subtitleFileName || "OpenSubtitles").slice(0, 80);
      const r = await api.subsLoad(x.url, title, lang);
      if (!r || !r.ok) throw new Error((r && r.error) || "load failed");
      state.onlineSubTitle = title;
      if (explicit) remember("sub", { lang, studio: "", title, kind: "full", online: true }, true);
      return title;
    }

    // Меню: русские / английские / выключить. Вызывается кнопкой на панели и клавишей U.
    async function openSubsMenu() {
      const ru = ruLang(L);
      const hasOnline = Boolean(state.onlineSubTitle);
      const rows = [
        { title: SUB_LANGS.ru.label[ru ? 0 : 1], sub: ru ? "найти и выбрать" : "search and pick", value: "ru" },
        { title: SUB_LANGS.en.label[ru ? 0 : 1], sub: ru ? "найти и выбрать" : "search and pick", value: "en" },
        { title: ru ? "Выключить субтитры" : "Turn subtitles off", value: "off" },
      ];
      if (hasOnline) rows.push({ title: ru ? "Включить загруженные снова" : "Turn downloaded back on", sub: state.onlineSubTitle, value: "on" });
      const choice = await pickList(L, ru ? "Субтитры из интернета" : "Online subtitles", rows, 0);
      if (!choice) return;
      if (choice === "off") { remember("sub", { off: true }, true); api.set("sid", "no"); showToast(ru ? "Субтитры выключены" : "Subtitles off"); return; }
      if (choice === "on") {
        const track = await api.get("track-list").catch(() => null);
        const found = Array.isArray(track) && track.find((t) => t.type === "sub" && t.title === state.onlineSubTitle);
        if (found) { remember("sub", subPref(found), true); api.set("sid", found.id); showToast(ru ? "Субтитры включены" : "Subtitles on"); }
        return;
      }
      showToast(ru ? "Поиск субтитров…" : "Searching subtitles…");
      let found;
      try { found = await findSubtitles(choice); } catch (e) { return showToast((ru ? "Поиск не удался: " : "Search failed: ") + e.message); }
      if (!found.length) return showToast(ru ? "Субтитры на этом языке не найдены" : "No subtitles in this language");
      const variants = found.slice(0, 12).map((x) => ({
        title: String(x.movieReleaseName || x.subtitleFileName || "OpenSubtitles").slice(0, 90),
        sub: [x.releaseGroup, x.fpsMilli ? (x.fpsMilli / 1000).toFixed(3) + " fps" : ""].filter(Boolean).join(" · "),
        value: x,
      }));
      const picked = await pickList(L, SUB_LANGS[choice].label[ru ? 0 : 1], variants, 0);
      if (!picked) return;
      try {
        await applySubtitle(picked, choice, true);
        showToast(ru ? "Субтитры включены" : "Subtitles on");
      } catch (e) { showToast((ru ? "Не удалось загрузить: " : "Download failed: ") + e.message); }
    }
    el.__subsMenu = openSubsMenu;

    // Главы файла: метки на шкале времени и переход по ним (PageUp / PageDown).
    function renderChapterMarks() {
      document.querySelectorAll(".mpv-chapters").forEach((n) => n.remove());
      const line = document.querySelector(".player-panel__timeline");
      if (!line || !state.chapters.length || !(state.duration > 0)) return;
      const box = document.createElement("div");
      box.className = "mpv-chapters";
      state.chapters.forEach((c) => {
        if (!(Number(c.time) > 0.5)) return;
        const mark = document.createElement("div");
        mark.className = "mpv-chapter-mark";
        mark.style.left = Math.min(100, (Number(c.time) / state.duration) * 100) + "%";
        box.appendChild(mark);
      });
      line.appendChild(box);
    }
    function loadChapters() {
      api.get("chapter-list").then((list) => {
        state.chapters = Array.isArray(list) ? list.filter((c) => Number.isFinite(Number(c.time))) : [];
        renderChapterMarks();
        if (state.chapters.length) console.log(`[mpv] chapters: ${state.chapters.length}`);
        skipFromChapters();
      }).catch(() => {});
    }
    el.__chapter = (dir) => {
      const ru = ruLang(L);
      if (!state.chapters.length) return showToast(ru ? "В файле нет глав" : "No chapters in this file");
      const target = chapterTarget(state.chapters, state.time, dir);
      if (!target) return;
      el.currentTime = target.time;
      const name = String(state.chapters[target.index].title || "").trim();
      showToast((ru ? "Глава " : "Chapter ") + (target.index + 1) + "/" + state.chapters.length + (name ? ": " + name : ""));
    };

    // Клавиши A и J: следующая звуковая дорожка и следующие субтитры по кругу (после последних — «выключены»).
    el.__cycleTrack = (kind) => {
      const ru = ruLang(L);
      const title = (item) => [item.language, item.label].filter(Boolean).join(" · ") || (ru ? "Дорожка " : "Track ") + (item.index + 1);
      if (kind === "audio") {
        if (state.audio.length < 2) return showToast(ru ? "Звуковая дорожка одна" : "Only one audio track");
        const next = state.audio[(Math.max(0, state.audio.findIndex((x) => x.selected)) + 1) % state.audio.length];
        next.enabled = true;
        return showToast((ru ? "Звук: " : "Audio: ") + title(next));
      }
      if (!state.subs.length) return showToast(ru ? "Субтитров нет" : "No subtitles");
      const n = state.subs.findIndex((x) => x.selected) + 1;
      if (n >= state.subs.length) {
        api.set("sid", "no");
        rememberSub(null);
        return showToast(ru ? "Субтитры выключены" : "Subtitles off");
      }
      state.subs[n].mode = "showing";
      showToast((ru ? "Субтитры: " : "Subtitles: ") + title(state.subs[n]));
    };

    // Авто-режим: нет субтитров на выбранном языке — берём лучшие из найденных.
    async function maybeAutoSubs() {
      const mode = String(L.Storage.get(SUBS_SETTING, "manual"));
      const pref = savedPref("sub");
      // Выбор в сериале главнее: свою дорожку не подменяем; прошлый выбор загруженных субтитров ищем снова даже в ручном режиме.
      if (pref && !pref.online) return;
      if (pref && pref.off) return;
      if ((mode === "manual" && !(pref && pref.online)) || state.destroyed || state.autoSubsDone) return;
      const lang = pref && pref.online ? normLang(pref.lang) : mode === "auto_en" ? "en" : "ru";
      if (lang !== "ru" && lang !== "en") return;
      state.autoSubsDone = true;
      const codes = lang === "ru" ? ["ru", "rus"] : ["en", "eng"];
      const track = await api.get("track-list").catch(() => null);
      const have = Array.isArray(track) && track.some((t) => t.type === "sub" && codes.includes(String(t.lang || "").toLowerCase()));
      if (have) return;
      try {
        const found = await findSubtitles(lang);
        if (!found.length || state.destroyed) return;
        await applySubtitle(found[0], lang);
        showToast(ruLang(L) ? "Субтитры загружены из интернета" : "Subtitles loaded from the internet");
      } catch (e) { console.log("[subs] авто: " + e.message); }
    }


    // ---- «Сейчас играет» и медиаклавиши (команды обрабатывает приложение; следующая и предыдущая серия — здесь) ----
    function sendNowPlaying() {
      if (state.destroyed) return;
      const card = activeCard() || playback.card;
      const title = cardTitle();
      if (!title) return;
      const line = document.querySelector(".mpv-epline");
      let canNext = false;
      let canPrev = false;
      try {
        const pl = L.PlayerPlaylist;
        canNext = Boolean(pl && pl.canNext && pl.canNext());
        canPrev = Boolean(pl && pl.get && pl.get().length > 1);
      } catch (e) { /* без плейлиста */ }
      let artwork = null;
      try {
        if (card && card.poster_path) artwork = L.TMDB.image("t/p/w500" + card.poster_path);
      } catch (e) { /* без постера */ }
      // Озвучка (студия) в подзаголовке «Сейчас играет», если известна и ещё не названа в строке серии.
      const voice = (state.audio.find((x) => x.selected) || {}).studio || "";
      let subtitle = line ? line.textContent : "";
      if (voice && !subtitle.includes(voice)) subtitle = [subtitle, voice].filter(Boolean).join(" · ");
      api.nowPlaying({ title, subtitle, duration: Number(state.duration) || 0, canNext, canPrev, artwork }).catch(() => {});
    }

    el.__remote = (cmd) => {
      try {
        if (cmd === "next" && L.PlayerPlaylist && L.PlayerPlaylist.next) L.PlayerPlaylist.next();
        else if (cmd === "prev" && L.PlayerPlaylist && L.PlayerPlaylist.prev) L.PlayerPlaylist.prev();
      } catch (e) { console.log("[mpv] remote " + cmd + " failed: " + e); }
    };

    // ---- Пропуск заставок по таймкодам TheIntroDB ----
    const SKIP_LABELS = {
      intro: ["Пропустить заставку", "Skip intro"],
      recap: ["Пропустить пересказ", "Skip recap"],
      credits: ["Пропустить титры", "Skip credits"],
      preview: ["Пропустить анонс", "Skip preview"],
    };
    const skip = { segments: [], current: null, done: new Set(), shownFor: null, session: 0, tidb: false };

    // Что искать: фильм — по TMDB-id; серия — ещё сезон и номер. Неопределённую серию не гадаем.
    function skipLookup() {
      const card = playback.card || activeCard();
      const id = card && Number(card.id);
      if (!Number.isFinite(id) || id <= 0) return { error: "нет TMDB-id" };
      // Lampa передаёт season=0 и episode=0 и для фильмов, поэтому тип определяем по карточке
      // (у сериала first_air_date / number_of_seasons / name без title), а номера — только если они > 0.
      const cardTv = Boolean(card.first_air_date || card.number_of_seasons || card.seasons || (card.name && !card.title));
      const seasonGiven = Number.isFinite(Number(playback.season)) && Number(playback.season) > 0;
      const tv = cardTv || (seasonGiven && Number(playback.episode) > 0);
      if (!tv) return { id, tv: false };
      let season = seasonGiven ? Number(playback.season) : NaN;
      let episode = Number(playback.episode);
      if (!Number.isFinite(season) || !Number.isFinite(episode) || episode <= 0) {
        const hay = [playback.title, playback.fname, playback.name, playback.url].filter(Boolean).join(" ");
        const m = /s(\d{1,2})\s*e(\d{1,3})/i.exec(hay) || /(\d{1,2})x(\d{2,3})/i.exec(hay);
        if (m) { season = Number(m[1]); episode = Number(m[2]); }
      }
      if (!Number.isFinite(season) || !Number.isFinite(episode) || season <= 0 || episode <= 0) return { error: `сериал без номера серии (season=${playback.season}, episode=${playback.episode}, title=${String(playback.title || playback.fname || "").slice(0, 80)})` };
      return { id, tv: true, season, episode };
    }

    function skipReset() {
      skip.segments = [];
      skip.tidb = false;
      skip.current = null;
      skip.done.clear();
      skip.shownFor = null;
      skip.session++;
      hideSkipButton();
    }

    async function skipFetch() {
      const mode = String(L.Storage.get(SKIP_SETTING, "button"));
      if (mode === "off") return;
      const q = skipLookup();
      if (q.error) return console.log(`[tidb] пропуск недоступен: ${q.error}`);
      const session = skip.session;
      try {
        const raw = await api.tidbMedia(q.id, q.tv ? q.season : 0, q.tv ? q.episode : 0);
        const data = JSON.parse(raw);
        if (data.error) return console.log(`[tidb] tmdb=${q.id}${q.tv ? ` s${q.season}e${q.episode}` : ""}: ${data.error === "HTTP 404" ? "в базе нет таймкодов для этого видео (404)" : data.error}`);
        if (session !== skip.session || state.destroyed) return;
        const list = [];
        for (const type of Object.keys(SKIP_LABELS)) {
          for (const seg of Array.isArray(data[type]) ? data[type] : []) {
            const start = seg.start_ms == null ? 0 : Number(seg.start_ms) / 1000;
            const end = seg.end_ms == null ? null : Number(seg.end_ms) / 1000;
            if (Number.isFinite(start) && (end === null || (Number.isFinite(end) && end - start >= 3))) list.push({ type, start, end });
          }
        }
        skip.segments = list;
        skip.tidb = list.length > 0;
        if (!skip.tidb) skipFromChapters();
        console.log(`[tidb] tmdb=${q.id}${q.tv ? ` s${q.season}e${q.episode}` : ""}: сегментов ${list.length} (${list.map((x) => x.type).join(",")})`);
      } catch (e) {
        console.log(`[tidb] запрос не удался: ${e}`);
      }
    }

    // Частота экрана под частоту кадров (по настройке): приложение само подбирает режим и вернёт прежний.
    async function matchDisplayRate() {
      if (state.rateTried || String(L.Storage.get(REFRESH_SETTING, "off")) !== "on") return;
      const fps = Number(await api.get("container-fps").catch(() => 0)) || Number(await api.get("estimated-vf-fps").catch(() => 0));
      if (!(fps >= 10)) return;
      state.rateTried = true;
      state.rateSet = true;
      api.displayRate(fps).catch(() => {});
    }

    // Запасной источник: главы файла с названиями «Opening», «Титры» и т. п. Таймкоды TheIntroDB важнее и их не заменяют.
    function skipFromChapters() {
      if (skip.tidb || String(L.Storage.get(SKIP_SETTING, "button")) === "off") return;
      const list = chapterSegments(state.chapters, Number(state.duration) || 0);
      if (!list.length) return;
      skip.segments = list;
      console.log(`[chapters] пропуск по главам: ${list.map((x) => x.type).join(",")}`);
    }

    function skipEnd(seg) {
      return seg.end === null ? Number(state.duration) || 0 : seg.end;
    }

    function skipTo(seg) {
      const end = skipEnd(seg);
      if (!(end > 0)) return;
      skip.done.add(seg);
      hideSkipButton();
      el.currentTime = Math.max(0, state.duration > 0 ? Math.min(end, state.duration - 0.5) : end);
    }

    function skipTick(t) {
      if (!skip.segments.length) return;
      const mode = String(L.Storage.get(SKIP_SETTING, "button"));
      if (mode === "off") return;
      const seg = skip.segments.find((x) => t >= x.start - 0.2 && t < skipEnd(x) - 1.5);
      if (seg === skip.current) return;
      skip.current = seg || null;
      if (!seg) { skip.shownFor = null; return hideSkipButton(); }
      if (mode === "auto" && (seg.type === "intro" || seg.type === "recap") && !skip.done.has(seg)) {
        skipTo(seg);
        showToast(L.Lang.translate(seg.type === "intro" ? "app_settings_mpv_skipped_intro" : "app_settings_mpv_skipped_recap"));
        return;
      }
      if (skip.shownFor !== seg && !skip.done.has(seg)) {
        skip.shownFor = seg;
        showSkipButton(SKIP_LABELS[seg.type][ruLang(L) ? 0 : 1], () => skipTo(seg));
      }
    }

    el.__skipNow = () => { if (skip.current) skipTo(skip.current); };

    // Вид субтитров из настроек «MPV»; mpv.conf применится позже (в open) и поэтому важнее.
    function applySubtitleStyle() {
      for (const [name, { def }] of Object.entries(SUB_STYLE)) applySubStyleValue(name, String(L.Storage.get(name, def) || def));
    }

    // Открывает (или заново открывает при обрыве) источник с позиции start.
    function openAt(start, isRetry) {
      if (!isRetry) {
        document.documentElement.classList.add(CLASS);
        startSweep();
        startProfileButton(L);
        startSeekButtons(L);
        state.retries = 0;
        state.everLoaded = false;
        state.rateTried = false;
        skipReset();
        skipFetch();
        renderHeader();
        if (stillWatchingDue(L)) {
          state.askStill = true;
        }
        // Скорость и задержки mpv помнит между файлами: сбрасываем то, что меняли клавишами.
        if (speedTouched) { api.set("speed", 1); speedTouched = false; }
        if (delaysTouched) { api.set("audio-delay", 0); api.set("sub-delay", 0); delaysTouched = false; }
        // Задержка субтитров, запомненная для этого сериала.
        const savedDelay = Number(savedPref("subDelay"));
        if (savedDelay) { api.set("sub-delay", savedDelay); delaysTouched = true; }
        applySubtitleStyle();
      }
      state.loaded = false;
      state.error = null;
      state.metadataSent = false;
      state.tracksKnown = false;
      state.tracksTimedOut = false;
      state.levels = [];
      state.chapters = [];
      state.openingStart = start;
      state.seekTarget = state.openingStart > 0 ? state.openingStart : null;
      state.pendingSeek = null;
      console.log(`[mpv] open${isRetry ? " (retry " + state.retries + ")" : ""}, start=${state.openingStart}`);
      api.open(state.src, {
        start: state.openingStart,
        volume: Math.round(state.volume * 100),
        profile: window.Lampa && window.Lampa.Storage ? String(window.Lampa.Storage.get(PROFILE_SETTING, "") || "") : "",
        mpvOptions: bufferOptions(),
      }).then((r) => { if (!(r && r.ok)) fail("open failed"); }, (e) => fail(String(e)));
    }

    el.load = () => {
      if (!state.src) return;
      openAt(initialPosition(), false);
    };

    // Обрыв сети или ошибка чтения: пробуем открыть тот же источник с того же места, прежде чем показать ошибку.
    function retryOrFail(message) {
      // everLoaded: воспроизведение уже начиналось (openAt сбрасывает loaded при каждой попытке, а лимит и позиция
      // должны оставаться «как в середине просмотра»).
      const max = state.everLoaded ? 5 : 2;
      if (state.destroyed || state.retries >= max) return fail(message);
      state.retries++;
      const at = state.everLoaded ? Math.max(0, state.time - 2) : state.openingStart;
      const ru = ruLang(L);
      showToast((ru ? "Соединение потеряно, повтор " : "Connection lost, retry ") + state.retries + "/" + max + "…");
      console.log(`[mpv] retry ${state.retries}/${max} at ${at}: ${message}`);
      emit("waiting");
      clearTimeout(state.retryTimer);
      state.retryTimer = setTimeout(() => { if (!state.destroyed) openAt(at, true); }, Math.min(8000, 1000 * state.retries * state.retries));
    }
    // Lampa решает «пауза или воспроизведение» по video.paused, поэтому состояние обновляем сразу,
    // не дожидаясь ответа mpv. События pause от mpv, пришедшие до создания тюба, теряются.
    el.play = () => { state.paused = false; api.set("pause", false); return Promise.resolve(); };
    el.pause = () => { state.paused = true; api.set("pause", true); };
    // Пауза не от пользователя (таймер сна, «Вы ещё смотрите?»): ставим её через плеер Lampa, иначе значок пуск/пауза не переключится
    // (Lampa обновляет его только в своём pause()); он же вызовет el.pause().
    el.__pauseExternal = () => {
      if (L.PlayerVideo && L.PlayerVideo.pause) L.PlayerVideo.pause();
      else { el.pause(); emit("pause"); }
    };
    el.destroy = () => {
      if (state.destroyed) return;
      state.destroyed = true;
      if (active === el) active = null;
      if (state.rateSet) api.displayRate(0).catch(() => {});
      document.documentElement.classList.remove(CLASS);
      stopSweep();
      stopProfileButton();
      stopSeekButtons();
      closeStatsPanel();
      if (pictureCloser) pictureCloser();
      api.stop();
      clearTimeout(state.pendingSubOff);
      clearTimeout(state.retryTimer);
      clearTimeout(state.retryReset);
      clearTimeout(state.nowPlayingTimer);
      api.nowPlayingClear().catch(() => {});
      skip.session++;
      hideSkipButton();
      const epLine = document.querySelector(".mpv-epline");
      if (epLine) epLine.remove();
      Object.keys(listeners).forEach((k) => delete listeners[k]);
    };

    el.__mpvEvent = (ev) => {
      if (ev.event === "property-change") {
        const { name, data } = ev;
        if (name === "time-pos" && typeof data === "number") {
          state.time = data;
          skipTick(data);
          // Если paused-for-cache=false потерялся (после смены качества и перемотки), считаем, что
          // воспроизведение возобновилось, когда время сдвинулось: иначе Lampa держит экран загрузки.
          if (state.waiting && Math.abs(data - state.waitTime) > 0.3) {
            state.waiting = false;
            emit("playing");
          }
          const now = Date.now();
          if (now - state.lastTimeEvent >= 250) {
            state.lastTimeEvent = now;
            publishPosition();
          }
        } else if (name === "duration" && typeof data === "number") {
          state.duration = data;
          announceLoaded(false);
        } else if (name === "pause") {
          state.paused = Boolean(data);
        } else if (name === "paused-for-cache") {
          state.waiting = Boolean(data);
          state.waitTime = state.time;
          emit(data ? "waiting" : "playing");
        } else if (name === "video-params" && data) {
          state.width = data.w || 0;
          state.height = data.h || 0;
          // Картинка зависит от того, SDR видео или HDR: ставим заново, когда параметры сменились.
          const paramsKey = `${data.w}x${data.h}:${data.gamma}`;
          if (paramsKey !== state.picturedFor && window.Lampa) { state.picturedFor = paramsKey; applyPicture(window.Lampa); }
          matchDisplayRate();
        } else if (name === "demuxer-cache-time" && state.duration > 0) {
          emit("progress", { percent: Math.round(Math.min(100, (Number(data) / state.duration) * 100)) });
        } else if (name === "aid" || name === "sid") {
          console.log(`[mpv] ${name} = ${data}`);
        } else if (name === "track-list") {
          warnDolbyVision(data);
          buildTracks(data);
          state.tracksKnown = true;
          announceLoaded(false);
        } else if (name === "eof-reached" && data === true) {
          emit("ended");
        }
      } else if (ev.event === "file-loaded") {
        state.picturedFor = null;
        // Запасной вызов: если параметры нового видео совпали с прежними, событие video-params не придёт.
        setTimeout(() => { if (window.Lampa) applyPicture(window.Lampa); }, 300);
        // Звуковые эффекты после профиля (он мог заменить цепочку af): метка отдельная, поэтому ставим заново.
        setTimeout(() => { if (window.Lampa) applyAudioFx(window.Lampa); }, 700);
        state.loaded = true;
        state.everLoaded = true;
        api.set("mute", state.muted);
        if (state.askStill) {
          state.askStill = false;
          const ru = ruLang(window.Lampa);
          el.__pauseExternal();
          showToast(ru ? "Вы ещё смотрите? Нажмите пробел, чтобы продолжить" : "Are you still watching? Press Space to continue", 15000);
        }
        if (state.pendingSeek !== null) api.command(["seek", String(state.pendingSeek), "absolute+exact"]);
        state.pendingSeek = null;
        setTimeout(() => { state.tracksTimedOut = true; announceLoaded(false); }, 1500);
        setTimeout(maybeAutoSubs, 3000);
        setTimeout(loadChapters, 1500);
        announceLoaded(false);
      } else if (ev.event === "playback-restart") {
        // Первый кадр на экране: обложка открытия больше не нужна.
        if (window.desktopPlaybackCover) window.desktopPlaybackCover.hide();
        state.waiting = false;
        renderHeader();
        sendNowPlaying();
        clearTimeout(state.nowPlayingTimer);
        state.nowPlayingTimer = setTimeout(sendNowPlaying, 4000);
        // Минуту стабильной игры после повтора — попытки снова полные.
        clearTimeout(state.retryReset);
        state.retryReset = setTimeout(() => { state.retries = 0; }, 60000);
        api.get("pause").then((v) => { state.paused = Boolean(v); }, () => {});
        announceLoaded(true);
        emit("playing");
      } else if (ev.event === "end-file" && ev.reason === 4) {
        retryOrFail(ev.error || "playback error");
      }
    };
    return el;
  }

  whenReady((L) => {
    window.desktopMpvInstalled = true;
    window.__mpvEvent = (ev) => { if (active) active.__mpvEvent(ev); };
    window.__mpvRemote = (cmd) => { if (active && active.__remote) active.__remote(cmd); };
    // Для обложки открытия: пойдёт ли это видео через mpv (настройка включена).
    window.desktopMpvActive = () => mpvEnabled(L);
    addMenuStyle();
    addSettings(L);
    hideExternalMpv(L);
    installProfileHotkey(L);
    installPipButton();
    installActivityTracker();
    installArrowKeys(L);
    installPlayerKeys(L);
    installPlayerWheel();
    L.PlayerVideo.registerTube({
      name: "mpv",
      // WebKit не играет, например, MKV; mpv берёт все http(s)/file-источники, пока включён в настройках.
      verify: (src) => mpvEnabled(L) && /^(https?|file):/i.test(String(src)),
      create: (callback) => {
        addStyle();
        const shim = createShim(L);
        active = shim;
        callback(shim);
        return $(shim);
      },
    });
    installLocalFiles(L);
    console.log("[mpv] tube registered");
  });
})();
