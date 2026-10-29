import AppKit
import MediaPlayer
import LampyrisCore

/// Медиаклавиши и «Сейчас играет» (Пункт управления, экран блокировки, наушники).
/// Пауза и перемотка выполняются здесь (прямо в mpv); следующая и предыдущая серия передаются странице (Lampa.PlayerPlaylist).
@MainActor
final class NowPlaying {
    private weak var player: MpvPlayer?
    private let sendToPage: (String) -> Void
    private var info: [String: Any] = [:]
    private var active = false
    private var paused = false
    private var elapsed: Double = 0
    private var lastPush: CFAbsoluteTime = 0
    private var artworkURL: URL?
    private static let skipInterval: Double = 10
    private static let maxArtworkBytes = 2_000_000

    init(player: MpvPlayer, sendToPage: @escaping (String) -> Void) {
        self.player = player
        self.sendToPage = sendToPage
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.player?.set("pause", "no") }
            return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.player?.set("pause", "yes") }
            return .success
        }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.player?.set("pause", self.paused ? "no" : "yes")
            }
            return .success
        }
        c.skipForwardCommand.preferredIntervals = [NSNumber(value: Self.skipInterval)]
        c.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.player?.command(["seek", String(Self.skipInterval), "relative+exact"]) }
            return .success
        }
        c.skipBackwardCommand.preferredIntervals = [NSNumber(value: Self.skipInterval)]
        c.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.player?.command(["seek", String(-Self.skipInterval), "relative+exact"]) }
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = e.positionTime
            Task { @MainActor in self?.player?.command(["seek", String(position), "absolute+exact"]) }
            return .success
        }
        c.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.sendToPage("next") }
            return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.sendToPage("prev") }
            return .success
        }
        c.nextTrackCommand.isEnabled = false
        c.previousTrackCommand.isEnabled = false
        c.changePlaybackPositionCommand.isEnabled = true
    }

    /// Название и подпись из карточки Lampa. artwork — https-адрес постера (необязательно).
    func set(title: String, subtitle: String, duration: Double, canNext: Bool, canPrev: Bool, artwork: String?) {
        active = true
        let c = MPRemoteCommandCenter.shared()
        c.nextTrackCommand.isEnabled = canNext
        c.previousTrackCommand.isEnabled = canPrev
        var next: [String: Any] = info
        next[MPMediaItemPropertyTitle] = String(title.prefix(200))
        next[MPMediaItemPropertyArtist] = String(subtitle.prefix(200))
        next[MPMediaItemPropertyPlaybackDuration] = duration > 0 ? duration : nil
        next[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.video.rawValue
        info = next
        push(force: true)
        if let artwork, let url = URL(string: artwork), RemoteMediaURL.artwork(url), url != artworkURL {
            artworkURL = url
            Task { await loadArtwork(url) }
        }
    }

    func clear() {
        active = false
        elapsed = 0
        paused = false
        lastPush = 0
        info = [:]
        artworkURL = nil
        let center = MPNowPlayingInfoCenter.default()
        center.nowPlayingInfo = nil
        center.playbackState = .stopped
        let c = MPRemoteCommandCenter.shared()
        c.nextTrackCommand.isEnabled = false
        c.previousTrackCommand.isEnabled = false
    }

    /// Для проверки: что сейчас передано системе.
    var debugDescription: String {
        let center = MPNowPlayingInfoCenter.default()
        let title = center.nowPlayingInfo?[MPMediaItemPropertyTitle] ?? "-"
        let artist = center.nowPlayingInfo?[MPMediaItemPropertyArtist] ?? "-"
        let hasArt = center.nowPlayingInfo?[MPMediaItemPropertyArtwork] != nil
        return "title=\(title) artist=\(artist) artwork=\(hasArt) state=\(center.playbackState.rawValue) next=\(MPRemoteCommandCenter.shared().nextTrackCommand.isEnabled)"
    }

    /// События mpv: пауза и позиция.
    func handle(_ msg: [String: Any]) {
        guard active, msg["event"] as? String == "property-change", let name = msg["name"] as? String else { return }
        if name == "pause", let flag = msg["data"] as? Bool {
            paused = flag
            push(force: true)
        } else if name == "time-pos", let t = msg["data"] as? Double {
            let jumped = abs(t - elapsed) > 3
            elapsed = t
            if jumped || CFAbsoluteTimeGetCurrent() - lastPush > 5 { push(force: false) }
        } else if name == "duration", let d = msg["data"] as? Double, d > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = d
            push(force: true)
        }
    }

    private func push(force: Bool) {
        guard active else { return }
        lastPush = CFAbsoluteTimeGetCurrent()
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        info[MPNowPlayingInfoPropertyPlaybackRate] = paused ? 0.0 : 1.0
        let center = MPNowPlayingInfoCenter.default()
        center.nowPlayingInfo = info
        center.playbackState = paused ? .paused : .playing
    }

    private func loadArtwork(_ url: URL) async {
        let session = URLSession(configuration: .ephemeral)
        guard let (data, response) = try? await LimitedFetch.data(for: URLRequest(url: url), limit: Self.maxArtworkBytes, session: session, allowedURL: { RemoteMediaURL.artwork($0) }),
              (response as? HTTPURLResponse)?.statusCode == 200,
              (response.mimeType ?? "").hasPrefix("image/"), let image = NSImage(data: data), active,
              artworkURL == url else { return }  // ответ предыдущего фильма не должен заменить постер нового
        nonisolated(unsafe) let picture = image
        // MediaPlayer вызывает обработчик с фоновой очереди: без @Sendable замыкание наследует @MainActor и роняет приложение проверкой изоляции
        info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { @Sendable _ in picture }
        push(force: true)
    }
}
