package io.github.polons123.lampyris;

import android.app.*;
import android.os.*;
import android.graphics.Color;
import android.net.Uri;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import android.media.*;
import org.json.*;
import java.util.*;
import java.nio.charset.StandardCharsets;
import is.xyz.mpv.MPVLib;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.ScriptHandler;

public class MainActivity extends Activity implements SurfaceHolder.Callback, MPVLib.Listener {
    private WebView web;
    private SurfaceView video;
    private FrameLayout root;
    private Button settingsButton;
    private LinearLayout testControls;
    private boolean focusPaused, surfaceAvailable, serviceStarted;
    private String suspendedVideo;
    private final Map<String,String> assetCache = new HashMap<>();
    private WebMessagePort port;
    private String approvedOrigin;
    private ScriptHandler documentScript;
    private boolean initialized, playing, destroyed;
    private int generation;
    private int connectingGeneration = -1;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private boolean ru;
    private boolean isTv(){String mode=getPreferences(0).getString("device_mode","auto");if(!mode.equals("auto"))return mode.equals("tv");return ((UiModeManager)getSystemService(UI_MODE_SERVICE)).getCurrentModeType()==android.content.res.Configuration.UI_MODE_TYPE_TELEVISION;}
    private final Set<String> getAllowed = new HashSet<>(Arrays.asList("time-pos", "duration", "pause", "mute", "volume", "speed", "aid", "sid", "track-list", "video-params", "video-params/gamma", "demuxer-cache-time", "demuxer-cache-duration", "paused-for-cache", "eof-reached", "gamma", "brightness", "contrast", "saturation", "audio-delay", "sub-delay", "hwdec-current", "video-codec", "audio-codec-name", "video-bitrate", "audio-bitrate", "estimated-vf-fps", "frame-drop-count", "avsync", "display-fps", "container-fps", "video-format", "audio-params", "demuxer-cache-state", "cache-speed", "demuxer-cache-idle", "chapter-list", "decoder-frame-drop-count", "vo-delayed-frame-count"));
    private final Set<String> setAllowed = new HashSet<>(Arrays.asList("pause", "mute", "volume", "speed", "aid", "sid", "vid", "gamma", "brightness", "contrast", "saturation", "audio-delay", "sub-delay", "sub-scale", "sub-pos", "sub-color", "sub-border-style", "sub-back-color", "sub-border-size", "sub-shadow-offset", "sub-font", "sub-margin-y"));
    private final OnlineFeatures online = new OnlineFeatures();
    private AppUpdater updater;
    // Файлы, выбранные пользователем в системном окне: только их content://-адреса можно открыть из страницы.
    private final Set<String> localFiles = new HashSet<>();
    private static final int PICK_LOCAL = 4711;
    private final java.util.concurrent.ThreadPoolExecutor network = new java.util.concurrent.ThreadPoolExecutor(2,2,0,java.util.concurrent.TimeUnit.SECONDS,new java.util.concurrent.ArrayBlockingQueue<>(8));
    private int playbackGeneration;
    private JSONArray cachedTracks;
    private android.media.session.MediaSession mediaSession;
    private String mediaTitle="Lampyris",mediaSubtitle="";
    private boolean canNext,canPrev;
    private String lastMetadata="";
    private long stateTime;
    private double statePosition, stateSpeed;
    private void initMedia(){
        mediaSession=new android.media.session.MediaSession(this,"Lampyris");
        mediaSession.setFlags(android.media.session.MediaSession.FLAG_HANDLES_MEDIA_BUTTONS|android.media.session.MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new android.media.session.MediaSession.Callback(){
            @Override public void onPlay(){focusPaused=false;if(playing&&audio.requestAudioFocus(focus)==AudioManager.AUDIOFOCUS_REQUEST_GRANTED)MPVLib.setPropertyString("pause","no");}
            @Override public void onPause(){focusPaused=false;if(playing)MPVLib.setPropertyString("pause","yes");}
            @Override public void onStop(){if(playing){web.evaluateJavascript("window.Lampa && Lampa.Player.close()",null);stopPlayback();}}
            @Override public void onSeekTo(long ms){if(playing)MPVLib.command(new String[]{"seek",String.valueOf(Math.max(0,ms)/1000.0),"absolute+exact"});}
            @Override public void onFastForward(){if(playing)MPVLib.command(new String[]{"seek","10","relative+exact"});}
            @Override public void onRewind(){if(playing)MPVLib.command(new String[]{"seek","-10","relative+exact"});}
            @Override public void onSkipToNext(){if(playing&&canNext)sendRemote("next");}
            @Override public void onSkipToPrevious(){if(playing&&canPrev)sendRemote("prev");}
        },new Handler(Looper.getMainLooper()));
    }
    // Частота экрана под частоту кадров видео: Android сам выбирает режим дисплея с нужной частотой (0 — вернуть прежний).
    private void applyDisplayRate(double fps){
        try{
            WindowManager.LayoutParams attrs=getWindow().getAttributes();
            if(!(fps>0)){if(attrs.preferredDisplayModeId!=0){attrs.preferredDisplayModeId=0;getWindow().setAttributes(attrs);}return;}
            Display display=getWindowManager().getDefaultDisplay();Display.Mode current=display.getMode();
            List<Display.Mode> modes=new ArrayList<>();
            for(Display.Mode m:display.getSupportedModes())if(m.getPhysicalWidth()==current.getPhysicalWidth()&&m.getPhysicalHeight()==current.getPhysicalHeight())modes.add(m);
            float[] rates=new float[modes.size()];for(int i=0;i<rates.length;i++)rates[i]=modes.get(i).getRefreshRate();
            float rate=DisplayRate.pick(fps,rates);if(Float.isNaN(rate))return;
            for(Display.Mode m:modes)if(m.getRefreshRate()==rate){attrs.preferredDisplayModeId=m.getModeId();getWindow().setAttributes(attrs);break;}
        }catch(Exception ignored){}
    }
    private String localFd(Uri uri)throws Exception{
        android.os.ParcelFileDescriptor fd=getContentResolver().openFileDescriptor(uri,"r");
        if(fd==null)throw new Exception(tr("Файл недоступен","File unavailable"));
        return "fd://"+fd.detachFd();
    }
    private String localTitle(Uri u){
        String name=null;
        try(android.database.Cursor c=getContentResolver().query(u,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())name=c.getString(0);}catch(Exception ignored){}
        if(name==null||name.isEmpty())name=u.getLastPathSegment();if(name==null)name="Video";
        int dot=name.lastIndexOf('.');if(dot>0)name=name.substring(0,dot);
        return name.length()>200?name.substring(0,200):name;
    }
    // Источник страницы в том виде, в каком его видит location.origin в JS (порт по умолчанию опускается).
    private static String jsOrigin(Uri u){int p=u.getPort();boolean def=p==-1||("https".equals(u.getScheme())&&p==443)||("http".equals(u.getScheme())&&p==80);return u.getScheme()+"://"+u.getHost().toLowerCase(Locale.ROOT)+(def?"":":"+p);}
    // Выбранные файлы превращаются в плейлист Lampa; если страница ещё не готова, повторяем раз в 1,5 с.
    // Список с путями получает только страница нашего сервера: источник открытого документа сверяется и здесь, и в самом скрипте.
    private void openLocal(List<Uri> uris,int attempt){
        if(destroyed||uris.isEmpty())return;
        Runnable retry=()->{
            if(attempt<20)new Handler(Looper.getMainLooper()).postDelayed(()->openLocal(uris,attempt+1),1500);
            else Toast.makeText(this,tr("Не удалось открыть файл: страница Lampa не готова.","Could not open the file: the Lampa page is not ready."),Toast.LENGTH_LONG).show();
        };
        try{
            String page=web.getUrl();
            if(page==null||approvedOrigin==null||!http(Uri.parse(page))||!approvedOrigin.equals(origin(Uri.parse(page)))){retry.run();return;}
            JSONArray items=new JSONArray();List<String> added=new ArrayList<>();
            for(Uri u:uris){if(!"content".equals(u.getScheme()))continue;if(localFiles.add(u.toString()))added.add(u.toString());items.put(new JSONObject().put("title",localTitle(u)).put("url",u.toString()));}
            if(items.length()==0)return;
            String script="(function(){if(location.origin!=="+JSONObject.quote(jsOrigin(Uri.parse(page)))+")return 'origin';return window.__lampyrisOpenLocal?window.__lampyrisOpenLocal("+items+"):'no-lampa'})()";
            web.evaluateJavascript(script,value->{
                String answer=value==null?"":value.replace("\"","");
                if(answer.equals("ok"))return;
                localFiles.removeAll(added);
                if(answer.equals("mpv-off")){Toast.makeText(this,tr("Включите «Использовать mpv для видео» в настройках MPV","Turn on “Use mpv for video” in the MPV settings"),Toast.LENGTH_LONG).show();return;}
                retry.run();
            });
        }catch(Exception e){Toast.makeText(this,tr("Не удалось открыть файл","Could not open the file"),Toast.LENGTH_LONG).show();}
    }
    private void handleViewIntent(android.content.Intent intent){
        if(intent==null||!android.content.Intent.ACTION_VIEW.equals(intent.getAction())||intent.getData()==null)return;
        openLocal(Collections.singletonList(intent.getData()),0);
    }
    @Override protected void onNewIntent(android.content.Intent intent){super.onNewIntent(intent);setIntent(intent);handleViewIntent(intent);}
    @Override protected void onActivityResult(int request,int result,android.content.Intent data){
        super.onActivityResult(request,result,data);
        if(request!=PICK_LOCAL||result!=RESULT_OK||data==null)return;
        List<Uri> uris=new ArrayList<>();
        if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++)uris.add(data.getClipData().getItemAt(i).getUri());
        else if(data.getData()!=null)uris.add(data.getData());
        openLocal(uris,0);
    }
    private void sendRemote(String command){try{send(new JSONObject().put("event","remote").put("command",command));}catch(Exception ignored){}}
    private double mpvNumber(String key){try{double n=Double.parseDouble(MPVLib.getPropertyString(key));return Double.isFinite(n)?n:0;}catch(Exception e){return 0;}}
    private void updateMedia(boolean notify){
        if(mediaSession==null||!playing)return;
        boolean paused="yes".equals(MPVLib.getPropertyString("pause"));
        long actions=android.media.session.PlaybackState.ACTION_PLAY|android.media.session.PlaybackState.ACTION_PAUSE|android.media.session.PlaybackState.ACTION_PLAY_PAUSE|android.media.session.PlaybackState.ACTION_STOP|android.media.session.PlaybackState.ACTION_SEEK_TO|android.media.session.PlaybackState.ACTION_REWIND|android.media.session.PlaybackState.ACTION_FAST_FORWARD;
        if(canNext)actions|=android.media.session.PlaybackState.ACTION_SKIP_TO_NEXT;if(canPrev)actions|=android.media.session.PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        mediaSession.setActive(true);
        long duration=(long)(mpvNumber("duration")*1000);
        String metadata=mediaTitle+"\n"+mediaSubtitle+"\n"+duration;
        if(!metadata.equals(lastMetadata)){lastMetadata=metadata;mediaSession.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE,mediaTitle).putString(MediaMetadata.METADATA_KEY_ARTIST,mediaSubtitle).putLong(MediaMetadata.METADATA_KEY_DURATION,duration).build());}
        stateTime=SystemClock.elapsedRealtime();statePosition=mpvNumber("time-pos");stateSpeed=paused?0:mpvNumber("speed");
        mediaSession.setPlaybackState(new android.media.session.PlaybackState.Builder().setActions(actions).setState(paused?android.media.session.PlaybackState.STATE_PAUSED:android.media.session.PlaybackState.STATE_PLAYING,(long)(statePosition*1000),(float)stateSpeed,stateTime).build());
        if(notify){android.content.Intent i=new android.content.Intent(this,PlaybackService.class).putExtra("token",mediaSession.getSessionToken()).putExtra("title",mediaTitle).putExtra("subtitle",mediaSubtitle).putExtra("paused",paused).putExtra("ru",ru);startForegroundService(i);serviceStarted=true;}
    }
    private void clearMedia(){if(mediaSession!=null){mediaSession.setPlaybackState(new android.media.session.PlaybackState.Builder().setState(android.media.session.PlaybackState.STATE_STOPPED,0,0).build());mediaSession.setActive(false);}if(serviceStarted){startService(new android.content.Intent(this,PlaybackService.class).setAction(PlaybackService.SHUTDOWN));serviceStarted=false;}lastMetadata="";}
    private void stopPlayback(){applyDisplayRate(0);focusPaused=false;suspendedVideo=null;cachedTracks=null;playbackGeneration++;propertyHandler.removeCallbacksAndMessages(null);pendingProperties.clear();scheduledProperties.clear();if(initialized)MPVLib.command(new String[]{"stop"});playing=false;clearMedia();getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);if(audio!=null)audio.abandonAudioFocusRequest(focus);immersive(false);}
    private java.io.File configFile(){return new java.io.File(getFilesDir(),"mpv.conf");}
    private String configText()throws Exception{return configFile().exists()?new String(java.nio.file.Files.readAllBytes(configFile().toPath()),StandardCharsets.UTF_8):"";}
    private JSONObject mergedProfiles(PlayerConfig cfg)throws Exception{JSONObject profiles=new JSONObject(asset("profiles.json"));for(Map.Entry<String,Map<String,String>> p:cfg.profiles.entrySet())profiles.put(p.getKey(),new JSONObject(p.getValue()));return profiles;}
    private JSONObject configData()throws Exception{String text=configText();return new JSONObject().put("text",text).put("path","Lampyris / mpv.conf").put("profiles",mergedProfiles(PlayerConfig.parse(text)).names());}
    private JSONObject saveConfig(String text)throws Exception{
        if(text.getBytes(StandardCharsets.UTF_8).length>65536)return new JSONObject().put("ok",false).put("error",tr("Файл больше 64 КиБ","File exceeds 64 KiB"));
        PlayerConfig cfg=PlayerConfig.parse(text);java.io.File tmp=new java.io.File(getFilesDir(),"mpv.conf.tmp");java.nio.file.Files.write(tmp.toPath(),text.getBytes(StandardCharsets.UTF_8));java.nio.file.Files.move(tmp.toPath(),configFile().toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        JSONArray ignored=new JSONArray();for(String[] row:cfg.ignored)ignored.put(new JSONObject().put("line",Integer.parseInt(row[0])).put("text",row[1]).put("reason",row[2].equals("option")?tr("Параметр или значение не поддерживается в Android","Option or value is not supported on Android"):tr("Недопустимый синтаксис или имя профиля","Invalid syntax or profile name")));
        return new JSONObject().put("ok",true).put("profiles",mergedProfiles(cfg).names()).put("ignored",ignored);
    }
    private void onlineRequest(int id,String method,JSONArray args,int document,int playback){
        try{network.execute(()->{
            Object result;try{
                if(method.equals("subsSearch"))result=online.search(args.getString(0),args.optInt(1,0),args.optInt(2,0));
                else if(method.equals("tidbMedia"))result=online.intro(args.getInt(0),args.optInt(1,0),args.optInt(2,0));
                else{byte[] data=online.subtitle(args.getString(0));String title=args.optString(1,"Online subtitles").replaceAll("[\\r\\n\\p{Cntrl}]","");if(title.length()>120)title=title.substring(0,120);String lang=args.optString(2,"und").replaceAll("[^A-Za-z]","");if(lang.length()>3)lang=lang.substring(0,3);
                    java.io.File dir=new java.io.File(getCacheDir(),"subtitles");dir.mkdirs();java.io.File file=new java.io.File(dir,UUID.randomUUID()+".srt");java.nio.file.Files.write(file.toPath(),data);
                    final String cleanTitle=title,cleanLang=lang;
                    runOnUiThread(()->{if(destroyed||generation!=document||playbackGeneration!=playback){file.delete();if(!destroyed&&generation==document)reply(id,null,tr("Воспроизведение изменилось","Playback changed"));return;}MPVLib.command(new String[]{"sub-add",file.getAbsolutePath(),"select",cleanTitle,cleanLang});try{reply(id,new JSONObject().put("ok",true),null);}catch(Exception ignored){}});return;}
            }catch(Exception e){try{result=method.equals("subsLoad")?new JSONObject().put("ok",false).put("error",tr("Не удалось загрузить субтитры","Could not load subtitles")):new JSONObject().put("error",e.getMessage()!=null&&e.getMessage().matches("HTTP [0-9]{3}")?e.getMessage():"Network request failed").toString();}catch(Exception impossible){return;}}
            final Object value=result;runOnUiThread(()->{if(!destroyed&&generation==document)reply(id,value,null);});
        });}catch(java.util.concurrent.RejectedExecutionException e){reply(id,null,tr("Слишком много запросов","Too many requests"));}
    }
    private void reply(int id,Object value,String error){try{send(error==null?new JSONObject().put("id",id).put("ok",true).put("value",value):new JSONObject().put("id",id).put("ok",false).put("error",error));}catch(Exception ignored){}}
    private JSONObject gestureValues()throws Exception{float brightness=getWindow().getAttributes().screenBrightness;if(brightness<0)brightness=android.provider.Settings.System.getInt(getContentResolver(),android.provider.Settings.System.SCREEN_BRIGHTNESS,128)/255f;return new JSONObject().put("brightness",brightness).put("volume",(double)audio.getStreamVolume(AudioManager.STREAM_MUSIC)/audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC));}

    private String tr(String r, String e) { return ru ? r : e; }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ru=getPreferences(0).getString("language",Locale.getDefault().getLanguage()).equals("ru");
        getWindow().setStatusBarColor(Color.BLACK); getWindow().setNavigationBarColor(Color.BLACK);
        root = new FrameLayout(this);
        root.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        root.setBackgroundColor(Color.BLACK); setContentView(root);
        video = new SurfaceView(this); root.addView(video, new FrameLayout.LayoutParams(-1,-1));
        try{prepareFonts();copyAsset("cacert.pem");}catch(Exception e){new AlertDialog.Builder(this).setMessage(tr("Не удалось подготовить файлы плеера","Could not prepare player files")).setPositiveButton("OK",(d,w)->finish()).setOnCancelListener(d->finish()).show();return;}
        MPVLib.create(getApplicationContext());
        option("config", "no"); option("load-scripts", "no"); option("ytdl", "no");
        option("vo", "gpu"); option("gpu-context", "android"); option("opengl-es", "yes");
        option("hwdec", "mediacodec,mediacodec-copy"); option("ao", "audiotrack,opensles");
        option("idle", "yes"); option("keep-open", "yes"); option("input-default-bindings", "no");
        option("demuxer-max-bytes", "128MiB"); option("scale", "bilinear"); option("cscale", "bilinear");
        // Тихое переподключение ffmpeg при обрыве и ответах 429/5xx (пауза растёт до 5 с).
        option("stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_on_http_error=%7%429,5xx,reconnect_delay_max=5");
        option("tls-verify", "yes"); option("tls-ca-file", getFilesDir()+"/cacert.pem");
        MPVLib.init(); initialized = true; MPVLib.listener = this;
        for(String key:PlayerConfig.keys())profileDefaults.put(key,key.equals("af")?"":MPVLib.getPropertyString(key));
        for (String p : Arrays.asList("time-pos", "duration", "demuxer-cache-time", "speed")) MPVLib.observeProperty(p,5);
        for (String p : Arrays.asList("pause", "paused-for-cache", "eof-reached")) MPVLib.observeProperty(p,3);
        for (String p : Arrays.asList("track-list", "video-params")) MPVLib.observeProperty(p,1);
        video.getHolder().addCallback(this);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & 2) != 0);
        web = new WebView(this);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString()+" Lampa_Client Lampyris/"+BuildConfig.VERSION_NAME);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.getSettings().setUseWideViewPort(true); web.getSettings().setLoadWithOverviewMode(true);
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri u=request.getUrl();
                if (!http(u)) return true;
                if (approvedOrigin != null && !origin(u).equals(approvedOrigin)) {
                    new AlertDialog.Builder(MainActivity.this).setMessage(tr("Открыть другой сервер? ","Open another server? ")+u.getHost())
                        .setPositiveButton(tr("Открыть","Open"),(d,w)->load(u.toString())).setNegativeButton(tr("Отмена","Cancel"),null).show(); return true;
                }
                return false;
            }
            @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon) { resetBridge(); }
            @Override public void onPageFinished(WebView v,String url) {
                if (approvedOrigin == null || !approvedOrigin.equals(origin(Uri.parse(url)))) return;
                connect();
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if(r.isForMainFrame()) Toast.makeText(MainActivity.this,tr("Не удалось открыть сервер. Проверьте адрес и сеть.","Cannot open server. Check address and network."),Toast.LENGTH_LONG).show();
            }
        });
        root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        settingsButton = new Button(this); Button settings=settingsButton; settings.setText("☰"); settings.setContentDescription(tr("Настройки Lampyris","Lampyris settings"));
        FrameLayout.LayoutParams pos=new FrameLayout.LayoutParams(dp(52),dp(48),Gravity.BOTTOM|Gravity.START); root.addView(settings,pos); settings.setAlpha(.8f); settings.setOnClickListener(v->menu());
        audio=(AudioManager)getSystemService(AUDIO_SERVICE);
        focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build())
            .setOnAudioFocusChangeListener(this::audioFocusChanged,new Handler(Looper.getMainLooper())).build();
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::handleBack);
        initMedia();
        updater=new AppUpdater(this,getPreferences(0),()->ru,()->playing);
        new Handler(Looper.getMainLooper()).postDelayed(()->{if(updater!=null)updater.checkAuto();},12000);
        String server=getPreferences(0).getString("server", "");
        if(server.isEmpty()) serverDialog(); else load(server);
        handleViewIntent(getIntent());
    }
    private void prepareFonts(){
        try{
            java.io.File file=new java.io.File(getFilesDir(),"fonts.conf");
            String prefer="<prefer><family>Roboto</family><family>Noto Sans</family></prefer>";
            String config="<?xml version=\"1.0\"?><fontconfig><dir>/system/fonts</dir><dir>/product/fonts</dir><cachedir>"+getCacheDir().getAbsolutePath()+"/fontconfig</cachedir>";
            for(String family:new String[]{"sans-serif","Arial","Helvetica"})config+="<alias><family>"+family+"</family>"+prefer+"</alias>";
            config+="<alias><family>serif</family><prefer><family>Noto Serif</family></prefer></alias><alias><family>monospace</family><prefer><family>Roboto Mono</family><family>Droid Sans Mono</family></prefer></alias></fontconfig>";
            new java.io.File(getCacheDir(),"fontconfig").mkdirs();java.nio.file.Files.write(file.toPath(),config.getBytes(StandardCharsets.UTF_8));
            android.system.Os.setenv("FONTCONFIG_FILE",file.getAbsolutePath(),true);
        }catch(Exception e){throw new IllegalStateException("Font configuration unavailable",e);}
    }
    private int dp(int n) { return (int)(n*getResources().getDisplayMetrics().density); }
    private void option(String n,String v) { MPVLib.setOptionString(n,v); }
    private static boolean http(Uri u) { return ("https".equals(u.getScheme()) || "http".equals(u.getScheme())) && u.getHost()!=null && u.getUserInfo()==null; }
    private static String origin(Uri u) { return u.getScheme()+"://"+u.getHost()+(u.getPort()==-1 ? "" : ":"+u.getPort()); }
    private void load(String url) { Uri u=Uri.parse(url); if(!http(u)) throw new IllegalArgumentException("Invalid URL"); approvedOrigin=origin(u);
        if(documentScript!=null&&WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))documentScript.remove();
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)){Toast.makeText(this,tr("Обновите Android System WebView","Update Android System WebView"),Toast.LENGTH_LONG).show();return;}
        try{documentScript=WebViewCompat.addDocumentStartJavaScript(web,asset("lampa-android.js").replace("__TV__",String.valueOf(isTv())),Collections.singleton(approvedOrigin));}catch(Exception e){throw new IllegalStateException(e);}
        web.loadUrl(url); }
    private void serverDialog() {
        EditText input=new EditText(this); input.setSingleLine(); input.setInputType(17); input.setHint("https://…"); input.setText(getPreferences(0).getString("server",""));
        AlertDialog d=new AlertDialog.Builder(this).setTitle(tr("Сервер Lampa","Lampa server")).setView(input).setPositiveButton(tr("Открыть","Open"),null).setNegativeButton(tr("Отмена","Cancel"),(x,w)->serverHint()).setOnCancelListener(x->serverHint()).create();
        d.setOnShowListener(x->d.getButton(-1).setOnClickListener(v->{String url=input.getText().toString().trim(); if(!url.contains("://")) url="https://"+url; if(!http(Uri.parse(url))){input.setError(tr("Введите адрес HTTP или HTTPS","Enter an HTTP or HTTPS address"));return;} getPreferences(0).edit().putString("server",url).apply();load(url);d.dismiss();})); d.show();
    }
    // Без сохранённого адреса экран остаётся пустым: подсказываем, где его задать.
    private void serverHint(){if(getPreferences(0).getString("server","").isEmpty())Toast.makeText(this,tr("Адрес сервера задаётся в меню ☰ → «Сменить сервер»","Set the server address in the ☰ menu → “Change server”"),Toast.LENGTH_LONG).show();}
    private void menu() {
        new AlertDialog.Builder(this).setTitle("Lampyris · Preview").setItems(new String[]{tr("Сменить сервер","Change server"),tr("Перезагрузить","Reload"),tr("Проверить mpv (тестовое видео)","Test mpv (sample video)"),tr("О версии","About"),"Язык / Language",tr("Управление: планшет / телевизор","Controls: tablet / TV"),tr("Проверить обновления","Check for updates"),tr("Автопроверка обновлений: ","Automatic update check: ")+(updater.autoEnabled()?tr("вкл","on"):tr("выкл","off"))},(d,n)->{
            if(n==6)updater.checkManual();
            if(n==7){boolean on=!updater.autoEnabled();updater.setAuto(on);Toast.makeText(this,tr("Автопроверка обновлений: ","Automatic update check: ")+(on?tr("вкл","on"):tr("выкл","off")),Toast.LENGTH_SHORT).show();}
            if(n==5){String[] modes={"auto","touch","tv"};String mode=getPreferences(0).getString("device_mode","auto");new AlertDialog.Builder(this).setTitle(tr("Режим управления","Controls mode")).setSingleChoiceItems(new String[]{tr("Автоматически","Automatic"),tr("Планшет / телефон","Tablet / phone"),tr("Телевизор / пульт","TV / remote")},Arrays.asList(modes).indexOf(mode),(dialog,index)->{getPreferences(0).edit().putString("device_mode",modes[index]).apply();dialog.dismiss();web.reload();}).setNegativeButton(tr("Отмена","Cancel"),null).show();}
            if(n==4)new AlertDialog.Builder(this).setTitle("Язык / Language").setItems(new String[]{"Русский","English"},(dialog,index)->{ru=index==0;getPreferences(0).edit().putString("language",ru?"ru":"en").apply();}).show();
            if(n==0)serverDialog(); if(n==1)web.reload(); if(n==2)testVideo(); if(n==3)new AlertDialog.Builder(this).setMessage(tr("Lampyris "+BuildConfig.VERSION_NAME+". Встроенный mpv. ARM32 / ARM64.","Lampyris "+BuildConfig.VERSION_NAME+". Built-in mpv. ARM32 / ARM64.")).setPositiveButton("OK",null).show();
        }).show();
    }
    private String asset(String file) throws Exception { if(assetCache.containsKey(file))return assetCache.get(file);try(var in=getAssets().open(file)){var out=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);String value=new String(out.toByteArray(),StandardCharsets.UTF_8).replace("__VERSION__",BuildConfig.VERSION_NAME);assetCache.put(file,value);return value;} }
    private void connect() {
        // WebView can repeat onPageFinished for same-document history navigation.
        // Keep the original port captured by the installed player until a real navigation.
        if (connectingGeneration == generation) return;
        connectingGeneration = generation;
        try {
            int token=generation;
            String handshake="lampyris-"+UUID.randomUUID();
            web.evaluateJavascript("window.__lampyrisTV="+isTv()+";\n"+asset("android-bridge.js").replace("__NATIVE_HANDSHAKE__",handshake)+"\nwindow.addEventListener('lampyris-ready',function(){"+asset("playbackCover.js")+"\n"+asset("mpvTube.js")+"\n"+asset("tablet.js")+"},{once:true});",v->{
                if(token!=generation || destroyed)return;
                WebMessagePort[] pair=web.createWebMessageChannel(); port=pair[0];
                port.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort p,WebMessage message){if(p==port && token==generation)receive(message.getData());}});
                web.postWebMessage(new WebMessage(handshake,new WebMessagePort[]{pair[1]}),Uri.parse(approvedOrigin));
            });
        } catch(Exception e) { Toast.makeText(this,tr("Не удалось подключить плеер","Could not connect player"),Toast.LENGTH_LONG).show(); }
    }
    private void resetBridge(){localFiles.clear();generation++;if(port!=null){port.close();port=null;}stopPlayback();}

    private void send(JSONObject obj){if(port!=null&&!destroyed)port.postMessage(new WebMessage(obj.toString()));}
    private Object value(String name) throws Exception {
        if(name.equals("track-list")) {
            if(cachedTracks!=null)return cachedTracks;
            JSONArray list=new JSONArray();
            String count=MPVLib.getPropertyString("track-list/count");
            int n=count==null?0:Integer.parseInt(count);
            for(int i=0;i<Math.min(n,128);i++) {JSONObject t=new JSONObject();for(String k:Arrays.asList("id","type","title","lang","selected","external","codec","demux-w","demux-h","demux-channel-count","demux-channels","demux-samplerate","codec-profile","forced","default","hearing-impaired","visual-impaired","hls-bitrate","program-id","dolby-vision-profile")){String raw=MPVLib.getPropertyString("track-list/"+i+"/"+k);if(raw!=null){Object parsed=raw;if(raw.equals("yes"))parsed=true;else if(raw.equals("no"))parsed=false;else try{double number=Double.parseDouble(raw);if(Double.isFinite(number))parsed=number;}catch(Exception ignored){}t.put(k,parsed);}}list.put(t);} cachedTracks=list;return list;
        }
        if(name.equals("chapter-list")){
            // Главы собираем по полям: строка списка mpv не гарантирует JSON.
            JSONArray list=new JSONArray();String count=MPVLib.getPropertyString("chapter-list/count");int n=count==null?0:Integer.parseInt(count);
            for(int i=0;i<Math.min(n,1000);i++){String time=MPVLib.getPropertyString("chapter-list/"+i+"/time");if(time==null)continue;String title=MPVLib.getPropertyString("chapter-list/"+i+"/title");list.put(new JSONObject().put("time",Double.parseDouble(time)).put("title",title==null?"":title));}
            return list;
        }
        if(name.equals("video-params")){JSONObject obj=new JSONObject();for(String k:Arrays.asList("w","h","gamma","colormatrix","primaries")){String raw=MPVLib.getPropertyString("video-params/"+k);if(raw!=null){Object parsed=raw;if(k.equals("w")||k.equals("h"))parsed=Integer.valueOf(raw);obj.put(k,parsed);}}return obj;}
        if(name.equals("audio-params")||name.equals("demuxer-cache-state")){
            JSONObject obj=new JSONObject();String[] fields=name.equals("audio-params")?new String[]{"samplerate","channel-count","channels","hr-channels","format"}:new String[]{"raw-input-rate","fw-bytes","total-bytes","cache-duration","reader-pts","eof","underrun"};
            for(String key:fields){String raw=MPVLib.getPropertyString(name+"/"+key);if(raw==null)continue;Object parsed=raw;if(raw.equals("yes"))parsed=true;else if(raw.equals("no"))parsed=false;else try{double n=Double.parseDouble(raw);if(Double.isFinite(n))parsed=n;}catch(Exception ignored){}obj.put(key,parsed);}return obj;
        }
        String s=MPVLib.getPropertyString(name); if(s==null)return JSONObject.NULL;
        if(s.equals("yes"))return true;if(s.equals("no"))return false;
        if(s.startsWith("{")||s.startsWith("[")) return new JSONTokener(s).nextValue();
        try{return Double.valueOf(s);}catch(Exception e){return s;}
    }
    private void receive(String data) {
        if(data==null||data.length()>262144)return;
        JSONObject reply=new JSONObject();
        try {
            JSONObject q=new JSONObject(data); reply.put("id",q.getInt("id")); JSONArray a=q.optJSONArray("a"); if(a==null)a=new JSONArray();
            String m=q.getString("m");Object result=JSONObject.NULL;
            if(Arrays.asList("subsSearch","subsLoad","tidbMedia").contains(m)){onlineRequest(q.getInt("id"),m,a,generation,playbackGeneration);return;}
            switch(m){
                case "open": {
                    String url=a.getString(0);Uri openUri=Uri.parse(url);
                    if("content".equals(openUri.getScheme())){if(!localFiles.contains(url))throw new Exception("File not allowed");url=localFd(openUri);}
                    else if(!http(openUri))throw new Exception("HTTP(S) only");
                    JSONObject opts=a.optJSONObject(1); if(opts==null)opts=new JSONObject();
                    double start=opts.optDouble("start",0),volume=opts.optDouble("volume",100);
                    if(!Double.isFinite(start)||start<0||start>604800||!Double.isFinite(volume)||volume<0||volume>100)throw new Exception("Invalid playback options");
                    JSONObject buffer=opts.optJSONObject("mpvOptions");
                    double seconds=buffer==null?60:buffer.optDouble("demuxer-readahead-secs",60);
                    if(!Double.isFinite(seconds)||seconds<0||seconds>300)throw new Exception("Invalid buffer");
                    cachedTracks=null;playbackGeneration++;propertyHandler.removeCallbacksAndMessages(null);pendingProperties.clear();scheduledProperties.clear();
                    clearSubtitleCache();
                    applyProfile(opts.optString("profile","fast"));
                    if(audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED)throw new Exception("Audio focus unavailable");
                    focusPaused=false;
                    MPVLib.setPropertyString("volume",String.valueOf(volume));
                    MPVLib.setPropertyString("pause","no");
                    MPVLib.command(new String[]{"loadfile",url,"replace","-1","start="+start+",sid=no,demuxer-max-bytes=134217728,demuxer-readahead-secs="+seconds});
                    playing=true;if(!surfaceAvailable){suspendedVideo="auto";MPVLib.setPropertyString("vid","no");}getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);immersive(true);mediaTitle="Lampyris";mediaSubtitle="";updateMedia(true);
                    result=new JSONObject().put("ok",true); break;

                }
                case "stop":stopPlayback();break;
                case "pip":{if(!playing)throw new Exception("No video");result=enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(new android.util.Rational(16,9)).build());break;}
                case "audioFx": {
                    JSONObject d=a.getJSONObject(0);JSONArray b=d.optJSONArray("bands");int[] bands=new int[b==null?0:Math.min(b.length(),AudioFx.BAND_FREQUENCIES.length)];
                    for(int i=0;i<bands.length;i++)bands[i]=(int)b.optDouble(i,0);
                    String graph=AudioFx.graph(bands,(int)d.optDouble("dialogue",0),d.optBoolean("night"));
                    for(String[] c:AudioFx.commands(graph))MPVLib.command(c);
                    result=graph!=null;break;
                }
                case "displayRate": {double fps=a.getDouble(0);if(!(fps==0||(fps>=10&&fps<=120)))throw new Exception("Invalid frame rate");applyDisplayRate(fps);result=true;break;}
                case "pickLocal": {
                    android.content.Intent pick=new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT).addCategory(android.content.Intent.CATEGORY_OPENABLE).setType("*/*")
                        .putExtra(android.content.Intent.EXTRA_MIME_TYPES,new String[]{"video/*","audio/*","application/x-matroska"}).putExtra(android.content.Intent.EXTRA_ALLOW_MULTIPLE,true);
                    try{startActivityForResult(pick,PICK_LOCAL);}catch(Exception e){throw new Exception(tr("Нет приложения для выбора файлов","No app to pick files"));}
                    result=true;break;
                }
                case "get": {String n=a.getString(0);if(!getAllowed.contains(n))throw new Exception("Property not allowed");result=value(n);break;}
                case "set": {String n=a.getString(0),v=a.getString(1);if(!setAllowed.contains(n)||v.length()>64)throw new Exception("Property not allowed");
                    if(PlayerConfig.keys().contains(n)&&!PlayerConfig.allowed(n,v))throw new Exception("Invalid property value");
                    if(n.equals("pause")||n.equals("mute")){if(!v.equals("yes")&&!v.equals("no"))throw new Exception("Invalid boolean");}
                    if(Arrays.asList("aid","sid","vid").contains(n)&&!v.matches("(?:auto|no|[0-9]{1,9})"))throw new Exception("Invalid track");
                    if(n.equals("pause")){focusPaused=false;if(v.equals("no")&&playing&&audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED)throw new Exception("Audio focus unavailable");}
                    if(n.equals("vid")&&suspendedVideo!=null)suspendedVideo=v;else MPVLib.setPropertyString(n,v);break;}
                case "command": {JSONArray cmd=a.getJSONArray(0);if(cmd.length()<1||cmd.length()>3||!cmd.getString(0).equals("seek"))throw new Exception("Command not allowed");double seconds=Double.parseDouble(cmd.getString(1));if(!Double.isFinite(seconds))throw new Exception("Invalid seek");String mode=cmd.optString(2,"relative");if(!Arrays.asList("relative","absolute","absolute+exact","relative+exact").contains(mode))throw new Exception("Invalid mode");MPVLib.command(new String[]{"seek",String.valueOf(seconds),mode});break;}
                case "profile": applyProfile(a.optString(0,"fast"));break;
                case "nowPlaying": {JSONObject info=a.getJSONObject(0);mediaTitle=info.optString("title","Lampyris");if(mediaTitle.length()>200)mediaTitle=mediaTitle.substring(0,200);mediaSubtitle=info.optString("subtitle","");if(mediaSubtitle.length()>200)mediaSubtitle=mediaSubtitle.substring(0,200);canNext=info.optBoolean("canNext");canPrev=info.optBoolean("canPrev");updateMedia(true);result=true;break;}
                case "nowPlayingClear":clearMedia();result=true;break;
                case "gestureGet":result=gestureValues();break;
                case "gestureSet":{if(!playing)throw new Exception("No video");String kind=a.getString(0);double v=a.getDouble(1);if(!Double.isFinite(v)||v<0||v>1)throw new Exception("Invalid level");if(kind.equals("volume")){audio.setStreamVolume(AudioManager.STREAM_MUSIC,(int)Math.round(v*audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)),0);}else if(kind.equals("brightness")){WindowManager.LayoutParams attrs=getWindow().getAttributes();attrs.screenBrightness=(float)Math.max(.02,v);getWindow().setAttributes(attrs);}else throw new Exception("Invalid gesture");result=gestureValues();break;}
                case "getConfig":result=configData();break;
                case "setConfig":result=saveConfig(a.getString(0));break;
                default:throw new Exception(tr("Пока недоступно в Android Preview","Not available in Android Preview"));
            }
            reply.put("ok",true).put("value",result);
        }catch(Exception e){try{reply.put("ok",false).put("error",e.getMessage());}catch(Exception ignored){}}
        send(reply);
    }
    private void clearSubtitleCache(){java.io.File dir=new java.io.File(getCacheDir(),"subtitles");java.io.File[] files=dir.listFiles();if(files!=null)for(java.io.File file:files)file.delete();}
    private void applyProfile(String name) throws Exception {
        PlayerConfig cfg=PlayerConfig.parse(configText());JSONObject profiles=mergedProfiles(cfg);
        if(!name.isEmpty()&&!profiles.has(name))name="";
        Set<String> keys=new HashSet<>(profileDefaults.keySet());keys.addAll(cfg.global.keySet());
        for(Iterator<String> it=profiles.keys();it.hasNext();)profiles.getJSONObject(it.next()).keys().forEachRemaining(keys::add);
        for(String key:keys){if(!profileDefaults.containsKey(key))profileDefaults.put(key,MPVLib.getPropertyString(key));String original=profileDefaults.get(key);if(original!=null)MPVLib.setPropertyString(key,original);}
        for(Map.Entry<String,String> e:cfg.global.entrySet())MPVLib.setPropertyString(e.getKey(),e.getValue());
        if(!name.isEmpty()){JSONObject selected=profiles.getJSONObject(name);for(Iterator<String> it=selected.keys();it.hasNext();){String key=it.next();MPVLib.setPropertyString(key,selected.getString(key));}}
    }
    private final Map<String,String> profileDefaults=new HashMap<>();

    private final Handler propertyHandler=new Handler(Looper.getMainLooper());
    private final Map<String,Object> pendingProperties=new HashMap<>();
    private final Runnable releaseScreen=()->getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    private final Set<String> scheduledProperties=new HashSet<>();
    @Override public void property(String name,Object value){
        runOnUiThread(()->{
            if(destroyed)return;
            if(name.equals("time-pos")||name.equals("demuxer-cache-time")){
                pendingProperties.put(name,value);
                if(scheduledProperties.add(name))propertyHandler.postDelayed(()->{scheduledProperties.remove(name);Object latest=pendingProperties.remove(name);emitProperty(name,latest);},150);
            }else emitProperty(name,value);
        });
    }
    private void emitProperty(String name,Object value){
        if(destroyed)return;try{
            if(name.equals("track-list"))cachedTracks=null;
            if(name.equals("pause"))updateMedia(true);
            else if(name.equals("duration")||name.equals("speed"))updateMedia(false);
            else if(name.equals("time-pos")&&value instanceof Number){double expected=statePosition+(SystemClock.elapsedRealtime()-stateTime)/1000.0*stateSpeed;if(Math.abs(((Number)value).doubleValue()-expected)>2)updateMedia(false);}
            // Экран не гаснет, пока открыто видео; на паузе — не дольше десяти минут. Флаг ставится при открытии и снимается в stopPlayback.
            if(name.equals("pause")&&Boolean.TRUE.equals(value)){propertyHandler.removeCallbacks(releaseScreen);propertyHandler.postDelayed(releaseScreen,10*60*1000L);}
            if(name.equals("pause")&&Boolean.FALSE.equals(value)){propertyHandler.removeCallbacks(releaseScreen);if(playing)getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}
            Object v=value;if((name.equals("track-list")||name.equals("video-params"))&&v instanceof String)v=value(name);
            send(new JSONObject().put("event","property-change").put("name",name).put("data",v==null?JSONObject.NULL:v));
        }catch(Exception ignored){}
    }
    private void immersive(boolean enabled){if(settingsButton!=null)settingsButton.setVisibility(enabled?View.GONE:View.VISIBLE);getWindow().getDecorView().setSystemUiVisibility(enabled ? View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY : View.SYSTEM_UI_FLAG_VISIBLE);}
    @Override public void event(int id){
        String name=id==8?"file-loaded":id==21?"playback-restart":null;
        runOnUiThread(()->{if(destroyed)return;try{
            if(name!=null){send(new JSONObject().put("event",name));updateMedia(false);}
            if(id==7 && playing && "yes".equals(MPVLib.getPropertyString("idle-active")) && !"yes".equals(MPVLib.getPropertyString("eof-reached")))
                send(new JSONObject().put("event","end-file").put("reason",4).put("error",tr("Не удалось воспроизвести источник","Could not play source")));
        }catch(Exception ignored){}});
    }

    @Override public void surfaceCreated(SurfaceHolder h){surfaceAvailable=true;if(initialized){MPVLib.attachSurface(h.getSurface());MPVLib.setPropertyString("vo","gpu");if(suspendedVideo!=null){MPVLib.setPropertyString("vid",suspendedVideo);suspendedVideo=null;}}}
    @Override public void surfaceChanged(SurfaceHolder h,int format,int w,int height){if(initialized)MPVLib.setPropertyString("android-surface-size",w+"x"+height);}
    @Override public void surfaceDestroyed(SurfaceHolder h){surfaceAvailable=false;if(initialized){if(playing&&suspendedVideo==null){suspendedVideo=MPVLib.getPropertyString("vid");if(suspendedVideo==null)suspendedVideo="auto";MPVLib.setPropertyString("vid","no");}MPVLib.setPropertyString("vo","null");MPVLib.detachSurface();}}
    @Override protected void onPause(){super.onPause();}
    // В окне PiP остаётся одно видео: интерфейс Lampa там нечитаем и закрывает картинку.
    @Override public void onPictureInPictureModeChanged(boolean inPip,android.content.res.Configuration config){super.onPictureInPictureModeChanged(inPip,config);if(web!=null)web.setVisibility(inPip?View.INVISIBLE:View.VISIBLE);}
    @Override public boolean onKeyDown(int key,KeyEvent event){
        if(isTv()&&event.getRepeatCount()==0&&key==KeyEvent.KEYCODE_MENU){menu();return true;}
        if(playing&&key==KeyEvent.KEYCODE_INFO){if(event.getRepeatCount()==0)web.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'i',code:'KeyI',bubbles:true}))",null);return true;}
        return super.onKeyDown(key,event);
    }
    @Override public void onBackPressed(){handleBack();}
    // Esc отправляем на активный элемент, а не на window: на window обработчик Lampa срабатывает раньше наших и закрывает плеер.
    private long lastBack;
    // Системный «Назад» на части прошивок доходит дважды (обратный вызов и onBackPressed): второй вызов подряд игнорируем.
    private void handleBack(){long now=SystemClock.uptimeMillis();if(now-lastBack<350)return;lastBack=now;if(testControls!=null){closeTest();return;}if(playing){web.evaluateJavascript("(function(){if(document.querySelector('.mpv-pick,.mpv-conf,.mpv-statpanel')){const target=document.activeElement||document.body;for(const type of ['keydown','keyup'])target.dispatchEvent(new KeyboardEvent(type,{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));return true;}if(document.body.classList.contains('selectbox--open')&&window.Lampa){Lampa.Controller.back();return true;}return false;})()",handled->{if(!destroyed&&!"true".equals(handled)){web.evaluateJavascript("window.Lampa && Lampa.Player.close()",null);stopPlayback();}});}else if(web.canGoBack())web.goBack();else finish();}
    @Override protected void onDestroy(){destroyed=true;if(updater!=null)updater.destroy();resetBridge();network.shutdownNow();if(mediaSession!=null)mediaSession.release();MPVLib.listener=null;if(video!=null)video.getHolder().removeCallback(this);if(initialized){MPVLib.destroy();initialized=false;}if(audio!=null)audio.abandonAudioFocusRequest(focus);if(web!=null){root.removeView(web);web.destroy();}super.onDestroy();}
    private void copyAsset(String name)throws Exception{
        java.io.File target=new java.io.File(getFilesDir(),name);
        String stamp=name+"-version";
        if(target.isFile()&&getPreferences(0).getLong(stamp,-1)==BuildConfig.VERSION_CODE)return;
        java.io.File tmp=new java.io.File(getFilesDir(),name+".tmp");
        try(var in=getAssets().open(name)){java.nio.file.Files.copy(in,tmp.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);}
        java.nio.file.Files.move(tmp.toPath(),target.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        getPreferences(0).edit().putLong(stamp,BuildConfig.VERSION_CODE).apply();
    }
    private void closeTest(){stopPlayback();web.setVisibility(View.VISIBLE);if(testControls!=null){root.removeView(testControls);testControls=null;}web.reload();}
    private void audioFocusChanged(int change){
        if(!initialized||!playing)return;
        switch(change){
            case AudioManager.AUDIOFOCUS_LOSS:
                focusPaused=false;MPVLib.setPropertyString("pause","yes");audio.abandonAudioFocusRequest(focus);break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                if(!"yes".equals(MPVLib.getPropertyString("pause"))){focusPaused=true;MPVLib.setPropertyString("pause","yes");}break;
            case AudioManager.AUDIOFOCUS_GAIN:
                if(focusPaused){focusPaused=false;MPVLib.setPropertyString("pause","no");}break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                // Android автоматически приглушает MEDIA; паузу пользователя не меняем.
                break;
        }
    }
    private void testVideo(){
        try{copyAsset("sample.mp4");}catch(Exception e){Toast.makeText(this,tr("Тестовое видео недоступно","Test video unavailable"),Toast.LENGTH_LONG).show();return;}
        if(testControls!=null)return;resetBridge();web.setVisibility(View.GONE);
        LinearLayout controls=new LinearLayout(this);testControls=controls;controls.setGravity(Gravity.CENTER);controls.setBackgroundColor(0x99000000);
        String[] labels={tr("Закрыть","Close"),"−10",tr("Пауза / пуск","Pause / play"),"+10"};
        for(int i=0;i<labels.length;i++){final int n=i;Button b=new Button(this);b.setText(labels[i]);controls.addView(b);b.setOnClickListener(v->{if(n==0)closeTest();if(n==1)MPVLib.command(new String[]{"seek","-10"});if(n==2)MPVLib.command(new String[]{"cycle","pause"});if(n==3)MPVLib.command(new String[]{"seek","10"});});}
        root.addView(controls,new FrameLayout.LayoutParams(-1,dp(64),Gravity.BOTTOM));
        if(audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED){closeTest();return;}MPVLib.command(new String[]{"loadfile",getFilesDir()+"/sample.mp4"});playing=true;if(!surfaceAvailable){suspendedVideo="auto";MPVLib.setPropertyString("vid","no");}getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);immersive(true);
    }
}
