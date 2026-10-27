// Metadados extras no estilo do Kai (Metadata/ e details-enhancer):
// - notas de várias fontes (IMDb do Cinemeta; MDBList com chave; AniList para animes, sem chave);
// - sinopse/título em PT-BR, logo e elenco com fotos via TMDB (com chave).
import { cachedJSON, getJSON } from '../lib/http.js';
import * as store from '../lib/store.js';
import { getJSONViaProxy } from './server.js';
import { apiLang } from '../lib/i18n.js';

const TMDB = 'https://api.themoviedb.org/3/';
const TMDB_IMG = 'https://image.tmdb.org/t/p/';

function imdbOf(id) {
  const m = String(id || '').match(/^tt\d+/);
  return m ? m[0] : null;
}

// Chaves embutidas no build pela GitHub Action (secrets TMDB_API_KEY / MDBLIST_API_KEY).
// A digitada em Ajustes, se houver, tem prioridade.
export const BUILTIN_KEYS = {
  tmdbKey: typeof __KAI_TMDB__ !== 'undefined' ? __KAI_TMDB__ : '',
  mdblistKey: typeof __KAI_MDBLIST__ !== 'undefined' ? __KAI_MDBLIST__ : '',
};

function keyOf(name) {
  return (store.settings()[name] || '').trim() || BUILTIN_KEYS[name];
}

function tmdbKey() {
  return keyOf('tmdbKey');
}

// Teste direto (sem cache) para o diagnóstico de rede.
export function tmdbPing() {
  return getJSON(TMDB + 'configuration?api_key=' + encodeURIComponent(tmdbKey()), { timeout: 10000, quiet: true });
}

export function hasTmdb() {
  return !!tmdbKey();
}

// GET na API do TMDB com a chave (do usuário ou embutida), com cache de 6h.
export function tmdb(path, params) {
  const q = ['api_key=' + encodeURIComponent(tmdbKey())];
  Object.keys(params || {}).forEach((k) => q.push(k + '=' + encodeURIComponent(params[k])));
  return cachedJSON(TMDB + path + '?' + q.join('&'), 6 * 3600000, { quiet: true });
}

// IMDb → { id, type: 'movie' | 'tv', overview, title } em PT-BR.
export function tmdbFind(imdb) {
  if (!tmdbKey() || !imdb) return Promise.resolve(null);
  return tmdb('find/' + imdb, { external_source: 'imdb_id', language: apiLang() }).then((r) => {
    const m = (r.movie_results || [])[0];
    const tv = (r.tv_results || [])[0];
    const hit = m || tv;
    if (!hit) return null;
    return { id: hit.id, type: m ? 'movie' : 'tv', overview: hit.overview || '', title: hit.title || hit.name || '' };
  });
}

function pickLogo(logos) {
  const pref = ['pt', 'en', null];
  for (let i = 0; i < pref.length; i++) {
    const l = (logos || []).find((x) => x.iso_639_1 === pref[i]);
    if (l) return TMDB_IMG + 'w500' + l.file_path;
  }
  return null;
}

// Detalhes localizados: título, sinopse, logo e elenco com fotos.
export function localized(meta) {
  const imdb = imdbOf(meta.id);
  return tmdbFind(imdb).then((f) => {
    if (!f) return null;
    return tmdb(f.type + '/' + f.id, { language: apiLang(), append_to_response: 'credits,images', include_image_language: 'pt,en,null' }).then((d) => ({
      tmdbId: f.id,
      tmdbType: f.type,
      title: d.title || d.name || f.title,
      overview: d.overview || f.overview,
      tagline: d.tagline || '',
      logo: pickLogo(d.images && d.images.logos),
      cast: ((d.credits && d.credits.cast) || []).slice(0, 14).map((c) => ({
        name: c.name,
        character: c.character || '',
        photo: c.profile_path ? TMDB_IMG + 'w185' + c.profile_path : null,
      })),
    }));
  });
}

// Episódios de uma temporada em PT-BR: { [número]: { name, overview, still } }
export function seasonPt(tmdbId, season) {
  if (!tmdbKey()) return Promise.resolve({});
  return tmdb('tv/' + tmdbId + '/season/' + season, { language: apiLang() }).then((r) => {
    const map = {};
    (r.episodes || []).forEach((e) => {
      map[e.episode_number] = { name: e.name, overview: e.overview, still: e.still_path ? TMDB_IMG + 'w300' + e.still_path : null };
    });
    return map;
  });
}

// ---------- Notas ----------
// Só IMDb e Rotten Tomatoes (crítica e público). MDBList traz as do Rotten Tomatoes; null = sem nota.
function mdblist(meta) {
  const key = keyOf('mdblistKey');
  const imdb = imdbOf(meta.id);
  if (!key || !imdb) return Promise.resolve({});
  const type = meta.type === 'series' ? 'show' : 'movie';
  return getJSONViaProxy('https://api.mdblist.com/imdb/' + type + '/' + imdb + '?apikey=' + encodeURIComponent(key), { timeout: 12000 })
    .then((d) => {
      const out = {};
      (d.ratings || []).forEach((r) => {
        const v = r.value;
        if (v === null || v === undefined || v === 0) return;
        const src = String(r.source || '').toLowerCase();
        if (src === 'tomatoes') out.critic = Math.round(v);
        else if (src === 'popcorn' || src === 'tomatoesaudience') out.audience = Math.round(v);
        else if (src === 'imdb') out.imdb = Number(v).toFixed(1);
      });
      return out;
    })
    .catch(() => ({}));
}


export function ratings(meta) {
  return mdblist(meta).then((m) => ({
    imdb: meta.imdbRating ? String(meta.imdbRating) : m.imdb || null,
    critic: m.critic === undefined ? null : m.critic,
    audience: m.audience === undefined ? null : m.audience,
  }));
}
