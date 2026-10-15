#!/bin/bash
# Собирает Lampyris.app под одну архитектуру на готовых библиотеках mpv (набор IINA) и пакует в dist/.
#
#   scripts/build-app.sh arm64     Apple Silicon
#   scripts/build-app.sh x86_64    Mac с Intel
#
# Результат: dist/<arch>/Lampyris.app, dist/Lampyris-<версия>-<arch>.zip и .dmg. Подпись ad-hoc (без сертификата разработчика).
set -euo pipefail

ARCH="${1:-}"
case "$ARCH" in arm64|x86_64) ;; *) echo "Использование: $0 arm64|x86_64" >&2; exit 2 ;; esac
case "$ARCH" in arm64) LABEL="arm64" ;; x86_64) LABEL="intel" ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="$(cat scripts/VERSION)"
BUILD="$(git rev-list --count HEAD 2>/dev/null || echo 1)"
SCRATCH="$ROOT/build/swift-$ARCH"
APP="$ROOT/dist/$ARCH/Lampyris.app"

echo "== Библиотеки ($ARCH)"
scripts/fetch-libs.sh "$ARCH"
export LAMPA_LIBS="$ROOT/build/libs/$ARCH"

echo "== Сборка Swift ($ARCH, release)"
swift build -c release --arch "$ARCH" --scratch-path "$SCRATCH" 2>&1 | grep -v "warning:\|^ *[0-9]* |\|^ *|\|deprecated\|~\|\^" | tail -5
BIN="$(swift build -c release --arch "$ARCH" --scratch-path "$SCRATCH" --show-bin-path)"

echo "== Пакет $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Frameworks" "$APP/Contents/Resources"
cp "$BIN/Lampyris" "$APP/Contents/MacOS/Lampyris"
find "$LAMPA_LIBS" -maxdepth 1 -name "*.dylib" ! -type l -exec cp {} "$APP/Contents/Frameworks/" \;
cp Sources/Lampyris/Resources/*.js "$APP/Contents/Resources/"
cp LICENSE THIRD-PARTY.md "$APP/Contents/Resources/"
sed -e "s/@VERSION@/$VERSION/" -e "s/@BUILD@/$BUILD/" scripts/Info.plist.in > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# Иконка.
ICONSET="$ROOT/build/Lampyris.iconset"
rm -rf "$ICONSET"; swift scripts/make-icon.swift "$ICONSET"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Lampyris.icns"

# В rpath исполняемого файла оставляем только системный Swift и Contents/Frameworks (путь сборки и каталог тулчейна убираем).
EXE="$APP/Contents/MacOS/Lampyris"
otool -l "$EXE" | awk '/LC_RPATH/{f=1} f&&/path/{print $2; f=0}' | while read -r rp; do
  case "$rp" in /usr/lib/swift|@executable_path/../Frameworks) ;; *) install_name_tool -delete_rpath "$rp" "$EXE" ;; esac
done

echo "== Проверка состава"
scripts/verify-bundle.sh "$APP" "$ARCH"

echo "== Подпись (ad-hoc)"
for f in "$APP"/Contents/Frameworks/*.dylib; do codesign --force --sign - --timestamp=none "$f" 2>/dev/null; done
codesign --force --sign - --timestamp=none "$APP" 2>/dev/null
codesign --verify --strict --deep "$APP" && echo "Подпись пакета корректна"

echo "== Упаковка"
mkdir -p dist
ZIP="dist/Lampyris-$VERSION-$LABEL.zip"; DMG="dist/Lampyris-$VERSION-$LABEL.dmg"
rm -f "$ZIP" "$DMG"
ditto -c -k --keepParent "$APP" "$ZIP"
STAGE="$ROOT/build/dmg-$ARCH"; rm -rf "$STAGE"; mkdir -p "$STAGE"; cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname "Lampyris" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
echo
du -sh "$APP" "$ZIP" "$DMG" | sed "s#$ROOT/##"

# Чистим распакованные копии .app: Spotlight/Launchpad показывают их как отдельные приложения.
# Готовые артефакты — .zip и .dmg в dist/. Чтобы оставить .app для отладки: KEEP_APP=1.
rm -rf "$STAGE"
[ -n "${KEEP_APP:-}" ] || rm -rf "$ROOT/dist/$ARCH"
