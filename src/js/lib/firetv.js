// Fire TV Stick: o app Android (pasta android/) segura as teclas que o WebView não passa para a
// página (Voltar, mídia, Menu) e chama window.__seraKey(código) com o código que o app já entende
// (os da Samsung: Voltar 10009, avançar 417, voltar 412...). Aqui vira um keydown normal.
import { android } from './platform.js';
import { toast } from '../ui.js';
import { t } from './i18n.js';

export function install() {
  window.__seraKey = function (code) {
    let e;
    try {
      e = document.createEvent('Event');
      e.initEvent('keydown', true, true);
    } catch (err) {
      return;
    }
    // Event simples não tem keyCode: o campo vai como propriedade comum, que é o que o app lê.
    e.keyCode = code;
    e.which = code;
    const target = document.activeElement || document.body || document;
    target.dispatchEvent(e);
  };

  // Resposta do "Procurar atualização" (Ajustes). Com versão nova o app Android recarrega sozinho.
  window.__seraUpdate = function (result) {
    if (result === 'none') toast(t('Você já está na versão mais nova'));
    else if (result === 'updated') toast(t('Versão nova baixada, abrindo...'), 5000);
    else toast(t('Não deu para procurar atualização agora'));
  };

  // Tela sempre acesa só enquanto um vídeo toca (fora disso o protetor de tela do Fire TV vale).
  const a = android();
  if (!a || !a.keepScreenOn) return;
  const sync = () => {
    const playing = Array.prototype.some.call(document.querySelectorAll('video'), (v) => !v.paused && !v.ended);
    a.keepScreenOn(playing);
  };
  ['play', 'playing', 'pause', 'ended', 'emptied'].forEach((ev) => document.addEventListener(ev, sync, true));
}
