// Оконные функции страницы для Windows. Внедряется в главный кадр всегда (в отличие от шима mpv).
// 1) Полноэкранный режим: WebView2 без хоста показывал бы элемент только в границах своего окна, поэтому
//    requestFullscreen/exitFullscreen/fullscreenElement подменены и переключают окно приложения.
// 2) Клавиши окна: F11 и Alt+Enter (полный экран), Esc (выход из полного экрана), F5 и Ctrl+R (перезагрузка),
//    Ctrl+, (адрес сервера), Ctrl+O (открыть видео с диска).
// 3) Картинка в картинке: у Lampa кнопка PiP рассчитана на элемент video, а видео играет mpv, поэтому кнопка
//    переключает режим маленького окна поверх других окон.
// 4) Консоль страницы в журнал при включённом подробном журнале (флаг window.__lv).
(function () {
  if (window.__lampyrisWindow) return;
  window.__lampyrisWindow = true;
  function send(m, a) { try { window.ipc.postMessage(JSON.stringify({ m: m, a: a })); } catch (e) {} }

  var fsEl = null, target = null;
  function fire() {
    var names = ["fullscreenchange", "webkitfullscreenchange"];
    names.forEach(function (n) {
      var el = fsEl || target;
      document.dispatchEvent(new Event(n));
      if (el && el !== document) el.dispatchEvent(new Event(n, { bubbles: true }));
    });
  }
  function def(proto, name, getter) { try { Object.defineProperty(proto, name, { get: getter, configurable: true }); } catch (e) {} }
  function enter(el) { target = el || document.documentElement; send("window", ["fullscreen", true]); return Promise.resolve(); }
  function exit() { send("window", ["fullscreen", false]); return Promise.resolve(); }
  Element.prototype.requestFullscreen = function () { return enter(this); };
  Element.prototype.webkitRequestFullscreen = Element.prototype.requestFullscreen;
  Element.prototype.webkitRequestFullScreen = Element.prototype.requestFullscreen;
  Document.prototype.exitFullscreen = exit;
  Document.prototype.webkitExitFullscreen = exit;
  Document.prototype.webkitCancelFullScreen = exit;
  def(Document.prototype, "fullscreenElement", function () { return fsEl; });
  def(Document.prototype, "webkitFullscreenElement", function () { return fsEl; });
  def(Document.prototype, "webkitCurrentFullScreenElement", function () { return fsEl; });
  def(Document.prototype, "fullscreenEnabled", function () { return true; });
  def(Document.prototype, "webkitFullscreenEnabled", function () { return true; });
  def(Document.prototype, "webkitIsFullScreen", function () { return !!fsEl; });
  // Ответ приложения: окно перешло в полный экран или вышло из него (в том числе при запуске).
  window.__setFullscreen = function (on) {
    var was = !!fsEl;
    fsEl = on ? (target || document.documentElement) : null;
    if (was !== !!fsEl) fire();
    if (!on) target = null;
  };

  window.addEventListener("keydown", function (e) {
    var k = e.key, stop = function () { e.preventDefault(); e.stopImmediatePropagation(); };
    if (k === "F11" || (e.altKey && k === "Enter")) { stop(); send("window", ["fullscreen", "toggle"]); }
    else if (k === "Escape" && fsEl && !e.altKey && !e.ctrlKey) { stop(); send("window", ["fullscreen", false]); }
    else if (k === "F5" || (e.ctrlKey && !e.altKey && (k === "r" || k === "R"))) { stop(); send("window", ["reload"]); }
    else if (e.ctrlKey && !e.altKey && k === ",") { stop(); send("window", ["changeServer"]); }
    else if (e.ctrlKey && !e.altKey && (k === "o" || k === "O")) { stop(); send("window", ["openVideo"]); }
  }, true);

  var pipOn = false;
  window.__setPip = function (on) { pipOn = !!on; document.documentElement.classList.toggle("lampyris-pip", pipOn); };
  function togglePip() { send("window", ["pip", !pipOn]); }
  // Кнопку PiP плеера Lampa подключает mpvTube.js через эту функцию.
  window.__lampyrisPip = togglePip;
  // В PiP у окна нет рамки: двигаем его за любое место страницы.
  // Окно двигается, только когда мышь потащили (чистый клик остаётся кнопкам плеера, в том числе выходу из PiP).
  var dragFrom = null;
  // Элементы управления (перемотка, меню, поля) окно не тащат: у них своё перетаскивание.
  var CONTROLS = ".player-panel, .selectbox, .settings, .modal, .keyboard-input, input, textarea, select, button, a";
  // У окна без рамки края для растягивания рисуем сами: рядом с краем курсор меняется, нажатие начинает растягивание.
  var EDGE = 8, CURSORS = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };
  function edgeAt(e) {
    var d = (e.clientY < EDGE ? "n" : e.clientY >= innerHeight - EDGE ? "s" : "") + (e.clientX < EDGE ? "w" : e.clientX >= innerWidth - EDGE ? "e" : "");
    return d || null;
  }
  window.addEventListener("mousemove", function (e) {
    if (!pipOn) return;
    var d = edgeAt(e);
    document.documentElement.style.cursor = d ? CURSORS[d] : "";
  }, true);
  window.addEventListener("mousedown", function (e) {
    if (pipOn && e.button === 0) {
      var d = edgeAt(e);
      if (d) { e.preventDefault(); e.stopImmediatePropagation(); dragFrom = null; send("window", ["resizeWindow", d]); return; }
    }
    var t = e.target && e.target.closest ? e.target : null;
    dragFrom = pipOn && e.button === 0 && !(t && t.closest(CONTROLS)) ? [e.screenX, e.screenY] : null;
  }, true);
  window.addEventListener("mouseup", function () { dragFrom = null; }, true);
  window.addEventListener("mousemove", function (e) {
    if (!dragFrom || (e.buttons & 1) === 0) { dragFrom = null; return; }
    if (Math.abs(e.screenX - dragFrom[0]) + Math.abs(e.screenY - dragFrom[1]) > 6) { dragFrom = null; send("window", ["dragWindow"]); }
  }, true);
  // Esc или закрытие плеера возвращают обычное окно.
  window.addEventListener("keydown", function (e) {
    if (pipOn && e.key === "Escape" && !e.altKey && !e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); send("window", ["pip", false]); }
  }, true);

  ["log", "warn", "error"].forEach(function (l) {
    var o = console[l];
    console[l] = function () {
      if (window.__lv) { send("log", [l, Array.prototype.map.call(arguments, String).join(" ")]); }
      return o.apply(console, arguments);
    };
  });
  window.addEventListener("error", function (e) { if (window.__lv) send("log", ["uncaught", e.message + " @" + e.filename + ":" + e.lineno]); });
  window.addEventListener("unhandledrejection", function (e) { if (window.__lv) send("log", ["rejection", String(e.reason)]); });
})();
