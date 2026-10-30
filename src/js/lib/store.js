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

// Migração para a conta única: antes cada perfil tinha a sua. Fica a do perfil ativo (ou a do
// primeiro que tiver conta), e esse perfil vira o "dono": ele lê e grava o histórico da própria
// conta Stremio, como antes. Os outros perfis guardam o que assistiram só neste aparelho
// ('watch'), começando pelo histórico que já tinham na conta antiga deles.
function ensureSharedAccount(list) {
  if (rawGet('sharedAccount', false)) return list;
  const active = rawGet('activeProfile', null);
  const withAuth = (p) => {
    const a = rawGet(profileKey(p.id, 'auth'), null);
    return !!(a && a.authKey);
  };
  const owner = list.filter((p) => p.id === active && withAuth(p))[0] || list.filter(withAuth)[0] || null;
  list.forEach((p) => {
    if (owner && p.id === owner.id) {
      ACCOUNT_KEYS.forEach((k) => rawSet('account.' + k, rawGet(profileKey(p.id, k), null)));
    } else {
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
  rawSet('profiles', next);
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
  rawSet('profiles', next);
  rawSet('randomColors', true);
  return next;
}

export function profiles() {
  return ensureRandomColors(ensureSharedAccount(ensureProfiles()));
}

// O perfil dono da conta Stremio: o histórico dele é o da conta (sincroniza com o celular, o PC...).
// Sem dono ainda (ninguém entrou na conta), quem entrar primeiro vira o dono.
export function isAccountOwner() {
  const me = activeProfile();
  return !!me.owner || !profiles().some((p) => p.owner);
}

export function claimAccount() {
  if (profiles().some((p) => p.owner)) return;
  updateProfile(activeProfile().id, { owner: true });
}

export function activeProfile() {
  const list = profiles();
  const id = rawGet('activeProfile', null);
  return list.find((p) => p.id === id) || list[0];
}

export function setActiveProfile(id) {
  rawSet('activeProfile', id);
}

export function addProfile(name, color) {
  const list = profiles();
  const p = { id: 'p' + Date.now().toString(36), name: name || 'Perfil ' + (list.length + 1), color: color || randomColor(list.map((x) => x.color)) };
  list.push(p);
  rawSet('profiles', list);
  return p;
}

export function updateProfile(id, patch) {
  const list = profiles().map((p) => (p.id === id ? Object.assign({}, p, patch) : p));
  rawSet('profiles', list);
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
  ['watch', 'settings'].forEach((k) => rawSet(profileKey(id, k), null));
  // Apagou o dono: o próximo perfil passa a usar o histórico da conta.
  if (gone && gone.owner) list[0] = Object.assign({}, list[0], { owner: true });
  rawSet('profiles', list);
  if (rawGet('activeProfile', null) === id) rawSet('activeProfile', list[0].id);
  return true;
}

// Lê/grava dados de um perfil que não é o ativo (ex.: login de outro perfil).
export function getFor(profileId, key, fallback) {
  return rawGet(profileKey(profileId, key), fallback);
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
