(function () {
  const style = document.createElement('style');
  style.textContent = '[data-infuse-launch],.is--infuse,[data-name="infuse_launch_mode"],[data-name="player_nw_path"]{display:none!important}.player-panel__mpvhelp{display:none!important}.mpv-pick__item,.mpv-pic__row{min-height:48px}.mpv-pick__list{overflow-y:auto;max-height:65vh;-webkit-overflow-scrolling:touch}.mpv-pick__hint{display:none}.mpv-pic__track{min-height:24px}.player-panel .button{min-width:44px;min-height:44px}';
  document.head.appendChild(style);
  const timer = setInterval(function () {
    const L = window.Lampa;
    if (!L || !L.Storage || !L.PlayerVideo) return;
    clearInterval(timer);
    L.Storage.set('player', 'inner');
    L.Storage.set('player_torrent', 'inner');
    L.Storage.set('internal_torrclient', true);
    L.Storage.set('player_iptv', 'inner');
    if (L.Storage.get('lampyris_features_v1', false) !== true) { L.Storage.set('mpv_skip_mode', 'button'); L.Storage.set('lampyris_features_v1', true); }
    if (!L.Storage.get('mpv_online_subs', '')) L.Storage.set('mpv_online_subs', 'manual');
    L.Storage.set('mpv_profile', L.Storage.get('mpv_profile', 'fast'));
  }, 500);
})();

// Вертикальные жесты на свободной части видео: слева яркость экрана, справа громкость.
(function () {
  let gesture, hideTimer;
  const bridge = (m, ...a) => window.webkit.messageHandlers.mpv.postMessage({m, a});
  const blocked = '.button,.player-panel,.player-panel__seekbtn,.mpv-pick,.mpv-pic,.mpv-conf,.selectbox,.modal,.mpv-skip';
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;top:42%;left:50%;transform:translate(-50%,-50%);z-index:100000;background:rgba(0,0,0,.75);color:white;padding:16px 24px;border-radius:12px;font:24px sans-serif;pointer-events:none;display:none';
  document.body.appendChild(hud);
  const show = (kind, value) => { const ru = !window.Lampa || Lampa.Storage.get('language','ru') === 'ru'; hud.textContent = (kind === 'volume' ? (ru ? 'Громкость' : 'Volume') : (ru ? 'Яркость' : 'Brightness')) + ' ' + Math.round(value * 100) + '%'; hud.style.display = 'block'; clearTimeout(hideTimer); hideTimer = setTimeout(() => { hud.style.display = 'none'; }, 900); };
  const adjust = () => {
    const g = gesture; if (!g || !g.values || !g.moving) return;
    const value = Math.min(1, Math.max(g.kind === 'brightness' ? .02 : 0, g.values[g.kind] + (g.y - g.lastY) / (innerHeight * .65)));
    show(g.kind, value);
    if (g.busy) { g.pending = true; return; }
    g.busy = true;
    bridge('gestureSet', g.kind, value).then(v => { if (gesture === g) show(g.kind, v[g.kind]); }).catch(() => {}).finally(() => { g.busy = false; if (gesture === g && g.pending) { g.pending = false; adjust(); } });
  };
  document.addEventListener('touchstart', e => {
    gesture = null;
    if (e.touches.length !== 1 || !document.documentElement.classList.contains('mpv-active') || e.target.closest(blocked) || document.querySelector('.mpv-pick,.mpv-conf,.mpv-pic') || document.body.classList.contains('selectbox--open')) return;
    const t = e.touches[0]; if (t.clientX > innerWidth * .35 && t.clientX < innerWidth * .65) return;
    const g = gesture = {kind:t.clientX < innerWidth / 2 ? 'brightness':'volume', x:t.clientX, y:t.clientY, lastY:t.clientY};
    bridge('gestureGet').then(values => { if (gesture === g) { g.values = values; adjust(); } }).catch(() => { if (gesture === g) gesture = null; });
  }, {capture:true, passive:true});
  document.addEventListener('touchmove', e => {
    const g = gesture; if (!g) return;
    if (e.touches.length !== 1 || !document.documentElement.classList.contains('mpv-active')) { gesture = null; return; }
    const t = e.touches[0]; g.lastY = t.clientY;
    if (!g.moving && Math.abs(t.clientX - g.x) > Math.abs(t.clientY - g.y)) { gesture = null; return; }
    if (Math.abs(t.clientY - g.y) < 12 && !g.moving) return;
    g.moving = true; e.preventDefault(); e.stopImmediatePropagation(); adjust();
  }, {capture:true, passive:false});
  const end = e => { if (gesture && gesture.moving) { e.preventDefault(); e.stopImmediatePropagation(); adjust(); } gesture = null; };
  document.addEventListener('touchend', end, {capture:true, passive:false});
  document.addEventListener('touchcancel', () => { gesture = null; }, true);
})();

(function () {
  const style=document.createElement('style');
  style.textContent = `
    .full-start__button.view--online.stv-pill.focus,
    .full-start__button.view--online.stv-pill:focus,
    .full-start__button.view--online.stv-pill:hover {background:#fff!important;color:#15151b!important}
    .full-start__button.view--online.stv-pill.focus span,
    .full-start__button.view--online.stv-pill:focus span,
    .full-start__button.view--online.stv-pill:hover span {color:#15151b!important}
    .player-panel__mpvinfo b,.player-panel__mpvpicture b {font:700 1.1em sans-serif;pointer-events:none}
    .mpv-statpanel {pointer-events:auto!important;cursor:pointer;box-sizing:border-box;max-width:94vw;min-width:0!important;max-height:85vh;overflow-y:auto}
    .mpv-pic {align-items:center!important;padding:1em!important;box-sizing:border-box}
    .mpv-pic .mpv-pick__box {width:min(36em,94vw)!important;max-height:90vh;overflow-y:auto;position:relative}
    .mpv-pic__row {grid-template-columns:minmax(0,1.6fr) minmax(5em,1fr) 2.9em!important}
    .mpv-pic__row > span:first-child {white-space:normal!important;overflow:visible!important}
    .mpv-pic__track:before {content:'';position:absolute;inset:-18px 0}
    .mpv-pic__switch {min-height:24px}
    .mpv-pic .mpv-pick__title {padding-right:2em}
    .mpv-pic-close {position:absolute;right:12px;top:12px;width:44px;height:44px;border:0;border-radius:50%;background:#444;color:white;font:28px sans-serif;z-index:2}
  `;
  document.head.appendChild(style);
  new MutationObserver(() => {
    const box=document.querySelector('.mpv-pic .mpv-pick__box');
    if(!box||box.querySelector('.mpv-pic-close'))return;
    const close=document.createElement('button');close.className='mpv-pic-close';close.textContent='×';close.setAttribute('aria-label',window.Lampa&&Lampa.Storage.get('language','ru')==='ru'?'Закрыть':'Close');
    close.onclick=()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));box.appendChild(close);
  }).observe(document.body,{childList:true,subtree:true});
})();

(function () {
  const style=document.createElement('style');
  style.textContent = '.mpv-pic__switch{height:30px!important;min-height:30px!important;align-self:center;box-sizing:border-box}.mpv-pic__dot{top:50%!important;transform:translateY(-50%);margin-top:0!important}.mpv-pic__row{align-items:center!important}.mpv-pic__row>.mpv-pic__switch{justify-self:center!important;width:52px!important}.mpv-pic__dot{width:24px!important;height:24px!important;left:3px!important}.mpv-pic__switch.on .mpv-pic__dot{left:calc(100% - 27px)!important}';
  document.head.appendChild(style);
})();
