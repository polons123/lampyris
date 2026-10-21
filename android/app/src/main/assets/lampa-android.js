(function () {
  if (window.top !== window) return;
  const responses = new Map();
  // На планшете и телефоне вместо экранной клавиатуры Lampa (без латиницы) используется системная; один раз, дальше выбор пользователя.
  try {
    if (!localStorage.getItem('lampyris_keyboard_v1')) {
      if (!__TV__) localStorage.setItem('keyboard_type', 'integrate');
      localStorage.setItem('lampyris_keyboard_v1', 'true');
    }
  } catch (e) { /* хранилище недоступно */ }
  window.AndroidJS = {
    appVersion: () => 'Lampyris-__VERSION__-28',
    // Версия протокола Android, а не версия APK. На планшете нет каналов Android TV.
    updateChannel: () => {},
    voiceStart: () => Lampa.Noty.show(Lampa.Storage.get('language','ru')==='ru'?'Используйте голосовой ввод экранной клавиатуры':'Use voice typing on the on-screen keyboard'),
    // Совместимость с протоколом Lampa. Запрос выполняет сам WebView: сохраняются CORS и маршрутизация приложения.
    httpReq: (data, index) => {
      let params;
      try { params=JSON.parse(data); } catch(e) { return; }
      const uri=new URL(params.url,location.href);
      if(!/^https?:$/.test(uri.protocol)) return;
      const done=(text,type)=>{responses.set(index,text);if(window.Lampa && Lampa.Android)Lampa.Android.httpCall(index,type);};
      window.$.ajax({
        url:uri.href,type:params.type||params.method||'GET',data:params.data,
        headers:params.headers,contentType:params.contentType,dataType:'text',
        processData:params.processData!==false,timeout:Math.min(60000,params.timeout||30000),
        success:text=>done(text,'complite'),error:()=>done(JSON.stringify({responseText:'Network request failed'}),'error')
      });
    },
    getResp: index => { const text=responses.get(index)||''; responses.delete(index); return text; },
    openPlayer: (url, data) => {
      let item={};try{item=JSON.parse(data||'{}')}catch(e){}
      item.url=url;item.launch_player='inner';
      Lampa.Player.play(item);if(Array.isArray(item.playlist))Lampa.Player.playlist(item.playlist);
    },
    clearDefaultPlayer: () => {Lampa.Storage.set('player','inner');Lampa.Storage.set('player_torrent','inner');Lampa.Storage.set('player_iptv','inner');},
    exit: () => window.history.back(),
    openYoutube: url => window.open(url,'_blank'),
    openTorrentLink: () => Lampa.Noty.show(Lampa.Storage.get('language','ru')==='ru'?'Выберите файл через TorrServer':'Select a file through TorrServer')
  };
})();
