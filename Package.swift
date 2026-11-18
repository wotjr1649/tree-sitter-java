// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "TreeSitterJava",
    products: [
        .library(name: "TreeSitterJava", targets: ["TreeSitterJava"]),
    ],
    dependencies: [
        .package(url: "https://github.com/tree-sitter/swift-tree-sitter", .exact("0.25.0")),
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
                .product(name: "SwiftTreeSitter", package: "swift-tree-sitter"),
                "TreeSitterJava",
            ],
            path: "bindings/swift/TreeSitterJavaTests"
        )
    ],
    cLanguageStandard: .c11
)
