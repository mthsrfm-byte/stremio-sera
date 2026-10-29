// Integração com a TV Samsung (Tizen) ou com o app Android do Fire TV: sair do app, IP e modelo.
import { android } from './platform.js';

export function platformBack() {
  const a = android();
  if (a) return a.exit();
  try {
    if (window.tizen && window.tizen.application) return window.tizen.application.getCurrentApplication().exit();
  } catch (e) {
    /* ignore */
  }
  window.close();
}

// IP da TV, para varrer a rede atrás do servidor do Stremio e montar o QR do controle.
export function getTvIp() {
  const a = android();
  if (a) {
    const ip = a.getIp();
    return ip ? Promise.resolve(ip) : Promise.reject(new Error('Sem IP'));
  }
  return tizenIp();
}

export function deviceInfo() {
  const a = android();
  if (a) return Promise.resolve({ modelName: a.getModel(), firmwareVersion: '' });
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
