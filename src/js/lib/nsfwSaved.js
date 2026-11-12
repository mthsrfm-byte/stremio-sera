// Vídeos adultos salvos: ficam só neste aparelho e neste perfil (fora da biblioteca da conta
// Stremio, que aparece em outros apps). Aparecem na primeira fileira da aba NSFW.
import * as store from './store.js';

const KEY = 'nsfwSaved';
const MAX = 500;

// Lista e ids em memória: cada cartão pergunta "salvo?" e lia o JSON inteiro a cada vez.
// Refaz a leitura quando muda o perfil ou os ajustes (store.epoch) e depois de salvar/tirar.
let mem = null; // { ep, items, ids }
function load() {
  const ep = store.epoch();
  if (!mem || mem.ep !== ep) {
    const items = store.get(KEY, []) || [];
    const ids = new Set();
    items.forEach((x) => x && ids.add(x.id));
    mem = { ep: ep, items: items, ids: ids };
  }
  return mem;
}

// Cópia: quem usa a lista não mexe no que está em memória.
export function list() {
  return load().items.slice();
}

export function has(id) {
  return load().ids.has(id);
}

// Salva ou tira; devolve true se ficou salvo.
export function toggle(meta) {
  const items = list();
  const i = items.findIndex((x) => x.id === meta.id);
  if (i >= 0) items.splice(i, 1);
  else items.unshift({ id: meta.id, type: meta.type || 'movie', name: meta.name || '', poster: meta.poster || meta.background || '', posterShape: meta.posterShape || '', savedAt: Date.now() });
  store.set(KEY, items.slice(0, MAX));
  mem = null; // a próxima leitura pega o que foi gravado
  return i < 0;
}
