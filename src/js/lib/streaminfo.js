// Lê o texto de uma fonte (nome/título do addon, ex.: Torrentio) e tira o que importa:
// resolução, HDR, Dolby Vision, áudio dublado/original, seeders e tamanho. Também escolhe a
// fonte do "Smart Choice".
import * as server from '../api/server.js';
import * as store from './store.js';

const FLAG_RE = /\uD83C[\uDDE6-\uDDFF]\uD83C[\uDDE6-\uDDFF]/g;
const BR = '🇧🇷';
const PT = '🇵🇹';
// Emojis e símbolos que os addons usam como ícones (👤 💾 ⚙️ ...), fora do título limpo.
const ICONS_RE = /[☀-➿️]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF]/g;

function textOf(s) {
  return (s.name || '') + '\n' + (s.title || s.description || '') + '\n' + ((s.behaviorHints && s.behaviorHints.filename) || '');
}

export function resolution(text) {
  if (/2160p|\b4k\b|\buhd\b/i.test(text)) return '4K';
  if (/1080p|\bfhd\b|\b1080\b/i.test(text)) return '1080p';
  if (/720p|\bhd\b/i.test(text)) return '720p';
  if (/480p|\bsd\b|dvdrip|\bcam\b|\bts\b/i.test(text)) return 'SD';
  return '';
}

// Dublado: bandeira do Brasil ou de Portugal (o Torrentio marca assim áudio em português; a de
// Portugal quase sempre é a mesma dublagem) ou as palavras dos lançamentos brasileiros.
function dubbed(text, flags) {
  if (flags.indexOf(BR) >= 0 || flags.indexOf(PT) >= 0) return true;
  return /dublad[oa]|\bdub(?:lagem)?[ ._-]?(?:pt|br)\b|\bpt[ ._-]?br\b|\bnacional\b|portugu[eê]s|\bdual\b[^\n]*\b(?:pt|br|por)\b|\b(?:pt|br|por)\b[^\n]*\bdual\b/i.test(text);
}

export function parse(s) {
  if (s.__info) return s.__info;
  const text = textOf(s);
  const flags = text.match(FLAG_RE) || [];
  const dub = dubbed(text, flags);
  const others = flags.filter((f) => f !== BR && f !== PT);
  const seedM = text.match(/👤\s*(\d+)/) || text.match(/\bseed(?:er)?s?\b[:\s]*(\d+)/i) || text.match(/\bS:\s*(\d+)/);
  const sizeM = text.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB|GiB|MiB)\b/i);
  const name = String(s.name || s.addon || '');
  const titleLine = String(s.title || s.description || '').split('\n')[0];
  const info = {
    res: resolution(text),
    dv: /dolby.?vision|\bdovi\b|\bdv\b/i.test(text),
    hdr: /hdr/i.test(text),
    remux: /remux/i.test(text),
    dub: dub,
    // Original junto: "dual"/"multi", ou outras línguas além do português na lista de bandeiras.
    original: !dub || /\bdual\b|\bmulti\b|dual.?[aá]udio/i.test(text) || others.length > 0,
    seeders: seedM ? parseInt(seedM[1], 10) : null,
    sizeMb: sizeM ? parseFloat(sizeM[1].replace(',', '.')) * (/^g/i.test(sizeM[2]) ? 1024 : 1) : 0,
    // Debrid com o arquivo em cache ([RD+], [AD+]...) abre na hora, sem depender de seeders.
    cached: /\[[A-Z]{2,3}\+\]|\b(?:RD|AD|PM|TB|ED|OC)\+|\binstant\b|⚡/i.test(name),
    // Fonte de debrid ([RD+], [RD download], [AD]...). Sem o "+" ainda não está no debrid: abrir só
    // manda baixar, e o vídeo não toca na hora.
    debrid: /\[(?:RD|AD|PM|DL|DLX|TB|ED|OC)[+\] ⚡]|\b(?:RD|AD|PM|TB|ED|OC)\+|\breal.?debrid\b/i.test(name),
    addon: name.split('\n')[0].replace(/\[[A-Z]{2,3}\+?\]/g, '').trim(),
    file: titleLine.replace(ICONS_RE, '').replace(FLAG_RE, '').replace(/\s{2,}/g, ' ').trim(),
  };
  try {
    Object.defineProperty(s, '__info', { value: info, enumerable: false });
  } catch (e) {
    /* objeto congelado: só não guarda */
  }
  return info;
}

export function sizeText(mb) {
  if (!mb) return '';
  return mb >= 1024 ? (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB' : Math.round(mb) + ' MB';
}

// Intensidade do sinal (1 a 4 barras) pelo número de seeders.
export function signal(seeders) {
  if (seeders === null || seeders === undefined) return 4;
  if (seeders >= 100) return 4;
  if (seeders >= 20) return 3;
  if (seeders >= 5) return 2;
  return 1;
}

export function signalSvg(level) {
  let bars = '';
  for (let i = 0; i < 4; i++) {
    const hgt = 5 + i * 4;
    bars += '<rect x="' + i * 6 + '" y="' + (20 - hgt) + '" width="4" height="' + hgt + '" rx="1.2" class="' + (i < level ? 'on' : 'off') + '"/>';
  }
  return '<svg class="sig" width="22" height="20" viewBox="0 0 22 20">' + bars + '</svg>';
}

// ---------- Fonte da última vez ----------
// Ao parar no meio e continuar depois, o Smart Choice tenta a mesma fonte (mesmo torrent/arquivo).
// A chave não usa a URL (links de debrid trocam a cada pedido): torrent pelo hash + arquivo,
// o resto pelo addon + nome + primeira linha do título.
export function streamKey(s) {
  if (!s) return '';
  if (s.infoHash) return 'h:' + String(s.infoHash).toLowerCase() + ':' + (s.fileIdx === undefined || s.fileIdx === null ? '' : s.fileIdx);
  return 'n:' + (s.addon || '') + '|' + String(s.name || '').replace(/\s+/g, ' ') + '|' + String(s.title || s.description || '').split('\n')[0];
}

const LAST_KEY = 'lastStream';
export function rememberStream(videoId, s) {
  const key = streamKey(s);
  if (!videoId || !key) return;
  const all = store.get(LAST_KEY, {}) || {};
  all[videoId] = { key: key, at: Date.now() };
  // Guarda só os 300 mais recentes.
  const ids = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  ids.slice(300).forEach((id) => delete all[id]);
  store.set(LAST_KEY, all);
}

export function rememberedStream(videoId, list) {
  const last = (store.get(LAST_KEY, {}) || {})[videoId];
  if (!last) return null;
  return (list || []).filter((s) => streamKey(s) === last.key)[0] || null;
}

export function canPlay(s, serverOk) {
  return server.isPlayableType(s) && (!server.needsServer(s) || serverOk);
}

const MIN_SEEDERS = 15;

// "Boa": 1080p ou 4K, com sinal suficiente ou em cache no debrid. Link direto sem informação
// (sites de anime, scrapers) não conta: muitos não tocam na TV.
export function good(info) {
  const res = info.res === '4K' || info.res === '1080p';
  const healthy = info.cached || (info.seeders !== null && info.seeders >= MIN_SEEDERS);
  return res && healthy;
}

// Smart Choice: ordena as fontes e fica com a primeira. A ordem:
//   1) debrid em cache ([RD+]) dublado (português), da melhor qualidade para a pior;
//   2) debrid em cache sem dublagem, da melhor qualidade (4K primeiro) para a pior;
//   3) torrent/direto bom e dublado;  4) torrent/direto bom;  5) o resto que não for debrid;
//   6) debrid ainda baixando (fora do cache).
// Dolby Vision fica por último dentro de cada grupo: as TVs Samsung não têm DV, e o arquivo DV
// sem a camada HDR10 (perfil 5, comum em WEB-DL) nem abre. Retorna { stream, ideal } ou null.
const RES_SCORE = { '4K': 4, '1080p': 3, '720p': 2, SD: 1 };

function group(i) {
  if (i.cached) return i.dub ? 0 : 1;
  if (i.debrid) return 5;
  if (good(i)) return i.dub ? 2 : 3;
  return 4;
}

export function rank(list) {
  return list
    .map((s, idx) => ({ s: s, i: parse(s), idx: idx }))
    .sort((a, b) => {
      const g = group(a.i) - group(b.i);
      if (g) return g;
      if (a.i.dv !== b.i.dv) return a.i.dv ? 1 : -1;
      const r = (RES_SCORE[b.i.res] || 0) - (RES_SCORE[a.i.res] || 0);
      if (r) return r;
      // Mesma resolução: dublado + original primeiro; no torrent, mais seeders.
      const o = (b.i.dub && b.i.original ? 1 : 0) - (a.i.dub && a.i.original ? 1 : 0);
      if (o) return o;
      if (!a.i.cached) {
        const sd = (b.i.seeders || 0) - (a.i.seeders || 0);
        if (sd) return sd;
      }
      return a.idx - b.idx;
    })
    .map((x) => x.s);
}

export function smartPick(list, serverOk) {
  const playable = list.filter((s) => canPlay(s, serverOk));
  if (!playable.length) return null;
  const hit = rank(playable)[0];
  const info = parse(hit);
  return { stream: hit, ideal: info.dub && info.original && good(info) };
}

export function summary(info) {
  return [info.res, info.dv ? 'Dolby Vision' : info.hdr ? 'HDR' : '', info.dub ? (info.original ? 'Original + Dublado' : 'Dublado') : '', info.seeders !== null ? info.seeders + ' seeders' : '']
    .filter(Boolean)
    .join(' · ');
}
