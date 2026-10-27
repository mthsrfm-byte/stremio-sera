// Vídeos adultos salvos: ficam só neste aparelho e neste perfil (fora da biblioteca da conta
// Stremio, que aparece em outros apps). Aparecem na primeira fileira da aba NSFW.
import * as store from './store.js';

const KEY = 'nsfwSaved';
const MAX = 500;

export function list() {
  return store.get(KEY, []) || [];
}

export function has(id) {
  return list().some((x) => x.id === id);
}

// Salva ou tira; devolve true se ficou salvo.
export function toggle(meta) {
  const items = list();
  const i = items.findIndex((x) => x.id === meta.id);
  if (i >= 0) items.splice(i, 1);
  else items.unshift({ id: meta.id, type: meta.type || 'movie', name: meta.name || '', poster: meta.poster || meta.background || '', posterShape: meta.posterShape || '', savedAt: Date.now() });
  store.set(KEY, items.slice(0, MAX));
  return i < 0;
}
