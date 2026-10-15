# Lampyris

Неофициальный клиент Lampa для macOS (Apple Silicon и Intel) на Swift: окно с WKWebView и воспроизведение через libmpv; версия для Windows (x64 и arm64) в `windows/` на Rust (tao, wry, WebView2, libmpv). Устройство, решения и ограничения описаны в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) и [docs/ARCHITECTURE-windows.md](docs/ARCHITECTURE-windows.md), сборка и установка в [README.md](README.md). Этот файл содержит только указания для ассистента.

## Команды
- Запуск: `swift run` (нужен Homebrew mpv или `LAMPA_LIBS=<каталог с dylib>`); отладка: `LAMPA_DEBUG=1 swift run`.
- Проверки и тесты: `scripts/check.sh`, `swift test`.
- Сборка пакета: `scripts/build-app.sh arm64|x86_64` (результат в `dist/`).
- Windows (на Windows): `cd windows && cargo test --release`; пакет `windows\scripts\build-windows.ps1 -Arch x64|arm64`, установщик `windows\scripts\build-installer.ps1 -Arch x64|arm64` (Inno Setup 6). С Mac проверять через виртуальную машину Windows (например, Parallels, `prlctl exec`): GUI запускается только от пользователя сессии (`--current-user`), от SYSTEM окна не видно.

## Правила
- Язык: комментарии, сообщения коммитов и интерфейс на русском (названия API, ключи настроек и пути на английском).
- Журнал в Windows читать через `Get-Content -Encoding UTF8` (PowerShell 5.1 без этого показывает кириллицу испорченной, хотя файл в UTF-8).
- Не коммитить личные данные: адреса серверов, ключи и токены, пути из домашней папки. Журнал и тесты не должны содержать адреса вида `https://хост/путь?ключ=…`.
- Коммиты и пуши делать только по явной просьбе владельца репозитория; перед пушем помнить, что каждый пуш запускает полный CI (macOS и Windows; репозиторий публичный, минуты бесплатны, но очередь macOS-раннеров бывает долгой). Автор коммитов берётся из настроек git владельца, в конце сообщения строка `Co-Authored-By` ассистента.
- Лицензия проекта GPL-3.0-or-later (libmpv и FFmpeg из набора IINA входят в сборку). Нельзя копировать в проект код без совместимой лицензии (например, файлы без лицензии); новые сторонние компоненты добавлять в `THIRD-PARTY.md`.
- Библиотеки mpv для `.app` брать только из набора IINA с проверкой SHA-256 (`scripts/libs-<arch>.sha256`); обновлять осознанно.

## Что учитывать при правках
- Код должен собираться на Swift 6.3 (раннеры CI): в замыканиях `MainActor.assumeIsolated { … }` ненужный результат отбрасывать через `_ =`.
- В DOM-коде страницы (`Resources/*.js`) использовать `appendChild`, а не `append` и `prepend` с несколькими аргументами: Lampa подменяет их версией с одним аргументом.
- Страница и плагины Lampa недоверенные: любое расширение моста (`MpvBridge`) сначала добавлять как узкий список разрешённого с проверкой в приложении, а не передавать значения из страницы в mpv как есть.
- Логику без интерфейса и без libmpv держать в `Sources/LampyrisCore` и покрывать тестами.
- Общие скрипты страницы (`Sources/Lampyris/Resources/*.js`) используются и в версии для Windows (`include_str!`): не вводить в них API, которых нет в WebView2 и WKWebView. Скрипты Windows (`windows/src/*.js`) проверяются тем же `scripts/check.sh`.
- Файлы `.ps1` хранить в UTF-8 с BOM (иначе Windows PowerShell 5.1 не разберёт кириллицу), вокруг нативных команд `$ErrorActionPreference = 'Continue'` и проверка `$LASTEXITCODE`.
- Версия приложения одна на обе платформы: `scripts/VERSION` (macOS — `Info.plist`, Windows — ресурсы exe через `windows/build.rs`, имена пакетов и установщика); тег релиза `vX.Y.Z` должен ей равняться (проверяет CI). Версию в `windows/Cargo.toml` не менять (0.0.0).
- Версия для Windows: мост обязан повторять списки разрешённого версии для macOS (`bridge.rs` ↔ `MpvBridge.swift`); меняя один, менять оба.
- Автообновление: открытый ключ Ed25519 вшит в `LampyrisCore/Update.swift` (`publicKeyHex`) и `windows/src/update.rs` (`PUBLIC_KEY_HEX`): менять только оба сразу и вместе с секретом GitHub `UPDATE_SIGNING_KEY`; после смены ключа старые установки перестанут принимать обновления (нужна ручная установка). Задача `release` подписывает `SHA256SUMS.txt`. Имена файлов релиза (`Lampyris-<версия>-arm64|intel.zip`, `…-windows-<arch>-setup.exe|.zip`) использует обновление: менять только вместе с кодом. Закрытый ключ и адрес сервера пользователя в репозиторий не попадают.
- После изменения JS проверять `scripts/check.sh`; изменения, которые видны в интерфейсе, проверять на живом запуске (автотестов на интерфейс нет).
