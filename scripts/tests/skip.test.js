// Выполняется scripts/test-js.sh в JavaScriptCore и android/tests/skip-test.mjs в Node.
// Используем функции из исходника, чтобы тест проверял код приложения, а не его копию.
(function () {
  const source = readFile("Sources/Lampyris/Resources/mpvTube.js");
  const start = source.indexOf("    function skipEnd(seg) {");
  const end = source.indexOf("    // Вид субтитров", start);
  if (start < 0 || end < 0) throw new Error("не найден код пропуска");
  let mode, state, skip, button, messages, jumps;
  const el = {};
  Object.defineProperty(el, "currentTime", { set: (t) => jumps.push(t) });
  const SKIP_SETTING = "skip";
  const SKIP_LABELS = { intro: ["intro"], recap: ["recap"], credits: ["credits"], preview: ["preview"] };
  const L = { Storage: { get: () => mode }, Lang: { translate: (x) => x } };
  const hideSkipButton = () => { button = null; };
  const showSkipButton = (label, click) => { button = { label, click }; };
  const showToast = (text) => messages.push(text);
  const ruLang = () => true;
  // Прямой eval даёт исходным функциям доступ к подставным состоянию и мосту.
  eval(source.slice(start, end) + "\nel.tick = skipTick;");
  function reset(m, type, endTime) {
    mode = m; state = { duration: 3300 };
    skip = { segments: [{ type, start: 10, end: endTime }], current: null, done: new Set(), shownFor: null };
    button = null; messages = []; jumps = [];
  }
  function check(ok, name) { if (!ok) throw new Error(name); }
  for (const type of ["intro", "recap", "credits"]) {
    reset("auto", type, 50);
    el.tick(10);
    check(jumps.length === 1 && jumps[0] === 50 && !button, "автопропуск " + type);
    check(messages[0] === "app_settings_mpv_skipped_" + type, "сообщение " + type);
    el.tick(50); el.tick(9); el.tick(10);
    check(jumps.length === 2, "повторный автопропуск " + type);
  }
  reset("auto", "preview", 50); el.tick(10);
  check(!jumps.length && button.label === "preview", "анонс остаётся кнопкой");
  for (const type of ["intro", "recap", "credits", "preview"]) {
    reset("button", type, 50); el.tick(10);
    check(button.label === type && !jumps.length, "ручной режим " + type);
    el.tick(26); el.tick(49.9);
    check(button && button.label === type, "кнопка до конца сегмента, без таймера " + type);
    el.tick(50); check(!button, "кнопка скрыта после сегмента " + type);
    el.tick(10); check(button, "возвращение показывает кнопку " + type);
    el.__skipNow(); check(jumps.length === 1 && jumps[0] === 50 && !button, "клавиша N " + type);
    el.__skipNow(); check(jumps.length === 1, "N не повторяет уже выполненный пропуск " + type);
    el.tick(50); el.tick(10); check(button, "кнопка после пропуска и возврата " + type);
    button.click(); check(jumps.length === 2, "нажатие повторной кнопки " + type);
  }
  reset("auto", "credits", null); el.tick(10);
  check(jumps[0] === 3299.5, "открытые титры до конца видео");
  reset("off", "intro", 50); el.tick(10);
  check(!button && !jumps.length, "выключенный режим");

  // Настоящие функции кнопки: истечение времени само по себе больше не скрывает её.
  const uiStart = source.indexOf("  function showSkipButton(text, onClick) {");
  const uiEnd = source.indexOf("  // Общее окно выбора", uiStart);
  const timers = [];
  const nodes = new Set();
  let ui = null;
  const document = {
    querySelector: () => ui,
    createElement: () => ({ classList: { add: (c) => nodes.add(c), remove: (c) => nodes.delete(c), contains: (c) => nodes.has(c) }, appendChild: () => {}, remove: () => { ui = null; } }),
    body: { appendChild: (node) => { ui = node; } },
  };
  const addUiStyle = () => {};
  const requestAnimationFrame = (fn) => fn();
  const setTimeout = (fn) => { timers.push(fn); };
  const uiAPI = new Function("document", "addUiStyle", "requestAnimationFrame", "setTimeout", source.slice(uiStart, uiEnd) + "\nreturn {showSkipButton, hideSkipButton};")(document, addUiStyle, requestAnimationFrame, setTimeout);
  uiAPI.showSkipButton("intro", () => {});
  check(nodes.has("is-shown") && timers.length === 0, "у кнопки нет таймера скрытия");
  uiAPI.hideSkipButton(); timers.forEach((fn) => fn());
  check(!ui, "кнопка удаляется после явного скрытия");
})();
