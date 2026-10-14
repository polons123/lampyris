// Оконные функции страницы для Windows. Внедряется в главный кадр всегда (в отличие от шима mpv).
// 1) Полноэкранный режим: WebView2 без хоста показывал бы элемент только в границах своего окна, поэтому
//    requestFullscreen/exitFullscreen/fullscreenElement подменены и переключают окно приложения.
// 2) Клавиши окна: F11 и Alt+Enter (полный экран), Esc (выход из полного экрана), F5 и Ctrl+R (перезагрузка),
//    Ctrl+, (адрес сервера).
// 3) Консоль страницы в журнал при включённом подробном журнале (флаг window.__lv).
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
