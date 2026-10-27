import AppKit
import CMPV
import Darwin
import OpenGL.GL3

/// libmpv decodifica/renderiza; a WKWebView sobreposta continua dona dos controles.
/// Todas as operações AppKit e libmpv ocorrem no loop principal. Os callbacks C
/// apenas agendam trabalho, sem reentrar no mpv a partir de suas próprias threads.
final class MPVPlayer {
    var onEvent: ((String, [String: Any]) -> Void)?
    var view: NSView { surface }
    private(set) var isPlaying = false
    private let surface: MPVSurface
    private var handle: OpaquePointer?
    private var renderContext: OpaquePointer?
    private var callbackContext: UnsafeMutableRawPointer?
    private var closed = false
    private var loaded = false
    private var session = 0
    private var requestID: UInt64 = 1
    private var commandSessions: [UInt64: (session: Int, load: Bool)] = [:]
    private var entrySessions: [Int64: Int] = [:]
    private var activeEntryID: Int64?
    private var activeSession: Int?
    private var redirectSession: Int?
    private var acceptingMedia = false
    private var pendingFileLoaded = false
    private var frameCount = 0
    private var renderedForSession = false
    private let smokeRendering = CommandLine.arguments.contains("--smoke-test")
    private var position: Double = 0
    private var duration: Double = 0
    private var paused = true
    private var buffering = false
    private var bufferEnd: Double = 0
    private var lastTimeEvent = Date.distantPast
    private var timePending = false

    enum Failure: LocalizedError {
        case message(String)
        var errorDescription: String? {
            if case .message(let text) = self { return text }
            return nil
        }
    }

    init() throws {
        // libmpv exige decimal com ponto mesmo em sistemas configurados em pt-BR.
        setlocale(LC_NUMERIC, "C")
        guard let surface = MPVSurface(videoSurface: true), let mpv = mpv_create() else {
            throw Failure.message("Não foi possível criar o player OpenGL/libmpv.")
        }
        self.surface = surface
        self.handle = mpv
        surface.player = self
        do {
            // VideoToolbox usa o decodificador HEVC do M1/M3; o bundle é arm64
            // nativo no Apple Silicon. auto-safe mantém fallback para outros codecs.
            let options = [
                "vo": "libmpv", "hwdec": "auto-safe", "config": "no",
                "load-scripts": "no", "osc": "no", "input-default-bindings": "no",
                "input-vo-keyboard": "no", "terminal": "no", "idle": "yes",
                "keep-open": "no", "audio-client-name": "Seraflix",
                "audio-channels": "auto", "cache": "yes", "cache-secs": "20",
                "demuxer-max-bytes": "256MiB", "demuxer-max-back-bytes": "64MiB",
                "sub-auto": "no", "ytdl": "no", "network-timeout": "30"
            ]
            for (name, value) in options {
                try check(mpv_set_option_string(mpv, name, value))
            }
            try check(mpv_initialize(mpv))
            // Contexto fraco retido enquanto callbacks C podem existir.
            let callback = MPVCallbacks(self)
            let context = Unmanaged.passRetained(callback).toOpaque()
            callbackContext = context
            mpv_set_wakeup_callback(mpv, { raw in
                guard let raw = raw else { return }
                let callback = Unmanaged<MPVCallbacks>.fromOpaque(raw).takeUnretainedValue()
                DispatchQueue.main.async { [weak callback] in callback?.player?.drainEvents() }
            }, context)
            for (index, name) in ["time-pos", "duration", "pause", "paused-for-cache",
                                  "demuxer-cache-time", "track-list", "volume", "mute"].enumerated() {
                try check(mpv_observe_property(mpv, UInt64(index + 1), name, MPV_FORMAT_NODE))
            }
        } catch {
            shutdown()
            throw error
        }
    }

    /// Lista fechada: a web não ganha acesso a run, scripts nem comandos mpv livres.
    func handle(command: String, args: [String: Any]) throws {
        precondition(Thread.isMainThread)
        guard !closed else { throw Failure.message("O player já foi encerrado.") }
        switch command {
        case "load":
            let url = try mediaURL(args["url"])
            let start = try number(args["startTime"] ?? 0, minimum: 0)
            session += 1
            acceptingMedia = true
            pendingFileLoaded = false
            frameCount = 0
            renderedForSession = false
            loaded = false
            paused = false
            position = start
            duration = 0
            bufferEnd = start
            buffering = true
            isPlaying = true
            // A view já pertence à janela antes de load. Criar o render context
            // aqui evita depender do primeiro draw para liberar o VO do mpv.
            try prepareRenderer()
            try send(["set", "pause", "no"])
            try send(["loadfile", url, "replace", "-1", "start=\(start)"])
            emitTime(force: true)
        case "play": try send(["set", "pause", "no"])
        case "pause": try send(["set", "pause", "yes"])
        case "seek":
            let value = try number(args["position"], minimum: 0)
            try send(["seek", String(value), "absolute+exact"])
        case "stop":
            acceptingMedia = false
            loaded = false
            isPlaying = false
            paused = true
            try send(["stop"])
            emitTime(force: true)
        case "audio": try send(["set", "aid", try trackID(args["id"])])
        case "subtitle":
            if args["url"] != nil {
                let url = try mediaURL(args["url"])
                try send(["sub-add", url, "select", args["title"] as? String ?? "Legenda",
                          args["lang"] as? String ?? ""])
            } else {
                try send(["set", "sid", try trackID(args["id"])])
            }
        case "volume":
            try send(["set", "volume", String(try number(args["value"], minimum: 0, maximum: 100))])
        case "mute":
            guard let value = args["value"] as? Bool else { throw Failure.message("Mute inválido.") }
            try send(["set", "mute", value ? "yes" : "no"])
        case "subtitleDelay":
            try send(["set", "sub-delay", String(try number(args["value"], minimum: -600, maximum: 600))])
        default: throw Failure.message("Comando de reprodução não reconhecido: \(command)")
        }
    }

    private func mediaURL(_ input: Any?) throws -> String {
        guard let string = input as? String, !string.contains("\0"),
              let url = URL(string: string), let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme), url.host != nil else {
            throw Failure.message("O player aceita somente URLs HTTP ou HTTPS válidas.")
        }
        return string
    }

    private func trackID(_ input: Any?) throws -> String {
        let value = (input as? String) ?? (input as? NSNumber)?.stringValue ?? ""
        guard value == "no" || (Int(value).map { $0 > 0 } ?? false) else {
            throw Failure.message("Faixa de áudio/legenda inválida.")
        }
        return value
    }

    private func number(_ input: Any?, minimum: Double, maximum: Double = .greatestFiniteMagnitude) throws -> Double {
        guard let value = input as? NSNumber, value.doubleValue.isFinite,
              value.doubleValue >= minimum, value.doubleValue <= maximum else {
            throw Failure.message("Parâmetro numérico fora do intervalo permitido.")
        }
        return value.doubleValue
    }

    private func check(_ status: Int32) throws {
        if status < 0 {
            throw Failure.message("libmpv: \(String(cString: mpv_error_string(status)))")
        }
    }

    private func send(_ command: [String]) throws {
        guard let mpv = handle else { return }
        guard !command.contains(where: { $0.contains("\0") }) else {
            throw Failure.message("Parâmetro de texto inválido.")
        }
        let strings = command.map { strdup($0) }
        defer { strings.forEach { free($0) } }
        var pointers: [UnsafePointer<CChar>?] = strings.map { pointer in
            pointer.map { UnsafePointer<CChar>($0) }
        }
        pointers.append(nil)
        requestID &+= 1
        commandSessions[requestID] = (session, command.first == "loadfile")
        let status = pointers.withUnsafeMutableBufferPointer { mpv_command_async(mpv, requestID, $0.baseAddress) }
        if status < 0 { commandSessions.removeValue(forKey: requestID) }
        try check(status)
    }

    fileprivate func prepareRenderer() throws {
        guard renderContext == nil, let mpv = handle, !closed else { return }
        guard let context = surface.openGLContext else {
            throw Failure.message("Contexto OpenGL indisponível.")
        }
        context.makeCurrentContext()
        try check(sera_mpv_render_create(&renderContext, mpv))
        if let renderer = renderContext {
            mpv_render_context_set_update_callback(renderer, { raw in
                guard let raw = raw else { return }
                let callback = Unmanaged<MPVCallbacks>.fromOpaque(raw).takeUnretainedValue()
                DispatchQueue.main.async { [weak callback] in
                    guard let player = callback?.player, !player.closed,
                          let renderer = player.renderContext else { return }
                    if mpv_render_context_update(renderer) & UInt64(MPV_RENDER_UPDATE_FRAME.rawValue) != 0 {
                        player.surface.needsDisplay = true
                    }
                }
            }, callbackContext)
        }
    }

    fileprivate func draw() {
        guard !closed, let context = surface.openGLContext else { return }
        do { try prepareRenderer() }
        catch { emit("error", ["message": error.localizedDescription]); return }
        context.makeCurrentContext()
        let rect = surface.convertToBacking(surface.bounds)
        guard rect.width >= 1, rect.height >= 1, let renderer = renderContext else { return }
        let status = sera_mpv_render(renderer, Int32(rect.width), Int32(rect.height))
        // Apenas o smoke lê a GPU: comprova pixels não pretos no framebuffer do
        // mpv. Não comprova a composição final da WKWebView nem fidelidade HDR.
        let current = status >= 0 && acceptingMedia && loaded && activeSession == session
        let pixelNonBlack = smokeRendering && current && !renderedForSession
            ? sampleNonBlack(width: Int32(rect.width), height: Int32(rect.height)) : false
        context.flushBuffer()
        mpv_render_context_report_swap(renderer)
        if current {
            frameCount += 1
            if !renderedForSession && (!smokeRendering || pixelNonBlack) {
                renderedForSession = true
                var data: [String: Any] = ["frameCount": frameCount]
                if smokeRendering { data["pixelNonBlack"] = pixelNonBlack }
                emit("rendered", data)
            }
        } else if status < 0 {
            emit("error", ["message": String(cString: mpv_error_string(status))])
        }
    }

    private func sampleNonBlack(width: Int32, height: Int32) -> Bool {
        let sampleWidth = min(width, 8)
        let sampleHeight = min(height, 8)
        var pixels = [UInt8](repeating: 0, count: Int(sampleWidth * sampleHeight * 4))
        glBindFramebuffer(GLenum(GL_READ_FRAMEBUFFER), 0)
        glReadBuffer(GLenum(GL_BACK))
        pixels.withUnsafeMutableBytes { bytes in
            glReadPixels((width - sampleWidth) / 2, (height - sampleHeight) / 2,
                         sampleWidth, sampleHeight, GLenum(GL_RGBA), GLenum(GL_UNSIGNED_BYTE), bytes.baseAddress)
        }
        return stride(from: 0, to: pixels.count, by: 4).contains { index in
            pixels[index] > 8 || pixels[index + 1] > 8 || pixels[index + 2] > 8
        }
    }

    private func drainEvents() {
        guard !closed, let mpv = handle else { return }
        while !closed, let pointer = mpv_wait_event(mpv, 0) {
            let event = pointer.pointee
            switch event.event_id {
            case MPV_EVENT_NONE: return
            case MPV_EVENT_START_FILE:
                guard let start = event.data?.assumingMemoryBound(to: mpv_event_start_file.self).pointee else { continue }
                activeEntryID = start.playlist_entry_id
                activeSession = entrySessions[start.playlist_entry_id] ?? redirectSession
                redirectSession = nil
                pendingFileLoaded = false
            case MPV_EVENT_FILE_LOADED:
                // COMMAND_REPLY e START_FILE podem chegar em qualquer ordem.
                pendingFileLoaded = true
                finishLoadingIfCurrent()
            case MPV_EVENT_PROPERTY_CHANGE:
                guard acceptingMedia, activeSession == session else { continue }
                guard let data = event.data?.assumingMemoryBound(to: mpv_event_property.self).pointee,
                      data.format == MPV_FORMAT_NODE, let value = data.data,
                      let propertyName = data.name else { continue }
                let node = value.assumingMemoryBound(to: mpv_node.self).pointee
                let object = Self.json(node)
                let name = String(cString: propertyName)
                switch name {
                case "time-pos": position = (object as? NSNumber)?.doubleValue ?? position
                case "duration": duration = (object as? NSNumber)?.doubleValue ?? 0
                case "pause": paused = object as? Bool ?? true
                case "paused-for-cache": buffering = object as? Bool ?? false
                case "demuxer-cache-time": bufferEnd = (object as? NSNumber)?.doubleValue ?? position
                case "track-list": emitTracks(object)
                case "volume", "mute": emit("state", [name: object])
                default: break
                }
                isPlaying = (loaded || buffering) && !paused
                emitTime(force: name == "pause" || name == "paused-for-cache")
            case MPV_EVENT_END_FILE:
                guard let end = event.data?.assumingMemoryBound(to: mpv_event_end_file.self).pointee else { continue }
                let endedSession = entrySessions[end.playlist_entry_id] ?? (activeEntryID == end.playlist_entry_id ? activeSession : nil)
                if end.reason == MPV_END_FILE_REASON_REDIRECT {
                    redirectSession = endedSession
                    continue
                }
                // loadfile replace também encerra a entrada anterior. Seu EOF/erro
                // tardio nunca deve receber o identificador da mídia seguinte.
                guard acceptingMedia, endedSession == session,
                      end.reason != MPV_END_FILE_REASON_STOP else { continue }
                loaded = false
                paused = true
                buffering = false
                isPlaying = false
                if end.reason == MPV_END_FILE_REASON_ERROR {
                    emit("error", ["message": String(cString: mpv_error_string(end.error))])
                } else {
                    emit("ended", ["reason": end.reason == MPV_END_FILE_REASON_EOF ? "eof" : "stop"])
                }
                emitTime(force: true)
            case MPV_EVENT_COMMAND_REPLY:
                guard let command = commandSessions.removeValue(forKey: event.reply_userdata) else { continue }
                if command.load, event.error >= 0,
                   let response = event.data?.assumingMemoryBound(to: mpv_event_command.self).pointee,
                   let result = Self.json(response.result) as? [String: Any],
                   let entry = result["playlist_entry_id"] as? NSNumber {
                    entrySessions[entry.int64Value] = command.session
                    if activeEntryID == entry.int64Value {
                        activeSession = command.session
                        finishLoadingIfCurrent()
                    }
                    // Só as entradas recentes são necessárias para rejeitar eventos.
                    if entrySessions.count > 64 {
                        entrySessions = entrySessions.filter { $0.value >= session - 16 }
                    }
                }
                if event.error < 0, command.session == session, acceptingMedia {
                    emit("error", ["message": String(cString: mpv_error_string(event.error))])
                }
            case MPV_EVENT_QUEUE_OVERFLOW:
                emit("error", ["message": "A fila de eventos do player excedeu o limite."])
            default: break
            }
        }
    }

    private func finishLoadingIfCurrent() {
        guard acceptingMedia, activeSession == session, pendingFileLoaded else { return }
        pendingFileLoaded = false
        loaded = true
        buffering = false
        isPlaying = !paused
        emit("loaded", [:])
        // Não perder track-list caso sua primeira notificação tenha chegado antes
        // do COMMAND_REPLY que identifica esta entrada da playlist.
        if let mpv = handle {
            var tracks = mpv_node()
            if mpv_get_property(mpv, "track-list", MPV_FORMAT_NODE, &tracks) >= 0 {
                emitTracks(Self.json(tracks))
                mpv_free_node_contents(&tracks)
            }
        }
        emitTime(force: true)
    }

    private func emitTracks(_ object: Any) {
        let tracks = object as? [[String: Any]] ?? []
        func convert(_ type: String) -> [[String: Any]] {
            tracks.filter { $0["type"] as? String == type }.map { track in
                ["id": (track["id"] as? NSNumber)?.stringValue ?? "",
                 "lang": track["lang"] as? String ?? "und",
                 "title": track["title"] as? String ?? track["lang"] as? String ?? (type == "audio" ? "Áudio" : "Legenda"),
                 "selected": track["selected"] as? Bool ?? false,
                 "external": track["external"] as? Bool ?? false]
            }
        }
        emit("tracks", ["audio": convert("audio"), "subtitles": convert("sub")])
    }

    private func emitTime(force: Bool = false) {
        if !force && Date().timeIntervalSince(lastTimeEvent) < 0.25 {
            if !timePending {
                timePending = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                    guard let self = self, !self.closed else { return }
                    self.timePending = false
                    self.emitTime(force: true)
                }
            }
            return
        }
        lastTimeEvent = Date()
        emit("time", ["position": position, "duration": duration, "paused": paused,
                      "buffering": buffering, "bufferEnd": max(position, bufferEnd),
                      "active": session > 0 && acceptingMedia && (loaded || buffering)])
    }

    private func emit(_ event: String, _ value: [String: Any]) {
        guard !closed else { return }
        var payload = value
        payload["session"] = session
        onEvent?(event, payload)
    }

    /// Copia os valores enquanto o mpv_event ainda é válido (até o próximo wait).
    private static func json(_ node: mpv_node) -> Any {
        switch node.format {
        case MPV_FORMAT_STRING: return node.u.string.map { String(cString: $0) } ?? ""
        case MPV_FORMAT_FLAG: return node.u.flag != 0
        case MPV_FORMAT_INT64: return NSNumber(value: node.u.int64)
        case MPV_FORMAT_DOUBLE: return node.u.double_.isFinite ? NSNumber(value: node.u.double_) : NSNull()
        case MPV_FORMAT_NODE_ARRAY:
            guard let list = node.u.list?.pointee, let values = list.values, list.num > 0 else { return [Any]() }
            return (0..<Int(list.num)).map { json(values[$0]) }
        case MPV_FORMAT_NODE_MAP:
            guard let list = node.u.list?.pointee, let keys = list.keys, let values = list.values,
                  list.num > 0 else { return [String: Any]() }
            var object: [String: Any] = [:]
            for index in 0..<Int(list.num) {
                if let key = keys[index] { object[String(cString: key)] = json(values[index]) }
            }
            return object
        default: return NSNull()
        }
    }

    func shutdown() {
        guard !closed else { return }
        closed = true
        isPlaying = false
        surface.player = nil
        if let mpv = handle { mpv_set_wakeup_callback(mpv, nil, nil) }
        if let renderer = renderContext {
            surface.openGLContext?.makeCurrentContext()
            mpv_render_context_set_update_callback(renderer, nil, nil)
            mpv_render_context_free(renderer)
            renderContext = nil
        }
        if let mpv = handle { mpv_terminate_destroy(mpv); handle = nil }
        if let raw = callbackContext {
            Unmanaged<MPVCallbacks>.fromOpaque(raw).release()
            callbackContext = nil
        }
    }

    deinit { shutdown() }
}

private final class MPVCallbacks {
    weak var player: MPVPlayer?
    init(_ player: MPVPlayer) { self.player = player }
}

private final class MPVSurface: NSOpenGLView {
    weak var player: MPVPlayer?
    override var isOpaque: Bool { true }

    init?(videoSurface: Bool) {
        let attributes: [NSOpenGLPixelFormatAttribute] = [
            UInt32(NSOpenGLPFAOpenGLProfile), UInt32(NSOpenGLProfileVersion3_2Core),
            UInt32(NSOpenGLPFAAccelerated), UInt32(NSOpenGLPFADoubleBuffer),
            UInt32(NSOpenGLPFAColorSize), 24, UInt32(NSOpenGLPFAAlphaSize), 8, 0
        ]
        guard let format = NSOpenGLPixelFormat(attributes: attributes) else { return nil }
        super.init(frame: .zero, pixelFormat: format)
        wantsBestResolutionOpenGLSurface = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) não utilizado") }

    override func prepareOpenGL() {
        super.prepareOpenGL()
        var interval: GLint = 1
        openGLContext?.setValues(&interval, for: .swapInterval)
    }

    override func draw(_ dirtyRect: NSRect) { player?.draw() }
    override func reshape() { super.reshape(); needsDisplay = true }
}
