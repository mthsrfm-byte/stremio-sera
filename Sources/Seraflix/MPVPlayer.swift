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
    private var drawing = false
    private var drawCalls = 0
    private var renderUpdates = 0
    private var fboBefore: GLint = 0
    private var fboAfter: GLint = 0
    private var targetFBO: GLint = 0
    private var lastViewport = [GLint](repeating: 0, count: 4)
    private var lastGLError: GLenum = 0
    private var lastRenderStatus: Int32 = -9999
    private var appKitContextMatches = false
    private var rendererName = ""
    private var chosenHWDec = "auto-safe"

    /// Evidência de renderização para o diagnóstico; não passa pixels pela ponte.
    var renderDiagnostics: [String: Any] {
        ["drawCalls": drawCalls, "renderUpdates": renderUpdates, "frameCount": frameCount,
         "contextHasView": surface.openGLContext?.view != nil,
         "contextIsCurrent": surface.openGLContext?.cglContextObj == CGLGetCurrentContext(),
         "appKitContextMatches": appKitContextMatches, "layerBacked": surface.wantsLayer,
         "renderer": rendererName, "chosenHwdec": chosenHWDec,
         "visibleRect": NSStringFromRect(surface.visibleRect),
         "viewport": lastViewport.map { Int($0) }, "glError": Int(lastGLError),
         "lastRenderStatus": Int(lastRenderStatus), "fboBefore": Int(fboBefore),
         "fboAfter": Int(fboAfter), "targetFBO": Int(targetFBO)]
    }
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
    private var diagnosticLogs: [String] = []

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
        guard let surface = MPVSurface(videoSurface: true) else {
            throw Failure.message("Formato OpenGL 3.2 indisponível nesta máquina (GPU e fallback de software).")
        }
        guard let mpv = mpv_create() else {
            throw Failure.message("Não foi possível criar o contexto libmpv.")
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
                do { try check(mpv_set_option_string(mpv, name, value)) }
                catch { throw Failure.message("Ao configurar \(name)=\(value): \(error.localizedDescription)") }
            }
            do { try check(mpv_initialize(mpv)) }
            catch { throw Failure.message("Ao inicializar libmpv: \(error.localizedDescription)") }
            if smokeRendering { try check(mpv_request_log_messages(mpv, "info")) }
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
            diagnosticLogs.removeAll(keepingCapacity: true)
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
            // Opções por arquivo: não herdar IDs da mídia anterior e respeitar
            // o estado inicial “legendas desligadas” da interface.
            try send(["loadfile", url, "replace", "-1", "start=\(start),aid=auto,sid=no"])
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
        if let name = glGetString(GLenum(GL_RENDERER)) {
            rendererName = String(cString: UnsafeRawPointer(name).assumingMemoryBound(to: CChar.self))
            let normalized = rendererName.lowercased()
            if ["software", "llvmpipe", "softpipe", "swiftshader"].contains(where: { normalized.contains($0) }) {
                // Renderers sem GPU não compartilham as superfícies VideoToolbox
                // com a mesma confiabilidade. Copiar mantém o decode por hardware
                // e entrega pixels CPU ao GL; no M1/M3 com GPU permanece zero-copy.
                try check(mpv_set_property_string(mpv, "hwdec", "videotoolbox-copy"))
                chosenHWDec = "videotoolbox-copy"
            }
        }
        try check(sera_mpv_render_create(&renderContext, mpv))
        if let renderer = renderContext {
            mpv_render_context_set_update_callback(renderer, { raw in
                guard let raw = raw else { return }
                let callback = Unmanaged<MPVCallbacks>.fromOpaque(raw).takeUnretainedValue()
                DispatchQueue.main.async { [weak callback] in
                    guard let player = callback?.player, !player.closed,
                          let renderer = player.renderContext else { return }
                    if mpv_render_context_update(renderer) & UInt64(MPV_RENDER_UPDATE_FRAME.rawValue) != 0 {
                        player.renderUpdates += 1
                        // A WKWebView pode ocultar a surface para o rastreamento de
                        // oclusão do AppKit, mesmo com pixels transparentes. Forçar
                        // a pintura pelo AppKit para preservar o foco/drawable do
                        // NSOpenGLView; makeCurrentContext sozinho não faz esse preparo.
                        player.surface.needsDisplay = true
                        player.surface.layer?.setNeedsDisplay()
                        player.surface.displayIgnoringOpacity(player.surface.bounds)
                        player.surface.layer?.displayIfNeeded()
                    }
                }
            }, callbackContext)
        }
    }

    fileprivate func draw() {
        guard !closed, !drawing, let context = surface.openGLContext else { return }
        drawing = true
        drawCalls += 1
        defer { drawing = false }
        appKitContextMatches = context.cglContextObj == CGLGetCurrentContext()
        context.makeCurrentContext()
        // NSOpenGLView com layer usa um FBO do compositor; 0 só é correto no
        // drawable tradicional. Capturar o alvo antes de o mpv alterar GL state.
        glGetIntegerv(GLenum(GL_DRAW_FRAMEBUFFER_BINDING), &fboBefore)
        glGetIntegerv(GLenum(GL_VIEWPORT), &lastViewport)
        if fboBefore != 0 { targetFBO = fboBefore }
        else if !surface.wantsLayer || glIsFramebuffer(GLuint(targetFBO)) == 0 { targetFBO = 0 }
        do { try prepareRenderer() }
        catch { emitFailure(error.localizedDescription); return }
        let rect = surface.convertToBacking(surface.bounds)
        let width = surface.wantsLayer && lastViewport[2] > 0 ? lastViewport[2] : Int32(rect.width)
        let height = surface.wantsLayer && lastViewport[3] > 0 ? lastViewport[3] : Int32(rect.height)
        guard width > 0, height > 0, let renderer = renderContext else { return }
        let status = sera_mpv_render(renderer, targetFBO, width, height)
        lastRenderStatus = status
        glGetIntegerv(GLenum(GL_DRAW_FRAMEBUFFER_BINDING), &fboAfter)
        // Apenas o smoke lê a GPU: comprova pixels não pretos no framebuffer do
        // mpv. Não comprova a composição final da WKWebView nem fidelidade HDR.
        let current = status >= 0 && acceptingMedia && loaded && activeSession == session
        let pixelNonBlack = smokeRendering && current && !renderedForSession
            ? sampleNonBlack(fbo: targetFBO, width: width, height: height) : false
        if smokeRendering { lastGLError = glGetError() }
        context.flushBuffer()
        mpv_render_context_report_swap(renderer)
        if current {
            frameCount += 1
            if !renderedForSession && (!smokeRendering || pixelNonBlack) {
                renderedForSession = true
                var data: [String: Any] = ["frameCount": frameCount]
                if smokeRendering {
                    data["pixelNonBlack"] = pixelNonBlack
                    if let name = glGetString(GLenum(GL_RENDERER)) {
                        data["renderer"] = String(cString: UnsafeRawPointer(name).assumingMemoryBound(to: CChar.self))
                    }
                }
                emit("rendered", data)
            }
        } else if status < 0 {
            emitFailure(String(cString: mpv_error_string(status)))
        }
    }

    private func sampleNonBlack(fbo: GLint, width: Int32, height: Int32) -> Bool {
        let sampleWidth = min(width, 8)
        let sampleHeight = min(height, 8)
        var pixels = [UInt8](repeating: 0, count: Int(sampleWidth * sampleHeight * 4))
        var previousFBO: GLint = 0
        var previousBuffer: GLint = 0
        glGetIntegerv(GLenum(GL_READ_FRAMEBUFFER_BINDING), &previousFBO)
        glGetIntegerv(GLenum(GL_READ_BUFFER), &previousBuffer)
        glBindFramebuffer(GLenum(GL_READ_FRAMEBUFFER), GLuint(fbo))
        var targetPreviousBuffer: GLint = 0
        glGetIntegerv(GLenum(GL_READ_BUFFER), &targetPreviousBuffer)
        glReadBuffer(GLenum(fbo == 0 ? GL_BACK : GL_COLOR_ATTACHMENT0))
        defer {
            glReadBuffer(GLenum(targetPreviousBuffer))
            glBindFramebuffer(GLenum(GL_READ_FRAMEBUFFER), GLuint(previousFBO))
            glReadBuffer(GLenum(previousBuffer))
        }
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
            case MPV_EVENT_LOG_MESSAGE:
                guard smokeRendering,
                      let log = event.data?.assumingMemoryBound(to: mpv_event_log_message.self).pointee,
                      let message = log.text else { continue }
                let prefix = log.prefix.map { String(cString: $0) } ?? "mpv"
                let level = log.level.map { String(cString: $0) } ?? "info"
                let text = String(String(cString: message).trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000))
                let line = "[\(prefix)] \(text)"
                diagnosticLogs.append(line)
                if diagnosticLogs.count > 40 { diagnosticLogs.removeFirst(diagnosticLogs.count - 40) }
                emit("log", ["prefix": prefix, "level": level, "text": line])
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
                    emitFailure(String(cString: mpv_error_string(end.error)))
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
                    emitFailure(String(cString: mpv_error_string(event.error)))
                }
            case MPV_EVENT_QUEUE_OVERFLOW:
                emitFailure("A fila de eventos do player excedeu o limite.")
            default: break
            }
        }
    }

    private func finishLoadingIfCurrent() {
        guard acceptingMedia, activeSession == session, pendingFileLoaded else { return }
        pendingFileLoaded = false
        loaded = true
        buffering = false
        // As notificações iniciais podem preceder o COMMAND_REPLY do loadfile.
        // Reconstituir o estado por propriedades tipadas, sem depender de nova
        // mudança de duração/pausa que talvez não aconteça durante este arquivo.
        if let mpv = handle {
            func readNumber(_ name: String, fallback: Double) -> Double {
                var value = fallback
                guard mpv_get_property(mpv, name, MPV_FORMAT_DOUBLE, &value) >= 0,
                      value.isFinite else { return fallback }
                return value
            }
            func readFlag(_ name: String, fallback: Bool) -> Bool {
                var value: Int32 = fallback ? 1 : 0
                guard mpv_get_property(mpv, name, MPV_FORMAT_FLAG, &value) >= 0 else { return fallback }
                return value != 0
            }
            duration = max(0, readNumber("duration", fallback: duration))
            position = max(0, readNumber("time-pos", fallback: position))
            bufferEnd = max(position, readNumber("demuxer-cache-time", fallback: bufferEnd))
            paused = readFlag("pause", fallback: paused)
            buffering = readFlag("paused-for-cache", fallback: buffering)
        }
        isPlaying = !paused
        let loadedSession = session
        emit("loaded", ["duration": duration, "position": position])
        guard !closed, acceptingMedia, session == loadedSession else { return }
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

    private func emitFailure(_ message: String) {
        var data: [String: Any] = ["message": message]
        if smokeRendering { data["logs"] = diagnosticLogs }
        emit("error", data)
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
        let base: [NSOpenGLPixelFormatAttribute] = [
            UInt32(NSOpenGLPFAOpenGLProfile), UInt32(NSOpenGLProfileVersion3_2Core),
            UInt32(NSOpenGLPFADoubleBuffer), UInt32(NSOpenGLPFAColorSize), 24,
            UInt32(NSOpenGLPFAAlphaSize), 8, 0
        ]
        // Sempre preferir a GPU dos Macs M1/M3. Algumas VMs de CI só oferecem
        // renderer de software; manter o mesmo perfil 3.2 nesse fallback.
        let accelerated = [UInt32(NSOpenGLPFAAccelerated)] + base
        guard let format = NSOpenGLPixelFormat(attributes: accelerated)
            ?? NSOpenGLPixelFormat(attributes: base) else { return nil }
        super.init(frame: .zero, pixelFormat: format)
        // Compor no mesmo sistema de layers da WKWebView sobreposta.
        wantsLayer = true
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
