// Aba "Recomendado": fileiras do TMDB (em alta, true crime, suspense, terror) com destaque no
// estilo Netflix: ao parar num título, o topo mostra a arte grande; parado mais um pouco, toca o
// trailer. "Ver tudo" no fim de cada fileira abre a categoria inteira (Recomendado › Suspense).
import { h, clear, loadVisibleImages } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import { topbar, card, spinnerLine, toast } from '../ui.js';
import * as router from '../router.js';
import { openDetails } from './details.js';
import * as reco from '../api/recommend.js';
import { t } from '../lib/i18n.js';

const ROW_LIMIT = 20;
const PREVIEW_MS = 350; // parado no título: troca o destaque
const TRAILER_MS = 3000; // parado mais um pouco: toca o trailer

// Abre o título no Seraflix: os addons do Stremio usam o id do IMDb.
function openItem(it) {
  toast(t('Abrindo {name}...', { name: it.name }), 2000);
  reco
    .imdbId(it)
    .then((imdb) => {
      if (!imdb) return toast(t('Esse ainda não está no catálogo do Stremio.'));
      openDetails(it.mediaType === 'tv' ? 'series' : 'movie', imdb);
    })
    .catch(() => toast(t('Não foi possível abrir')));
}

function metaLine(it) {
  return [it.year, it.mediaType === 'tv' ? t('Série') : t('Filme'), it.rating ? '★ ' + it.rating.toFixed(1) : ''].filter(Boolean).join(' · ');
}

// ---------- Destaque com trailer ----------
function Billboard() {
  const bg = h('div.reco-bg');
  const frameBox = h('div.reco-trailer');
  const title = h('div.reco-title');
  const meta = h('div.reco-meta');
  const desc = h('div.reco-desc');
  const el = h('div.reco-bill', null, [bg, frameBox, h('div.reco-shade-left'), h('div.reco-shade-bottom'), h('div.reco-info', null, [title, meta, desc])]);

  let current = null;
  let previewTimer = null;
  let trailerTimer = null;
  let token = 0;
  let queue = []; // trailers que ainda dá para tentar
  let frameWin = null; // janela do iframe do trailer (para reconhecer as mensagens dele)

  function stopTrailer() {
    clearTimeout(trailerTimer);
    el.classList.remove('playing');
    queue = [];
    frameWin = null;
    clear(frameBox); // remove o iframe: para o som e solta a memória
  }

  function show(it) {
    current = it;
    token++;
    clearTimeout(previewTimer);
    stopTrailer();
    previewTimer = setTimeout(() => render(it, token), PREVIEW_MS);
  }

  function render(it, tk) {
    if (tk !== token) return;
    bg.style.backgroundImage = it.backdrop ? 'url("' + it.backdrop + '")' : 'none';
    title.textContent = it.name;
    meta.textContent = metaLine(it);
    desc.textContent = it.overview || '';
    trailerTimer = setTimeout(() => playTrailer(it, tk), TRAILER_MS);
  }

  // O YouTube avisa por postMessage (enablejsapi) quando começa a tocar ou dá erro. O trailer só
  // aparece por cima da arte quando está tocando de verdade; com erro ("vídeo indisponível",
  // bloqueio de incorporação) ele some e a arte fica.
  function onYouTubeMessage(e) {
    if (!frameWin || e.source !== frameWin) return;
    let msg = e.data;
    try {
      if (typeof msg === 'string') msg = JSON.parse(msg);
    } catch (err) {
      return;
    }
    if (!msg) return;
    const state = msg.event === 'onStateChange' ? msg.info : msg.info && msg.info.playerState;
    if (state === 1) el.classList.add('playing');
    else if (state === 0) stopTrailer(); // acabou: volta para a arte
    if (msg.event === 'onError') nextTrailer(token);
  }
  window.addEventListener('message', onYouTubeMessage);

  function playTrailer(it, tk) {
    reco.trailerKeys(it).then((keys) => {
      if (tk !== token || document.hidden) return;
      queue = keys;
      nextTrailer(tk);
    });
  }

  // Carrega o próximo trailer da fila (o anterior deu erro ou é o primeiro).
  function nextTrailer(tk) {
    const key = queue.shift();
    el.classList.remove('playing');
    frameWin = null;
    clear(frameBox);
    if (!key || tk !== token) return;
    const origin = window.location.protocol + '//' + window.location.host;
    const src =
      'https://www.youtube-nocookie.com/embed/' + key +
      '?autoplay=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&origin=' +
      encodeURIComponent(origin);
    const frame = h('iframe', { src: src, allow: 'autoplay; encrypted-media', referrerpolicy: 'strict-origin-when-cross-origin', tabindex: '-1', frameborder: '0' });
    frame.onload = () => {
      if (tk !== token || !frame.contentWindow) return;
      frameWin = frame.contentWindow;
      // Pede para o player mandar os eventos (o mesmo que a IFrame API do YouTube faz).
      frameWin.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
      ['onStateChange', 'onError'].forEach((name) =>
        frameWin.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: [name], id: 1, channel: 'widget' }), '*')
      );
    };
    frameBox.appendChild(frame);
  }

  function stop() {
    token++;
    clearTimeout(previewTimer);
    stopTrailer();
  }

  return {
    el: el,
    show: show,
    stop: stop,
    resume: () => current && show(current),
    destroy: () => {
      stop();
      window.removeEventListener('message', onYouTubeMessage);
    },
  };
}

// ---------- Fileiras ----------
function buildRow(def, billboard) {
  const row = h('div.row', { 'data-anchor': '20' });
  const title = h('div.row-title', null, [t(def.title), h('small', { text: t(def.sub) })]);
  // data-trap: no fim da fileira o foco para ali (antes pulava para outra fileira fora da tela).
  const track = h('div.row-track.pending', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, spinnerLine(t('Carregando...')));
  row.appendChild(title);
  row.appendChild(track);
  const load = () =>
    def
      .load(1)
      .then((items) => {
        clear(track);
        track.classList.remove('pending');
        if (!items.length) {
          if (row.parentNode) row.parentNode.removeChild(row);
          return;
        }
        items.slice(0, ROW_LIMIT).forEach((it) =>
          track.appendChild(card(it, { onSelect: () => openItem(it), onFocus: () => billboard.show(it) }))
        );
        track.appendChild(
          h('div.card.see-all', { focusable: true, onSelect: () => openCategory(def), onFocus: () => billboard.stop() }, [
            h('div.poster-wrap', null, h('div.see-all-label', null, [h('b', { text: t('Ver tudo') }), h('span', { text: t(def.title) })])),
          ])
        );
        loadVisibleImages(row);
      })
      .catch(() => {
        if (row.parentNode) row.parentNode.removeChild(row);
      });
  return { row: row, load: load };
}

export function RecommendedView() {
  const el = h('div.view.reco');
  const bar = topbar('recommended', router.goTab);
  const billboard = Billboard();
  const rows = h('div.reco-rows.scroll-y', { 'data-scroll-y': '', 'data-pad-y': '40' });
  el.appendChild(billboard.el);
  el.appendChild(h('div.reco-top', null, bar));
  el.appendChild(rows);

  let loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    if (!reco.available()) {
      rows.appendChild(h('div.hint', { text: t('A aba Recomendado precisa da chave do TMDB (Ajustes → Metadados extras).') }));
      return;
    }
    const built = reco.ROWS.map((def) => buildRow(def, billboard));
    built.forEach((b) => rows.appendChild(b.row));
    // Primeira fileira já com destaque no primeiro título.
    built[0].load().then(() => {
      const first = rows.querySelector('.card');
      if (first && nav.current() && nav.current().closest('.topbar')) nav.focus(first);
    });
    built.slice(1).forEach((b) => b.load());
  }

  // Trailer só com a aba à vista e o app na frente.
  const onVisibility = () => (document.hidden ? billboard.stop() : null);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    el: el,
    onShow: () => {
      load();
      const cur = nav.current();
      if (cur && cur.classList.contains('card') && !cur.classList.contains('see-all')) billboard.resume();
    },
    onHide: () => billboard.stop(),
    destroy: () => {
      billboard.destroy();
      document.removeEventListener('visibilitychange', onVisibility);
      if (bar.__destroy) bar.__destroy();
    },
  };
}

// ---------- Ver tudo (Recomendado › Categoria) ----------
function openCategory(def) {
  router.push(CategoryView(def));
}

function CategoryView(def) {
  const el = h('div.view');
  const scroller = h('div.scroll-y', { 'data-scroll-y': '' });
  const header = h('div.reco-crumb', null, [h('span', { text: t('Recomendado') }), ' › ', h('b', { text: t(def.title) })]);
  const grid = h('div.grid');
  const more = h('div.btn.reco-more', { focusable: true, text: t('Carregar mais'), onSelect: () => loadPage() });
  scroller.appendChild(header);
  scroller.appendChild(grid);
  scroller.appendChild(h('div.reco-more-wrap', null, more));
  el.appendChild(scroller);

  let page = 0;
  let busy = false;
  const seen = {};
  function loadPage() {
    if (busy) return;
    busy = true;
    more.textContent = t('Carregando...');
    const firstPage = page === 0;
    def
      .load(++page)
      .then((items) => {
        const fresh = items.filter((it) => !seen[it.mediaType + ':' + it.tmdbId]);
        fresh.forEach((it) => {
          seen[it.mediaType + ':' + it.tmdbId] = true;
          grid.appendChild(card(it, { onSelect: () => openItem(it) }));
        });
        if (!fresh.length) more.style.display = 'none';
        loadVisibleImages(el, 400);
        if (firstPage && grid.firstChild) nav.focus(grid.firstChild);
      })
      .catch(() => toast(t('Não foi possível carregar')))
      .then(() => {
        busy = false;
        more.textContent = t('Carregar mais');
      });
  }

  return {
    el: el,
    onShow: () => {
      if (!page) loadPage();
    },
  };
}
