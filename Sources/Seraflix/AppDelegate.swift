import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var web: WKWebView!
    private let ui = UIBundle()
    private var activeUI: URL!
    private var interacted = false
    private var inputMonitor: Any?
    // Integrações nativas são conectadas nas etapas seguintes.
    var commandHandler: ((String, [String: Any]) throws -> Void)?
    var shutdownHandler: (() -> Void)?
    var contentView: NSView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenus()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 720),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Seraflix"
        window.minSize = NSSize(width: 800, height: 450)
        window.collectionBehavior = [.fullScreenPrimary]
        window.backgroundColor = NSColor(calibratedRed: 0.05, green: 0.04, blue: 0.08, alpha: 1)
        window.delegate = self
        window.center()
        contentView = NSView(frame: window.contentView!.bounds)
        window.contentView = contentView

        let controller = WKUserContentController()
        controller.add(self, name: "seraflix")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        web = WKWebView(frame: contentView.bounds, configuration: configuration)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        // WKWebView não publica drawsBackground no macOS; KVC é o mecanismo de AppKit usado aqui.
        web.setValue(false, forKey: "drawsBackground")
        contentView.addSubview(web)
        inputMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .scrollWheel]) { [weak self] event in
            self?.interacted = true
            return event
        }
        load(ui.initial())
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        Task { [weak self] in
            guard let self = self else { return }
            do {
                if let updated = try await self.ui.refresh() {
                    // Não interrompe login/navegação: se já houve interação, usa o cache na próxima abertura.
                    if !self.interacted { self.load(updated) }
                }
            } catch { NSLog("UI remota indisponível; mantendo cache/fallback: %@", error.localizedDescription) }
        }
    }

    private func load(_ directory: URL) {
        activeUI = directory.standardizedFileURL
        web.loadFileURL(directory.appendingPathComponent("index.html"), allowingReadAccessTo: directory)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(url.scheme == "https" ? .allow : .cancel)
            return
        }
        if trusted(url) { decisionHandler(.allow) }
        else {
            if navigationAction.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }

    private func trusted(_ url: URL) -> Bool {
        url.isFileURL && url.standardizedFileURL.path.hasPrefix(activeUI.path + "/")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let origin = message.frameInfo.request.url, trusted(origin),
              let body = message.body as? [String: Any], body["version"] as? Int == 1,
              let id = body["id"] as? String, id.count <= 128,
              let command = body["command"] as? String else { return }
        let args = body["args"] as? [String: Any] ?? [:]
        do {
            switch command {
            case "fullscreen": toggleFullscreen(nil)
            default:
                guard let handler = commandHandler else { throw UIError.invalid("Comando nativo ainda indisponível") }
                try handler(command, args)
            }
            emit("response", ["id": id, "ok": true])
        } catch { emit("response", ["id": id, "ok": false, "error": error.localizedDescription]) }
    }

    func emit(_ event: String, _ data: [String: Any]) {
        if !Thread.isMainThread { DispatchQueue.main.async { [weak self] in self?.emit(event, data) }; return }
        let payload: [String: Any] = ["event": event, "data": data]
        guard JSONSerialization.isValidJSONObject(payload),
              let bytes = try? JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed]),
              let json = String(data: bytes, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('seraflix-native',{detail:\(json)}))", completionHandler: nil)
    }

    func installNativeView(_ view: NSView) {
        view.frame = contentView.bounds
        view.autoresizingMask = [.width, .height]
        contentView.addSubview(view, positioned: .below, relativeTo: web)
    }

    @objc private func toggleFullscreen(_ sender: Any?) { window?.toggleFullScreen(sender) }
    @objc private func openURL(_ sender: Any?) {
        let alert = NSAlert()
        alert.messageText = "Abrir vídeo"
        alert.informativeText = "Cole um endereço HTTP ou HTTPS para testar o player nativo."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 440, height: 24))
        alert.accessoryView = field
        alert.addButton(withTitle: "Abrir")
        alert.addButton(withTitle: "Cancelar")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        // O comando usa a mesma ponte da UI para não criar um segundo player.
        let value = field.stringValue
        guard let bytes = try? JSONSerialization.data(withJSONObject: [value]),
              let json = String(data: bytes, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('seraflix-open-url',{detail:\(json)[0]}))")
    }

    private func installMenus() {
        let menu = NSMenu()
        let app = NSMenuItem(); menu.addItem(app)
        let appMenu = NSMenu(); app.submenu = appMenu
        appMenu.addItem(withTitle: "Sobre o Seraflix", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Ocultar Seraflix", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Sair do Seraflix", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let file = NSMenuItem(); menu.addItem(file); file.submenu = NSMenu(title: "Arquivo")
        file.submenu?.addItem(withTitle: "Abrir endereço de vídeo…", action: #selector(openURL(_:)), keyEquivalent: "o").target = self
        file.submenu?.addItem(withTitle: "Fechar", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let edit = NSMenuItem(); menu.addItem(edit); edit.submenu = NSMenu(title: "Editar")
        for (title, action, key) in [("Desfazer", "undo:", "z"), ("Recortar", "cut:", "x"), ("Copiar", "copy:", "c"), ("Colar", "paste:", "v"), ("Selecionar tudo", "selectAll:", "a")] {
            edit.submenu?.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let view = NSMenuItem(); menu.addItem(view); view.submenu = NSMenu(title: "Visualizar")
        let full = view.submenu!.addItem(withTitle: "Tela cheia", action: #selector(toggleFullscreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command]; full.target = self
        NSApp.mainMenu = menu
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        shutdownHandler?()
        if let monitor = inputMonitor { NSEvent.removeMonitor(monitor) }
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "seraflix")
    }
}
