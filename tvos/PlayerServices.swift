import Foundation

@objc public final class PlayerServices: NSObject {
    @objc public static func artwork(_ url: URL, completion: @escaping (Data?) -> Void) -> URLSessionTask? {
        // A download task streams to a temporary file so a large response never fills RAM.
        let session = URLSession(configuration: .ephemeral)
        let task = session.downloadTask(with: URLRequest(url: url, timeoutInterval: 8)) { file, response, _ in
            defer { session.finishTasksAndInvalidate() }
            var data: Data?
            if let file, let response = response as? HTTPURLResponse, response.statusCode == 200,
               response.mimeType?.hasPrefix("image/") == true,
               let bytes = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, bytes <= 8_000_000 {
                data = try? Data(contentsOf: file)
            }
            let result = data
            DispatchQueue.main.async { completion(result) }
        }
        task.resume()
        return task
    }

    @objc public static func audioFilter(_ speech: Bool, night: Bool) -> String {
        AudioFx.graph(bands: [], dialogue: speech ? 2 : 0, night: night).map { "lavfi=[\($0)]" } ?? ""
    }

    private static func fetch(_ url: URL, limit: Int, subtitles: Bool) async throws -> Data {
        let (data, response) = try await LimitedFetch.data(for: URLRequest(url: url, timeoutInterval: 12), limit: limit,
            allowedURL: { subtitles ? RemoteMediaURL.subtitle($0) : $0.scheme == "https" && $0.host == "api.theintrodb.org" })
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }

    @objc public static func intros(_ id: Int, season: Int, episode: Int, completion: @escaping ([[String: Any]]) -> Void) {
        Task { @MainActor in
            var url = URLComponents(string: "https://api.theintrodb.org/v3/media")!
            var query = [URLQueryItem(name: "tmdb_id", value: String(id))]
            if episode > 0 {
                query += [URLQueryItem(name: "season", value: String(season)), URLQueryItem(name: "episode", value: String(episode))]
            }
            url.queryItems = query
            do {
                let data = try await fetch(url.url!, limit: 500_000, subtitles: false)
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                var segments = [[String: Any]]()
                for kind in ["intro", "credits", "recap"] {
                    for row in json?[kind] as? [[String: Any]] ?? [] {
                        let start = (row["start_ms"] as? NSNumber)?.doubleValue ?? 0
                        let end = (row["end_ms"] as? NSNumber)?.doubleValue
                        guard start >= 0, end.map({ $0 > start }) ?? (kind == "credits") else { continue }
                        segments.append(["kind": kind, "start": NSNumber(value: start/1000), "end": NSNumber(value: (end ?? -1000)/1000)])
                    }
                }
                completion(segments)
            } catch { completion([]) }
        }
    }

    @objc public static func subtitles(_ imdb: String, season: Int, episode: Int, completion: @escaping ([[String: String]], String?) -> Void) {
        Task { @MainActor in
            guard imdb.range(of: #"^tt[0-9]{6,10}$"#, options: .regularExpression) != nil else {
                completion([], "В карточке отсутствует IMDb ID"); return
            }
            let path = episode > 0 ? "series/\(imdb):\(season):\(episode)" : "movie/\(imdb)"
            do {
                let data = try await fetch(URL(string: "https://opensubtitles-v3.strem.io/subtitles/\(path).json")!, limit: 2_000_000, subtitles: true)
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                let rows = (json?["subtitles"] as? [[String: Any]] ?? []).compactMap { row -> [String: String]? in
                    guard let lang = row["lang"] as? String, ["rus","eng"].contains(lang),
                          let raw = row["url"] as? String, let url = URL(string: raw), RemoteMediaURL.subtitle(url) else { return nil }
                    return ["lang": lang, "url": raw, "title": row["title"] as? String ?? row["id"] as? String ?? lang]
                }
                completion(rows, nil)
            } catch { completion([], "Сервис субтитров недоступен") }
        }
    }

    @objc public static func download(_ address: String, completion: @escaping (URL?) -> Void) {
        Task { @MainActor in
            guard let url = URL(string: address) else { completion(nil); return }
            do {
                let data = try await fetch(url, limit: 3_000_000, subtitles: true)
                guard !data.isEmpty else { throw URLError(.zeroByteResource) }
                let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".srt")
                try data.write(to: file, options: .atomic)
                completion(file)
            } catch { completion(nil) }
        }
    }
}
