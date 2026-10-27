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

export const ROWS = [
  { id: 'trending', title: 'Em alta agora', sub: 'Lançamentos de que todo mundo está falando', load: trending },
  { id: 'truecrime', title: 'True crime', sub: 'Documentários e séries, dos mais bem avaliados', load: trueCrime },
  { id: 'thriller', title: 'Suspense', sub: 'Filmes populares e bem avaliados', load: genreMovies(THRILLER) },
  { id: 'horror', title: 'Terror', sub: 'Filmes populares e bem avaliados', load: genreMovies(HORROR) },
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
