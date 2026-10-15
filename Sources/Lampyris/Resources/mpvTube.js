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
    getConfig: () => call("getConfig"),
    setConfig: (text) => call("setConfig", text),
  };

  const CLASS = "mpv-active";
  const COMPONENT = "mpv_settings";
  const ONLINE_SETTING = "mpv_online_enabled";
  const PROFILE_SETTING = "mpv_profile";
  const CONFIG_BUTTON = "mpv_config_edit";
  const BUFFER_SETTING = "mpv_buffer_secs";
  const SEEK_SETTING = "mpv_seek_step";
  const SKIP_SETTING = "mpv_skip_mode";
  const SUBS_SETTING = "mpv_online_subs";
  // Вид субтитров в mpv (настройки субтитров самой Lampa относятся к HTML5-плееру и на mpv не действуют).
  const SUB_STYLE = {
    mpv_sub_size: { property: "sub-scale", def: "1" },
    mpv_sub_pos: { property: "sub-pos", def: "100" },
    mpv_sub_color: { property: "sub-color", def: "#FFFFFF" },
    mpv_sub_box: { property: "sub-border-style", def: "outline-and-shadow" },
  };
  const VOLUME_STEP = 0.05;
  const BUFFER_MAX_BYTES = "512MiB";
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
        ru: "Выключите, чтобы играть встроенным плеером WebKit. Он не воспроизводит MKV и ряд кодеков. Действует со следующего запуска видео.",
        en: "Turn off to play with the built-in WebKit player. It cannot play MKV and some codecs. Applies from the next video.",
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
      app_settings_mpv_substyle_descr: {
        ru: "Относится к субтитрам, которые рисует mpv. Действует со следующего видео; опции из mpv.conf важнее.",
        en: "Applies to subtitles drawn by mpv. Takes effect from the next video; options from mpv.conf take priority.",
      },
      app_settings_mpv_subs: { ru: "Субтитры из интернета", en: "Online subtitles" },
      app_settings_mpv_subs_descr: {
        ru: "Поиск субтитров (OpenSubtitles через Stremio, без ключа) для видео без них. «По запросу» — из меню плеера или клавишей U; «Авто» — сам найти и включить, если в видео нет субтитров на этом языке.",
        en: "Subtitle search (OpenSubtitles through Stremio, no key) for videos without them. Manual: from the player menu or the U key; Auto: find and enable on its own when the video has no subtitles in that language.",
      },
      app_settings_mpv_subs_manual: { ru: "По запросу", en: "On request" },
      app_settings_mpv_subs_auto_ru: { ru: "Авто: русские", en: "Auto: Russian" },
      app_settings_mpv_subs_auto_en: { ru: "Авто: English", en: "Auto: English" },
      app_settings_mpv_skipped_intro: { ru: "Заставка пропущена", en: "Intro skipped" },
      app_settings_mpv_skipped_recap: { ru: "Пересказ пропущен", en: "Recap skipped" },
      app_settings_mpv_skip_off: { ru: "Выключено", en: "Off" },
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
    {
      const lang = String(L.Storage.get("language", "ru")) === "ru" ? "ru" : "en";
      const names = (key) => L.Lang.translate(key);
      const pick = (arr) => arr[lang];
      const sizes = pick({ ru: ["Мелкий", "Меньше", "Обычный", "Крупный", "Очень крупный", "Огромный"], en: ["Small", "Smaller", "Normal", "Large", "Very large", "Huge"] });
      const poss = pick({ ru: ["Внизу", "Чуть выше", "Выше", "Высоко"], en: ["Bottom", "A bit higher", "Higher", "High"] });
      const colors = pick({ ru: ["Белый", "Жёлтый", "Голубой"], en: ["White", "Yellow", "Cyan"] });
      const boxes = pick({ ru: ["Обводка", "Плашка"], en: ["Outline", "Box"] });
      const defs = [
        ["mpv_sub_size", "app_settings_mpv_substyle_size", { "0.7": sizes[0], "0.85": sizes[1], "1": sizes[2], "1.25": sizes[3], "1.5": sizes[4], "2": sizes[5] }, "1"],
        ["mpv_sub_pos", "app_settings_mpv_substyle_pos", { "100": poss[0], "95": poss[1], "90": poss[2], "85": poss[3] }, "100"],
        ["mpv_sub_color", "app_settings_mpv_substyle_color", { "#FFFFFF": colors[0], "#FFFF00": colors[1], "#00FFFF": colors[2] }, "#FFFFFF"],
        ["mpv_sub_box", "app_settings_mpv_substyle_box", { "outline-and-shadow": boxes[0], "background-box": boxes[1] }, "outline-and-shadow"],
      ];
      defs.forEach(([name, title, values, def]) => {
        L.SettingsApi.addParam({
          component: COMPONENT,
          param: { name, type: "select", values, default: def },
          field: { name: names(title), description: names("app_settings_mpv_substyle_descr") },
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
      .mpv-statpanel { position:fixed; top:4%; left:3%; z-index:125; min-width:22em; padding:1em 1.3em; border-radius:1.2em;
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
      .mpv-help .mpv-pick__title { font-size:1.3em; }`;
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
      row.textContent = o.title;
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
      if (live) api.profile(item.value);
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
        help.on("hover:enter", () => openHelp(L));
        window.$(host).before(help);
        const subs = window.$(
          `<div class="player-panel__mpvsubs button selector"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM5 12h4v2H5v-2zm9 6H5v-2h9v2zm5 0h-3v-2h3v2zm0-4h-8v-2h8v2z"/></svg><div class="tooltip"></div></div>`
        );
        subs.find(".tooltip").text(ru ? "Субтитры из интернета (U)" : "Online subtitles (U)");
        subs.on("hover:enter", () => active && active.__subsMenu && active.__subsMenu());
        window.$(host).before(subs);
        if (!hasProfiles) return;
        const btn = window.$(
          `<div class="player-panel__mpvprofile button selector"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg></div>`
        );
        btn.on("hover:enter", () => chooseProfile(L, true));
        window.$(host).before(btn);
      }, 300);
    }).catch(() => {});
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


  // Клавиши плеера (пока играет mpv): [ ] — скорость на 0.25 (\ — сброс), , . — задержка звука на 0.1 с,
  // Z X — задержка субтитров, S — скриншот, I — окно статистики. Работают при видео и при панели плеера.
  let speedTouched = false;
  let delaysTouched = false;
  let statsPanelTimer = null;

  function ruLang(L) { return String(L.Storage.get("language", "ru")) === "ru"; }

  async function changeDelay(L, prop, delta, titleRu, titleEn) {
    const current = Number(await api.get(prop).catch(() => 0)) || 0;
    const next = Math.round((current + delta) * 10) / 10;
    api.set(prop, next);
    delaysTouched = true;
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
    document.body.appendChild(el);
    const names = ["video-codec", "hwdec-current", "video-params", "container-fps", "estimated-vf-fps", "video-bitrate",
      "frame-drop-count", "decoder-frame-drop-count", "vo-delayed-frame-count", "avsync", "audio-codec-name", "audio-params",
      "audio-bitrate", "track-list", "demuxer-cache-state", "demuxer-cache-time", "time-pos", "speed", "volume", "audio-delay", "sub-delay"];
    const ru = ruLang(L);
    const tick = async () => {
      if (!active) return closeStatsPanel();
      pollTorrentStat(L);
      const vals = await Promise.all(names.map((n) => api.get(n).catch(() => null)));
      const v = Object.fromEntries(names.map((n, i) => [n, vals[i]]));
      const num = (x, d = 0) => (Number.isFinite(Number(x)) && x !== null ? Number(x).toFixed(d) : "—");
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
        [ru ? "Битрейт" : "Bitrate", num(v["video-bitrate"] / 1e6, 2) + " + " + num(v["audio-bitrate"] / 1e6, 2) + " Mbit/s"],
        [ru ? "Сеть" : "Network", Number.isFinite(cache["raw-input-rate"]) ? num(cache["raw-input-rate"] * 8 / 1e6, 2) + " Mbit/s" : "—"],
        [ru ? "Буфер вперёд" : "Buffer ahead", num(Number(v["demuxer-cache-time"]) - Number(v["time-pos"]), 1) + " " + L.Lang.translate("app_settings_mpv_second")],
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

  function installPlayerKeys(L) {
    window.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!active || !document.documentElement.classList.contains(CLASS)) return;
      const t = event.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector(".mpv-conf, .mpv-pick") || document.body.classList.contains("selectbox--open")) return;
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
        KeyH: () => !event.repeat && openHelp(L),
        KeyN: () => !event.repeat && active && active.__skipNow && active.__skipNow(),
        KeyU: () => !event.repeat && active && active.__subsMenu && active.__subsMenu(),
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
      if (event.shiftKey && /^Arrow(Up|Down)$/.test(event.key)) return;
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
        b.on("hover:enter", () => {
          if (!active) return;
          if (d.step) return void seekBy(d.step * seekStep(L));
          const dur = Number(active.duration) || 0;
          active.currentTime = d.key === "start" ? 0 : Math.max(0, dur - 0.5);
        });
        return b;
      };
      const box = (a, b) => window.$('<div class="player-panel__box-buttons player-panel__seekbtn-box"></div>').append(make(a), make(b));
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
    document.querySelectorAll(".player-panel__mpvprofile, .player-panel__mpvhelp, .player-panel__mpvsubs").forEach((n) => n.remove());
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
          placeholder="# hwdec=videotoolbox&#10;&#10;[hdr]&#10;tone-mapping=bt.2446a"></textarea>
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
    if (!values || !L.Params.select) return;
    const inner = L.Lang.translate("settings_param_player_inner") + " (MPV)";
    ["player", "player_iptv", "player_torrent"].forEach((name) => {
      if (!values[name] || typeof values[name] !== "object") return;
      const rest = Object.assign({}, values[name]);
      delete rest.mpv;
      rest.inner = inner;
      L.Params.select(name, rest, "inner");
      if (L.Storage.get(name) === "mpv") L.Storage.set(name, "inner");
    });
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
  function audioLabel(bitrate, params, tracks) {
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
      audio: [], subs: [], levels: [], pendingSubOff: null, dvWarned: false,
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

    // Название языка по коду mpv (rus, eng, ru…). Без знания кода возвращаем его как есть.
    let langNames = null;
    function langName(code) {
      const raw = String(code || "").trim();
      if (!raw || /^(und|unk|mis|zxx)$/i.test(raw)) return "";
      try {
        langNames = langNames || new Intl.DisplayNames(["ru"], { type: "language" });
        const name = langNames.of(raw.toLowerCase());
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
      try {
        const a = L.Activity && L.Activity.active && L.Activity.active();
        return (a && (a.card || a.movie)) || null;
      } catch (e) { return null; }
    }

    function seriesKey() {
      const card = playback.card || activeCard();
      const id = card && card.id;
      const isSeries = (playback.season !== undefined && playback.season !== null && Number.isFinite(Number(playback.season))) ||
        Boolean(card && (card.name || card.original_name || card.first_air_date || card.number_of_seasons));
      if (!id || !isSeries) {
        console.log(`[mpv] prefs: сериал не определён (id=${id}, season=${playback.season}, card keys = ${card ? Object.keys(card).slice(0, 12).join(",") : "-"})`);
        return null;
      }
      return String(id);
    }

    function remember(kind, value) {
      // После восстановления Lampa сама «включает дорожку по умолчанию» и повторно вызывает переключатели;
      // это не выбор пользователя, поэтому запомненное не перезаписываем.
      if (Date.now() - (state.restoredAt || 0) < 2500) return;
      const key = seriesKey();
      if (!key) return;
      try {
        const prefs = readPrefs();
        prefs[key] = Object.assign({}, prefs[key], { [kind]: value });
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        console.log(`[mpv] remembered ${kind}: ${JSON.stringify(value)}`);
      } catch (e) { /* хранилище недоступно: просто не запоминаем */ }
    }

    const rememberAudio = (t) => remember("audio", { lang: t.lang || "", title: t.title || "" });
    const rememberSub = (t) =>
      remember("sub", t ? { lang: t.lang || "", forced: Boolean(t.forced), title: t.title || "" } : { off: true });

    function savedPref(kind) {
      const key = seriesKey();
      const all = key && readPrefs()[key];
      return all && all[kind];
    }

    // id запомненной дорожки среди текущих, либо undefined.
    function savedAudioId(tracks) {
      const pref = savedPref("audio");
      if (!pref) return undefined;
      const sameLang = tracks.filter((t) => (t.lang || "") === pref.lang);
      const found = sameLang.find((t) => (t.title || "") === pref.title) || sameLang[0];
      return found ? found.id : undefined;
    }

    // Субтитры: «выключены» либо дорожка с тем же языком и типом (forced / полные); другой тип не подменяем.
    function savedSubId(tracks) {
      const pref = savedPref("sub");
      if (!pref) return undefined;
      if (pref.off) return "no";
      const same = tracks.filter((t) => (t.lang || "") === pref.lang && Boolean(t.forced) === pref.forced);
      const found = same.find((t) => (t.title || "") === pref.title) || same[0];
      return found ? found.id : undefined;
    }

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
      const audio = [];
      const subs = [];
      const tracks = dropQualityVariants(Array.isArray(list) ? list : []);
      let restoreId;
      if (!state.audioRestored) {
        const audioTracks = tracks.filter((t) => t.type === "audio");
        if (audioTracks.length > 1) {
          state.audioRestored = true;
          restoreId = savedAudioId(audioTracks);
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
          restoreSub = savedSubId(subTracks);
          const current = subTracks.find((t) => t.selected);
          if (restoreSub === "no" ? !current : current && current.id === restoreSub) restoreSub = undefined;
          if (restoreSub !== undefined) {
            state.restoredAt = Date.now();
            api.set("sid", restoreSub);
            console.log(`[mpv] restored subtitle track ${restoreSub}`);
          }
        }
      }
      tracks.forEach((t) => {
        const flags = [t.forced ? "forced" : "", t["hearing-impaired"] ? "SDH" : ""].filter(Boolean).join(", ");
        const language = langName(t.lang);
        // Название, повторяющее язык, не дублируем.
        const title = t.title && t.title.toLowerCase() !== language.toLowerCase() ? t.title : "";
        if (t.type === "audio") {
          const item = {
            index: audio.length, language, label: title,
            extra: { channels: t["demux-channel-count"], fourCC: t.codec },
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
            label: [title || t.codec || "", flags].filter(Boolean).join(" · "),
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

    async function applySubtitle(x, lang) {
      const title = (lang === "ru" ? "RU" : "EN") + " · " + String(x.movieReleaseName || x.subtitleFileName || "OpenSubtitles").slice(0, 80);
      const r = await api.subsLoad(x.url, title, lang);
      if (!r || !r.ok) throw new Error((r && r.error) || "load failed");
      state.onlineSubTitle = title;
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
      if (choice === "off") { api.set("sid", "no"); showToast(ru ? "Субтитры выключены" : "Subtitles off"); return; }
      if (choice === "on") {
        const track = await api.get("track-list").catch(() => null);
        const found = Array.isArray(track) && track.find((t) => t.type === "sub" && t.title === state.onlineSubTitle);
        if (found) { api.set("sid", found.id); showToast(ru ? "Субтитры включены" : "Subtitles on"); }
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
        await applySubtitle(picked, choice);
        showToast(ru ? "Субтитры включены" : "Subtitles on");
      } catch (e) { showToast((ru ? "Не удалось загрузить: " : "Download failed: ") + e.message); }
    }
    el.__subsMenu = openSubsMenu;

    // Авто-режим: нет субтитров на выбранном языке — берём лучшие из найденных.
    async function maybeAutoSubs() {
      const mode = String(L.Storage.get(SUBS_SETTING, "manual"));
      if (mode === "manual" || state.destroyed || state.autoSubsDone) return;
      const lang = mode === "auto_en" ? "en" : "ru";
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
      api.nowPlaying({ title, subtitle: line ? line.textContent : "", duration: Number(state.duration) || 0, canNext, canPrev, artwork }).catch(() => {});
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
    const skip = { segments: [], current: null, done: new Set(), shownFor: null, session: 0 };

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
        console.log(`[tidb] tmdb=${q.id}${q.tv ? ` s${q.season}e${q.episode}` : ""}: сегментов ${list.length} (${list.map((x) => x.type).join(",")})`);
      } catch (e) {
        console.log(`[tidb] запрос не удался: ${e}`);
      }
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
      for (const [name, { property, def }] of Object.entries(SUB_STYLE)) {
        const value = String(L.Storage.get(name, def) || def);
        api.set(property, value);
        if (name === "mpv_sub_box") api.set("sub-back-color", value === "background-box" ? "#B0000000" : "#00000000");
      }
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
        skipReset();
        skipFetch();
        renderHeader();
        // Скорость и задержки mpv помнит между файлами: сбрасываем то, что меняли клавишами.
        if (speedTouched) { api.set("speed", 1); speedTouched = false; }
        if (delaysTouched) { api.set("audio-delay", 0); api.set("sub-delay", 0); delaysTouched = false; }
        applySubtitleStyle();
      }
      state.loaded = false;
      state.error = null;
      state.metadataSent = false;
      state.tracksKnown = false;
      state.tracksTimedOut = false;
      state.levels = [];
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
    el.destroy = () => {
      if (state.destroyed) return;
      state.destroyed = true;
      if (active === el) active = null;
      document.documentElement.classList.remove(CLASS);
      stopSweep();
      stopProfileButton();
      stopSeekButtons();
      closeStatsPanel();
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
        state.loaded = true;
        state.everLoaded = true;
        api.set("mute", state.muted);
        if (state.pendingSeek !== null) api.command(["seek", String(state.pendingSeek), "absolute+exact"]);
        state.pendingSeek = null;
        setTimeout(() => { state.tracksTimedOut = true; announceLoaded(false); }, 1500);
        setTimeout(maybeAutoSubs, 3000);
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
    addSettings(L);
    hideExternalMpv(L);
    installProfileHotkey(L);
    installArrowKeys(L);
    installPlayerKeys(L);
    L.PlayerVideo.registerTube({
      name: "mpv",
      // WebKit не играет, например, MKV; mpv берёт все http(s)/file-источники, пока включён в настройках.
      verify: (src) => mpvEnabled(L) && /^https?:/i.test(String(src)),
      create: (callback) => {
        addStyle();
        const shim = createShim(L);
        active = shim;
        callback(shim);
        return $(shim);
      },
    });
    console.log("[mpv] tube registered");
  });
})();
