#!/bin/bash
# Быстрые проверки без сборки приложения: синтаксис shell-скриптов и внедряемого JS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
fail=0
for f in scripts/*.sh; do
  bash -n "$f" && echo "shell ok: $f" || { echo "ОШИБКА синтаксиса: $f" >&2; fail=1; }
done
for f in Sources/Lampyris/Resources/*.js windows/src/*.js android/app/src/main/assets/*.js; do
  "$JSC" -e "new Function(readFile('$f'))" >/dev/null && echo "js ok: $f" || { echo "ОШИБКА синтаксиса: $f" >&2; fail=1; }
done
# В DOM-коде страницы не должно быть append/prepend с несколькими аргументами: Lampa подменяет их версией с одним аргументом.
if grep -n -E "\.(append|prepend)\([^()]*,[^()]*\)" Sources/Lampyris/Resources/mpvTube.js | grep -v '\$(' | grep -v 'window\.\$' | grep -v "append(make(a), make(b))"; then
  echo "ОШИБКА: append/prepend с несколькими аргументами (см. docs/ARCHITECTURE.md)" >&2; fail=1
fi
scripts/test-js.sh || fail=1
exit $fail
