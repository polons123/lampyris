// swift-tools-version: 6.0
import Foundation
import PackageDescription

// Каталог с libmpv и зависимостями. Для разработки это Homebrew; scripts/build-app.sh задаёт LAMPA_LIBS на набор под нужную архитектуру.
let libsDir = ProcessInfo.processInfo.environment["LAMPA_LIBS"] ?? "/opt/homebrew/lib"

let package = Package(
    name: "Lampyris",
    platforms: [.macOS(.v13)],
    targets: [
        // libmpv из Homebrew (/opt/homebrew), заголовки подключены через module map.
        .systemLibrary(name: "CMpv"),
        .executableTarget(
            name: "Lampyris",
            dependencies: ["CMpv"],
            resources: [.copy("Resources/mpvTube.js"), .copy("Resources/playbackCover.js")],
            linkerSettings: [
                .unsafeFlags([
                    "-L\(libsDir)",
                    // В .app библиотеки лежат в Contents/Frameworks; путь Homebrew нужен только для swift run.
                    "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks",
                    "-Xlinker", "-rpath", "-Xlinker", libsDir,
                ])
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
