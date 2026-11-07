// PIN da aba NSFW no estilo teclado de banco: 5 botões com dois números cada ("3 ou 9"),
// embaralhados a cada abertura. Quem olha a tela não sabe qual dos dois foi escolhido.
// As teclas numéricas do controle também valem (não mostram nada na tela).
import { h, clear } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import { KEY } from '../lib/nav.js';
import * as store from '../lib/store.js';
import { t } from '../lib/i18n.js';
import { IS_WEB } from '../lib/platform.js';
import * as router from '../router.js';

export const DEFAULT_PIN = '7789';
const LOCK_SVG = '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3"/></svg>';
const ERASE_SVG = '<svg viewBox="0 0 24 24"><path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z"/><path d="m12.5 9.5 5 5m0-5-5 5"/></svg>';
const MAX_TRIES = 3;
const LOCK_MS = 60000;

let unlocked = false; // vale até fechar o app
let failures = 0;
let lockedUntil = 0;

// Privacidade: o app foi para segundo plano (TV desligada, botão Home, outro app) com algo da
// área NSFW aberto (a aba, os detalhes ou o player de um vídeo adulto). Sai de tudo na hora, ainda
// escondido: grava onde parou, fecha o vídeo e menus, e vai para o Início. Ao voltar, nada do que
// estava na tela aparece, nem por um instante, e a aba pede o PIN de novo só se for reaberta.
let curtainTimer = null;
function onHidden() {
  unlocked = false;
  document.body.classList.add('privacy-curtain');
  const root = router.rootView();
  if (root && root.tabId === 'nsfw') {
    const cur = router.currentView();
    // Player: o mesmo caminho do Voltar (salva o progresso antes de fechar).
    if (cur && cur.el && cur.el.classList.contains('player') && cur.onBack) {
      try {
        cur.onBack();
      } catch (e) {
        /* segue para o Início de qualquer jeito */
      }
    }
    nav.closeOverlays();
    router.goHome();
  } else nav.closeOverlays((root) => root.classList.contains('pin-screen'));
  if (router.tabView('nsfw')) router.dropTab('nsfw');
}

function onVisible() {
  clearTimeout(curtainTimer);
  // A TV às vezes mostra o último quadro antes de repintar: a cortina sai um pouco depois.
  curtainTimer = setTimeout(() => document.body.classList.remove('privacy-curtain'), 350);
}

document.addEventListener('visibilitychange', () => (document.hidden ? onHidden() : onVisible()));
window.addEventListener('pagehide', onHidden);
document.addEventListener('freeze', onHidden);

export function pin() {
  const p = store.settings().nsfwPin;
  return /^\d{4,8}$/.test(p || '') ? p : DEFAULT_PIN;
}

export function lock() {
  unlocked = false;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const x = a[i];
    a[i] = a[j];
    a[j] = x;
  }
  return a;
}

// Já desbloqueado: segue direto. Senão pede o PIN.
export function requirePin(onOk) {
  if (unlocked) return onOk();
  askPin(t('NSFW'), (ok) => {
    if (!ok) return;
    unlocked = true;
    onOk();
  });
}

// onDone(true) com o PIN certo; onDone(false) ao fechar pelo Voltar.
export function askPin(title, onDone) {
  const dots = h('div.pin-dots');
  const msg = h('div.pin-msg');
  const pad = h('div.pin-pad', { 'data-group': '' });
  const box = h('div.pin-box', null, [
    h('div.pin-lock', { html: LOCK_SVG }),
    h('h2.pin-title', { text: title }),
    h('div.pin-sub', { text: t('Digite a senha para continuar') }),
    dots,
    pad,
    msg,
    h('div.pin-hint', { text: t(IS_WEB ? 'Os números do teclado também funcionam' : 'Os números do controle também funcionam') }),
  ]);
  const modal = h('div.modal.pin-screen', null, box);
  const want = pin();
  let entered = []; // cada toque: lista de dígitos possíveis

  function renderDots() {
    clear(dots);
    for (let i = 0; i < want.length; i++) dots.appendChild(h('i', { cls: i < entered.length ? 'on' : '' }));
  }

  function renderPad() {
    clear(pad);
    // Sempre um botão "8 ou 9" e um "7 ou ?"; o resto, a ordem dos botões e a de cada par mudam sempre.
    const rest = shuffle(['0', '1', '2', '3', '4', '5', '6']);
    const pairs = [['8', '9'], ['7', rest[0]]];
    for (let i = 1; i < 7; i += 2) pairs.push([rest[i], rest[i + 1]]);
    shuffle(pairs).forEach((pair) => {
      shuffle(pair);
      pad.appendChild(h('div.pin-key', { focusable: true, onSelect: () => press(pair) }, [h('b', { text: pair[0] }), h('i'), h('b', { text: pair[1] })]));
    });
    pad.appendChild(h('div.pin-key.erase', { focusable: true, html: ERASE_SVG, onSelect: () => erase() }));
  }

  function erase() {
    entered.pop();
    renderDots();
  }

  function press(options) {
    if (Date.now() < lockedUntil) {
      msg.textContent = t('Muitas tentativas. Espere {s}s.', { s: Math.ceil((lockedUntil - Date.now()) / 1000) });
      return;
    }
    msg.textContent = '';
    entered.push(options);
    renderDots();
    if (entered.length < want.length) return;
    const ok = entered.every((opts, i) => opts.indexOf(want[i]) >= 0);
    entered = [];
    if (ok) {
      failures = 0;
      close();
      onDone(true);
      return;
    }
    failures++;
    if (failures >= MAX_TRIES) {
      failures = 0;
      lockedUntil = Date.now() + LOCK_MS;
      msg.textContent = t('Muitas tentativas. Espere {s}s.', { s: LOCK_MS / 1000 });
    } else msg.textContent = t('PIN incorreto');
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
    // Teclado novo a cada erro: a ordem não ajuda a adivinhar.
    renderPad();
    renderDots();
    nav.focusFirst(pad);
  }

  function close() {
    nav.popLayer(layer);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
  }

  renderDots();
  renderPad();
  document.getElementById('app').appendChild(modal);
  const layer = nav.pushLayer(modal, {
    onBack: () => {
      close();
      onDone(false);
    },
    onKey: (e) => {
      // Teclas 0-9 do controle (e do teclado/numpad no PC).
      const c = e.keyCode;
      const d = c >= 48 && c <= 57 ? c - 48 : c >= 96 && c <= 105 ? c - 96 : -1;
      if (d >= 0) {
        press([String(d)]);
        return true;
      }
      if (c === KEY.BACKSPACE && entered.length) {
        erase();
        return true;
      }
      return false;
    },
  });
  nav.focusFirst(pad);
}
