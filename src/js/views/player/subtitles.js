// Player (subtitles): legendas (escolha automática e sincronia), faixas de áudio e menus de legenda.
import { h } from '../../lib/dom.js';
import * as nav from '../../lib/nav.js';
import { KEY } from '../../lib/nav.js';
import * as subs from '../../lib/subs.js';
import * as subpick from '../../lib/subpick.js';
import * as substyle from '../../lib/substyle.js';
import * as store from '../../lib/store.js';
import { log } from '../../lib/log.js';
import { getText } from '../../lib/http.js';
import * as server from '../../api/server.js';
import * as addons from '../../api/addons.js';
import { menu, toast, fmtTime } from '../../ui.js';
import { t } from '../../lib/i18n.js';
import { IS_WEB } from '../../lib/platform.js';

const AUTO_SUB_PARALLEL = 3; // legendas automáticas baixadas ao mesmo tempo (a decisão segue a ordem)

const LANG_NAMES = {
  por: 'Português (Portugal)', pob: 'Português (BR)', pt: 'Português', 'pt-br': 'Português (BR)', eng: 'Inglês', en: 'Inglês',
  spa: 'Espanhol', es: 'Espanhol', jpn: 'Japonês', ja: 'Japonês', fre: 'Francês', fra: 'Francês', fr: 'Francês',
  ger: 'Alemão', deu: 'Alemão', de: 'Alemão', ita: 'Italiano', it: 'Italiano', kor: 'Coreano', ko: 'Coreano',
  chi: 'Chinês', zho: 'Chinês', rus: 'Russo', ara: 'Árabe', hin: 'Hindi', und: 'Indefinido',
};

function langName(code) {
  if (!code) return t('Desconhecido');
  const name = LANG_NAMES[String(code).toLowerCase()];
  return name ? t(name) : code;
}

// Ajuste de sincronia lembrado por vídeo (e pela legenda em que foi feito): ao continuar depois,
// a mesma legenda já volta no tempo certo.
const SYNC_KEY = 'subSync';

function savedSync(videoId) {
  return (store.get(SYNC_KEY, {}) || {})[videoId] || null;
}

function saveSync(videoId, subId, off) {
  const all = store.get(SYNC_KEY, {}) || {};
  if (!off || !subId) delete all[videoId];
  else all[videoId] = { sub: subId, off: off, at: Date.now() };
  const ids = Object.keys(all);
  if (ids.length > 150) {
    ids.sort((a, b) => all[a].at - all[b].at);
    ids.slice(0, ids.length - 150).forEach((k) => delete all[k]);
  }
  store.set(SYNC_KEY, all);
}

// +1,5 s / −0,3 s / 0,0 s
function fmtOff(v) {
  const r = Math.round(v * 10) / 10;
  return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(1).replace('.', ',') + ' s';
}

function isPt(lang) {
  return /^(pob|por|pt|pt-br|pt-pt|ptbr)$/i.test(lang || '');
}

export function createSubtitles(st) {
  let fileInfo = null;
  let currentAudio = null;
  function loadEmbeddedTracks() {
    if (!server.isAvailable()) return Promise.resolve(null);
    if (!st.tracksPromise) {
      const forUrl = st.mediaUrl;
      st.tracksPromise = server
        .tracks(st.mediaUrl)
        .then((tracks) => {
          if (!st.alive || !tracks || forUrl !== st.mediaUrl) return null;
          st.embedded = tracks;
          log.info('Faixas embutidas', JSON.stringify(tracks));
          return tracks;
        })
        .catch(() => {
          st.tracksPromise = null;
          return null;
        });
    }
    return st.tracksPromise;
  }

  // Pede as legendas já com hash/tamanho/nome do arquivo, para os addons devolverem as casadas.
  // A escolha automática espera todos os addons (ou 6s), para não ficar com a primeira que chegar.
  let subsSettled = false;
  function loadSubtitles() {
    const forVideo = st.video;
    const forUrl = st.mediaUrl;
    st.addonSubs = null;
    subsSettled = false;
    // Torrent pelo PC: o hash lê o fim do arquivo e faria o servidor baixar essa parte antes do
    // começo. Espera o vídeo começar (ou 60s) para não atrasar o play.
    // Debrid: o hash abre mais duas conexões no arquivo, que disputam banda com o começo do vídeo.
    const ready = (st.viaServer || st.api.isDebrid()) && !st.hasPlayed ? untilPlaying(60000) : Promise.resolve();
    ready
      .then(() => subpick.videoInfo(st.stream, st.mediaUrl, server))
      .then((info) => {
        if (!st.alive || forVideo !== st.video || forUrl !== st.mediaUrl) return;
        fileInfo = info;
        const settle = () => {
          if (!st.alive || forVideo !== st.video || subsSettled) return;
          subsSettled = true;
          if (!st.addonSubs) st.addonSubs = [];
          autoPick();
        };
        setTimeout(settle, 6000);
        addons
          .fetchSubtitles(st.meta.type, st.video.id, subpick.extra(info), (list) => {
            if (!st.alive || forVideo !== st.video) return;
            st.addonSubs = (st.addonSubs || []).concat(list);
          })
          .then(settle, settle);
      });
  }

  function untilPlaying(maxMs) {
    return new Promise((ok) => {
      const done = () => {
        st.videoEl.removeEventListener('playing', done);
        clearTimeout(timer);
        ok();
      };
      const timer = setTimeout(done, maxMs);
      st.videoEl.addEventListener('playing', done);
    });
  }
  function autoPick() {
    const prefSubs = (st.settings.subtitleLangs || []).map((x) => x.toLowerCase());
    const prefAudio = (st.settings.audioLangs || []).map((x) => x.toLowerCase());
    if (!st.autoDone.audio && prefAudio.length && st.embedded && st.embedded.audio.length > 1) {
      st.autoDone.audio = true;
      const already = st.embedded.audio[0] && prefAudio.indexOf(String(st.embedded.audio[0].lang).toLowerCase()) >= 0;
      if (!already) {
        const idx = st.embedded.audio.findIndex((tr) => prefAudio.indexOf(String(tr.lang).toLowerCase()) >= 0);
        if (idx > 0) selectEmbeddedAudio(idx);
      }
    }
    if (st.autoDone.sub || !st.settings.subtitlesAuto || !prefSubs.length || !subsSettled) return;
    st.autoDone.sub = true;
    const ranked = subpick.rank(st.addonSubs, prefSubs, fileInfo || {}, st.seriesInfo()).slice(0, 8);
    // A legenda que já foi sincronizada neste vídeo vai na frente.
    const saved = savedSync(st.video.id);
    const savedAt = saved ? ranked.findIndex((x) => (x.id || x.url) === saved.sub) : -1;
    if (savedAt > 0) ranked.unshift(ranked.splice(savedAt, 1)[0]);
    if (ranked.length) whenDuration(() => tryAutoSub(ranked, st.mediaUrl));
  }

  // A duração do vídeo é o que permite conferir a legenda; espera os metadados (até 15s).
  function whenDuration(fn) {
    if (isFinite(st.videoEl.duration) && st.videoEl.duration > 0) return fn();
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      st.videoEl.removeEventListener('loadedmetadata', go);
      if (st.alive) fn();
    };
    st.videoEl.addEventListener('loadedmetadata', go);
    setTimeout(go, 15000);
  }

  // Testa as candidatas e liga a melhor que passa na conferência. Baixa até AUTO_SUB_PARALLEL ao
  // mesmo tempo, mas só decide quando as mais preferidas já responderam: a ordem vale. Legenda de
  // Portugal rotulada como BR fica de reserva enquanto houver outra candidata.
  function tryAutoSub(ranked, forUrl) {
    const live = () => st.alive && forUrl === st.mediaUrl && st.currentSub.kind === 'off'; // usuário já escolheu algo?
    const got = []; // resultado por posição da lista: { s, cues } ou { bad: true }
    let started = 0;
    let head = 0; // próxima posição a decidir
    let ptBackup = null;
    let finished = false;
    function launch() {
      while (live() && !finished && started < ranked.length && started - head < AUTO_SUB_PARALLEL) {
        const i = started++;
        const s = ranked[i];
        loadAddonCues(s)
          .then((cues) => {
            const check = subpick.plausible(cues, st.videoEl.duration);
            if (!check.ok) log.info('Legenda recusada', s.addon, s.lang, check.why);
            got[i] = check.ok ? { s: s, cues: cues } : { bad: true };
          })
          .catch(() => (got[i] = { bad: true }))
          .then(decide);
      }
    }
    function decide() {
      while (live() && !finished && head < ranked.length && got[head]) {
        const r = got[head++];
        if (r.bad) continue;
        if (wantsBr() && subVariant[r.s.id || r.s.url] === 'pt') {
          log.info('Legenda de Portugal; procurando uma do Brasil', r.s.addon, r.s.lang);
          if (!ptBackup) ptBackup = r;
          continue;
        }
        finished = true;
        useAddonCues(r.s, r.cues);
        return;
      }
      if (!live() || finished) return;
      if (head < ranked.length) return launch();
      finished = true;
      if (ptBackup) {
        useAddonCues(ptBackup.s, ptBackup.cues);
        toast(t('Só achei legenda em português de Portugal.'), 4000);
        return;
      }
      // Nenhuma passou: volta ao padrão do app (a primeira no idioma preferido) e avisa que dá para trocar.
      log.warn('Nenhuma legenda passou na conferência; usando a padrão');
      selectAddonSub(ranked[0], true);
      toast(t('Legenda pode não bater com este arquivo. Troque no menu de legendas.'), 5000);
    }
    launch();
  }

  // Baixa a legenda, corrige a velocidade (25 x 23,976 fps) e descobre se é PT do Brasil ou de Portugal.
  const subVariant = {};
  function loadAddonCues(s) {
    return subs.load(s.url, server.subtitlesProxy(s.url)).then((cues) => {
      const fix = subpick.fixFps(cues, st.videoEl.duration);
      if (fix) {
        log.info('Legenda em outra velocidade; reescalada', fix.factor.toFixed(4));
        cues = fix.cues;
      }
      if (isPt(s.lang)) subVariant[s.id || s.url] = subpick.ptVariant(cues);
      return cues;
    });
  }

  function useAddonCues(s, cues) {
    st.currentSub = { kind: 'addon', id: s.id || s.url };
    st.renderer.set(cues);
    applySavedOffset();
  }

  function wantsBr() {
    const p = (st.settings.subtitleLangs || []).map((x) => x.toLowerCase());
    const idx = (l) => (p.indexOf(l) < 0 ? 99 : p.indexOf(l));
    const br = Math.min(idx('pob'), idx('pt-br'));
    return br < 99 && br < idx('por');
  }

  function subLabel(s) {
    const v = subVariant[s.id || s.url];
    if (v === 'pt') return t('Português (Portugal)');
    if (v === 'br') return t('Português (BR)');
    return langName(s.lang);
  }

  function subKey() {
    if (st.currentSub.kind === 'addon') return st.currentSub.id;
    if (st.currentSub.kind === 'embedded') return 'emb' + st.currentSub.index;
    return '';
  }

  function applySavedOffset() {
    const saved = savedSync(st.video.id);
    st.renderer.setOffset(saved && saved.sub === subKey() ? saved.off : 0);
    st.renderer.update(st.videoEl.currentTime);
  }

  // Áudio preferido configurado: lê as faixas uma vez, 20s depois de o vídeo começar.
  function scheduleAudioPick() {
    if (!(st.settings.audioLangs || []).length || !server.isAvailable()) return;
    setTimeout(() => {
      if (st.alive && st.hasPlayed) loadEmbeddedTracks().then(() => autoPick());
    }, 20000);
  }

  // ---------- Faixas ----------
  function selectEmbeddedAudio(index) {
    // HLS pelo hls.js: as faixas são as do manifest (o <video> não as expõe de forma confiável).
    if (st.hlsCtl && st.hlsCtl.audioTracks && st.hlsCtl.audioTracks().length > index) {
      st.hlsCtl.setAudioTrack(index);
      currentAudio = index;
      return;
    }
    const native = st.videoEl.audioTracks;
    if (native && native.length > index) {
      for (let i = 0; i < native.length; i++) native[i].enabled = i === index;
      currentAudio = index;
      return;
    }
    toast(t('Troca de áudio indisponível agora.'));
  }

  // Legenda embutida: se o arquivo já está 100% no PC, o servidor extrai a faixa (WebVTT, blocos
  // de 10s) e o app desenha no estilo Kai, sem os códigos ASS crus ({\an8}) do player da TV.
  // Com o torrent ainda baixando, não extrai: o ffmpeg leria o arquivo e roubaria a prioridade do download.
  function selectEmbeddedSub(index) {
    st.renderer.clear();
    server.streamProgress(st.mediaUrl).then((p) => {
      if (!st.alive) return;
      if (p !== null && p >= 0.999) extractedSub(index);
      else nativeEmbeddedSub(index);
    });
  }

  function extractedSub(index) {
    const cs = { kind: 'embedded', index: index, extracted: true, sid: 'kai' + Math.random().toString(36).slice(2), segs: {}, cues: [], busy: false };
    st.currentSub = cs;
    applySavedOffset();
    ensureSegments();
  }

  function ensureSegments() {
    const cs = st.currentSub;
    if (!cs.extracted || cs.busy || !st.alive) return;
    const n = Math.floor(st.videoEl.currentTime / 10) + 1;
    const k = !cs.segs[n] ? n : !cs.segs[n + 1] ? n + 1 : 0;
    if (!k) return;
    cs.segs[k] = 'loading';
    cs.busy = true; // um bloco por vez
    const url = server.baseUrl() + 'hlsv2/' + cs.sid + '/subtitle' + cs.index + '/segment' + k + '.vtt?mediaURL=' + encodeURIComponent(st.mediaUrl);
    getText(url, { timeout: 30000, quiet: true })
      .then((txt) => {
        if (st.currentSub !== cs) return;
        const seen = {};
        cs.cues.forEach((c) => (seen[c.start + '|' + c.text] = true));
        subs.parse(txt).forEach((c) => {
          if (!seen[c.start + '|' + c.text]) cs.cues.push(c);
        });
        cs.cues.sort((a, b) => a.start - b.start);
        st.renderer.set(cs.cues);
        st.renderer.update(st.videoEl.currentTime);
      })
      .catch(() => delete cs.segs[k])
      .then(() => (cs.busy = false));
  }

  // Sem o arquivo inteiro no PC não dá para extrair a faixa; o player HTML5 da TV não mostra
  // legenda embutida sozinho (falta o player nativo da Samsung, AVPlay).
  function nativeEmbeddedSub() {
    toast(t('Essa legenda embutida só aparece com o arquivo inteiro baixado no PC. Tente uma legenda dos addons.'), 5000);
  }

  function selectAddonSub(s, silent) {
    st.currentSub = { kind: 'addon', id: s.id || s.url };
    loadAddonCues(s)
      .then((cues) => {
        if (!st.alive || st.currentSub.id !== (s.id || s.url)) return;
        useAddonCues(s, cues);
        if (!silent) toast(t('Legenda: {lang}', { lang: subLabel(s) }));
      })
      .catch(() => toast(t('Não foi possível baixar a legenda.')));
  }

  // Menus de faixas: lê as faixas embutidas só agora, quando o usuário pede.
  function withTracks(open) {
    if (st.embedded || !server.isAvailable()) return open();
    toast(t('Lendo as faixas do arquivo...'), 2500);
    loadEmbeddedTracks().then(() => st.alive && open());
  }

  function audioMenu() {
    withTracks(openAudioMenu);
  }

  function openAudioMenu() {
    const native = st.videoEl.audioTracks;
    const hlsList = st.hlsCtl && st.hlsCtl.audioTracks ? st.hlsCtl.audioTracks() : [];
    let list = [];
    if (hlsList.length > 1) {
      const cur = st.hlsCtl.audioTrack();
      list = hlsList.map((tr, i) => ({ label: langName(tr.lang) + (tr.label ? ' · ' + tr.label : ''), value: i, checked: i === cur }));
    } else if (native && native.length) {
      for (let i = 0; i < native.length; i++) {
        list.push({ label: langName(native[i].language) + (native[i].label ? ' · ' + native[i].label : ''), value: i, checked: native[i].enabled });
      }
    } else if (st.embedded && st.embedded.audio.length) {
      list = st.embedded.audio.map((tr, i) => ({
        label: langName(tr.lang) + (tr.label ? ' · ' + tr.label : ''),
        sub: [tr.codec, tr.channels ? t('{n} canais', { n: tr.channels }) : ''].filter(Boolean).join(' · '),
        value: i,
        checked: currentAudio === null ? i === 0 : currentAudio === i,
      }));
    }
    menu(t('Áudio'), list, {
      empty: server.isAvailable() ? t('Só uma faixa de áudio.') : t('Para listar as faixas, conecte o servidor do PC em Ajustes.'),
      onPick: (i) => selectEmbeddedAudio(i),
    });
  }

  // Legenda embutida só extrai com o arquivo inteiro no PC; sem isso o menu já mostra o motivo.
  let subsNeedFile = false;
  function subsMenu() {
    withTracks(() => {
      if (!st.embedded || !st.embedded.subs.length) return openSubsMenu();
      server.streamProgress(st.mediaUrl).then((p) => {
        if (!st.alive) return;
        subsNeedFile = !(p !== null && p >= 0.999);
        openSubsMenu();
      });
    });
  }

  function openSubsMenu() {
    const opts2 = [];
    if (st.renderer.active()) {
      const off = st.renderer.offset();
      opts2.push({ label: t('Sincronizar legenda'), sub: off ? t('Ajuste atual: {n}', { n: fmtOff(off) }) : t('Automático ou manual'), value: { kind: 'sync' } });
    }
    opts2.push({ label: t('Desligada'), value: { kind: 'off' }, checked: st.currentSub.kind === 'off' });
    if (st.embedded && st.embedded.subs.length) {
      st.embedded.subs.forEach((tr, i) =>
        /PGS|VOBSUB|DVD/i.test(tr.codec || '') ? null : opts2.push({
          label: langName(tr.lang) + (tr.label ? ' · ' + tr.label : ''),
          sub: t('Embutida no arquivo') + (tr.codec ? ' · ' + tr.codec : '') + (subsNeedFile ? ' · ' + t('precisa do arquivo inteiro no PC') : ''),
          value: { kind: 'embedded', index: i },
          checked: st.currentSub.kind === 'embedded' && st.currentSub.index === i,
        })
      );
    }
    const pref = (st.settings.subtitleLangs || []).map((x) => x.toLowerCase());
    // Melhores candidatas primeiro (mesma ordem da escolha automática); o resto vem depois.
    const best = subpick.rank(st.addonSubs, pref, fileInfo || {}, st.seriesInfo());
    const sorted = best.concat((st.addonSubs || []).filter((s) => best.indexOf(s) < 0));
    sorted.slice(0, 60).forEach((s) =>
      opts2.push({
        label: subLabel(s),
        sub: s.addon || 'Addon',
        value: { kind: 'addon', sub: s },
        checked: st.currentSub.kind === 'addon' && st.currentSub.id === (s.id || s.url),
      })
    );
    opts2.push({ label: t('Tamanho: {n}%', { n: store.settings().subtitleSize || 100 }), value: { kind: 'size' } });
    menu(t('Legendas'), opts2, {
      empty: st.addonSubs === null ? t('Carregando legendas...') : t('Nenhuma legenda.'),
      onPick: (v) => {
        if (v.kind === 'off' || v.kind === 'embedded' || v.kind === 'addon') st.autoDone.sub = true;
        if (v.kind === 'off') {
          st.renderer.clear();
          st.currentSub = { kind: 'off' };
        } else if (v.kind === 'embedded') selectEmbeddedSub(v.index);
        else if (v.kind === 'addon') selectAddonSub(v.sub);
        else if (v.kind === 'sync') syncMenu();
        else if (v.kind === 'size') sizeMenu();
      },
    });
  }

  // ---------- Sincronia da legenda ----------
  function syncMenu() {
    const off = st.renderer.offset();
    const list = [
      { label: t('Automático'), sub: t('Pause quando alguém começa a falar e escolha a fala'), value: 'auto' },
      { label: t('Manual'), sub: t('Ajuste fino com as setas do controle'), value: 'manual' },
    ];
    if (off) list.push({ label: t('Zerar ajuste'), sub: t('Agora: {n}', { n: fmtOff(off) }), value: 'zero' });
    menu(t('Sincronizar legenda'), list, {
      onPick: (v) => {
        if (v === 'auto') autoSync();
        else if (v === 'manual') manualSync();
        else {
          setSync(0);
          toast(t('Legenda de volta ao tempo original.'));
        }
      },
    });
  }

  function setSync(v) {
    v = Math.round(v * 10) / 10;
    st.renderer.setOffset(v);
    st.renderer.update(st.videoEl.currentTime);
    if (st.meta.id !== 'dev') saveSync(st.video.id, subKey(), v);
  }

  function syncHint(v) {
    const r = Math.round(v * 10) / 10;
    const n = Math.abs(r).toFixed(1).replace('.', ',');
    if (!r) return t('No tempo original do arquivo');
    return r > 0 ? t('A legenda aparece {n} s depois', { n: n }) : t('A legenda aparece {n} s antes', { n: n });
  }

  // Manual: painel no alto da tela (a legenda continua visível embaixo) e as setas mexem ao vivo.
  function manualSync() {
    st.api.hideControls();
    const before = st.renderer.offset();
    let cur = before;
    const val = h('div.ss-val');
    const hint = h('div.ss-hint');
    const knob = h('div.ss-knob');
    // Setas desenhadas: a fonte da TV não tem os símbolos.
    const arrow = (d) => '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>';
    const LR = arrow('M15 5l-7 7 7 7') + arrow('M9 5l7 7-7 7');
    const UD = arrow('M5 15l7-7 7 7') + arrow('M5 9l7 7 7-7');
    const keyHint = (k, label) => h('span.ss-key', null, [h('b', { html: k }), label]);
    const box = h('div.sub-sync', null, [
      h('div.ss-title', { text: t('Sincronizar legenda') }),
      val,
      hint,
      h('div.ss-track', null, [h('div.ss-mid'), knob, h('span.ss-end.l', { text: t('antes') }), h('span.ss-end.r', { text: t('depois') })]),
      h('div.ss-keys', null, [keyHint(LR, '0,5 s'), keyHint(UD, '0,1 s'), keyHint(IS_WEB ? 'Enter' : 'OK', t('salvar')), keyHint(IS_WEB ? 'Esc' : t('Voltar'), t('desfazer'))]),
    ]);
    function draw() {
      val.textContent = fmtOff(cur);
      val.className = 'ss-val' + (cur > 0.05 ? ' later' : cur < -0.05 ? ' sooner' : '');
      hint.textContent = syncHint(cur);
      knob.style.left = 50 + Math.max(-10, Math.min(10, cur)) * 5 + '%';
      st.renderer.setOffset(cur);
      st.renderer.update(st.videoEl.currentTime);
    }
    function close(save) {
      st.syncUi = false;
      nav.popLayer(layer);
      if (box.parentNode) box.parentNode.removeChild(box);
      if (save) {
        setSync(cur);
        toast(t('Legenda ajustada: {n}', { n: fmtOff(cur) }));
      } else {
        st.renderer.setOffset(before);
        st.renderer.update(st.videoEl.currentTime);
      }
    }
    st.el.appendChild(box);
    st.syncUi = true;
    const layer = nav.pushLayer(box, {
      onBack: () => close(false),
      onKey: (ev) => {
        const k = ev.keyCode;
        if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) return false;
        if (k === KEY.LEFT) cur -= 0.5;
        else if (k === KEY.RIGHT) cur += 0.5;
        else if (k === KEY.UP) cur += 0.1;
        else if (k === KEY.DOWN) cur -= 0.1;
        else if (k === KEY.ENTER) {
          close(true);
          return true;
        } else if (k === KEY.PLAYPAUSE || k === KEY.PLAY || k === KEY.PAUSE) {
          if (k === KEY.PAUSE) st.videoEl.pause();
          else if (k === KEY.PLAY) st.videoEl.play();
          else st.api.togglePlay();
          st.api.hideControls();
          return true;
        } else return true;
        cur = Math.max(-60, Math.min(60, Math.round(cur * 10) / 10));
        draw();
        return true;
      },
    });
    draw();
  }

  // Automático: com o vídeo parado no instante em que alguém começa a falar, mostra as falas
  // da legenda por perto e o usuário aponta qual é. Ajuste = agora − início daquela fala.
  function autoSync() {
    const all = st.renderer.cues();
    if (!all.length) return toast(t('Escolha uma legenda primeiro.'));
    st.syncUi = true;
    st.videoEl.pause();
    st.api.hideControls();
    const now = st.videoEl.currentTime;
    const at = now - st.renderer.offset(); // "agora" no relógio da legenda
    const dist = (c) => Math.abs(c.start - at);
    let near = all.filter((c) => c.start >= at - 90 && c.start <= at + 90);
    if (near.length < 6) near = all.slice().sort((a, b) => dist(a) - dist(b)).slice(0, 12);
    if (near.length > 40) near = near.slice().sort((a, b) => dist(a) - dist(b)).slice(0, 40);
    near.sort((a, b) => a.start - b.start);
    let closest = 0;
    near.forEach((c, i) => {
      if (dist(c) < dist(near[closest])) closest = i;
    });
    const rel = (d) => {
      if (Math.abs(d) < 0.3) return t('na legenda: agora');
      const n = Math.abs(d) < 10 ? Math.abs(d).toFixed(1).replace('.', ',') : String(Math.round(Math.abs(d)));
      return d > 0 ? t('na legenda: daqui a {n} s', { n: n }) : t('na legenda: há {n} s', { n: n });
    };
    const list = h('div.modal-list.sync-list', { 'data-scroll-y': '', 'data-pad-y': '120' });
    const items = near.map((c) =>
      h('div.opt.sync-opt', { focusable: true, onSelect: () => pick(c) }, [
        h('span.so-text', { html: c.text.replace(/\n/g, '<br>') }),
        h('small', { text: rel(c.start - at) }),
      ])
    );
    items.forEach((it) => list.appendChild(it));
    const box = h('div.modal-box.sync-box', null, [
      h('h3', { text: t('Qual fala começa agora?') }),
      h('p.modal-text', { text: t('Pausado em {time}. Escolha a fala que começa exatamente neste momento.', { time: fmtTime(now) }) }),
      list,
    ]);
    const modal = h('div.modal.sync-modal', null, box);
    document.getElementById('app').appendChild(modal);
    const layer = nav.pushLayer(modal, { onBack: () => close() });
    nav.focus(items[closest]);
    function close() {
      st.syncUi = false;
      nav.popLayer(layer);
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }
    function pick(c) {
      close();
      setSync(now - c.start);
      toast(t('Legenda sincronizada ({n})', { n: fmtOff(st.renderer.offset()) }), 4000);
      st.videoEl.play();
    }
  }

  function sizeMenu() {
    const vals = [70, 85, 100, 115, 130, 150];
    const cur = store.settings().subtitleSize || 100;
    menu(
      t('Tamanho da legenda'),
      vals.map((v) => ({ label: v + '%', value: v, checked: v === cur })),
      {
        onPick: (v) => {
          const next = store.saveSettings({ subtitleSize: v });
          substyle.apply(st.subsEl, next);
        },
      }
    );
  }

  return {
    loadEmbeddedTracks,
    loadSubtitles,
    untilPlaying,
    autoPick,
    whenDuration,
    tryAutoSub,
    loadAddonCues,
    useAddonCues,
    wantsBr,
    subLabel,
    subKey,
    applySavedOffset,
    scheduleAudioPick,
    selectEmbeddedAudio,
    selectEmbeddedSub,
    extractedSub,
    ensureSegments,
    nativeEmbeddedSub,
    selectAddonSub,
    withTracks,
    audioMenu,
    openAudioMenu,
    subsMenu,
    openSubsMenu,
    syncMenu,
    setSync,
    syncHint,
    manualSync,
    autoSync,
    sizeMenu,
  };
}
