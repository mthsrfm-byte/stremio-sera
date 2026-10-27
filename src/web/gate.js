// Tranca do site web: o app só carrega depois da senha. Na página fica só o hash da senha
// (SALT + senha, SHA-256), gerado no build a partir do segredo WEB_PASSWORD (window.SERA_GATE).
// Para deslogar todos os aparelhos: troque AUTH_VERSION (ex.: 'v2').
(function () {
  var AUTH_VERSION = 'v1';
  var KEY = 'sera.web.auth';
  var gate = document.getElementById('gate');
  var form = document.getElementById('gateForm');
  var input = document.getElementById('gateInput');
  var msg = document.getElementById('gateMsg');

  // Abre o app: só então o app.js entra na página (a senha protege também o código de rede).
  function openApp() {
    try { localStorage.setItem(KEY, AUTH_VERSION); } catch (e) { /* navegador sem storage: pede de novo */ }
    if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
    var s = document.createElement('script');
    s.src = 'app.js';
    document.body.appendChild(s);
  }

  function unlocked() {
    try { return localStorage.getItem(KEY) === AUTH_VERSION; } catch (e) { return false; }
  }

  if (unlocked()) return openApp();
  gate.hidden = false;
  input.focus();

  function sha256Hex(text) {
    var bytes = new TextEncoder().encode(text);
    return window.crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.textContent = '';
    if (!window.crypto || !window.crypto.subtle) {
      msg.textContent = 'Este navegador não permite a entrada. Abra o site em https.';
      return;
    }
    sha256Hex(window.SERA_GATE.salt + input.value).then(function (h) {
      if (h === window.SERA_GATE.hash) return openApp();
      msg.textContent = 'Senha errada.';
      input.value = '';
      input.focus();
    });
  });
})();
