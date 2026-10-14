//! Страницы приложения: ввод адреса сервера и ошибка загрузки. Кнопки шлют `{m:"app", a:[…]}` через window.ipc.

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

const STYLE: &str = r#"
html,body{height:100%;margin:0;background:#101014;color:#fff;font:16px "Segoe UI",system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center;text-align:center}
main{max-width:30em;padding:2em}
h1{font-size:1.6em;margin:0 0 .4em}
p{opacity:.65;line-height:1.5;margin:.3em 0;word-break:break-word}
input{font:1em "Segoe UI",sans-serif;width:22em;max-width:90vw;padding:.7em 1em;border:0;border-radius:10px;color:#fff;background:rgba(255,255,255,.12);margin-top:1em}
.row{display:flex;gap:.9em;justify-content:center;margin-top:1.8em}
button{font:600 1em "Segoe UI",sans-serif;padding:.7em 1.8em;border:0;border-radius:999px;color:#fff;background:rgba(255,255,255,.12);cursor:pointer}
button.main{background:#fff;color:#000}
button:hover,button:focus{outline:0;transform:scale(1.05)}
"#;

/// Страница вместо чёрного окна, когда адрес сервера не загрузился.
pub fn error(url: &str, message: &str) -> String {
    format!(
        r#"<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="dark"><style>{STYLE}</style>
<main>
<h1>Не удалось загрузить Lampa</h1>
<p>{}</p><p>{}</p>
<div class="row">
<button class="main" autofocus onclick="window.ipc.postMessage(JSON.stringify({{m:'app',a:['retry']}}))">Повторить</button>
<button onclick="window.ipc.postMessage(JSON.stringify({{m:'app',a:['change']}}))">Изменить адрес сервера</button>
</div></main>"#,
        esc(url),
        esc(message)
    )
}

/// Ввод адреса сервера; ранее введённые адреса — в выпадающем списке.
pub fn prompt(initial: &str, history: &[String], note: &str) -> String {
    let options: String = history.iter().map(|h| format!("<option value=\"{}\">", esc(h))).collect();
    format!(
        r#"<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="dark"><style>{STYLE}</style>
<main>
<h1>Адрес сервера Lampa</h1>
<p>Например: 192.168.1.10:9118. Ранее введённые адреса — в выпадающем списке.</p>
<p style="color:#ff8a80;opacity:1">{}</p>
<input id="a" list="h" autofocus value="{}" placeholder="адрес:порт" onkeydown="if(event.key==='Enter')go()">
<datalist id="h">{options}</datalist>
<div class="row"><button class="main" onclick="go()">OK</button></div>
</main>
<script>function go(){{window.ipc.postMessage(JSON.stringify({{m:'app',a:['server',document.getElementById('a').value]}}))}}</script>"#,
        esc(note),
        esc(initial)
    )
}

/// Пустая прозрачная страница для проверки плеера без сервера (LAMPA_MPV_TEST).
pub const TEST_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent}</style>"#;
