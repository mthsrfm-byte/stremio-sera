// Aba "Recomendado": fileiras montadas no TMDB (chave embutida no build).
// Cada item: { tmdbId, mediaType: 'movie'|'tv', name, poster, backdrop, overview, year, rating }.
// Para abrir no Seraflix (addons do Stremio) é preciso o id do IMDb: resolvido só ao escolher.
import { tmdb, hasTmdb } from './extras.js';

const IMG = 'https://image.tmdb.org/t/p/';
const TRUE_CRIME_KEYWORD = 33722; // keyword "true crime" do TMDB
const DOCUMENTARY = 99;
const THRILLER = 53;
const HORROR = 27;

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

function toItem(r, mediaType) {
  const type = mediaType || r.media_type;
  const date = r.release_date || r.first_air_date || '';
  return {
    tmdbId: r.id,
    mediaType: type,
    name: r.title || r.name || '',
    poster: r.poster_path ? IMG + 'w342' + r.poster_path : null,
    backdrop: r.backdrop_path ? IMG + 'w1280' + r.backdrop_path : null,
    overview: r.overview || '',
    year: date.slice(0, 4),
    date: date,
    rating: r.vote_average || 0,
    votes: r.vote_count || 0,
  };
}

// Nota que pesa avaliação e número de votos (média bayesiana): poucos votos puxam para 7.
function score(it) {
  const m = 150;
  return (it.rating * it.votes + 7 * m) / (it.votes + m);
}

function pages(fetchPage, from, count) {
  const list = [];
  for (let p = from; p < from + count; p++) list.push(fetchPage(p).catch(() => []));
  return Promise.all(list).then((all) => [].concat.apply([], all));
}

function dedupe(items) {
  const seen = {};
  return items.filter((it) => {
    const k = it.mediaType + ':' + it.tmdbId;
    if (seen[k] || !it.poster) return false;
    seen[k] = true;
    return true;
  });
}

const lang = { language: 'pt-BR' };

// Lançamentos (últimos 6 meses, já estreados) mais comentados da semana, na ordem do "em alta".
function trending(page) {
  const today = isoDaysAgo(0);
  const since = isoDaysAgo(180);
  return pages((p) => tmdb('trending/all/week', Object.assign({ page: p }, lang)).then((r) => r.results || []), (page - 1) * 3 + 1, 3).then((rs) =>
    dedupe(
      rs
        .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
        .map((r) => toItem(r))
        .filter((it) => it.date && it.date >= since && it.date <= today)
    )
  );
}

// True crime: documentários (filmes e séries) com a keyword "true crime", do mais bem avaliado.
function trueCrime(page) {
  const q = (type, p) =>
    tmdb('discover/' + type, Object.assign({ page: p, with_keywords: TRUE_CRIME_KEYWORD, with_genres: DOCUMENTARY, sort_by: 'vote_count.desc', 'vote_count.gte': 15 }, lang)).then((r) =>
      (r.results || []).map((x) => toItem(x, type))
    );
  return Promise.all([q('tv', page).catch(() => []), q('movie', page).catch(() => [])]).then((both) =>
    dedupe(both[0].concat(both[1])).sort((a, b) => score(b) - score(a))
  );
}

// Suspense e terror: filmes populares entre os bem avaliados.
function genreMovies(genre) {
  return (page) =>
    pages(
      (p) =>
        tmdb('discover/movie', Object.assign({ page: p, with_genres: genre, sort_by: 'popularity.desc', 'vote_average.gte': 6.5, 'vote_count.gte': 400 }, lang)).then((r) =>
          (r.results || []).map((x) => toItem(x, 'movie'))
        ),
      (page - 1) * 2 + 1,
      2
    ).then(dedupe);
}

// short: nome no trilho de categorias; caption: frase embaixo do trilho; title: título no "Ver tudo".
export const ROWS = [
  { id: 'trending', short: 'Em alta', title: 'Em alta', caption: 'Lançamentos de que todo mundo está falando', load: trending },
  { id: 'truecrime', short: 'True crime', title: 'True crime', caption: 'Documentários e séries, dos mais bem avaliados', load: trueCrime },
  { id: 'thriller', short: 'Suspense', title: 'Suspense', caption: 'Filmes de suspense populares e bem avaliados', load: genreMovies(THRILLER) },
  { id: 'horror', short: 'Terror', title: 'Terror', caption: 'Filmes de terror populares e bem avaliados', load: genreMovies(HORROR) },
];

// ---------- Streamings: uma "home" por serviço (Brasil, só o que está na assinatura) ----------
function providerQuery(providerId, extra, page) {
  return Object.assign(
    { page: page, watch_region: 'BR', with_watch_providers: providerId, with_watch_monetization_types: 'flatrate' },
    extra,
    lang
  );
}

// Intercala duas listas mantendo a ordem de cada uma.
function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

function discover(type, query) {
  return tmdb('discover/' + type, query)
    .then((r) => (r.results || []).map((x) => toItem(x, type)))
    .catch(() => []);
}

// Novidades: filmes dos últimos 6 meses e séries dos últimos 4, do mais popular ao menos.
function providerNews(id) {
  return (page) => {
    const today = isoDaysAgo(0);
    return Promise.all([
      discover('tv', providerQuery(id, { sort_by: 'popularity.desc', 'first_air_date.gte': isoDaysAgo(120), 'first_air_date.lte': today }, page)),
      discover('movie', providerQuery(id, { sort_by: 'popularity.desc', 'primary_release_date.gte': isoDaysAgo(180), 'primary_release_date.lte': today }, page)),
    ]).then((both) => dedupe(interleave(both[0], both[1])));
  };
}

// Catálogo inteiro de filmes ou séries do serviço, do mais popular (o "Ver tudo" pagina por ele todo).
function providerCatalog(id, type) {
  return (page) => discover(type, providerQuery(id, { sort_by: 'popularity.desc' }, page)).then(dedupe);
}

// Aclamados: filmes e séries do serviço com nota alta e muitos votos.
function providerAcclaimed(id) {
  return (page) =>
    Promise.all([
      discover('movie', providerQuery(id, { sort_by: 'vote_average.desc', 'vote_count.gte': 800 }, page)),
      discover('tv', providerQuery(id, { sort_by: 'vote_average.desc', 'vote_count.gte': 300 }, page)),
    ]).then((both) => dedupe(interleave(both[0], both[1])).sort((a, b) => score(b) - score(a)));
}

function provider(id, name, de, logo) {
  const rows = [
    { id: 'news', short: 'Novidades', title: 'Novidades', caption: 'Lançamentos recentes ' + de + ' ' + name, load: providerNews(id) },
    { id: 'movies', short: 'Filmes', title: 'Filmes', caption: 'Catálogo de filmes ' + de + ' ' + name + ', dos mais populares', load: providerCatalog(id, 'movie') },
    { id: 'series', short: 'Séries', title: 'Séries', caption: 'Catálogo de séries ' + de + ' ' + name + ', das mais populares', load: providerCatalog(id, 'tv') },
    { id: 'acclaimed', short: 'Aclamados', title: 'Aclamados', caption: 'Os mais bem avaliados ' + de + ' ' + name, load: providerAcclaimed(id) },
  ];
  return { id: 'p' + id, name: name, logo: IMG + 'w154' + logo, rows: rows };
}

export const STREAMINGS = [
  provider(8, 'Netflix', 'da', '/rK1KljqmbvO9HQa1PBFLILWah72.png'),
  provider(119, 'Prime Video', 'do', '/gMZdpavHmxFNnLpMHwVxfqeux2g.png'),
  provider(337, 'Disney+', 'do', '/5eZ872CghnHFLB1j8grszbrx0dx.png'),
  provider(1899, 'HBO Max', 'da', '/skypuy7SXuugIQeYg0IglmzoKaS.png'),
  provider(350, 'Apple TV+', 'do', '/9icYBfYFcwgCbky5VdGUIKJ4C5i.png'),
  provider(283, 'Crunchyroll', 'da', '/uFL3c4Cq8M6WoLymlC5Y8bmGytV.png'),
];

// ---------- Início: o que vale a pena ver agora (no lugar dos catálogos genéricos dos addons) ----------
function trendingType(type) {
  return (page) => tmdb('trending/' + type + '/week', Object.assign({ page: page }, lang)).then((r) => dedupe((r.results || []).map((x) => toItem(x, type))));
}

// Filmes do último ano bem avaliados, dos mais populares.
function acclaimedRecent(page) {
  return discover('movie', Object.assign({ page: page, sort_by: 'popularity.desc', 'primary_release_date.gte': isoDaysAgo(365), 'primary_release_date.lte': isoDaysAgo(0), 'vote_average.gte': 7, 'vote_count.gte': 300 }, lang)).then(dedupe);
}

// Novidades de vários streamings juntas (Netflix, Prime, Disney+, HBO Max, Apple TV+).
function streamingNews(page) {
  const ids = '8|119|337|1899|350';
  const today = isoDaysAgo(0);
  const q = (type, dates) => discover(type, Object.assign({ page: page, watch_region: 'BR', with_watch_providers: ids, with_watch_monetization_types: 'flatrate', sort_by: 'popularity.desc' }, dates, lang));
  return Promise.all([
    q('tv', { 'first_air_date.gte': isoDaysAgo(90), 'first_air_date.lte': today }),
    q('movie', { 'primary_release_date.gte': isoDaysAgo(150), 'primary_release_date.lte': today }),
  ]).then((both) => dedupe(interleave(both[0], both[1])));
}

// Séries muito bem avaliadas (as "obrigatórias").
function acclaimedSeries(page) {
  return discover('tv', Object.assign({ page: page, sort_by: 'vote_average.desc', 'vote_count.gte': 2000, without_genres: '16' }, lang)).then(dedupe);
}

// Clássicos modernos: filmes de 1995 a 2019 com nota alta e muitos votos.
function modernClassics(page) {
  return discover('movie', Object.assign({ page: page, sort_by: 'vote_average.desc', 'vote_count.gte': 5000, 'primary_release_date.gte': '1995-01-01', 'primary_release_date.lte': '2019-12-31' }, lang)).then(dedupe);
}

export const HOME_ROWS = [
  { id: 'hm-movies', title: 'Filmes em alta', caption: 'Os mais vistos da semana', load: trendingType('movie') },
  { id: 'hm-series', title: 'Séries em alta', caption: 'As mais vistas da semana', load: trendingType('tv') },
  { id: 'hm-news', title: 'Chegou nos streamings', caption: 'Netflix, Prime Video, Disney+, HBO Max e Apple TV+', load: streamingNews },
  { id: 'hm-acclaimed', title: 'Aclamados do último ano', caption: 'Filmes recentes com nota alta', load: acclaimedRecent },
  { id: 'hm-tvbest', title: 'Séries obrigatórias', caption: 'As mais bem avaliadas de todos os tempos', load: acclaimedSeries },
  { id: 'hm-classics', title: 'Clássicos modernos', caption: 'Filmes de 1995 a 2019 que todo mundo ama', load: modernClassics },
];

export function available() {
  return hasTmdb();
}

// IMDb do item (os addons do Stremio usam esse id).
export function imdbId(it) {
  return tmdb(it.mediaType + '/' + it.tmdbId + '/external_ids', {}).then((r) => (r && r.imdb_id) || null);
}

// Trailers no YouTube, do melhor para o pior: oficiais em português, depois em inglês.
// Vários, porque alguns donos bloqueiam a incorporação (erro 150) e aí tenta o próximo.
export function trailerKeys(it) {
  const list = (r) => {
    const vids = ((r && r.results) || []).filter((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
    vids.sort((a, b) => (b.type === 'Trailer') - (a.type === 'Trailer') || (b.official === true) - (a.official === true));
    return vids.map((v) => v.key);
  };
  const base = it.mediaType + '/' + it.tmdbId + '/videos';
  return Promise.all([tmdb(base, { language: 'pt-BR' }).then(list).catch(() => []), tmdb(base, { language: 'en-US' }).then(list).catch(() => [])]).then(
    (both) => both[0].concat(both[1].filter((k) => both[0].indexOf(k) < 0)).slice(0, 6)
  );
}

// Último resultado de trailer, para diagnóstico em Ajustes.
let trailerReport = '';
export function setTrailerReport(text) {
  trailerReport = text;
}
export function getTrailerReport() {
  return trailerReport;
}
