import { t } from './i18n.js';

// HLS (.m3u8) no <video>: o player da TV não abre HLS pelo <video> (dá erro 4 na hora). O hls.js
// lê a playlist e entrega os pedaços pelo MediaSource, como o Stremio faz no navegador e no Mac.
// O hls.js (~400 KB) fica fora do app.js e só é baixado na primeira vez que um vídeo HLS abre:
// primeiro do jsDelivr numa versão fixa (não muda, então nunca vem de cache velho) e, se falhar,
// a cópia do próprio app (dist/hls.js).
const SOURCES = ['https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js', 'hls.js'];
let loading = null;
// Por que o hls.js não está disponível (para o aviso de erro); vazio quando carregou.
export let unavailable = '';

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => (window.Hls ? ok(window.Hls) : fail(new Error('hls.js não carregou')));
    s.onerror = () => fail(new Error('hls.js não baixou'));
    document.head.appendChild(s);
  });
}

function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!loading) {
    loading = loadScript(SOURCES[0])
      .catch(() => loadScript(SOURCES[1]))
      .catch((e) => {
        loading = null; // tenta de novo no próximo vídeo
        throw e;
      });
  }
  return loading;
}

export function isHls(url) {
  return /\.m3u8$/i.test(String(url || '').split(/[?#]/)[0]);
}

// Liga a URL ao <video> pelo hls.js. onFatal(texto) quando o vídeo não tem mais como seguir.
// Resolve com { destroy } ou null quando o hls.js não serve aqui (aí vai pelo <video> mesmo).
export function attach(videoEl, url, onFatal) {
  return loadHls().then(
    (Hls) => {
      if (!Hls.isSupported()) {
        unavailable = t('sem suporte a hls.js nesta TV');
        return null;
      }
      unavailable = '';
      const hls = new Hls({
        // Worker de blob esbarra no Content-Security-Policy do app; na thread principal dá conta.
        enableWorker: false,
        // Pouca RAM na TV: segura menos vídeo na memória.
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30,
      });
      let mediaRecovered = false;
      let dead = false;
      hls.on(Hls.Events.ERROR, (ev, data) => {
        if (!data || !data.fatal || dead) return;
        // Erro de decodificação: o hls.js sabe se recuperar uma vez sem recomeçar do zero.
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
          mediaRecovered = true;
          hls.recoverMediaError();
          return;
        }
        dead = true;
        const code = data.response && data.response.code;
        onFatal('hls ' + (data.details || data.type) + (code ? ' (HTTP ' + code + ')' : ''));
      });
      hls.loadSource(url);
      hls.attachMedia(videoEl);
      return {
        destroy() {
          dead = true;
          try {
            hls.destroy();
          } catch (e) {
            /* ignore */
          }
        },
      };
    },
    (e) => {
      unavailable = e.message;
      return null;
    }
  );
}
