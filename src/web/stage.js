// Palco de 1920×1080 (o layout é de TV): escala o palco inteiro para caber na tela, mantendo a
// proporção e centralizado. Carrega antes da tranca, então a tela de senha já sai no tamanho certo.
(function () {
  function fit() {
    var stage = document.getElementById('app');
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    var x = (window.innerWidth - 1920 * s) / 2;
    var y = (window.innerHeight - 1080 * s) / 2;
    stage.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + s + ')';
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
})();
