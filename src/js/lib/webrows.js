// Setas nas fileiras (só no navegador): com o mouse em cima de uma fileira que rola para o lado,
// aparecem setas nas pontas que andam quase uma tela de cartões, como no Netflix. Criadas na
// primeira vez que o mouse passa pela fileira; servem para todas as telas.
import { h } from './dom.js';
import * as nav from './nav.js';

const ICON_L = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
const ICON_R = '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';

let active = null; // fileira com as setas à mostra

function arrowsOf(track) {
  const parent = track.parentNode;
  if (track.__arrows && track.__arrows.left.parentNode === parent) return track.__arrows;
  if (window.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  const mk = (cls, icon, dir) => {
    const a = h('div.row-arrow.' + cls, { html: icon });
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      scrollTrack(track, dir);
    });
    parent.appendChild(a);
    return a;
  };
  track.__arrows = { left: mk('left', ICON_L, -1), right: mk('right', ICON_R, 1) };
  if (!track.__arrowScroll) {
    track.__arrowScroll = true;
    track.addEventListener('scroll', () => paint(track));
  }
  return track.__arrows;
}

function scrollTrack(track, dir) {
  const target = Math.max(0, Math.min(track.scrollWidth - track.clientWidth, track.scrollLeft + dir * track.clientWidth * 0.8));
  try {
    track.scrollTo({ left: target, behavior: 'smooth' });
  } catch (e) {
    track.scrollLeft = target;
  }
  // Depois da animação: carrega os pôsteres que entraram na tela.
  setTimeout(() => {
    paint(track);
    nav.scrolled(track);
  }, 450);
}

// Mostra só a seta do lado que ainda tem cartão escondido, na altura da fileira.
function paint(track) {
  const a = track.__arrows;
  if (!a) return;
  const on = active === track;
  const max = track.scrollWidth - track.clientWidth;
  const top = track.offsetTop + 'px';
  const height = track.offsetHeight + 'px';
  [a.left, a.right].forEach((el) => {
    el.style.top = top;
    el.style.height = height;
  });
  a.left.classList.toggle('on', on && track.scrollLeft > 2);
  a.right.classList.toggle('on', on && track.scrollLeft < max - 2);
}

function onOver(e) {
  const el = e.target;
  const arrow = el.closest && el.closest('.row-arrow');
  if (arrow) return; // em cima da seta: a fileira continua ativa
  const track = el.closest ? el.closest('[data-scroll-x]') : null;
  if (track === active) return;
  const prev = active;
  active = track && track.scrollWidth > track.clientWidth + 2 ? track : null;
  if (prev) paint(prev);
  if (active) {
    arrowsOf(active);
    paint(active);
  }
}

export function install() {
  document.addEventListener('mouseover', onOver);
}
