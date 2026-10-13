# Lampyris

Неофициальный нативный клиент Lampa для macOS (Apple Silicon и Intel) на Swift: окно с WKWebView + воспроизведение через libmpv.
Владелец: GitHub polons123. Язык общения: русский.

## Окружение
- Xcode установлен (/Applications/Xcode.app), Swift 6.4, arm64. Если `xcode-select -p` показывает /Library/Developer/CommandLineTools, `xcodebuild` не работает и `ld` предупреждает о ненайденных путях поиска; лечится `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- libmpv 0.41: для swift run берётся из Homebrew (/opt/homebrew/lib, переопределяется LAMPA_LIBS); заголовки клиентского API лежат в проекте (Sources/CMpv/mpv, лицензия ISC). Для .app используются библиотеки IINA, см. раздел «Сборка .app».
- Сборка/запуск: Swift Package (`swift build`, `swift run`). Xcode нужен для .app, иконки и подписи.
- Рендер: libmpv render API умеет только OpenGL и software (проверено на 0.41), поэтому предупреждения OpenGL deprecated остаются. Встраивание через `--wid` + `gpu-next`/`macvk` на macOS не работает (mpv открывает своё окно), проверено прототипом.

## Образец: Electron-форк lampa-desktop (локальная копия, не менять, только читать)
- src/mpvTube.js: адаптер mpv для Lampa (меню, профили, горячая клавиша P).
- src/downloads.js, src/modules/downloader.js: загрузки через yt-dlp/curl. В lampyris загрузки делать не будем (решение владельца).
- src/toast.js: единые уведомления.
- native/mpv-bridge/mpv_bridge.mm: libmpv в NSOpenGLView под прозрачным веб-видом, `config=no` задаётся явно.
- src/modules/mpvConfig.js: разбор mpv.conf, список BLOCKED опций.
- Профиль Lampa (адрес сервера и т.п.): ~/Library/Application Support/Lampa/ — не копировать в репозиторий.

## Состояние и план
Сделано: окно с WKWebView, libmpv (OpenGL), мост и тюб для Lampa.PlayerVideo, профили и mpv.conf, клавиши плеера, статистика, скриншот, пропуск заставок, субтитры из интернета, медиаклавиши, журнал, сборка .app под arm64 и Intel, тесты и CI, лицензия GPL-3.0-or-later. Загрузки видео (yt-dlp/curl) не делаем (решение владельца).
Осталось: пробный релиз (тег v0.1.0), перед публикацией репозитория разделить этот файл на документацию для людей (docs/) и инструкции для ассистента и решить, когда открывать репозиторий; проверка Intel-сборки на настоящем Mac с Intel (CI запускает её на Intel-раннере без звука и видеоускорения); не проверено вручную: автоповтор при реальном обрыве, статистика торрента, Dolby Vision, профили DTS-HD и Atmos, обложка при ошибке, клавиши ⏯ и «Сейчас играет».

## Структура пакета и тесты
- Sources/CMpv — системная библиотека (module map, заголовки mpv 0.41).
- Sources/LampyrisCore — логика без UI и libmpv: MpvConfig (разбор mpv.conf, профили, список запрещённых опций), Log (журнал, сокращение адресов).
- Sources/Lampyris — приложение (AppKit, WebKit, мост, плеер) и Resources (mpvTube.js, playbackCover.js).
- Tests/LampyrisCoreTests — Swift Testing: MpvConfigTests, LogTests. Запуск `swift test` (нужны библиотеки: Homebrew или LAMPA_LIBS). Остальной код (мост, плеер, JS) автотестами не покрыт; JS проверяется на синтаксис `scripts/check.sh`.

## CI (.github/workflows/ci.yml)
Задачи: test (macos-latest: scripts/check.sh и swift test с библиотеками IINA arm64), build (matrix arm64 на macos-latest и x86_64 на macos-26-intel: scripts/build-app.sh, дымовой запуск с `LAMPA_MPV_TEST='av://lavfi:testsrc=…'`, артефакты), release (по тегу v*: gh release create с SHA256SUMS). На раннерах Swift 6.3.x (Xcode 26.6), а не 6.4: код должен собираться и на нём (коротким замыканиям `MainActor.assumeIsolated { … }` нужен явный `_ =`, если результат не нужен). На виртуальных машинах нет ускоренного OpenGL: MpvVideoView при отсутствии ускоренного формата берёт программный. У gh для пуша workflow нужен scope `workflow`. Минуты macOS в приватном репозитории платные: не гонять CI без необходимости.

## Внедряемые скрипты (Sources/Lampyris/Resources, подключаются в WebViewController и Package.swift)
- mpvTube.js: тюб mpv для Lampa.PlayerVideo, строка формата в шапке (fps, SDR/HDR/Dolby Vision, аудио), запоминание озвучки и субтитров по сериалу (localStorage `mpv_track_prefs`, id сериала из Lampa.Activity.active(): онлайн-плагины не передают card), убирает «MPV» из списков внешних плееров (player, player_iptv, player_torrent) и подписывает «Встроенный» как «Встроенный (MPV)».
- playbackCover.js: обложка открытия видео.

## mpv.conf и профили
- Файл `~/Library/Application Support/Lampyris/mpv.conf` (MpvConfig.swift): опции до первого `[раздела]` общие, `[имя]` — профили. Список запрещённых опций (BLOCKED) там же; `profile` из файла запрещён, буфер: настройка `mpv_buffer_secs` (авто = только лимит 512 МиБ, иначе 1–5 мин); профиль выбирается настройкой `mpv_profile` в разделе «MPV», кнопкой на панели плеера или клавишей P (применяется на лету).
- Общие опции применяются при создании mpv, затем при каждом открытии видео файл читается заново: возврат прежних опций к общему значению/умолчанию (`option-info/<имя>/default-value`), общие и выбранный профиль через set_property/`change-list`. Опции из файла важнее `mpvOptions` страницы.
- Редактор — окно с textarea в mpvTube.js (кнопка в «MPV»), мост: `getConfig`/`setConfig`. `LAMPA_MPV_PROFILE=<имя>` для тестового окна mpv, `LAMPA_MPV_PROFILE2=<имя>` — применить другой профиль через 6 с (проверка возврата опций). Возврат идёт к значениям до mpv.conf (baseline), а не к заводским.

## Правила
- Не коммитить личные данные (адреса серверов, профиль). Коммиты под именем polons123.
- Лицензия: GPL-3.0-or-later (LICENSE, THIRD-PARTY.md). Причина: libmpv и FFmpeg из Homebrew (GPL-2.0+/GPL-3.0+) входят в сборку `.app`. Перед раздачей `.app` исходники должны быть доступны получателям (сейчас репозиторий приватный).

## Безопасность моста mpv
- MpvBridge принимает сообщения только от главного кадра с доверенного источника: адрес сервера Lampa и хосты редиректов при нашей загрузке (WebViewController.trusted). Команды mpv из страницы: только `seek`, `stop`; запись свойств: aid, sid, vid, mute, pause, speed, volume; открытие: http/https/file и опции sid, demuxer-readahead-secs, demuxer-max-bytes. Всё остальное отклоняется с записью в лог (`[mpv] ... отклонено`). При создании mpv: ytdl=no, load-scripts=no.

## Клавиши плеера (mpvTube.js, только при игре mpv)
P — профиль; [ ] — скорость ±0.25, \ — сброс; , . — задержка звука ±0.1 с; Z X — задержка субтитров; S — скриншот в ~/Pictures/Lampyris (MpvVideoView.snapshotPNG: читает уже нарисованный кадр окна и обрезает поля по osd-dimensions; штатный screenshot-to-file не работает с hwdec=videotoolbox, FBO-захват давал искажённую картинку); I — окно статистики; стрелки влево/вправо — перемотка на шаг, вверх/вниз — громкость (Shift+вверх/вниз — панель Lampa). Скорость и задержки сбрасываются при открытии следующего видео.
Обрыв сети: при end-file с ошибкой тюб до 5 раз (до начала воспроизведения — 2 раза) открывает тот же источник заново с позиции −2 с, пауза 1, 4, 9… с, затем показывает ошибку.

## Пропуск заставок (TheIntroDB)
mpvTube.js при открытии видео запрашивает `GET https://api.theintrodb.org/v3/media?tmdb_id=…[&season=…&episode=…]` (без ключа; CORS разрешён; лимит 30 запросов/10 с). Сегменты intro/recap/credits/preview в `start_ms/end_ms`, null = начало/конец. TMDB-id берётся из `playdata.card` или активной карточки; сезон и серия — из `playdata.season/episode`, иначе из S01E02/1x02 в названии; если серия не определена, запрос не делается (в лог `[tidb] пропуск недоступен`). Режим в настройках «MPV»: выкл / кнопка (по умолчанию) / авто (заставка и пересказ сами, титры и анонс кнопкой). Клавиша N пропускает текущий сегмент. Запрос делает приложение (MpvBridge.fetchIntroDB); ключ не используется: чтение таймкодов авторизации не требует.

## Субтитры из интернета
Источник — Stremio OpenSubtitles v3 (`https://opensubtitles-v3.strem.io/subtitles/{movie|series}/{imdb}[:{сезон}:{серия}].json`), без ключа; языки `rus`/`eng`. Ответ — выборка (не все субтитры), поэтому в меню показываем до 12 вариантов, отсортированных по совпадению с именем раздачи и рейтингу `g`. IMDb-id: `card.imdb_id`, иначе TMDB `external_ids` (через Lampa.TMDB). Поиск и скачивание делает приложение (MpvBridge.searchSubtitles / loadSubtitle): файл только с https `*.strem.io`, до 3 МБ, в ~/Library/Caches/Lampyris/subs (старше недели удаляются при запуске), в mpv через `sub-add … select` (MpvPlayer.addSubtitle); страница передаёт только URL из ответа и название. Меню: кнопка на панели плеера или клавиша U (русские / английские / выключить / включить загруженные). Настройка «Субтитры из интернета»: по запросу (по умолчанию) / авто русские / авто English (ищет, если в видео нет дорожки этого языка). Тест sub-add: `LAMPA_MPV_SUBFILE=<файл.srt>` в тестовом окне mpv.

## Сон дисплея
MpvPlayer держит IOPMAssertion «PreventUserIdleDisplaySleep», пока файл открыт (START_FILE/FILE_LOADED) и не на паузе; снимает на END_FILE, паузе (в том числе keep-open в конце) и при shutdown. Проверка: `pmset -g assertions` при `LAMPA_MPV_TEST=<файл>`.

## Частота событий позиции
MpvBridge.forward отправляет `time-pos` и `demuxer-cache-time` на страницу не чаще раза в 150 мс; скачок > 0.5 с (перемотка) уходит сразу, подавленное значение досылается по таймеру. При `LAMPA_DEBUG` каждые 5 с печатается «события позиции за 5 с: от mpv N, на страницу time-pos M».

## Внешние ссылки, инспектор, мост
Web Inspector включён только при LAMPA_DEBUG. Щелчок по ссылке и window.open на чужой хост (не из доверенных источников) открываются в браузере по умолчанию; переход страницы на другой источник скриптом не блокируется, но в лог пишется `[nav]` (мост mpv для него отключён). Мост: `get` только из списка (allowedGetProperties), схемы открытия только http/https, ответы TheIntroDB и Stremio ограничены 2 МБ. Предупреждения и ошибки mpv при LAMPA_DEBUG печатаются как `[mpv/<prefix>] <level>: <text>`.

## Журнал (Log.swift)
Всегда: короткие сообщения приложения (отклонения моста, [nav], ошибки навигации и mpv init) идут в системный журнал macOS (os.Logger, subsystem io.github.polons123.lampyris, видны в Console.app). «Подробный журнал» (меню Lampa, выключен по умолчанию, UserDefaults `verboseLog`) добавляет консоль страницы, предупреждения mpv и статистику и пишет всё в ~/Library/Logs/Lampyris/lampa.log (ротация 2 МБ × 3 файла); в файле адреса http(s) сокращаются до схемы и хоста (в ссылках бывают ключи и токены). LAMPA_DEBUG=1 = подробный режим + вывод в stdout (для запуска из терминала). Консоль страницы пересылается по флагу window.__lv, переключается без перезагрузки.

## Вид субтитров mpv
Настройки «MPV»: размер (sub-scale 0.7–2), положение (sub-pos 100–85), цвет (sub-color), фон (sub-border-style outline-and-shadow / background-box + sub-back-color), ключи Storage `mpv_sub_size/pos/color/box`; применяются в openAt до загрузки файла (api.set), mpv.conf применяется позже и важнее. Свойства разрешены в мосте (allowedSetProperties). Проверка: `LAMPA_MPV_TEST=<видео> LAMPA_MPV_SUBFILE=<srt> LAMPA_MPV_SUBSTYLE="sub-scale=1.8,sub-color=#FFFF00" LAMPA_MPV_SHOT=1`.

## Медиаклавиши и «Сейчас играет» (NowPlaying.swift)
MPRemoteCommandCenter: play/pause/toggle и перемотка ±10 с выполняются в приложении (mpv), ползунок позиции — seek; ⏭/⏮ приложение отправляет странице (`window.__mpvRemote('next'|'prev')` → Lampa.PlayerPlaylist.next/prev), кнопки активны только при плейлисте. MPNowPlayingInfoCenter: название и подпись («Сезон · Серия · название») из тюба (sendNowPlaying: после первого кадра и через 4 с), длительность и позиция из событий mpv, постер TMDB (https, до 2 МБ, image/*, кэш по URL). Очищается в destroy. Проверка без видео: `LAMPA_MPV_TEST=<видео> LAMPA_MPV_NOWPLAYING=1`.

## Устойчивость к гонкам
- Перезагрузка или замена страницы (⌘R, смена сервера, любой новый документ в главном кадре): `MpvBridge.pageDidReset` останавливает mpv и очищает «Сейчас играет».
- Субтитры из интернета: `MpvPlayer.openGeneration` растёт при каждом открытии; скачанный файл подключается, только если видео не сменилось.
- Автоповтор: лимит и позиция опираются на `state.everLoaded` (воспроизведение уже начиналось), а не на `state.loaded`, который openAt сбрасывает.
- Постер «Сейчас играет»: ответ принимается только если URL совпадает с текущим.

## Сборка .app (scripts/)
Две отдельные сборки, не универсальная: `scripts/build-app.sh arm64|x86_64` → dist/<arch>/Lampyris.app, dist/Lampyris-<версия>-<arm64|intel>.zip/.dmg. Библиотеки mpv — готовые наборы IINA (`https://iina.io/dylibs/<arch>`, mpv 0.41.0, FFmpeg 9.0.2 GPL, minos 11), скачиваются `scripts/fetch-libs.sh` в build/libs/<arch> и сверяются с `scripts/libs-<arch>.sha256` (обновление: `fetch-libs.sh <arch> --update`, только осознанно). Package.swift берёт каталог библиотек из `LAMPA_LIBS` (по умолчанию Homebrew для swift run); заголовки mpv лежат в Sources/CMpv/mpv (ISC), поэтому Homebrew для сборки не нужен. Минимум macOS 13 (Intel Mac не получает macOS 27, Tahoe 26 — последняя). Intel-сборка кросс-компилируется на Apple Silicon (`swift build --arch x86_64`); запуск проверен только для arm64, для Intel нужна Rosetta (`softwareupdate --install-rosetta`) или настоящий Intel Mac. Подпись ad-hoc; bundle id `io.github.polons123.lampyris`: у .app свои настройки и данные WebKit, отдельные от `swift run`. Иконка рисуется scripts/make-icon.swift. Проверка пакета: scripts/verify-bundle.sh.
