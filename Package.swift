// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MDReader",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(
            name: "MDReader",
            path: "Sources/MDReader",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
