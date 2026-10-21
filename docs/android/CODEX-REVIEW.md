# Замечания по коду Lampyris-Android (для Codex)

Источник: чтение кода (`MainActivity`, `PlaybackService`, `PlayerConfig`, `OnlineFeatures`, `MPVLib`, манифест, `app/build.gradle`). Сборка и проверка на устройстве не выполнялись. Каталог не под git: перед правками сделайте копию.

Пути: `app/src/main/java/io/github/polons123/lampyris/` (далее `…/`), манифест `app/src/main/AndroidManifest.xml`.

## Приоритет 1 — баги и вылеты

### 1. Пересоздание Activity убивает воспроизведение (складное устройство)
- Файл: `AndroidManifest.xml`, `<activity>`.
- Сейчас: `configChanges="orientation|screenSize|keyboardHidden"`.
- Проблема: при складывании/разкладывании и смене размера окна приходят ещё `smallestScreenSize`, `screenLayout`, `density`, `uiMode`. Activity пересоздаётся, mpv (`create` в `onCreate`, `destroy` в `onDestroy`) уничтожается, видео обрывается.
- Что сделать: `orientation|screenSize|smallestScreenSize|screenLayout|uiMode|density|fontScale|layoutDirection|navigation|keyboard|keyboardHidden`.

### 2. Возможный краш `startForegroundService` → `stopService`
- Файлы: `…/MainActivity.java` (`updateMedia`, `clearMedia`, `stopPlayback`), `…/PlaybackService.java`.
- Проблема: `updateMedia(true)` вызывает `startForegroundService`. Если сразу после этого приходит `stopPlayback()` → `clearMedia()` → `stopService`, сервис может остановиться до вызова `startForeground()`. Это `RemoteServiceException`. Воспроизведение: быстрые `open` и `stop`, либо `end-file` с ошибкой.
- Что сделать: в `PlaybackService.onStartCommand` вызывать `startForeground` первым делом на любом пути. Останавливать сервис intent'ом с action `stop` и `stopSelf()` изнутри, а не через `stopService`. Ветка `token==null → stopSelf()` не должна выходить без `startForeground`, если сервис запущен через `startForegroundService`.

### 3. Кнопка «Назад» в тестовом видео ломает экран
- Файл: `…/MainActivity.java`, `testVideo()` и `onBackPressed()`.
- Проблема: `testVideo()` скрывает `web` (`GONE`) и добавляет панель `controls`. `onBackPressed` при `playing==true` вызывает только `stopPlayback()`. WebView остаётся скрытым, панель остаётся, получается чёрный экран.
- Что сделать: вынести закрытие теста в метод `closeTest()` (stop, `web.setVisibility(VISIBLE)`, `root.removeView(controls)`, сброс флагов, `immersive(false)`, `web.reload()`), вызывать из кнопки «Закрыть» и из Back (хранить `controls` в поле).

### 4. Утечка аудиофокуса в `open`
- Файл: `…/MainActivity.java`, `receive()`, `case "open"`.
- Проблема: `requestAudioFocus` вызывается до валидации опций и `applyProfile`. При исключении (`Invalid playback options`, `Invalid buffer`, ошибка профиля) фокус остаётся занятым.
- Что сделать: запрашивать фокус после валидации либо вызывать `abandonAudioFocusRequest` в `catch`.

### 5. Обработчик аудиофокуса слишком грубый
- Файл: `…/MainActivity.java`, `onCreate`, `setOnAudioFocusChangeListener`.
- Проблема: `change<0` ставит паузу при любой потере, включая `LOSS_TRANSIENT_CAN_DUCK` (-3), то есть на каждое уведомление. Нет возобновления на `AUDIOFOCUS_GAIN` после звонка или транзиентной потери.
- Что сделать: обрабатывать `LOSS` (-1, пауза и abandon), `LOSS_TRANSIENT` (-2, пауза с флагом «поставил фокус»), `CAN_DUCK` (-3, снизить громкость или ничего не делать), `GAIN` (+1, возобновить только если паузу поставил фокус, а не пользователь).

### 6. Видео декодируется в фоне
- Файл: `…/MainActivity.java`, `onPause`/`surfaceDestroyed`.
- Проблема: `onPause` пустой. После `surfaceDestroyed` стоит `vo=null`, но видеодорожка продолжает декодироваться. Лишний расход батареи. Для `hwdec=mediacodec` (без `-copy`) требуется surface.
- Что сделать: при уходе в фон во время воспроизведения ставить `vid=no`, при возврате (`surfaceCreated`) возвращать прежнюю видеодорожку. Подход как в mpv-android.

### 7. `applyProfile`: неверные «значения по умолчанию»
- Файл: `…/MainActivity.java`, `applyProfile()`, поле `profileDefaults`.
- Проблема: дефолт запоминается при первом упоминании ключа в профиле. Если к этому моменту Lampa уже изменила `gamma`/`brightness` через `set`, это значение станет «исходным». Отдельно проверить: `getPropertyString("af")` возвращает список фильтров в виде строки, неизвестно, примет ли mpv её обратно при восстановлении после ночного профиля.
- Что сделать: снять дефолты один раз сразу после `MPVLib.init()` для всех ключей из `PlayerConfig` (NUMBERS, ENUMS, `sub-color`, `sub-back-color`, `af`). Для `af` восстанавливать явной пустой строкой и проверить на устройстве.

### 8. Висящий запрос субтитров
- Файл: `…/MainActivity.java`, `onlineRequest`, ветка `subsLoad`.
- Проблема: при несовпадении `playbackGeneration` ответ в JS не отправляется, промис зависает.
- Что сделать: при `generation==document`, но `playbackGeneration!=playback` отправлять `reply(id, ok:false, error)`.

### 9. Нет `POST_NOTIFICATIONS` (Android 13+)
- Файл: `AndroidManifest.xml`, `…/MainActivity.java`.
- Проблема: разрешение не объявлено и не запрашивается. Проверить на устройстве с Android 13+, показывается ли медиауведомление.
- Что сделать: объявить разрешение и запросить его перед первым воспроизведением (без блокировки воспроизведения при отказе).

## Приоритет 2 — батарея и производительность

- **`updateMedia(false)` раз в секунду** (`emitProperty`, ветка `time-pos`). Каждый раз 4 `getPropertyString` и пересборка `MediaMetadata` и `PlaybackState`. Система сама экстраполирует позицию по `position+speed`. Обновлять состояние только при pause, seek, смене скорости и трека; метаданные только при смене заголовка или длительности.
- **`track-list` собирается ~2500 JNI-вызовами в UI-потоке** (`value()`, до 128 треков × 20 полей). Взять `getPropertyString("track-list")` целиком (JSON уже разбирается в конце `value()`) и отфильтровать поля.
- **Нет `WifiLock`.** Добавить `WifiLock` в `PlaybackService` на время воспроизведения. `WakeLock` брать с таймаутом и продлевать, а не `acquire()` без таймаута.
- **Лишняя работа при запуске.** `onCreate` на главном потоке каждый раз копирует `sample.mp4` (4,8 МБ) и `cacert.pem`. Копировать только при отсутствии файла или смене версии; `sample.mp4` — по требованию в `testVideo()`.
- **`asset()` читает JS заново при каждой загрузке страницы** (`mpvTube.js` 140 КБ). Кэшировать строки.

## Приоритет 3 — качество кода

- `MainActivity` — монолит (328 строк, строки по 300+ символов). Выделить `MediaSessionController`, `ProfileManager` (конфиг, `applyProfile`, `mergedProfiles`), `BridgeHandler` (`receive`, `value`, список разрешённых свойств).
- Магические числа: `128` → `setKeepScreenOn`/`FLAG_KEEP_SCREEN_ON`; `17` → `TYPE_CLASS_TEXT|TYPE_TEXT_VARIATION_URI`; `-1` → `MATCH_PARENT`; mpv-события `7/8/21` → именованные константы.
- Устаревшие API: `onBackPressed` → `OnBackInvokedCallback` (для targetSdk 36 `onBackPressed` перестанет вызываться); `setSystemUiVisibility` → `WindowInsetsController`.
- `onDestroy`: перед `web.destroy()` вызвать `root.removeView(web)`.
- `onCreate`: вместо `IllegalStateException` при проблемах с ассетами показывать ошибку и завершать Activity без падения.
- `PlaybackService`: `getParcelableExtra(String)` устарел с API 33, использовать типизированную версию с `MediaSession.Token.class`.
- Мост `set`: проверяет только имя и длину ≤64. Там, где ключ есть в таблицах `PlayerConfig`, валидировать значение через `PlayerConfig.allowed`.

## Приоритет 4 — тесты и сборка

- `tests/PlayerConfigTest.java` — `main` с `AssertionError`, не запускается из Gradle. Перенести в `app/src/test` на JUnit (`testImplementation`). Добавить кейсы: кавычки, `no-` флаги, дубли секций, `[default]` посреди файла, hex-float (`0x1p3`), пустые значения.
- `app/build.gradle`: нет `buildTypes` (подпись release через `keystore.properties`, `minifyEnabled`). Проверить необходимость `keepDebugSymbols += '**/*.so'` и `useLegacyPackaging = true` (раздувают APK/установленный размер).
- `abiFilters 'arm64-v8a'` — оставить, но отметить в README (нет x86/ChromeOS, это видно и в Lint).
- `targetSdk 35` → план перехода на 36 вместе с predictive back.

## Приоритет 5 — сеть и безопасность (мелочи)

- `usesCleartextTraffic="true"` глобально нужен для LAN-серверов Lampa. По возможности ограничить через `network_security_config`.
- `OnlineFeatures.download`: проверка IP и фактическое соединение делают два отдельных DNS-запроса (TOCTOU). Из-за белого списка хостов риск низкий. Добавить блокировку CGNAT (`100.64.0.0/10`) и IPv4-mapped IPv6 для полноты.
- `cacert.pem` вшит и устареет: добавить его обновление в чек-лист релиза. Частный CA для стримов в mpv не заработает.

## Что уже сделано хорошо (не ломать)

- Белые списки `getAllowed`/`setAllowed`, команда только `seek`, `open` только HTTP(S) без userinfo.
- Мост через `WebMessagePort` с одноразовым handshake и проверкой origin.
- `PlayerConfig`: ограниченный набор опций, диапазоны, фиксированный `af`.
- `OnlineFeatures`: белый список хостов, проверка каждого редиректа, лимиты размера, запрет локальных адресов.

## Порядок работ

1. Пункты 1 и 2.
2. Пункты 3–5.
3. `vid=no` в фоне, редкий `updateMedia`, WifiLock.
4. Остальное по приоритетам.
