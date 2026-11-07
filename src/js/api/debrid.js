// Real-Debrid direto pela API: transforma um torrent (infoHash/magnet) em link HTTP que a TV toca.
// Serve para os addons que só entregam torrent (os adultos, como TPB, e qualquer outro sem debrid
// configurado) quando o servidor do PC não está ligado. A chave vem da própria conta: a URL do
// Torrentio (ou de outro addon) configurado com Real-Debrid traz "realdebrid=CHAVE"; dá para
// colar uma à mão em Ajustes. A API do RD aceita chamadas do navegador (CORS liberado); a chave vai
// como auth_token na URL e o corpo como formulário, para o navegador antigo da TV não precisar de
// pré-verificação (preflight).
import { request } from '../lib/http.js';
import * as store from '../lib/store.js';
import { t } from '../lib/i18n.js';
import { log } from '../lib/log.js';

const API = 'https://api.real-debrid.com/rest/1.0/';
const VIDEO_RE = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|webm|mpg|mpeg)$/i;

let addonsList = () => [];
// addons.js entrega a lista (evita import circular).
export function setAddonSource(fn) {
  addonsList = fn;
}

// Chave do Real-Debrid escondida na URL de algum addon da conta (texto puro ou config em base64).
function keyFromUrl(u) {
  let s = String(u || '');
  try {
    s = decodeURIComponent(s);
  } catch (e) {
    /* fica como veio */
  }
  const m = s.match(/realdebrid[=:"']+\s*"?([A-Za-z0-9]{40,64})/i) || s.match(/\b(?:debridApiKey|rdApiKey|realDebridApiKey|realdebridkey)["':=\s]+"?([A-Za-z0-9]{40,64})/i);
  if (m) return m[1];
  // Config em base64 num pedaço do caminho (Comet, Jackettio, StremThru...).
  const parts = s.split(/[/?&=]/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 40 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(p)) continue;
    try {
      const txt = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
      if (!/real.?debrid|"rd"|debrid/i.test(txt)) continue;
      const k = txt.match(/"(?:debridApiKey|apiKey|api_key|token|key|realdebrid|realDebridKey)"\s*:\s*"([A-Za-z0-9]{40,64})"/i);
      if (k) return k[1];
    } catch (e) {
      /* não era base64 */
    }
  }
  return '';
}

export function apiKey() {
  const manual = String(store.settings().rdKey || '').trim();
  if (manual) return manual;
  const list = addonsList() || [];
  for (let i = 0; i < list.length; i++) {
    const k = keyFromUrl(list[i].transportUrl);
    if (k) return k;
  }
  return '';
}

export function available() {
  return !!apiKey();
}

function call(method, path, form, opts) {
  const key = apiKey();
  if (!key) return Promise.reject(new Error(t('Sem chave do Real-Debrid')));
  const url = API + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'auth_token=' + encodeURIComponent(key);
  const body = form
    ? Object.keys(form)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(form[k]))
        .join('&')
    : null;
  return request(method, url, null, Object.assign({ timeout: 15000, quiet: true, form: body }, opts));
}

// Teste de Ajustes: a chave vale? (o usuário do RD responde)
export function ping() {
  return call('GET', 'user');
}

function hashOf(stream) {
  if (typeof stream.infoHash === 'string') return stream.infoHash.toLowerCase();
  const m = String(stream.url || '').match(/xt=urn:btih:([a-zA-Z0-9]+)/);
  return m ? m[1].toLowerCase() : '';
}

function magnetOf(stream, hash) {
  if (typeof stream.url === 'string' && stream.url.indexOf('magnet:') === 0) return stream.url;
  const tr = (stream.sources || [])
    .filter((s) => /^tracker:/.test(s))
    .slice(0, 8)
    .map((s) => '&tr=' + encodeURIComponent(s.replace(/^tracker:/, '')))
    .join('');
  return 'magnet:?xt=urn:btih:' + hash + tr;
}

// Arquivo do torrent: o fileIdx do addon (ordem do torrent) ou, sem ele, o episódio/maior vídeo.
function chooseFile(files, stream, seriesInfo) {
  const videos = files.filter((f) => VIDEO_RE.test(f.path || ''));
  const pool = videos.length ? videos : files;
  const idx = stream.fileIdx;
  if (idx !== undefined && idx !== null && isFinite(idx)) {
    const byId = files.filter((f) => f.id === Number(idx) + 1)[0];
    if (byId && VIDEO_RE.test(byId.path || '')) return byId;
  }
  const name = String((stream.behaviorHints && stream.behaviorHints.filename) || '').toLowerCase();
  if (name) {
    const hit = pool.filter((f) => String(f.path || '').toLowerCase().indexOf(name) >= 0)[0];
    if (hit) return hit;
  }
  if (seriesInfo && isFinite(seriesInfo.season) && isFinite(seriesInfo.episode)) {
    const s = seriesInfo.season;
    const e = seriesInfo.episode;
    const re = new RegExp('s0?' + s + '[ ._-]?e0?' + e + '(?!\\d)|\\b' + s + 'x0?' + e + '(?!\\d)', 'i');
    const hit = pool.filter((f) => re.test(f.path || ''))[0];
    if (hit) return hit;
  }
  return pool.slice().sort((a, b) => (b.bytes || 0) - (a.bytes || 0))[0];
}

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Torrent já na conta (de uma vez anterior) não é adicionado de novo.
function existing(hash) {
  return call('GET', 'torrents?limit=100')
    .then((list) => (Array.isArray(list) ? list : []).filter((x) => String(x.hash || '').toLowerCase() === hash)[0] || null)
    .catch(() => null);
}

// onStatus(texto): progresso para a tela do player. Resolve com a URL que a TV toca.
export function resolve(stream, seriesInfo, onStatus) {
  const hash = hashOf(stream);
  if (!hash) return Promise.reject(new Error(t('Torrent sem identificação')));
  const say = (x) => onStatus && onStatus(x);
  say(t('Pedindo ao Real-Debrid...'));
  let id = null;
  let chosen = null;
  return existing(hash)
    .then((hit) => hit || call('POST', 'torrents/addMagnet', { magnet: magnetOf(stream, hash) }))
    .then((r) => {
      id = r && r.id;
      if (!id) throw new Error(t('O Real-Debrid não aceitou o torrent'));
      return poll(0);
    });

  function info() {
    return call('GET', 'torrents/info/' + id);
  }

  // Até ~25 s: escolhe o arquivo, espera o "downloaded" (em cache é na hora) e libera o link.
  function poll(n) {
    return info().then((i) => {
      const st = i && i.status;
      if (st === 'waiting_files_selection') {
        chosen = chooseFile(i.files || [], stream, seriesInfo);
        if (!chosen) throw new Error(t('Nenhum vídeo dentro do torrent'));
        return call('POST', 'torrents/selectFiles/' + id, { files: String(chosen.id) }).then(() => wait(800).then(() => poll(n + 1)));
      }
      if (st === 'downloaded') return unrestrict(i);
      if (st === 'magnet_error' || st === 'error' || st === 'virus' || st === 'dead') throw new Error(t('O Real-Debrid não conseguiu baixar este torrent ({s})', { s: st }));
      if (n >= 14) {
        const pct = Math.round(i && i.progress ? i.progress : 0);
        throw new Error(t('Este torrent não está no cache do Real-Debrid. Ele começou a baixar ({p}%); tente de novo daqui a pouco ou escolha outra fonte.', { p: pct }));
      }
      if (st === 'downloading' || st === 'queued' || st === 'magnet_conversion' || st === 'compressing' || st === 'uploading')
        say(t('Real-Debrid: {s} {p}%', { s: st === 'downloading' ? t('baixando') : t('preparando'), p: Math.round((i && i.progress) || 0) }));
      return wait(n < 4 ? 1200 : 2000).then(() => poll(n + 1));
    });
  }

  // O link liberado do arquivo escolhido (a lista "links" segue a ordem dos arquivos selecionados).
  function unrestrict(i) {
    const selected = (i.files || []).filter((f) => f.selected);
    let at = 0;
    if (chosen) at = Math.max(0, selected.map((f) => f.id).indexOf(chosen.id));
    else if (selected.length > 1) {
      const best = chooseFile(selected, stream, seriesInfo);
      at = Math.max(0, selected.indexOf(best));
    }
    const link = (i.links || [])[at] || (i.links || [])[0];
    if (!link) throw new Error(t('O Real-Debrid não devolveu o link'));
    return call('POST', 'unrestrict/link', { link: link }).then((u) => {
      if (!u || !u.download) throw new Error(t('O Real-Debrid não liberou o link'));
      log.info('Real-Debrid: torrent virou link', hash.slice(0, 8));
      return u.download;
    });
  }
}
