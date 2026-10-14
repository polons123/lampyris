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
