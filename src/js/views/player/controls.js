// Player (controls): controles do OSD, busca (seek), prévia das miniaturas e teclas.
import { h, clear } from '../../lib/dom.js';
import * as nav from '../../lib/nav.js';
import { KEY } from '../../lib/nav.js';
import * as server from '../../api/server.js';
import { toast, fmtTime, timeHM } from '../../ui.js';
import { t } from '../../lib/i18n.js';
import { IS_WEB } from '../../lib/platform.js';
import { ico } from '../../lib/icons.js';

const HIDE_MS = 5000;

export function createControls(st) {
  let seekRepeats = 0;

  function restart() {
    st.restartBtn.style.display = 'none';
    try {
      st.videoEl.currentTime = 0;
    } catch (e) {
      st.pendingStart = 0;
    }
    if (nav.current() === st.restartBtn) nav.focus(st.playBtn);
  }

  // ---------- Controles ----------
  function togglePlay() {
    if (st.videoEl.paused) st.videoEl.play();
    else st.videoEl.pause();
    showControls();
  }

  function updatePlayBtn() {
    st.playBtn.innerHTML = st.videoEl.paused ? ico('play') + t('Tocar') : ico('pause') + t('Pausar');
  }

  // Só mexe no DOM quando o valor muda (o ticker chama a cada 250 ms). Chamado só com o OSD visível.
  const painted = {};
  function paint(key, val, write) {
    if (painted[key] === val) return;
    painted[key] = val;
    write(val);
  }
  function updateTimes() {
    const d = st.videoEl.duration;
    const pos = st.seekTarget !== null ? st.seekTarget : st.videoEl.currentTime;
    const pct = d > 0 && isFinite(d) ? Math.min(100, (pos / d) * 100) : 0;
    paint('pos', pct, (v) => {
      st.posEl.style.width = v + '%';
      st.knobEl.style.left = v + '%';
      st.seekLabel.style.left = v + '%';
    });
    paint('cur', fmtTime(pos), (v) => (st.curTimeEl.textContent = v));
    paint('dur', isFinite(d) ? fmtTime(d) : '--:--', (v) => (st.durEl.textContent = v));
    try {
      const b = st.videoEl.buffered;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= st.videoEl.currentTime + 1 && b.end(i) >= st.videoEl.currentTime) {
          paint('buf', (d > 0 ? Math.min(100, (b.end(i) / d) * 100) : 0) + '%', (v) => (st.bufEl.style.width = v));
        }
      }
    } catch (e) {
      /* ignore */
    }
    // Relógio + horário de término (player-clock-eta do Kai). Muda só quando o minuto muda.
    const now = new Date();
    const end = d > 0 && isFinite(d) ? new Date(now.getTime() + Math.max(0, d - st.videoEl.currentTime) * 1000) : null;
    paint('clock', timeHM(now) + '|' + (end ? timeHM(end) : ''), () => {
      clear(st.clockEl);
      st.clockEl.appendChild(document.createTextNode(timeHM(now)));
      if (end) st.clockEl.appendChild(h('small', { text: t('Termina às {time}', { time: timeHM(end) }) }));
    });
  }

  function showControls(focusEl) {
    if (!st.controlsOn) {
      st.controlsOn = true;
      st.el.classList.add('controls-on');
      updateTimes();
      updatePlayBtn();
      // Com um painel por cima (sincronia, menus), o foco fica lá.
      const mine = nav.topLayer() && nav.topLayer().root === st.el;
      if (mine && (!nav.current() || !st.overlay.contains(nav.current()))) nav.focus(focusEl || st.bar);
    } else if (focusEl) nav.focus(focusEl);
    scheduleHide();
  }

  function hideControls() {
    st.controlsOn = false;
    st.el.classList.remove('controls-on');
    clearTimeout(st.hideTimer);
  }

  function scheduleHide() {
    clearTimeout(st.hideTimer);
    st.hideTimer = setTimeout(() => {
      if (!st.videoEl.paused && st.seekTarget === null && nav.topLayer() && nav.topLayer().root === st.el) hideControls();
    }, HIDE_MS);
  }

  // Busca acumulada: segurar a seta acelera (10s → 30s → 60s).
  function seekBy(dir) {
    const d = st.videoEl.duration;
    if (!(d > 0) || !isFinite(d)) return;
    if (st.seekTarget === null) {
      st.seekTarget = st.videoEl.currentTime;
      seekRepeats = 0;
      st.seekWasPlaying = !st.videoEl.paused; // pausado antes do seek continua pausado depois dele
    }
    seekRepeats++;
    const step = seekRepeats > 15 ? 60 : seekRepeats > 5 ? 30 : 10;
    st.seekTarget = Math.max(0, Math.min(d - 2, st.seekTarget + dir * step));
    st.bar.classList.add('seeking');
    st.seekLabel.textContent = fmtTime(st.seekTarget);
    showControls(st.bar);
    updateTimes();
    const withPreview = showPreview(st.seekTarget, d);
    clearTimeout(st.seekCommitTimer);
    // Com prévia, espera um pouco mais antes de pular: dá tempo de ver o quadro (o do PC demora mais).
    st.seekCommitTimer = setTimeout(commitSeek, withPreview === 'pc' ? 1800 : withPreview ? 1400 : 700);
  }

  // Prévia ao avançar/voltar: o quadro daquele ponto, das miniaturas da linha do tempo que o
  // addon manda junto com a fonte (stream.thumbs; hoje XVideos e Pornhub). Cada folha é uma
  // imagem em grade; o quadro é recortado com background-position, sem decodificar vídeo.
  const PREVIEW_W = 320;
  const PREVIEW_H = 180;
  function showPreview(time, duration) {
    const th = st.stream && st.stream.thumbs;
    if (!th || !th.urls || !th.urls.length || !(th.every > 0) || !(th.cols > 0) || !(th.rows > 0)) return pcPreview(time, duration);
    st.preview.classList.remove('pc');
    const per = th.cols * th.rows;
    let i = Math.floor(time / th.every);
    let sheet = Math.floor(i / per);
    if (sheet >= th.urls.length) {
      sheet = th.urls.length - 1;
      i = sheet * per + per - 1;
    }
    const cell = i % per;
    const url = th.urls[sheet];
    // Folhas vizinhas já vão baixando (avançar segurando a seta passa por várias).
    [sheet - 1, sheet, sheet + 1].forEach((n) => {
      const u = th.urls[n];
      if (!u || st.sheetCache[u]) return;
      if (st.sheetOrder.length >= 3) delete st.sheetCache[st.sheetOrder.shift()];
      const img = new Image();
      img.src = u;
      st.sheetCache[u] = img;
      st.sheetOrder.push(u);
    });
    st.previewImg.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
    st.previewImg.style.backgroundSize = th.cols * PREVIEW_W + 'px ' + th.rows * PREVIEW_H + 'px';
    st.previewImg.style.backgroundPosition = -(cell % th.cols) * PREVIEW_W + 'px ' + -Math.floor(cell / th.cols) * PREVIEW_H + 'px';
    // Acompanha o ponto na barra sem sair das bordas.
    const w = st.bar.offsetWidth || 1;
    const x = Math.max(PREVIEW_W / 2, Math.min(w - PREVIEW_W / 2, (time / duration) * w));
    st.preview.style.left = x + 'px';
    st.preview.classList.add('on');
    return true;
  }
  let pcWanted = '';
  function pcPreview(time, duration) {
    const src = st.mediaUrl;
    if (!server.isAvailable() || !/^https?:/.test(src) || !(duration > 0)) {
      st.preview.classList.remove('on');
      return false;
    }
    const w = st.bar.offsetWidth || 1;
    st.preview.style.left = Math.max(PREVIEW_W / 2, Math.min(w - PREVIEW_W / 2, (time / duration) * w)) + 'px';
    st.preview.classList.add('on');
    st.preview.classList.add('pc');
    if (!pcWanted) st.previewImg.style.backgroundImage = '';
    clearTimeout(st.pcTimer);
    st.pcTimer = setTimeout(() => {
      // O stremio-service decodifica o "from" duas vezes: vai codificado duas vezes.
      const url = server.baseUrl() + 'thumb.jpg?from=' + encodeURIComponent(encodeURIComponent(src)) + '&at=' + Math.round(time);
      pcWanted = url;
      st.preview.classList.add('loading');
      const img = new Image();
      img.onload = () => {
        if (pcWanted !== url) return;
        st.previewImg.style.backgroundImage = 'url("' + url + '")';
        st.preview.classList.remove('loading');
      };
      img.onerror = () => pcWanted === url && st.preview.classList.remove('loading');
      img.src = url;
    }, 300);
    return 'pc';
  }

  function commitSeek() {
    if (st.seekTarget === null) return;
    try {
      st.videoEl.currentTime = st.seekTarget;
    } catch (e) {
      /* ignore */
    }
    st.seekTarget = null;
    st.bar.classList.remove('seeking');
    st.preview.classList.remove('on');
    clearTimeout(st.pcTimer);
    pcWanted = '';
    if (st.seekWasPlaying && st.videoEl.paused) st.videoEl.play();
    scheduleHide();
  }

  function cancelSeek() {
    clearTimeout(st.seekCommitTimer);
    st.seekTarget = null;
    st.bar.classList.remove('seeking');
    st.preview.classList.remove('on');
    clearTimeout(st.pcTimer);
    pcWanted = '';
    updateTimes();
  }

  // ---------- Teclas ----------
  function onKey(e) {
    const k = e.keyCode;
    const cur = nav.current();
    switch (k) {
      case KEY.PLAY:
        st.videoEl.play();
        showControls();
        return true;
      case KEY.SPACE: // teclado: espaço e K tocam/pausam (como no YouTube)
      case 75:
        togglePlay();
        return true;
      case 77: // M: silencia
        st.videoEl.muted = !st.videoEl.muted;
        return true;
      case KEY.PAUSE:
        st.videoEl.pause();
        return true;
      case KEY.PLAYPAUSE:
        togglePlay();
        return true;
      case KEY.STOP:
        st.api.close();
        return true;
      case KEY.FF:
        seekBy(1);
        return true;
      case KEY.RW:
        seekBy(-1);
        return true;
      case KEY.BACK:
      case KEY.ESC:
      case KEY.BACKSPACE:
        if (st.seekTarget !== null) cancelSeek();
        else if (st.activeSeg && !st.controlsOn) st.api.dismissSkip();
        else if (st.controlsOn && !st.videoEl.paused) hideControls();
        else st.api.close();
        return true;
    }
    if (!st.controlsOn && st.activeSeg) {
      if (k === KEY.ENTER) {
        st.api.doSkip();
        return true;
      }
    }
    if (!st.controlsOn) {
      if (IS_WEB && (k === KEY.UP || k === KEY.DOWN)) {
        // Teclado: seta para cima/baixo mexe no volume (sem abrir a barra).
        st.videoEl.muted = false;
        st.videoEl.volume = Math.max(0, Math.min(1, st.videoEl.volume + (k === KEY.UP ? 0.1 : -0.1)));
        toast(t('Volume {n}%', { n: Math.round(st.videoEl.volume * 100) }), 1200);
        return true;
      }
      if (k === KEY.LEFT) seekBy(-1);
      else if (k === KEY.RIGHT) seekBy(1);
      else if (k === KEY.ENTER) togglePlay();
      else if (k === KEY.DOWN) showControls(st.playBtn);
      else showControls(st.bar);
      return true;
    }
    scheduleHide();
    if (cur === st.bar) {
      if (k === KEY.LEFT) {
        seekBy(-1);
        return true;
      }
      if (k === KEY.RIGHT) {
        seekBy(1);
        return true;
      }
      if (k === KEY.UP) {
        hideControls();
        return true;
      }
    }
    return false;
  }

  return {
    restart,
    togglePlay,
    updatePlayBtn,
    paint,
    updateTimes,
    showControls,
    hideControls,
    scheduleHide,
    seekBy,
    showPreview,
    pcPreview,
    commitSeek,
    cancelSeek,
    onKey,
  };
}
