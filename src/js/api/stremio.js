// Conta Stremio: login, addons instalados e biblioteca (mesma API do app oficial).
import { postJSON, getJSON } from '../lib/http.js';
import * as store from '../lib/store.js';
import { log } from '../lib/log.js';
import { t } from '../lib/i18n.js';

const API = 'https://api.strem.io/api/';
const LINK = 'https://link.stremio.com/api/v2/';

let auth = store.get('auth', null); // { authKey, user }: a conta é a mesma para todos os perfis

// Recarrega conta, biblioteca e histórico do perfil ativo (chamado ao escolher o perfil na abertura).
export function reloadProfile() {
  flush(); // o que ainda estava para gravar é do perfil anterior
  auth = store.get('auth', null);
  watchMem = null;
  merged = null;
}

// Grava já o que está esperando o atraso (antes de trocar de perfil, que recarrega o app).
export function flush() {
  if (libSaveTimer) {
    clearTimeout(libSaveTimer);
    libSaveTimer = null;
    saveLibraryNow();
  }
  if (watchSaveTimer) {
    clearTimeout(watchSaveTimer);
    watchSaveTimer = null;
    saveWatchNow();
  }
}

function call(method, body) {
  return postJSON(API + method, body).then((res) => {
    if (res && res.error) {
      const err = new Error(res.error.message || t('Erro da API Stremio'));
      err.code = res.error.code;
      throw err;
    }
    return res ? res.result : null;
  });
}

export function isLoggedIn() {
  return !!(auth && auth.authKey);
}

export function user() {
  return auth ? auth.user : null;
}

export function authKey() {
  return auth ? auth.authKey : null;
}

function saveAuth(result) {
  auth = { authKey: result.authKey, user: result.user || null };
  store.set('auth', auth);
  return auth;
}

export function login(email, password) {
  return call('login', { type: 'Login', email: email, password: password, facebook: false }).then(saveAuth);
}

// Login por código: o usuário abre link.stremio.com no celular e digita o código.
export function createLinkCode() {
  return getJSON(LINK + 'create?type=Create').then((res) => {
    if (!res || !res.result || !res.result.code) throw new Error(t('Não foi possível gerar o código'));
    return res.result;
  });
}

export function readLinkCode(code) {
  return getJSON(LINK + 'read?type=Read&code=' + encodeURIComponent(code), { quiet: true }).then((res) => {
    if (res && res.result && res.result.authKey) {
      saveAuth({ authKey: res.result.authKey, user: null });
      return refreshUser().then(() => true);
    }
    return false;
  });
}

export function refreshUser() {
  if (!isLoggedIn()) return Promise.resolve(null);
  return call('getUser', { type: 'GetUser', authKey: auth.authKey })
    .then((u) => {
      auth.user = u;
      store.set('auth', auth);
      return u;
    })
    .catch((e) => {
      if (e.code === 1) logout();
      throw e;
    });
}

export function logout() {
  const key = authKey();
  auth = null;
  store.set('auth', null);
  store.set('addons', null);
  setLibrary([]);
  setPending({}); // pendências são da conta que saiu
  if (key) call('logout', { type: 'Logout', authKey: key }).catch(() => {});
}

// ---- Addons ----
export function getAddonCollection() {
  if (!isLoggedIn()) return Promise.resolve(null);
  return call('addonCollectionGet', { type: 'AddonCollectionGet', authKey: auth.authKey, update: true }).then((r) => {
    const addons = (r && r.addons) || [];
    store.set('addons', addons);
    return addons;
  });
}

// Instala um addon na conta (mesmo formato do app oficial: a coleção inteira é regravada).
export function installAddon(transportUrl) {
  if (!isLoggedIn()) return Promise.reject(new Error(t('Entre na conta primeiro')));
  return getJSON(transportUrl).then((manifest) => {
    if (!manifest || !manifest.id) throw new Error(t('Manifest inválido'));
    return call('addonCollectionGet', { type: 'AddonCollectionGet', authKey: auth.authKey, update: true }).then((r) => {
      const list = (r && r.addons) || [];
      if (list.some((a) => a.transportUrl === transportUrl || (a.manifest && a.manifest.id === manifest.id))) {
        throw new Error(t('Esse addon já está instalado'));
      }
      const next = list.concat([{ transportUrl: transportUrl, transportName: 'http', manifest: manifest, flags: { official: false, protected: false } }]);
      return call('addonCollectionSet', { type: 'AddonCollectionSet', authKey: auth.authKey, addons: next }).then(() => {
        store.set('addons', next);
        return manifest;
      });
    });
  });
}

export function cachedAddons() {
  return store.get('addons', null);
}

// ---- Biblioteca ----
export function getLibrary() {
  if (!isLoggedIn()) return Promise.resolve(cachedLibrary());
  // Antes de aceitar a lista do servidor, reenvia o que ficou pendente (se a rede voltou).
  return sendPending()
    .then(() => call('datastoreGet', { authKey: auth.authKey, collection: 'libraryItem', ids: [], all: true }))
    .then((items) => {
      const list = withPending(Array.isArray(items) ? items : []);
      setLibrary(list);
      return list;
    });
}

// ---- Pendências ----
// Itens que mudaram aqui e ainda não chegaram ao servidor (id -> token). Ficam salvos, para a
// alteração não se perder se a rede cair. Até chegarem, a versão daqui vale mais que a do servidor.
let pendMem = null;
function pendingMap() {
  if (!pendMem) pendMem = store.get('libPending', {}) || {};
  return pendMem;
}

function setPending(map) {
  pendMem = map;
  store.set('libPending', Object.keys(map).length ? map : null);
}

// Marca os itens como pendentes; devolve o token desta tentativa.
function markPending(items) {
  const tok = Math.random().toString(36).slice(2);
  const map = Object.assign({}, pendingMap());
  items.forEach((it) => {
    map[it._id] = tok;
  });
  setPending(map);
  return tok;
}

// Envia os itens. Dando certo, tira da fila só quem não mudou de novo enquanto ia (o token muda a
// cada alteração). Falha: fica na fila e só registra no log.
function sendItems(items, tok) {
  return call('datastorePut', { authKey: auth.authKey, collection: 'libraryItem', changes: items }).then(
    () => {
      const map = Object.assign({}, pendingMap());
      items.forEach((it) => {
        if (map[it._id] === tok) delete map[it._id];
      });
      setPending(map);
    },
    (e) => {
      log.warn('Falha ao salvar na biblioteca', e.message);
    }
  );
}

// Reenvia o que estava pendente (com os dados atuais da biblioteca daqui).
function sendPending() {
  const ids = Object.keys(pendingMap());
  if (!ids.length || !isLoggedIn()) return Promise.resolve();
  const lib = accountLibrary();
  const items = ids.map((id) => lib.find((x) => x._id === id)).filter(Boolean);
  // Id que não existe mais na biblioteca não tem o que enviar: sai da fila.
  const map = Object.assign({}, pendingMap());
  let dropped = false;
  ids.forEach((id) => {
    if (!items.some((x) => x._id === id)) {
      delete map[id];
      dropped = true;
    }
  });
  if (dropped) setPending(map);
  if (!items.length) return Promise.resolve();
  return sendItems(items, markPending(items));
}

// Lista do servidor, com a versão daqui nos itens pendentes (e nos novos que o servidor ainda não tem).
function withPending(list) {
  const map = pendingMap();
  const ids = Object.keys(map);
  if (!ids.length) return list;
  const lib = accountLibrary();
  const out = list.map((it) => (map[it._id] && lib.find((x) => x._id === it._id)) || it);
  ids.forEach((id) => {
    if (list.some((x) => x._id === id)) return;
    const local = lib.find((x) => x._id === id);
    if (local) out.push(local);
  });
  return out;
}

// Biblioteca em memória (reler e converter o JSON a cada consulta pesava na TV);
// o armazenamento local só é gravado com atraso, e só os itens que o app usa.
// A biblioteca é da conta (a mesma em todos os perfis). O que cada perfil assistiu (o "state" de
// cada item: onde parou, último episódio, vistos) é do perfil: o dono da conta usa o da própria
// conta Stremio; os outros perfis guardam o deles só neste aparelho ('watch') e não mexem no
// histórico da conta. cachedLibrary() devolve a biblioteca já com o histórico do perfil ativo.
let libMem = null;
let libSaveTimer = null;
let watchMem = null; // { id: { state, name, type, poster, posterShape } } de um perfil que não é o dono
let watchProfile = null; // de qual perfil é o watchMem (o salvamento atrasado grava nele)
let watchSaveTimer = null;
let merged = null;
const MAX_WATCH = 400;

function owner() {
  return store.isAccountOwner();
}

function setLibrary(list) {
  libMem = list;
  merged = null;
  clearTimeout(libSaveTimer);
  libSaveTimer = setTimeout(saveLibraryNow, 1500);
}

function saveLibraryNow() {
  libSaveTimer = null;
  // Guarda só o que importa (não removidos ou em andamento) para caber no localStorage.
  const slim = (libMem || []).filter((it) => !it.removed || it.temp || (it.state && it.state.timeOffset > 0));
  store.set('library', slim);
}

function accountLibrary() {
  if (!libMem) libMem = store.get('library', []);
  return libMem;
}

function watchMap() {
  if (!watchMem) {
    watchMem = store.get('watch', {}) || {};
    watchProfile = store.activeProfile().id;
  }
  return watchMem;
}

function saveWatch() {
  merged = null;
  clearTimeout(watchSaveTimer);
  watchSaveTimer = setTimeout(saveWatchNow, 1500);
}

function saveWatchNow() {
  watchSaveTimer = null;
  const all = watchMap();
  pruneWatch(all);
  store.setFor(watchProfile, 'watch', all);
}

// Passou do limite: sai o mais antigo. Uma varredura por item que sai (sem reordenar tudo a cada
// gravação); a data é ISO, então comparar como texto já ordena certo.
function pruneWatch(all) {
  const at = (id) => String((all[id].state && all[id].state.lastWatched) || '');
  const ids = Object.keys(all);
  while (ids.length > MAX_WATCH) {
    let old = 0;
    for (let i = 1; i < ids.length; i++) if (at(ids[i]) < at(ids[old])) old = i;
    delete all[ids[old]];
    ids.splice(old, 1);
  }
}

export function cachedLibrary() {
  if (owner()) return accountLibrary();
  if (merged) return merged;
  const watch = watchMap();
  const seen = {};
  // Itens da conta com o histórico deste perfil (ou zerado, se ele nunca assistiu). Tirado da
  // biblioteca por alguém (removed) mas com progresso deste perfil: continua no "Continuar
  // assistindo" dele, como um item que nunca foi favoritado (temp).
  merged = accountLibrary().map((it) => {
    seen[it._id] = true;
    const w = watch[it._id];
    if (!w) return Object.assign({}, it, { state: newLibraryItem(it).state });
    return Object.assign({}, it, { state: w.state, temp: it.temp || !!it.removed });
  });
  // O que só este perfil assistiu (fora da biblioteca da conta).
  Object.keys(watch).forEach((id) => {
    if (seen[id]) return;
    const w = watch[id];
    const it = newLibraryItem({ id: id, name: w.name, type: w.type, poster: w.poster, posterShape: w.posterShape });
    it.state = w.state;
    merged.push(it);
  });
  return merged;
}

// accountToo: grava na conta também (favoritar). Num perfil que não é o dono, o progresso fica só
// nele; para a conta vai só a marcação de favorito, com o histórico que a conta já tinha.
export function putLibraryItems(items, accountToo) {
  let toAccount = items;
  if (!owner()) {
    const watch = watchMap();
    let touched = false;
    items.forEach((it) => {
      if (it.state && (it.state.timeOffset > 0 || it.state.lastWatched)) {
        watch[it._id] = { state: it.state, name: it.name, type: it.type, poster: it.poster, posterShape: it.posterShape };
        touched = true;
      }
    });
    // Só grava o histórico se ele mudou (favoritar sem progresso não mexe nele).
    if (touched) saveWatch();
    if (!accountToo) return Promise.resolve();
    toAccount = items.map((it) => {
      const acc = accountLibrary().filter((x) => x._id === it._id)[0];
      return Object.assign({}, it, { state: acc ? acc.state : newLibraryItem(it).state });
    });
  }
  // Atualiza o cache local mesmo sem conta, para o "continuar assistindo" funcionar offline.
  const lib = accountLibrary();
  toAccount.forEach((it) => {
    const i = lib.findIndex((x) => x._id === it._id);
    if (i >= 0) lib[i] = it;
    else lib.push(it);
  });
  setLibrary(lib);
  if (!isLoggedIn()) return Promise.resolve();
  // Fica pendente até o servidor confirmar (se falhar, reenvia depois, em getLibrary).
  return sendItems(toAccount, markPending(toAccount));
}

export function libraryItem(id) {
  return cachedLibrary().find((x) => x._id === id) || null;
}

function nowIso() {
  return new Date().toISOString();
}

// Mesmo formato do stremio-core (LibraryItem), para não corromper a biblioteca da conta.
export function newLibraryItem(meta) {
  return {
    _id: meta.id || meta._id,
    name: meta.name || '',
    type: meta.type,
    poster: meta.poster || null,
    posterShape: meta.posterShape || 'poster',
    removed: true,
    temp: true,
    _ctime: nowIso(),
    _mtime: nowIso(),
    state: {
      lastWatched: null,
      timeWatched: 0,
      timeOffset: 0,
      overallTimeWatched: 0,
      timesWatched: 0,
      flaggedWatched: 0,
      duration: 0,
      video_id: null,
      watched: null,
      noNotif: false,
    },
    behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false },
  };
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function setInLibrary(meta, inLibrary) {
  const existing = libraryItem(meta.id);
  const item = existing ? clone(existing) : newLibraryItem(meta);
  item.removed = !inLibrary;
  item.temp = false;
  item._mtime = nowIso();
  return putLibraryItems([item], true).then(() => item);
}

export function isInLibrary(id) {
  const it = libraryItem(id);
  return !!(it && !it.removed);
}

// Progresso de reprodução: chamado pelo player periodicamente.
export function saveProgress(meta, videoId, timeMs, durationMs, deltaWatchedMs) {
  const existing = libraryItem(meta.id);
  const item = existing ? clone(existing) : newLibraryItem(meta);
  const s = item.state;
  if (s.video_id !== videoId) {
    s.timeWatched = 0;
    s.flaggedWatched = 0;
  }
  s.video_id = videoId;
  s.timeOffset = Math.max(0, Math.round(timeMs));
  s.duration = Math.max(0, Math.round(durationMs));
  s.lastWatched = nowIso();
  s.timeWatched = (s.timeWatched || 0) + Math.max(0, Math.round(deltaWatchedMs));
  s.overallTimeWatched = (s.overallTimeWatched || 0) + Math.max(0, Math.round(deltaWatchedMs));
  if (!s.flaggedWatched && s.duration > 0 && s.timeWatched > s.duration * 0.7) {
    s.flaggedWatched = 1;
    s.timesWatched = (s.timesWatched || 0) + 1;
  }
  // Perto do fim: tira do "continuar assistindo".
  if (s.duration > 0 && s.timeOffset > s.duration * 0.95) s.timeOffset = 0;
  if (!item.name && meta.name) item.name = meta.name;
  if (!item.poster && meta.poster) item.poster = meta.poster;
  item._mtime = nowIso();
  return putLibraryItems([item]);
}

export function continueWatching() {
  // lastWatched é ISO: compara como texto, mais barato que localeCompare na TV.
  const at = (it) => String(it.state.lastWatched || '');
  return cachedLibrary()
    .filter((it) => it.type !== 'other' && (!it.removed || it.temp) && it.state && it.state.timeOffset > 0)
    .sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0));
}
