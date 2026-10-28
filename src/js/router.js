// Pilha de telas. Cada tela: { el, layer, onShow, onHide, onBack, destroy }.
import * as nav from './lib/nav.js';
import { platformBack } from './lib/tv.js';
import { IS_WEB } from './lib/platform.js';
import { confirmDialog } from './ui.js';
import { h, loadVisibleImages, unloadImages } from './lib/dom.js';
import { t } from './lib/i18n.js';

const stack = [];
const app = () => document.getElementById('app');
const tabs = {}; // telas principais reutilizadas (início, busca, biblioteca, ajustes)

// Seta de voltar no canto (só no navegador): com mouse, a tela não tem outra saída além do Esc.
// O player tem a dele, junto dos controles.
export const BACK_ICON = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
function addBackButton(view) {
  if (!IS_WEB || view.tabId || view.el.classList.contains('player') || view.el.querySelector('.web-back')) return;
  const btn = h('div.web-back', { title: t('Voltar'), html: BACK_ICON });
  btn.addEventListener('click', () => back());
  view.el.appendChild(btn);
}

// Navegador: cada tela aberta por cima (e uma aba fora do Início) vira uma entrada no histórico.
// Assim o Voltar do navegador, o botão lateral do mouse e o gesto do trackpad voltam uma tela,
// em vez de sair do site. Acerta o histórico depois que a pilha muda (várias trocas viram uma).
let histDepth = 0;
let histSkip = 0;
let histTimer = null;
function wantedDepth() {
  const root = stack[0];
  return Math.max(0, stack.length - 1) + (root && root.tabId && root.tabId !== 'home' ? 1 : 0);
}
function syncHistory() {
  if (!IS_WEB) return;
  clearTimeout(histTimer);
  histTimer = setTimeout(() => {
    const want = wantedDepth();
    while (histDepth < want) window.history.pushState({ sera: ++histDepth }, '');
    if (histDepth > want) {
      histSkip++;
      window.history.go(want - histDepth);
      histDepth = want;
    }
  }, 0);
}
if (IS_WEB) {
  window.addEventListener('popstate', (e) => {
    if (histSkip) {
      histSkip--;
      return;
    }
    histDepth = (e.state && e.state.sera) || 0;
    // O mesmo caminho do Esc: fecha o menu aberto ou volta a tela.
    const layer = nav.topLayer();
    if (layer && layer.onBack) layer.onBack();
    syncHistory();
  });
}

function show(view) {
  view.el.classList.remove('hidden');
  if (stack.length > 1) addBackButton(view);
  if (view.layer) {
    nav.popLayer(view.layer);
  }
  view.layer = nav.pushLayer(view.el, {
    onBack: () => back(),
    onKey: view.onKey,
  });
  // Aba recém-aberta pela barra: foco na própria aba (antes ia para "Início", que parecia a ativa),
  // a não ser que a tela peça outro ponto de partida (data-autofocus, ex.: campo da Busca).
  const activeTab = view.tabId && !view.el.querySelector('[data-autofocus]') && view.el.querySelector('.topbar .tab.active');
  if (view.restoreFocus && document.body.contains(view.restoreFocus)) nav.focus(view.restoreFocus, { noScroll: true });
  else if (activeTab) nav.focus(activeTab, { noScroll: true }); // aba recém-aberta: foco na própria aba
  else nav.focusFirst(view.el);
  if (view.onShow) view.onShow();
  loadVisibleImages(view.el);
}

function hide(view) {
  view.restoreFocus = nav.current();
  if (view.layer) nav.popLayer(view.layer);
  view.layer = null;
  view.el.classList.add('hidden');
  if (view.onHide) view.onHide();
  // Tela fora de vista não segura imagens na memória (a TV tem pouca RAM).
  unloadImages(view.el);
}

export function push(view) {
  const prev = stack[stack.length - 1];
  if (prev) hide(prev);
  if (!view.el.parentNode) app().appendChild(view.el);
  stack.push(view);
  show(view);
  syncHistory();
}

export function pop() {
  if (stack.length <= 1) return false;
  const view = stack.pop();
  hide(view);
  if (!view.keepAlive) {
    if (view.destroy) view.destroy();
    if (view.el.parentNode) view.el.parentNode.removeChild(view.el);
  }
  show(stack[stack.length - 1]);
  syncHistory();
  return true;
}

export function back() {
  const view = stack[stack.length - 1];
  if (view && view.onBack && view.onBack() === true) return;
  if (stack.length > 1) {
    pop();
    return;
  }
  // Voltar numa aba (inclusive a NSFW) leva ao Início com o foco no botão da casinha.
  if (view && view.tabId && view.tabId !== 'home') {
    goTab('home');
    const homeBtn = tabs.home && tabs.home.el.querySelector('.topbar .tab[data-tab="home"]');
    if (homeBtn) nav.focus(homeBtn, { noScroll: true });
    return;
  }
  if (IS_WEB) return; // no navegador não há "sair do app": fechar a aba é com o usuário
  confirmDialog(t('Sair do Stremio Kai?'), t('Sair'), () => platformBack());
}

// Troca de aba principal: limpa a pilha e mostra a aba (mantida viva).
export function goTab(id) {
  while (stack.length > 1) pop();
  const cur = stack[0];
  if (cur && cur.tabId === id) return;
  let view = tabs[id];
  if (!view) {
    view = registry[id]();
    view.tabId = id;
    view.keepAlive = true;
    tabs[id] = view;
  }
  if (cur) {
    hide(cur);
    stack.length = 0;
    // Só a tela inicial fica viva; as outras abas são recriadas ao voltar (economiza memória).
    if (cur.tabId !== 'home') dropTab(cur.tabId);
  }
  if (!view.el.parentNode) app().appendChild(view.el);
  stack.push(view);
  show(view);
  syncHistory();
}

const registry = {};
export function registerTab(id, factory) {
  registry[id] = factory;
}

export function tabView(id) {
  return tabs[id] || null;
}

export function currentView() {
  return stack[stack.length - 1] || null;
}

export function dropTab(id) {
  const v = tabs[id];
  if (!v) return;
  delete tabs[id];
  if (v.destroy) v.destroy();
  if (v.el.parentNode && stack.indexOf(v) < 0) v.el.parentNode.removeChild(v.el);
  if (v.layer) nav.popLayer(v.layer);
}
