// Mock do serviço de addons da TV (127.0.0.1:8092), só para desenvolvimento no PC.
// Imita as rotas e manifestos do remote/tv-service.js com dados FALSOS ("Vídeo de teste N").
// Uso: node tools/mock-tubes.mjs     (MOCK_PORT=8092, MOCK_DELAY=300 para atraso em ms)
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT) || 8092;
const DELAY = Number(process.env.MOCK_DELAY) || 0;
const VERSION = 16; // mesma versão do serviço
const STREAM_URL = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4';

// Mesmos ids, nomes e extras do serviço (o app depende deles). Opções de genre são rótulos neutros.
const GENRES = ['Categoria A', 'Categoria B', 'Categoria C', 'Categoria D'];
const SORT_XV = { name: 'sort', options: ['new', 'top-week', 'top-month', 'rating'] };
const SORT_PH = { name: 'sort', options: ['new', 'hot', 'top-week', 'top-month'] };
const SKIP = { name: 'skip' };
const GENRE = { name: 'genre', isRequired: true, options: GENRES };
const SEARCH = { name: 'search', isRequired: true };

const TUBES = {
  xv: {
    name: 'XVideos', id: 'seraflix.xvideos', pageSize: 20, prefix: 'xv:',
    catalogs: [
      { id: 'xv-cp', extra: [SKIP, SORT_XV] },
      { id: 'xv-cpgay', extra: [SKIP, SORT_XV] },
      { id: 'xv-cpnew', extra: [SKIP, SORT_XV] },
      { id: 'xv-new', extra: [SKIP] },
      { id: 'xv-top', extra: [SKIP, SORT_XV] },
      { id: 'xv-4k', extra: [SKIP, SORT_XV] },
      { id: 'xv-cat', extra: [GENRE, SKIP, SORT_XV] },
      { id: 'xv-gaycat', extra: [GENRE, SKIP, SORT_XV] },
      { id: 'xv-search', extra: [SEARCH, SKIP, SORT_XV] },
    ],
  },
  ph: {
    name: 'Pornhub', id: 'seraflix.pornhub', pageSize: 24, prefix: 'ph:',
    catalogs: [
      { id: 'ph-cp', extra: [SKIP, SORT_PH] },
      { id: 'ph-cpgay', extra: [SKIP, SORT_PH] },
      { id: 'ph-cpnew', extra: [SKIP, SORT_PH] },
      { id: 'ph-new', extra: [SKIP] },
      { id: 'ph-hot', extra: [SKIP, SORT_PH] },
      { id: 'ph-top', extra: [SKIP, SORT_PH] },
      { id: 'ph-cat', extra: [GENRE, SKIP, SORT_PH] },
      { id: 'ph-gaycat', extra: [GENRE, SKIP, SORT_PH] },
      { id: 'ph-search', extra: [SEARCH, SKIP, SORT_PH] },
    ],
  },
};

function manifestOf(key) {
  const t = TUBES[key];
  return {
    id: t.id,
    version: '1.0.0',
    name: t.name,
    description: 'Dados de teste (mock de desenvolvimento).',
    logo: `http://127.0.0.1:${PORT}/img/${key}-logo.svg`,
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie'],
    idPrefixes: [t.prefix],
    behaviorHints: { adult: true },
    catalogs: t.catalogs.map((c) => ({
      type: 'movie',
      id: c.id,
      name: c.id,
      pageSize: t.pageSize,
      extra: c.extra,
    })),
  };
}

// Tamanho de cada página do "site": 27 a 32 itens (como o site real). Tabela acumulada para o skip.
const MAX_PAGES = 2000;
const SIZE = [];
const CUM = [0];
for (let n = 0; n < MAX_PAGES; n++) {
  SIZE.push(27 + (n % 6));
  CUM.push(CUM[n] + SIZE[n]);
}

// skip → página, igual ao serviço: soma exata das páginas vistas; senão múltiplo do tamanho nominal.
function pageOf(skip, pageSize) {
  const s = Number(skip) || 0;
  if (s <= 0) return 0;
  for (let n = 0; n < MAX_PAGES; n++) {
    if (CUM[n] === s) return n;
    if (CUM[n] > s) break;
  }
  if (s % pageSize === 0) return s / pageSize;
  return Math.round(s / 29.5);
}

// Hash simples e estável (para variar itens por catálogo, categoria, ordenação e busca).
function salt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 997;
  return h;
}

function clock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Itens com id estável: o número global (vid) identifica o vídeo em meta, stream e capa.
function makeItem(key, vid) {
  const t = TUBES[key];
  const q = ['4K', '1080p', '720p', '480p'][vid % 4];
  const dur = 60 + ((vid * 37) % 900);
  const views = ((vid * 53) % 900) + 10;
  return {
    id: `${t.prefix}test/${vid}`,
    type: 'movie',
    name: `Vídeo de teste ${vid}`,
    poster: `http://127.0.0.1:${PORT}/img/${key}-${vid}.svg`,
    posterShape: 'landscape',
    stats: {
      quality: q,
      duration: clock(dur),
      channel: `Canal de teste ${vid % 17}`,
      views: `${views} mil`,
    },
  };
}

function listPage(key, catalog, extra, skip) {
  const t = TUBES[key];
  const cat = t.catalogs.find((c) => c.id === catalog);
  if (!cat) return [];
  // Catálogo com extra obrigatório sem valor: vazio (como o serviço)
  const required = cat.extra.filter((e) => e.isRequired).map((e) => e.name);
  if (required.some((n) => !extra[n])) return [];
  const page = pageOf(skip, t.pageSize);
  const seed = salt([catalog, extra.genre || '', extra.search || '', extra.sort || ''].join('|'));
  const count = SIZE[page] || 0;
  const start = CUM[page] || 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(makeItem(key, seed * 10000 + start + i + 1)); // +1: o vídeo 0 não existe
  }
  return out;
}

function svgFor(label, vid) {
  const hue = (vid * 47) % 360;
  const hue2 = (hue + 120) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},70%,45%)"/><stop offset="1" stop-color="hsl(${hue2},70%,28%)"/>` +
    `</linearGradient></defs><rect width="320" height="180" fill="url(#g)"/>` +
    `<text x="160" y="100" text-anchor="middle" font-family="Arial" font-size="26" fill="#fff">${label}</text></svg>`;
}

// Rotas: /{xv|ph}/manifest.json, /{xv|ph}/catalog|meta|stream/movie/{id}[/extras].json, /img/*.svg, /api/*
const ROUTE = /^\/(xv|ph)\/(manifest\.json|(catalog|meta|stream)\/movie\/([^/]+?)(?:\/([^/]+))?\.json)$/;

function parseExtra(str) {
  const out = {};
  if (!str) return out;
  str.split('&').forEach((kv) => {
    const [k, v = ''] = kv.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  });
  return out;
}

function route(req) {
  const url = req.url.split('?')[0];
  if (url === '/api/version') return { code: 200, body: { version: VERSION } };
  if (url === '/api/tubelog' || url === '/api/pxlog') return { code: 200, body: [] };
  if (url === '/api/info') return { code: 200, body: { node: process.version, mock: true } };

  const img = url.match(/^\/img\/(xv|ph)-(\d+|logo)\.svg$/);
  if (img) {
    const label = img[2] === 'logo' ? img[1].toUpperCase() : `${img[1].toUpperCase()} #${img[2]}`;
    return { code: 200, type: 'image/svg+xml', raw: svgFor(label, Number(img[2]) || 0) };
  }

  const m = url.match(ROUTE);
  if (!m) return { code: 404, type: 'text/plain', raw: '404' };
  const key = m[1];
  if (m[2] === 'manifest.json') return { code: 200, body: manifestOf(key) };

  const resource = m[3];
  const id = decodeURIComponent(m[4]);
  const extra = parseExtra(m[5] ? m[5] : '');
  if (resource === 'catalog') {
    const skip = extra.skip;
    return { code: 200, body: { metas: listPage(key, id, extra, skip) } };
  }
  // Meta e stream: o id do item traz o número do vídeo (test/N)
  const vid = Number((id.match(/test\/(\d+)$/) || [])[1]);
  if (resource === 'meta') {
    if (!vid) return { code: 200, body: { meta: null } };
    const item = makeItem(key, vid);
    return {
      code: 200,
      body: {
        meta: Object.assign({}, item, {
          background: item.poster,
          description: 'Descrição de teste. Vídeo gerado pelo mock, sem conteúdo real.',
        }),
      },
    };
  }
  if (resource === 'stream') {
    if (!vid) return { code: 200, body: { streams: [] } };
    return {
      code: 200,
      body: {
        streams: [{ name: `${TUBES[key].name}\nMP4 720p (teste)`, title: 'MP4 720p (teste)', url: STREAM_URL }],
      },
    };
  }
  return { code: 404, type: 'text/plain', raw: '404' };
}

const server = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.url.split('?')[0] === '/api/quit' && req.method === 'POST') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
    res.end(JSON.stringify({ ok: true }));
    console.log('[mock] /api/quit: saindo');
    return setTimeout(() => server.close(() => process.exit(0)), 100);
  }
  const r = route(req);
  setTimeout(() => {
    const type = r.type || 'application/json';
    const body = r.raw !== undefined ? r.raw : JSON.stringify(r.body);
    res.writeHead(r.code, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, cors));
    res.end(body);
    console.log(`[mock] ${req.method} ${req.url} -> ${r.code}`);
  }, DELAY);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] addons de teste em http://127.0.0.1:${PORT} (delay ${DELAY} ms)`);
});
