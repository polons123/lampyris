#!/bin/bash
# Скачивает нативные библиотеки mpv/FFmpeg для Android из релиза mpv-android, сверяет SHA-256 и раскладывает их в app/src/main/jniLibs.
#
#   scripts/fetch-libs.sh            обе архитектуры (arm64-v8a и armeabi-v7a)
#   scripts/fetch-libs.sh arm64-v8a  одна
#
# Список файлов и суммы: native/libs.lock; суммы самих .so: native/SHA256SUMS.txt (проверяются после распаковки).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WORK="$ROOT/build/libs-download"
mkdir -p "$WORK"
WANT="${1:-}"

sha256() { if command -v shasum >/dev/null; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }

while read -r abi tag file sum; do
  case "$abi" in ''|\#*) continue ;; esac
  [ -z "$WANT" ] || [ "$WANT" = "$abi" ] || continue
  apk="$WORK/$file"
  if [ ! -f "$apk" ] || [ "$(sha256 "$apk")" != "$sum" ]; then
    echo "== Загрузка $file ($tag)"
    curl -sSfL --retry 3 -o "$apk" "https://github.com/mpv-android/mpv-android/releases/download/$tag/$file"
  fi
  [ "$(sha256 "$apk")" = "$sum" ] || { echo "ОШИБКА: контрольная сумма $file не совпала" >&2; exit 1; }
  dest="app/src/main/jniLibs/$abi"
  rm -rf "$dest"; mkdir -p "$dest"
  unzip -q -j -o "$apk" "lib/$abi/*.so" -d "$dest"
  echo "== $abi: $(ls "$dest" | wc -l | tr -d ' ') библиотек"
done < native/libs.lock

# Суммы раскладанных библиотек.
fail=0
while read -r sum path; do
  [ -f "$path" ] || continue
  [ -z "$WANT" ] || case "$path" in */"$WANT"/*) ;; *) continue ;; esac
  [ "$(sha256 "$path")" = "$sum" ] || { echo "ОШИБКА: $path не совпадает с SHA256SUMS.txt" >&2; fail=1; }
done < native/SHA256SUMS.txt
[ "$fail" = 0 ] && echo "Библиотеки проверены"
exit "$fail"
