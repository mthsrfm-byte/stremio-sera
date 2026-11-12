// Vídeos adultos abertos por último (até 40), por perfil e só neste aparelho, como os salvos.
// Fica em memória por perfil: cada cartão da aba pergunta, e reler o JSON a cada vez pesava na TV.
import * as store from './store.js';

const KEY = 'nsfwHistory';
const MAX = 40;
let mem = null; // { pid, list }: a lista do perfil ativo

// Só o que o cartão usa (capa, prévia, números); o resto vem dos detalhes.
function pick(item) {
  return {
    id: String(item.id),
    type: item.type || 'movie',
    name: item.name || '',
    poster: item.poster || '',
    background: item.background || '',
    posterShape: item.posterShape || '',
    stats: item.stats || null,
    releaseInfo: item.releaseInfo || '',
    preview: item.preview || '',
  };
}

// Lista do perfil ativo; troca de perfil recarrega.
function current() {
  let pid = null;
  try {
    pid = store.activeProfile().id;
  } catch (e) {
    pid = null;
  }
  if (!mem || mem.pid !== pid) {
    const saved = store.get(KEY, []);
    mem = { pid: pid, list: Array.isArray(saved) ? saved : [] };
  }
  return mem;
}

function save(m) {
  store.set(KEY, m.list);
}

// Mais recentes primeiro (cópia: quem chama não mexe na lista guardada).
export function list() {
  return current().list.slice();
}

// Registra um vídeo aberto: sobe para o topo e não repete.
export function add(item) {
  if (!item || item.id === undefined || item.id === null) return;
  const m = current();
  const e = pick(item);
  m.list = [e].concat(m.list.filter((x) => x.id !== e.id)).slice(0, MAX);
  save(m);
}

export function remove(id) {
  const m = current();
  const k = String(id);
  m.list = m.list.filter((x) => x.id !== k);
  save(m);
}

export function clear() {
  const m = current();
  m.list = [];
  save(m);
}
