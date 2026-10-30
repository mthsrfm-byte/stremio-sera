// localStorage com JSON e tolerância a falhas, separado por PERFIL.
// A conta Stremio (login, addons, biblioteca) é uma só, de todos os perfis; cada perfil tem o seu
// histórico (o que assistiu e onde parou) e as preferências pessoais. O que é da TV (servidor do
// PC, chaves de API, rolagem) também fica compartilhado entre os perfis.
import { current } from './i18n.js';

const PREFIX = 'kai.';

function rawGet(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function rawSet(key, value) {
  try {
    if (value === undefined || value === null) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    /* armazenamento cheio ou bloqueado */
  }
}

// ---------- Perfis ----------
// Cores dos perfis (a base do degradê do avatar). Os 8 primeiros são os de antes, na mesma ordem.
export const PALETTE = [
  { color: '#7b5bf5', name: 'Roxo' },
  { color: '#e5508c', name: 'Rosa' },
  { color: '#2bb6a3', name: 'Verde-água' },
  { color: '#f0a030', name: 'Laranja' },
  { color: '#3d8bfd', name: 'Azul' },
  { color: '#e55353', name: 'Vermelho' },
  { color: '#8bc34a', name: 'Verde' },
  { color: '#9e9e9e', name: 'Cinza' },
  { color: '#3347ff', name: 'Anil' },
  { color: '#ff7a59', name: 'Coral' },
  { color: '#b388ff', name: 'Lilás' },
  { color: '#16b5d8', name: 'Turquesa' },
];
export const COLORS = PALETTE.map((x) => x.color);
export const MAX_PROFILES = 5;

// Cor sorteada para um perfil novo, de preferência uma que nenhum outro perfil usa (cinza fica fora).
function randomColor(taken) {
  const pool = COLORS.filter((c) => c !== '#9e9e9e');
  const free = pool.filter((c) => taken.indexOf(c) < 0);
  const from = free.length ? free : pool;
  return from[Math.floor(Math.random() * from.length)];
}

function profileKey(id, key) {
  return 'p.' + id + '.' + key;
}

// Migração: dados de antes dos perfis viram o primeiro perfil (sem precisar entrar de novo).
function ensureProfiles() {
  let list = rawGet('profiles', null);
  if (list && list.length) return list;
  const id = 'p' + Date.now().toString(36);
  const oldAuth = rawGet('auth', null);
  const email = oldAuth && oldAuth.user && oldAuth.user.email;
  // Instalação nova: o assistente pede o nome (unnamed). Quem já usava: nome vem do e-mail da conta.
  const color = randomColor([]);
  list = [email ? { id: id, name: email.split('@')[0], color: color } : { id: id, name: 'Perfil 1', color: color, unnamed: true }];
  ['auth', 'addons', 'library'].forEach((k) => {
    const v = rawGet(k, null);
    if (v !== null) rawSet(profileKey(id, k), v);
    rawSet(k, null);
  });
  const oldSettings = rawGet('settings', null);
  if (oldSettings) {
    const dev = {};
    const prof = {};
    Object.keys(oldSettings).forEach((k) => {
      // O log remoto é só de desenvolvimento e chaves vazias não precisam ser fixadas.
      if (k === 'devlogUrl' || oldSettings[k] === '') return;
      (DEVICE_KEYS.indexOf(k) >= 0 ? dev : prof)[k] = oldSettings[k];
    });
    rawSet('device', dev);
    rawSet(profileKey(id, 'settings'), prof);
    rawSet('settings', null);
  }
  rawSet('profiles', list);
  rawSet('activeProfile', id);
  return list;
}

// Da conta (iguais para todos os perfis): login, addons e a biblioteca da conta.
const ACCOUNT_KEYS = ['auth', 'addons', 'library'];

// Migração para a conta única: antes cada perfil tinha a sua. Fica a do primeiro perfil (na ordem
// em que foram criados) que tinha conta, e esse perfil vira o "dono": ele lê e grava o histórico
// da conta Stremio, como antes. Os outros guardam o que assistiram só neste aparelho ('watch'):
// - perfil que estava em OUTRA conta leva o histórico dela (era só dele);
// - perfil que estava na MESMA conta (mesmo e-mail, logado duas vezes) começa limpo: o histórico
//   daquela conta é o mesmo do dono, misturado, e fica com o dono.
// Mesma conta: mesmo id de usuário ou mesmo e-mail (um login pode ter guardado só um dos dois).
function sameAccount(a, b) {
  const x = (a && a.user) || {};
  const y = (b && b.user) || {};
  if (x._id && y._id) return x._id === y._id;
  return !!(x.email && y.email && String(x.email).toLowerCase() === String(y.email).toLowerCase());
}

function ensureSharedAccount(list) {
  if (rawGet('sharedAccount', false)) return list;
  const authOf = (p) => rawGet(profileKey(p.id, 'auth'), null);
  const owner = list.filter((p) => {
    const a = authOf(p);
    return !!(a && a.authKey);
  })[0] || null;
  const ownerAuth = owner ? authOf(owner) : null;
  list.forEach((p) => {
    if (owner && p.id === owner.id) {
      ACCOUNT_KEYS.forEach((k) => rawSet('account.' + k, rawGet(profileKey(p.id, k), null)));
    } else if (!sameAccount(authOf(p), ownerAuth)) {
      const watch = {};
      (rawGet(profileKey(p.id, 'library'), []) || []).forEach((it) => {
        if (it && it._id && it.state && (it.state.timeOffset > 0 || it.state.lastWatched)) {
          watch[it._id] = { state: it.state, name: it.name, type: it.type, poster: it.poster, posterShape: it.posterShape };
        }
      });
      if (Object.keys(watch).length) rawSet(profileKey(p.id, 'watch'), watch);
    }
    ACCOUNT_KEYS.forEach((k) => rawSet(profileKey(p.id, k), null));
  });
  const next = list.map((p) => Object.assign({}, p, { owner: !!(owner && p.id === owner.id) }));
  saveProfiles(next);
  rawSet('sharedAccount', true);
  return next;
}

// Cores sorteadas (uma vez): antes todo perfil nascia com a cor da sua posição (o 1º roxo, o 2º
// rosa...). Quem nunca trocou a cor ganha uma sorteada; quem escolheu (colorPicked) mantém.
function ensureRandomColors(list) {
  if (rawGet('randomColors', false)) return list;
  const taken = [];
  const next = list.map((p, i) => {
    let c = p.color;
    if (!p.colorPicked && (!c || c === COLORS[i % 8])) c = randomColor(taken);
    taken.push(c);
    return Object.assign({}, p, { color: c });
  });
  saveProfiles(next);
  rawSet('randomColors', true);
  return next;
}

// Sempre exatamente um dono (o histórico da conta precisa ser de alguém): sem dono, o primeiro.
function ensureOwner(list) {
  const owners = list.filter((p) => p.owner);
  if (owners.length === 1) return list;
  const keep = owners[0] || list[0];
  const next = list.map((p) => Object.assign({}, p, { owner: p.id === keep.id }));
  saveProfiles(next);
  return next;
}

// A lista fica em memória: perfis são lidos a cada get/set (vários por cartão na tela), e reler e
// converter o JSON toda vez pesava na TV. Só este módulo grava a lista (saveProfiles).
let listMem = null;
let activeMem;

function saveProfiles(list) {
  listMem = list;
  rawSet('profiles', list);
}

export function profiles() {
  if (!listMem) listMem = ensureOwner(ensureRandomColors(ensureSharedAccount(ensureProfiles())));
  return listMem;
}

// O perfil dono da conta Stremio: o histórico dele é o da conta (sincroniza com o celular, o PC...).
// Os outros perfis guardam o que assistiram só neste aparelho.
export function isAccountOwner() {
  return !!activeProfile().owner;
}

export function activeProfile() {
  const list = profiles();
  if (activeMem === undefined) activeMem = rawGet('activeProfile', null);
  return list.find((p) => p.id === activeMem) || list[0];
}

export function setActiveProfile(id) {
  activeMem = id;
  rawSet('activeProfile', id);
}

export function addProfile(name, color) {
  const list = profiles().slice();
  const p = { id: 'p' + Date.now().toString(36), name: name || 'Perfil ' + (list.length + 1), color: color || randomColor(list.map((x) => x.color)) };
  list.push(p);
  saveProfiles(list);
  return p;
}

export function updateProfile(id, patch) {
  saveProfiles(profiles().map((p) => (p.id === id ? Object.assign({}, p, patch) : p)));
}

// Cor escolhida pela pessoa: a partir daí ela não é mais sorteada.
export function setProfileColor(id, color) {
  updateProfile(id, { color: color, colorPicked: true });
}

export function removeProfile(id) {
  const all = profiles();
  const gone = all.filter((p) => p.id === id)[0];
  const list = all.filter((p) => p.id !== id);
  if (!list.length) return false;
  // Tudo o que é do perfil: histórico, preferências, fonte da última vez, favoritos adultos...
  try {
    const prefix = PREFIX + profileKey(id, '');
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) keys.push(window.localStorage.key(i));
    keys.forEach((k) => k && k.indexOf(prefix) === 0 && window.localStorage.removeItem(k));
  } catch (e) {
    /* armazenamento bloqueado */
  }
  // Apagou o dono: o próximo perfil passa a usar o histórico da conta.
  if (gone && gone.owner) list[0] = Object.assign({}, list[0], { owner: true });
  saveProfiles(list);
  if (activeProfile().id === id || !list.some((p) => p.id === activeMem)) setActiveProfile(list[0].id);
  return true;
}

// Grava um dado de um perfil específico (um salvamento atrasado não pode cair no perfil errado).
export function setFor(profileId, key, value) {
  rawSet(profileKey(profileId, key), value);
}

// ---------- Dados do perfil ativo (a conta é de todos) ----------
export function get(key, fallback) {
  if (ACCOUNT_KEYS.indexOf(key) >= 0) {
    profiles(); // garante a migração para a conta única antes de ler
    return rawGet('account.' + key, fallback);
  }
  return rawGet(profileKey(activeProfile().id, key), fallback);
}

export function set(key, value) {
  if (ACCOUNT_KEYS.indexOf(key) >= 0) {
    profiles();
    return rawSet('account.' + key, value);
  }
  rawSet(profileKey(activeProfile().id, key), value);
}

// ---------- Preferências ----------
// Da TV (iguais para todos os perfis):
const DEVICE_KEYS = ['introSound', 'serverUrl', 'tmdbKey', 'mdblistKey', 'smoothScroll', 'devlogUrl', 'lastUpdateCheck', 'askProfile', 'wizardDone', 'language', 'screensaver'];

const DEFAULT_SETTINGS = {
  // TV
  serverUrl: '',
  tmdbKey: '', // vazio = usa a chave embutida no build (BUILTIN_KEYS em api/extras.js), se houver
  mdblistKey: '',
  introSound: true, // som da abertura
  smoothScroll: false, // rolagem animada (mais bonita, mais pesada na TV)
  devlogUrl: typeof __KAI_DEVLOG__ !== 'undefined' ? __KAI_DEVLOG__ : '',
  language: 'auto', // 'auto' (idioma da TV) | 'pt' | 'en'
  askProfile: true, // "Quem está assistindo?" ao abrir, se houver mais de um perfil
  wizardDone: false,
  screensaver: 5, // minutos parado até o protetor de tela (0 = desligado)
  // Perfil
  heroSource: 'cinemeta',
  theme: 'dark', // 'dark' | 'light'; ver lib/theme.js
  oled: false,
  subtitleLangs: ['pob', 'por', 'pt', 'pt-br'],
  audioLangs: [], // vazio = mantém o áudio padrão do arquivo (geralmente o original)
  subtitleSize: 100,
  subtitleFont: 'bricolage',
  subtitleStyle: 'kai',
  subtitleColor: '#ffffff',
  subtitleBold: true,
  subtitlePosition: 'low',
  skipMode: 'prompt', // prompt | auto | off
  subtitlesAuto: true,
  localAddons: [],
};

export function settings() {
  // Legenda automática padrão segue o idioma do app (quem já escolheu, mantém a escolha).
  const base = Object.assign({}, DEFAULT_SETTINGS, current() === 'en' ? { subtitleLangs: ['eng', 'en'] } : null);
  return Object.assign(base, rawGet('device', {}), get('settings', {}));
}

export function saveSettings(patch) {
  const dev = rawGet('device', {});
  const prof = get('settings', {});
  Object.keys(patch).forEach((k) => ((DEVICE_KEYS.indexOf(k) >= 0 ? dev : prof)[k] = patch[k]));
  rawSet('device', dev);
  set('settings', prof);
  return settings();
}
