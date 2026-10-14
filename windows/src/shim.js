// Шим для Windows: mpvTube.js и playbackCover.js (общие с macOS) обращаются к
// webkit.messageHandlers.mpv.postMessage({m, a}) и ждут промис. Здесь тот же интерфейс
// поверх window.ipc (WebView2); ответы приходят через window.__mpvReply.
(function () {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mpv) return;
  var pending = {}, seq = 0;
  window.__mpvReply = function (id, ok, payload) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    if (ok) p.resolve(payload); else p.reject(new Error(payload));
  };
  var handler = {
    postMessage: function (msg) {
      return new Promise(function (resolve, reject) {
        var id = ++seq;
        pending[id] = { resolve: resolve, reject: reject };
        window.ipc.postMessage(JSON.stringify({ id: id, m: msg.m, a: msg.a }));
      });
    },
  };
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = window.webkit.messageHandlers || {};
  window.webkit.messageHandlers.mpv = handler;
})();
