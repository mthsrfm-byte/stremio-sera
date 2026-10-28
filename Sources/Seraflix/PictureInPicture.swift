import AppKit

// Janela flutuante do vídeo (Picture in Picture): fica por cima de tudo, em todos os espaços.
// Arrastar o vídeo move; a alça no canto superior esquerdo redimensiona em 16:9 (o canto
// oposto fica parado, como no PiP do macOS). Enquanto o vídeo não começa, mostra a mesma
// abertura do player em tela cheia, em miniatura.
@MainActor
final class PictureInPicture: NSObject {
    struct Artwork {
        var title = ""
        var poster: URL?
        var background: URL?
        var logo: URL?
    }

    static let minWidth: CGFloat = 320
    /// Tela onde o app estava (o PiP nasce nela, não na tela "principal" do sistema).
    var anchorScreen: NSScreen?
    private static let savedFrameKey = "pipFrame"

    private var panel: PiPPanel?
    private var playButton: PiPButton?
    private var loading: PiPLoadingView?
    var isActive: Bool { panel != nil }

    var onTogglePlay: (() -> Void)?
    var onExpand: (() -> Void)?
    var onClose: (() -> Void)?

    var artwork = Artwork() { didSet { loading?.artwork = artwork } }
    var status = "" { didSet { loading?.status = status } }
    var subtitle = "" { didSet { loading?.subtitle = subtitle } }
    var caption = "" { didSet { loading?.caption = caption } }

    private var screenFrame: NSRect {
        (panel?.screen ?? anchorScreen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    }
    private var maxWidth: CGFloat { min(1280, screenFrame.width * 0.6) }

    func show(video: NSView, paused: Bool, started: Bool) {
        guard panel == nil else { return }
        let screen = screenFrame
        var frame = NSRect(x: screen.maxX - 480 - 24, y: screen.minY + 24, width: 480, height: 270)
        // Volta onde o usuário deixou da última vez.
        if let saved = UserDefaults.standard.string(forKey: Self.savedFrameKey) { frame = NSRectFromString(saved) }
        frame = fitted(frame, in: screen)
        let size = frame.size

        let panel = PiPPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        // Janela transparente: quem desenha o fundo é a view arredondada (senão sobra um quadrado preto).
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.onResize = { [weak self] factor in self?.scale(by: factor) }

        let root = PiPRootView(frame: NSRect(origin: .zero, size: size))
        root.wantsLayer = true
        root.layer?.cornerRadius = 12
        root.layer?.cornerCurve = .continuous
        root.layer?.masksToBounds = true
        root.layer?.backgroundColor = NSColor.black.cgColor
        root.onDoubleClick = { [weak self] in self?.onExpand?() }
        root.onMoved = { [weak self] in self?.settle() }
        panel.contentView = root

        video.removeFromSuperview()
        video.frame = root.bounds
        video.autoresizingMask = [.width, .height]
        root.addSubview(video)

        let card = PiPLoadingView(frame: root.bounds)
        card.autoresizingMask = [.width, .height]
        card.artwork = artwork
        card.status = status
        card.subtitle = subtitle
        card.caption = caption
        card.isHidden = started
        card.layer?.zPosition = 1
        root.addSubview(card)

        // Controles: todos no mesmo botão circular translúcido, com SF Symbols do mesmo peso.
        let controls = PiPControlsView(frame: root.bounds)
        controls.autoresizingMask = [.width, .height]
        controls.layer?.zPosition = 2
        controls.alphaValue = 0
        let resize = PiPButton(symbol: "arrow.up.left.and.arrow.down.right", label: "Redimensionar")
        resize.isResizeHandle = true
        resize.onResizeDrag = { [weak self] start, mouseStart in self?.resize(from: start, mouseStart: mouseStart) }
        let back = PiPButton(symbol: "pip.exit", label: "Voltar ao app") { [weak self] in self?.onExpand?() }
        let close = PiPButton(symbol: "xmark", label: "Fechar") { [weak self] in self?.onClose?() }
        let play = PiPButton(symbol: paused ? "play.fill" : "pause.fill", label: "Tocar/Pausar", diameter: 44) { [weak self] in self?.onTogglePlay?() }
        let m: CGFloat = 10, d = PiPButton.defaultDiameter
        resize.frame.origin = NSPoint(x: m, y: size.height - m - d)
        resize.autoresizingMask = [.maxXMargin, .minYMargin]
        close.frame.origin = NSPoint(x: size.width - m - d, y: size.height - m - d)
        close.autoresizingMask = [.minXMargin, .minYMargin]
        back.frame.origin = NSPoint(x: size.width - m - d * 2 - 8, y: size.height - m - d)
        back.autoresizingMask = [.minXMargin, .minYMargin]
        play.frame.origin = NSPoint(x: (size.width - 44) / 2, y: (size.height - 44) / 2)
        play.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]
        [resize, back, close, play].forEach(controls.addSubview)
        root.addSubview(controls)
        root.onHover = { inside in
            NSAnimationContext.runAnimationGroup { $0.duration = 0.18; controls.animator().alphaValue = inside ? 1 : 0 }
        }

        self.panel = panel
        playButton = play
        loading = card
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { $0.duration = 0.2; panel.animator().alphaValue = 1 }
    }

    func hide() {
        panel?.orderOut(nil)
        panel?.contentView = nil
        panel = nil
        playButton = nil
        loading = nil
    }

    func update(paused: Bool) {
        playButton?.symbol = paused ? "play.fill" : "pause.fill"
    }

    /// O vídeo começou (ou voltou a carregar): troca entre a abertura e a imagem.
    func setStarted(_ started: Bool) {
        guard let loading = loading, loading.isHidden != started else { return }
        if !started { loading.alphaValue = 0; loading.isHidden = false }
        NSAnimationContext.runAnimationGroup({ $0.duration = 0.4 }, completionHandler: {
            if started { loading.isHidden = true }
            loading.alphaValue = 1
        })
        loading.animator().alphaValue = started ? 0 : 1
    }

    // Arrasto da alça do canto superior esquerdo: o canto inferior direito fica fixo e o
    // tamanho segue a posição absoluta do mouse (deltas de evento acumulam erro e tremem).
    private func resize(from start: NSRect, mouseStart: NSPoint) {
        guard let panel = panel else { return }
        let now = NSEvent.mouseLocation
        let byX = start.width + (mouseStart.x - now.x)
        let byY = (start.height + (now.y - mouseStart.y)) * 16 / 9
        let screen = screenFrame
        // Não passa da borda esquerda nem do topo da tela.
        let roomX = start.maxX - screen.minX
        let roomY = (screen.maxY - start.minY) * 16 / 9
        let w = min(max(Self.minWidth, max(byX, byY)), maxWidth, roomX, roomY).rounded()
        let h = (w * 9 / 16).rounded()
        panel.setFrame(NSRect(x: start.maxX - w, y: start.minY, width: w, height: h), display: true, animate: false)
    }

    private func scale(by factor: CGFloat) {
        guard let panel = panel else { return }
        let f = panel.frame
        // Pinça/atalho: mantém o canto inferior direito, como a alça.
        let w = min(maxWidth, max(Self.minWidth, f.width * factor))
        let h = w * 9 / 16
        panel.setFrame(fitted(NSRect(x: f.maxX - w, y: f.minY, width: w, height: h), in: screenFrame), display: true)
        save()
    }

    /// Depois de arrastar/redimensionar: mantém o PiP inteiro na tela e lembra a posição.
    fileprivate func settle() {
        guard let panel = panel else { return }
        let f = fitted(panel.frame, in: screenFrame)
        if f != panel.frame { panel.setFrame(f, display: true, animate: true) }
        save()
    }

    private func save() {
        if let f = panel?.frame { UserDefaults.standard.set(NSStringFromRect(f), forKey: Self.savedFrameKey) }
    }

    private func fitted(_ rect: NSRect, in screen: NSRect) -> NSRect {
        let w = min(maxWidth, max(Self.minWidth, rect.width))
        let h = w * 9 / 16
        let x = min(max(rect.minX, screen.minX + 8), screen.maxX - w - 8)
        let y = min(max(rect.minY, screen.minY + 8), screen.maxY - h - 8)
        return NSRect(x: x, y: y, width: w, height: h)
    }
}

private final class PiPPanel: NSPanel {
    var onResize: ((CGFloat) -> Void)?
    override var canBecomeKey: Bool { true }
    override func magnify(with event: NSEvent) { onResize?(1 + event.magnification) }
    override func keyDown(with event: NSEvent) {
        guard event.modifierFlags.contains(.command) else { return super.keyDown(with: event) }
        switch event.charactersIgnoringModifiers {
        case "=", "+": onResize?(1.15)
        case "-": onResize?(1 / 1.15)
        default: super.keyDown(with: event)
        }
    }
}

// Raiz do PiP: arrastar em qualquer ponto move a janela; duplo clique volta ao app.
private final class PiPRootView: NSView {
    var onHover: ((Bool) -> Void)?
    var onDoubleClick: (() -> Void)?
    var onMoved: (() -> Void)?
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { onDoubleClick?(); return }
        window?.performDrag(with: event)
        onMoved?()
    }
}

// Camada dos controles: degradê no topo para os ícones lerem sobre qualquer imagem.
private final class PiPControlsView: NSView {
    private let top = CAGradientLayer()
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        top.colors = [NSColor.black.withAlphaComponent(0.55).cgColor, NSColor.black.withAlphaComponent(0).cgColor]
        top.startPoint = CGPoint(x: 0.5, y: 1)
        top.endPoint = CGPoint(x: 0.5, y: 0)
        layer?.addSublayer(top)
        layer?.backgroundColor = NSColor.black.withAlphaComponent(0.15).cgColor
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) não utilizado") }
    override func layout() {
        super.layout()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        top.frame = CGRect(x: 0, y: bounds.height - 64, width: bounds.width, height: 64)
        CATransaction.commit()
    }
    // Cliques fora dos botões passam para a raiz (mover/duplo clique).
    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }
}

// Botão circular único para todos os controles do PiP (mesmo tamanho de ícone, mesmo fundo, mesmo hover).
private final class PiPButton: NSView {
    static let defaultDiameter: CGFloat = 30
    var symbol: String { didSet { needsDisplay = true } }
    var isResizeHandle = false
    var onResizeDrag: ((NSRect, NSPoint) -> Void)?
    private let label: String
    private let action: (() -> Void)?
    private var hovering = false { didSet { needsDisplay = true } }
    private var pressed = false { didSet { needsDisplay = true } }

    init(symbol: String, label: String, diameter: CGFloat = PiPButton.defaultDiameter, action: (() -> Void)? = nil) {
        self.symbol = symbol
        self.label = label
        self.action = action
        super.init(frame: NSRect(x: 0, y: 0, width: diameter, height: diameter))
        toolTip = label
        setAccessibilityRole(.button)
        setAccessibilityLabel(label)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) não utilizado") }

    override var mouseDownCanMoveWindow: Bool { false }
    // O PiP não ativa o app: sem isto o primeiro clique só "acordava" a janela.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
    override func resetCursorRects() {
        guard isResizeHandle else { return }
        if #available(macOS 15.0, *) {
            addCursorRect(bounds, cursor: .frameResize(position: .topLeft, directions: .all))
        } else {
            addCursorRect(bounds, cursor: .crosshair)
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        let circle = NSBezierPath(ovalIn: bounds.insetBy(dx: 0.5, dy: 0.5))
        NSColor.black.withAlphaComponent(pressed ? 0.7 : hovering ? 0.6 : 0.45).setFill()
        circle.fill()
        NSColor.white.withAlphaComponent(hovering ? 0.35 : 0.18).setStroke()
        circle.lineWidth = 1
        circle.stroke()
        let point = bounds.width * 0.4
        guard let image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)?
            .withSymbolConfiguration(.init(pointSize: point, weight: .semibold))?
            .withSymbolConfiguration(.init(paletteColors: [.white])) else { return }
        let s = image.size
        image.draw(in: NSRect(x: (bounds.width - s.width) / 2, y: (bounds.height - s.height) / 2, width: s.width, height: s.height))
    }

    override func mouseDown(with event: NSEvent) {
        pressed = true
        defer { pressed = false }
        if isResizeHandle, let window = window {
            // Laço de arrasto próprio: segue o mouse até soltar, sem passar pelo mover da janela.
            let start = window.frame
            let mouseStart = NSEvent.mouseLocation
            while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
                if next.type == .leftMouseUp { break }
                onResizeDrag?(start, mouseStart)
            }
            (window.contentView as? PiPRootView)?.onMoved?()
            return
        }
        guard let window = window,
              let up = window.nextEvent(matching: [.leftMouseUp]) else { return }
        if bounds.contains(convert(up.locationInWindow, from: nil)) { action?() }
    }
}

// Abertura do PiP: a mesma da tela cheia, em miniatura. Arte do título flutuando ao fundo,
// sombra da esquerda e de baixo, e no canto inferior esquerdo o título, o episódio e o
// anel azul com o que está acontecendo ("✦ Smart Choice" embaixo).
private final class PiPLoadingView: NSView {
    var artwork = PictureInPicture.Artwork() { didSet { applyArtwork() } }
    var status = "" { didSet { mainLabel.stringValue = status.isEmpty ? "Preparando o vídeo" : status; needsLayout = true } }
    var subtitle = "" { didSet { subLabel.stringValue = subtitle; needsLayout = true } }
    var caption = "" { didSet { setCaption(); needsLayout = true } }

    private static let ink = NSColor(calibratedRed: 0.96, green: 0.957, blue: 0.937, alpha: 1)
    private static let blue = NSColor(calibratedRed: 0.2, green: 0.278, blue: 1, alpha: 1)
    private static let lilac = NSColor(calibratedRed: 0.55, green: 0.61, blue: 1, alpha: 1)

    private let art = CALayer()
    private let shadeLeft = CAGradientLayer()
    private let shadeBottom = CAGradientLayer()
    private let logo = CALayer()
    private let ring = CAShapeLayer()
    private let titleLabel = NSTextField(labelWithString: "")
    private let subLabel = NSTextField(labelWithString: "")
    private let mainLabel = NSTextField(labelWithString: "Preparando o vídeo")
    private let captionLabel = NSTextField(labelWithString: "")
    private var hasLogo = false

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        guard let root = layer else { return }
        root.backgroundColor = NSColor(calibratedRed: 0.043, green: 0.043, blue: 0.039, alpha: 1).cgColor
        root.masksToBounds = true

        art.contentsGravity = .resizeAspectFill
        art.opacity = 0
        let dark = NSColor(calibratedRed: 0.043, green: 0.043, blue: 0.039, alpha: 1)
        shadeLeft.colors = [dark.withAlphaComponent(0.92).cgColor, dark.withAlphaComponent(0.55).cgColor, dark.withAlphaComponent(0.2).cgColor]
        shadeLeft.locations = [0, 0.45, 1]
        shadeLeft.startPoint = CGPoint(x: 0, y: 0.5)
        shadeLeft.endPoint = CGPoint(x: 1, y: 0.5)
        shadeBottom.colors = [dark.withAlphaComponent(0).cgColor, dark.withAlphaComponent(0.95).cgColor]
        shadeBottom.startPoint = CGPoint(x: 0.5, y: 0.4)
        shadeBottom.endPoint = CGPoint(x: 0.5, y: 1)
        logo.contentsGravity = .resize
        ring.fillColor = nil
        ring.lineCap = .round
        [art, shadeLeft, shadeBottom, logo, ring].forEach(root.addSublayer)

        titleLabel.textColor = Self.ink
        titleLabel.maximumNumberOfLines = 2
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.cell?.wraps = true
        titleLabel.cell?.truncatesLastVisibleLine = true
        subLabel.textColor = Self.ink.withAlphaComponent(0.85)
        subLabel.lineBreakMode = .byTruncatingTail
        mainLabel.textColor = Self.ink.withAlphaComponent(0.88)
        mainLabel.lineBreakMode = .byTruncatingTail
        captionLabel.lineBreakMode = .byTruncatingTail
        [titleLabel, subLabel, mainLabel, captionLabel].forEach(addSubview)
        setCaption()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) não utilizado") }

    private func setCaption() {
        let text = caption.isEmpty ? "Smart Choice" : caption
        let size = captionLabel.font?.pointSize ?? 11
        let s = NSMutableAttributedString(string: "✦  ", attributes: [.foregroundColor: Self.lilac, .font: NSFont.systemFont(ofSize: size, weight: .bold)])
        s.append(NSAttributedString(string: text, attributes: [.foregroundColor: Self.ink.withAlphaComponent(0.55), .font: NSFont.systemFont(ofSize: size, weight: .medium)]))
        captionLabel.attributedStringValue = s
    }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let b = bounds
        // Mesma composição da tela cheia (1920 de largura) em escala.
        let k = b.width / 1920
        art.bounds = b.insetBy(dx: -b.width * 0.04, dy: -b.height * 0.04)
        art.position = CGPoint(x: b.midX, y: b.midY)
        shadeLeft.frame = b
        shadeBottom.frame = b

        let left = max(16, 120 * k)
        let width = b.width - left * 2
        let titleSize = max(17, 78 * k)
        let subSize = max(11, 30 * k)
        let mainSize = max(11.5, 22 * k)
        let capSize = max(10, 18 * k)
        let ringSize = max(16, 34 * k)
        titleLabel.font = NSFont(name: "BricolageGrotesque-ExtraBold", size: titleSize) ?? .systemFont(ofSize: titleSize, weight: .heavy)
        subLabel.font = .systemFont(ofSize: subSize, weight: .semibold)
        mainLabel.font = .systemFont(ofSize: mainSize, weight: .bold)
        captionLabel.font = .systemFont(ofSize: capSize)
        setCaption()

        // Monta de baixo para cima, ancorado no canto inferior esquerdo.
        var y = b.height - max(16, 120 * k)
        let textX = left + ringSize + max(9, 18 * k)
        let capH = ceil(capSize * 1.3)
        let mainH = ceil(mainSize * 1.3)
        captionLabel.frame = NSRect(x: textX, y: y - capH, width: width - (textX - left), height: capH)
        y -= capH + 2
        mainLabel.frame = NSRect(x: textX, y: y - mainH, width: width - (textX - left), height: mainH)
        let rowMid = (mainLabel.frame.minY + captionLabel.frame.maxY) / 2
        let lw = max(2.5, 4 * k)
        ring.frame = CGRect(x: left, y: rowMid - ringSize / 2, width: ringSize, height: ringSize)
        ring.path = CGPath(ellipseIn: CGRect(x: lw / 2, y: lw / 2, width: ringSize - lw, height: ringSize - lw), transform: nil)
        ring.lineWidth = lw
        y = mainLabel.frame.minY - max(12, 40 * k)
        if !subLabel.stringValue.isEmpty {
            let h = ceil(subSize * 1.3)
            subLabel.frame = NSRect(x: left, y: y - h, width: width, height: h)
            subLabel.isHidden = false
            y -= h + 4
        } else { subLabel.isHidden = true }
        if hasLogo, let contents = logo.contents {
            let img = contents as! CGImage
            let maxW = min(width, 620 * k * 1.6), maxH = max(34, 210 * k * 1.4)
            let r = min(maxW / CGFloat(img.width), maxH / CGFloat(img.height))
            let w = CGFloat(img.width) * r, h = CGFloat(img.height) * r
            logo.frame = CGRect(x: left, y: y - h, width: w, height: h)
            logo.isHidden = false
            titleLabel.isHidden = true
        } else {
            let h = min(titleLabel.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: width, height: 400)).height ?? titleSize * 1.2, titleSize * 2.3)
            titleLabel.frame = NSRect(x: left, y: y - h, width: width, height: h)
            titleLabel.isHidden = false
            logo.isHidden = true
        }
        CATransaction.commit()
        startAnimations()
    }

    private func startAnimations() {
        if ring.animation(forKey: "spin") == nil {
            // Trilho fraco + arco azul, como o .pi-ring.
            ring.strokeColor = Self.blue.cgColor
            ring.strokeStart = 0
            ring.strokeEnd = 0.25
            let track = CAShapeLayer()
            track.path = ring.path
            track.fillColor = nil
            track.lineWidth = ring.lineWidth
            track.strokeColor = NSColor.white.withAlphaComponent(0.15).cgColor
            ring.sublayers?.forEach { $0.removeFromSuperlayer() }
            ring.insertSublayer(track, at: 0)
            let spin = CABasicAnimation(keyPath: "transform.rotation.z")
            spin.fromValue = 0
            spin.toValue = -2 * Double.pi
            spin.duration = 0.9
            spin.repeatCount = .infinity
            ring.add(spin, forKey: "spin")
        } else if let track = ring.sublayers?.first as? CAShapeLayer {
            track.path = ring.path
            track.lineWidth = ring.lineWidth
        }
        if art.contents != nil, art.animation(forKey: "float") == nil {
            // A arte flutua devagar (deriva + zoom suave), como o piFloat.
            let float = CAKeyframeAnimation(keyPath: "transform")
            let w = bounds.width, h = bounds.height
            float.values = [
                CATransform3DScale(CATransform3DIdentity, 1.06, 1.06, 1),
                CATransform3DScale(CATransform3DMakeTranslation(-0.015 * w, 0.01 * h, 0), 1.1, 1.1, 1),
                CATransform3DScale(CATransform3DMakeTranslation(0.015 * w, -0.01 * h, 0), 1.04, 1.04, 1),
            ]
            float.duration = 16
            float.autoreverses = true
            float.repeatCount = .infinity
            float.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            art.add(float, forKey: "float")
        }
    }

    private func applyArtwork() {
        titleLabel.stringValue = artwork.title
        hasLogo = false
        logo.contents = nil
        art.contents = nil
        art.removeAllAnimations()
        needsLayout = true
        fetch(artwork.background ?? artwork.poster) { [weak self] image in
            guard let self = self else { return }
            self.art.contents = image
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 0
            fade.toValue = 0.5
            fade.duration = 1.2
            self.art.opacity = 0.5
            self.art.add(fade, forKey: "fade")
            self.needsLayout = true
        }
        fetch(artwork.logo) { [weak self] image in
            self?.logo.contents = image
            self?.hasLogo = true
            self?.needsLayout = true
        }
    }

    private func fetch(_ url: URL?, _ done: @escaping @MainActor (CGImage) -> Void) {
        guard let url = url, url.scheme == "https" else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data, let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return }
            DispatchQueue.main.async { MainActor.assumeIsolated { done(image) } }
        }.resume()
    }
}
