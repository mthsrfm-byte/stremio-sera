// Tradução para a aba NSFW: categorias por dicionário (sem rede) e títulos pelo tradutor do
// Google (endpoint gratuito), em lote e com cache. Se a tradução falhar, fica o original.
import { getJSON } from './http.js';
import * as store from './store.js';
import { genreName } from './genres.js';

const GENRES = {
  amateur: 'Amador', anal: 'Anal', asian: 'Asiáticas', babe: 'Gatas', babes: 'Gatas', bbw: 'Gordinhas',
  bdsm: 'BDSM', big_ass: 'Bundudas', 'big ass': 'Bundudas', 'big tits': 'Peitudas', big_tits: 'Peitudas',
  blonde: 'Loiras', blondes: 'Loiras', blowjob: 'Oral', brunette: 'Morenas', brunettes: 'Morenas',
  casting: 'Teste de elenco', college: 'Universitárias', compilation: 'Compilação', couple: 'Casal', couples: 'Casais',
  creampie: 'Creampie', cuckold: 'Corno', cumshot: 'Gozada', ebony: 'Negras', european: 'Europeias',
  fetish: 'Fetiche', fisting: 'Fisting', gangbang: 'Gangbang', gay: 'Gay', german: 'Alemãs', group: 'Grupo',
  'group sex': 'Sexo em grupo', hardcore: 'Hardcore', hentai: 'Hentai', homemade: 'Caseiro', interracial: 'Inter-racial',
  japanese: 'Japonesas', latina: 'Latinas', latinas: 'Latinas', lesbian: 'Lésbicas', lesbians: 'Lésbicas',
  massage: 'Massagem', masturbation: 'Masturbação', mature: 'Maduras', milf: 'MILF', 'most viewed': 'Mais vistos',
  'most popular': 'Mais populares', popular: 'Populares', new: 'Novidades', newest: 'Mais recentes', latest: 'Mais recentes',
  'top rated': 'Mais bem avaliados', trending: 'Em alta', featured: 'Destaques', 'hot': 'Em alta', outdoor: 'Ao ar livre',
  pov: 'POV', public: 'Em público', redhead: 'Ruivas', redheads: 'Ruivas', russian: 'Russas', solo: 'Solo',
  squirt: 'Squirt', stepmom: 'Madrasta', 'step mom': 'Madrasta', stepsister: 'Meia-irmã', 'step sister': 'Meia-irmã',
  teen: 'Novinhas (18+)', teens: 'Novinhas (18+)', threesome: 'Ménage', toys: 'Brinquedos', vintage: 'Clássicos',
  webcam: 'Webcam', wife: 'Esposa', 'big dick': 'Dotados', black: 'Negros', brazilian: 'Brasileiras', petite: 'Mignon',
  orgy: 'Orgia', 'female friendly': 'Para elas', romantic: 'Romântico', cosplay: 'Cosplay', 'reality': 'Reality',
  movies: 'Filmes', videos: 'Vídeos', channels: 'Canais', pornstars: 'Atrizes', categories: 'Categorias', all: 'Todos',
  trans: 'Trans', transgender: 'Trans', shemale: 'Trans', bisexual: 'Bissexual', 'full movie': 'Filme completo',
};

// Categorias que não aparecem.
const HIDDEN = /\b(indian|india|indians|desi|indian[oa]s?|hindi|bollywood|tamil|telugu)\b/i;

export function isHiddenCategory(name) {
  return HIDDEN.test(String(name || ''));
}

export function genre(name) {
  const key = String(name || '').trim().toLowerCase();
  return GENRES[key] || GENRES[key.replace(/[-_]+/g, ' ')] || genreName(name);
}

// ---------- Títulos ----------
const CACHE_KEY = 'nsfwTitles';
const CACHE_MAX = 3000;
let cache = null;

function mem() {
  if (!cache) cache = store.get(CACHE_KEY, {}) || {};
  return cache;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const c = mem();
    const keys = Object.keys(c);
    if (keys.length > CACHE_MAX) keys.slice(0, keys.length - CACHE_MAX).forEach((k) => delete c[k]);
    store.set(CACHE_KEY, c);
  }, 1500);
}

export function enabled() {
  return store.settings().nsfwTranslate !== false;
}

// Já parece português: não gasta tradução.
function looksPt(s) {
  return /[ãõçáéíóúâêô]/i.test(s) || /\b(com|uma|para|gostosa|novinha|esposa|não)\b/i.test(s);
}

// Uma ida ao tradutor com várias linhas juntas (uma por título).
function translateBatch(lines) {
  const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&q=' + encodeURIComponent(lines.join('\n'));
  return getJSON(u, { timeout: 8000 }).then((r) => {
    const text = ((r && r[0]) || []).map((p) => p[0] || '').join('');
    const out = text.split('\n');
    return out.length === lines.length ? out : null;
  });
}

// Troca item.name pela versão em português (guarda o original em item.originalName).
export function titles(items) {
  if (!enabled() || !items.length) return Promise.resolve(items);
  const c = mem();
  const todo = [];
  items.forEach((it) => {
    const n = it && it.name;
    if (!n || looksPt(n) || c[n] !== undefined || todo.indexOf(n) >= 0) return;
    todo.push(n.replace(/\n/g, ' '));
  });
  const batches = [];
  for (let i = 0; i < todo.length; i += 25) batches.push(todo.slice(i, i + 25));
  return Promise.all(
    batches.map((b) =>
      translateBatch(b)
        .then((out) => {
          if (!out) return;
          b.forEach((n, i) => (c[n] = out[i].trim() || n));
          save();
        })
        .catch(() => {})
    )
  ).then(() =>
    items.map((it) => (it && c[it.name] && c[it.name] !== it.name ? Object.assign({}, it, { name: c[it.name], originalName: it.name }) : it))
  );
}

// Texto corrido (ex.: biografia) para português, em pedaços que cabem na URL. Falhou: null.
export function text(str) {
  const src = String(str || '').trim();
  if (!src) return Promise.resolve(null);
  const parts = [];
  let cur = '';
  // Frases pelo ponto final (sem lookbehind: o Chromium 47 da TV não entende).
  (src.match(/[^.!?]+[.!?]*\s*/g) || [src]).map((x) => x.trim()).forEach((sentence) => {
    if ((cur + ' ' + sentence).length > 1500 && cur) {
      parts.push(cur);
      cur = sentence;
    } else cur = cur ? cur + ' ' + sentence : sentence;
  });
  if (cur) parts.push(cur);
  return Promise.all(
    parts.map((q) =>
      getJSON('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&q=' + encodeURIComponent(q), { timeout: 10000 }).then((r) =>
        ((r && r[0]) || []).map((p) => p[0] || '').join('')
      )
    )
  ).then(
    (out) => out.join(' ').trim() || null,
    () => null
  );
}
