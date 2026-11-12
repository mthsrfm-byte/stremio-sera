// Player (engine): fonte do vídeo (src/HLS), carregamento, vigia de travamento, reabrir, progresso e próximo episódio.
import { h, clear } from '../../lib/dom.js';
import { log } from '../../lib/log.js';
import * as si from '../../lib/streaminfo.js';
import * as hlsplay from '../../lib/hlsplay.js';
import * as server from '../../api/server.js';
import * as addons from '../../api/addons.js';
import * as stremio from '../../api/stremio.js';
import * as hero from '../../api/hero.js';
import { menu, toast, fmtTime } from '../../ui.js';
import * as router from '../../router.js';
import { sortedVideos, openDetails } from '../details.js';
import { t } from '../../lib/i18n.js';
import { IS_WEB } from '../../lib/platform.js';

function escapeHtml(x) {
  return String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export function createEngine(st) {
  // Logo do título no canto (o nome escrito fica de reserva quando não tem logo, ex.: vídeos adultos).
  function setTitle() {
    clear(st.titleEl);
    const name = h('span.p-name', { text: st.meta.name || '' });
    st.titleEl.appendChild(name);
    const logoUrl = st.meta.logo || (/^tt\d+/.test(st.meta.id) ? hero.logo(st.meta.id) : '');
    if (logoUrl) {
      const img = h('img.p-logo', { alt: '' });
      img.onload = () => {
        img.classList.add('ready');
        name.style.display = 'none';
      };
      img.onerror = () => img.parentNode && img.parentNode.removeChild(img);
      img.src = logoUrl;
      st.titleEl.insertBefore(img, name);
    }
    if (st.opts.isSeries) st.titleEl.appendChild(h('small', { text: 'T' + st.video.season + ' E' + st.video.episode + ' · ' + (st.video.namePt || st.video.name || st.video.title || '') }));
    st.nextBtn.style.display = st.opts.isSeries && nextVideo() ? '' : 'none';
  }

  function nextVideo() {
    const vids = sortedVideos(st.meta);
    const i = vids.findIndex((v) => v.id === st.video.id);
    return i >= 0 && i + 1 < vids.length ? vids[i + 1] : null;
  }

  // ---------- Carregamento ----------
  // Cada start() ganha um número: a resposta de uma fonte já trocada (switchTo/tryAnother) é ignorada.
  let startToken = 0;
  function start() {
    setTitle();
    if (!st.stream) return waitForPick();
    const token = ++startToken;
    const current = () => st.alive && token === startToken;
    st.api.armSlow();
    st.api.showSpinner(true);
    st.api.message('');
    st.embedded = null;
    st.tracksPromise = null;
    st.addonSubs = null;
    st.renderer.clear();
    st.currentSub = { kind: 'off' };
    st.segments = [];
    st.segmentsLoaded = false;
    st.api.hideSkip();
    // HLS: o hls.js começa a baixar já, em paralelo com a resolução do link (só se a URL indicar HLS).
    if (typeof st.stream.url === 'string' && hlsplay.isHls(st.stream.url)) hlsplay.preload();
    server
      .toPlayable(st.stream, st.seriesInfo(), (msg) => current() && st.api.message(msg))
      .then((res) => {
        if (!current()) return;
        st.api.message('');
        st.mediaUrl = res.url;
        st.viaServer = res.viaServer;
        log.info('Tocando', st.mediaUrl);
        // Só src + autoplay, como o player oficial do Stremio para TV: load()/play() extras
        // faziam a TV abrir o stream duas vezes.
        st.hasPlayed = false;
        setSource(st.mediaUrl);
        freeBackgroundMemory();
        st.api.loadSubtitles();
        // Faixas embutidas só quando o usuário abre o menu: o ffprobe do servidor lê o arquivo
        // e, num torrent, rouba prioridade do trecho que está tocando.
      })
      .catch((e) => current() && st.api.fail(e.message));
  }
  function setSource(url) {
    dropSource();
    const token = ++st.sourceToken;
    st.sourceUrl = url;
    st.videoEl.autoplay = true;
    if (!hlsplay.isHls(url)) {
      st.videoEl.src = url;
      return;
    }
    hlsplay
      .attach(st.videoEl, url, (why) => {
        if (st.alive && token === st.sourceToken) st.api.playbackError(null, why);
      })
      .then((ctl) => {
        if (!st.alive || token !== st.sourceToken) return ctl && ctl.destroy();
        if (ctl) st.hlsCtl = ctl;
        else st.videoEl.src = url; // sem hls.js aqui: tenta o <video> mesmo
      });
  }
  function dropSource() {
    st.sourceToken++;
    if (st.hlsCtl) st.hlsCtl.destroy();
    st.hlsCtl = null;
  }

  // Smart Choice: o player abre na hora e a fonte chega depois (os addons ainda estão respondendo).
  function waitForPick() {
    st.api.showSpinner(true);
    (st.opts.pick || Promise.resolve(null)).then((s) => {
      if (!st.alive || st.stream) return;
      if (!s) {
        toast(t('Nenhuma fonte tocável encontrada. Escolha na lista.'), 4000);
        router.pop();
        return;
      }
      st.stream = s;
      st.tried.push(s);
      const info = si.parse(s);
      st.introStatus.textContent = t('Preparando o vídeo');
      st.introCaption.innerHTML = '<b>✦</b>' + t('Smart Choice') + ' · ' + escapeHtml(si.summary(info) || info.addon);
      start();
    });
  }

  // ---------- Diagnóstico e recuperação de travamentos ----------
  function bufferedInfo() {
    try {
      const b = st.videoEl.buffered;
      const out = [];
      for (let i = 0; i < b.length; i++) out.push(b.start(i).toFixed(0) + '-' + b.end(i).toFixed(0));
      return out.join(',');
    } catch (e) {
      return '?';
    }
  }

  function diag(ev) {
    log.info(
      'video',
      ev,
      't=' + st.videoEl.currentTime.toFixed(1),
      'dur=' + (isFinite(st.videoEl.duration) ? st.videoEl.duration.toFixed(0) : '?'),
      'ready=' + st.videoEl.readyState,
      'net=' + st.videoEl.networkState,
      'buf=' + bufferedInfo()
    );
  }

  // O player da TV às vezes para de pedir dados no meio de arquivos longos via HTTP
  // e fica "carregando" para sempre. Se o tempo não anda por 15s sem pausa, reabre o stream no mesmo ponto.
  let lastT = -1;
  let gaveUp = false;

  function stuckMenu(pos) {
    st.api.showSpinner(false);
    menu(
      t('O vídeo parou de carregar'),
      [
        { label: t('Tentar de novo'), sub: t('Reabre o vídeo em {time}', { time: fmtTime(pos) }), value: 'retry', checked: true },
        { label: t('Escolher outra fonte'), value: 'src' },
        { label: t('Voltar'), value: 'back' },
      ],
      {
        center: true,
        onPick: (v) => {
          if (v === 'retry') {
            gaveUp = false;
            recoveries = 0;
            reopenAt(pos);
          } else if (v === 'src') st.api.sourcesMenu();
          else router.pop();
        },
      }
    );
  }

  // Memória: pede para a tela inicial soltar as fileiras enquanto o vídeo toca.
  function freeBackgroundMemory() {
    const home = router.tabView('home');
    if (home && home.freeMemory) home.freeMemory();
  }
  // Segundos de vídeo já carregados à frente da posição.
  function bufferedAhead(pos) {
    try {
      const b = st.videoEl.buffered;
      for (let i = 0; i < b.length; i++) if (b.start(i) <= pos + 0.1 && b.end(i) >= pos) return b.end(i) - pos;
    } catch (e) {
      /* ignore */
    }
    return 0;
  }

  // No navegador a conexão com o PC/debrid oscila mais que na TV: espera mais antes de reabrir.
  const STUCK_MS = IS_WEB ? 25000 : 15000;
  let stuckSince = 0;
  let stuckAhead = 0;
  let nudged = false;
  let recoveries = 0;
  let lastRecoveryAt = 0;
  function watchdog() {
    if (!st.alive || gaveUp || !st.hasPlayed || !st.mediaUrl || st.videoEl.paused || st.seekTarget !== null || st.videoEl.ended) {
      stuckSince = 0;
      return;
    }
    const pos = st.videoEl.currentTime;
    if (Math.abs(pos - lastT) > 0.05) {
      lastT = pos;
      stuckSince = 0;
      nudged = false;
      if (Date.now() - lastRecoveryAt > 120000) recoveries = 0;
      return;
    }
    const ahead = bufferedAhead(pos);
    if (!stuckSince) {
      stuckSince = Date.now();
      stuckAhead = ahead;
      return;
    }
    // Ainda esperando dado e ele está chegando: é só a rede lenta enchendo o buffer. Reabrir aqui
    // jogava fora o que já tinha vindo e recomeçava do zero (o loop "toca uns segundos e trava").
    if (st.videoEl.readyState < 3 && ahead > stuckAhead + 1) {
      stuckSince = Date.now();
      stuckAhead = ahead;
      return;
    }
    const stuckFor = Date.now() - stuckSince;
    // Tem vídeo carregado à frente e mesmo assim parou: buraco no buffer. Um passinho à frente
    // destrava sem reabrir a conexão.
    if (!nudged && ahead > 1 && stuckFor > 4000) {
      nudged = true;
      diag('travado-empurrao');
      try {
        st.videoEl.currentTime = pos + 0.2;
      } catch (e) {
        /* ignore */
      }
      return;
    }
    if (stuckFor > STUCK_MS) {
      stuckSince = 0;
      if (recoveries >= 3) {
        diag('travado-desisti');
        gaveUp = true; // para de vigiar até o usuário escolher (antes reabria o aviso sem parar)
        stuckMenu(pos);
        return;
      }
      recoveries++;
      lastRecoveryAt = Date.now();
      if (st.api.isDebrid() && recoveries >= 2) {
        // Reabrir não resolveu duas vezes: provavelmente banda. Tenta um arquivo mais leve.
        const lighter = st.api.lighterDebrid(si.fileMbps(si.parse(st.stream), st.minutes));
        si.learnDebrid(si.fileMbps(si.parse(st.stream), st.minutes), false);
        if (lighter && st.downgrades < 2) {
          st.downgrades++;
          toast(t('Conexão não aguentou este arquivo. Indo para um mais leve: {what}', { what: si.summary(si.parse(lighter)) || si.parse(lighter).addon }), 5000);
          switchTo(lighter);
          return;
        }
      }
      diag('travado-recuperando#' + recoveries);
      reopenAt(pos);
    }
  }

  function reopenAt(pos) {
    st.api.showSpinner(true);
    toast(t('Reconectando ao vídeo...'));
    st.pendingStart = Math.max(0, pos - 1) * 1000;
    const src = st.sourceUrl || st.mediaUrl;
    try {
      st.videoEl.pause();
      dropSource();
      st.videoEl.removeAttribute('src');
      st.videoEl.load();
    } catch (e) {
      /* ignore */
    }
    // Reabre do zero: o ponto certo é aplicado no loadedmetadata e o play vem depois do seek.
    setTimeout(() => {
      if (!st.alive) return;
      st.hasPlayed = false;
      setSource(src);
    }, 300);
  }

  function transcode() {
    st.triedTranscode = true;
    const base = server.baseUrl();
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const q = ['mediaURL=' + encodeURIComponent(st.mediaUrl)];
    ['h264', 'h265', 'hevc'].forEach((c) => q.push('videoCodecs=' + c));
    ['aac', 'mp3', 'ac3', 'eac3'].forEach((c) => q.push('audioCodecs=' + c));
    q.push('maxAudioChannels=6');
    const url = base + 'hlsv2/' + id + '/master.m3u8?' + q.join('&');
    st.pendingStart = st.videoEl.currentTime * 1000 || st.pendingStart;
    st.api.showSpinner(true);
    st.api.message('');
    log.info('Transcodificando', url);
    setSource(url);
  }

  function switchTo(s) {
    saveProgress();
    clearTimeout(st.smoothTimer);
    st.waitStart = 0;
    st.stalls = [];
    if (st.videoEl.currentTime > 1) st.pendingStart = st.videoEl.currentTime * 1000;
    st.stream = s;
    st.slowExtensions = 0;
    if (st.tried.indexOf(s) < 0) st.tried.push(s);
    st.triedTranscode = false;
    st.autoDone = { sub: false, audio: false };
    start();
  }

  // Próximo episódio: mantém o mesmo "bingeGroup" (mesma qualidade/fonte) quando possível.
  function playNext() {
    const nv = nextVideo();
    if (!nv) return;
    saveProgress();
    const group = st.stream.behaviorHints && st.stream.behaviorHints.bingeGroup;
    st.api.showSpinner(true);
    st.api.message(t('Procurando o próximo episódio...'));
    addons.fetchStreams(st.meta.type, nv.id).then((list) => {
      if (!st.alive) return;
      const match = group ? list.find((s) => s.behaviorHints && s.behaviorHints.bingeGroup === group) : null;
      if (match && (!server.needsServer(match) || server.isAvailable() || server.viaDebrid(match))) {
        st.video = nv;
        st.stream = match;
        st.opts.streams = list;
        st.pendingStart = 0;
        st.triedTranscode = false;
        st.autoDone = { sub: false, audio: false };
        start();
      } else {
        router.pop();
        openDetails(st.meta.type, st.meta.id, { videoId: nv.id, autoStreams: true });
      }
    });
  }

  // ---------- Progresso ----------
  let savedPos = -1;
  function saveProgress() {
    const d = st.videoEl.duration;
    if (!(d > 0) || !isFinite(d) || !st.videoEl.currentTime) return;
    const delta = st.watchedDelta;
    st.watchedDelta = 0;
    if (st.meta.id === 'dev') return; // teste de desenvolvimento: não mexe na biblioteca
    // Nada assistido desde o último save na mesma posição (ex.: pausou e saiu): não repete.
    if (!delta && st.videoEl.currentTime === savedPos) return;
    savedPos = st.videoEl.currentTime;
    stremio.saveProgress(st.meta, st.video.id, st.videoEl.currentTime * 1000, d * 1000, delta);
  }

  function close() {
    saveProgress();
    router.pop();
  }

  return {
    setTitle,
    nextVideo,
    start,
    setSource,
    dropSource,
    waitForPick,
    bufferedInfo,
    diag,
    stuckMenu,
    freeBackgroundMemory,
    bufferedAhead,
    watchdog,
    reopenAt,
    transcode,
    switchTo,
    playNext,
    saveProgress,
    close,
  };
}
