import Foundation

/// Загрузка с жёстким потолком размера: ответ читается по мере прихода, и запрос отменяется, как только предел превышен
/// (или сразу, если сервер заранее объявил больший размер). `URLSession.data(for:)` сначала читает всё в память,
/// поэтому проверка `data.count` после него память не защищает.
enum LimitedFetch {
    struct TooLarge: Error {}

    static func data(for request: URLRequest, limit: Int, session: URLSession = .shared) async throws -> (Data, URLResponse) {
        let (bytes, response) = try await session.bytes(for: request)
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
