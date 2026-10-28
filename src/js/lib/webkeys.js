import { nativeCommand } from './mac-player.js';
// Atalhos só da versão web (teclado e mouse), que não existem na TV: F ou duplo clique no vídeo
// entram e saem da tela cheia do navegador.
function isFull() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

export function toggleFullscreen() {
  if (__KAI_MAC__) return nativeCommand('fullscreen');
  try {
    if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const el = document.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    }
  } catch (e) {
    /* navegador sem tela cheia: segue normal */
  }
}

export function install() {
  document.addEventListener('keydown', (e) => {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.keyCode === 70) { // F
      e.preventDefault();
      toggleFullscreen();
    }
  });
  document.addEventListener('dblclick', (e) => {
    if (e.target && e.target.tagName === 'VIDEO') toggleFullscreen();
  });
}
