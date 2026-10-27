import Foundation
import CryptoKit

// Exercita o seletor/validador usado pelo app, sem carregar WKWebView nem a rede.
@main
struct UICacheTests {
    static func main() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("Seraflix-cache-test-" + UUID().uuidString)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let cache = root.appendingPathComponent("cache")
        let fallback = root.appendingPathComponent("fallback")
        try fm.createDirectory(at: cache, withIntermediateDirectories: true)
        try fm.createDirectory(at: fallback, withIntermediateDirectories: true)
        let ui = UIBundle(cache: cache, fallback: fallback)
        let commit = String(repeating: "a", count: 40)
        let snapshot = cache.appendingPathComponent(commit)
        try fm.createDirectory(at: snapshot, withIntermediateDirectories: true)
        let current = cache.appendingPathComponent("current")
        let index = Data("<!doctype html><title>UI íntegra</title>".utf8)
        let script = Data("window.seraflixTeste = true;".utf8)
        let digest: (Data) -> String = { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() }
        let files = ["index.html": digest(index), "app.js": digest(script)]
        func writeManifest(version: Int = 1, bridge: Int = 1, entries: [String: String]? = nil) throws {
            let manifest = UIManifest(version: version, bridgeVersion: bridge, commit: commit, files: entries ?? files)
            try JSONEncoder().encode(manifest).write(to: snapshot.appendingPathComponent("manifest.json"), options: .atomic)
        }
        func restore() throws {
            try Data(commit.utf8).write(to: current, options: .atomic)
            try index.write(to: snapshot.appendingPathComponent("index.html"), options: .atomic)
            try script.write(to: snapshot.appendingPathComponent("app.js"), options: .atomic)
            try writeManifest()
        }
        var checks = 0
        func expect(_ selected: URL, _ label: String) throws {
            guard ui.initial().standardizedFileURL == selected.standardizedFileURL else {
                throw NSError(domain: "Seraflix.UICacheTests", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "Falhou: " + label])
            }
            checks += 1
            print("OK: " + label)
        }

        try expect(fallback, "offline sem cache usa fallback")
        try restore()
        try expect(snapshot, "snapshot íntegro é selecionado")

        try Data("script adulterado".utf8).write(to: snapshot.appendingPathComponent("app.js"), options: .atomic)
        try expect(fallback, "hash divergente rejeita o snapshot inteiro")
        try restore()
        try fm.removeItem(at: snapshot.appendingPathComponent("index.html"))
        try expect(fallback, "arquivo faltante não mistura cache e fallback")
        try restore()
        try writeManifest(version: 2)
        try expect(fallback, "formato futuro do manifesto exige app novo")
        try restore()
        try writeManifest(bridge: 2)
        try expect(fallback, "ponte futura exige app novo")
        try restore()
        try Data("../fallback".utf8).write(to: current, options: .atomic)
        try expect(fallback, "ponteiro current não permite traversal")
        try restore()
        var missing = files
        missing.removeValue(forKey: "app.js")
        try writeManifest(entries: missing)
        try expect(fallback, "manifesto precisa declarar o script de entrada")
        try restore()
        try Data("{manifesto incompleto".utf8).write(to: snapshot.appendingPathComponent("manifest.json"), options: .atomic)
        try expect(fallback, "manifesto corrompido preserva o fallback")
        try restore()

        // Um arquivo externo realmente existe e tem o hash esperado. O caminho precisa
        // ser rejeitado antes de lê-lo, mesmo que o hash desse arquivo seja válido.
        let outside = cache.appendingPathComponent("outside.js")
        try script.write(to: outside, options: .atomic)
        for unsafe in ["../outside.js", "/outside.js", "fonts/../../outside.js", "fonts\\outside.js", "fonts//outside.js", "./app.js", "https:outside.js"] {
            var entries = files
            entries[unsafe] = digest(script)
            try writeManifest(entries: entries)
            try expect(fallback, "caminho rejeitado: " + unsafe)
        }
        try restore()
        try expect(snapshot, "cache válido continua utilizável após falhas")
        print("UICacheTests: \(checks) verificações passaram")
    }
}
