// Protetor de tela: depois de alguns minutos sem mexer no controle, os lançamentos mais vistos
// passam pela tela (fundo em movimento lento, logo, posição no ranking do dia e relógio). Qualquer botão
// volta exatamente de onde parou (a tecla não chega ao app).
import { h, clear } from './dom.js';
import * as store from './store.js';
import { t } from './i18n.js';
import * as hero from '../api/hero.js';

const SLIDE_MS = 10000;
const HINT_MS = 6000;
const ITEMS_TTL = 3600000;
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
// Para onde a câmera anda em cada slide (escala final, deslocamento em px).
const MOVES = [
  [1.14, -50, -20],
  [1.12, 50, -24],
  [1.15, -30, 24],
  [1.12, 40, 20],
];

let idleTimer = null;
let el = null;
let items = [];
let itemsAt = 0;
let idx = 0;
let slideTimer = null;
let clockTimer = null;
let front = null;
let back = null;
let parts = null;
// Imagens já baixadas (fundo e logo): url -> true (ok), false (falhou) ou a Promise do download.
// O slide só entra com elas prontas, para o logo aparecer direto, sem o nome escrito antes do PNG.
const loaded = {};

export const OPTIONS = [0, 2, 5, 10, 20]; // minutos (0 = desligado)

export function minutes() {
  const v = store.settings().screensaver;
  return typeof v === 'number' ? v : 5;
}

export function install() {
  // Na captura da window: corre antes da navegação do app e engole a tecla que acorda a tela.
  window.addEventListener(
    'keydown',
    (e) => {
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        stop();
        return;
      }
      arm();
    },
    true
  );
  let lastMove = 0;
  document.addEventListener('mousemove', () => {
    const now = Date.now();
    if (now - lastMove < 1000) return;
    lastMove = now;
    if (el) stop();
    else arm();
  });
  // O vídeo voltou a tocar (fim do carregamento, play pelo celular): o protetor sai na hora.
  document.addEventListener(
    'playing',
    (e) => {
      if (el && e.target && e.target.tagName === 'VIDEO' && isMain(e.target)) stop();
      else arm();
    },
    true
  );
  arm();
}

export function arm() {
  clearTimeout(idleTimer);
  const m = minutes();
  if (m > 0) idleTimer = setTimeout(maybeStart, m * 60000);
}

// Vídeo tocando não é tela parada. Conta também o vídeo carregando no meio (readyState baixo,
// travado esperando a rede): antes o protetor entrava justo aí, por cima do filme.
function busy() {
  if (document.hidden) return true;
  const vids = document.getElementsByTagName('video');
  for (let i = 0; i < vids.length; i++) if (isMain(vids[i]) && !vids[i].paused && !vids[i].ended) return true;
  return false;
}

// O vídeo do player (não as prévias pequenas dos cartões).
function isMain(v) {
  return !!(v.currentSrc || v.getAttribute('src')) && v.offsetWidth > 400;
}

function maybeStart() {
  if (busy()) return arm();
  start();
}

function loadItems() {
  if (items.length && Date.now() - itemsAt < ITEMS_TTL) return Promise.resolve(items);
  return hero
    .saverItems()
    .then((list) => {
      const counts = {};
      items = list
        .filter((x) => x && x.background)
        .map((x) => {
          counts[x.type] = (counts[x.type] || 0) + 1;
          return Object.assign({ rank: counts[x.type] }, x);
        });
      itemsAt = Date.now();
      return items;
    })
    .catch(() => items);
}

export function start() {
  if (el) return;
  loadItems().then((list) => {
    if (el || !list.length) return arm();
    if (busy()) return arm();
    build();
    idx = Math.floor(Math.random() * list.length);
    tick();
    show(true);
  });
}

export function stop() {
  if (!el) return;
  clearTimeout(slideTimer);
  clearInterval(clockTimer);
  const old = el;
  el = null;
  old.classList.remove('on');
  setTimeout(() => old.parentNode && old.parentNode.removeChild(old), 450);
  arm();
}

function build() {
  front = h('div.sv-img');
  back = h('div.sv-img');
  parts = {
    time: h('div.sv-time'),
    date: h('div.sv-date'),
    rankTxt: h('div.sv-rank-txt'),
    logoBox: h('div.sv-logo-box'),
    meta: h('div.sv-meta'),
    desc: h('div.sv-desc'),
    info: h('div.sv-info'),
    bars: h('div.sv-bars'),
    nextImg: h('div.sv-next-img'),
    nextName: h('div.sv-next-name'),
  };
  const p = parts;
  clear(p.info);
  p.info.appendChild(p.logoBox);
  p.info.appendChild(p.rankTxt);
  p.info.appendChild(p.meta);
  p.info.appendChild(p.desc);
  items.slice(0, 16).forEach(() => p.bars.appendChild(h('div.sv-bar', null, h('i'))));
  el = h('div.saver', null, [
    h('div.sv-bg', null, [back, front]),
    h('div.sv-shade'),
    h('div.sv-clock', null, [p.time, p.date]),
    p.info,
    h('div.sv-next', null, [p.nextImg, h('div', null, [h('small', { text: t('A seguir') }), p.nextName])]),
    p.bars,
    h('div.sv-hint', { text: t('Aperte qualquer botão para voltar') }),
  ]);
  document.getElementById('app').appendChild(el);
  clock();
  clockTimer = setInterval(clock, 15000);
  setTimeout(() => el && el.classList.add('hint-off'), HINT_MS);
}

function show(first) {
  // Força o estilo inicial antes de ligar a transição (Chromium antigo junta as duas mudanças).
  void el.offsetWidth;
  if (first) el.classList.add('on');
}

function clock() {
  const d = new Date();
  parts.time.textContent = d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  parts.date.textContent = DAYS[d.getDay()] + ', ' + d.getDate() + ' de ' + MONTHS[d.getMonth()];
}

function setTransform(node, v) {
  node.style.webkitTransform = v;
  node.style.transform = v;
}

function preload(url) {
  if (!url) return Promise.resolve(false);
  const c = loaded[url];
  if (c === true) return Promise.resolve(true);
  if (c && c.then) return c;
  const pr = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      loaded[url] = !!img.naturalWidth;
      resolve(loaded[url]);
    };
    img.onerror = () => {
      loaded[url] = false;
      resolve(false);
    };
    img.src = url;
  });
  loaded[url] = pr;
  return pr;
}

function tick() {
  if (!el) return;
  const it = items[idx % items.length];
  let done = false;
  const go = () => {
    if (done || !el) return;
    done = true;
    slide(it, loaded[it.background] === false ? '' : it.background);
  };
  Promise.all([preload(it.background), preload(it.logo)]).then(go);
  setTimeout(go, 4000);
}

function slide(it, bg) {
  const p = parts;
  // Fundo: a camada de trás recebe a imagem nova, começa parada e vai andando; depois troca de lugar.
  const layer = back;
  back = front;
  front = layer;
  const mv = MOVES[idx % MOVES.length];
  layer.style.webkitTransition = 'none';
  layer.style.transition = 'none';
  setTransform(layer, 'scale(1.02) translate(0px, 0px)');
  layer.style.backgroundImage = bg ? 'url("' + bg + '")' : 'none';
  void layer.offsetWidth;
  layer.style.webkitTransition = 'opacity 1.6s ease, -webkit-transform ' + (SLIDE_MS + 2500) + 'ms linear';
  layer.style.transition = 'opacity 1.6s ease, transform ' + (SLIDE_MS + 2500) + 'ms linear';
  layer.classList.add('front');
  back.classList.remove('front');
  setTransform(layer, 'scale(' + mv[0] + ') translate(' + mv[1] + 'px, ' + mv[2] + 'px)');

  // O próximo é guardado agora: o texto entra 600 ms depois, quando o idx já andou (antes mostrava
  // o item depois do próximo).
  const upNext = items[(idx + 1) % items.length];

  // Texto: sai, troca e entra de novo.
  p.info.classList.remove('in');
  setTimeout(() => {
    if (!el) return;
    p.rankTxt.textContent = t(it.type === 'series' ? '#{n} em séries hoje' : '#{n} em filmes hoje', { n: it.rank });
    clear(p.logoBox);
    const name = h('div.sv-title', { text: it.name || '' });
    p.logoBox.appendChild(name);
    // O nome escrito só aparece se o título não tem logo ou o PNG falhou.
    if (it.logo && loaded[it.logo] !== false) {
      name.style.display = 'none';
      const lg = h('img.sv-logo', { alt: '' });
      if (loaded[it.logo] === true) lg.classList.add('ready');
      lg.onload = () => lg.classList.add('ready');
      lg.onerror = () => {
        if (lg.parentNode) lg.parentNode.removeChild(lg);
        name.style.display = '';
      };
      lg.src = it.logo;
      p.logoBox.insertBefore(lg, name);
    }
    clear(p.meta);
    const bits = [];
    if (it.rating) bits.push(h('span.sv-imdb', null, [h('b', { text: 'IMDb' }), String(it.rating)]));
    const year = String(it.year || '').slice(0, 4);
    if (year) bits.push(h('span', { text: year }));
    const genres = (it.genres || []).slice(0, 3).join(' · ');
    if (genres) bits.push(h('span', { text: genres }));
    if (year && parseInt(year, 10) >= new Date().getFullYear() - 1) bits.unshift(h('span.sv-new', { text: t('Lançamento') }));
    bits.forEach((b) => p.meta.appendChild(b));
    p.desc.textContent = it.description || '';
    void p.info.offsetWidth;
    p.info.classList.add('in');

    p.nextImg.style.backgroundImage = upNext.background ? 'url("' + upNext.background + '")' : 'none';
    p.nextName.textContent = upNext.name || '';
  }, 600);

  // Barras estilo stories: as anteriores cheias, a atual enchendo.
  const bars = p.bars.children;
  const cur = idx % items.length;
  for (let i = 0; i < bars.length; i++) {
    const fill = bars[i].firstChild;
    fill.style.webkitTransition = 'none';
    fill.style.transition = 'none';
    fill.style.width = i < cur ? '100%' : '0%';
  }
  if (bars[cur]) {
    const fill = bars[cur].firstChild;
    void fill.offsetWidth;
    fill.style.webkitTransition = 'width ' + SLIDE_MS + 'ms linear';
    fill.style.transition = 'width ' + SLIDE_MS + 'ms linear';
    fill.style.width = '100%';
  }

  idx = (idx + 1) % items.length;
  // Já baixa o fundo e o logo do próximo enquanto este está na tela.
  const nx = items[idx];
  preload(nx.background);
  preload(nx.logo);
  clearTimeout(slideTimer);
  slideTimer = setTimeout(tick, SLIDE_MS);
}
