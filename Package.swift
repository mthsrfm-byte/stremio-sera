// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Seraflix",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "Seraflix", targets: ["Seraflix"])],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1")
    ],
    targets: [
        .systemLibrary(name: "CMPV", pkgConfig: "mpv", providers: [.brew(["mpv"])]),
        .executableTarget(
            name: "Seraflix",
            dependencies: ["CMPV", .product(name: "Sparkle", package: "Sparkle")],
            linkerSettings: [
                .linkedFramework("AppKit"), .linkedFramework("WebKit"),
                .linkedFramework("OpenGL"), .linkedFramework("QuartzCore"), .linkedFramework("MediaPlayer"),
                .linkedFramework("IOKit"),
                .unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])
            ]
        )
    ]
)
