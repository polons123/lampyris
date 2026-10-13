# Lampyris

Неофициальный нативный клиент [Lampa](https://github.com/yumata/lampa) для macOS (Apple Silicon и Intel). Lampa — проект своих авторов, Lampyris с ним не связан и не поддерживается им. Приложение на Swift/AppKit с WKWebView и воспроизведением через libmpv.

## Возможности
- mpv вместо встроенного плеера: аппаратное декодирование, HDR/Dolby Vision, AC3/DTS, профили и `mpv.conf` с редактором.
- Продолжение просмотра, запоминание озвучки и субтитров по сериалу, автоповтор при обрыве сети.
- Пропуск заставок и титров по таймкодам TheIntroDB, субтитры из интернета (русские и английские).
- Клавиши плеера (справка по `H`), статистика (`I`), скриншот (`S`), медиаклавиши и «Сейчас играет».
- Запоминание окна, меню приложения, страница ошибки, журнал.

## Установка
Две сборки (обе требуют macOS 13 или новее): `Lampyris-<версия>-arm64` для Mac с Apple Silicon и `Lampyris-<версия>-intel` для Mac с процессором Intel. Откройте .dmg и перетащите Lampyris в «Программы».

Сборка подписана ad-hoc (без сертификата разработчика Apple), поэтому при первом запуске macOS может написать, что не может проверить приложение. Откройте «Системные настройки → Конфиденциальность и безопасность» и нажмите «Всё равно открыть», либо выполните в Терминале `xattr -dr com.apple.quarantine /Applications/Lampyris.app`.

## Сборка .app
```
scripts/build-app.sh arm64      # Apple Silicon
scripts/build-app.sh x86_64     # Intel
```
Скрипт скачивает готовые библиотеки mpv IINA под нужную архитектуру и проверяет их контрольные суммы, собирает приложение, формирует `dist/<arch>/Lampyris.app`, проверяет состав (`scripts/verify-bundle.sh`), подписывает ad-hoc и упаковывает `.zip` и `.dmg` в `dist/`. Нужны Xcode или Command Line Tools со Swift 6; Homebrew и mpv для сборки `.app` не нужны.

## Запуск из исходников
```
brew install mpv        # библиотека для swift run; для сборки .app Homebrew не нужен
cd lampyris && swift run
```
Адрес сервера Lampa берётся из `LAMPA_URL`, затем из настроек, иначе будет спрошен. Подробности и переменные отладки — в [CLAUDE.md](CLAUDE.md).

## Тесты и проверки
```
scripts/check.sh        # синтаксис shell-скриптов и внедряемого JS, запрет append с несколькими аргументами
swift test              # разбор mpv.conf и сокращение адресов в журнале (цель LampyrisCore)
```
`swift test` собирает весь пакет, поэтому библиотеки mpv должны быть доступны: либо Homebrew (`brew install mpv`), либо `LAMPA_LIBS=<каталог с dylib>` (например, после `scripts/fetch-libs.sh arm64`: `LAMPA_LIBS=$PWD/build/libs/arm64`).

## Непрерывная интеграция и выпуск версии
`.github/workflows/ci.yml` (GitHub Actions) на каждый пуш в `main` и на каждый запрос слияния:
1. запускает проверки и тесты на macOS (Apple Silicon);
2. собирает `Lampyris.app` под arm64 (Apple Silicon) и под x86_64 (настоящий Intel-раннер `macos-26-intel`), проверяет состав пакета и делает дымовой запуск (воспроизведение тестового видео);
3. сохраняет `.dmg` и `.zip` каждой сборки как артефакты запуска.

Чтобы выпустить версию, поднимите номер в `scripts/VERSION`, закоммитьте и поставьте тег вида `v0.1.0`: CI соберёт обе сборки и опубликует релиз с `.dmg`, `.zip` и `SHA256SUMS.txt`. Для работы с файлами workflow через `gh` у токена должно быть право `workflow` (`gh auth refresh -h github.com -s workflow`).

## Лицензия
GNU GPL версии 3 или более поздней (GPL-3.0-or-later), см. [LICENSE](LICENSE). Сведения о сторонних компонентах и сервисах — в [THIRD-PARTY.md](THIRD-PARTY.md).
