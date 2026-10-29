// Integração com a TV Samsung (Tizen): sair do app, IP da TV e modelo.
export function platformBack() {
  try {
    if (window.tizen && window.tizen.application) return window.tizen.application.getCurrentApplication().exit();
  } catch (e) {
    /* ignore */
  }
  window.close();
}

// IP da TV, para varrer a rede atrás do servidor do Stremio e montar o QR do controle.
export function getTvIp() {
  return tizenIp();
}

export function deviceInfo() {
  const pi = window.webapis && window.webapis.productinfo;
  if (pi) {
    return Promise.resolve({
      modelName: pi.getRealModel ? pi.getRealModel() : pi.getModel(),
      firmwareVersion: pi.getFirmware(),
    });
  }
  return Promise.resolve({ modelName: 'Samsung', firmwareVersion: '' });
}

// Samsung: the Product API when the app is packaged, otherwise the old WebRTC trick
// (the TV's Chromium 47 still reports the local address in ICE candidates).
function tizenIp() {
  try {
    const net = window.webapis && window.webapis.network;
    const ip = net && net.getIp && net.getIp();
    if (ip) return Promise.resolve(ip);
  } catch (e) {
    /* fall through */
  }
  const RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (!RTC) return Promise.reject(new Error('Sem IP'));
  return new Promise((resolve, reject) => {
    const pc = new RTC({ iceServers: [] });
    const done = (fn, v) => {
      try {
        pc.close();
      } catch (e) {
        /* ignore */
      }
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error('Sem IP')), 3000);
    pc.onicecandidate = (e) => {
      const m = e && e.candidate && /(\d+\.\d+\.\d+\.\d+)/.exec(e.candidate.candidate);
      if (m && !/^(0\.|127\.)/.test(m[1])) {
        clearTimeout(timer);
        done(resolve, m[1]);
      }
    };
    pc.createDataChannel('ip');
    pc.createOffer((o) => pc.setLocalDescription(o, () => {}, () => {}), () => {});
  });
}

// Protetor de tela da própria TV Samsung: desligado enquanto o vídeo toca (senão ele entra no
// meio do filme, porque o app nunca disse que tinha vídeo rodando) e ligado de novo depois.
export function systemScreenSaver(on) {
  try {
    const ac = window.webapis && window.webapis.appcommon;
    if (!ac || !ac.setScreenSaver) return;
    const st = ac.AppCommonScreenSaverState || {};
    ac.setScreenSaver(on ? st.SCREEN_SAVER_ON : st.SCREEN_SAVER_OFF, () => {}, () => {});
  } catch (e) {
    /* fora da TV ou API indisponível */
  }
}
