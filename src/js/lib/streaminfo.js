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

// Dublado em português, com grau de certeza: 2 = certo, 1 = provável, 0 = não.
// Cuidado com anime: "[PT-BR]" de fansub brasileiro é LEGENDA, e "Dual Audio" de anime costuma ser
// japonês + inglês. Por isso "legendado"/"sub pt-br" derruba a bandeira e o "pt-br" sozinhos, e só
// as palavras de dublagem ("dublado", "dublagem", "áudio português"...) passam por cima disso.
const DUB_STRONG_RE = /dublad[oa]s?|dublagem|\bdub(?:bed)?[ ._-]?(?:pt|br|por|ptbr|pt[ ._-]br)\b|\b(?:pt|br|ptbr|pt[ ._-]br|por)[ ._-]?dub(?:bed)?\b|\bnacional\b|[aá]udio[ ._:-]*(?:em[ ._-]?)?(?:portugu[eê]s|pt|br|por)\b|\bportuguese[ ._-]?(?:audio|dub)|\bdual[ ._-]?(?:pt|br|ptbr|por)\b|\b(?:pt|br|ptbr|por)[ ._-]?dual\b|\btri[ ._-]?[aá]udio\b[^\n]*\b(?:pt|br|por)\b/i;
const SUB_RE = /legendad[oa]s?|\blegendas?\b|\bleg\b|\bsub(?:s|bed|titulado|title[sd]?)?[ ._-]*(?:pt|br|por|ptbr|portugu[eê]s|portuguese)\b|\b(?:pt|br|ptbr|pt[ ._-]br|por|portuguese)[ ._-]?subs?\b|\bvost\b/i;
// Sites brasileiros que o Torrentio lista (⚙️ provedor): quase tudo lá é dual com português.
const BR_PROVIDER_RE = /\b(?:comando|bludv|lapumia|micoleao|ondebaixa|torrentdosfilmes|baixafilmes|thepiratefilmes|vacatorrent|redetorrent|brazuca|apache ?torrent|nerd ?torrent|amigos ?share|starck|wolfmax|filmestorrent)\b/i;
const DUB_WEAK_RE = /\bpt[ ._-]?br\b|\bptbr\b|portugu[eê]s|\bportuguese\b|\bdual\b[^\n]*\b(?:pt|br|por)\b|\b(?:pt|br|por)\b[^\n]*\bdual\b|\bdual[ ._-]?[aá]udio\b[^\n]*\b(?:pt|br|por)\b/i;

export function dubLevel(text, flags) {
  if (DUB_STRONG_RE.test(text)) return 2;
  if (SUB_RE.test(text)) return 0;
  // Fansub de anime ("[Grupo] Nome - 01 [PT-BR]") sem palavra de dublagem: é legenda.
  if (/^\s*\[[^\]]+\][^\n]*\[\s*pt[ ._-]?br\s*\]/im.test(text)) return 0;
  // Bandeiras vindas da lista de legendas ("Multi-Subs" sem áudio múltiplo) não dizem nada do áudio.
  const subFlags = /\bmulti(?:ple)?[ ._-]?sub(?:s|titles?)?\b|\bsubs?\b/i.test(text) && !/\bmulti[ ._-]?audio|\bdual\b|\bdub/i.test(text);
  // Bandeira do Brasil ou de Portugal: o Torrentio marca assim o áudio em português (a de
  // Portugal quase sempre é a mesma dublagem).
  if (!subFlags && (flags.indexOf(BR) >= 0 || flags.indexOf(PT) >= 0)) return 2;
  if (DUB_WEAK_RE.test(text) || BR_PROVIDER_RE.test(text) || /\bdual[ ._-]?áudio\b/i.test(text)) return 1;
  return 0;
}

// Grupo do lançamento: "[SubsPlease] Nome - 01" ou "Nome.S01E01.1080p-GRUPO.mkv". Na mesma série o
// mesmo grupo costuma manter o mesmo áudio de um episódio para o outro.
function releaseGroup(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(ICONS_RE, '').trim();
    const a = l.match(/^\[([^\]]{2,30})\]/);
    if (a && !/^(?:RD|AD|PM|TB|ED|OC|DL|DLX)\+?$/i.test(a[1])) return a[1].toLowerCase();
    const b = l.match(/[-.]([A-Za-z0-9]{2,20})(?:\.(?:mkv|mp4|avi|ts|m4v))?$/);
    if (b && /[A-Za-z]/.test(b[1]) && !/^(?:mkv|mp4|avi|x264|x265|h264|h265|hevc|aac|ac3|web|dl|br|pt|dual|multi|dublado|legendado|nacional)$/i.test(b[1])) return b[1].toLowerCase();
  }
  return '';
}

export function parse(s) {
  if (s.__info) return s.__info;
  const text = textOf(s);
  const flags = text.match(FLAG_RE) || [];
  const level = dubLevel(text, flags);
  const dub = level > 0;
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
    dubLevel: level,
    // Marcada como legendada (e sem dublagem): nunca entra como dublada por afinidade.
    subbed: level === 0 && SUB_RE.test(text),
    group: releaseGroup(String(s.title || s.description || '') + '\n' + ((s.behaviorHints && s.behaviorHints.filename) || '')),
    // Original junto: "dual"/"multi", ou outras línguas além do português na lista de bandeiras.
    original: !dub || /\bdual\b|\bmulti\b|dual.?[aá]udio/i.test(text) || others.length > 0,
    seeders: seedM ? parseInt(seedM[1], 10) : null,
    sizeMb: sizeM ? parseFloat(sizeM[1].replace(',', '.')) * (/^g/i.test(sizeM[2]) ? 1024 : 1) : 0,
    // Debrid com o arquivo em cache ([RD+], [AD+]...) abre na hora, sem depender de seeders.
    cached: /\[[A-Z]{2,3}\+\]|\b(?:RD|AD|PM|TB|ED|OC)\+|\binstant\b|⚡/i.test(name),
    // Fonte de debrid ([RD+], [RD download], [AD]...). Sem o "+" ainda não está no debrid: abrir só
    // manda baixar, e o vídeo não toca na hora.
    debrid: /\[(?:RD|AD|PM|DL|DLX|TB|ED|OC)[+\] ⚡]|\b(?:RD|AD|PM|TB|ED|OC)\+|\breal.?debrid\b/i.test(name),
    rd: /\[RD[+\] ⚡]|\bRD\+|\breal.?debrid\b/i.test(name),
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

// ---------- Fonte preferida da série ----------
// O que tocou no último episódio (inclusive quando você trocou na mão no menu Fontes): se era
// dublado e de qual grupo/addon. No próximo episódio o Smart Choice vai primeiro no mesmo grupo,
// e um arquivo desse grupo sem marcação de idioma conta como dublado (anime costuma vir assim).
const SERIES_KEY = 'seriesStream';
export function rememberSeries(seriesId, s) {
  if (!seriesId || !s) return;
  const i = parse(s);
  const all = store.get(SERIES_KEY, {}) || {};
  all[seriesId] = { dub: i.dub, group: i.group, addon: i.addon, debrid: i.cached, at: Date.now() };
  const ids = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  ids.slice(200).forEach((id) => delete all[id]);
  store.set(SERIES_KEY, all);
}

function seriesPref(seriesId) {
  return (seriesId && (store.get(SERIES_KEY, {}) || {})[seriesId]) || null;
}

// Mesmo grupo de lançamento (e mesmo addon) do episódio anterior.
function sameRelease(i, pref) {
  return !!(pref && pref.group && i.group === pref.group && (!pref.addon || i.addon === pref.addon));
}

// Grau de dublagem levando em conta a série: 0, 1 ou 2.
function dubOf(i, pref) {
  if (i.dubLevel) return i.dubLevel;
  return pref && pref.dub && !i.subbed && sameRelease(i, pref) ? 1 : 0;
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

// ---------- Banda para debrid ----------
// Debrid entrega o arquivo inteiro na taxa dele: um 4K REMUX (60–100 Mbps) trava no Wi-Fi da TV
// mesmo com o link perfeito. O app guarda quanto a TV aguenta (começa em 30 Mbps) e aprende:
// travou com debrid → baixa para abaixo da taxa daquele arquivo; tocou 10 min liso → sobe até ela.
const BUDGET_KEY = 'debridMbps';
const BUDGET_DEFAULT = 30;
const BUDGET_MIN = 8;
const BUDGET_MAX = 150;

export function debridBudget() {
  const v = store.get(BUDGET_KEY, null);
  return typeof v === 'number' && v >= BUDGET_MIN ? v : BUDGET_DEFAULT;
}

// ok=false: travou tocando a mbps; ok=true: tocou liso a mbps. Retorna a banda nova.
export function learnDebrid(mbps, ok) {
  if (!mbps) return debridBudget();
  const cur = debridBudget();
  const next = ok ? Math.min(BUDGET_MAX, Math.max(cur, Math.round(mbps * 1.1))) : Math.max(BUDGET_MIN, Math.min(cur, Math.round(mbps * 0.75)));
  if (next !== cur) store.set(BUDGET_KEY, next);
  return next;
}

// Duração em minutos pelo "runtime" do meta ("1h 52min", "112 min"); sem ele, um padrão.
export function minutesOf(meta, series) {
  const r = String((meta && meta.runtime) || '');
  const hM = r.match(/(\d+)\s*h/i);
  const mM = r.match(/(\d+)\s*m/i);
  const mins = (hM ? parseInt(hM[1], 10) * 60 : 0) + (mM ? parseInt(mM[1], 10) : 0);
  return mins || (series ? 45 : 110);
}

// Taxa média do arquivo (tamanho ÷ duração), em Mbps. 0 quando o tamanho não veio.
export function fileMbps(info, minutes) {
  if (!info.sizeMb || !minutes) return 0;
  return Math.round((info.sizeMb * 8) / (minutes * 60));
}

// Smart Choice: ordena as fontes e fica com a primeira. A ordem:
//   1) debrid em cache ([RD+]) dublado (português), do dublado certo para o provável e, dentro
//      disso, do mesmo lançamento do episódio anterior e da melhor qualidade para a pior;
//   2) debrid em cache sem dublagem, da melhor qualidade (4K primeiro) para a pior;
//   (nos dois, primeiro os arquivos que cabem na banda da TV; os mais pesados vêm depois)
//   3) torrent/direto bom e dublado;  4) torrent/direto bom;  5) o resto que não for debrid;
//   6) debrid ainda baixando (fora do cache).
// Dolby Vision fica por último dentro de cada grupo: as TVs Samsung não têm DV, e o arquivo DV
// sem a camada HDR10 (perfil 5, comum em WEB-DL) nem abre. Retorna { stream, ideal } ou null.
const RES_SCORE = { '4K': 4, '1080p': 3, '720p': 2, SD: 1 };

function group(i, pref) {
  if (i.cached) return dubOf(i, pref) ? 0 : 1;
  if (i.debrid) return 5;
  if (good(i)) return dubOf(i, pref) ? 2 : 3;
  return 4;
}

// minutes: duração do vídeo, para estimar a taxa dos arquivos de debrid (sem ela, não filtra por banda).
// seriesId: série do episódio, para preferir o mesmo lançamento do episódio anterior.
export function rank(list, minutes, seriesId) {
  const budget = debridBudget();
  const pref = seriesPref(seriesId);
  const heavy = (i) => !!minutes && i.cached && fileMbps(i, minutes) > budget;
  return list
    .map((s, idx) => ({ s: s, i: parse(s), idx: idx }))
    .sort((a, b) => {
      const g = group(a.i, pref) - group(b.i, pref);
      if (g) return g;
      if (a.i.dv !== b.i.dv) return a.i.dv ? 1 : -1;
      // Dublagem certa ("dublado", bandeira) antes da provável ("pt-br", site brasileiro).
      const dl = dubOf(b.i, pref) - dubOf(a.i, pref);
      if (dl) return dl;
      const hv = (heavy(a.i) ? 1 : 0) - (heavy(b.i) ? 1 : 0);
      if (hv) return hv;
      // O mesmo lançamento do episódio anterior: já se sabe que toca e com que áudio.
      const sr = (sameRelease(b.i, pref) ? 1 : 0) - (sameRelease(a.i, pref) ? 1 : 0);
      if (sr) return sr;
      // Pesados entre si: o mais leve primeiro (o que tem mais chance de não travar).
      if (heavy(a.i)) return fileMbps(a.i, minutes) - fileMbps(b.i, minutes);
      const r = (RES_SCORE[b.i.res] || 0) - (RES_SCORE[a.i.res] || 0);
      if (r) return r;
      // Mesma resolução: dublado + original primeiro; Real-Debrid antes dos outros; no torrent, mais seeders.
      const o = (b.i.dub && b.i.original ? 1 : 0) - (a.i.dub && a.i.original ? 1 : 0);
      if (o) return o;
      const rd = (b.i.rd ? 1 : 0) - (a.i.rd ? 1 : 0);
      if (rd && a.i.cached) return rd;
      if (!a.i.cached) {
        const sd = (b.i.seeders || 0) - (a.i.seeders || 0);
        if (sd) return sd;
      }
      return a.idx - b.idx;
    })
    .map((x) => x.s);
}

export function smartPick(list, serverOk, minutes, seriesId) {
  const playable = list.filter((s) => canPlay(s, serverOk));
  if (!playable.length) return null;
  if (IS_FIRETV) return firePick(playable, minutes, seriesId);
  const hit = rank(playable, minutes, seriesId)[0];
  const info = parse(hit);
  return { stream: hit, ideal: info.dub && info.original && good(info) };
}

// ---------- Smart Choice do Fire TV Stick ----------
// O Fire TV Stick HD sai em 1080p e toca pelo <video> do WebView (Chromium do Android): 4K e
// remux só pesam (mais download, mais chance de travar no Wi-Fi) sem ganho na tela; H.264 com
// áudio AAC é o que abre em qualquer um; HEVC costuma ir, AV1 e DTS/TrueHD não.
// Nota de 0 (não toca) para cima: quanto maior, mais chance de tocar liso e bonito.
function baseScore(info) {
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
function firePick(playable, minutes, seriesId) {
  const pref = seriesPref(seriesId);
  const dub = (i) => dubOf(i, pref) > 0;
  const cached = (i) => i.debrid && i.cached;
  // Banda que o stick aguenta com debrid (aprendida pelo player, como na TV): arquivo acima dela
  // perde pontos, para um mais leve ganhar quando existir.
  const budget = debridBudget();
  const heavy = (i) => !!minutes && i.cached && fileMbps(i, minutes) > budget;
  // Dublagem certa e o mesmo lançamento do episódio anterior ganham pontos dentro da camada.
  const fireScore = (i) => baseScore(i) - (heavy(i) ? 35 : 0) + dubOf(i, pref) * 15 + (sameRelease(i, pref) ? 30 : 0);
  const torrent = (s) => !!s.infoHash && !parse(s).debrid;
  const direct = (s) => !s.infoHash && !parse(s).debrid;
  const seeded = (i) => i.seeders === null || i.seeders >= MIN_SEEDERS;
  const torrentScore = (i) => fireScore(i) + seedScore(i) - (i.sizeMb > 6144 ? 20 : 0);
  const tiers = [
    [(s, i) => cached(i) && i.rd && dub(i) && fits(i), fireScore],
    [(s, i) => cached(i) && dub(i) && fits(i), fireScore],
    [(s, i) => cached(i) && i.rd && fits(i), fireScore],
    [(s, i) => cached(i) && fits(i), fireScore],
    [(s, i) => cached(i) && !i.dv, fireScore],
    [(s, i) => torrent(s) && dub(i) && fits(i) && seeded(i), torrentScore],
    [(s, i) => torrent(s) && fits(i) && seeded(i), torrentScore],
    [(s, i) => direct(s) && dub(i) && fits(i) && !!i.res, fireScore],
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
