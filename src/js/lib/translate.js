// Tradução: categorias da aba NSFW por dicionário (sem rede) e texto corrido (ex.: bio de atores)
// pelo tradutor do Google (endpoint gratuito). Se a tradução falhar, fica o original.
import { getJSON } from './http.js';
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
