//! Запросы приложения к внешним сервисам (TheIntroDB, Stremio). Страница сама ходить туда не может:
//! это делает приложение с ограничением размера ответа.

use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

fn agent(timeout: Duration) -> Result<ureq::Agent, String> {
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    Ok(ureq::AgentBuilder::new().timeout(timeout).tls_connector(Arc::new(tls)).build())
}

/// GET с ограничением размера; возвращает тело ответа при статусе 200.
pub fn get(url: &str, timeout_secs: u64, max_bytes: usize, accept_json: bool) -> Result<Vec<u8>, String> {
    let agent = agent(Duration::from_secs(timeout_secs))?;
    let mut req = agent.get(url);
    if accept_json {
        req = req.set("Accept", "application/json");
    }
    match req.call() {
        Ok(resp) => {
            if resp.status() != 200 {
                return Err(format!("HTTP {}", resp.status()));
            }
            let mut buf = Vec::new();
            resp.into_reader().take(max_bytes as u64 + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
            if buf.len() > max_bytes {
                return Err("ответ слишком большой".into());
            }
            Ok(buf)
        }
        Err(ureq::Error::Status(code, _)) => Err(format!("HTTP {code}")),
        Err(e) => Err(e.to_string()),
    }
}

/// Проверка доступности сервера перед загрузкой страницы: любой HTTP-ответ означает «доступен».
pub fn reachable(url: &str) -> Result<(), String> {
    let agent = agent(Duration::from_secs(6))?;
    match agent.get(url).call() {
        Ok(_) | Err(ureq::Error::Status(_, _)) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Загрузка в файл с ограничением размера; `progress(получено, всего)` вызывается по ходу. При ошибке частичный файл удаляется.
pub fn download(url: &str, dest: &std::path::Path, max_bytes: usize, mut progress: impl FnMut(u64, Option<u64>)) -> Result<(), String> {
    use std::io::Write;
    let agent = agent(Duration::from_secs(1800))?;
    let resp = match agent.get(url).call() {
        Ok(r) if r.status() == 200 => r,
        Ok(r) => return Err(format!("HTTP {}", r.status())),
        Err(ureq::Error::Status(code, _)) => return Err(format!("HTTP {code}")),
        Err(e) => return Err(e.to_string()),
    };
    let total = resp.header("Content-Length").and_then(|v| v.parse::<u64>().ok());
    if total.is_some_and(|t| t > max_bytes as u64) {
        return Err("файл слишком большой".into());
    }
    let result = (|| -> Result<(), String> {
        let mut file = std::fs::File::create(dest).map_err(|e| format!("не удалось создать файл: {e}"))?;
        let mut reader = resp.into_reader();
        let mut buf = vec![0u8; 64 * 1024];
        let mut done: u64 = 0;
        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("загрузка прервана: {e}"))?;
            if n == 0 {
                break;
            }
            done += n as u64;
            if done > max_bytes as u64 {
                return Err("файл слишком большой".into());
            }
            file.write_all(&buf[..n]).map_err(|e| format!("не удалось записать файл: {e}"))?;
            progress(done, total);
        }
        if total.is_some_and(|t| t != done) {
            return Err("файл получен не полностью".into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(dest);
    }
    result
}
