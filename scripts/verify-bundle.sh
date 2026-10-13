#!/bin/bash
# Проверяет собранный Lampyris.app: архитектура всех файлов, зависимости только внутри пакета или в системе,
# версия macOS не выше заявленной.  Использование: scripts/verify-bundle.sh <Lampyris.app> <arm64|x86_64>
set -uo pipefail
APP="${1:?путь к Lampyris.app}"; ARCH="${2:?arm64|x86_64}"
FW="$APP/Contents/Frameworks"; EXE="$APP/Contents/MacOS/Lampyris"
MIN=$(/usr/libexec/PlistBuddy -c "Print :LSMinimumSystemVersion" "$APP/Contents/Info.plist")
errors=0; count=0
fail() { echo "  ОШИБКА: $*" >&2; errors=$((errors + 1)); }
ver_gt() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n | tail -1)" = "$1" ] && [ "$1" != "$2" ]; }

for f in "$EXE" "$FW"/*.dylib; do
  [ -L "$f" ] && continue
  count=$((count + 1))
  archs=$(lipo -archs "$f" 2>/dev/null); [ "$archs" = "$ARCH" ] || fail "$(basename "$f"): архитектура '$archs', ожидалась $ARCH"
  minos=$(otool -l "$f" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')
  [ -n "$minos" ] && ver_gt "$minos" "$MIN" && fail "$(basename "$f"): minos $minos выше LSMinimumSystemVersion $MIN"
  while read -r dep; do
    case "$dep" in
      @rpath/*) [ -e "$FW/${dep#@rpath/}" ] || fail "$(basename "$f"): нет $dep в Frameworks" ;;
      @executable_path/*|@loader_path/*) ;;
      /usr/lib/*|/System/*) ;;
      *) fail "$(basename "$f"): внешняя зависимость $dep" ;;
    esac
  done < <(otool -L "$f" | tail -n +2 | awk '{print $1}')
done
# Путь сборки не должен остаться в rpath исполняемого файла.
otool -l "$EXE" | awk '/LC_RPATH/{f=1} f&&/path/{print $2; f=0}' | while read -r rp; do
  case "$rp" in @executable_path/*|/usr/lib/swift) ;; *) echo "  ОШИБКА: rpath $rp" >&2; exit 1 ;; esac
done || errors=$((errors + 1))
echo "Проверено файлов: $count, ошибок: $errors (мин. macOS $MIN, $ARCH)"
[ "$errors" = 0 ]
