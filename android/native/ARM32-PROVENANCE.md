# Нативные библиотеки (ARM32 и ARM64)

Обе архитектуры взяты без изменений из официального релиза mpv-android `2026-09-17`:
https://github.com/mpv-android/mpv-android/releases/tag/2026-09-17

| ABI | APK | SHA-256 APK |
| --- | --- | --- |
| armeabi-v7a | `app-default-armeabi-v7a-release.apk` | `30c63f5528530f56cdece5d6466c749976f01bdcd8c8e67ae76e70a54b7243aa` |
| arm64-v8a | `app-default-arm64-v8a-release.apk` | `0b0e0a534dd6b8d2b117f06952e0600064ad97702e48bff02543e3e32107803d` |

Извлекаются только `lib/<ABI>/*.so`. `scripts/fetch-libs.sh` скачивает APK, сверяет суммы из `native/libs.lock`, раскладывает библиотеки в `app/src/main/jniLibs/` и проверяет их по `native/SHA256SUMS.txt`. Ранее использованный набор ARM64 побайтно совпал с этим релизом, поэтому проверенное на устройстве поведение не изменилось. Локальная перекомпиляция mpv/FFmpeg не выполнялась. JNI и скрипты сборки тега сохранены в `arm32-upstream/` (ссылки на исходники зависимостей — в `download-deps.sh`).
