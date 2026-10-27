// PIN da aba NSFW no estilo teclado de banco: 5 botões com dois números cada ("3 ou 9"),
// embaralhados a cada abertura. Quem olha a tela não sabe qual dos dois foi escolhido.
// As teclas numéricas do controle também valem (não mostram nada na tela).
import { h, clear } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import { KEY } from '../lib/nav.js';
import * as store from '../lib/store.js';
import { t } from '../lib/i18n.js';
import * as router from '../router.js';

export const DEFAULT_PIN = '7789';
const MAX_TRIES = 3;
const LOCK_MS = 60000;

let unlocked = false; // vale até fechar o app
let failures = 0;
let lockedUntil = 0;

// App foi para segundo plano (botão Home, outro app): tranca de novo.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  unlocked = false;
  // Quem voltar ao app não cai direto na aba.
  const v = router.currentView();
  if (v && v.el.classList.contains('nsfw-view')) router.goTab('home');
  else if (router.tabView('nsfw')) router.dropTab('nsfw');
});

export function pin() {
  const p = store.settings().nsfwPin;
  return /^\d{4,8}$/.test(p || '') ? p : DEFAULT_PIN;
}

export function isUnlocked() {
  return unlocked;
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
  askPin(t('Aba protegida'), (ok) => {
    if (!ok) return;
    unlocked = true;
    onOk();
  });
}

// onDone(true) com o PIN certo; fechar pelo Voltar não chama nada.
export function askPin(title, onDone) {
  const dots = h('div.pin-dots');
  const msg = h('div.pin-msg');
  const pad = h('div.pin-pad', { 'data-group': '' });
  const box = h('div.modal-box.center.pin-box', null, [h('h3', { text: title }), dots, pad, msg]);
  const modal = h('div.modal', null, box);
  const want = pin();
  let entered = []; // cada toque: lista de dígitos possíveis

  function renderDots() {
    clear(dots);
    for (let i = 0; i < want.length; i++) dots.appendChild(h('i', { cls: i < entered.length ? 'on' : '' }));
  }

  function renderPad() {
    clear(pad);
    const digits = shuffle(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    for (let i = 0; i < 10; i += 2) {
      const pair = [digits[i], digits[i + 1]];
      pad.appendChild(h('div.btn.pin-key', { focusable: true, text: pair[0] + ' ' + t('ou') + ' ' + pair[1], onSelect: () => press(pair) }));
    }
    pad.appendChild(h('div.btn.pin-key', { focusable: true, text: '⌫', onSelect: () => erase() }));
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
    onBack: () => close(),
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
