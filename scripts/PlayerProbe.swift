import AppKit
import Darwin

/// Diagnóstico rápido do player real, sem UI web, servidor, Sparkle ou FFmpeg.
@main
@MainActor
struct PlayerProbe {
    static func report(_ result: [String: Any]) {
        guard let bytes = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) else { return }
        FileHandle.standardOutput.write(bytes)
        FileHandle.standardOutput.write(Data([10]))
        if CommandLine.arguments.count > 1 {
            try? bytes.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
        }
    }

    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.regular)
        application.finishLaunching()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 450),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Diagnóstico Seraflix/libmpv"
        window.isReleasedWhenClosed = false
        window.makeKeyAndOrderFront(nil)
        application.activate(ignoringOtherApps: true)
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        let started = Date()
        var stage = "player-init"
        do {
            let player = try MPVPlayer()
            player.view.frame = window.contentView!.bounds
            player.view.autoresizingMask = [.width, .height]
            window.contentView!.addSubview(player.view)
            guard let index = CommandLine.arguments.firstIndex(of: "--video"),
                  CommandLine.arguments.indices.contains(index + 1) else {
                player.shutdown()
                window.orderOut(nil)
                report(["ok": true, "stage": "init-and-shutdown", "seconds": Date().timeIntervalSince(started),
                        "os": ProcessInfo.processInfo.operatingSystemVersionString])
                exit(0)
            }
            stage = "video-playback"
            let url = CommandLine.arguments[index + 1]
            var loaded = false
            var advanced = false
            var rendered = false
            var renderer = ""
            var audioTracks = 0
            var subtitleTracks = 0
            var finished = false
            func finish(_ error: String?) {
                guard !finished else { return }
                finished = true
                player.shutdown()
                window.orderOut(nil)
                report(["ok": error == nil, "stage": stage, "seconds": Date().timeIntervalSince(started),
                        "loaded": loaded, "advanced": advanced, "pixelNonBlack": rendered,
                        "renderer": renderer, "audioTracks": audioTracks, "subtitleTracks": subtitleTracks,
                        "error": error ?? "", "os": ProcessInfo.processInfo.operatingSystemVersionString])
                exit(error == nil ? 0 : 1)
            }
            player.onEvent = { event, data in
                guard !finished else { return }
                if event == "loaded" { loaded = true }
                if event == "time", (data["position"] as? Double ?? 0) > 0.3 { advanced = true }
                if event == "tracks" {
                    audioTracks = (data["audio"] as? [[String: Any]])?.count ?? 0
                    subtitleTracks = (data["subtitles"] as? [[String: Any]])?.count ?? 0
                }
                if event == "rendered" {
                    rendered = data["pixelNonBlack"] as? Bool == true
                    renderer = data["renderer"] as? String ?? ""
                }
                if event == "error" { finish(data["message"] as? String ?? "Erro libmpv sem mensagem") }
                if loaded && advanced && rendered { finish(nil) }
            }
            try player.handle(command: "load", args: ["url": url, "startTime": 0, "title": "Diagnóstico HEVC 4K"])
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { finish("Timeout de 20 s no teste de vídeo") }
            application.run()
            finish("O loop AppKit encerrou antes da reprodução")
        } catch {
            report(["ok": false, "stage": stage, "seconds": Date().timeIntervalSince(started),
                    "error": error.localizedDescription, "reflection": String(reflecting: error),
                    "os": ProcessInfo.processInfo.operatingSystemVersionString])
            exit(1)
        }
    }
}
