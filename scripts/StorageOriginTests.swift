import AppKit
import WebKit
import Darwin

// Verifica o comportamento real do WebKit usado pelo runner: paths diferentes
// e uma nova WKWebView precisam continuar vendo a mesma chave de localStorage.
@MainActor
final class StorageOriginProbe: NSObject, WKNavigationDelegate {
    private enum Stage { case write, otherPath, recreatedView, originalPath, finished }
    private var stage: Stage = .write
    private let directory: URL
    private let first: URL
    private let second: URL
    private let key = "Seraflix.storage-test." + UUID().uuidString
    private let value = UUID().uuidString
    private var window: NSWindow!
    private var web: WKWebView!
    private var checks = 0
    private var finishing = false

    override init() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("Seraflix-origin-test-" + UUID().uuidString)
        first = directory.appendingPathComponent("fallback/index.html")
        second = directory.appendingPathComponent("cache/" + String(repeating: "a", count: 40) + "/index.html")
        super.init()
    }

    func start() throws {
        let html = Data("<!doctype html><meta charset='utf-8'><title>Teste de origem local</title>".utf8)
        for file in [first, second] {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try html.write(to: file)
        }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 360),
                          styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Teste de armazenamento do Seraflix"
        makeWebView()
        window.orderFront(nil)
        load(first)
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            self?.finish(error: "Timeout aguardando WKWebView/localStorage")
        }
    }

    private func makeWebView() {
        web?.navigationDelegate = nil
        web?.removeFromSuperview()
        let configuration = WKWebViewConfiguration()
        // É o mesmo armazenamento persistente padrão que o app usa; só uma chave
        // aleatória deste teste é escrita/removida. Nunca limpamos dados existentes.
        configuration.websiteDataStore = .default()
        web = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]
        window.contentView!.addSubview(web)
    }

    private func load(_ file: URL) {
        web.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
    }

    private func string(_ value: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [value])
        return String(data: data, encoding: .utf8)! + "[0]"
    }

    private func readAndContinue(_ label: String, next: @escaping () -> Void) {
        web.evaluateJavaScript("window.localStorage.getItem(\(string(key)))") { [weak self] result, error in
            guard let self = self, !self.finishing else { return }
            guard error == nil, result as? String == self.value else {
                self.finish(error: label + ": " + (error?.localizedDescription ?? "chave não persistiu"))
                return
            }
            self.checks += 1
            print("OK: " + label)
            next()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === web, !finishing else { return }
        switch stage {
        case .write:
            web.evaluateJavaScript("window.localStorage.setItem(\(string(key)),\(string(value)));window.localStorage.getItem(\(string(key)))") { [weak self] result, error in
                guard let self = self, !self.finishing else { return }
                guard error == nil, result as? String == self.value else {
                    self.finish(error: "Gravar localStorage: " + (error?.localizedDescription ?? "valor divergente"))
                    return
                }
                self.checks += 1
                print("OK: escrita/leitura em file://fallback/index.html")
                self.stage = .otherPath
                self.load(self.second)
            }
        case .otherPath:
            readAndContinue("mesma chave em outro diretório file://cache/SHA/index.html") { [weak self] in
                guard let self = self else { return }
                self.stage = .recreatedView
                self.makeWebView()
                self.load(self.second)
            }
        case .recreatedView:
            readAndContinue("mesma chave após recriar WKWebView com dataStore padrão") { [weak self] in
                guard let self = self else { return }
                self.stage = .originalPath
                self.load(self.first)
            }
        case .originalPath:
            readAndContinue("chave continua acessível ao voltar ao bundle anterior") { [weak self] in
                self?.stage = .finished
                self?.finish(error: nil)
            }
        case .finished: break
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === web { finish(error: error.localizedDescription) }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView === web { finish(error: error.localizedDescription) }
    }

    private func finish(error: String?) {
        guard !finishing else { return }
        finishing = true
        let complete: () -> Void = { [self] in
            try? FileManager.default.removeItem(at: directory)
            if let error = error {
                fputs("StorageOriginTests falhou: \(error)\n", stderr)
            } else {
                print("StorageOriginTests: \(checks) verificações passaram; paths preservam a origem de armazenamento")
            }
            fflush(stdout)
            exit(error == nil ? 0 : 1)
        }
        // Remove somente a chave aleatória do teste, inclusive em caso de erro.
        if let web = web {
            web.evaluateJavaScript("window.localStorage.removeItem(\(string(key)))") { _, _ in complete() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: complete)
        } else { complete() }
    }
}

@main
struct StorageOriginTests {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let probe = StorageOriginProbe()
        do { try probe.start() }
        catch {
            fputs("Não foi possível preparar StorageOriginTests: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
        withExtendedLifetime(probe) { app.run() }
    }
}
