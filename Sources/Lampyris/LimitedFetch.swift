import Foundation

/// Загрузка с жёстким потолком размера: ответ читается по мере прихода, и запрос отменяется, как только предел превышен
/// (или сразу, если сервер заранее объявил больший размер). `URLSession.data(for:)` сначала читает всё в память,
/// поэтому проверка `data.count` после него память не защищает.
enum LimitedFetch {
    struct TooLarge: Error {}

    private final class RedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
        let allowed: @Sendable (URL) -> Bool
        private let lock = NSLock()
        private var redirects = 0
        init(allowed: @escaping @Sendable (URL) -> Bool) { self.allowed = allowed }
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
            lock.lock()
            redirects += 1
            let withinLimit = redirects <= 5
            lock.unlock()
            completionHandler(withinLimit && request.url.map(allowed) == true ? request : nil)
        }
    }

    static func data(for request: URLRequest, limit: Int, session: URLSession = .shared,
                     allowedURL: (@Sendable (URL) -> Bool)? = nil) async throws -> (Data, URLResponse) {
        if let allowedURL, request.url.map(allowedURL) != true { throw URLError(.badURL) }
        let delegate = allowedURL.map { RedirectGuard(allowed: $0) }
        let (bytes, response) = try await session.bytes(for: request, delegate: delegate)
        // Размер из заголовка проверяем сразу; при неизвестном (−1) и при неверном заголовке спасает счёт принятых байтов.
        if response.expectedContentLength > Int64(limit) { throw TooLarge() }
        var data = Data()
        if response.expectedContentLength > 0 { data.reserveCapacity(Int(response.expectedContentLength)) }
        for try await byte in bytes {
            data.append(byte)
            if data.count > limit { throw TooLarge() }  // выход из цикла отменяет запрос
        }
        return (data, response)
    }
}
