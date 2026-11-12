// Busca da aba NSFW: expande o termo em português e inglês e monta o pedido por orientação
// (hétero / gay) para cada site. Os tubes (XVideos/Pornhub) usam o filtro do próprio site;
// o resto (ex.: TPB 4K Porn) recebe o termo com "gay" quando a lista é gay.
const PT_EN = {
  amador: 'amateur',
  amadora: 'amateur',
  amadores: 'amateur',
  amadoras: 'amateur',
  anal: 'anal',
  asiatica: 'asian',
  asiaticas: 'asian',
  asiático: 'asian',
  asiáticos: 'asian',
  bareback: 'bareback',
  brasileira: 'brazilian',
  brasileiras: 'brazilian',
  brasileiro: 'brazilian',
  brasileiros: 'brazilian',
  brinquedo: 'toys',
  brinquedos: 'toys',
  bunduda: 'big ass',
  bundudas: 'big ass',
  caseiro: 'homemade',
  caseira: 'homemade',
  casal: 'couple',
  casais: 'couples',
  creampie: 'creampie',
  daddy: 'daddy',
  dotado: 'big cock',
  dotados: 'big cock',
  gozada: 'cumshot',
  gozadas: 'cumshot',
  grupo: 'group',
  hentai: 'hentai',
  interacial: 'interracial',
  interracial: 'interracial',
  'inter-racial': 'interracial',
  japonesa: 'japanese',
  japonesas: 'japanese',
  japones: 'japanese',
  japoneses: 'japanese',
  latina: 'latina',
  latinas: 'latina',
  latino: 'latino',
  latinos: 'latino',
  lesbica: 'lesbian',
  lesbicas: 'lesbian',
  loira: 'blonde',
  loiras: 'blonde',
  madura: 'mature',
  maduras: 'mature',
  massagem: 'massage',
  masturbacao: 'masturbation',
  menage: 'threesome',
  ménage: 'threesome',
  milf: 'milf',
  morena: 'brunette',
  morenas: 'brunette',
  musculoso: 'muscle',
  musculosos: 'muscle',
  negra: 'ebony',
  negras: 'ebony',
  negro: 'black',
  negros: 'black',
  novinha: 'teen',
  novinhas: 'teen',
  oral: 'blowjob',
  orgia: 'orgy',
  peituda: 'big tits',
  peitudas: 'big tits',
  publico: 'public',
  'em publico': 'public',
  romantico: 'romantic',
  ruiva: 'redhead',
  ruivas: 'redhead',
  sexo: 'sex',
  squirt: 'squirt',
  twink: 'twink',
  twinks: 'twink',
  urso: 'bear',
  ursos: 'bear',
  gay: 'gay',
  hetero: 'straight',
  hétero: 'straight',
  bissexual: 'bisexual',
  trans: 'trans',
};

const EN_PT = {};
Object.keys(PT_EN).forEach((pt) => {
  const en = PT_EN[pt];
  if (!EN_PT[en]) EN_PT[en] = pt;
});
// Preferências mais naturais no sentido EN→PT.
EN_PT.amateur = 'amador';
EN_PT.asian = 'asiáticas';
EN_PT.brazilian = 'brasileira';
EN_PT['big ass'] = 'bunduda';
EN_PT['big cock'] = 'dotado';
EN_PT['big tits'] = 'peituda';
EN_PT.blonde = 'loira';
EN_PT.brunette = 'morena';
EN_PT.blowjob = 'oral';
EN_PT.cumshot = 'gozada';
EN_PT.ebony = 'negra';
EN_PT.homemade = 'caseiro';
EN_PT.lesbian = 'lésbica';
EN_PT.mature = 'madura';
EN_PT.muscle = 'musculoso';
EN_PT.redhead = 'ruiva';
EN_PT.teen = 'novinha';
EN_PT.threesome = 'ménage';
EN_PT.toys = 'brinquedos';
EN_PT.bear = 'urso';
EN_PT.straight = 'hétero';

function stripAccents(s) {
  return String(s || '')
    .replace(/[áàâãä]/gi, 'a')
    .replace(/[éèêë]/gi, 'e')
    .replace(/[íìîï]/gi, 'i')
    .replace(/[óòôõö]/gi, 'o')
    .replace(/[úùûü]/gi, 'u')
    .replace(/ç/gi, 'c');
}

function uniq(list) {
  const seen = {};
  const out = [];
  list.forEach((x) => {
    const k = String(x || '')
      .trim()
      .toLowerCase();
    if (!k || seen[k]) return;
    seen[k] = true;
    out.push(String(x).trim());
  });
  return out;
}

function mapWords(query, dict) {
  const raw = String(query || '').trim();
  if (!raw) return '';
  // Frases de 2 palavras primeiro (ex.: "em publico", "big cock").
  let left = stripAccents(raw.toLowerCase());
  const parts = [];
  while (left) {
    const two = left.match(/^(\S+\s+\S+)/);
    if (two && dict[two[1]]) {
      parts.push(dict[two[1]]);
      left = left.slice(two[1].length).trim();
      continue;
    }
    const one = left.match(/^(\S+)/);
    if (!one) break;
    parts.push(dict[one[1]] || one[1]);
    left = left.slice(one[1].length).trim();
  }
  return parts.join(' ');
}

// Termos a pedir nos sites: o original e as versões PT/EN quando forem diferentes.
export function expandQueries(q) {
  const raw = String(q || '').trim();
  if (!raw) return [];
  const en = mapWords(raw, PT_EN);
  const pt = mapWords(raw, EN_PT);
  return uniq([raw, en, pt].filter(Boolean));
}

export function isTubeAddon(addon) {
  const id = addon && addon.manifest && addon.manifest.id;
  return id === 'seraflix.xvideos' || id === 'seraflix.pornhub';
}

// Extra do catálogo: tubes recebem orientation; TPB e outros ganham "gay" no termo na lista gay.
export function searchExtra(entry, query, orientation) {
  if (isTubeAddon(entry.addon)) {
    return { search: query, orientation: orientation === 'gay' ? 'gay' : 'straight' };
  }
  if (orientation === 'gay' && !/\bgay\b/i.test(query)) return { search: query + ' gay' };
  return { search: query };
}

// Temas extras desta sessão (fileiras de descoberta além do Creampie), para não repetir sempre o mesmo.
const THEME_H = [
  { title: 'Brasileiras em alta', search: 'brasileira' },
  { title: 'Amador em alta', search: 'amateur' },
  { title: 'MILF em alta', search: 'milf' },
  { title: 'Anal em alta', search: 'anal' },
  { title: 'Lésbicas em alta', search: 'lesbian' },
  { title: 'POV em alta', search: 'pov' },
  { title: 'Bundudas em alta', search: 'big ass' },
  { title: 'Peitudas em alta', search: 'big tits' },
];
const THEME_G = [
  { title: 'Brasileiros gay em alta', search: 'brasileiro' },
  { title: 'Bareback em alta', search: 'bareback' },
  { title: 'Twinks em alta', search: 'twink' },
  { title: 'Musculosos em alta', search: 'muscle' },
  { title: 'Ursos em alta', search: 'bear' },
  { title: 'Daddy em alta', search: 'daddy' },
  { title: 'Amador gay em alta', search: 'amateur' },
];

export function sessionThemes(seed) {
  const s = seed || 1;
  const h = THEME_H[s % THEME_H.length];
  const g = THEME_G[Math.floor(s / 7) % THEME_G.length];
  return [
    { title: h.title, search: h.search, orientation: 'straight', order: 0.5 },
    { title: g.title, search: g.search, orientation: 'gay', order: 1.5 },
  ];
}
