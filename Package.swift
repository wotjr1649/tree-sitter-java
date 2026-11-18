// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "TreeSitterJava",
    products: [
        .library(name: "TreeSitterJava", targets: ["TreeSitterJava"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ChimeHQ/SwiftTreeSitter", .upToNextMinor(from: "0.25.0")),
    ],
    targets: [
        .target(
            name: "TreeSitterJava",
            dependencies: [],
            path: ".",
            sources: [
                "src/parser.c",
            ],
            resources: [
                .copy("queries")
            ],
            publicHeadersPath: "bindings/swift",
            cSettings: [.headerSearchPath("src")]
        ),
        .testTarget(
            name: "TreeSitterJavaTests",
            dependencies: [
                "SwiftTreeSitter",
                "TreeSitterJava",
            ],
            path: "bindings/swift/TreeSitterJavaTests"
        )
    ],
    cLanguageStandard: .c11
)
