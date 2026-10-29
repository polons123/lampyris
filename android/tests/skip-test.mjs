// Общий регрессионный тест пропуска используется и в scripts/check.sh (JavaScriptCore).
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../../', import.meta.url);
const code = fs.readFileSync(new URL('scripts/tests/skip.test.js', root), 'utf8');
vm.runInNewContext(code, { readFile: path => fs.readFileSync(new URL(path, root), 'utf8') });
console.log('Пропуск: авто, ручной, повторный вход и кнопка до конца сегмента — OK');
