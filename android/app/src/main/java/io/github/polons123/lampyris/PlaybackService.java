package io.github.polons123.lampyris;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.session.*;
import android.os.*;

// Уведомление с системным MediaSession; сам декодер принадлежит текущему экрану приложения.
public final class PlaybackService extends Service {
    public static final String SHUTDOWN="lampyris.shutdown";
    private PowerManager.WakeLock wake;
    private android.net.wifi.WifiManager.WifiLock wifi;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean paused=true;
    private final Runnable renewWake=new Runnable(){public void run(){if(!paused){wake.acquire(10*60*1000L);if(!wifi.isHeld())wifi.acquire();handler.postDelayed(this,5*60*1000L);}}};
    private MediaSession.Token token;
    private Notification currentNotification;
    @Override public void onCreate(){super.onCreate();((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel("playback","Lampyris",NotificationManager.IMPORTANCE_LOW));wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Lampyris:playback");wake.setReferenceCounted(false);
        // Без блокировки Wi-Fi уходит в экономный режим при погашенном экране, и сетевой поток буферизуется.
        wifi=((android.net.wifi.WifiManager)getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(Build.VERSION.SDK_INT>=29?android.net.wifi.WifiManager.WIFI_MODE_FULL_LOW_LATENCY:android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF,"Lampyris:playback");wifi.setReferenceCounted(false);}
    private PendingIntent action(String name){return PendingIntent.getService(this,name.hashCode(),new Intent(this,PlaybackService.class).setAction(name),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        // Даже отменённый запуск сначала выполняет контракт startForegroundService.
        promote(currentNotification!=null?currentNotification:notification("Lampyris","",true,true));
        if(intent==null||SHUTDOWN.equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();
        if(action!=null){
            if(token==null){stopSelf();return START_NOT_STICKY;}
            MediaController.TransportControls c=new MediaController(this,token).getTransportControls();
            if(action.equals("play"))c.play();if(action.equals("pause"))c.pause();if(action.equals("back"))c.rewind();if(action.equals("forward"))c.fastForward();if(action.equals("stop"))c.stop();
            return START_NOT_STICKY;
        }
        token=Build.VERSION.SDK_INT>=33?intent.getParcelableExtra("token",MediaSession.Token.class):intent.getParcelableExtra("token");
        if(token==null){stopSelf();return START_NOT_STICKY;}
        paused=intent.getBooleanExtra("paused",true);
        handler.removeCallbacks(renewWake);
        if(paused){if(wake.isHeld())wake.release();if(wifi.isHeld())wifi.release();}else renewWake.run();
        promote(notification(intent.getStringExtra("title"),intent.getStringExtra("subtitle"),paused,intent.getBooleanExtra("ru",true)));
        return START_NOT_STICKY;
    }
    private Notification notification(String title,String subtitle,boolean paused,boolean ru){
        PendingIntent content=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification n=new Notification.Builder(this,"playback").setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(title).setContentText(subtitle).setContentIntent(content).setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setOngoing(!paused).setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_rew,"−10",action("back")).build())
            .addAction(new Notification.Action.Builder(paused?android.R.drawable.ic_media_play:android.R.drawable.ic_media_pause,paused?(ru?"Пуск":"Play"):(ru?"Пауза":"Pause"),action(paused?"play":"pause")).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_ff,"+10",action("forward")).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel,ru?"Закрыть":"Close",action("stop")).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(token).setShowActionsInCompactView(0,1,2)).build();
        return n;
    }
    private void promote(Notification n){
        currentNotification=n;
        if(Build.VERSION.SDK_INT>=29)startForeground(1,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);else startForeground(1,n);
    }
    @Override public IBinder onBind(Intent i){return null;}
    @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);if(wake.isHeld())wake.release();if(wifi.isHeld())wifi.release();stopForeground(true);super.onDestroy();}
}
