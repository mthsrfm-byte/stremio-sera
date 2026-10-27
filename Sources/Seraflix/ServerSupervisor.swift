import Foundation
import CryptoKit
import Darwin

/// Instala o servidor da fonte oficial e mantém um único filho durante a sessão.
/// Implementação independente; ver a análise de licença em docs/estudo.md.
@MainActor
final class ServerSupervisor {
    static let version = "v4.21.1"
    static let endpoint = URL(string: "http://127.0.0.1:11470")!
    static let source = URL(string: "https://dl.strem.io/server/v4.21.1/desktop/server.js")!
    static let checksum = "405eb494d6708406a30e716c3cfb5abae7a5e9c7a8b79446d64c3f821385930f"

    var onState: (([String: Any]) -> Void)?
    private(set) var state: [String: Any] = ["state": "stopped", "url": ServerSupervisor.endpoint.absoluteString]
    private var process: Process?
    private var sessionTask: Task<Void, Never>?
    private var healthTask: Task<Void, Never>?
    private var stopped = true
    private var generation = 0
    private var failures = 0
    private var lockDescriptor: Int32 = -1
    private var output: FileHandle?
    private let directory: URL
    private let logDirectory: URL
    private let network: URLSession

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        directory = home.appendingPathComponent("Library/Application Support/Seraflix/Server", isDirectory: true)
        logDirectory = home.appendingPathComponent("Library/Logs/Seraflix", isDirectory: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 3
        configuration.timeoutIntervalForResource = 120
        network = URLSession(configuration: configuration)
    }

    func start() {
        guard stopped else { return }
        stopped = false
        generation += 1
        let token = generation
        sessionTask = Task { [weak self] in
            guard let self else { return }
            do {
                try self.acquireLock()
                self.publish("installing", "Preparando o servidor de streaming…")
                let server = try await self.install()
                guard !Task.isCancelled, !self.stopped, self.generation == token else { return }
                try self.launch(server: server, generation: token)
            } catch {
                guard !self.stopped else { return }
                self.publish("error", error.localizedDescription)
            }
        }
    }

    /// Encerra apenas o processo criado por esta instância; nunca mata Stremio alheio.
    func stop() {
        stopped = true
        generation += 1
        sessionTask?.cancel()
        healthTask?.cancel()
        sessionTask = nil
        healthTask = nil
        if let child = process, child.isRunning {
            child.terminationHandler = nil
            child.terminate()
            // O app pode sair logo após este método; uma closure futura não é suficiente.
            let deadline = Date().addingTimeInterval(0.8)
            while child.isRunning && Date() < deadline { usleep(10_000) }
            if child.isRunning { Darwin.kill(child.processIdentifier, SIGKILL) }
            child.waitUntilExit()
        }
        process = nil
        try? output?.close()
        output = nil
        if lockDescriptor >= 0 {
            flock(lockDescriptor, LOCK_UN)
            close(lockDescriptor)
            lockDescriptor = -1
        }
        publish("stopped", "Servidor encerrado")
    }

    // Apenas o harness do runner pode simular crash; este método não é exposto pela ponte.
    func crashForSmokeTest() {
        guard ProcessInfo.processInfo.arguments.contains("--smoke-server") else { return }
        process?.terminate()
    }

    private func publish(_ status: String, _ message: String) {
        state = ["state": status, "message": message,
                 "url": Self.endpoint.absoluteString, "version": Self.version]
        onState?(state)
    }

    private func acquireLock() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if lockDescriptor >= 0 { return }
        let descriptor = open(directory.appendingPathComponent("session.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw failure("Não foi possível criar a trava do servidor.") }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            close(descriptor)
            throw failure("Outra instância do Seraflix já controla o servidor.")
        }
        lockDescriptor = descriptor
    }

    private func install() async throws -> URL {
        let destination = directory.appendingPathComponent("server-\(Self.version).js")
        if let existing = try? Data(contentsOf: destination), digest(existing) == Self.checksum { return destination }
        publish("downloading", "Baixando o servidor oficial na primeira execução…")
        var request = URLRequest(url: Self.source)
        request.timeoutInterval = 120
        let (data, response) = try await network.data(for: request)
        try Task.checkCancellation()
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              data.count > 1_000_000, data.count < 15_000_000 else {
            throw failure("O download oficial do servidor falhou. Verifique a conexão e abra o app novamente.")
        }
        guard digest(data) == Self.checksum else {
            throw failure("O servidor recebido difere do SHA-256 aprovado. O arquivo não será executado.")
        }
        try data.write(to: destination, options: .atomic)
        return destination
    }

    private func launch(server: URL, generation token: Int) throws {
        guard !stopped, generation == token else { return }
        let bundle = Bundle.main
        let helpers = bundle.bundleURL.appendingPathComponent("Contents/Helpers", isDirectory: true)
        let node = helpers.appendingPathComponent("node")
        guard FileManager.default.isExecutableFile(atPath: node.path),
              let bootstrap = bundle.url(forResource: "server-bootstrap", withExtension: "cjs") else {
            throw failure("Pacote incompleto: Node ou adaptador do servidor ausente. Reinstale o Seraflix.")
        }
        let stateDirectory = directory.appendingPathComponent("state", isDirectory: true)
        try FileManager.default.createDirectory(at: stateDirectory, withIntermediateDirectories: true)
        // O listener precisa permanecer em 11470. Detecta conflito antes de executar código baixado.
        try ensurePortAvailable()
        try prepareLog()
        let child = Process()
        child.executableURL = node
        child.arguments = [bootstrap.path, server.path]
        child.currentDirectoryURL = stateDirectory
        var environment = ProcessInfo.processInfo.environment
        // Não herdar flags de desenvolvimento nem carregadores externos para o Node empacotado.
        environment.removeValue(forKey: "NODE_OPTIONS")
        environment.removeValue(forKey: "NODE_PATH")
        environment["APP_PATH"] = stateDirectory.path
        environment["SETTINGS_PATH"] = stateDirectory.path
        environment["NO_HTTPS_SERVER"] = "1"
        environment["CASTING_DISABLED"] = "1"
        environment["NO_CORS"] = "1"
        environment["FFMPEG_BIN"] = helpers.appendingPathComponent("ffmpeg").path
        environment["FFPROBE_BIN"] = helpers.appendingPathComponent("ffprobe").path
        child.environment = environment
        child.standardOutput = output
        child.standardError = output
        child.terminationHandler = { [weak self] terminated in
            let status = terminated.terminationStatus
            Task { @MainActor [weak self] in
                guard let self, !self.stopped, self.generation == token else { return }
                self.process = nil
                self.healthTask?.cancel()
                self.scheduleRestart(server: server, token: token, message: "Servidor encerrou (código \(status)).")
            }
        }
        process = child
        publish("starting", "Iniciando o servidor local…")
        do { try child.run() } catch { process = nil; throw error }
        monitor(server: server, token: token)
    }

    private func monitor(server: URL, token: Int) {
        healthTask?.cancel()
        healthTask = Task { [weak self] in
            guard let self else { return }
            var misses = 0
            var ready = false
            var stableChecks = 0
            while !Task.isCancelled, !self.stopped, self.generation == token {
                do {
                    var request = URLRequest(url: Self.endpoint.appendingPathComponent("settings"))
                    request.timeoutInterval = 2
                    let (data, response) = try await self.network.data(for: request)
                    let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                    guard (response as? HTTPURLResponse)?.statusCode == 200, (json?["values"] as? [String: Any])?["serverVersion"] is String else {
                        throw self.failure("Resposta inesperada do servidor local.")
                    }
                    misses = 0
                    stableChecks += 1
                    if !ready {
                        ready = true
                        self.publish("ready", "Servidor de streaming pronto")
                    }
                    if stableChecks >= 10 { self.failures = 0 }
                } catch {
                    if Task.isCancelled || self.stopped { return }
                    misses += 1
                    if misses >= (ready ? 5 : 30) {
                        self.publish("restarting", "Servidor sem resposta; reiniciando…")
                        self.process?.terminate()
                        return
                    }
                }
                try? await Task.sleep(nanoseconds: ready ? 3_000_000_000 : 500_000_000)
            }
        }
    }

    private func scheduleRestart(server: URL, token: Int, message: String) {
        guard !stopped, generation == token else { return }
        failures += 1
        let delay = min(30, 1 << min(failures - 1, 5))
        publish("restarting", "\(message) Nova tentativa em \(delay) s. Logs: ~/Library/Logs/Seraflix/server.log")
        sessionTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000_000)
            guard let self, !Task.isCancelled, !self.stopped, self.generation == token else { return }
            do { try self.launch(server: server, generation: token) }
            catch { self.scheduleRestart(server: server, token: token, message: error.localizedDescription) }
        }
    }

    private func ensurePortAvailable() throws {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw failure("Falha ao verificar a porta 11470.") }
        defer { close(descriptor) }
        var reuse: Int32 = 1
        setsockopt(descriptor, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout.size(ofValue: reuse)))
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = UInt16(11470).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard result == 0 else {
            throw failure("A porta 11470 está ocupada. Encerre o Stremio/Stremio Service e abra o Seraflix novamente.")
        }
    }

    private func prepareLog() throws {
        try? output?.close()
        try FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        let log = logDirectory.appendingPathComponent("server.log")
        let size = (try? FileManager.default.attributesOfItem(atPath: log.path)[.size] as? NSNumber)?.intValue ?? 0
        if size > 5_000_000 {
            let previous = logDirectory.appendingPathComponent("server.previous.log")
            try? FileManager.default.removeItem(at: previous)
            try FileManager.default.moveItem(at: log, to: previous)
        }
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
        output = try FileHandle(forWritingTo: log)
        try output?.seekToEnd()
        try output?.write(contentsOf: Data("\n[Seraflix] Iniciando \(Self.version) em \(Date())\n".utf8))
    }

    private func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "Seraflix.Server", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
