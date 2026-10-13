#!/bin/bash
# Скачивает готовые динамические библиотеки mpv (набор IINA, https://iina.io/dylibs) под одну архитектуру
# в build/libs/<arch> и сверяет SHA-256 с зафиксированным списком scripts/libs-<arch>.sha256.
#
#   scripts/fetch-libs.sh arm64|x86_64          скачать и проверить
#   scripts/fetch-libs.sh arm64|x86_64 --update  скачать и записать новые контрольные суммы (после осознанного обновления)
set -euo pipefail

ARCH="${1:-}"
MODE="${2:-}"
case "$ARCH" in arm64|x86_64) ;; *) echo "Использование: $0 arm64|x86_64 [--update]" >&2; exit 2 ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/build/libs/$ARCH"
LOCK="$ROOT/scripts/libs-$ARCH.sha256"
BASE="https://iina.io/dylibs/$ARCH"
mkdir -p "$DEST"

curl -fsSL --retry 3 "$BASE/filelist.txt" | tr -d '\r' > "$DEST/filelist.txt"
echo "Набор IINA ($ARCH): $(wc -l < "$DEST/filelist.txt" | tr -d ' ') библиотек"

# Загрузка недостающих файлов (5 параллельно).
tr -d '\r' < "$DEST/filelist.txt" | while read -r f; do [ -n "$f" ] && [ ! -s "$DEST/$f" ] && echo "$f"; done \
  | xargs -P5 -I{} sh -c 'curl -fsSL --retry 3 -o "$0/{}" "$1/{}" && echo "  скачано {}"' "$DEST" "$BASE" || true

# Все файлы из списка должны быть на месте.
while read -r f; do [ -s "$DEST/$f" ] || { echo "Нет файла $f" >&2; exit 1; }; done < "$DEST/filelist.txt"

if [ "$MODE" = "--update" ]; then
  (cd "$DEST" && while read -r f; do shasum -a 256 "$f"; done < filelist.txt) > "$LOCK"
  echo "Контрольные суммы записаны в $LOCK"
else
  [ -f "$LOCK" ] || { echo "Нет $LOCK: сначала выполните $0 $ARCH --update" >&2; exit 1; }
  (cd "$DEST" && shasum -a 256 -c "$LOCK" --quiet) && echo "Контрольные суммы совпали ($ARCH)"
  # Лишнего в списке быть не должно: список файлов в lock и на сервере одинаков.
  diff <(awk '{print $2}' "$LOCK" | sort) <(sort "$DEST/filelist.txt") >/dev/null || { echo "Состав набора изменился" >&2; exit 1; }
fi

# Заголовок -lmpv ищет libmpv.dylib; у IINA только libmpv.2.dylib.
ln -sf libmpv.2.dylib "$DEST/libmpv.dylib"
