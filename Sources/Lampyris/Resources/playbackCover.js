// Экран открытия видео: пока плеер подключается, поверх него показывается фон со страницы
// карточки (тот же, что виден на ней), название и скорость загрузки. Снимается по первому кадру.
(function () {
  if (window.desktopPlaybackCover) return;

  const call = (m, ...a) => {
    const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mpv;
    return h ? h.postMessage({ m, a }) : Promise.resolve(null);
  };

  function whenReady(fn) {
    const t = setInterval(() => {
      const L = window.Lampa;
      if (L && L.Player && L.Player.listener && L.PlayerVideo && L.PlayerVideo.listener && L.Activity && L.Listener) {
        clearInterval(t);
        fn(L);
      }
    }, 500);
  }

  whenReady((L) => {
    let state = null;
    let timer = null;
    let request = null;
    let generation = 0;
    let mainCard = null;
    const fullCards = new Map();

    const speed = (bytes) =>
      Number.isFinite(bytes) && bytes >= 0 ? ((bytes * 8) / 1000000).toFixed(2) + " Мбит/с" : "—";

    function cardKey(card) {
      if (!card || card.id === undefined || card.id === null) return null;
      return (card.first_air_date || (card.name && !card.title) ? "tv" : "movie") + ":" + card.id;
    }

    // Запоминаем карточку вместе с фоном, который виден на её странице: у плагинов и дорожек
    // бывают только кадры файла, а не картинка карточки.
    function captureFullCard(card, root) {
      if (!card) return;
      const image = root && root.querySelector && root.querySelector(".full-start__background");
      const snapshot = Object.assign({}, card);
      const visible = image && (image.currentSrc || image.src);
      if (visible) snapshot.desktopBackdrop = visible;
      mainCard = snapshot;
      const key = cardKey(card);
      if (key) {
        fullCards.delete(key);
        fullCards.set(key, snapshot);
        if (fullCards.size > 20) fullCards.delete(fullCards.keys().next().value);
      }
    }

    function captureActiveFull() {
      const activity = L.Activity.active && L.Activity.active();
      if (!activity || activity.component !== "full" || !activity.card) return;
      const visible = Array.from(document.querySelectorAll(".full-start__background")).find((el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden";
      });
      captureFullCard(activity.card, { querySelector: () => visible });
    }

    function rememberCard(data) {
      data = data || {};
      captureActiveFull();
      const activity = L.Activity.active && L.Activity.active();
      const candidates = [activity && activity.card, data.card, data.movie].filter(Boolean);
      const cached = candidates.map(cardKey).map((k) => fullCards.get(k)).find(Boolean);
      if (cached) { mainCard = cached; return; }
      const identified = candidates.find((c) => cardKey(c));
      if (mainCard && (!identified || cardKey(identified) === cardKey(mainCard))) return;
      const card = identified || candidates[0];
      if (card) mainCard = Object.assign({}, card);
    }

    function content(data) {
      if (!mainCard) rememberCard(data);
      const card = mainCard || {};
      let image = card.desktopBackdrop || card.backdrop_path || card.background_image || card.poster_path || card.img || card.poster;
      if (image && !/^(https?:)?\/\//i.test(image) && !/^(data|blob):/i.test(image)) {
        try { image = L.Api.img(image, "w1280"); } catch (e) { image = ""; }
      }
      return {
        image: image || data.img || data.thumbnail || "",
        title: card.title || card.name || data.first_title || data.title || "Открываем видео",
      };
    }

    function hide() {
      generation++;
      clearInterval(timer);
      timer = null;
      if (request && request.clear) request.clear();
      request = null;
      if (state) state.node.remove();
      state = null;
    }

    function renderStats(bytes, peers) {
      if (!state) return;
      state.stats.textContent = "Скорость: " + speed(bytes);
      if (state.data.torrent_hash) {
        const active = peers && Number.isFinite(peers.active_peers) ? peers.active_peers : "—";
        const total = peers && Number.isFinite(peers.total_peers) ? peers.total_peers : "—";
        state.stats.textContent += " · Пиры: " + active + "/" + total;
      }
    }

    async function update() {
      const current = state;
      if (!current || current.busy) return;
      current.busy = true;
      const id = generation;
      try {
        if (current.data.torrent_hash && L.Torserver && L.Torserver.url && L.Reguest) {
          request = request || new L.Reguest();
          request.timeout(2500);
          const stats = await new Promise((resolve) => {
            request.silent(L.Torserver.url() + "/torrents", resolve, () => resolve(null),
              JSON.stringify({ action: "get", hash: current.data.torrent_hash }));
          });
          if (state === current && generation === id) renderStats(stats && stats.download_speed, stats);
        } else if (current.mpv) {
          const cache = await call("get", "demuxer-cache-state");
          if (state === current && generation === id) renderStats(cache && cache["raw-input-rate"]);
        } else {
          // Сервер может не отдавать размеры ресурсов; скорость не выдумываем.
          const entries = performance.getEntriesByType("resource").filter((e) =>
            e.startTime >= current.started && /\.(ts|m4s|aac|mp4)(?:[?:]|$)/i.test(e.name) && e.responseEnd > 0);
          const bytes = entries.reduce((sum, e) => sum + (e.transferSize || 0), 0);
          const elapsed = (performance.now() - current.started) / 1000;
          renderStats(bytes > 0 && elapsed > 0 ? bytes / elapsed : undefined);
        }
      } catch (e) {
        if (state === current) renderStats(undefined);
      } finally {
        current.busy = false;
      }
    }

    function show(data, options) {
      data = data || {};
      options = options || {};
      if (state && state.data === data) { state.mpv = options.mpv || state.mpv; return; }
      hide();
      const c = content(data);
      const node = document.createElement("div");
      node.className = "desktop-playback-cover";
      if (c.image) {
        const bg = document.createElement("img");
        bg.className = "desktop-playback-cover__background";
        bg.src = c.image;
        bg.alt = "";
        node.appendChild(bg);
        const poster = document.createElement("img");
        poster.className = "desktop-playback-cover__poster";
        poster.src = c.image;
        poster.alt = c.title;
        node.appendChild(poster);
      }
      const panel = document.createElement("div");
      panel.className = "desktop-playback-cover__panel";
      const info = document.createElement("div");
      const title = document.createElement("div");
      title.className = "desktop-playback-cover__title";
      title.textContent = c.title;
      const loading = document.createElement("div");
      loading.className = "desktop-playback-cover__loading";
      loading.textContent = "Открываем видео…";
      const stats = document.createElement("div");
      stats.className = "desktop-playback-cover__stats";
      // appendChild, а не append(a, b, c): Lampa подменяет Element.append, и он берёт только первый аргумент.
      for (const child of [title, loading, stats]) info.appendChild(child);
      panel.appendChild(info);
      node.appendChild(panel);
      node.addEventListener("click", () => { hide(); if (L.Player.close) L.Player.close(); });
      document.body.appendChild(node);
      state = { data, node, stats, mpv: Boolean(options.mpv), started: performance.now(), busy: false };
      renderStats(undefined);
      timer = setInterval(() => void update(), 1000);
      void update();
    }

    // z-index выше плеера (50), но ниже диалогов Lampa (55): вопрос «Продолжить просмотр?»
    // появляется во время загрузки и не должен прятаться под обложкой.
    const style = document.createElement("style");
    style.textContent = `
      .desktop-playback-cover { position:fixed; inset:0; z-index:52; overflow:hidden; background:#0b0d12; color:#fff; }
      .desktop-playback-cover img { position:absolute; inset:0; width:100%; height:100%; }
      .desktop-playback-cover__background { object-fit:cover; filter:blur(24px); opacity:.35; transform:scale(1.08); }
      .desktop-playback-cover__poster { object-fit:cover; }
      .desktop-playback-cover::after { content:""; position:absolute; inset:0;
        background:radial-gradient(ellipse at center,rgba(0,0,0,.72),rgba(0,0,0,.4) 75%); pointer-events:none; }
      .desktop-playback-cover__panel { position:absolute; inset:0; z-index:1; display:flex; align-items:center; justify-content:center;
        padding:0 8%; text-align:center; text-shadow:0 2px 8px rgba(0,0,0,.8); }
      .desktop-playback-cover__panel > div { min-width:0; }
      .desktop-playback-cover__title { overflow-wrap:anywhere; font-size:2.4em; font-weight:700; margin-bottom:.5em; }
      .desktop-playback-cover__loading { opacity:.8; margin-bottom:1em; }
      .desktop-playback-cover__loading::before { content:""; display:inline-block; width:1em; height:1em; margin-right:.6em;
        vertical-align:-.15em; border:2px solid #555; border-top-color:#fff; border-radius:50%; animation:desktop-playback-spin .8s linear infinite; }
      .desktop-playback-cover__stats { font-variant-numeric:tabular-nums; opacity:.7; }
      @keyframes desktop-playback-spin { to { transform:rotate(360deg); } }`;
    document.head.appendChild(style);

    window.desktopPlaybackCover = { show, hide };

    // Вопрос «Продолжить просмотр с 00:08:07?»: Lampa показывает его боковой панелью «Действие».
    // Стили действуют только пока диалог открыт (body.selectbox--open): иначе панель, которую Lampa уводит за край
    // экрана через transform, осталась бы на месте и после выбора. Здесь он оформляется как две капсулы в один ряд под названием на обложке («Продолжить» без времени, «Сначала»).
    const resumeStyle = document.createElement("style");
    resumeStyle.textContent = `
      body.selectbox--open .selectbox.resume-ask .selectbox__layer { background:transparent !important; }
      body.selectbox--open .selectbox.resume-ask .selectbox__content { position:fixed !important; left:0 !important; right:0 !important; width:auto !important;
        top:var(--resume-top,62%) !important; bottom:auto !important; height:auto !important; max-height:none !important;
        background:transparent !important; box-shadow:none !important; border-radius:0 !important;
        -webkit-backdrop-filter:none !important; backdrop-filter:none !important; transform:none !important; }
      body.selectbox--open .selectbox.resume-ask .selectbox__head { display:none !important; }
      body.selectbox--open .selectbox.resume-ask .selectbox__body, body.selectbox--open .selectbox.resume-ask .scroll, body.selectbox--open .selectbox.resume-ask .scroll__content,
      body.selectbox--open .selectbox.resume-ask .scroll__body { height:auto !important; max-height:none !important; overflow:visible !important;
        -webkit-mask-image:none !important; mask-image:none !important; transform:none !important; padding:0 !important; }
      body.selectbox--open .selectbox.resume-ask .scroll__body { display:flex !important; flex-direction:row; justify-content:center; align-items:center; gap:.9em; }
      body.selectbox--open .selectbox.resume-ask .selectbox-item { margin:0 !important; width:auto !important; padding:.65em 1.8em !important; border-radius:999px !important;
        background:rgba(40,40,46,.62); -webkit-backdrop-filter:blur(30px) saturate(180%); backdrop-filter:blur(30px) saturate(180%);
        color:#fff; font-weight:600; text-align:center; white-space:nowrap; transition:transform .2s, background-color .15s; }
      body.selectbox--open .selectbox.resume-ask .selectbox-item__title { font-size:1.15em !important; font-weight:600 !important; }
      body.selectbox--open .selectbox.resume-ask .selectbox-item.focus { background:#fff !important; color:#000 !important; transform:scale(1.06) !important; }`;
    document.head.appendChild(resumeStyle);

    const RESUME_LABELS = { ru: ["Продолжить", "Сначала"], en: ["Continue", "From start"] };
    const isResumeAsk = (params) => Boolean(params && Array.isArray(params.items) && params.items.length === 2 &&
      params.items[0] && params.items[0].yes === true && /\d{1,2}:\d{2}/.test(String(params.items[0].title || "")));
    if (L.Select && typeof L.Select.show === "function") {
      const originalShow = L.Select.show;
      L.Select.show = function (params) {
        const resume = isResumeAsk(params);
        if (resume) {
          let lang = "ru";
          try { lang = String(L.Storage.get("language", "ru") || "ru"); } catch (e) {}
          const labels = RESUME_LABELS[lang] || RESUME_LABELS.en;
          params.items[0].title = labels[0];
          params.items[1].title = labels[1];
        }
        const result = originalShow.apply(this, arguments);
        try {
          const box = document.querySelector(".selectbox");
          if (box) {
            box.classList.toggle("resume-ask", resume);
            if (resume) {
              // Ряд кнопок сразу под текстом обложки; без обложки — чуть ниже середины.
              const info = document.querySelector(".desktop-playback-cover__panel > div");
              const rect = info && info.getBoundingClientRect();
              box.style.setProperty("--resume-top", rect && rect.height ? Math.round(rect.bottom + 28) + "px" : "62%");
              console.log("[cover] resume ask: top=" + box.style.getPropertyValue("--resume-top") +
                " items=" + box.querySelectorAll(".selectbox-item").length);
            }
          }
        } catch (e) { console.log("[cover] resume ask style failed: " + e); }
        return result;
      };
      // Кнопки исчезают вместе с диалогом: после выбора (или «назад») пометка снимается.
      if (L.Select.listener && L.Select.listener.follow) {
        L.Select.listener.follow("hide", () => {
          const box = document.querySelector(".selectbox");
          if (box) box.classList.remove("resume-ask");
        });
      }
    }

    L.Listener.follow("full", (event) => {
      if (event.type !== "start" && event.type !== "complite") return;
      captureFullCard((event.data && event.data.movie) || (event.object && event.object.card), event.body && (event.body.get ? event.body.get(0) : event.body[0] || event.body));
    });
    const originalPush = L.Activity.push;
    if (typeof originalPush === "function") {
      L.Activity.push = function () { captureActiveFull(); return originalPush.apply(this, arguments); };
    }
    captureActiveFull();

    L.Player.listener.follow("create", (event) => rememberCard(event.data));
    L.Player.listener.follow("start", (data) => {
      if (!mainCard) rememberCard(data);
      // Вариант mpv определяется тюбом, но к моменту запуска он известен: настройка и источник.
      const useMpv = window.desktopMpvActive ? window.desktopMpvActive() : false;
      show(data, { mpv: useMpv });
    });
    L.Player.listener.follow("destroy", hide);
    L.Player.listener.follow("external", hide);
    L.PlayerVideo.listener.follow("error", hide);
    // Встроенный <video> (mpv выключен): снимаем обложку по первому кадру.
    L.PlayerVideo.listener.follow("loadeddata", () => {
      const video = L.PlayerVideo.video && L.PlayerVideo.video();
      if (!video || video.tagName !== "VIDEO") return;
      const opening = state;
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => { if (state === opening && opening && !opening.mpv) hide(); });
      else if (!(state && state.mpv)) hide();
    });
  });
})();
