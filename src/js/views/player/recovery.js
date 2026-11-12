// Player (recovery): recuperação: fallback de fonte, fonte lenta, debrid (banda) e menu de fontes.
import { h, clear } from '../../lib/dom.js';
import * as nav from '../../lib/nav.js';
import { log } from '../../lib/log.js';
import { getJSON } from '../../lib/http.js';
import * as si from '../../lib/streaminfo.js';
import * as hlsplay from '../../lib/hlsplay.js';
import * as playlog from '../../lib/playlog.js';
import * as server from '../../api/server.js';
import * as addons from '../../api/addons.js';
import { menu, toast, choiceDialog } from '../../ui.js';
import * as router from '../../router.js';
import { t } from '../../lib/i18n.js';
import { ico } from '../../lib/icons.js';

const SLOW_MS = 40000; // sem começar a tocar depois disso: oferece outro provedor

const SLOW_COUNTDOWN = 5;

const DEBRID_SLOW_MS = 15000;

const DEBRID_SMOOTH_MS = 10 * 60000; // tocou isso sem travar: a TV aguenta essa taxa

const DEBRID_STALLS = 2; // travadas em 3 min que fazem trocar por um arquivo mais leve

export function createRecovery(st) {
  let slowModal = null;

  // Erro do <video> (código 1–4) ou do hls.js (why: o que ele disse). Um aviso por fonte.
  let errorToken = -1;
  function playbackError(code, why) {
    log.warn('Erro de vídeo', code || why, st.mediaUrl);
    if (!st.alive || errorToken === st.sourceToken) return;
    errorToken = st.sourceToken;
    const failed = st.stream;
    errorDetails(code, why).then((details) => {
      if (!st.alive || failed !== st.stream) return;
      const next = autoFallback();
      if (next) {
        st.failedNotes.push(details);
        const what = addons.isTubeStream(next) ? String(next.name || '').split('\n').join(' ') : si.summary(si.parse(next)) || si.parse(next).addon;
        toast(si.parse(failed).dv ? t('Dolby Vision não abre na TV. Tentando: {what}', { what: what }) : t('Tentando: {what}', { what: what }), 4000);
        st.api.switchTo(next);
        return;
      }
      if (st.failedNotes.length) details = st.failedNotes.concat(details).join('\n');
      if (!st.triedTranscode && server.isAvailable()) {
        fail(t('A TV não conseguiu tocar este arquivo diretamente.'), true, details);
      } else fail(t('A TV não conseguiu tocar este arquivo (formato ou codec não suportado).'), false, details);
    });
  }
  let autoTries = 0;
  function autoFallback() {
    const rest = (st.opts.streams || []).filter((x) => st.tried.indexOf(x) < 0);
    if (addons.isTubeStream(st.stream)) return addons.orderTube(rest.filter((x) => x.addon === st.stream.addon))[0] || null;
    if (autoTries >= 2) return null;
    const res = si.parse(st.stream).res;
    const ok = server.isAvailable();
    const cands = rest.filter((x) => !si.parse(x).dv && si.canPlay(x, ok));
    const pick = si.smartPick(cands.filter((x) => si.parse(x).res === res), ok, st.minutes, st.pickOpts()) || si.smartPick(cands, ok, st.minutes, st.pickOpts());
    if (!pick) return null;
    autoTries++;
    return pick.stream;
  }

  // Linha de diagnóstico do aviso de erro: código do player, de onde veio o link e, se o vídeo
  // passou pelo serviço da TV, o que o site respondeu para ele. Uma foto da tela já diz onde quebrou.
  const MEDIA_ERR = { 1: 'cancelado', 2: 'rede', 3: 'decodificação', 4: 'formato/endereço não suportado' };
  function errorDetails(code, why) {
    let host = '';
    let target = '';
    try {
      const px = /^http:\/\/127\.0\.0\.1:\d+\/px\/[^?]*\?u=([^&]+)/.exec(st.mediaUrl);
      target = px ? decodeURIComponent(px[1]) : st.mediaUrl;
      host = (target.match(/^https?:\/\/([^/]+)/) || [])[1] || '';
    } catch (e) {
      /* ignore */
    }
    const parts = [why || t('erro {c}', { c: (code || '?') + (MEDIA_ERR[code] ? ' (' + MEDIA_ERR[code] + ')' : '') })];
    // HLS que caiu no <video> porque o hls.js não carregou: o motivo de verdade é esse.
    if (!why && hlsplay.isHls(st.sourceUrl) && !st.hlsCtl && hlsplay.unavailable) parts[0] += ' · ' + hlsplay.unavailable;
    parts.push((st.stream && st.stream.name ? String(st.stream.name).split('\n').join(' ') + ' · ' : '') + (host || '?') + (target !== st.mediaUrl ? ' ' + t('via TV') : ''));
    if (target === st.mediaUrl) return Promise.resolve(parts.join(' · '));
    return getJSON(st.mediaUrl.replace(/\/px\/.*$/, '/api/pxlog'), { timeout: 3000, quiet: true })
      .then((list) => {
        const last = (Array.isArray(list) ? list : []).slice(-3);
        if (last.length) parts.push(t('site respondeu') + ' ' + last.map((x) => x.status + (x.error ? ' ' + x.error : '') + ' (' + x.file + ')').join(', '));
        return parts.join(' · ');
      })
      .catch(() => parts.concat(t('serviço da TV não respondeu')).join(' · '));
  }

  // Erro: um painel só, com o motivo legível (sem endereço técnico no meio) e as saídas em botões.
  function fail(text, offerTranscode, details) {
    st.api.hideIntro();
    clearTimeout(st.slowTimer);
    closeSlow();
    st.api.showSpinner(false);
    clear(st.msgEl);
    const reason = String(text || '').replace(/[.!\s]+$/, '').replace(/https?:\/\/\S+/g, (u) => (/:11470\b/.test(u) ? t('o servidor do PC') : t('o servidor')));
    playlog.add(st.logTitle(), st.logSource(), 'erro', reason + (details ? '\n' + details : ''));
    const torrent = st.stream && server.needsServer(st.stream);
    const tip = torrent && !server.isAvailable() && server.viaDebrid(st.stream)
      ? t('O Real-Debrid não tem esse arquivo pronto. Tente outra fonte.')
      : torrent
      ? t('Esse torrent pode estar sem seeders ou o PC está lento para começar. Tente outra fonte.')
      : t('Tente outra fonte (de preferência MP4/MKV com H.264 ou HEVC e áudio AAC/AC3).');
    const buttons = [{ label: ico('sources') + t('Escolher outra fonte'), primary: true, onSelect: () => sourcesMenu() }];
    if (offerTranscode) buttons.push({ label: t('Converter no PC'), onSelect: () => st.api.transcode() });
    buttons.push({ label: t('Voltar'), onSelect: () => router.pop() });
    choiceDialog(t('Problema na reprodução'), reason.charAt(0).toUpperCase() + reason.slice(1) + '. ' + tip + (details ? '\n\n' + t('Detalhes') + ': ' + details : ''), buttons);
  }

  // Fontes na ordem do Smart Choice: Real-Debrid/debrid em cache primeiro (os mais rápidos), dentro
  // deles os dublados e os que cabem na banda da TV; depois torrents bem semeados; as que não abrem
  // aqui (torrent sem o PC) vão para o fim. Cada linha: o arquivo e só o que decide a escolha.
  function sourcesMenu() {
    const ok = server.isAvailable();
    const all = st.opts.streams || [];
    const ranked = si.rank(all, st.minutes, st.pickOpts());
    const playable = ranked.filter((s) => si.canPlay(s, ok));
    const blocked = ranked.filter((s) => !si.canPlay(s, ok));
    const tube = all.some((s) => addons.isTubeStream(s));
    const order = tube ? all : playable.concat(blocked);
    const list = order.map((s) => {
      const info = si.parse(s);
      const debrid = info.cached ? '⚡ ' + (info.rd ? 'Real-Debrid' : t('Debrid')) : info.debrid ? t('Debrid (baixando)') : '';
      const parts = [debrid || info.addon, si.summary(info), si.sizeText(info.sizeMb)];
      if (!info.cached && server.needsServer(s)) parts.push(ok ? t('torrent pelo PC') : server.viaDebrid(s) ? t('torrent pelo Real-Debrid') : t('precisa do PC'));
      const name = tube ? String(s.name || '').replace(/\n/g, ' · ') : info.file || ((s.title || s.description || '') + '').split('\n')[0] || info.addon;
      return {
        label: name,
        sub: (tube ? String(s.title || '') : parts.filter(Boolean).join(' · ')).replace(/\n/g, ' · '),
        value: all.indexOf(s),
        checked: s === st.stream,
      };
    });
    menu(t('Fontes'), list, {
      onPick: (i) => {
        const s = all[i];
        if (!s || s === st.stream) return;
        if (server.needsServer(s) && !server.isAvailable() && !server.viaDebrid(s)) return toast(t('Essa fonte precisa do servidor do PC.'));
        st.api.switchTo(s);
      },
    });
  }

  // Troca de fonte no mesmo ponto do vídeo.
  // ---------- Debrid: banda e arquivo mais leve ----------
  // Só para fontes de debrid (o torrent tem a própria lógica pelo PC). Uma travada é o vídeo parar
  // para carregar no meio (não depois de pular). Duas em 3 min: a TV não aguenta a taxa do arquivo;
  // o app aprende a banda e troca sozinho por outro debrid mais leve, no mesmo ponto.
  function isDebrid() {
    const i = st.stream ? si.parse(st.stream) : null;
    return !!(i && (i.debrid || i.cached));
  }
  function debridWaiting() {
    if (!st.hasPlayed || !isDebrid() || st.seekTarget !== null || Date.now() - st.lastSeekAt < 4000) return;
    st.waitStart = Date.now();
    clearTimeout(st.smoothTimer);
  }
  function debridResumed() {
    if (!isDebrid()) return;
    if (st.waitStart) {
      const waited = Date.now() - st.waitStart;
      st.waitStart = 0;
      if (waited > 1500) debridStall(waited);
    }
    clearTimeout(st.smoothTimer);
    const forStream = st.stream;
    st.smoothTimer = setTimeout(() => {
      if (!st.alive || st.stream !== forStream || st.stalls.length) return;
      const mbps = si.fileMbps(si.parse(st.stream), st.minutes);
      const b = si.learnDebrid(mbps, true);
      log.info('Debrid liso', mbps + ' Mbps', 'banda ' + b);
    }, DEBRID_SMOOTH_MS);
  }
  function debridStall(waited) {
    const now = Date.now();
    st.stalls = st.stalls.filter((x) => now - x < 180000).concat(now);
    st.api.diag('debrid-travou ' + waited + 'ms #' + st.stalls.length);
    if (st.stalls.length < DEBRID_STALLS) return;
    st.stalls = [];
    const mbps = si.fileMbps(si.parse(st.stream), st.minutes);
    const budget = si.learnDebrid(mbps, false);
    log.warn('Debrid travando', mbps + ' Mbps', 'banda agora ' + budget);
    if (st.downgrades >= 2) return;
    const lighter = lighterDebrid(mbps);
    if (!lighter) return;
    st.downgrades++;
    const info = si.parse(lighter);
    toast(t('Conexão não aguentou este arquivo. Indo para um mais leve: {what}', { what: si.summary(info) || info.addon }), 5000);
    st.api.switchTo(lighter);
  }
  // Outro debrid em cache, mais leve que o atual e dentro da banda; mesmo áudio dublado se der.
  function lighterDebrid(mbps) {
    const cur = si.parse(st.stream);
    const budget = si.debridBudget();
    const cands = (st.opts.streams || []).filter((x) => {
      if (st.tried.indexOf(x) >= 0) return false;
      const i = si.parse(x);
      const m = si.fileMbps(i, st.minutes);
      return i.cached && !i.dv && si.canPlay(x, server.isAvailable()) && (!mbps || (m && m < mbps)) && (!m || m <= budget);
    });
    const dub = cands.filter((x) => si.parse(x).dub === cur.dub);
    const pick = si.smartPick(dub.length ? dub : cands, server.isAvailable(), st.minutes, st.pickOpts());
    return pick ? pick.stream : null;
  }

  // ---------- Demorando para carregar: oferece outro provedor ----------
  function armSlow() {
    clearTimeout(st.slowTimer);
    closeSlow();
    // Debrid em cache abre em segundos: se não abriu em 15s, o problema é o arquivo/link.
    st.slowTimer = setTimeout(() => {
      if (st.alive && !st.hasPlayed) checkSlow();
    }, isDebrid() ? DEBRID_SLOW_MS : SLOW_MS);
  }
  function checkSlow() {
    if (!st.viaServer || st.slowExtensions >= 3) return slowPrompt();
    server.streamProgress(st.mediaUrl).then((p1) => {
      setTimeout(() => {
        server.streamProgress(st.mediaUrl).then((p2) => {
          if (!st.alive || st.hasPlayed) return;
          if (p1 !== null && p2 !== null && p2 > p1) {
            st.slowExtensions++;
            st.api.message(t('Ainda baixando pelo PC ({pct}% do arquivo)...', { pct: Math.round(p2 * 100) }));
            clearTimeout(st.slowTimer);
            st.slowTimer = setTimeout(() => st.alive && !st.hasPlayed && checkSlow(), 20000);
          } else slowPrompt();
        });
      }, 4000);
    });
  }

  function closeSlow() {
    if (!slowModal) return;
    clearInterval(slowModal.timer);
    nav.popLayer(slowModal.layer);
    if (slowModal.el.parentNode) slowModal.el.parentNode.removeChild(slowModal.el);
    slowModal = null;
  }

  function slowPrompt() {
    closeSlow();
    let left = SLOW_COUNTDOWN;
    const goBtn = h('div.btn.primary', { focusable: true, onSelect: () => (closeSlow(), tryAnother()) });
    const waitBtn = h('div.btn', { focusable: true, text: t('Esperar mais'), onSelect: () => armSlow() });
    const label = () => (goBtn.textContent = t('Tentar outro ({n}s)', { n: left }));
    label();
    const box = h('div.modal-box.center.slow-box', null, [
      h('h3', { text: t('Está demorando… tentar outro provedor?') }),
      h('p.modal-text', { text: t('Se você não escolher nada, tento outra fonte sozinho.') }),
      h('div.modal-actions', { 'data-group': '' }, [goBtn, waitBtn]),
    ]);
    const modal = h('div.modal', null, box);
    st.el.appendChild(modal);
    const layer = nav.pushLayer(modal, { onBack: () => armSlow() });
    nav.focus(goBtn);
    const timer = setInterval(() => {
      left--;
      if (left > 0) return label();
      closeSlow();
      tryAnother();
    }, 1000);
    slowModal = { el: modal, layer: layer, timer: timer };
  }

  // Antes de trocar, confere a conexão: se a internet (ou o servidor do PC, no torrent) caiu,
  // trocar de fonte não adianta.
  function connectionOk() {
    const net = getJSON(addons.CINEMETA, { timeout: 7000 }).then(
      () => true,
      () => false
    );
    const srv = server.needsServer(st.stream) && !server.viaDebrid(st.stream) ? server.check().then((r) => !!(r && r.ok), () => false) : Promise.resolve(true);
    return Promise.all([net, srv]).then((r) => ({ internet: r[0], server: r[1] }));
  }

  function tryAnother() {
    st.api.showSpinner(true);
    st.api.message(t('Testando a conexão...'));
    connectionOk().then((c) => {
      if (!st.alive || st.hasPlayed) return;
      if (!c.internet || !c.server) {
        st.api.message('');
        st.api.showSpinner(false);
        menu(
          !c.internet ? t('A internet da TV parece fora do ar') : t('O servidor do PC não está respondendo'),
          [
            { label: t('Esperar e tentar de novo'), sub: t('Reabre a mesma fonte'), value: 'retry', checked: true },
            { label: t('Escolher outra fonte'), value: 'src' },
            { label: t('Voltar'), value: 'back' },
          ],
          {
            center: true,
            onPick: (v) => {
              if (v === 'retry') st.api.switchTo(st.stream);
              else if (v === 'src') sourcesMenu();
              else router.pop();
            },
          }
        );
        return;
      }
      // Próxima fonte: a melhor (Smart Choice) entre as que ainda não foram tentadas. Na ordem do
      // Smart Choice, todas as de debrid em cache vêm antes de qualquer torrent.
      const rest = (st.opts.streams || []).filter((x) => st.tried.indexOf(x) < 0);
      const pick = si.smartPick(rest, server.isAvailable(), st.minutes, st.pickOpts());
      if (!pick) {
        st.api.message('');
        fail(t('Nenhuma outra fonte disponível para tentar.'));
        return;
      }
      const info = si.parse(pick.stream);
      toast(t('Tentando: {what}', { what: si.summary(info) || info.addon }), 3500);
      st.api.switchTo(pick.stream);
    });
  }

  return {
    playbackError,
    autoFallback,
    errorDetails,
    fail,
    sourcesMenu,
    isDebrid,
    debridWaiting,
    debridResumed,
    debridStall,
    lighterDebrid,
    armSlow,
    checkSlow,
    closeSlow,
    slowPrompt,
    connectionOk,
    tryAnother,
  };
}
