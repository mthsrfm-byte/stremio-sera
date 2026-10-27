// Aba NSFW: tudo que vem dos addons adultos, separado do resto do app.
// Organização: trilho de provedores no topo (Tudo / cada addon / Buscar, como em Streamings) e, dentro dele,
// 1) Continuar assistindo e Minha lista, 2) uma seção por addon com as fileiras dos catálogos
// (cada uma com "Ver tudo") e 3) as categorias do addon como chips que abrem a grade filtrada.
import { h, clear, loadVisibleImages } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import { KEY } from '../lib/nav.js';
import * as addons from '../api/addons.js';
import * as stremio from '../api/stremio.js';
import { topbar, card, skeletonCards, retrying, pagedGrid } from '../ui.js';
import * as router from '../router.js';
import { openDetails as openDetailsRaw } from './details.js';
import { showRetry } from './recommended.js';
import { t } from '../lib/i18n.js';
import * as tr from '../lib/translate.js';
import * as store from '../lib/store.js';

const ROW_LIMIT = 20;
const ICON_ALL = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';

// "TPB 4K Porn" → "TP"; usado quando o addon não tem logo.
function initialsOf(name) {
  const words = String(name || '?')
    .replace(/[^A-Za-z0-9À-ú+ ]/g, ' ')
    .trim()
    .split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

// Tudo que abre daqui fica marcado como adulto (some do resto do app).
function openDetails(type, id, opts) {
  addons.markAdult(id);
  openDetailsRaw(type, id, opts);
}

// Cartão do catálogo: vídeos com capa deitada (posterShape "landscape") usam o cartão largo.
function itemCard(m, entry) {
  const wide = m.posterShape === 'landscape' || (entry && entry.catalog.posterShape === 'landscape');
  return card(m, { wide: wide, image: wide ? m.poster || m.background : undefined, onSelect: () => openDetails(m.type || entry.catalog.type, m.id) });
}

export function NsfwView() {
  const el = h('div.view.nsfw-view');
  const scroller = h('div.scroll-y', { 'data-scroll-y': '' });
  const bar = topbar('nsfw', router.goTab);
  // Trilho de provedores (como em Streamings): cada addon adulto com o logo; o escolhido abre o nome.
  const filters = h('div.provider-rail.nsfw-rail', { 'data-group': '', 'data-trap': '' });
  const nowEl = h('div.nsfw-now');
  const body = h('div.rows');
  scroller.appendChild(bar);
  scroller.appendChild(h('div.page-head.nsfw-head', null, [h('h1.page-title', null, [t('NSFW'), h('span.nsfw-badge', { text: '18+' })]), nowEl]));
  scroller.appendChild(filters);
  scroller.appendChild(body);
  el.appendChild(scroller);

  // 'all' | id do addon | 'search'. Lembra o último provedor (para comparar addons com calma).
  let scope = store.get('nsfwScope', null);
  let switchTimer = null;
  let pending = [];
  let active = 0;

  function scopes() {
    const list = addons.adultAddons();
    const out = [];
    if (list.length > 1) out.push({ id: 'all', label: t('Tudo'), sub: t('{n} provedores', { n: list.length }), icon: ICON_ALL });
    list.forEach((a) => out.push({ id: a.manifest.id, label: a.manifest.name || a.manifest.id, sub: catalogCount(a), addon: a }));
    if (list.some((a) => addons.adultCatalogs(a).some((e) => addons.supportsSearch(e.catalog))))
      out.push({ id: 'search', label: t('Buscar'), sub: t('em todos os provedores'), icon: ICON_SEARCH });
    return out;
  }

  function catalogCount(a) {
    const n = addons.adultCatalogs(a).filter((e) => addons.isBoardable(e.catalog)).length;
    return t(n === 1 ? '{n} catálogo' : '{n} catálogos', { n: n });
  }

  // Logo do addon (manifest.logo); sem logo, as iniciais num quadrado colorido.
  function pillLogo(f) {
    const box = h('div.provider-logo');
    if (f.icon) {
      box.classList.add('img-loaded', 'icon');
      box.innerHTML = f.icon;
      return box;
    }
    box.appendChild(h('span.mono', { text: initialsOf(f.label) }));
    const logo = f.addon.manifest.logo;
    if (logo) {
      const im = h('img', { alt: '' });
      im.onload = () => {
        im.classList.add('ready');
        box.classList.add('img-loaded', 'has-img');
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
    if (!list.some((f) => f.id === scope)) scope = list.length ? list[0].id : 'all';
    list.forEach((f) =>
      filters.appendChild(
        h('div.provider', { focusable: true, cls: f.id === scope ? 'on' : '', title: f.label, onFocus: () => scheduleSwitch(f.id), onSelect: () => pick(f.id, true) }, [
          pillLogo(f),
          h('div.provider-name', { text: f.label }),
        ])
      )
    );
    const cur = list.filter((f) => f.id === scope)[0];
    nowEl.textContent = cur ? (cur.addon ? t('Provedor: {name}', { name: cur.label }) : cur.label) + '  ·  ' + cur.sub : '';
  }

  // Parar o foco num provedor troca o conteúdo (como em Streamings); OK entra nas fileiras.
  function scheduleSwitch(id) {
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => pick(id), 450);
  }

  function pick(id, enter) {
    clearTimeout(switchTimer);
    if (id === scope) {
      const first = enter && body.querySelector('[data-focus]');
      if (first) nav.focus(first);
      return;
    }
    scope = id;
    store.set('nsfwScope', id);
    const idx = scopes()
      .map((f) => f.id)
      .indexOf(id);
    renderFilters();
    body.classList.add('sw');
    renderBody();
    requestAnimationFrame(() => requestAnimationFrame(() => body.classList.remove('sw')));
    if (filters.children[idx]) nav.focus(filters.children[idx], { noScroll: true });
  }

  // Mesma ideia da tela inicial: só busca o catálogo quando a fileira chega perto, 2 por vez.
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
      p.state = 'loading';
      active++;
      p.load().then(() => {
        p.state = 'done';
        active--;
        loadNearby();
      });
    }
  }

  function renderBody() {
    pending = [];
    clear(body);
    if (scope === 'search') return renderSearch();
    const list = addons.adultAddons().filter((a) => scope === 'all' || a.manifest.id === scope);
    if (!list.length) {
      body.appendChild(h('div.hint', { text: t('Nenhum addon adulto encontrado. Marque um addon em Ajustes › NSFW.') }));
      return;
    }
    personalRows();
    list.forEach((addon) => {
      if (scope === 'all' && addons.adultAddons().length > 1) body.appendChild(h('div.nsfw-section', { text: addon.manifest.name || addon.manifest.id }));
      const entries = addons.adultCatalogs(addon);
      // Categorias antes das fileiras: é o atalho mais usado, fica perto do topo.
      genreStrip(entries);
      entries
        .filter((e) => addons.isBoardable(e.catalog) && !tr.isHiddenCategory(e.catalog.name || e.catalog.id))
        .forEach((e) => pending.push(Object.assign(catalogRow(e, body), { state: 'idle' })));
    });
    loadVisibleImages(el);
    loadNearby();
  }

  // Continuar assistindo + Minha lista, só com o que veio dos addons adultos.
  function personalRows() {
    const lib = stremio.cachedLibrary().filter((it) => addons.isAdultId(it._id) && it.name);
    const watching = lib
      .filter((it) => (!it.removed || it.temp) && it.state && it.state.timeOffset > 0)
      .sort((a, b) => String(b.state.lastWatched || '').localeCompare(String(a.state.lastWatched || '')));
    const saved = lib.filter((it) => !it.removed && !it.temp && watching.indexOf(it) < 0);
    if (watching.length)
      staticRow(
        t('Continuar assistindo'),
        watching.slice(0, ROW_LIMIT).map((it) =>
          card(
            { name: it.name, poster: it.poster },
            {
              wide: true,
              image: it.background || it.poster,
              progress: it.state.duration ? it.state.timeOffset / it.state.duration : 0,
              onSelect: () => openDetails(it.type, it._id, { videoId: it.state.video_id, autoStreams: true }),
            }
          )
        )
      );
    if (saved.length)
      staticRow(
        t('Minha lista'),
        saved.slice(0, ROW_LIMIT).map((it) => card({ name: it.name, poster: it.poster }, { onSelect: () => openDetails(it.type, it._id) }))
      );
  }

  function staticRow(title, cards) {
    const track = h('div.row-track', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, cards);
    body.appendChild(h('div.row', { 'data-anchor': '30' }, [h('div.row-title', { text: title }), track]));
  }

  // Categorias do addon (gêneros dos catálogos), sem repetir, como chips que abrem a grade.
  function genreStrip(entries) {
    const seen = {};
    const chips = [];
    entries.forEach((e) =>
      addons.genreOptions(e.catalog).forEach((g) => {
        if (seen[g] || tr.isHiddenCategory(g)) return;
        seen[g] = true;
        chips.push(h('div.chip', { focusable: true, text: tr.genre(g), onSelect: () => router.push(GridView(e, { genre: g })) }));
      })
    );
    if (!chips.length) return;
    body.appendChild(
      h('div.row.nsfw-genres', { 'data-anchor': '30' }, [
        h('div.row-title', { text: t('Categorias') }),
        h('div.chip-track', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, chips),
      ])
    );
  }

  // Busca só nos catálogos adultos (a aba Buscar do app não mostra nada daqui).
  function renderSearch() {
    const input = h('input.input', { type: 'text', placeholder: t('Buscar...'), focusable: true });
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
        const row = h('div.row', { 'data-anchor': '30' }, [h('div.row-title', null, [catName(entry), h('small', { text: entry.addon.manifest.name || '' })]), track]);
        addons
          .fetchCatalog(entry, { search: query })
          .then((metas) => tr.titles(metas.slice(0, 30)))
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
    // O addon do filtro pode ter sido desmarcado em Ajustes.
    if (!scopes().some((f) => f.id === scope)) scope = 'all';
    renderFilters();
    renderBody();
  }

  body.appendChild(h('div.hint', { text: t('Carregando addons...') }));
  let ready = false;

  const onRail = () => nav.focus(filters.querySelector('.provider.on') || filters.firstChild);

  // Como em Streamings: ↓ da barra de cima vai para o trilho de provedores, e ↑ do primeiro item
  // do conteúdo volta para ele.
  function onKey(e) {
    const cur = nav.current();
    if (!cur || !filters.firstChild) return false;
    if (e.keyCode === KEY.DOWN && cur.closest('.topbar')) {
      onRail();
      return true;
    }
    if (e.keyCode === KEY.UP && body.contains(cur)) {
      const firstRow = body.querySelector('[data-focus]');
      const top = firstRow ? firstRow.getBoundingClientRect().top : 0;
      if (Math.abs(cur.getBoundingClientRect().top - top) < 10) {
        onRail();
        return true;
      }
    }
    return false;
  }

  return {
    el: el,
    onKey: onKey,
    onShow: () => {
      if (ready) return loadNearby();
      addons.load().then(() => {
        ready = true;
        render();
        onRail(); // a aba abre com o provedor atual em foco
      });
    },
    onScroll: () => loadNearby(),
    destroy: () => {
      clearTimeout(switchTimer);
      if (bar.__destroy) bar.__destroy();
    },
  };
}

// Nome do catálogo em português ("Top Rated" → "Mais bem avaliados").
function catName(entry) {
  return tr.genre(entry.catalog.name || entry.catalog.id);
}

function catalogRow(entry, parent) {
  const row = h('div.row', { 'data-anchor': '30' });
  const typeName = addons.catalogTitle(entry).split(' · ').pop();
  const track = h('div.row-track.pending', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, skeletonCards());
  row.appendChild(h('div.row-title', null, [catName(entry), h('small', { text: typeName + ' · ' + (entry.addon.manifest.name || '') })]));
  row.appendChild(track);
  parent.appendChild(row);
  const load = () =>
    retrying(() => addons.fetchCatalog(entry))
      .then((metas) => tr.titles(metas.slice(0, ROW_LIMIT)).then((list) => list.concat(metas.slice(ROW_LIMIT))))
      .then((metas) => {
        clear(track);
        track.classList.remove('pending');
        if (!metas.length) {
          if (row.parentNode) row.parentNode.removeChild(row);
          return;
        }
        metas.slice(0, ROW_LIMIT).forEach((m) => track.appendChild(itemCard(m, entry)));
        if (metas.length > ROW_LIMIT)
          track.appendChild(
            h('div.card.see-all', { focusable: true, onSelect: () => router.push(GridView(entry, {})) }, [
              h('div.poster-wrap', null, h('div.see-all-label', null, [h('b', { text: t('Ver tudo') }), h('span', { text: catName(entry) })])),
            ])
          );
        loadVisibleImages(row);
      })
      .catch(() => showRetry(track, () => load()));
  return { row: row, load: load };
}

// Grade com o catálogo inteiro (opcionalmente filtrado por categoria), paginada pelo "skip".
function GridView(entry, extra) {
  const el = h('div.view.nsfw-view');
  const scroller = h('div.scroll-y', { 'data-scroll-y': '' });
  const crumb = [h('span', { text: 'NSFW › ' + (entry.addon.manifest.name || '') }), ' › ', h('b', { text: extra.genre ? tr.genre(extra.genre) : catName(entry) })];
  let skip = 0;
  const pg = pagedGrid({
    load: () =>
      addons.fetchCatalog(entry, Object.assign({ skip: skip || undefined }, extra)).then((metas) => {
        skip += metas.length;
        return tr.titles(metas);
      }),
    key: (m) => m.id,
    card: (m) => itemCard(m, entry),
    onEmpty: () => pg.el.insertBefore(h('div.hint', { text: t('Nada por aqui.') }), pg.el.firstChild),
  });
  scroller.appendChild(h('div.reco-crumb', null, crumb));
  scroller.appendChild(pg.el);
  el.appendChild(scroller);
  return {
    el: el,
    onShow: () => pg.start(),
  };
}
