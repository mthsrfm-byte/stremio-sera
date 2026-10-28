// Palco do layout (feito para TV, 1920×1080), escalado para caber na tela, mantendo a proporção.
// Em tela deitada mais alta que 16:9 (notebook), a altura do palco acompanha a tela. Em tela em pé
// (celular, tablet), o palco fica mais estreito (640px lógicos no celular, 960px no tablet) e a
// altura acompanha a tela: assim o texto não sai minúsculo. Carrega antes da tranca, então a tela
// de senha já sai no tamanho certo.
(function () {
  var root = document.documentElement;

  function fit() {
    var stage = document.getElementById('app');
    var w = window.innerWidth;
    var h = window.innerHeight;
    var portrait = h > w;
    var lw = 1920;
    var lh = 1080;
    if (portrait) {
      lw = w < 700 ? 640 : 960;
      lh = Math.round(h * lw / w);
    } else {
      // Tela deitada mais alta que 16:9 (notebook 16:10, como o MacBook): o palco ganha altura em
      // vez de faixas pretas em cima e embaixo. Mais larga que 16:9 continua com faixas nos lados.
      lh = Math.min(1440, Math.max(1080, Math.round(h * lw / w)));
    }
    var s = Math.min(w / lw, h / lh);
    var x = (w - lw * s) / 2;
    var y = (h - lh * s) / 2;
    stage.style.width = lw + 'px';
    stage.style.height = lh + 'px';
    stage.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + s + ')';
    root.className = (root.className || '').replace(/\s*\bstage-(portrait|landscape)\b/g, '') + (portrait ? ' stage-portrait' : ' stage-landscape');
  }

  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
})();
