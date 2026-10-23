package io.github.polons123.lampyris;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;

/**
 * Обновление приложения изнутри. Цепочка доверия та же, что на macOS и Windows: подпись Ed25519 файла SHA256SUMS.txt релиза
 * (открытый ключ вшит, UpdateLogic) → SHA-256 нужного APK из этого списка → установка системным установщиком (PackageInstaller),
 * который сам проверяет, что подпись APK совпадает с подписью установленного приложения. Адреса файлов строятся из тега,
 * а не берутся из ответа API. Сеть — UpdateNet (только GitHub по HTTPS), логика без Android — UpdateLogic.
 */
final class AppUpdater {
    private static final String KEY_AUTO = "update_auto", KEY_LAST = "update_last", KEY_SKIPPED = "update_skipped";
    private static final long DAY = 24L * 3600 * 1000;

    private static final class Release {
        final String version, notes;
        Release(String version, String notes) { this.version = version; this.notes = notes; }
    }

    private final Activity activity;
    private final SharedPreferences prefs;
    private final BooleanSupplier ru, playing;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean busy, cancelled, destroyed;
    private AlertDialog progressDialog;
    private ProgressBar progressBar;
    private TextView progressText;

    AppUpdater(Activity activity, SharedPreferences prefs, BooleanSupplier ru, BooleanSupplier playing) {
        this.activity = activity;
        this.prefs = prefs;
        this.ru = ru;
        this.playing = playing;
        cleanCache();
    }

    void destroy() {
        destroyed = true;
        cancelled = true;
        worker.shutdownNow();
        dismissProgress();
    }

    private String tr(String r, String e) { return ru.getAsBoolean() ? r : e; }
    private File cacheDir() { return new File(activity.getCacheDir(), "update"); }

    /** Файлы прошлых загрузок не нужны: после успешной установки процесс перезапускается, после сбоя файл остаётся. */
    private void cleanCache() {
        File[] files = cacheDir().listFiles();
        if (files != null) for (File f : files) f.delete();
    }

    boolean autoEnabled() { return prefs.getBoolean(KEY_AUTO, true); }
    void setAuto(boolean on) { prefs.edit().putBoolean(KEY_AUTO, on).apply(); }

    /** Проверка при запуске: не чаще раза в сутки, молча, если обновления нет; не во время просмотра. */
    void checkAuto() {
        if (!autoEnabled() || playing.getAsBoolean() || System.currentTimeMillis() - prefs.getLong(KEY_LAST, 0) < DAY) return;
        check(false);
    }

    void checkManual() { check(true); }

    private void check(boolean manual) {
        if (busy || destroyed) return;
        busy = true;
        if (manual) Toast.makeText(activity, tr("Проверяю обновления…", "Checking for updates…"), Toast.LENGTH_SHORT).show();
        worker.execute(() -> {
            Release release = null;
            String error = null;
            try { release = fetchRelease(); } catch (Exception e) { error = message(e); }
            final Release found = release;
            final String failure = error;
            ui.post(() -> {
                busy = false;
                if (destroyed) return;
                if (failure != null) {
                    if (manual) Toast.makeText(activity, tr("Не удалось проверить обновления: ", "Could not check for updates: ") + failure, Toast.LENGTH_LONG).show();
                    return;
                }
                prefs.edit().putLong(KEY_LAST, System.currentTimeMillis()).apply();
                String current = BuildConfig.VERSION_NAME;
                if (found == null || !UpdateLogic.isNewer(found.version, current)) {
                    if (manual) Toast.makeText(activity, tr("У вас последняя версия: ", "You are up to date: ") + current, Toast.LENGTH_LONG).show();
                    return;
                }
                // Пропущенную версию автопроверка не предлагает; ручная — предлагает всегда.
                if (!manual && found.version.equals(prefs.getString(KEY_SKIPPED, ""))) return;
                if (!manual && playing.getAsBoolean()) return;
                offer(found, current);
            });
        });
    }

    private Release fetchRelease() throws Exception {
        JSONObject o = new JSONObject(new String(UpdateNet.getBytes(UpdateLogic.LATEST_URL, UpdateLogic.MAX_META_BYTES, "application/vnd.github+json"), StandardCharsets.UTF_8));
        String version = UpdateLogic.releaseVersion(o.optString("tag_name"), o.optBoolean("draft"), o.optBoolean("prerelease"));
        return version == null ? null : new Release(version, o.optString("body"));
    }

    private void offer(Release release, String current) {
        String notes = release.notes.replaceAll("\\*\\*Full Changelog\\*\\*:.*", "").trim();
        if (notes.length() > 1200) notes = notes.substring(0, 1200) + "…";
        String text = tr("Версия ", "Version ") + release.version + tr(" (у вас ", " (you have ") + current + ")." + (notes.isEmpty() ? "" : "\n\n" + notes);
        new AlertDialog.Builder(activity).setTitle(tr("Доступно обновление", "Update available")).setMessage(text)
            .setPositiveButton(tr("Установить", "Install"), (d, w) -> download(release))
            .setNeutralButton(tr("Пропустить эту версию", "Skip this version"), (d, w) -> prefs.edit().putString(KEY_SKIPPED, release.version).apply())
            .setNegativeButton(tr("Позже", "Later"), null).show();
    }

    private void showProgress() {
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * activity.getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);
        progressText = new TextView(activity);
        progressBar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(1000);
        progressBar.setIndeterminate(true);
        box.addView(progressText);
        box.addView(progressBar);
        progressDialog = new AlertDialog.Builder(activity).setTitle(tr("Загрузка обновления", "Downloading the update")).setView(box)
            .setNegativeButton(tr("Отмена", "Cancel"), (d, w) -> cancelled = true).setCancelable(false).show();
    }

    private void dismissProgress() {
        if (progressDialog != null) { try { progressDialog.dismiss(); } catch (Exception ignored) {} progressDialog = null; }
    }

    private void download(Release release) {
        if (busy || destroyed) return;
        busy = true;
        cancelled = false;
        showProgress();
        final String name = UpdateLogic.assetName(release.version, installedAbi());
        worker.execute(() -> {
            File apk = null;
            String error = null;
            try {
                apk = fetchVerifiedApk(release, name);
            } catch (Exception e) {
                error = cancelled ? null : message(e);
            }
            final File file = apk;
            final String failure = error;
            ui.post(() -> {
                busy = false;
                dismissProgress();
                if (destroyed) { if (file != null) file.delete(); return; }
                if (failure != null) Toast.makeText(activity, tr("Обновление не установлено: ", "Update not installed: ") + failure, Toast.LENGTH_LONG).show();
                else if (file != null) install(file, release);
            });
        });
    }

    /** Скачивает подписанный список сумм, проверяет подпись, затем APK и его сумму; возвращает готовый к установке файл. */
    private File fetchVerifiedApk(Release release, String name) throws Exception {
        String base = UpdateLogic.DOWNLOAD_BASE + "/v" + release.version;
        byte[] sums = UpdateNet.getBytes(base + "/SHA256SUMS.txt", UpdateLogic.MAX_META_BYTES, null);
        byte[] sig = UpdateNet.getBytes(base + "/SHA256SUMS.txt.sig", 1024, null);
        if (!UpdateLogic.verifySums(sums, sig)) throw new Exception(tr("подпись списка контрольных сумм неверна", "the checksum list signature is invalid"));
        Map<String, String> table = UpdateLogic.parseSums(new String(sums, StandardCharsets.UTF_8));
        String expected = table.get(name);
        if (expected == null) throw new Exception(tr("в релизе нет файла ", "the release has no file ") + name);
        File dir = cacheDir();
        if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception(tr("нет места для загрузки", "no space to download"));
        File apk = new File(dir, name);
        String actual = UpdateNet.downloadFile(base + "/" + name, apk, UpdateLogic.MAX_APK_BYTES, new UpdateNet.Progress() {
            long last;
            @Override public void update(long done, long total) {
                long now = System.currentTimeMillis();
                if (now - last < 250) return;
                last = now;
                ui.post(() -> {
                    if (progressBar == null || progressText == null) return;
                    String mb = String.format(java.util.Locale.US, "%.1f", done / 1048576.0);
                    if (total > 0) { progressBar.setIndeterminate(false); progressBar.setProgress((int) (done * 1000 / total)); progressText.setText(mb + " / " + String.format(java.util.Locale.US, "%.1f", total / 1048576.0) + tr(" МБ", " MB")); }
                    else progressText.setText(mb + tr(" МБ", " MB"));
                });
            }
            @Override public boolean cancelled() { return cancelled; }
        });
        if (!actual.equals(expected)) { apk.delete(); throw new Exception(tr("контрольная сумма файла не совпала", "the file checksum does not match")); }
        // Своё ли это приложение и новее ли оно установленного (подпись APK проверит сам установщик).
        PackageInfo info = activity.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (info == null || !activity.getPackageName().equals(info.packageName)) { apk.delete(); throw new Exception(tr("файл не является приложением Lampyris", "the file is not the Lampyris app")); }
        long code = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        if (code != UpdateLogic.versionCode(release.version) || code <= BuildConfig.VERSION_CODE) { apk.delete(); throw new Exception(tr("версия в файле не подходит", "the version in the file does not fit")); }
        return apk;
    }

    private void install(File apk, Release release) {
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(activity).setTitle(tr("Нужно разрешение", "Permission needed"))
                .setMessage(tr("Чтобы установить обновление, разрешите Lampyris установку приложений: откроются настройки, включите переключатель и вернитесь в приложение, затем снова проверьте обновления.",
                    "To install the update, allow Lampyris to install apps: settings will open, turn the switch on, come back and check for updates again."))
                .setPositiveButton(tr("Открыть настройки", "Open settings"), (d, w) -> activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))))
                .setNegativeButton(tr("Отмена", "Cancel"), (d, w) -> apk.delete()).show();
            return;
        }
        try {
            PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(activity.getPackageName());
            params.setSize(apk.length());
            int id = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(id)) {
                try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("lampyris.apk", 0, apk.length())) {
                    byte[] buffer = new byte[65536];
                    int n;
                    while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                    session.fsync(out);
                }
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                Intent result = new Intent(activity, UpdateResultReceiver.class);
                session.commit(PendingIntent.getBroadcast(activity, id, result, flags).getIntentSender());
            }
            Toast.makeText(activity, tr("Установка версии ", "Installing version ") + release.version + "…", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            apk.delete();
            Toast.makeText(activity, tr("Установка не удалась: ", "Installation failed: ") + message(e), Toast.LENGTH_LONG).show();
        }
    }

    /** Архитектура установленных библиотек приложения (по каталогу lib/arm64 или lib/arm), иначе первая архитектура устройства. */
    private String installedAbi() {
        String dir = activity.getApplicationInfo().nativeLibraryDir;
        String last = dir == null ? "" : new File(dir).getName();
        if (last.equals("arm64")) return "arm64-v8a";
        if (last.equals("arm")) return "armeabi-v7a";
        return Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "";
    }

    private String message(Exception e) {
        String m = e.getMessage();
        if (m == null || m.isEmpty()) return e.getClass().getSimpleName();
        if (m.startsWith("HTTP 403") || m.startsWith("HTTP 429")) return tr("GitHub временно ограничил запросы, попробуйте позже", "GitHub is rate limiting requests, try again later");
        return m.length() > 160 ? m.substring(0, 160) : m;
    }
}
