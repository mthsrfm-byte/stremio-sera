// Componentes compartilhados: toast, menus modais, barra superior, cartões.
import { LOGO_HTML } from './lib/logo.js';
import { h, clear, loadVisibleImages } from './lib/dom.js';
import * as nav from './lib/nav.js';
import { smallPoster, smallBackground } from './lib/img.js';
import * as store from './lib/store.js';
import { avatar, switchProfile, createProfile } from './views/profiles.js';
import { t } from './lib/i18n.js';
import { IS_WEB } from './lib/platform.js';
import * as addons from './api/addons.js';
import { requirePin } from './views/pin.js';
import * as calendar from './api/calendar.js';
import * as stremio from './api/stremio.js';
import * as nsfwSaved from './lib/nsfwSaved.js';

let toastTimer = null;
export function toast(msg, ms) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms || 3500);
}

// Menu de opções (lista) num modal. options: [{ label, sub, checked, value, onSelect }]
export function menu(title, options, opts) {
  const o = opts || {};
  const list = h('div.modal-list', { 'data-scroll-y': '', 'data-pad-y': '80' });
  options.forEach((opt) => {
    list.appendChild(
      h(
        'div.opt',
        {
          focusable: true,
          cls: opt.checked ? 'checked' : '',
          'data-autofocus': opt.checked ? '' : null,
          onSelect: () => {
            close();
            if (opt.onSelect) opt.onSelect(opt.value);
            if (o.onPick) o.onPick(opt.value, opt);
          },
        },
        [opt.label, opt.sub ? h('small', { text: opt.sub }) : null]
      )
    );
  });
  if (!options.length) list.appendChild(h('div.modal-text', { text: o.empty || t('Nada por aqui.') }));
  const box = h('div.modal-box', { cls: o.center ? 'center' : '' }, [h('h3', { text: title }), list]);
  const modal = h('div.modal', null, box);
  document.getElementById('app').appendChild(modal);
  const layer = nav.pushLayer(modal, {
    onBack: () => close(),
    onKey: o.onKey,
  });
  nav.focusFirst(modal);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    nav.popLayer(layer);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
    if (o.onClose) o.onClose();
  }
  return { close: close, el: modal };
}

// Pergunta curta com botões lado a lado (o primeiro já vem focado).
// buttons: [{ label, onSelect, primary }]
export function choiceDialog(title, sub, buttons) {
  const close = () => {
    nav.popLayer(layer);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
  };
  const btns = buttons.map((b) => h('div.btn', { focusable: true, cls: b.primary ? 'primary' : '', html: b.label, onSelect: () => (close(), b.onSelect && b.onSelect()) }));
  const box = h('div.modal-box.center.choice-box', null, [
    h('h3', { text: title }),
    sub ? h('p.modal-text', { text: sub }) : null,
    h('div.modal-actions', { 'data-group': '' }, btns),
  ]);
  const modal = h('div.modal', null, box);
  document.getElementById('app').appendChild(modal);
  const layer = nav.pushLayer(modal, { onBack: () => close() });
  nav.focus(btns[0]);
}

export function confirmDialog(text, okLabel, onOk) {
  const box = h('div.modal-box.center', null, [
    h('h3', { text: text }),
    h('div.modal-actions', null, [
      h('div.btn.primary', { focusable: true, 'data-autofocus': '', text: okLabel || 'OK', onSelect: () => (close(), onOk && onOk()) }),
      h('div.btn', { focusable: true, text: t('Cancelar'), onSelect: () => close() }),
    ]),
  ]);
  const modal = h('div.modal', null, box);
  document.getElementById('app').appendChild(modal);
  const layer = nav.pushLayer(modal, { onBack: () => close() });
  nav.focusFirst(modal);
  function close() {
    nav.popLayer(layer);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
  }
}

// Ícones da barra (traço em currentColor, desenhados à mão: a fonte da TV não tem símbolos).
const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h4.5v-6h4v6h4.5V9"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>',
  // Engrenagem no estilo do Feather Icons (licença MIT).
  settings:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

// Barra superior: à esquerda casinha, lupa e as abas; à direita engrenagem, perfil e relógio.
export const TABS = [
  { id: 'home', label: 'Início', icon: 'home' },
  { id: 'search', label: 'Buscar', icon: 'search' },
  { id: 'recommended', label: 'Favoritos' },
  { id: 'library', label: 'Biblioteca' },
  { id: 'streamings', label: 'Streamings' },
  // NSFW: só o cadeado, à esquerda da engrenagem.
  { id: 'nsfw', label: 'NSFW', icon: 'lock', right: true, when: () => addons.nsfwEnabled() },
  { id: 'settings', label: 'Ajustes', icon: 'settings', right: true },
];

function tabEl(tab, activeId, onTab) {
  return h('div.tab', {
    focusable: true,
    'data-tab': tab.id,
    title: t(tab.label),
    cls: (tab.id === activeId ? 'active' : '') + (tab.icon ? ' icon' : '') + (tab.id === 'nsfw' ? ' tab-nsfw' : ''),
    style: tab.when && !tab.when() ? { display: 'none' } : null,
    html: tab.icon ? ICONS[tab.icon] : null,
    text: tab.icon ? null : t(tab.label),
    onSelect: () => (tab.id === 'nsfw' ? requirePin(() => onTab(tab.id)) : onTab(tab.id)),
  });
}

export function topbar(activeId, onTab) {
  const clock = h('div.clock');
  const tick = () => (clock.textContent = timeHM(new Date()));
  tick();
  const timer = setInterval(tick, 20000);
  const bar = h('div.topbar', { 'data-group': '' }, [
    h('div.brand', { html: LOGO_HTML }),
    TABS.filter((tab) => !tab.right).map((tab) => tabEl(tab, activeId, onTab)),
    h('div.spacer'),
    TABS.filter((tab) => tab.right).map((tab) => tabEl(tab, activeId, onTab)),
    calendarButton(),
    profileButton(onTab),
    clock,
  ]);
  const offCal = calendar.onChange(refreshCalendarButtons);
  bar.__destroy = () => (clearInterval(timer), offCal());
  // Abas condicionais (NSFW) dependem dos addons, que podem chegar depois da barra.
  addons.load().then(refreshTabs).catch(() => {});
  if (!tabsHooked) {
    tabsHooked = true;
    addons.onChange(refreshTabs);
  }
  return bar;
}

let tabsHooked = false;

// Mostra/esconde as abas condicionais em todas as barras (addons mudaram, ajuste trocado).
export function refreshTabs() {
  TABS.filter((tab) => tab.when).forEach((tab) => {
    const show = tab.when();
    Array.prototype.forEach.call(document.querySelectorAll('.topbar .tab[data-tab="' + tab.id + '"]'), (el) => (el.style.display = show ? '' : 'none'));
  });
}

// ---------- Agenda ----------
// Ícone de calendário ao lado do avatar: abre a agenda de hoje e amanhã. Só aparece com um link
// de agenda em Ajustes; o ponto laranja avisa que algum evento começa na próxima hora.
function calendarButton() {
  const btn = h('div.tab.icon.cal-btn', { focusable: true, title: t('Agenda'), html: ICONS.calendar + '<i class="cal-dot"></i>', onSelect: () => agendaPanel() });
  paintCalendarButton(btn);
  return btn;
}

function paintCalendarButton(btn) {
  btn.style.display = calendar.enabled() ? '' : 'none';
  btn.classList.toggle('soon', calendar.startingWithin(60 * 60000).length > 0);
}

function refreshCalendarButtons() {
  Array.prototype.forEach.call(document.querySelectorAll('.topbar .cal-btn'), paintCalendarButton);
}
setInterval(refreshCalendarButtons, 60000);

const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTH = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// "terça, 27 de outubro" (short: "terça, 27 out")
export function dayLabel(d, short) {
  return WEEKDAY[d.getDay()] + ', ' + d.getDate() + (short ? ' ' + MONTH[d.getMonth()].slice(0, 3) : ' de ' + MONTH[d.getMonth()]);
}

// "19:00 – 19:45", "Dia todo"
export function eventTime(e, withEnd) {
  if (e.allDay) return t('Dia todo');
  return timeHM(e.start) + (withEnd && e.end - e.start > 60000 ? ' – ' + timeHM(e.end) : '');
}

// "agora", "em 25 min", "em 2 h" (até 3 h antes); vazio depois disso ou se já passou.
export function eventSoon(e) {
  const now = Date.now();
  if (e.allDay) return '';
  if (e.start.getTime() <= now && e.end.getTime() > now) return t('agora');
  const min = Math.round((e.start.getTime() - now) / 60000);
  if (min <= 0 || min > 180) return '';
  return min < 60 ? t('em {n} min', { n: min }) : t('em {n} h', { n: Math.round(min / 60) });
}

function minutesLabel(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';
}

// Painel da agenda (ícone da barra e cartões da home): HOJE e AMANHÃ separados, com a data.
export function agendaPanel() {
  const d = calendar.days();
  const now = Date.now();
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const list = h('div.agenda-list', { 'data-scroll-y': '', 'data-group': '' });
  const section = (label, date, events, cls) => {
    list.appendChild(h('div.agenda-day', { cls: cls }, [h('span.agenda-tag', { text: label }), h('span', { text: dayLabel(date) })]));
    if (!events.length) list.appendChild(h('div.agenda-empty', { text: t('Nada na agenda.') }));
    let nowShown = cls !== 'today';
    events.forEach((e) => {
      if (!nowShown && !e.allDay && e.start.getTime() > now) {
        nowShown = true;
        list.appendChild(h('div.agenda-now', null, [h('span', { text: t('Agora') + ' ' + timeHM(new Date()) }), h('i')]));
      }
      const soon = eventSoon(e);
      const sub = [e.allDay ? '' : minutesLabel(e.end - e.start), e.location, soon].filter(Boolean).join(' · ');
      list.appendChild(
        h('div.agenda-ev', { focusable: true, cls: (e.end.getTime() <= now ? 'past' : '') + (soon ? ' soon' : ''), onSelect: () => eventDetail(e) }, [
          h('span.agenda-time', { text: eventTime(e) }),
          h('div.agenda-info', null, [h('div.agenda-title', { text: e.title }), sub ? h('div.agenda-sub', { text: sub }) : null]),
          h('i.agenda-color', { style: { background: e.color } }),
        ])
      );
    });
    if (!nowShown) list.appendChild(h('div.agenda-now', null, [h('span', { text: t('Agora') + ' ' + timeHM(new Date()) }), h('i')]));
  };
  section(t('HOJE'), today, d.today, 'today');
  list.appendChild(h('div.agenda-sep'));
  section(t('AMANHÃ'), tomorrow, d.tomorrow, 'tomorrow');
  const updated = calendar.lastUpdate();
  const box = h('div.modal-box.agenda-box', null, [
    h('h3', { text: t('Sua agenda') }),
    h('p.agenda-head', { text: t('Hoje e amanhã') }),
    list,
    h('div.agenda-foot', null, [h('span', { text: updated ? t('Atualizado às {h}', { h: timeHM(new Date(updated)) }) : t('Atualizando...') }), h('span', { text: t(IS_WEB ? 'Esc fecha' : 'Voltar fecha') })]),
  ]);
  const modal = h('div.modal', null, box);
  document.getElementById('app').appendChild(modal);
  const close = () => {
    nav.popLayer(layer);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
  };
  const layer = nav.pushLayer(modal, { onBack: () => close() });
  const first = list.querySelector('.agenda-ev.soon') || list.querySelector('.agenda-ev:not(.past)') || list.querySelector('.agenda-ev');
  if (first) nav.focus(first);
  else {
    const ok = h('div.btn', { focusable: true, text: t('Fechar'), onSelect: () => close() });
    box.appendChild(ok);
    nav.focus(ok);
  }
  calendar.refresh();
}

const ATTEND = { ACCEPTED: 'confirmou', DECLINED: 'recusou', TENTATIVE: 'talvez', DELEGATED: 'delegou' };

// Detalhes de um evento: quando, onde, quem organizou, quem está convidado e a descrição.
export function eventDetail(e) {
  const when = dayLabel(e.start) + ' · ' + eventTime(e, true) + (e.allDay || e.end - e.start <= 60000 ? '' : ' · ' + minutesLabel(e.end - e.start));
  const info = [];
  const row = (label, value) => info.push(h('div.ev-row', null, [h('span.ev-label', { text: label }), h('span.ev-value', { text: value })]));
  if (e.calendar) row(t('Agenda'), e.calendar);
  if (e.location) row(t('Onde'), e.location);
  if (e.organizer) row(t('Organizador'), e.organizer.name);

  const people = (e.attendees || []).map((p) => {
    const answer = ATTEND[p.status] || t('sem resposta');
    return h('div.ev-person', null, [h('span.ev-name', { text: p.name }), h('span.ev-answer', { text: answer })]);
  });

  const scroll = h('div.ev-scroll', { 'data-scroll-y': '' }, [
    h('div.ev-when', { text: when }),
    info.length ? h('div.ev-info', null, info) : null,
    people.length ? h('div.ev-section', null, [h('div.ev-title-sm', { text: t('Convidados') + ' (' + people.length + ')' }), h('div.ev-people', null, people)]) : null,
    e.description ? h('div.ev-section', null, [h('div.ev-title-sm', { text: t('Descrição') }), h('div.ev-desc', { focusable: true, text: e.description })]) : null,
  ]);
  const close = h('div.btn', { focusable: true, text: t('Voltar'), onSelect: () => close_() });
  const box = h('div.modal-box.ev-box', null, [h('h3', { text: e.title }), scroll, close]);
  const modal = h('div.modal', null, box);
  document.getElementById('app').appendChild(modal);
  const close_ = () => {
    nav.popLayer(layer);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
  };
  const layer = nav.pushLayer(modal, { onBack: () => close_() });
  const first = scroll.querySelector('.ev-desc') || close;
  nav.focus(first);
}

// Avatar do perfil ativo na barra superior: troca rápida de perfil.
function profileButton(onTab) {
  const chip = h('div.profile-chip', { focusable: true, onSelect: () => profileMenu(onTab) });
  fillChip(chip);
  return chip;
}

function fillChip(chip) {
  const p = store.activeProfile();
  clear(chip);
  // Só a inicial (no avatar): o nome inteiro fica no menu de perfis.
  chip.appendChild(avatar(p, 'small'));
  chip.title = p.name;
}

// Atualiza o avatar/nome em todas as barras (depois de renomear ou trocar a cor).
export function refreshProfileChips() {
  Array.prototype.forEach.call(document.querySelectorAll('.profile-chip'), fillChip);
}

function profileMenu(onTab) {
  const active = store.activeProfile();
  const opts = store.profiles().map((p) => ({ label: p.name, sub: p.id === active.id ? t('Perfil atual') : t('Trocar para este perfil'), value: p.id, checked: p.id === active.id }));
  opts.push({ label: t('+ Adicionar perfil'), sub: t('Com outra conta Stremio (histórico separado)'), value: '__add' });
  opts.push({ label: t('Gerenciar perfis'), sub: t('Nome, cor, apagar'), value: '__manage' });
  menu(t('Perfis'), opts, {
    onPick: (v) => {
      if (v === '__add') createProfile();
      else if (v === '__manage') onTab('settings');
      else if (v !== active.id) switchProfile(v);
    },
  });
}

export function timeHM(d) {
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const hh = Math.floor(sec / 3600);
  return (hh ? hh + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s).slice(-2);
}

// Cartão de pôster (ou largo, para "continuar assistindo").
// ---------- Favoritos ----------
// Filmes e séries: biblioteca da conta Stremio. Vídeos adultos: só nesta TV (aba NSFW).
// No cartão em foco, a tecla amarela do controle favorita; nos detalhes, o botão Favoritar.
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.5 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>';

export function isFavorite(item) {
  const id = item && (item.id || item._id);
  if (!id) return false;
  return addons.isAdultId(id) ? nsfwSaved.has(id) : stremio.isInLibrary(id);
}

// Liga/desliga o favorito; devolve uma Promise com o estado novo.
export function toggleFavorite(item) {
  const id = item.id || item._id;
  if (addons.isAdultId(id)) {
    const on = nsfwSaved.toggle(Object.assign({}, item, { id: id }));
    toast(on ? t('♥ Favoritado') : t('Tirado dos favoritos'));
    return Promise.resolve(on);
  }
  const on = !stremio.isInLibrary(id);
  return stremio.setInLibrary(Object.assign({}, item, { id: id }), on).then(() => {
    toast(on ? t('♥ Favoritado') : t('Tirado dos favoritos'));
    return on;
  });
}

function paintFavs(id) {
  Array.prototype.forEach.call(document.querySelectorAll('.card'), (c) => {
    if (c.__fav && (c.__fav.id || c.__fav._id) === id) c.classList.toggle('faved', isFavorite(c.__fav));
  });
}

document.addEventListener('keydown', (e) => {
  if (e.keyCode !== KEY_YELLOW) return;
  const cur = nav.current();
  const el = cur && cur.closest && cur.closest('.card');
  if (!el || !el.__fav) return;
  e.preventDefault();
  toggleFavorite(el.__fav).then(() => paintFavs(el.__fav.id || el.__fav._id));
});
const KEY_YELLOW = 405;

// Linha de números de um vídeo adulto (visualizações, aprovação, canal) para o cartão.
export function statsLine(st) {
  if (!st) return null;
  const parts = [];
  if (st.views) parts.push(h('span.cs-views', { html: ICON_EYE + '<b></b>' }));
  if (st.approval) parts.push(h('span.cs-like', { cls: st.approval >= 85 ? 'hot' : '', html: ICON_LIKE + '<b></b>' }));
  if (st.channel) parts.push(h('span.cs-by', { text: st.channel }));
  if (st.views) parts[0].lastChild.textContent = st.views;
  if (st.approval) parts[st.views ? 1 : 0].lastChild.textContent = st.approval + '%';
  return parts.length ? h('div.card-stats', null, parts) : null;
}
const ICON_EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_LIKE = '<svg viewBox="0 0 24 24"><path d="M7 10v11H3V10h4z"/><path d="M7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.1 21H7"/></svg>';

export function card(item, opts) {
  const o = opts || {};
  const wrap = h('div.poster-wrap');
  // Versões pequenas das imagens (o cartão tem 210x315 / 380x214).
  const src = o.wide ? smallBackground(o.image || item.background || item.poster) : smallPoster(item.poster);
  if (src) {
    const im = h('img', { alt: '' });
    im.setAttribute('data-lazy', src);
    im.onerror = () => {
      if (o.dropWithoutImage) return dropCard();
      im.style.display = 'none';
      wrap.classList.add('img-loaded'); // sem imagem: para o esqueleto e mostra o nome
      wrap.appendChild(h('div.ph', { text: item.name || '' }));
    };
    wrap.appendChild(im);
  } else if (!o.dropWithoutImage) {
    wrap.classList.add('img-loaded');
    wrap.appendChild(h('div.ph', { text: item.name || '' }));
  }
  if (o.progress) wrap.appendChild(h('div.progress', null, h('i', { style: { width: Math.round(o.progress * 100) + '%' } })));
  if (o.badge) wrap.appendChild(h('div.badge', { text: o.badge }));
  if (o.corner) wrap.appendChild(h('div.card-corner', { cls: o.corner === '4K' ? 'uhd' : '', text: o.corner }));
  if (o.flag) wrap.appendChild(h('div.card-flag', { text: o.flag }));
  if (o.duration) wrap.appendChild(h('div.card-dur', { text: o.duration }));
  // Coração: cheio quando favoritado; vazio só no cartão em foco (dica da tecla amarela).
  const favItem = o.fav === false ? null : o.favItem || ((item.id || item._id) && item.type ? item : null);
  if (favItem) wrap.appendChild(h('div.card-fav', { html: HEART }));
  const el = h('div.card', { focusable: true, cls: (o.wide ? 'wide' : o.rank ? 'ranked' : '') + (o.rich ? ' rich' : ''), onSelect: o.onSelect, onFocus: o.onFocus }, [
    o.rank ? h('div.rank', { text: String(o.rank) }) : null,
    wrap,
    h('div.name', { text: o.title || item.name || '' }),
    o.stats || null,
  ]);
  if (favItem) {
    el.__fav = favItem;
    if (isFavorite(favItem)) el.classList.add('faved');
  }
  // dropWithoutImage: cartão sem capa sai da fileira e o próximo toma o lugar (foco junto).
  function dropCard() {
    const parent = el.parentNode;
    if (!parent) return;
    if (nav.current() === el) {
      const next = el.nextElementSibling || el.previousElementSibling;
      if (next) nav.focus(next);
    }
    parent.removeChild(el);
    loadVisibleImages(parent);
  }
  if (o.dropWithoutImage && !src) setTimeout(dropCard, 0);
  return el;
}

// Cartões de esqueleto (com brilho) no lugar de uma fileira que ainda está carregando.
export function skeletonCards(n) {
  const list = [];
  for (let i = 0; i < (n || 8); i++) list.push(h('div.card.skeleton', null, [h('div.poster-wrap'), h('div.name-sk')]));
  return list;
}

// Carrega uma fileira tentando de novo se vier vazia ou com erro: na TV a rede às vezes engasga
// com várias fileiras pedindo ao mesmo tempo (antes a fileira simplesmente sumia).
export function retrying(fn) {
  const delays = [1500, 4000];
  const later = (n) => new Promise((ok) => setTimeout(ok, delays[n]));
  const attempt = (n) =>
    fn().then(
      (items) => ((items && items.length) || n >= delays.length ? items || [] : later(n).then(() => attempt(n + 1))),
      (err) => {
        if (n >= delays.length) throw err;
        return later(n).then(() => attempt(n + 1));
      }
    );
  return attempt(0);
}

// Fileira que não carregou: aviso curto e um botão para tentar de novo.
export function rowRetry(onRetry, onFocus) {
  return h('div.row-fail', null, [
    h('span', { text: t('Essa fileira não carregou agora.') }),
    h('div.btn.small', { focusable: true, text: t('Tentar de novo'), onSelect: onRetry, onFocus: onFocus }),
  ]);
}

// Grade do "Ver tudo": centralizada, linhas sempre com o mesmo número de capas (as que sobram
// esperam a próxima página) e a página seguinte carrega sozinha quando o foco chega na última
// linha. Pelo botão "Carregar mais", o foco volta ao primeiro título da última linha de antes.
// opts: { load(page) -> Promise<itens>, key(item), card(item) -> elemento, onEmpty() }
export function pagedGrid(opts) {
  const grid = h('div.grid.paged');
  const more = h('div.btn.reco-more', { focusable: true, text: t('Carregar mais'), onSelect: () => loadMore(true) });
  const moreWrap = h('div.reco-more-wrap.paged-more', null, more);
  const el = h('div.paged-wrap', null, [grid, moreWrap]);
  const GAP = 26;
  const seen = {};
  let page = 0;
  let busy = false;
  let ended = false;
  let cols = 0;
  let buffer = [];
  let count = 0;

  // Quantas capas cabem e quanto sobra de cada lado para centralizar.
  function layout(sample) {
    if (cols) return;
    const width = el.clientWidth || window.innerWidth;
    const cw = sample.offsetWidth || 210;
    cols = Math.max(1, Math.floor((width - 2 * 96 + GAP) / (cw + GAP)));
    const side = Math.floor((width - (cols * (cw + GAP) - GAP)) / 2);
    grid.style.paddingLeft = side + 'px';
    grid.style.paddingRight = Math.max(0, side - GAP) + 'px'; // o último cartão também tem margem à direita
    moreWrap.style.paddingLeft = side + 'px';
  }

  function add(item) {
    const c = opts.card(item);
    const idx = count++;
    const prev = c.__focus;
    c.__focus = (x) => {
      if (prev) prev(x);
      // Chegou na última linha: já busca a próxima página.
      if (!ended && idx >= count - cols) loadMore(false);
    };
    grid.appendChild(c);
    return c;
  }

  // Renderiza só linhas cheias; o resto fica no buffer. No fim do catálogo vai tudo.
  function flush() {
    const pool = buffer;
    buffer = [];
    if (!pool.length) return;
    if (!cols) layout(add(pool.shift()));
    const total = count + pool.length;
    const target = ended ? total : Math.floor(total / cols) * cols;
    const n = Math.max(0, target - count);
    pool.slice(0, n).forEach(add);
    buffer = pool.slice(n);
  }

  function loadMore(byButton) {
    if (busy || ended) return;
    busy = true;
    more.textContent = t('Carregando...');
    const lastRowFirst = count ? grid.children[count - (count % cols || cols)] : null;
    const first = page === 0;
    opts
      .load(++page)
      .then((items) => {
        const fresh = (items || []).filter((it) => {
          const k = opts.key(it);
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        });
        if (!fresh.length) ended = true;
        buffer = buffer.concat(fresh);
        const before = count;
        flush();
        busy = false;
        more.textContent = t('Carregar mais');
        moreWrap.style.display = ended ? 'none' : '';
        loadVisibleImages(el, 400);
        if (first && !count && opts.onEmpty) opts.onEmpty();
        if (first && grid.firstChild) nav.focus(grid.firstChild);
        else if (byButton && lastRowFirst) nav.focus(lastRowFirst);
        // Página que não fechou nem uma linha nova: busca a próxima já.
        if (!ended && count === before) loadMore(byButton);
      })
      .catch(() => {
        busy = false;
        more.textContent = t('Carregar mais');
        toast(t('Não foi possível carregar'));
      });
  }

  return { el: el, start: () => page === 0 && loadMore(false), started: () => page > 0 };
}

export function spinnerLine(text) {
  return h('div.loading-line', null, [h('div.spinner.small'), text]);
}

export { clear };
