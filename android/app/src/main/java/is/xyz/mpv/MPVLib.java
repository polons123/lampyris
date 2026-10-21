package is.xyz.mpv;

import android.content.Context;
import android.view.Surface;

// Совместимый с JNI mpv-android интерфейс. Имена и сигнатуры фиксированы libplayer.so.
public final class MPVLib {
    static { System.loadLibrary("mpv"); System.loadLibrary("player"); }
    public interface Listener { void property(String name, Object value); void event(int id); }
    public static volatile Listener listener;
    public static native void create(Context context);
    public static native void init();
    public static native void destroy();
    public static native void attachSurface(Surface surface);
    public static native void detachSurface();
    public static native void command(String[] args);
    public static native int setOptionString(String name, String value);
    public static native String getPropertyString(String name);
    public static native void setPropertyString(String name, String value);
    public static native Double getPropertyDouble(String name);
    public static native void observeProperty(String name, int format);
    public static void eventProperty(String name) { send(name, null); }
    public static void eventProperty(String name, boolean value) { send(name, value); }
    public static void eventProperty(String name, long value) { send(name, value); }
    public static void eventProperty(String name, double value) { send(name, value); }
    public static void eventProperty(String name, String value) { send(name, value); }
    private static void send(String name, Object value) { Listener l = listener; if (l != null) l.property(name, value); }
    public static void event(int id) { Listener l = listener; if (l != null) l.event(id); }
    public static void logMessage(String prefix, int level, String text) { /* Не пишем адреса потоков в журнал. */ }
}
