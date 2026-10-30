// Perfis: tela "Quem está assistindo?", avatar e troca de perfil.
// Todos os perfis usam a mesma conta Stremio (addons, biblioteca); cada um tem o seu histórico
// (o que assistiu e onde parou) e as suas preferências.
import { LOGO_HTML } from '../lib/logo.js';
import { h } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import * as store from '../lib/store.js';
import * as stremio from '../api/stremio.js';
import { t } from '../lib/i18n.js';
import { menu, confirmDialog, toast } from '../ui.js';

const SESSION_PICKED = 'kai.profilePicked';
const SESSION_NEW = 'kai.newProfile';

function session(key, value) {
  try {
    if (value === undefined) return window.sessionStorage.getItem(key);
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch (e) {
    /* ignore */
  }
  return null;
}

// ---------- Avatar: degradê da cor do perfil com grão de filme por cima ----------
// Grão: ruído do SVG (feTurbulence) em cinza, bem transparente. Vai como imagem de fundo (o
// Chromium antigo das TVs não tem mix-blend-mode), repetida em ladrilhos de 140px.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23g)' opacity='.32'/%3E%3C/svg%3E\")";

function hexToHsl(hex) {
  const n = parseInt(String(hex || '#7b5bf5').replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  return { h: hue, s: sat * 100, l: l * 100 };
}

function hsl(c, dh, ds, dl) {
  const clamp = (v) => Math.max(0, Math.min(100, v));
  return 'hsl(' + Math.round((c.h + dh + 360) % 360) + ',' + Math.round(clamp(c.s + ds)) + '%,' + Math.round(clamp(c.l + dl)) + '%)';
}

// Fundo do avatar: a cor puxada para um tom vizinho mais claro no alto e mais fundo embaixo,
// um brilho suave no canto e o grão.
export function avatarStyle(color) {
  const c = hexToHsl(color);
  const top = hsl(c, -16, 6, 12);
  const bottom = hsl(c, 24, 4, -20);
  return {
    backgroundColor: color,
    backgroundImage: GRAIN + ', radial-gradient(circle at 28% 18%, rgba(255,255,255,0.32), rgba(255,255,255,0) 58%), linear-gradient(150deg, ' + top + ', ' + bottom + ')',
    backgroundSize: '140px 140px, 100% 100%, 100% 100%',
  };
}

export function avatar(p, cls) {
  // Primeiro caractere inteiro (um emoji ocupa dois "caracteres" no JavaScript).
  const initial = (String(p.name || '').trim().match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/) || ['?'])[0].toUpperCase();
  return h('div.avatar', { cls: cls || '', style: avatarStyle(p.color || store.COLORS[0]), text: initial });
}

// Escolher a cor: cada opção mostra a bolinha com o degradê. Depois disso a cor não é mais sorteada.
export function chooseColor(p, after) {
  menu(
    t('Cor do perfil'),
    store.PALETTE.map((x) => ({
      label: [h('div.avatar.swatch', { style: avatarStyle(x.color), text: ' ' }), t(x.name)],
      value: x.color,
      checked: x.color === p.color,
    })),
    {
      onPick: (c) => {
        store.setProfileColor(p.id, c);
        if (after) after();
      },
    }
  );
}

// Renomear, trocar a cor ou apagar um perfil (na tela de perfis e em Ajustes).
// after(kind) roda depois da mudança: 'name', 'color' ou 'removed'.
export function editProfile(p, after) {
  const opts = [
    { label: t('Renomear'), sub: p.name, value: 'name' },
    { label: t('Mudar a cor'), sub: t('Hoje: {cor}', { cor: t((store.PALETTE.filter((x) => x.color === p.color)[0] || { name: 'Personalizada' }).name) }), value: 'color' },
  ];
  if (store.profiles().length > 1) opts.push({ label: t('Apagar perfil'), sub: t('Apaga o histórico e as preferências dele neste aparelho'), value: 'remove' });
  menu(p.name, opts, {
    onPick: (v) => {
      if (v === 'name') {
        askProfileName(t('Novo nome'), p.name, t('Salvar'), (name) => {
          store.updateProfile(p.id, { name: name });
          if (after) after('name');
        });
      } else if (v === 'color') {
        chooseColor(p, () => after && after('color'));
      } else if (v === 'remove') {
        confirmDialog(t('Apagar o perfil "{name}"? O histórico dele some deste aparelho.', { name: p.name }), t('Apagar'), () => {
          store.removeProfile(p.id);
          toast(t('Perfil apagado'));
          if (after) after('removed');
        });
      }
    },
  });
}

// Troca de perfil recarregando o app: histórico e preferências do outro perfil entram limpos.
export function switchProfile(id) {
  stremio.flush(); // o histórico de quem estava assistindo não pode ficar para trás
  store.setActiveProfile(id);
  session(SESSION_PICKED, '1');
  window.location.reload();
}

// Pede o nome do perfil num modal (no TV o teclado virtual abre ao confirmar no campo).
export function askProfileName(title, initial, okLabel, onOk, onCancel) {
  const err = h('div.modal-text.err-text');
  const input = h('input.input', { type: 'text', value: initial || '', placeholder: t('Ex.: Ana, Pedro, Sala'), maxlength: '20', focusable: true, 'data-autofocus': '' });
  const submit = () => {
    const name = String(input.value || '').trim();
    if (!name) {
      err.textContent = t('Digite um nome para o perfil.');
      nav.focus(input);
      return;
    }
    const dup = store.profiles().some((p) => p.name.toLowerCase() === name.toLowerCase() && p.name !== initial);
    if (dup) {
      err.textContent = t('Já existe um perfil com esse nome.');
      nav.focus(input);
      return;
    }
    close();
    onOk(name);
  };
  input.__submit = submit;
  const box = h('div.modal-box.center', null, [
    h('h3', { text: title }),
    h('div.modal-text', null, input),
    err,
    h('div.modal-actions', { 'data-group': '' }, [
      h('div.btn.primary', { focusable: true, text: okLabel || t('Continuar'), onSelect: submit }),
      h('div.btn', { focusable: true, text: t('Cancelar'), onSelect: () => (close(), onCancel && onCancel()) }),
    ]),
  ]);
  const modal = h('div.modal', null, box);
  document.getElementById('app').appendChild(modal);
  const layer = nav.pushLayer(modal, { onBack: () => (close(), onCancel && onCancel()) });
  nav.focusFirst(modal);
  function close() {
    nav.popLayer(layer);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
  }
}

// Novo perfil: primeiro o nome (não existe nome padrão), depois o app troca para ele. A conta é a
// mesma dos outros perfis; a cor vem sorteada (dá para trocar depois).
export function canAddProfile() {
  return store.profiles().length < store.MAX_PROFILES;
}

export function createProfile() {
  if (!canAddProfile()) return toast(t('Já tem {n} perfis: apague um para criar outro', { n: store.MAX_PROFILES }));
  askProfileName(t('Nome do novo perfil'), '', t('Criar perfil'), (name) => {
    const p = store.addProfile(name);
    session(SESSION_NEW, p.id);
    switchProfile(p.id);
  });
}

// Perfil recém-criado ainda sem conta: o app abre o login logo na entrada.
export function isNewProfilePendingLogin() {
  return session(SESSION_NEW) === store.activeProfile().id;
}

export function clearNewProfileFlag() {
  session(SESSION_NEW, null);
}

export function needsPicker() {
  return store.profiles().length > 1 && store.settings().askProfile && !session(SESSION_PICKED);
}

// Tela de escolha mostrada antes de o app carregar a conta. "Gerenciar perfis" troca para o modo de
// edição: escolher um perfil abre renomear / cor / apagar, sem precisar entrar nele.
export function showPicker(onPicked) {
  let managing = false;
  const row = h('div.profile-row', { 'data-group': '' });
  const title = h('h1');
  const manageBtn = h('div.btn.profile-manage', { focusable: true, onSelect: () => toggleManage() });
  const hint = h('p.profile-hint');
  const el = h('div.view.profile-picker', null, [h('div.boot-logo', { html: LOGO_HTML }), title, row, manageBtn, hint]);
  document.getElementById('app').appendChild(el);
  const layer = nav.pushLayer(el, { onBack: () => (managing ? toggleManage() : pick(store.activeProfile().id)) });
  render();

  function render(focusId) {
    const list = store.profiles();
    const active = store.activeProfile();
    const target = focusId || active.id;
    el.classList.toggle('managing', managing);
    title.textContent = managing ? t('Gerenciar perfis') : t('Quem está assistindo?');
    manageBtn.textContent = managing ? t('Pronto') : t('Gerenciar perfis');
    hint.textContent = managing ? t('Escolha um perfil para mudar o nome, a cor ou apagar.') : t('Todos usam a mesma conta Stremio; cada perfil tem o seu histórico.');
    while (row.firstChild) row.removeChild(row.firstChild);
    list.forEach((p) =>
      row.appendChild(
        h('div.profile-card', { focusable: true, 'data-pid': p.id, onSelect: () => (managing ? edit(p) : pick(p.id)) }, [
          h('div.profile-face', null, [avatar(p, 'big'), managing ? h('div.profile-edit', { html: PENCIL }) : null]),
          h('div.profile-name', { text: p.name }),
        ])
      )
    );
    if (!managing && canAddProfile()) {
      row.appendChild(
        h('div.profile-card', { focusable: true, onSelect: () => createProfile() }, [
          h('div.profile-face', null, h('div.avatar.big.add', { text: '+' })),
          h('div.profile-name', { text: t('Adicionar perfil') }),
        ])
      );
    }
    const card = row.querySelector('[data-pid="' + target + '"]') || row.firstChild;
    if (card) nav.focus(card);
  }

  function toggleManage() {
    managing = !managing;
    render();
  }

  function edit(p) {
    editProfile(p, () => render(store.profiles().some((x) => x.id === p.id) ? p.id : null));
  }

  function pick(id) {
    store.setActiveProfile(id);
    session(SESSION_PICKED, '1');
    nav.popLayer(layer);
    if (el.parentNode) el.parentNode.removeChild(el);
    onPicked();
  }
}

const PENCIL =
  '<svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
