//! Медиаклавиши и «Сейчас играет» (SystemMediaTransportControls: оверлей громкости, экран блокировки, гарнитуры).
//! Пауза и перемотка выполняются в приложении (прямо в mpv), следующая и предыдущая серия передаются странице
//! (Lampa.PlayerPlaylist). Порт `NowPlaying.swift`.

use crate::{http, log, MediaCmd, UserEvent};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tao::event_loop::EventLoopProxy;
use windows::core::HSTRING;
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Media::Playback::MediaPlayer;
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs, SystemMediaTransportControls,
    SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
    SystemMediaTransportControlsTimelineProperties,
};
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference};

const SKIP_SECONDS: f64 = 10.0;
const MAX_ARTWORK_BYTES: usize = 2_000_000;

#[derive(Default)]
struct State {
    active: bool,
    paused: bool,
    elapsed: f64,
    duration: f64,
    last_push: Option<Instant>,
    artwork: Option<String>,
}

pub struct NowPlaying {
    _player: MediaPlayer,
    smtc: SystemMediaTransportControls,
    state: Mutex<State>,
}

// Объекты WinRT (MediaPlayer, SystemMediaTransportControls) свободнопоточные; своё состояние защищено Mutex.
unsafe impl Send for NowPlaying {}
unsafe impl Sync for NowPlaying {}

fn span(seconds: f64) -> TimeSpan {
    TimeSpan { Duration: (seconds.max(0.0) * 10_000_000.0) as i64 }
}

impl NowPlaying {
    pub fn new(proxy: EventLoopProxy<UserEvent>) -> Result<Arc<NowPlaying>, String> {
        let e = |e: windows::core::Error| e.to_string();
        let player = MediaPlayer::new().map_err(e)?;
        // Системные команды по умолчанию относятся к самому MediaPlayer (у него нет медиа): управляем вручную.
        player.CommandManager().and_then(|c| c.SetIsEnabled(false)).map_err(e)?;
        let smtc = player.SystemMediaTransportControls().map_err(e)?;
        smtc.SetIsEnabled(true).map_err(e)?;
        for f in [
            SystemMediaTransportControls::SetIsPlayEnabled, SystemMediaTransportControls::SetIsPauseEnabled,
            SystemMediaTransportControls::SetIsFastForwardEnabled, SystemMediaTransportControls::SetIsRewindEnabled,
        ] {
            f(&smtc, true).map_err(e)?;
        }
        smtc.SetIsNextEnabled(false).map_err(e)?;
        smtc.SetIsPreviousEnabled(false).map_err(e)?;
        smtc.SetIsStopEnabled(false).map_err(e)?;

        let p = proxy.clone();
        smtc.ButtonPressed(&TypedEventHandler::<SystemMediaTransportControls, SystemMediaTransportControlsButtonPressedEventArgs>::new(
            move |_, args| {
                let Some(args) = args.as_ref() else { return Ok(()) };
                let cmd = match args.Button()? {
                    SystemMediaTransportControlsButton::Play => MediaCmd::Play,
                    SystemMediaTransportControlsButton::Pause => MediaCmd::Pause,
                    SystemMediaTransportControlsButton::FastForward => MediaCmd::Seek(SKIP_SECONDS),
                    SystemMediaTransportControlsButton::Rewind => MediaCmd::Seek(-SKIP_SECONDS),
                    SystemMediaTransportControlsButton::Next => MediaCmd::Next,
                    SystemMediaTransportControlsButton::Previous => MediaCmd::Prev,
                    _ => return Ok(()),
                };
                let _ = p.send_event(UserEvent::Media(cmd));
                Ok(())
            },
        ))
        .map_err(e)?;
        let p = proxy;
        smtc.PlaybackPositionChangeRequested(&TypedEventHandler::<SystemMediaTransportControls, PlaybackPositionChangeRequestedEventArgs>::new(
            move |_, args| {
                if let Some(args) = args.as_ref() {
                    let secs = args.RequestedPlaybackPosition()?.Duration as f64 / 10_000_000.0;
                    let _ = p.send_event(UserEvent::Media(MediaCmd::SeekAbs(secs)));
                }
                Ok(())
            },
        ))
        .map_err(e)?;
        Ok(Arc::new(NowPlaying { _player: player, smtc, state: Mutex::new(State::default()) }))
    }

    /// Название и подпись из карточки Lampa. artwork — https-адрес постера (необязательно).
    pub fn set(self: &Arc<Self>, title: &str, subtitle: &str, duration: f64, can_next: bool, can_prev: bool, artwork: Option<&str>) {
        {
            let mut st = self.state.lock().unwrap();
            st.active = true;
            if duration > 0.0 {
                st.duration = duration;
            }
        }
        let cut = |s: &str| s.chars().take(200).collect::<String>();
        let _ = self.smtc.SetIsNextEnabled(can_next);
        let _ = self.smtc.SetIsPreviousEnabled(can_prev);
        if let Ok(u) = self.smtc.DisplayUpdater() {
            let _ = u.SetType(MediaPlaybackType::Video);
            if let Ok(v) = u.VideoProperties() {
                let _ = v.SetTitle(&HSTRING::from(cut(title)));
                let _ = v.SetSubtitle(&HSTRING::from(cut(subtitle)));
            }
            let _ = u.Update();
        }
        self.push(true);
        if let Some(url) = artwork.and_then(|a| url::Url::parse(a).ok()).filter(http::artwork_url) {
            let changed = {
                let mut st = self.state.lock().unwrap();
                let changed = st.artwork.as_deref() != Some(url.as_str());
                if changed {
                    st.artwork = Some(url.to_string());
                }
                changed
            };
            if changed {
                let me = self.clone();
                std::thread::spawn(move || me.load_artwork(url.as_str()));
            }
        }
    }

    pub fn clear(&self) {
        {
            let mut st = self.state.lock().unwrap();
            *st = State::default();
        }
        let _ = self.smtc.SetPlaybackStatus(MediaPlaybackStatus::Closed);
        let _ = self.smtc.SetIsNextEnabled(false);
        let _ = self.smtc.SetIsPreviousEnabled(false);
        if let Ok(u) = self.smtc.DisplayUpdater() {
            let _ = u.ClearAll();
            let _ = u.Update();
        }
    }

    /// События mpv: пауза, позиция, длительность.
    pub fn handle(&self, msg: &Value) {
        if msg["event"] != "property-change" {
            return;
        }
        let mut st = self.state.lock().unwrap();
        if !st.active {
            return;
        }
        match msg["name"].as_str() {
            Some("pause") => {
                if let Some(flag) = msg["data"].as_bool() {
                    st.paused = flag;
                    drop(st);
                    self.push(true);
                }
            }
            Some("time-pos") => {
                if let Some(t) = msg["data"].as_f64() {
                    let jumped = (t - st.elapsed).abs() > 3.0;
                    st.elapsed = t;
                    let stale = st.last_push.map(|p| p.elapsed() > Duration::from_secs(5)).unwrap_or(true);
                    if jumped || stale {
                        drop(st);
                        self.push(false);
                    }
                }
            }
            Some("duration") => {
                if let Some(d) = msg["data"].as_f64().filter(|d| *d > 0.0) {
                    st.duration = d;
                    drop(st);
                    self.push(true);
                }
            }
            _ => {}
        }
    }


    fn push(&self, _force: bool) {
        let (paused, elapsed, duration) = {
            let mut st = self.state.lock().unwrap();
            if !st.active {
                return;
            }
            st.last_push = Some(Instant::now());
            (st.paused, st.elapsed, st.duration)
        };
        let _ = self.smtc.SetPlaybackStatus(if paused { MediaPlaybackStatus::Paused } else { MediaPlaybackStatus::Playing });
        if let Ok(t) = SystemMediaTransportControlsTimelineProperties::new() {
            let _ = t.SetStartTime(span(0.0));
            let _ = t.SetMinSeekTime(span(0.0));
            let _ = t.SetEndTime(span(duration));
            let _ = t.SetMaxSeekTime(span(duration));
            let _ = t.SetPosition(span(elapsed));
            let _ = self.smtc.UpdateTimelineProperties(&t);
        }
    }

    /// Постер скачивает приложение (https, до 2 МБ, только изображение); ответ предыдущего фильма не заменяет постер нового.
    fn load_artwork(&self, url: &str) {
        let Ok(data) = http::get_media(url, 10, MAX_ARTWORK_BYTES, http::artwork_url) else { return };
        let is_image = data.starts_with(&[0x89, b'P', b'N', b'G']) || data.starts_with(&[0xFF, 0xD8, 0xFF]) || data.starts_with(b"GIF8") || data.starts_with(b"BM");
        if !is_image {
            log::warn("smtc", "постер отклонён: не изображение");
            return;
        }
        let build = || -> windows::core::Result<RandomAccessStreamReference> {
            let stream = InMemoryRandomAccessStream::new()?;
            let writer = DataWriter::CreateDataWriter(&stream)?;
            writer.WriteBytes(&data)?;
            writer.StoreAsync()?.get()?;
            writer.DetachStream()?;
            stream.Seek(0)?;
            RandomAccessStreamReference::CreateFromStream(&stream)
        };
        let Ok(reference) = build() else { return };
        let st = self.state.lock().unwrap();
        if !st.active || st.artwork.as_deref() != Some(url) {
            return;
        }
        if let Ok(u) = self.smtc.DisplayUpdater() {
            let _ = u.SetThumbnail(&reference);
            let _ = u.Update();
        }
    }
}
