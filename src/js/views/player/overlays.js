// Player (overlays): sobreposições: abertura, aviso da agenda e pular abertura/recapitulação/encerramento.
import { h } from '../../lib/dom.js';
import * as nav from '../../lib/nav.js';
import { KEY } from '../../lib/nav.js';
import * as store from '../../lib/store.js';
import * as calendar from '../../api/calendar.js';
import * as skip from '../../api/skip.js';
import * as hero from '../../api/hero.js';
import { toast, eventTime } from '../../ui.js';
import { t } from '../../lib/i18n.js';
import { IS_WEB } from '../../lib/platform.js';
import { ico } from '../../lib/icons.js';

// Eventos da agenda que já avisaram (não repete o aviso ao trocar de vídeo).
const calendarSeen = {};

export function createOverlays(st) {
  // ---------- Aviso da agenda ----------
  // Evento começando em até 5 min: cartão no canto com o X já focado (OK ou Voltar fecha) que some
  // sozinho em 15 s. Enquanto ele está na tela, outra tecla só fecha o aviso.
  const NOTICE_MS = 15000;
  let calNotice = null;
  function checkCalendar() {
    if (!st.alive || calNotice) return;
    const e = calendar.startingWithin(5 * 60000).filter((x) => !calendarSeen[x.title + '|' + x.start.getTime()])[0];
    if (!e) return;
    calendarSeen[e.title + '|' + e.start.getTime()] = true;
    const min = Math.max(1, Math.round((e.start.getTime() - Date.now()) / 60000));
    const fill = h('i');
    const closeBtn = h('div.cal-close', { focusable: true, title: t('Fechar aviso'), html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>', onSelect: () => closeNotice() });
    const box = h('div.cal-notice', null, [
      h('div.cal-notice-top', null, [
        h('span.cal-notice-ico', { html: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>' }),
        h('span.cal-notice-when', { text: t('Começa em {n} min', { n: min }) }),
        closeBtn,
      ]),
      h('div.cal-notice-title', { text: e.title }),
      h('div.cal-notice-sub', null, [h('i', { style: { background: e.color } }), [eventTime(e, true), e.location].filter(Boolean).join(' · ')]),
      h('div.cal-notice-hint', { text: t(IS_WEB ? 'Enter fecha · some sozinho em 15 s' : 'OK fecha · some sozinho em 15 s') }),
      h('div.cal-notice-bar', null, fill),
    ]);
    st.el.appendChild(box);
    const layer = nav.pushLayer(box, {
      onBack: () => closeNotice(),
      onKey: (ev) => {
        if (ev.keyCode === KEY.ENTER || ev.keyCode === KEY.BACK || ev.keyCode === KEY.ESC || ev.keyCode === KEY.BACKSPACE) return false;
        closeNotice();
        return true;
      },
    });
    nav.focus(closeBtn);
    const timer = setTimeout(() => closeNotice(), NOTICE_MS);
    setTimeout(() => (fill.style.width = '0%'), 50); // a barra esvazia até o aviso sumir
    calNotice = { box: box, layer: layer, timer: timer };
  }
  function closeNotice() {
    if (!calNotice) return;
    clearTimeout(calNotice.timer);
    nav.popLayer(calNotice.layer);
    if (calNotice.box.parentNode) calNotice.box.parentNode.removeChild(calNotice.box);
    calNotice = null;
  }
  const doneSegs = {};

  function loadSegments() {
    if (st.segmentsLoaded || store.settings().skipMode === 'off') return;
    st.segmentsLoaded = true;
    const forVideo = st.video;
    skip
      .getSegments(st.meta, st.video, st.videoEl.duration)
      .then((list) => {
        if (st.alive && forVideo === st.video) st.segments = list;
      })
      .catch(() => {});
  }

  function segLabel(seg) {
    if (seg.type === 'intro') return t('Pular abertura');
    if (seg.type === 'recap') return t('Pular recapitulação');
    return st.opts.isSeries && st.api.nextVideo() ? t('Próximo episódio') : t('Pular encerramento');
  }

  function segKey(seg) {
    return st.video.id + ':' + seg.type + ':' + seg.start;
  }

  function checkSkip() {
    if (!st.segments.length || st.seekTarget !== null) return;
    const pos = st.videoEl.currentTime;
    const seg = st.segments.find((x) => pos >= x.start && pos < x.end - 0.5) || null;
    if (seg !== st.activeSeg) {
      st.activeSeg = seg;
      if (!seg || doneSegs[segKey(seg)]) {
        hideSkip();
        if (seg) st.activeSeg = null;
        return;
      }
      if (store.settings().skipMode === 'auto') {
        doSkip();
        return;
      }
      const nv = seg.type === 'outro' && st.opts.isSeries ? st.api.nextVideo() : null;
      st.skipIco.innerHTML = ico(nv ? 'next' : 'skip');
      st.skipLabel.textContent = segLabel(seg);
      st.skipSub.textContent = nv ? 'T' + nv.season + 'E' + nv.episode + (nv.namePt || nv.name ? ' · ' + (nv.namePt || nv.name) : '') : '';
      st.skipBtn.classList.toggle('two-line', !!nv);
      st.skipBox.classList.add('show');
      if (st.controlsOn) nav.focus(st.skipBtn, { noScroll: true });
    }
    if (st.activeSeg) st.skipFill.style.width = Math.max(0, Math.min(100, ((pos - st.activeSeg.start) / (st.activeSeg.end - st.activeSeg.start)) * 100)) + '%';
  }

  function hideSkip() {
    st.skipBox.classList.remove('show');
    if (nav.current() === st.skipBtn) nav.focus(st.bar, { noScroll: true });
  }

  function dismissSkip() {
    if (st.activeSeg) doneSegs[segKey(st.activeSeg)] = true;
    st.activeSeg = null;
    hideSkip();
  }

  function doSkip() {
    const seg = st.activeSeg;
    if (!seg) return;
    doneSegs[segKey(seg)] = true;
    st.activeSeg = null;
    hideSkip();
    if (seg.type === 'outro' && st.opts.isSeries && st.api.nextVideo()) {
      st.api.playNext();
      return;
    }
    const d = st.videoEl.duration;
    try {
      st.videoEl.currentTime = Math.min(seg.end, isFinite(d) ? d - 1 : seg.end);
    } catch (e) {
      /* ignore */
    }
    if (store.settings().skipMode === 'auto') toast(seg.type === 'intro' ? t('Abertura pulada') : seg.type === 'recap' ? t('Recapitulação pulada') : t('Encerramento pulado'));
  }

  let introOn = true;
  function setupIntro() {
    requestAnimationFrame(() => requestAnimationFrame(() => introOn && st.intro.classList.add('in')));
    const art = st.meta.background || hero.background(st.meta.id);
    if (art) {
      const pre = new Image();
      pre.onload = () => introOn && (st.introBg.style.backgroundImage = 'url("' + art + '")') && st.introBg.classList.add('show');
      pre.src = art;
    }
    st.introTitle.style.display = 'none';
    st.introLogo.onerror = () => {
      st.introLogo.style.display = 'none';
      st.introTitle.style.display = '';
    };
    st.introLogo.src = st.meta.logo || hero.logo(st.meta.id);
    st.introSub.textContent = st.opts.isSeries ? 'T' + st.video.season + ' E' + st.video.episode + ' · ' + (st.video.namePt || st.video.name || st.video.title || '') : '';
    st.introStatus.textContent = st.stream ? t('Preparando o vídeo') : t('Escolhendo a melhor fonte');
    st.introCaption.innerHTML = st.stream ? '' : '<b>✦</b>' + t('Smart Choice ativado');
  }

  function hideIntro() {
    if (!introOn) return;
    introOn = false;
    st.intro.classList.remove('in');
    // Controles e círculo voltam junto com o fim do fade.
    setTimeout(() => st.el.classList.remove('intro-on'), 600);
    // Depois do fade, solta a arte (1920x1080 pesa na memória da TV).
    setTimeout(() => {
      st.introBg.style.backgroundImage = '';
      st.intro.style.display = 'none';
    }, 900);
  }

  function showSpinner(on) {
    st.spinner.style.display = on ? '' : 'none';
  }

  function message(text) {
    st.msgEl.textContent = introOn ? '' : text;
    if (introOn && text) st.introStatus.textContent = text;
  }

  return {
    checkCalendar,
    closeNotice,
    loadSegments,
    segLabel,
    segKey,
    checkSkip,
    hideSkip,
    dismissSkip,
    doSkip,
    setupIntro,
    hideIntro,
    showSpinner,
    message,
  };
}
