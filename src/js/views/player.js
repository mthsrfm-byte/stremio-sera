// Player: <video> nativo da TV (decodificação por hardware), legendas próprias, faixas via Luna.

import { h } from '../lib/dom.js';
import * as subs from '../lib/subs.js';
import * as substyle from '../lib/substyle.js';
import * as store from '../lib/store.js';
import * as si from '../lib/streaminfo.js';
import * as playlog from '../lib/playlog.js';
import * as addons from '../api/addons.js';
import { isFavorite, toggleFavorite } from '../ui.js';
import * as router from '../router.js';
import { t } from '../lib/i18n.js';
import { IS_WEB } from '../lib/platform.js';
import { systemScreenSaver } from '../lib/tv.js';
import { ico } from '../lib/icons.js';
import { createControls } from './player/controls.js';
import { createOverlays } from './player/overlays.js';
import { createSubtitles } from './player/subtitles.js';
import { createEngine } from './player/engine.js';
import { createRecovery } from './player/recovery.js';

const SAVE_MS = 60000; // progresso salvo a cada 1 min (também na pausa, na troca de fonte e ao sair)

export function openPlayer(opts) {
  router.push(PlayerView(opts));
}

function PlayerView(opts) {
  const st = {};
  st.opts = opts;
  st.meta = st.opts.meta;
  st.minutes = si.minutesOf(st.meta, st.opts.isSeries);
  // Anime? E o que já tocou nesta série (mesmo pacote de episódios, mesma dublagem)?
  st.pickOpts = () => si.pickOptions(st.meta, st.opts.isSeries);
  st.video = st.opts.video;
  st.stream = st.opts.stream;
  st.settings = store.settings();

  st.videoEl = h('video', { preload: 'auto' });
  // No navegador, clicar no vídeo pausa e toca (como nos players da web).
  if (IS_WEB) st.videoEl.addEventListener('click', () => st.api.togglePlay());
  st.subsEl = h('div.subs');
  st.titleEl = h('div.p-title');
  st.clockEl = h('div.p-clock');
  st.posEl = h('div.pos');
  st.bufEl = h('div.buf');
  st.knobEl = h('div.knob');
  st.seekLabel = h('div.seek-label');
  st.previewImg = h('div.seek-preview-img');
  st.preview = h('div.seek-preview', null, st.previewImg);
  st.bar = h('div.p-bar', { focusable: true, onSelect: () => st.api.togglePlay() }, [st.bufEl, st.posEl, st.knobEl, st.preview, st.seekLabel]);
  st.curTimeEl = h('span');
  st.durEl = h('span');
  st.playBtn = h('div.btn', { focusable: true, onSelect: () => st.api.togglePlay() });
  const audioBtn = h('div.btn', { focusable: true, html: ico('audio') + t('Áudio'), onSelect: () => st.api.audioMenu() });
  const subsBtn = h('div.btn', { focusable: true, html: ico('subs') + t('Legendas'), onSelect: () => st.api.subsMenu() });
  const srcBtn = h('div.btn', { focusable: true, html: ico('sources') + t('Fontes'), onSelect: () => st.api.sourcesMenu() });
  st.nextBtn = h('div.btn', { focusable: true, html: ico('next') + t('Próximo'), onSelect: () => st.api.playNext() });
  // Favoritar sem sair do vídeo (filmes e séries: biblioteca da conta; adultos: só nesta TV).
  const favItem = { id: st.meta.id, type: st.meta.type, name: st.meta.name, poster: st.meta.poster, posterShape: st.meta.posterShape };
  const favBtn = h('div.btn', { focusable: true, onSelect: () => toggleFavorite(favItem).then(paintFav) });
  function paintFav() {
    const on = isFavorite(favItem);
    favBtn.innerHTML = on ? ico('heartOn', 'fav') + t('Favoritado') : ico('heart') + t('Favoritar');
  }
  paintFav();
  if (st.meta.id === 'dev') favBtn.style.display = 'none';
  // Retomou sozinho (Smart Choice): atalho para começar do zero, visível nos primeiros minutos.
  st.restartBtn = h('div.btn', { focusable: true, html: ico('restart') + t('Do início'), onSelect: () => st.api.restart() });
  st.restartBtn.style.display = st.opts.startTime > 30000 ? '' : 'none';
  const buttons = h('div.p-buttons', { 'data-group': '' }, [st.playBtn, st.restartBtn, audioBtn, subsBtn, srcBtn, favBtn, st.nextBtn]);
  st.spinner = h('div.p-center', null, h('div.spinner'));
  st.msgEl = h('div.p-msg');
  // Pular abertura/recapitulação e "Próximo episódio": pílula escura translúcida com o ícone, o texto
  // e o tempo que falta do trecho enchendo o fundo; no foco ela acende em branco (como nos streamings).
  st.skipFill = h('i.sk-fill');
  st.skipIco = h('span.sk-ico');
  st.skipLabel = h('b');
  st.skipSub = h('small');
  st.skipBtn = h('div.btn.skip-btn', { focusable: true, onSelect: () => st.api.doSkip() }, [st.skipFill, st.skipIco, h('span.sk-text', null, [st.skipLabel, st.skipSub])]);
  st.skipBox = h('div.p-skip', null, st.skipBtn);
  st.overlay = h('div.p-overlay', null, [
    h('div.p-top', null, [st.titleEl, st.clockEl]),
    h('div.p-bottom', null, [st.bar, h('div.p-times', null, [st.curTimeEl, h('div.spacer'), st.durEl]), buttons]),
  ]);
  // Abertura: arte do título, logo e o que está acontecendo, até o vídeo começar a tocar.
  st.introBg = h('div.pi-bg');
  st.introLogo = h('img.pi-logo', { alt: '' });
  st.introTitle = h('div.pi-title', { text: st.meta.name || '' });
  st.introSub = h('div.pi-sub');
  st.introStatus = h('div.pi-main');
  st.introCaption = h('div.pi-caption');
  // Tudo no canto esquerdo: título (destaque) em cima, e o carregamento (secundário) logo abaixo.
  st.intro = h('div.p-intro', null, [
    st.introBg,
    h('div.pi-shade'),
    h('div.pi-info', null, [
      st.introLogo,
      st.introTitle,
      st.introSub,
      h('div.pi-status-row', null, [h('div.pi-ring'), h('div.pi-texts', null, [st.introStatus, st.introCaption])]),
    ]),
  ]);
  st.el = h('div.view.player.intro-on', null, [st.videoEl, st.subsEl, st.overlay, st.skipBox, st.spinner, st.msgEl, st.intro]);

  st.renderer = subs.Renderer(st.subsEl);
  substyle.apply(st.subsEl, st.settings);

  st.alive = true;
  st.controlsOn = false;
  st.hideTimer = null;
  let ticker = null;
  let saveTimer = null;
  let watchTimer = null;
  let statusTimer = null;
  st.mediaUrl = '';
  st.viaServer = false;
  let lastTick = 0;
  st.watchedDelta = 0;
  st.pendingStart = st.opts.startTime || 0;
  st.seekTarget = null;
  st.seekWasPlaying = false; // estava tocando quando o seek começou (só então retoma no fim)
  st.seekCommitTimer = null;
  st.embedded = null; // { audio: [], subs: [] } do servidor
  st.addonSubs = null;
  st.currentSub = { kind: 'off' };
  st.triedTranscode = false;
  st.slowTimer = null;
  st.syncUi = false; // painel de sincronia da legenda aberto: pausar não mostra os controles
  st.tried = st.opts.stream ? [st.opts.stream] : [];

  st.seriesInfo = () => (st.opts.isSeries ? { season: st.video.season, episode: st.video.episode } : null);
  // Para o registro de plays (Ajustes → Sobre e depuração): o que é e de qual fonte.
  st.logTitle = () => (st.meta.name || '') + (st.opts.isSeries ? ' T' + st.video.season + 'E' + st.video.episode : '');
  st.logSource = () => {
    if (!st.stream) return '';
    const info = si.parse(st.stream);
    return [info.addon, si.summary(info), info.cached ? t('em cache') : '', info.file].filter(Boolean).join(' · ');
  };

  // Põe a URL no <video>: HLS (.m3u8) pelo hls.js, o resto direto. O resto continua só src +
  // autoplay, como o player oficial do Stremio para TV.
  st.hlsCtl = null;
  st.sourceUrl = '';
  st.sourceToken = 0;
  st.calTimer = null;

  st.tracksPromise = null;

  // Seleção automática no estilo do Smart Track Selector do Kai (versão leve).
  // Legenda: prefere a dos addons (arquivo pequeno à parte, não mexe no vídeo). Faixas embutidas
  // só são lidas se o usuário pediu um áudio preferido, e só depois de o vídeo estar rodando.
  st.autoDone = { sub: false, audio: false };

  // ---------- Eventos do vídeo ----------
  st.videoEl.addEventListener('loadedmetadata', () => {
    if (st.pendingStart > 0) {
      try {
        st.videoEl.currentTime = st.pendingStart / 1000;
        st.autoResume = true;
      } catch (e) {
        /* ignore */
      }
      st.pendingStart = 0;
    }
    if (st.controlsOn) st.api.updateTimes(); // com o OSD oculto, showControls() pinta tudo ao abrir
    st.api.loadSegments();
  });
  st.videoEl.addEventListener('playing', () => {
    st.api.hideIntro();
    clearTimeout(st.slowTimer);
    st.api.closeSlow();
    st.api.debridResumed();
    systemScreenSaver(false);
    if (!st.hasPlayed) {
      st.api.scheduleAudioPick();
      // Abriu: é esta a fonte que o Smart Choice tenta primeiro ao continuar depois.
      if (st.meta.id !== 'dev') si.rememberStream(st.video.id, st.stream);
      addons.rememberTubeKind(st.stream); // Pornhub/XVideos: a próxima abre direto na variante que tocou
      if (st.opts.isSeries && st.meta.id !== 'dev') si.rememberSeries(st.meta.id, st.stream);
      playlog.add(st.logTitle(), st.logSource(), 'ok', st.failedNotes.join('\n'));
    }
    st.hasPlayed = true;
    st.api.showSpinner(false);
    st.api.message('');
    st.api.updatePlayBtn();
    st.api.scheduleHide();
  });
  st.videoEl.addEventListener('pause', () => {
    if (st.seekTarget !== null) st.seekWasPlaying = false; // pausou durante o seek: não retoma sozinho
    clearTimeout(st.smoothTimer); // pausado não conta como "tocou liso"
    systemScreenSaver(true);
    st.api.updatePlayBtn();
    if (!st.syncUi) st.api.showControls();
    st.api.saveProgress();
  });
  st.videoEl.addEventListener('waiting', () => {
    st.api.showSpinner(true);
    st.api.debridWaiting();
  });
  st.videoEl.addEventListener('canplay', () => st.api.showSpinner(false));
  st.videoEl.addEventListener('timeupdate', () => {
    if (st.restartBtn.style.display !== 'none' && st.videoEl.currentTime * 1000 > (st.opts.startTime || 0) + 300000) st.restartBtn.style.display = 'none';
    const now = Date.now();
    if (!st.videoEl.paused && lastTick) {
      const d = now - lastTick;
      if (d > 0 && d < 3000) st.watchedDelta += d;
    }
    lastTick = now;
    // Legenda e barra são atualizadas pelo ticker (250 ms), não aqui, para não fazer em dobro.
  });
  st.videoEl.addEventListener('ended', () => {
    st.api.saveProgress();
    if (st.opts.isSeries && st.api.nextVideo()) st.api.playNext();
    else router.pop();
  });
  st.videoEl.addEventListener('error', () => {
    const err = st.videoEl.error;
    // Sem src (fonte sendo trocada ou o hls.js soltando o <video>) não é erro do vídeo.
    if (!st.sourceUrl || !st.videoEl.getAttribute('src')) return;
    st.api.playbackError(err && err.code);
  });

  // Fonte que não abre: tenta outra sozinho antes de mostrar o erro (que então lista o que aconteceu
  // com cada tentativa). XVideos/Pornhub: a próxima opção do mesmo addon (direto, pelo serviço, outra
  // qualidade). Filmes e séries: até 2 outras fontes, sem Dolby Vision e na mesma resolução se der.
  st.failedNotes = [];

  // ---------- Pular abertura / recapitulação / encerramento ----------
  st.segments = [];
  st.segmentsLoaded = false;
  st.activeSeg = null;
  ['waiting', 'stalled', 'suspend', 'abort', 'emptied', 'seeking', 'seeked', 'ended', 'loadeddata'].forEach((ev) =>
    st.videoEl.addEventListener(ev, () => st.api.diag(ev))
  );
  st.hasPlayed = false; // só vigia depois que o vídeo começou (o torrent pode demorar a iniciar)
  st.autoResume = false;
  st.videoEl.addEventListener('seeked', () => {
    if (st.autoResume) {
      st.autoResume = false;
      const p = st.videoEl.play();
      if (p && p.catch) p.catch(() => {});
    }
  });
  st.sheetCache = {};
  st.sheetOrder = []; // ordem em que as folhas entraram: a mais antiga sai (máximo 3 na memória da TV)

  // Fontes sem miniaturas do site (filmes, séries, TPB...): o servidor do PC tira o quadro com o
  // ffmpeg (thumb.jpg do stremio-service), pedido só quando a posição para de mudar. Leva 1–3 s,
  // então o quadro anterior fica na tela até o novo chegar. Sem o PC, não tem prévia.
  st.pcTimer = null;
  st.lastSeekAt = 0;
  st.waitStart = 0;
  st.stalls = [];
  st.smoothTimer = null;
  st.downgrades = 0;
  st.videoEl.addEventListener('seeking', () => (st.lastSeekAt = Date.now()));

  // Torrent que ainda está baixando (o progresso anda) ganha mais tempo, até 3 vezes:
  // começar um torrent pelo PC pode passar de 40s, e trocar ali só recomeçaria do zero.
  st.slowExtensions = 0;
  st.api = Object.assign(
    {},
    createControls(st),
    createOverlays(st),
    createSubtitles(st),
    createEngine(st),
    createRecovery(st)
  );

  return {
    el: st.el,
    onKey: st.api.onKey,
    onShow: () => {
      if (!ticker) {
        st.api.setupIntro();
        st.api.start();
        ticker = setInterval(() => {
          if (st.controlsOn) st.api.updateTimes();
          st.renderer.update(st.videoEl.currentTime);
          st.api.checkSkip();
          if (st.currentSub.extracted) st.api.ensureSegments();
        }, 250);
        saveTimer = setInterval(() => {
          if (!st.videoEl.paused) st.api.saveProgress();
        }, SAVE_MS);
        watchTimer = setInterval(st.api.watchdog, 2000);
        st.calTimer = setInterval(st.api.checkCalendar, 20000);
        setTimeout(st.api.checkCalendar, 3000);
        // Build de desenvolvimento: estado do buffer a cada 10s no log remoto.
        if (__KAI_DEVLOG__) statusTimer = setInterval(() => !st.videoEl.paused && st.api.diag('status'), 10000);
      }
      st.api.showControls(st.bar);
    },
    onBack: () => {
      st.api.close();
      return true;
    },
    destroy: () => {
      // Sai por qualquer caminho (router.pop direto, erro, fim): salva o ponto antes de soltar o vídeo.
      st.api.saveProgress();
      st.alive = false;
      systemScreenSaver(true);
      clearInterval(ticker);
      clearInterval(saveTimer);
      clearInterval(watchTimer);
      clearInterval(st.calTimer);
      st.api.closeNotice();
      clearInterval(statusTimer);
      clearTimeout(st.hideTimer);
      clearTimeout(st.seekCommitTimer);
      clearTimeout(st.smoothTimer);
      clearTimeout(st.pcTimer);
      st.sheetOrder.forEach((u) => delete st.sheetCache[u]);
      st.sheetOrder.length = 0;
      clearTimeout(st.slowTimer);
      st.api.closeSlow();
      try {
        st.videoEl.pause();
        st.api.dropSource();
        st.videoEl.removeAttribute('src');
        st.videoEl.load();
      } catch (e) {
        /* ignore */
      }
    },
  };
}
