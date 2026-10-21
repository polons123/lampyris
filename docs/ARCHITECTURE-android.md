# Lampyris для Android: устройство

Оболочка на Java (без Kotlin и AndroidX, кроме `androidx.webkit`): `MainActivity` держит `SurfaceView` с libmpv под прозрачным `WebView` с Lampa. Подробности и ограничения — в [android/README.md](../android/README.md), история и ревью — в [docs/android/](android/).

- **Мост.** `android-bridge.js` (внедряется после загрузки страницы) принимает порт `WebMessagePort` по одноразовому handshake и даёт странице тот же интерфейс `window.webkit.messageHandlers.mpv`, что на macOS и Windows. `MainActivity.receive` — белые списки свойств (`getAllowed`, `setAllowed`), значения проверяет `PlayerConfig`. Менять списки нужно вместе с `MpvBridge.swift` и `windows/src/bridge.rs`.
- **`lampa-android.js`** внедряется до кода страницы только на выбранном сервере (`addDocumentStartJavaScript`): объект `AndroidJS` (платформа, `httpReq`, внешние ссылки). Версия протокола `Lampyris-<версия>-28`: `__VERSION__` подставляется из `BuildConfig`.
- **Общие скрипты** `mpvTube.js`, `playbackCover.js` лежат копиями в `android/app/src/main/assets/`; `tablet.js` и `android-bridge.js` только для Android.
- **Воспроизведение в фоне:** `PlaybackService` (уведомление с `MediaSession`, WakeLock и WifiLock только пока идёт видео).
- **Сеть:** `OnlineFeatures` (субтитры, TheIntroDB) — только HTTPS на фиксированных хостах, `NetworkAddressPolicy` отсекает приватные адреса.
- **Версия:** `scripts/VERSION` → `versionName`, `versionCode = X*10000 + Y*100 + Z`.
- **Нативные библиотеки** (`jniLibs`, около 58 МБ) в git не хранятся: `android/scripts/fetch-libs.sh` скачивает их из релиза mpv-android по `android/native/libs.lock`; происхождение и суммы — `android/native/ARM32-PROVENANCE.md`, `SHA256SUMS.txt`.
