// Abas curadas com destaque no estilo Netflix: "Recomendado" (em alta, true crime, suspense,
// terror) e "Streamings" (novidades de cada serviço). Ao parar num título, o topo troca a arte
// (fade com zoom, sobre uma aurora enquanto a imagem não está pronta); parado mais um pouco, toca o
// trailer com fade de imagem e de som. Um trilho mostra em que categoria você está.
// "Ver tudo" no fim de cada fileira abre a categoria inteira (Recomendado › Suspense).
import { h, clear, loadVisibleImages } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import { topbar, card, spinnerLine, toast } from '../ui.js';
import * as router from '../router.js';
import { openDetails } from './details.js';
import * as reco from '../api/recommend.js';
import { t } from '../lib/i18n.js';

const ROW_LIMIT = 20;
const PREVIEW_MS = 350; // parado no título: troca o destaque
const TRAILER_MS = 3000; // parado mais um pouco: carrega o trailer
const REVEAL_MS = 2000; // trailer tocando há esse tempo sem engasgar: aparece (esconde o começo em baixa e a interface)
const ATTEMPT_MS = 9000; // trailer que não aparece nesse tempo: tenta o próximo
const MAX_TRAILERS = 4; // depois disso desiste e fica só a arte
const AUDIO_FADE_MS = 1600;
const NOCOOKIE = 'www.youtube-nocookie.com';
const YOUTUBE = 'www.youtube.com';

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
  // Sem a nota do TMDB aqui: notas no app são só IMDb e Rotten Tomatoes (na tela de detalhes).
  return [it.year, it.mediaType === 'tv' ? t('Série') : t('Filme')].filter(Boolean).join(' · ');
}

// ---------- Destaque: arte com transição + trailer ----------
function Billboard() {
  // Duas camadas de arte que se revezam (crossfade com zoom) sobre uma aurora animada.
  const bgA = h('div.reco-bg');
  const bgB = h('div.reco-bg');
  const frameBox = h('div.reco-trailer');
  const loading = h('div.reco-loading', null, h('div.spinner.small'));
  const title = h('div.reco-title');
  const meta = h('div.reco-meta');
  const desc = h('div.reco-desc');
  const el = h('div.reco-bill', null, [
    h('div.aurora', null, [h('i.a1'), h('i.a2'), h('i.a3')]),
    bgA,
    bgB,
    frameBox,
    h('div.reco-shade-left'),
    h('div.reco-shade-bottom'),
    loading,
    h('div.reco-info', null, [title, meta, desc]),
  ]);

  let front = bgA;
  let current = null;
  let previewTimer = null;
  let trailerTimer = null;
  let attemptTimer = null;
  let revealTimer = null;
  let fadeTimer = null;
  let token = 0;
  let queue = []; // trailers que ainda dá para tentar
  let attempt = { key: '', host: '' };
  let frameWin = null; // janela do iframe do trailer (para reconhecer as mensagens dele)
  let revealed = false;
  let unmuteAt = 0;

  function stopTrailer() {
    clearTimeout(trailerTimer);
    clearTimeout(attemptTimer);
    clearTimeout(revealTimer);
    clearInterval(fadeTimer);
    el.classList.remove('playing', 'buffering');
    queue = [];
    frameWin = null;
    revealed = false;
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
    title.textContent = it.name;
    meta.textContent = metaLine(it);
    desc.textContent = it.overview || '';
    setArt(it.backdrop, tk);
    trailerTimer = setTimeout(() => playTrailer(it, tk), TRAILER_MS);
  }

  // A arte só entra pronta (pré-carregada): nunca aparece se formando de cima para baixo.
  function setArt(url, tk) {
    if (!url) {
      front.classList.remove('show'); // sem arte: fica a aurora
      return;
    }
    const pre = new Image();
    pre.onload = () => {
      if (tk !== token) return;
      const back = front === bgA ? bgB : bgA;
      back.style.backgroundImage = 'url("' + url + '")';
      back.classList.remove('show');
      // Dois frames para o navegador pintar a imagem antes de animar.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          back.classList.add('show');
          front.classList.remove('show');
          front = back;
        })
      );
    };
    pre.src = url;
  }

  // ---- Trailer (YouTube) ----
  // O YouTube avisa por postMessage (enablejsapi) o estado do player. O trailer começa sem som e
  // escondido; só aparece depois de REVEAL_MS tocando sem engasgar (passa o começo em baixa
  // resolução e os botões que o YouTube mostra no início), com fade de imagem e de som.
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
    if (state === 1) onPlaying();
    else if (state === 3) onBuffering();
    else if (state === 2 && unmuteAt && Date.now() - unmuteAt < 2000) {
      // O navegador pausou ao ligar o som sem um clique: segue sem som.
      unmuteAt = 0;
      clearInterval(fadeTimer);
      command('mute');
      command('playVideo');
    } else if (state === 0) stopTrailer(); // acabou: volta para a arte
    if (msg.event === 'onError') onError(msg.info);
  }
  window.addEventListener('message', onYouTubeMessage);

  function onPlaying() {
    el.classList.remove('buffering');
    if (revealed || revealTimer) return;
    command('setPlaybackQuality', ['hd1080']);
    const tk = token;
    revealTimer = setTimeout(() => {
      revealTimer = null;
      if (tk !== token) return;
      reveal();
    }, REVEAL_MS);
  }

  function onBuffering() {
    if (revealed) el.classList.add('buffering'); // travou no meio: mostra o carregando
    else {
      clearTimeout(revealTimer); // ainda escondido: espera tocar liso de novo
      revealTimer = null;
    }
  }

  function reveal() {
    revealed = true;
    clearTimeout(attemptTimer);
    el.classList.add('playing');
    report('tocou (' + attempt.host + ')');
    // Som em fade: liga mudo→volume 0 e sobe até 100.
    command('setVolume', [0]);
    command('unMute');
    unmuteAt = Date.now();
    const steps = 16;
    let i = 0;
    clearInterval(fadeTimer);
    fadeTimer = setInterval(() => {
      i++;
      command('setVolume', [Math.round((100 * i) / steps)]);
      if (i >= steps) clearInterval(fadeTimer);
    }, AUDIO_FADE_MS / steps);
  }

  function onError(code) {
    // 152/153: o YouTube não reconheceu quem está incorporando; tenta o mesmo trailer no youtube.com.
    if ((code === 152 || code === 153) && attempt.host === NOCOOKIE) {
      report('erro ' + code + ', tentando youtube.com');
      return load(attempt.key, YOUTUBE, token);
    }
    report('erro ' + code);
    nextTrailer(token);
  }

  function command(func, args) {
    if (frameWin) frameWin.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [], id: 1, channel: 'widget' }), '*');
  }

  // Diagnóstico do último trailer (aparece em Ajustes → Sobre e depuração).
  function report(what) {
    reco.setTrailerReport((current ? current.name + ': ' : '') + what);
  }

  function playTrailer(it, tk) {
    reco.trailerKeys(it).then((keys) => {
      if (tk !== token || document.hidden) return;
      queue = keys.slice(0, MAX_TRAILERS);
      nextTrailer(tk);
    });
  }

  // Próximo trailer da fila. Enquanto não aparece, nada muda na tela (a arte fica).
  function nextTrailer(tk) {
    const key = queue.shift();
    if (!key) {
      clearTimeout(attemptTimer);
      frameWin = null;
      clear(frameBox);
      return;
    }
    load(key, NOCOOKIE, tk);
  }

  function load(key, host, tk) {
    clearTimeout(attemptTimer);
    clearTimeout(revealTimer);
    revealTimer = null;
    el.classList.remove('playing', 'buffering');
    revealed = false;
    frameWin = null;
    unmuteAt = 0;
    clear(frameBox);
    if (tk !== token) return;
    attempt = { key: key, host: host };
    attemptTimer = setTimeout(() => {
      if (tk !== token || revealed) return;
      report('não começou em ' + ATTEMPT_MS / 1000 + 's');
      nextTrailer(tk);
    }, ATTEMPT_MS);
    const origin = window.location.protocol + '//' + window.location.host;
    // mute=1: vídeo sem som pode tocar sozinho; vq=hd1080: pede alta definição (o YouTube decide no fim).
    const src =
      'https://' + host + '/embed/' + key +
      '?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=0&vq=hd1080&enablejsapi=1&origin=' +
      encodeURIComponent(origin) + '&widget_referrer=' + encodeURIComponent(origin);
    const frame = h('iframe', { src: src, allow: 'autoplay; encrypted-media', referrerpolicy: 'strict-origin-when-cross-origin', tabindex: '-1', frameborder: '0' });
    frame.onload = () => {
      if (tk !== token || !frame.contentWindow) return;
      frameWin = frame.contentWindow;
      // Pede para o player mandar os eventos (o mesmo que a IFrame API do YouTube faz).
      frameWin.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
      command('addEventListener', ['onStateChange']);
      command('addEventListener', ['onError']);
      command('setPlaybackQuality', ['hd1080']);
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

// ---------- Trilho de categorias ----------
// Mostra todas as categorias da aba, com a atual em destaque, e a frase dela embaixo.
function Rail(defs) {
  const items = defs.map((d) =>
    h('div.rail-item', null, [d.logo ? h('img.rail-logo', { src: d.logo, alt: '' }) : null, h('span', { text: t(d.short) })])
  );
  const caption = h('div.rail-caption');
  const el = h('div.reco-rail', null, [h('div.rail-items', null, items), caption]);
  let active = -1;
  function set(i) {
    if (i === active || !defs[i]) return;
    if (items[active]) items[active].classList.remove('on');
    active = i;
    items[i].classList.add('on');
    caption.textContent = t(defs[i].caption);
  }
  return { el: el, set: set };
}

// ---------- Fileiras ----------
function buildRow(def, index, ctx) {
  const row = h('div.row.reco-row', { 'data-anchor': '0' });
  // data-trap: no fim da fileira o foco para ali (antes pulava para outra fileira fora da tela).
  const track = h('div.row-track.pending', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, spinnerLine(t('Carregando...')));
  row.appendChild(track);
  const focusRow = () => ctx.rail.set(index);
  const load = () =>
    def
      .load(1)
      .then((items) => {
        clear(track);
        track.classList.remove('pending');
        if (!items.length) {
          track.appendChild(h('div.row-empty', { text: t('Nada por aqui.') }));
          return;
        }
        items.slice(0, ROW_LIMIT).forEach((it) =>
          track.appendChild(
            card(it, {
              onSelect: () => openItem(it),
              onFocus: () => {
                focusRow();
                ctx.billboard.show(it);
              },
            })
          )
        );
        track.appendChild(
          h(
            'div.card.see-all',
            {
              focusable: true,
              onSelect: () => openCategory(ctx.crumb, def),
              onFocus: () => {
                focusRow();
                ctx.billboard.stop();
              },
            },
            [h('div.poster-wrap', null, h('div.see-all-label', null, [h('b', { text: t('Ver tudo') }), h('span', { text: t(def.title) })]))]
          )
        );
        loadVisibleImages(row);
      })
      .catch(() => {
        clear(track);
        track.appendChild(h('div.row-empty', { text: t('Não foi possível carregar') }));
      });
  return { row: row, load: load };
}

// Aba curada genérica. cfg: { tabId, crumb, defs }
function CuratedView(cfg) {
  const el = h('div.view.reco');
  const bar = topbar(cfg.tabId, router.goTab);
  const billboard = Billboard();
  const rail = Rail(cfg.defs);
  const rows = h('div.reco-rows.scroll-y', { 'data-scroll-y': '', 'data-pad-y': '40' });
  el.appendChild(billboard.el);
  el.appendChild(h('div.reco-top', null, bar));
  el.appendChild(rail.el);
  el.appendChild(rows);
  const ctx = { billboard: billboard, rail: rail, crumb: cfg.crumb };

  let loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    if (!reco.available()) {
      rows.appendChild(h('div.hint', { text: t('Essa aba precisa da chave do TMDB (Ajustes → Metadados extras).') }));
      return;
    }
    rail.set(0);
    const built = cfg.defs.map((def, i) => buildRow(def, i, ctx));
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

export function RecommendedView() {
  return CuratedView({ tabId: 'recommended', crumb: 'Recomendado', defs: reco.ROWS });
}

export function StreamingsView() {
  return CuratedView({ tabId: 'streamings', crumb: 'Streamings', defs: reco.STREAMINGS });
}

// ---------- Ver tudo (Recomendado › Categoria) ----------
function openCategory(crumb, def) {
  router.push(CategoryView(crumb, def));
}

function CategoryView(crumb, def) {
  const el = h('div.view');
  const scroller = h('div.scroll-y', { 'data-scroll-y': '' });
  const header = h('div.reco-crumb', null, [h('span', { text: t(crumb) }), ' › ', h('b', { text: t(def.title) })]);
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
