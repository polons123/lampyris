# Сторонние компоненты и сервисы (Lampyris)

Сам lampyris распространяется на условиях GNU GPL версии 3 или (на ваш выбор) более поздней (GPL-3.0-or-later), см. [LICENSE](LICENSE).

## Библиотеки, входящие в сборку `.app`
В `Lampyris.app/Contents/Frameworks` лежат готовые динамические библиотеки mpv, собранные проектом IINA (https://iina.io/dylibs) отдельно под каждую архитектуру (arm64 и x86_64, целевая macOS 11). Их список и контрольные суммы SHA-256 зафиксированы в `scripts/libs-arm64.sha256` и `scripts/libs-x86_64.sha256`: сборка `.app` не пройдёт при несовпадении. Исходники версий и сценарии сборки: https://github.com/iina/deps-buildscripts (`versions.env`, `patches`), исходники самих библиотек у их авторов по ссылкам в `versions.env`.

| Компонент | Версия | Лицензия |
| --- | --- | --- |
| mpv / libmpv | 0.41.0 | GPL-2.0-or-later (сборка с GPL; часть компонентов LGPL-2.1-or-later) |
| FFmpeg (libavcodec, libavformat, libavfilter, libavdevice, libavutil, libswscale, libswresample) | 9.0.2, `--enable-gpl --enable-version3` | GPL-3.0-or-later |
| libplacebo | 7.360.1 | LGPL-2.1-or-later |
| librubberband | 3.x | GPL-2.0-or-later |
| libass, libbluray, libudfread, libsoxr, libfribidi, libunibreak, libuchardet, libarchive | см. `versions.env` | ISC, LGPL-2.1-or-later, BSD, MPL/GPL/LGPL и др. |
| libdav1d, libSvtAv1Enc, libjxl, libwebp, libzimg, liblcms2, libharfbuzz, libfreetype, libfontconfig, libjpeg-turbo, libspeex, libvorbis, libogg, libbs2b, libbrotli, liblz4, libzstd, libluajit, libmujs | см. `versions.env` | BSD, MIT, FTL/GPLv2, WTFPL, zlib и др. (разрешительные) |

Итоговое сочетание GPL-2.0+ и GPL-3.0+ допустимо при распространении под GPL-3.0-or-later. Тексты лицензий отдельных библиотек находятся в их исходных пакетах.

## Библиотеки, входящие в сборку для Windows
В пакет Windows входит `libmpv-2.dll` из непрерывных сборок mpv-winbuild (https://github.com/zhongfly/mpv-winbuild, пакеты `mpv-dev-x86_64` и `mpv-dev-aarch64`, GPL-вариант). Тег релиза, файл и SHA-256 зафиксированы в `windows/scripts/libmpv.lock`; сборка не пройдёт при несовпадении. Состав DLL: mpv (GPL-2.0-or-later), FFmpeg с `--enable-gpl` (GPL-2.0-or-later/GPL-3.0-or-later), libplacebo, libass, dav1d, zimg, lcms2, harfbuzz, freetype, libarchive и другие библиотеки (разрешительные и LGPL); их версии и исходники указаны у сборщика.

Приложение для Windows (Rust) использует: tao и wry (MIT/Apache-2.0), WebView2 Runtime (системный компонент Microsoft, не входит в пакет), `windows` (MIT/Apache-2.0), muda (MIT/Apache-2.0), libloading (ISC), ureq и native-tls (MIT/Apache-2.0; TLS средствами Windows), serde_json, url (MIT/Apache-2.0), ed25519-dalek и curve25519-dalek (BSD-3-Clause; проверка подписи обновлений), sha2 (MIT/Apache-2.0). Полный список — `windows/Cargo.lock`.

## Исходный код
Тем, кому вы передаёте сборку `.app`, исходный код приложения должен быть доступен (требование GPL). Репозиторий: https://github.com/polons123/lampyris — на момент выбора лицензии он приватный: перед раздачей либо сделайте его публичным, либо передавайте исходники вместе со сборкой или по запросу. Исходный код mpv и FFmpeg доступен на https://github.com/mpv-player/mpv и https://ffmpeg.org (версии указаны в таблице).

## Внешние сервисы (не входят в сборку)
- **TMDB** (названия серий, идентификаторы IMDb, постеры): доступ через ключ и настройки самой Lampa. Требование TMDB: «This product uses the TMDB API but is not endorsed or certified by TMDB.»
- **TheIntroDB** (таймкоды заставок и титров): https://theintrodb.org, используется только открытый API, без их кода.
- **Stremio OpenSubtitles v3 / OpenSubtitles** (субтитры): аддон https://opensubtitles-v3.strem.io; субтитры принадлежат их авторам.
- **Lampa** (интерфейс): загружается с вашего сервера, в приложение не входит.

## Android (`android/`)

- Общие скрипты плеера и профили: Lampyris, GPL-3.0-or-later, https://github.com/polons123/lampyris. Исходная локальная версия использована без изменений основного репозитория.
- JNI и схема интеграции libmpv: mpv-android, MIT, https://github.com/mpv-android/mpv-android. Текст лицензии сохранён в android/MPV-ANDROID-LICENSE. JNI-исходники и исходные скрипты сборки включены в android/native/.
- Готовые libmpv, FFmpeg и сопутствующие библиотеки взяты из ранее подготовленной локальной ARM64-сборки mpv-android-lampyris. Хеши файлов включены в android/native/SHA256SUMS.txt. Проект распространяет свою оболочку под GPL-3.0-or-later. Исходники mpv: https://github.com/mpv-player/mpv; FFmpeg: https://github.com/FFmpeg/FFmpeg. Дополнительные зависимости и ссылки — в android/native/buildscripts/include/download-deps.sh.
- CA bundle: пакет корневых сертификатов Mozilla (https://curl.se/ca/cacert.pem, MPL-2.0) для проверки TLS в нативном плеере.
- Gradle Wrapper: Gradle, Apache-2.0, https://github.com/gradle/gradle.
- Android Gradle Plugin: Google, Apache-2.0, https://developer.android.com/build.

Android-оболочка Lampa https://github.com/lampa-app/LAMPA изучена как источник сведений о платформе. Её исходный код в этот прототип не скопирован.

- AndroidX WebKit 1.12.1: Apache-2.0, https://android.googlesource.com/platform/frameworks/support/+/androidx-main/webkit/ . Адаптер AndroidJS запускается до кода страницы.

- ARM32: готовые библиотеки из официального mpv-android 2026-09-17. Происхождение и хеш исходного APK — android/native/ARM32-PROVENANCE.md; исходники JNI/скрипты этого тега — android/native/arm32-upstream/.

