// Lê o texto de uma fonte (nome/título do addon, ex.: Torrentio) e tira o que importa:
// resolução, HDR, Dolby Vision, áudio dublado/original, seeders e tamanho. Também escolhe a
// fonte do "Smart Choice".
import * as server from '../api/server.js';
import * as store from './store.js';
import { IS_FIRETV } from './platform.js';

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
    cached: /\[[A-Z]{2,3}\+\]|\binstant\b|⚡/i.test(name),
    // Fonte de debrid ([RD+], [RD download], [AD]...). Sem o "+" ainda não está no debrid: abrir só
    // manda baixar, e o vídeo não toca na hora.
    debrid: /\[(?:RD|AD|PM|DL|DLX|TB|ED|OC)[+\] ]/.test(name),
    rd: /\[RD[+\] ]/.test(name),
    // Codec de vídeo e áudio e o contêiner, pelo nome do arquivo (o Fire TV toca uns melhor que outros).
    codec: /\bav1\b/i.test(text) ? 'av1' : /[xh][ .]?265|\bhevc\b/i.test(text) ? 'hevc' : /[xh][ .]?264|\bavc\b/i.test(text) ? 'h264' : '',
    tenBit: /10[ .-]?bit/i.test(text),
    audio: /truehd|atmos/i.test(text) ? 'truehd' : /\bdts/i.test(text) ? 'dts' : /\b(?:e-?ac-?3|ddp|dd\+)/i.test(text) ? 'eac3' : /\b(?:ac-?3|dd)[ .]?[1-7][ .]?[01]\b|\bdd\b|\bac-?3\b/i.test(text) ? 'ac3' : /\baac\b/i.test(text) ? 'aac' : '',
    mp4: /\.mp4\b|\bmp4\b/i.test(text),
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

// Smart Choice, em camadas (a primeira que tiver fonte vence):
//   1) debrid em cache ([RD+]) com original + dublado em 1080p/4K;  2) debrid em cache em 1080p/4K;
//   3) qualquer debrid em cache;  4) torrent ideal;  5) torrent bom (1080p/4K e seeders);
//   6) o que não for debrid fora do cache;  7) o resto (debrid ainda baixando).
// Dolby Vision fica por último em tudo: as TVs Samsung não têm DV, e o arquivo DV sem a camada
// HDR10 (perfil 5, comum em WEB-DL) nem abre. Retorna { stream, ideal } ou null.
export function smartPick(list, serverOk) {
  const playable = list.filter((s) => canPlay(s, serverOk));
  if (!playable.length) return null;
  if (IS_FIRETV) return firePick(playable);
  const hiRes = (info) => info.res === '4K' || info.res === '1080p';
  const ideal = (info) => info.dub && info.original && good(info);
  const waiting = (info) => info.debrid && !info.cached;
  const tiers = [
    (i) => i.cached && ideal(i),
    (i) => i.cached && hiRes(i),
    (i) => i.cached,
    (i) => !waiting(i) && ideal(i),
    (i) => !waiting(i) && good(i),
    (i) => !waiting(i),
    () => true,
  ];
  const noDv = playable.filter((s) => !parse(s).dv);
  // Laços simples (sem find/for-of): o mesmo código roda nas TVs antigas.
  const pools = [noDv, playable];
  for (let p = 0; p < pools.length; p++) {
    for (let t = 0; t < tiers.length; t++) {
      const hit = pools[p].filter((s) => tiers[t](parse(s)))[0];
      if (hit) return { stream: hit, ideal: ideal(parse(hit)) };
    }
  }
  return null;
}

// ---------- Smart Choice do Fire TV Stick ----------
// O Fire TV Stick HD sai em 1080p e toca pelo <video> do WebView (Chromium do Android): 4K e
// remux só pesam (mais download, mais chance de travar no Wi-Fi) sem ganho na tela; H.264 com
// áudio AAC é o que abre em qualquer um; HEVC costuma ir, AV1 e DTS/TrueHD não.
// Nota de 0 (não toca) para cima: quanto maior, mais chance de tocar liso e bonito.
function fireScore(info) {
  let n = 100;
  n += { '1080p': 40, '720p': 25, SD: 0, '4K': -60 }[info.res] || 10; // sem resolução: meio-termo
  if (info.remux) n -= 50;
  if (info.dv) n -= 80;
  else if (info.hdr) n -= 15; // HDR em tela SDR fica lavado
  n += { h264: 15, hevc: info.tenBit ? -10 : 0, av1: -60 }[info.codec] || 0;
  n += { aac: 10, ac3: 0, eac3: -5, dts: -45, truehd: -60 }[info.audio] || 0;
  if (info.mp4) n += 5;
  // Arquivo enorme é bitrate alto: trava no Wi-Fi do stick. 1080p bom cabe em uns 2 a 8 GB.
  if (info.sizeMb > 20480) n -= 40;
  else if (info.sizeMb > 10240) n -= 20;
  return n;
}

// Toca liso no stick: até 1080p, sem DV/remux/AV1 e sem áudio que o Chromium não decodifica.
function fits(info) {
  return info.res !== '4K' && !info.dv && !info.remux && info.codec !== 'av1' && info.audio !== 'dts' && info.audio !== 'truehd';
}

// Torrent pelo stremio-service do PC: a TV baixa enquanto toca, então semente e tamanho pesam.
function seedScore(info) {
  if (info.seeders === null) return 0;
  return Math.min(60, Math.round(Math.log(info.seeders + 1) * 12));
}

function best(list, score) {
  let hit = null;
  let top = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const n = score(parse(list[i]));
    if (n > top) {
      top = n;
      hit = list[i];
    }
  }
  return hit;
}

// Camadas (a primeira que tiver fonte vence; dentro dela, a de maior nota):
// Com debrid (a conta tem a chave do Real-Debrid nos addons, então as fontes vêm marcadas):
//   1) RD em cache, dublado e que toca liso;  2) qualquer debrid em cache, dublado e liso;
//   3) RD em cache que toca liso (sem dublagem);  4) debrid em cache liso;  5) debrid em cache.
// Sem debrid (ou nada em cache): o vídeo vem por torrent no PC ou por link direto.
//   6) torrent dublado, liso e bem semeado;  7) torrent liso e bem semeado;  8) link direto dublado e liso;
//   9) link direto liso;  10) torrent liso com pouca semente;  11) o que sobrar (menos debrid baixando).
function firePick(playable) {
  const cached = (i) => i.debrid && i.cached;
  const torrent = (s) => !!s.infoHash && !parse(s).debrid;
  const direct = (s) => !s.infoHash && !parse(s).debrid;
  const seeded = (i) => i.seeders === null || i.seeders >= MIN_SEEDERS;
  const torrentScore = (i) => fireScore(i) + seedScore(i) - (i.sizeMb > 6144 ? 20 : 0);
  const tiers = [
    [(s, i) => cached(i) && i.rd && i.dub && fits(i), fireScore],
    [(s, i) => cached(i) && i.dub && fits(i), fireScore],
    [(s, i) => cached(i) && i.rd && fits(i), fireScore],
    [(s, i) => cached(i) && fits(i), fireScore],
    [(s, i) => cached(i) && !i.dv, fireScore],
    [(s, i) => torrent(s) && i.dub && fits(i) && seeded(i), torrentScore],
    [(s, i) => torrent(s) && fits(i) && seeded(i), torrentScore],
    [(s, i) => direct(s) && i.dub && fits(i) && !!i.res, fireScore],
    [(s, i) => direct(s) && fits(i) && !!i.res, fireScore],
    [(s, i) => torrent(s) && fits(i), torrentScore],
    [(s, i) => !(i.debrid && !i.cached), (i) => fireScore(i) + seedScore(i)],
    [() => true, fireScore],
  ];
  for (let t = 0; t < tiers.length; t++) {
    const pool = playable.filter((s) => tiers[t][0](s, parse(s)));
    if (pool.length) {
      const hit = best(pool, tiers[t][1]);
      const info = parse(hit);
      return { stream: hit, ideal: info.dub && fits(info) && (cached(info) || good(info)) };
    }
  }
  return null;
}

export function summary(info) {
  return [info.res, info.dv ? 'Dolby Vision' : info.hdr ? 'HDR' : '', info.dub ? (info.original ? 'Original + Dublado' : 'Dublado') : '', info.seeders !== null ? info.seeders + ' seeders' : '']
    .filter(Boolean)
    .join(' · ');
}
