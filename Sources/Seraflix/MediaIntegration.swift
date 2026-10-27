import AppKit
import MediaPlayer
import IOKit.pwr_mgt

// Metadados e controles do sistema seguem exatamente o estado recebido do mpv.
@MainActor
final class MediaIntegration {
    var command: ((String, [String: Any]) -> Void)?
    private var assertion: IOPMAssertionID = 0
    private var title = "Seraflix"
    private var targets: [(MPRemoteCommand, Any)] = []

    init() {
        let center = MPRemoteCommandCenter.shared()
        register(center.playCommand) { [weak self] _ in self?.command?("play", [:]); return .success }
        register(center.pauseCommand) { [weak self] _ in self?.command?("pause", [:]); return .success }
        register(center.togglePlayPauseCommand) { [weak self] _ in
            self?.command?(MPNowPlayingInfoCenter.default().playbackState == .playing ? "pause" : "play", [:])
            return .success
        }
        register(center.changePlaybackPositionCommand) { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.command?("seek", ["position": event.positionTime]); return .success
        }
    }

    private func register(_ remote: MPRemoteCommand, handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
        remote.isEnabled = true
        let target = remote.addTarget { event in
            // MPRemoteCommandCenter pode chamar fora do loop da janela.
            if Thread.isMainThread { return handler(event) }
            return DispatchQueue.main.sync { handler(event) }
        }
        targets.append((remote, target))
    }

    func setTitle(_ value: String) { title = value }

    func receive(_ event: String, _ data: [String: Any]) {
        let info = MPNowPlayingInfoCenter.default()
        if event == "time" {
            let paused = data["paused"] as? Bool ?? true
            let active = data["active"] as? Bool ?? false
            let duration = data["duration"] as? Double ?? 0
            let position = data["position"] as? Double ?? 0
            info.nowPlayingInfo = [MPMediaItemPropertyTitle: title,
                                  MPMediaItemPropertyPlaybackDuration: duration,
                                  MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
                                  MPNowPlayingInfoPropertyPlaybackRate: !active || paused ? 0.0 : 1.0,
                                  MPNowPlayingInfoPropertyIsLiveStream: duration <= 0]
            info.playbackState = !active ? .stopped : (paused ? .paused : .playing)
            preventSleep(active && !paused)
        } else if event == "ended" || event == "error" {
            info.playbackState = .stopped
            preventSleep(false)
        }
    }

    private func preventSleep(_ enabled: Bool) {
        if enabled && assertion == 0 {
            IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
                                      IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                      "Reprodução do Seraflix" as CFString, &assertion)
        } else if !enabled && assertion != 0 {
            IOPMAssertionRelease(assertion)
            assertion = 0
        }
    }

    func stop() {
        preventSleep(false)
        let info = MPNowPlayingInfoCenter.default()
        info.playbackState = .stopped
        info.nowPlayingInfo = nil
        for (remote, target) in targets { remote.removeTarget(target) }
        targets.removeAll()
    }
}
