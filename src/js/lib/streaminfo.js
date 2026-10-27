// Lê o texto de uma fonte (nome/título do addon, ex.: Torrentio) e tira o que importa:
// resolução, HDR, Dolby Vision, áudio dublado/original, seeders e tamanho. Também escolhe a
// fonte do "Smart Choice".
import * as server from '../api/server.js';

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

// Smart Choice: primeira fonte da lista com áudio original + dublado e boa; se nenhuma, a primeira
// que dá para tocar. Dolby Vision fica por último: as TVs Samsung não têm DV, e o arquivo DV sem a
// camada HDR10 (perfil 5, comum em WEB-DL) nem abre. Retorna { stream, ideal } ou null.
export function smartPick(list, serverOk) {
  const playable = list.filter((s) => canPlay(s, serverOk));
  if (!playable.length) return null;
  const ideal = (s) => {
    const info = parse(s);
    return info.dub && info.original && good(info);
  };
  const noDv = playable.filter((s) => !parse(s).dv);
  for (let i = 0; i < noDv.length; i++) if (ideal(noDv[i])) return { stream: noDv[i], ideal: true };
  if (noDv.length) return { stream: noDv[0], ideal: false };
  for (let i = 0; i < playable.length; i++) if (ideal(playable[i])) return { stream: playable[i], ideal: true };
  return { stream: playable[0], ideal: false };
}

export function summary(info) {
  return [info.res, info.dv ? 'Dolby Vision' : info.hdr ? 'HDR' : '', info.dub ? (info.original ? 'Original + Dublado' : 'Dublado') : '', info.seeders !== null ? info.seeders + ' seeders' : '']
    .filter(Boolean)
    .join(' · ');
}
