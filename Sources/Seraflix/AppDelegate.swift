import AppKit
import WebKit
import Sparkle

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var web: WKWebView!
    private let ui = UIBundle()
    private let server = ServerSupervisor()
    private var player: MPVPlayer?
    private var playerStartupError: String?
    private var smokeRenderer = ""
    private let media = MediaIntegration()
    private var updater: SPUStandardUpdaterController?
    private let launchTime = Date()
    private var smokeServerReadyCount = 0
    private var smokeServerRestarted = false
    private var smokeHome = false
    private var smokeLoaded = false
    private var smokeAdvanced = false
    private var smokeRendered = false
    private var smokeAudioID: String?
    private var smokeSubtitleID: String?
    private var smokeTracksSelected = false
    private var smokeHomeSeconds: Double = 0
    private var smokeResult: String? {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--smoke-test"), args.indices.contains(i + 1) else { return nil }
        return args[i + 1]
    }
    private var smokeVideoOpened = false
    private var smokeTorrentFile: String? {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--smoke-torrent-file"), args.indices.contains(i + 1) else { return nil }
        return args[i + 1]
    }
    private var smokeVideo: String? {
        if let gate = smokeTorrentFile {
            return (try? String(contentsOfFile: gate, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--smoke-video"), args.indices.contains(i + 1) else { return nil }
        return args[i + 1]
    }
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
        if smokeResult != nil {
            // Perfil efêmero só do harness: não altera conta/preferências do usuário.
            configuration.websiteDataStore = .nonPersistent()
            controller.addUserScript(WKUserScript(source: """
                localStorage.setItem('kai.device', JSON.stringify({wizardDone:true,introSound:false,askProfile:false}));
                localStorage.setItem('kai.profiles', JSON.stringify([{id:'ci',name:'Teste CI',color:'#7b5bf5'}]));
                localStorage.setItem('kai.activeProfile', JSON.stringify('ci'));
                """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        web = OverlayWebView(frame: contentView.bounds, configuration: configuration)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        // WKWebView não publica drawsBackground no macOS; KVC é o mecanismo de AppKit usado aqui.
        web.setValue(false, forKey: "drawsBackground")
        contentView.addSubview(web)
        inputMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .scrollWheel]) { [weak self] event in
            self?.interacted = true
            return event
        }
        server.onState = { [weak self] state in
            guard let self = self else { return }
            self.emit("server", state)
            guard self.smokeResult != nil, CommandLine.arguments.contains("--smoke-server") else { return }
            if state["state"] as? String == "error" {
                self.finishSmoke(error: state["message"] as? String ?? "Servidor indisponível")
            } else if state["state"] as? String == "ready" {
                self.smokeServerReadyCount += 1
                if self.smokeServerReadyCount == 1 {
                    self.server.crashForSmokeTest()
                } else {
                    self.smokeServerRestarted = true
                    self.checkSmokeComplete()
                }
            }
        }
        commandHandler = { [weak self] command, args in
            guard let self = self else { return }
            if command == "serverStatus" || command == "appReady" {
                self.emit("server", self.server.state)
                return
            }
            if command == "load" { try self.preparePlayer() }
            guard let player = self.player else { throw UIError.invalid("Abra um vídeo antes de controlar a reprodução.") }
            if command == "load" { self.media.setTitle(args["title"] as? String ?? "Seraflix") }
            try player.handle(command: command, args: args)
        }
        media.command = { [weak self] command, args in
            do { try self?.commandHandler?(command, args) }
            catch { self?.emit("error", ["message": error.localizedDescription]) }
        }
        shutdownHandler = { [weak self] in
            self?.media.stop()
            self?.player?.shutdown()
            self?.server.stop()
        }
        // Sparkle exige chave Ed25519 antes de atualizar; builds ad hoc não simulam assinatura de release.
        if let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String, !key.isEmpty {
            updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        }
        server.start()
        load(ui.initial())
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if smokeResult != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in self?.finishSmoke(error: "Timeout no smoke test") }
        }
        Task { [weak self] in
            guard let self = self, self.smokeResult == nil else { return }
            do {
                if let updated = try await self.ui.refresh() {
                    // Não interrompe login/navegação: se já houve interação, usa o cache na próxima abertura.
                    if !self.interacted { self.load(updated) }
                }
            } catch { NSLog("UI remota indisponível; mantendo cache/fallback: %@", error.localizedDescription) }
        }
    }

    private func preparePlayer() throws {
        guard player == nil else { return }
        // A home abre antes de inicializar driver/GPU. O player só custa ao abrir mídia.
        do {
            let player = try MPVPlayer()
            self.player = player
            installNativeView(player.view)
            player.onEvent = { [weak self] event, data in
                self?.media.receive(event, data)
                if self?.smokeResult != nil {
                    if event == "tracks" { self?.testSmokeTracks(data) }
                    if event == "loaded" { self?.smokeLoaded = true }
                    if event == "rendered", data["pixelNonBlack"] as? Bool == true {
                        self?.smokeRendered = true
                        self?.smokeRenderer = data["renderer"] as? String ?? ""
                    }
                    if event == "time", (data["position"] as? Double ?? 0) > 0.3 { self?.smokeAdvanced = true }
                    if event == "error" { self?.finishSmoke(error: data["message"] as? String ?? "Erro libmpv") }
                    self?.checkSmokeComplete()
                }
                self?.emit(event, data)
            }
        } catch {
            playerStartupError = error.localizedDescription
            throw error
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

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        emit("server", server.state)
        if smokeResult != nil { pollSmokeHome() }
    }

    private func pollSmokeHome() {
        web.evaluateJavaScript("""
        (() => { const home = document.querySelector('.home-view:not(.hidden) .topbar');
          const boot = document.querySelector('#boot');
          return !!home && home.getBoundingClientRect().width > 0 &&
            (!boot || getComputedStyle(boot).display === 'none' || Number(getComputedStyle(boot).opacity) === 0);
        })()
        """) { [weak self] result, error in
            guard let self = self, self.smokeResult != nil else { return }
            if let error = error { self.finishSmoke(error: error.localizedDescription); return }
            if result as? Bool == true {
                if !self.smokeHome {
                    self.smokeHome = true
                    self.smokeHomeSeconds = Date().timeIntervalSince(self.launchTime)
                }
                if self.smokeTorrentFile != nil && self.smokeVideo == nil {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.pollSmokeHome() }
                    return
                }
                if !self.smokeVideoOpened, let url = self.smokeVideo,
                   let bytes = try? JSONSerialization.data(withJSONObject: [url]),
                   let json = String(data: bytes, encoding: .utf8) {
                    self.smokeVideoOpened = true
                    self.web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('seraflix-open-url',{detail:\(json)[0]}))")
                }
                self.checkSmokeComplete()
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.pollSmokeHome() }
            }
        }
    }

    private func checkSmokeComplete() {
        guard smokeResult != nil, smokeHome, player != nil else { return }
        guard smokeTorrentFile == nil || smokeVideoOpened else { return }
        guard !CommandLine.arguments.contains("--smoke-server") || smokeServerRestarted else { return }
        guard !CommandLine.arguments.contains("--smoke-tracks") || smokeTracksSelected else { return }
        if smokeVideo == nil || (smokeLoaded && smokeAdvanced && smokeRendered) { finishSmoke(error: nil) }
    }

    private func testSmokeTracks(_ data: [String: Any]) {
        guard CommandLine.arguments.contains("--smoke-tracks"),
              let audio = data["audio"] as? [[String: Any]], let subs = data["subtitles"] as? [[String: Any]] else { return }
        if smokeAudioID == nil, audio.count >= 2,
           let aid = audio.last?["id"] as? String, let sid = subs.first?["id"] as? String {
            smokeAudioID = aid
            smokeSubtitleID = sid
            do {
                try player?.handle(command: "audio", args: ["id": aid])
                try player?.handle(command: "subtitle", args: ["id": sid])
            } catch { finishSmoke(error: error.localizedDescription) }
        } else if let aid = smokeAudioID, let sid = smokeSubtitleID {
            smokeTracksSelected = audio.contains { $0["id"] as? String == aid && $0["selected"] as? Bool == true } &&
                subs.contains { $0["id"] as? String == sid && $0["selected"] as? Bool == true }
        }
    }

    private var smokeFinished = false
    private func finishSmoke(error: String?) {
        guard let path = smokeResult, !smokeFinished else { return }
        smokeFinished = true
        let result: [String: Any] = ["ok": error == nil, "home": smokeHome, "player": player != nil,
                                     "loaded": smokeLoaded, "advanced": smokeAdvanced, "rendered": smokeRendered,
                                     "renderer": smokeRenderer, "playerStartupError": playerStartupError ?? "",
                                     "homeSeconds": smokeHomeSeconds, "serverRestarts": max(0, smokeServerReadyCount - 1),
                                     "serverRestarted": smokeServerRestarted, "tracksSelected": smokeTracksSelected, "error": error ?? ""]
        if let bytes = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
            try? bytes.write(to: URL(fileURLWithPath: path), options: .atomic)
        }
        NSApp.terminate(nil)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationFailed(error)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        navigationFailed(error)
    }
    private func navigationFailed(_ error: Error) {
        if smokeResult != nil { finishSmoke(error: error.localizedDescription); return }
        let alert = NSAlert()
        alert.messageText = "Não foi possível carregar a interface"
        alert.informativeText = "Reinstale o Seraflix para recuperar o bundle local. " + error.localizedDescription
        alert.beginSheetModal(for: window)
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
        } catch {
            emit("response", ["id": id, "ok": false, "error": error.localizedDescription])
            if command == "load", smokeResult != nil { finishSmoke(error: error.localizedDescription) }
        }
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

    @objc private func checkUpdates(_ sender: Any?) {
        if let updater = updater { updater.checkForUpdates(sender) }
        else {
            let alert = NSAlert()
            alert.messageText = "Versão de desenvolvimento"
            alert.informativeText = "Este pacote ad hoc não tem chave de atualização Sparkle. Instale novas versões pela página de releases. A UI continua atualizando da main."
            alert.runModal()
        }
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
        appMenu.addItem(withTitle: "Buscar atualizações…", action: #selector(checkUpdates(_:)), keyEquivalent: "").target = self
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

// A view de vídeo continua visível para o compositor do AppKit sob a UI.
// drawsBackground=false limpa a página; isOpaque=false evita oclusão da view irmã.
private final class OverlayWebView: WKWebView {
    override var isOpaque: Bool { false }
}
