//! Звуковые эффекты плеера: эквалайзер, усиление речи, ночной режим. Порт `LampyrisCore/AudioFx.swift`:
//! страница присылает только числа, строку фильтра ffmpeg собирает приложение. Менять оба файла сразу.

/// Метка фильтра в цепочке `af`: по ней он снимается и ставится заново, не затрагивая `af` из mpv.conf и профилей.
pub const LABEL: &str = "lyfx";
pub const BAND_FREQUENCIES: [i64; 10] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const MAX_GAIN: i64 = 12;
const MAX_DIALOGUE: i64 = 3;
const NIGHT_CHAIN: &str = "acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11";

/// Строка для `lavfi=[…]` либо None, когда эффекты не нужны. `bands` — усиление полос в дБ (целые, от -12 до 12),
/// `dialogue` — сила усиления речевого диапазона 0…3, `night` — сжатие громкости ночного профиля.
pub fn graph(bands: &[i64], dialogue: i64, night: bool) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut boosted = false;
    for (i, f) in BAND_FREQUENCIES.iter().enumerate() {
        let Some(g) = bands.get(i).map(|g| (*g).clamp(-MAX_GAIN, MAX_GAIN)) else { break };
        if g == 0 {
            continue;
        }
        if g > 0 {
            boosted = true;
        }
        parts.push(format!("equalizer=f={f}:t=q:w=1.4:g={g}"));
    }
    let d = dialogue.clamp(0, MAX_DIALOGUE);
    if d > 0 {
        boosted = true;
        parts.push(format!("equalizer=f=1000:t=q:w=1:g={d}"));
        parts.push(format!("equalizer=f=2500:t=q:w=0.8:g={}", d * 2));
    }
    if night {
        parts.push(NIGHT_CHAIN.to_string());
    }
    if parts.is_empty() {
        return None;
    }
    // Подъём полос может дать перегрузку: ограничитель держит пик ниже предела.
    if boosted {
        parts.push("alimiter=limit=0.95".to_string());
    }
    Some(parts.join(","))
}

/// Команды mpv: сначала `af remove @lyfx`, затем (если нужно) `af add @lyfx:lavfi=[…]`.
pub fn commands(graph: Option<&str>) -> Vec<Vec<String>> {
    let mut out = vec![vec!["af".to_string(), "remove".to_string(), format!("@{LABEL}")]];
    if let Some(g) = graph {
        out.push(vec!["af".to_string(), "add".to_string(), format!("@{LABEL}:lavfi=[{g}]")]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty() {
        assert_eq!(graph(&[0; 10], 0, false), None);
        assert_eq!(graph(&[], 0, false), None);
    }

    #[test]
    fn bands_clamp_and_limiter() {
        let g = graph(&[20, 0, -30, 0, 0, 0, 0, 0, 0, 0], 0, false);
        assert_eq!(g.as_deref(), Some("equalizer=f=31:t=q:w=1.4:g=12,equalizer=f=125:t=q:w=1.4:g=-12,alimiter=limit=0.95"));
    }

    #[test]
    fn cut_only_has_no_limiter() {
        assert_eq!(graph(&[0, 0, 0, 0, 0, 0, 0, 0, 0, -6], 0, false).as_deref(), Some("equalizer=f=16000:t=q:w=1.4:g=-6"));
    }

    #[test]
    fn dialogue_and_night() {
        assert_eq!(
            graph(&[], 9, true).as_deref(),
            Some("equalizer=f=1000:t=q:w=1:g=3,equalizer=f=2500:t=q:w=0.8:g=6,acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95")
        );
    }

    #[test]
    fn command_pairs() {
        assert_eq!(commands(None), vec![vec!["af", "remove", "@lyfx"]]);
        assert_eq!(commands(Some("x")), vec![vec!["af", "remove", "@lyfx"], vec!["af", "add", "@lyfx:lavfi=[x]"]]);
    }
}
