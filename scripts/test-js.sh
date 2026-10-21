#!/bin/bash
# Модульные тесты чистой логики страницы (подписи дорожек, сопоставление выбора): блок между маркерами
# @pure-begin и @pure-end в mpvTube.js запускается в jsc вместе с scripts/tests/*.test.js. Без сборки приложения.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0
for t in scripts/tests/*.test.js; do
  {
    echo "(function () {"
    sed -n '/@pure-begin/,/@pure-end/p' Sources/Lampyris/Resources/mpvTube.js
    cat "$t"
    echo "})();"
  } > "$TMP/run.js"
  if "$JSC" "$TMP/run.js"; then echo "js tests ok: $t"; else echo "ОШИБКА тестов: $t" >&2; fail=1; fi
done
exit $fail
