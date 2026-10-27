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

// Português do Brasil ou de Portugal? Os addons erram muito o rótulo (pob/por), então decide
// pelo texto: "estou a fazer", "telemóvel", grafia antiga (facto, acção) x "estou fazendo", "você", "ônibus".
// Fronteira de palavra que entende acento (o \b do JS só conhece a-z).
function words(list) {
  return new RegExp('(?:^|[^a-zA-Z\u00C0-\u00FF])(?:' + list.join('|') + ')(?![a-zA-Z\u00C0-\u00FF])', 'gi');
}
const PT_PT = words([
  '(?:estou|estás|está|estamos|estão|estava|estavas|estive|andas|anda|continua|vou|vais|começa|começou) a [a-zà-ÿ]+(?:ar|er|ir)',
  'telemóvel', 'autocarro', 'comboio', 'raparigas?', 'miúd[oa]s?', 'fixe', 'bué', 'casa de banho', 'pequeno-almoço', 'ecrã',
  'equipa', 'facto', 'acç(?:ão|ões)', 'óptim[oa]', 'actual(?:mente)?', 'direcção', 'projecto', 'exact(?:o|a|amente)', 'contacto',
  'frigorífico', 'malta', 'gaj[oa]', 'pá', 'chávena', 't(?:ens|enho|emos|em) de', 'há-de', 'percebes(?:te)?', 'connosco',
]);
const PT_BR = words([
  '(?:estou|está|estamos|estão|estava|estive|fico|ficou) [a-zà-ÿ]+(?:ando|endo|indo)',
  'vocês?', 'ônibus', 'trem', 'banheiro', 'garot[oa]s?', 'celular', 'legal', 'cara', 'tela', 'café da manhã', 'geladeira',
  'a gente', 'pra', 'pro', 'tá', 'tô', 'né', 'cadê', 'moleque', 'grana', 'tchau', 'ótim[oa]', 'atual(?:mente)?', 'direção',
  'projeto', 'exat(?:o|a|amente)', 'contato', 'fato',
]);

export function ptVariant(cues) {
  if (!cues || !cues.length) return '';
  let text = '';
  for (let i = 0; i < cues.length && text.length < 60000; i += cues.length > 600 ? 2 : 1) text += ' ' + cues[i].text;
  text = text.replace(/<[^>]+>/g, '');
  const pt = (text.match(PT_PT) || []).length;
  const br = (text.match(PT_BR) || []).length;
  if (pt >= 4 && pt > br * 1.5) return 'pt';
  if (br >= 4 && br > pt * 1.5) return 'br';
  return '';
}

// Legenda feita para outra velocidade (25 x 23,976 fps, PAL x cinema) vai escorregando até
// terminar depois (ou bem antes) do vídeo. Se a conferência recusa e uma das proporções conhecidas
// encaixa, devolve as falas reescaladas; senão, null.
const FPS_RATIOS = [23.976 / 25, 25 / 23.976, 24 / 25, 25 / 24, 23.976 / 24, 24 / 23.976];

export function scaleCues(cues, f) {
  return cues.map((c) => ({ start: c.start * f, end: c.end * f, text: c.text }));
}

export function fixFps(cues, duration) {
  if (!cues || cues.length < 20 || !isFinite(duration) || duration <= 0) return null;
  if (plausible(cues, duration).ok) return null;
  const last = cues[cues.length - 1].end;
  // Na ordem das conversões mais comuns; a primeira em que a última fala cai antes do fim
  // do vídeo (com folga para os créditos) vence.
  let best = null;
  FPS_RATIOS.forEach((f) => {
    const end = last * f;
    if (!best && end <= duration + 5 && end >= duration * 0.7) best = { f: f };
  });
  if (!best) return null;
  const scaled = scaleCues(cues, best.f);
  return plausible(scaled, duration).ok ? { cues: scaled, factor: best.f } : null;
}
