package io.github.polons123.lampyris;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

import java.io.File;
import java.util.Locale;

/**
 * Ответ системного установщика на установку обновления. Приёмник объявлен в манифесте как не экспортируемый и вызывается
 * только по явному PendingIntent, который приложение само передало установщику, поэтому посторонние приложения прислать
 * сюда подложный ответ (и заставить открыть чужой Intent) не могут, в том числе на Android до 13.
 */
public final class UpdateResultReceiver extends BroadcastReceiver {
    @Override @SuppressWarnings("deprecation")
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Системное окно подтверждения установки.
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return;
        }
        File[] files = new File(context.getCacheDir(), "update").listFiles();
        if (files != null) for (File f : files) f.delete();
        if (status == PackageInstaller.STATUS_SUCCESS) return;
        boolean ru = context.getSharedPreferences("MainActivity", 0).getString("language", Locale.getDefault().getLanguage()).equals("ru");
        String reason = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        String text = status == PackageInstaller.STATUS_FAILURE_CONFLICT || status == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE
            ? (ru ? "подпись не совпала с установленной версией (например, она поставлена из другой сборки): удалите приложение и установите релиз заново"
                  : "the signature does not match the installed version (for example it came from another build): uninstall the app and install the release again")
            : status == PackageInstaller.STATUS_FAILURE_ABORTED ? (ru ? "установка отменена" : "the installation was cancelled") : (reason == null ? "" : reason);
        Toast.makeText(context, (ru ? "Установка не удалась: " : "Installation failed: ") + text, Toast.LENGTH_LONG).show();
    }
}
