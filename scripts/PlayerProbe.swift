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
        do {
            let player = try MPVPlayer()
            player.view.frame = window.contentView!.bounds
            window.contentView!.addSubview(player.view)
            player.shutdown()
            window.orderOut(nil)
            report(["ok": true, "stage": "init-and-shutdown", "seconds": Date().timeIntervalSince(started),
                    "os": ProcessInfo.processInfo.operatingSystemVersionString])
            exit(0)
        } catch {
            report(["ok": false, "stage": "player-init", "seconds": Date().timeIntervalSince(started),
                    "error": error.localizedDescription, "reflection": String(reflecting: error),
                    "os": ProcessInfo.processInfo.operatingSystemVersionString])
            exit(1)
        }
    }
}
