// Aba NSFW: tudo que vem dos addons adultos, separado do resto do app.
// Organização por site: no topo, um bloco por site (Pornhub, XVideos e os outros addons; as
// instalações divididas do mesmo addon, como "TPB 4K Porn (1/2)" e "(2/2)", viram um site só) e a
// Busca. Dentro do site: Continuar assistindo e Favoritos daquele site, Creampie hétero, gay e
// lançamentos (em alta agora, misturados a cada abertura), as categorias em cartões e as demais
// fileiras. A categoria abre numa grade com a lista de categorias ao lado.
import { h, clear, loadVisibleImages } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import { KEY } from '../lib/nav.js';
import * as addons from '../api/addons.js';
import * as stremio from '../api/stremio.js';
import { topbar, card, skeletonCards, retrying, pagedGrid, statsLine, confirmDialog, seeAllCard } from '../ui.js';
import * as router from '../router.js';
import { openDetails as openDetailsRaw } from './details.js';
import { showRetry } from './recommended.js';
import { t } from '../lib/i18n.js';
import * as tr from '../lib/translate.js';
import * as store from '../lib/store.js';
import * as nsfwSaved from '../lib/nsfwSaved.js';
import { sharpThumb } from '../lib/img.js';

const ROW_LIMIT = 20;
const ICON_SEARCH = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';

// Marca dos sites do serviço da TV (cores dos próprios sites).
const SITE_MARK = {
  'seraflix.pornhub': { text: 'PH', bg: '#FF9000', fg: '#111110' },
  'seraflix.xvideos': { text: 'XV', bg: '#DE2600', fg: '#FFFFFF' },
};

// Sigla do site para quando o addon não tem logo.
function initialsOf(name) {
  const words = String(name || '?')
    .replace(/[^A-Za-z0-9À-ú+ ]/g, ' ')
    .trim()
    .split(/\s+/);
  // Sigla já pronta no nome ("TPB 4K Porn" → "TPB"); senão, as iniciais das duas primeiras palavras.
  if (/^[A-Z0-9]{2,4}$/.test(words[0])) return words[0];
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 3)).toUpperCase();
}

// Nome do site sem a parte da instalação: "TPB 4K Porn (1/2)" → "TPB 4K Porn".
function siteName(a) {
  return String(a.manifest.name || a.manifest.id)
    .replace(/\s*[([]\s*\d+\s*\/\s*\d+\s*[)\]]\s*$/, '')
    .replace(/\s+(?:part|parte|pt\.?)\s*\d+\s*$/i, '')
    .trim();
}

// Sites na ordem dos addons (Pornhub e XVideos primeiro), cada um com as suas instalações.
export function sites() {
  const out = [];
  addons.adultAddons().forEach((a) => {
    const name = siteName(a);
    const id = SITE_MARK[a.manifest.id] ? a.manifest.id : 'site:' + name.toLowerCase();
    let s = out.filter((x) => x.id === id)[0];
    if (!s) {
      s = { id: id, name: name, addons: [], mark: SITE_MARK[a.manifest.id] || null };
      out.push(s);
    }
    s.addons.push(a);
  });
  return out;
}

function sitePrefixes(site) {
  const out = [];
  site.addons.forEach((a) => {
    const m = a.manifest;
    [m.idPrefixes || []].concat((m.resources || []).map((r) => (typeof r === 'object' && r.idPrefixes) || [])).forEach((l) =>
      l.forEach((p) => p && p !== 'tt' && out.indexOf(p) < 0 && out.push(p))
    );
  });
  return out;
}

// O item é deste site? Pelo prefixo do id; addon sem prefixo fica com o que nenhum outro site reclama.
function belongsTo(site, all, id) {
  const mine = sitePrefixes(site);
  if (mine.some((p) => id.indexOf(p) === 0)) return true;
  if (mine.length) return false;
  return !all.some((s) => s !== site && sitePrefixes(s).some((p) => id.indexOf(p) === 0));
}

// Tudo que abre daqui fica marcado como adulto (some do resto do app).
// Muitos addons adultos não têm "meta": os detalhes usam o próprio item do catálogo.
function openDetails(type, id, opts, item) {
  addons.markAdult(id);
  openDetailsRaw(type, id, Object.assign({ fallbackMeta: item || null }, opts));
}

// Cartão do catálogo: capa deitada, qualidade e duração em cima da prévia e, embaixo, os números
// do vídeo (visualizações, aprovação, canal). Sem prévia (capa que não abre), o vídeo sai da fileira.
// Títulos sem censura: o addon costuma escrever "uncensored" no nome.
function isUncensored(m) {
  return /uncensored/i.test(m.name || '');
}

// Prévia no cartão em foco: o vídeo curtinho do site (XVideos/Pornhub, vindo do serviço da TV) ou,
// no Hentaigasm, a prévia animada que a capa nítida substituiu. Uma por vez; começa depois de o foco
// parar um pouco, para não baixar vídeo enquanto o controle passa correndo pela fileira.
const PREVIEW_DELAY = 700;
let previewStop = null;

function previewOf(m) {
  if (m.preview) return { video: m.preview };
  const img = m.poster || m.background;
  return img && sharpThumb(img) !== img ? { image: img } : null;
}

export function stopPreview() {
  if (previewStop) previewStop();
}

function startPreview(cardEl, src) {
  stopPreview();
  const wrap = cardEl.querySelector('.poster-wrap');
  if (!wrap) return;
  let node = null;
  const timer = setTimeout(() => {
    const show = () => node.classList.add('ready');
    if (src.video) {
      node = h('video.card-preview', { muted: true, loop: true, autoplay: true, playsinline: true });
      node.muted = true;
      node.addEventListener('playing', show);
      node.src = src.video;
      const p = node.play && node.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      node = h('img.card-preview', { alt: '' });
      node.onload = show;
      node.src = src.image;
    }
    node.onerror = () => stop();
    // Logo acima da capa: os selos (qualidade, duração) continuam por cima.
    const cover = wrap.querySelector('img');
    wrap.insertBefore(node, cover ? cover.nextSibling : wrap.firstChild);
  }, PREVIEW_DELAY);
  function stop() {
    clearTimeout(timer);
    if (previewStop === stop) previewStop = null;
    if (!node) return;
    if (node.tagName === 'VIDEO') {
      node.pause();
      node.removeAttribute('src');
      node.load(); // solta o decodificador da TV
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node = null;
  }
  previewStop = stop;
}

function itemCard(m, entry) {
  const wide = m.posterShape === 'landscape' || (entry && entry.catalog.posterShape === 'landscape');
  const st = m.stats || {};
  const extra = !m.stats && m.releaseInfo ? h('div.card-stats', null, h('span.cs-by', { text: String(m.releaseInfo) })) : null;
  const pv = previewOf(m);
  const el = card(m, {
    wide: wide,
    rich: true,
    image: wide ? m.poster || m.background : undefined,
    dropWithoutImage: true,
    corner: st.quality,
    flag: isUncensored(m) ? 'UNCENSORED' : null,
    duration: st.duration,
    stats: statsLine(st) || extra,
    onSelect: () => {
      stopPreview();
      openDetails(m.type || entry.catalog.type, m.id, null, m);
    },
    onFocus: pv ? () => startPreview(el, pv) : undefined,
  });
  if (pv) el.__blur = stopPreview;
  return el;
}

// Capa deitada (16:9) é o padrão dos sites adultos; só catálogo que diz pôster/quadrado fica em pé.
function wideCatalog(entry) {
  const shape = entry && entry.catalog.posterShape;
  return shape !== 'poster' && shape !== 'square';
}

// Ordem das fileiras: Creampie hétero, gay, os lançamentos de creampie e depois o resto do addon.
function catalogOrder(e) {
  const n = (e.catalog.name || e.catalog.id || '') + ' ' + (e.catalog.id || '');
  if (!/creampie|cpnew|-cp\b/i.test(n)) return 3;
  if (/lançamento|lancamento|cpnew|\bnew\b/i.test(n)) return 2;
  return /gay/i.test(n) ? 1 : 0;
}

// Subtítulo de cada fileira (o que o critério dela é), nos catálogos do serviço da TV.
const ROW_SUB = {
  'xv-cp': 'em alta na semana',
  'ph-cp': 'em alta na semana',
  'xv-cpgay': 'em alta no mês',
  'ph-cpgay': 'em alta no mês',
  'xv-cpnew': 'acabaram de sair',
  'ph-cpnew': 'acabaram de sair',
  'xv-new': 'acabaram de sair',
  'ph-new': 'acabaram de sair',
};

// Fileiras de descoberta (Creampie): duas páginas misturadas a cada abertura do app e sem o que você
// já abriu, para não ver sempre os mesmos vídeos.
const SESSION_SEED = Math.floor(Math.random() * 1e9);
function seededShuffle(list, seed) {
  const a = list.slice();
  let x = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const j = x % (i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
function unseen(metas) {
  const fresh = metas.filter((m) => !addons.wasOpened(m.id));
  return fresh.length >= 6 ? fresh : metas;
}

// Cor de cada categoria (sempre a mesma para o mesmo nome), em tons que combinam com a área NSFW.
const CAT_HUES = [330, 345, 300, 280, 255, 228, 205, 350, 315];
function catColor(name) {
  let n = 0;
  for (let i = 0; i < name.length; i++) n = (n * 31 + name.charCodeAt(i)) & 0xffff;
  const hue = CAT_HUES[n % CAT_HUES.length];
  return 'linear-gradient(135deg, hsl(' + hue + ',58%,34%) 0%, hsl(' + ((hue + 28) % 360) + ',62%,16%) 100%)';
}

// Cartão de categoria: mesmo formato 16:9 dos vídeos, com o nome grande no lugar da capa.
function categoryTile(label, onSelect, opts) {
  const o = opts || {};
  return h('div.card.wide.cat-tile', { focusable: true, cls: o.all ? 'cat-all' : '', onSelect: onSelect }, [
    h('div.poster-wrap.img-loaded', { style: o.all ? null : { background: catColor(label) } }, [
      h('div.cat-label', null, [h('b', { text: label }), o.sub ? h('span', { text: o.sub }) : null]),
    ]),
  ]);
}

export function NsfwView() {
  const el = h('div.view.nsfw-view', { 'data-stay': '' });
  const scroller = h('div.scroll-y', { 'data-scroll-y': '' });
  const bar = topbar('nsfw', router.goTab);
  const filters = h('div.provider-rail.site-rail', { 'data-group': '', 'data-trap': '' });
  const body = h('div.rows.nsfw-rows');
  scroller.appendChild(bar);
  scroller.appendChild(filters);
  scroller.appendChild(body);
  el.appendChild(scroller);

  // id do site | 'search'. Lembra o último site.
  let scope = store.get('nsfwScope', null);
  let switchTimer = null;
  let pending = [];
  let active = 0;
  let personalSlot = null;

  function scopes() {
    const list = sites();
    const out = list.map((s) => ({ id: s.id, label: s.name, sub: siteSub(s), site: s }));
    if (list.some((s) => s.addons.some((a) => addons.adultCatalogs(a).some((e) => addons.supportsSearch(e.catalog)))))
      out.push({ id: 'search', label: t('Buscar'), sub: t('em todos os sites'), icon: ICON_SEARCH });
    return out;
  }

  function siteSub(s) {
    const cats = siteCategories(s).reduce((n, g) => n + g.cats.length, 0);
    const rows = s.addons.reduce((acc, a) => acc + addons.adultCatalogs(a).filter((e) => addons.isBoardable(e.catalog)).length, 0);
    const parts = [t(rows === 1 ? '{n} fileira' : '{n} fileiras', { n: rows })];
    if (cats) parts.push(t('{n} categorias', { n: cats }));
    return parts.join(' · ');
  }

  // Marca do site: a dos sites conhecidos, o logo do addon ou as iniciais.
  function siteMark(f) {
    const box = h('div.provider-logo');
    if (f.icon) {
      box.classList.add('img-loaded');
      box.classList.add('icon');
      box.innerHTML = f.icon;
      return box;
    }
    const mark = f.site.mark;
    if (mark) {
      box.classList.add('img-loaded');
      box.appendChild(h('span.mono.site-mark', { text: mark.text, style: { background: mark.bg, color: mark.fg } }));
      return box;
    }
    box.appendChild(h('span.mono', { text: initialsOf(f.label) }));
    const logo = f.site.addons[0].manifest.logo;
    if (logo) {
      const im = h('img', { alt: '' });
      im.onload = () => {
        im.classList.add('ready');
        box.classList.add('img-loaded');
        box.classList.add('has-img');
      };
      im.onerror = () => box.classList.add('img-loaded');
      im.src = logo;
      box.appendChild(im);
    } else box.classList.add('img-loaded');
    return box;
  }

  function renderFilters() {
    clear(filters);
    const list = scopes();
    if (!list.some((f) => f.id === scope)) scope = list.length ? list[0].id : null;
    list.forEach((f) =>
      filters.appendChild(
        h('div.provider.site-tile', { focusable: true, cls: f.id === scope ? 'on' : '', title: f.label, onFocus: () => scheduleSwitch(f.id), onSelect: () => pick(f.id, true) }, [
          siteMark(f),
          h('div.site-text', null, [h('div.provider-name', { text: f.label }), h('div.site-sub', { text: f.sub })]),
        ])
      )
    );
    if (list.length) filters.appendChild(h('div.nsfw-badge.site-18', { text: '18+' }));
  }

  // Parar o foco num site troca o conteúdo (como em Streamings); OK entra nas fileiras.
  function scheduleSwitch(id) {
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => pick(id), 700);
  }

  function pick(id, enter) {
    clearTimeout(switchTimer);
    if (id === scope) {
      const first = enter && body.querySelector('.card, .input');
      if (first) nav.focus(first);
      return;
    }
    scope = id;
    store.set('nsfwScope', id);
    const idx = scopes()
      .map((f) => f.id)
      .indexOf(id);
    renderFilters();
    renderBody();
    if (filters.children[idx]) nav.focus(filters.children[idx], { noScroll: true });
  }

  // Mesma ideia da tela inicial: só busca o catálogo quando a fileira chega perto, 2 por vez.
  function startLoad(p) {
    p.state = 'loading';
    active++;
    p.load().then(() => {
      p.state = 'done';
      active--;
      loadNearby();
    });
  }

  function loadNearby() {
    if (el.offsetParent === null) return;
    const limit = window.innerHeight * 2.2;
    for (let i = 0; i < pending.length && active < 2; i++) {
      const p = pending[i];
      if (p.state !== 'idle') continue;
      if (!p.row.parentNode) {
        p.state = 'done';
        continue;
      }
      if (p.row.getBoundingClientRect().top > limit) break;
      startLoad(p);
    }
  }

  // Arquitetura de cada site, de cima para baixo: o que é seu (Continuar assistindo, Favoritos),
  // as fileiras preferidas (Creampie hétero, gay e lançamentos), as categorias como cartões e as
  // outras fileiras do site. Sem a barra de atalhos: Voltar leva de qualquer ponto aos sites.
  function renderBody() {
    pending = [];
    clear(body);
    if (scope === 'search') return renderSearch();
    const all = sites();
    const site = all.filter((s) => s.id === scope)[0];
    if (!site) {
      body.appendChild(h('div.hint', { text: emptyHint() }));
      return;
    }
    personalSlot = h('div.nsfw-personal');
    body.appendChild(personalSlot);
    renderPersonal(site, all);

    const entries = [];
    site.addons.forEach((a) =>
      addons.adultCatalogs(a).forEach((e) => {
        if (addons.isBoardable(e.catalog) && !tr.isHiddenCategory(e.catalog.name || e.catalog.id)) entries.push(e);
      })
    );
    // Site sem catálogo de creampie (ex.: TPB): usa a busca dele, se tiver.
    if (!entries.some((e) => catalogOrder(e) < 3)) {
      const searchable = [];
      site.addons.forEach((a) => addons.adultCatalogs(a).forEach((e) => addons.supportsSearch(e.catalog) && searchable.push(e)));
      if (searchable.length) {
        entries.unshift(Object.assign({}, searchable[0], { extra: { search: 'gay creampie' }, title: t('Creampie gay'), order: 1 }));
        entries.unshift(Object.assign({}, searchable[0], { extra: { search: 'creampie' }, title: t('Creampie hétero'), order: 0 }));
      }
    }
    const orderOf = (e) => (e.order !== undefined ? e.order : catalogOrder(e));
    const ordered = entries.map((e, i) => ({ e: e, i: i })).sort((a, b) => orderOf(a.e) - orderOf(b.e) || a.i - b.i);
    let catsDone = false;
    ordered.forEach((x) => {
      // Categorias logo depois das fileiras de Creampie: o caminho mais usado depois delas.
      if (orderOf(x.e) >= 3 && !catsDone) {
        catsDone = true;
        categoryRows(site);
      }
      pending.push(Object.assign(catalogRow(x.e, body, orderOf(x.e) < 3), { state: 'idle' }));
    });
    if (!catsDone) categoryRows(site);
    loadVisibleImages(el);
    loadNearby();
  }

  // Favoritos e Continuar assistindo, só com o que é deste site (refeito ao voltar dos detalhes).
  function renderPersonal(site, all) {
    if (!personalSlot) return;
    clear(personalSlot);
    const mine = (id) => !!id && belongsTo(site, all, id);
    const lib = stremio.cachedLibrary().filter((it) => addons.isAdultId(it._id) && it.name && mine(it._id));
    const watching = lib
      .filter((it) => (!it.removed || it.temp) && it.state && it.state.timeOffset > 0)
      .sort((a, b) => String(b.state.lastWatched || '').localeCompare(String(a.state.lastWatched || '')));
    const favs = nsfwSaved.list().filter((it) => mine(it.id));
    lib.filter((it) => !it.removed && !it.temp && watching.indexOf(it) < 0 && !favs.some((f) => f.id === it._id)).forEach((it) =>
      favs.push({ id: it._id, type: it.type, name: it.name, poster: it.poster, posterShape: it.posterShape })
    );
    if (watching.length)
      staticRow(
        t('Continuar assistindo'),
        '',
        watching.slice(0, ROW_LIMIT).map((it) => {
          const s = it.state;
          const left = s.duration ? Math.max(1, Math.round((s.duration - s.timeOffset) / 60000)) : 0;
          return card(
            { id: it._id, type: it.type, name: it.name, poster: it.poster },
            {
              wide: true,
              rich: true,
              image: it.background || it.poster,
              duration: left ? t('faltam {n} min', { n: left }) : '',
              progress: s.duration ? s.timeOffset / s.duration : 0,
              onSelect: () => openDetails(it.type, it._id, { videoId: s.video_id, autoStreams: true }, { name: it.name, poster: it.poster }),
            }
          );
        })
      );
    if (favs.length)
      staticRow(
        t('Favoritos'),
        t(favs.length === 1 ? '{n} vídeo' : '{n} vídeos', { n: favs.length }),
        favs.slice(0, 40).map((it) =>
          card(it, { wide: it.posterShape !== 'poster', rich: true, image: it.posterShape !== 'poster' ? it.poster : undefined, onSelect: () => openDetails(it.type, it.id, null, it) })
        )
      );
    loadVisibleImages(personalSlot);
  }

  function staticRow(title, sub, cards) {
    const track = h('div.row-track', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, cards);
    const row = h('div.row', { 'data-anchor': '30' }, [h('div.row-title', null, [title, sub ? h('small', { text: sub }) : null]), track]);
    personalSlot.appendChild(row);
    return row;
  }

  // Categorias do site como cartões 16:9 (uma fileira por grupo: "Categorias", "Categorias gay").
  // OK abre a grade com todas as categorias do grupo numa lista ao lado, para trocar ali mesmo.
  function categoryRows(site) {
    siteCategories(site).forEach((group) => {
      const tiles = group.cats.map((c, i) => categoryTile(tr.genre(c.g), () => router.push(GridView(c.e, { genre: c.g }, group, i))));
      const track = h('div.row-track.cat-track', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, tiles);
      body.appendChild(
        h('div.row.nsfw-cats', { 'data-anchor': '30' }, [h('div.row-title', null, [group.title, h('small', { text: t('{n} categorias', { n: group.cats.length }) })]), track])
      );
    });
  }

  // Busca só nos catálogos adultos (a aba Buscar do app não mostra nada daqui).
  function renderSearch() {
    const input = h('input.input', { type: 'text', placeholder: t('Buscar em todos os sites...'), focusable: true });
    const go = h('div.btn.primary.search-go', { focusable: true, text: t('Buscar'), onSelect: () => run(input.value) });
    const results = h('div.rows');
    input.__submit = (q) => run(q);
    body.appendChild(h('div.search-box', { 'data-group': '' }, [input, go]));
    body.appendChild(results);
    let token = 0;
    function run(q) {
      const query = (q || '').trim();
      clear(results);
      if (query.length < 2) return results.appendChild(h('div.hint', { text: t('Digite pelo menos 2 letras e aperte Buscar.') }));
      const my = ++token;
      const cats = [];
      addons.adultAddons().forEach((a) => addons.adultCatalogs(a).forEach((e) => addons.supportsSearch(e.catalog) && cats.push(e)));
      let left = cats.length;
      let found = 0;
      cats.forEach((entry) => {
        const track = h('div.row-track', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' });
        const row = h('div.row', { 'data-anchor': '30' }, [h('div.row-title', null, [siteName(entry.addon), h('small', { text: catName(entry) })]), track]);
        addons
          .fetchCatalog(entry, { search: query })
          .then((metas) => {
            if (my !== token || !metas.length) return;
            found++;
            metas.slice(0, 30).forEach((m) => track.appendChild(itemCard(m, entry)));
            results.appendChild(row);
            loadVisibleImages(row);
          })
          .catch(() => {})
          .then(() => {
            if (--left === 0 && my === token && !found) results.appendChild(h('div.hint', { text: t('Nada encontrado para "{q}".', { q: query }) }));
          });
      });
    }
    nav.focus(input);
  }

  function render() {
    lastKey = providersKey();
    // O site do filtro pode ter sido desmarcado em Ajustes.
    if (!scopes().some((f) => f.id === scope)) scope = store.get('nsfwScope', null);
    renderFilters();
    renderBody();
  }

  body.appendChild(h('div.hint', { text: t('Carregando addons...') }));
  let ready = false;

  // Sem site: explica o porquê (o XVideos e o Pornhub vêm do serviço do Seraflix na TV).
  function emptyHint() {
    const st = addons.tubeStatus();
    if (st === 'searching') return t('Procurando os provedores no serviço da TV...');
    if (st === 'old') return t('O serviço da TV está numa versão antiga. Já pedi ao TizenBrew a versão nova; os provedores aparecem aqui em alguns segundos.');
    return t('O serviço do Seraflix na TV não respondeu. Abra o TizenBrew, confira se o Seraflix está na lista de serviços e abra o app de novo. Continuo procurando.');
  }

  // Sites que chegam depois (serviço da TV ligou atrasado) ou mudaram: refaz a aba.
  let lastKey = null;
  const providersKey = () =>
    addons.tubeStatus() +
    '|' +
    addons
      .adultAddons()
      .map((a) => a.manifest.id + '@' + (a.manifest.catalogs || []).length)
      .join(',');
  const stopWatch = addons.onChange(() => {
    if (!ready) return;
    const key = providersKey();
    if (key === lastKey) return;
    const cur = nav.current();
    const hadFocus = cur && el.contains(cur);
    render();
    if (hadFocus) onRail();
  });

  const onRail = () => {
    const target = filters.querySelector('.provider.on') || filters.firstChild;
    if (target) nav.focus(target);
  };

  // Como em Streamings: ↓ da barra de cima vai para os sites, e ↑ do primeiro item do conteúdo volta para eles.
  function onKey(e) {
    const cur = nav.current();
    if (!cur || !filters.firstChild) return false;
    if (e.keyCode === KEY.DOWN && cur.closest('.topbar')) {
      onRail();
      return true;
    }
    if (e.keyCode === KEY.UP && body.contains(cur)) {
      const firstRow = body.querySelector('.card, .input');
      const top = firstRow ? firstRow.getBoundingClientRect().top : 0;
      if (Math.abs(cur.getBoundingClientRect().top - top) < 10) {
        onRail();
        return true;
      }
    }
    return false;
  }

  // Voltar não sai da aba sem querer: do conteúdo vai para os sites; dos sites, pergunta.
  function onBack() {
    const cur = nav.current();
    if (cur && body.contains(cur) && filters.firstChild) {
      onRail();
      scroller.scrollTop = 0;
      return true;
    }
    confirmDialog(t('Sair da área NSFW?'), t('Sair'), () => router.goHome(), { safe: true, cancelLabel: t('Ficar') });
    return true;
  }

  return {
    el: el,
    onKey: onKey,
    onBack: onBack,
    onShow: () => {
      if (ready) {
        if (scope !== 'search') {
          const all = sites();
          const site = all.filter((s) => s.id === scope)[0];
          // Favoritos/Continuar mudam nos detalhes e no player: refaz só essa parte.
          if (site && personalSlot && !personalSlot.contains(nav.current())) renderPersonal(site, all);
        }
        return loadNearby();
      }
      addons.load().then(() => {
        ready = true;
        render();
        onRail(); // a aba abre com o site atual em foco
      });
    },
    onScroll: () => loadNearby(),
    onHide: () => stopPreview(),
    destroy: () => {
      stopPreview();
      stopWatch();
      clearTimeout(switchTimer);
      if (bar.__destroy) bar.__destroy();
    },
  };
}

// Categorias do site em grupos ("Categorias", "Categorias gay"), sem repetir dentro do grupo:
// [{ title, cats: [{ e: catálogo, g: categoria }] }]. Vêm do extra "genre" dos catálogos.
function siteCategories(site) {
  const groups = [];
  site.addons.forEach((a) =>
    addons.adultCatalogs(a).forEach((e) => {
      const opts = addons.genreOptions(e.catalog);
      if (!opts.length) return;
      const title = /gay/i.test((e.catalog.name || '') + ' ' + (e.catalog.id || '')) ? t('Categorias gay') : t('Categorias');
      let g = groups.filter((x) => x.title === title)[0];
      if (!g) {
        g = { title: title, cats: [], seen: {} };
        groups.push(g);
      }
      opts.forEach((name) => {
        if (g.seen[name] || tr.isHiddenCategory(name)) return;
        g.seen[name] = true;
        g.cats.push({ e: e, g: name });
      });
    })
  );
  return groups.filter((g) => g.cats.length);
}

// Nome do catálogo em português ("Top Rated" → "Mais bem avaliados").
function catName(entry) {
  return entry.title || tr.genre(entry.catalog.name || entry.catalog.id);
}

// discovery: fileira de descoberta (Creampie) — duas páginas, misturadas e sem o que já foi aberto.
function catalogRow(entry, parent, discovery) {
  const row = h('div.row', { 'data-anchor': '30' });
  const sub = entry.extra && entry.extra.search ? t('busca no {site}', { site: siteName(entry.addon) }) : ROW_SUB[entry.catalog.id] ? t(ROW_SUB[entry.catalog.id]) : siteName(entry.addon);
  const track = h('div.row-track.pending', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, skeletonCards(6, wideCatalog(entry)));
  row.appendChild(h('div.row-title', null, [catName(entry), h('small', { text: sub })]));
  row.appendChild(track);
  parent.appendChild(row);
  const out = { row: row };
  const fetchRow = () =>
    retrying(() => addons.fetchCatalog(entry, entry.extra)).then((first) => {
      if (!discovery || !first.length) return first;
      return addons
        .fetchCatalog(entry, Object.assign({ skip: first.length }, entry.extra))
        .catch(() => [])
        .then((second) => {
          const ids = {};
          const both = first.concat(second).filter((m) => !ids[m.id] && (ids[m.id] = true));
          return seededShuffle(unseen(both), SESSION_SEED + entry.catalog.id.length);
        });
    });
  const load = () =>
    fetchRow()
      .then((metas) => {
        clear(track);
        track.classList.remove('pending');
        if (!metas.length) {
          if (row.parentNode) row.parentNode.removeChild(row);
          return;
        }
        metas.slice(0, ROW_LIMIT).forEach((m) => track.appendChild(itemCard(m, entry)));
        if (metas.length >= ROW_LIMIT) track.appendChild(seeAllCard({ label: catName(entry), wide: wideCatalog(entry), onSelect: () => router.push(GridView(entry, entry.extra || {})) }));
        loadVisibleImages(row);
      })
      .catch(() => showRetry(track, () => load()));
  out.load = load;
  return out;
}

// Grade com o catálogo inteiro (opcionalmente filtrado por categoria ou busca), paginada pelo "skip".
// Nas categorias de hentai, um subfiltro separa os títulos "uncensored" dos demais.
const UNCENSORED_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'uncensored', label: 'Só uncensored' },
  { id: 'censored', label: 'Sem uncensored' },
];
const FILTER_KEEP = {
  all: () => true,
  uncensored: (m) => isUncensored(m),
  censored: (m) => !isUncensored(m),
};

// group/at: grupo de categorias do site e a atual. Com ele, a grade ganha a lista de categorias à
// esquerda (como as estantes de gênero dos streamings): parar numa categoria troca a grade e →
// entra nela; Voltar da grade volta para a lista, e da lista sai.
function GridView(entry, extra, group, at) {
  const el = h('div.view.nsfw-view.nsfw-grid-view', { 'data-stay': '' });
  const crumb = h('div.reco-crumb');
  const filterRow = h('div.row.nsfw-filter', { 'data-anchor': '30' });
  const slot = h('div');
  const hasSide = !!(group && group.cats.length > 1);
  const main = h('div.scroll-y.nsfw-grid-main', { 'data-scroll-y': '', cls: hasSide ? 'with-side' : '' }, [crumb, filterRow, slot]);
  let side = null;
  let mode = 'all';
  let pg = null;
  let isHentai = false;
  let switchTimer = null;

  // Busca uma página do catálogo; no filtro, junta páginas até ter o bastante (ou o catálogo acabar).
  function fetcher() {
    let skip = 0;
    const keep = FILTER_KEEP[mode];
    const e = entry;
    const x = extra;
    return function load() {
      const got = [];
      const step = (tries) =>
        addons.fetchCatalog(e, Object.assign({ skip: skip || undefined }, x)).then((metas) => {
          skip += metas.length;
          metas.forEach((m) => keep(m) && got.push(m));
          if (!metas.length || got.length >= 20 || tries >= 5) return got;
          return step(tries + 1);
        });
      return step(0);
    };
  }

  // stay: trocou de categoria pela lista do lado; o foco continua nela.
  function build(stay) {
    stopPreview();
    if (pg) pg.destroy();
    const load = fetcher();
    const e = entry;
    pg = pagedGrid({
      autoFocus: !stay,
      load: load,
      key: (m) => m.id,
      card: (m) => itemCard(m, e),
      skeleton: () => skeletonCards(hasSide ? 6 : 8, wideCatalog(e)),
      onEmpty: () => pg.el.insertBefore(h('div.hint', { text: t('Nada por aqui.') }), pg.el.firstChild),
    });
    clear(slot);
    slot.appendChild(pg.el);
    main.scrollTop = 0;
  }

  function renderHead() {
    const title = extra.genre ? tr.genre(extra.genre) : catName(entry);
    clear(crumb);
    const trail = 'NSFW › ' + siteName(entry.addon) + ' › ' + (group ? group.title + ' › ' : '');
    [h('span', { text: trail }), h('b', { text: title })].forEach((n) => crumb.appendChild(n));
    isHentai = /hentai/i.test((extra.genre || '') + ' ' + catName(entry));
    clear(filterRow);
    filterRow.style.display = isHentai ? '' : 'none';
    if (!isHentai) return;
    const chips = UNCENSORED_FILTERS.map((f) =>
      h('div.chip', {
        focusable: true,
        cls: f.id === mode ? 'active' : '',
        text: t(f.label),
        onSelect: () => {
          if (f.id === mode) return;
          mode = f.id;
          chips.forEach((c, i) => c.classList.toggle('active', UNCENSORED_FILTERS[i].id === mode));
          build();
          pg.start();
        },
      })
    );
    filterRow.appendChild(h('div.chip-track', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, chips));
  }

  function choose(i) {
    clearTimeout(switchTimer);
    if (i === at) return;
    at = i;
    const c = group.cats[i];
    Array.prototype.forEach.call(side.children, (x, j) => x.classList.toggle('active', j === at));
    entry = c.e;
    extra = { genre: c.g };
    mode = 'all';
    renderHead();
    build(true);
    pg.start();
  }

  if (hasSide) {
    side = h(
      'div.nsfw-side',
      { 'data-scroll-y': '', 'data-pad-y': '200', 'data-group': '', 'data-vertical': '' },
      group.cats.map((c, i) =>
        h('div.side-item', {
          focusable: true,
          cls: i === at ? 'active' : '',
          'data-autofocus': i === at ? '' : undefined,
          text: tr.genre(c.g),
          // Parar numa categoria troca a grade (como os sites no topo da aba); OK entra na grade.
          onFocus: () => {
            clearTimeout(switchTimer);
            switchTimer = setTimeout(() => choose(i), 650);
          },
          onSelect: () => {
            choose(i);
            const first = slot.querySelector('.card:not(.skeleton)');
            if (first) nav.focus(first);
          },
        })
      )
    );
    side.__last = side.children[at];
    el.appendChild(h('div.nsfw-side-wrap', null, [h('div.side-title', { text: group.title }), side]));
  }
  renderHead();
  build();
  el.appendChild(main);
  return {
    el: el,
    onShow: () => {
      pg.start();
      if (side && side.children[at]) setTimeout(() => nav.ensureVisible(side.children[at]), 0);
    },
    onBack: () => {
      const cur = nav.current();
      if (side && cur && main.contains(cur)) {
        nav.focus(side.children[at]);
        return true;
      }
      return false;
    },
    onHide: () => stopPreview(),
    destroy: () => {
      clearTimeout(switchTimer);
      stopPreview();
    },
  };
}
