import AppKit

@main
@MainActor
struct SeraflixApplication {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.setActivationPolicy(.regular)
        application.delegate = delegate
        // NSApplication mantém delegate fraco; a sessão conserva sua instância até o fim.
        withExtendedLifetime(delegate) { application.run() }
    }
}
