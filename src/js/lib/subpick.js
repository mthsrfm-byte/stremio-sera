// Escolha automática da legenda: pede aos addons legendas casadas com o arquivo (hash/tamanho/nome,
// como o Stremio oficial), ranqueia pelo nome do release e só aceita uma legenda depois de
// conferir que ela cabe no vídeo (duração, quantidade de falas). Melhor nenhuma do que a errada.

// O que se sabe do arquivo que vai tocar. O hash OpenSubtitles vem do addon (behaviorHints) ou,
// se faltar, do servidor do PC; com timeout curto para não atrasar as legendas.
export function videoInfo(stream, mediaUrl, server) {
  const bh = (stream && stream.behaviorHints) || {};
  const info = {
    filename: bh.filename || fileFromUrl(mediaUrl) || '',
    videoSize: bh.videoSize || null,
    videoHash: bh.videoHash || null,
  };
  if (info.videoHash || !server || !server.isAvailable() || !mediaUrl) return Promise.resolve(info);
  return server
    .opensubHash(mediaUrl)
    .then((r) => {
      if (r && r.hash) {
        info.videoHash = r.hash;
        if (!info.videoSize && r.size) info.videoSize = r.size;
      }
      return info;
    })
    .catch(() => info);
}

// Parâmetros "extra" do protocolo de addons para o recurso subtitles.
export function extra(info) {
  return { videoHash: info.videoHash, videoSize: info.videoSize, filename: info.filename };
}

function fileFromUrl(u) {
  const m = String(u || '').split('?')[0].match(/\/([^/]+\.(?:mkv|mp4|avi|m4v|webm|ts))$/i);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch (e) {
    return m[1];
  }
}

function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/web[ .-]?dl/g, 'webdl')
    .replace(/blu[ .-]?ray/g, 'bluray')
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length > 1);
}

const SOURCES = ['bluray', 'bdrip', 'brrip', 'remux', 'webdl', 'webrip', 'web', 'hdtv', 'dvdrip', 'hdrip', 'hdcam', 'cam', 'ts', 'telesync'];
const NOISE = ['mkv', 'mp4', 'avi', 'srt', 'vtt', 'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'aac', 'ac3', 'dts', 'ddp', 'dd', 'the', 'and', 'subs', 'sub', 'legendas', 'www', 'com', 'org'];

function subText(s) {
  return [s.title, s.name, s.release, s.label, s.id, s.url].filter(Boolean).join(' ');
}

function episodeOf(text) {
  const m = String(text).match(/s(\d{1,2})[ ._-]?e(\d{1,3})/i) || String(text).match(/\b(\d{1,2})x(\d{2,3})\b/);
  return m ? { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) } : null;
}

// Lista ordenada de candidatas (melhor primeiro), só nos idiomas preferidos.
// ep: { season, episode } quando é série; legenda que cita outro episódio é descartada.
export function rank(list, prefLangs, info, ep) {
  const fileTok = tokens(info.filename);
  const fileSet = {};
  fileTok.forEach((x) => (fileSet[x] = true));
  const fileSource = SOURCES.filter((x) => fileSet[x])[0];
  const group = fileTok.length ? fileTok[fileTok.length - 1] : '';
  const out = [];
  (list || []).forEach((s, order) => {
    const li = prefLangs.indexOf(String(s.lang).toLowerCase());
    if (li < 0 || !s.url) return;
    const text = subText(s);
    if (ep) {
      const se = episodeOf(text);
      if (se && (se.season !== ep.season || se.episode !== ep.episode)) return;
    }
    const st = tokens(text);
    let score = 0;
    const seen = {};
    st.forEach((x) => {
      if (seen[x] || NOISE.indexOf(x) >= 0 || !fileSet[x]) return;
      seen[x] = true;
      score += SOURCES.indexOf(x) >= 0 ? 4 : 1;
    });
    if (group && group.length > 2 && NOISE.indexOf(group) < 0 && seen[group]) score += 6;
    const subSource = SOURCES.filter((x) => st.indexOf(x) >= 0)[0];
    if (fileSource && subSource && subSource !== fileSource) score -= 3;
    if (/\bforced\b|forçad/i.test(text)) score -= 10;
    out.push({ sub: s, lang: li, score: score, order: order });
  });
  // Idioma primeiro; dentro do idioma, nome do release; empate fica na ordem do addon
  // (os addons já põem os acertos por hash no topo).
  out.sort((a, b) => a.lang - b.lang || b.score - a.score || a.order - b.order);
  return out.map((x) => x.sub);
}

// A legenda cabe neste vídeo? duration em segundos (NaN se ainda desconhecida).
// Pega legenda de outro filme/corte, de outra velocidade (25 x 23.976 fps) e legenda só "forçada".
export function plausible(cues, duration) {
  if (!cues || !cues.length) return { ok: false, why: 'vazia' };
  const last = cues[cues.length - 1].end;
  const first = cues[0].start;
  if (!isFinite(duration) || duration <= 0) {
    return cues.length >= 20 ? { ok: true } : { ok: false, why: 'poucas falas' };
  }
  const minutes = duration / 60;
  if (cues.length < Math.max(20, minutes)) return { ok: false, why: 'poucas falas (' + cues.length + ')' };
  if (last > duration + 90) return { ok: false, why: 'termina depois do vídeo (' + Math.round(last) + 's > ' + Math.round(duration) + 's)' };
  if (last < duration * 0.6) return { ok: false, why: 'termina cedo demais (' + Math.round(last) + 's de ' + Math.round(duration) + 's)' };
  if (first > duration * 0.25) return { ok: false, why: 'começa tarde demais' };
  return { ok: true };
}
