(function () {
  let port, seq = 0;
  const pending = new Map();
  window.addEventListener('message', function (event) {
    // Android postWebMessage: source=null, origin=""; обычные сообщения фреймов не проходят.
    if (event.source !== null || event.origin !== '' || event.data !== '__NATIVE_HANDSHAKE__' || event.ports.length !== 1 || port) return;
    port = event.ports[0];
    port.onmessage = function (event) {
      const msg = JSON.parse(event.data);
      if (msg.event) { if (msg.event === "remote") { if (window.__mpvRemote) window.__mpvRemote(msg.command); } else if (window.__mpvEvent) window.__mpvEvent(msg); return; }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.value); else p.reject(new Error(msg.error));
    };
    window.webkit = window.webkit || {};
    window.webkit.messageHandlers = window.webkit.messageHandlers || {};
    window.webkit.messageHandlers.mpv = { postMessage: function (msg) {
      return new Promise(function (resolve, reject) {
        const id = ++seq;
        const timer = setTimeout(function () { pending.delete(id); reject(new Error('Request timed out')); }, 15000);
        pending.set(id, {resolve, reject, timer});
        port.postMessage(JSON.stringify({id, m: msg.m, a: msg.a}));
      });
    }};
    window.dispatchEvent(new Event('lampyris-ready'));
  });
})();
