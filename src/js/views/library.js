// Biblioteca da conta Stremio, com filtro por tipo.
import { h, clear } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import * as stremio from '../api/stremio.js';
import * as addons from '../api/addons.js';
import { topbar, card, spinnerLine, pagedGrid } from '../ui.js';
import * as router from '../router.js';
import { openDetails } from './details.js';
import { t } from '../lib/i18n.js';

const FILTERS = [
  { id: 'all', label: 'Tudo' },
  { id: 'movie', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
];
const PAGE = 36; // capas por lote; o resto entra ao chegar perto do fim

// Mais recente primeiro. _mtime é ISO, então a comparação simples dá a mesma ordem do localeCompare.
function newestFirst(a, b) {
  const x = String(a._mtime || '');
  const y = String(b._mtime || '');
  return x < y ? 1 : x > y ? -1 : 0;
}

export function LibraryView() {
  const el = h('div.view');
  const scroller = h('div.scroll-y', { 'data-scroll-y': '' });
  const bar = topbar('library', router.goTab);
  const filters = h('div.filters', { 'data-group': '' });
  const holder = h('div');
  scroller.appendChild(bar);
  // Cabeçalho da página: título à esquerda, filtros à direita na mesma linha.
  scroller.appendChild(h('div.page-head', null, [h('h1.page-title', { text: t('Biblioteca') }), filters]));
  scroller.appendChild(holder);
  el.appendChild(scroller);

  let filter = 'all';
  let sig = null; // assinatura da lista mostrada: só redesenha se ela mudou
  let pg = null; // grade em lotes atual
  let alive = true;

  function renderFilters() {
    clear(filters);
    FILTERS.forEach((f) =>
      filters.appendChild(
        h('div.chip', {
          focusable: true,
          cls: f.id === filter ? 'active' : '',
          text: t(f.label),
          onSelect: () => {
            filter = f.id;
            renderFilters();
            renderGrid();
            nav.focus(filters.children[FILTERS.indexOf(f)]);
          },
        })
      )
    );
  }

  function renderGrid() {
    if (!alive) return;
    const items = stremio
      .cachedLibrary()
      .filter((it) => !it.removed && (filter === 'all' || it.type === filter) && !addons.isAdultId(it._id))
      .sort(newestFirst);
    const s = (stremio.isLoggedIn() ? '1' : '0') + filter + '|' + items.map((it) => it._id + ':' + (it._mtime || '')).join(',');
    if (s === sig) return; // nada mudou: não refaz a grade (o foco e as capas ficam)
    sig = s;
    if (pg) pg.destroy(); // solta a grade anterior (lotes que ainda chegavam)
    pg = null;
    clear(holder);
    if (!items.length) {
      holder.appendChild(h('div.hint', { text: stremio.isLoggedIn() ? t('Sua biblioteca está vazia.') : t('Entre na sua conta em Ajustes para ver a biblioteca.') }));
      return;
    }
    // Em lotes: a biblioteca inteira não vira cartões de uma vez (a TV tem pouca memória e CPU).
    pg = pagedGrid({
      load: (page) => Promise.resolve(items.slice((page - 1) * PAGE, page * PAGE)),
      key: (it) => it._id,
      card: (it) => card({ name: it.name, poster: it.poster }, { onSelect: () => openDetails(it.type, it._id) }),
      autoFocus: false, // o foco fica onde estava (ex.: no filtro escolhido)
    });
    holder.appendChild(pg.el);
    pg.start();
  }

  renderFilters();
  holder.appendChild(spinnerLine(t('Carregando biblioteca...')));

  return {
    el: el,
    onShow: () => {
      renderGrid();
      stremio
        .getLibrary()
        .then(() => renderGrid()) // só redesenha se a biblioteca mudou
        .catch(() => {});
    },
    destroy: () => {
      alive = false;
      if (pg) pg.destroy();
      bar.__destroy && bar.__destroy();
    },
  };
}
