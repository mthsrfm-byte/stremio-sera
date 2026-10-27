import Foundation
import CryptoKit

// A UI é um artefato do repo original. Nunca executamos mistura de commits.
struct UIManifest: Codable {
    let version: Int
    let bridgeVersion: Int
    let commit: String
    let files: [String: String]
}

enum UIError: LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        switch self { case .invalid(let message): return message }
    }
}

final class UIBundle {
    static let repository = "mthsrfm-byte/stremio-sera"
    let cache: URL
    let fallback: URL
    private let session: URLSession

    init(cache: URL? = nil, fallback: URL? = nil) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        self.cache = cache ?? support.appendingPathComponent("Seraflix/ui", isDirectory: true)
        self.fallback = fallback ?? Bundle.main.resourceURL!.appendingPathComponent("fallback", isDirectory: true)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 90
        session = URLSession(configuration: config)
    }

    func initial() -> URL {
        // O cache só vira current depois de verificação completa e troca atômica do ponteiro.
        if let name = try? String(contentsOf: cache.appendingPathComponent("current"), encoding: .utf8),
           validCommit(name),
           let manifest = try? readManifest(cache.appendingPathComponent(name)),
           (try? validate(directory: cache.appendingPathComponent(name), manifest: manifest)) != nil {
            return cache.appendingPathComponent(name)
        }
        return fallback
    }

    private func validCommit(_ value: String) -> Bool {
        value.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil
    }

    private func safePath(_ path: String) -> Bool {
        !path.isEmpty && !path.hasPrefix("/") && !path.contains("\\") &&
        !path.split(separator: "/", omittingEmptySubsequences: false).contains(where: { $0 == ".." || $0 == "." || $0.isEmpty }) &&
        !path.contains(":") && path.utf8.count < 512
    }

    func readManifest(_ directory: URL) throws -> UIManifest {
        try JSONDecoder().decode(UIManifest.self, from: Data(contentsOf: directory.appendingPathComponent("manifest.json")))
    }

    private func validate(directory: URL, manifest: UIManifest) throws {
        guard manifest.version == 1, manifest.bridgeVersion == 1, validCommit(manifest.commit),
              manifest.files["index.html"] != nil, manifest.files["app.js"] != nil,
              manifest.files.count <= 300 else { throw UIError.invalid("Manifesto da UI incompatível") }
        for (path, expected) in manifest.files {
            guard safePath(path), expected.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
                throw UIError.invalid("Caminho ou hash inválido na UI")
            }
            let data = try Data(contentsOf: directory.appendingPathComponent(path))
            guard data.count <= 16 * 1024 * 1024, digest(data) == expected else {
                throw UIError.invalid("Hash da UI não confere: \(path)")
            }
        }
    }

    private func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    private func download(_ url: URL, limit: Int = 16 * 1024 * 1024) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue("Seraflix-mac/0.1", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count <= limit else {
            throw UIError.invalid("Download de UI recusado ou grande demais")
        }
        return data
    }

    func refresh() async throws -> URL? {
        let head = try await download(URL(string: "https://api.github.com/repos/\(Self.repository)/commits/main")!, limit: 1024 * 1024)
        guard let json = try JSONSerialization.jsonObject(with: head) as? [String: Any],
              let commit = json["sha"] as? String, validCommit(commit) else { throw UIError.invalid("Commit main inválido") }
        if initial().lastPathComponent == commit { return nil }
        let base = "https://cdn.jsdelivr.net/gh/\(Self.repository)@\(commit)/site/mac/"
        let official = "https://raw.githubusercontent.com/\(Self.repository)/\(commit)/site/mac/"
        func asset(_ path: String, limit: Int = 16 * 1024 * 1024) async throws -> Data {
            do { return try await download(URL(string: base + path)!, limit: limit) }
            catch { return try await download(URL(string: official + path)!, limit: limit) }
        }
        let manifestData = try await asset("manifest.json", limit: 256 * 1024)
        let manifest = try JSONDecoder().decode(UIManifest.self, from: manifestData)
        guard manifest.version == 1, manifest.bridgeVersion == 1, validCommit(manifest.commit),
              manifest.files.count <= 300, manifest.files["index.html"] != nil, manifest.files["app.js"] != nil else {
            throw UIError.invalid("UI nova exige outra versão do app")
        }
        // Um commit de build da TV pode avançar main sem mudar o snapshot Mac.
        if let current = try? readManifest(initial()), current.commit == manifest.commit,
           current.files == manifest.files, current.bridgeVersion == manifest.bridgeVersion { return nil }
        let fm = FileManager.default
        try fm.createDirectory(at: cache, withIntermediateDirectories: true)
        let temporary = cache.appendingPathComponent("download-" + UUID().uuidString)
        try fm.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: temporary) }
        // Lotes pequenos evitam abrir uma conexão para cada fonte de uma vez.
        let entries = Array(manifest.files)
        for offset in stride(from: 0, to: entries.count, by: 6) {
            try await withThrowingTaskGroup(of: Void.self) { group in
                for (path, hash) in entries[offset..<min(offset + 6, entries.count)] {
                    guard safePath(path) else { throw UIError.invalid("Caminho inválido na UI") }
                    group.addTask { [self] in
                        let data = try await asset(path)
                        guard digest(data) == hash else { throw UIError.invalid("Hash inválido: \(path)") }
                        let destination = temporary.appendingPathComponent(path)
                        try fm.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                        try data.write(to: destination, options: .atomic)
                    }
                }
                try await group.waitForAll()
            }
        }
        try manifestData.write(to: temporary.appendingPathComponent("manifest.json"), options: .atomic)
        try validate(directory: temporary, manifest: manifest)
        let destination = cache.appendingPathComponent(commit)
        if fm.fileExists(atPath: destination.path) { try fm.removeItem(at: destination) }
        try fm.moveItem(at: temporary, to: destination)
        try Data(commit.utf8).write(to: cache.appendingPathComponent("current"), options: .atomic)
        // Mantém a versão corrente e a anterior; não cresce a cada mudança da main.
        let old = (try? fm.contentsOfDirectory(at: cache, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        let snapshots = old.filter { validCommit($0.lastPathComponent) && $0 != destination }.sorted {
            ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) >
            ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
        }
        for item in snapshots.dropFirst() { try? fm.removeItem(at: item) }
        return destination
    }
}
