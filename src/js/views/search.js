// Busca em todos os catálogos de addons que aceitam "search".
import { h, clear, loadVisibleImages } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import * as addons from '../api/addons.js';
import { topbar, card, skeletonCards } from '../ui.js';
import * as router from '../router.js';
import { openDetails } from './details.js';
import { t } from '../lib/i18n.js';

const SEARCH_AT_ONCE = 2; // catálogos de addon consultados ao mesmo tempo

export function SearchView() {
  const el = h('div.view');
  const scroller = h('div.scroll-y', { 'data-scroll-y': '' });
  const bar = topbar('search', router.goTab);
  const input = h('input.input', { type: 'text', placeholder: t('Buscar filmes e séries...'), focusable: true, 'data-autofocus': '' });
  const go = h('div.btn.primary.search-go', { focusable: true, text: t('Buscar'), onSelect: () => run(input.value) });
  const results = h('div.rows');
  scroller.appendChild(bar);
  scroller.appendChild(h('div.search-box', { 'data-group': '' }, [input, go]));
  scroller.appendChild(results);
  el.appendChild(scroller);

  // Cada busca ganha um número; a anterior (ou qualquer uma, ao sair da tela) para de aparecer e
  // de pedir catálogos novos.
  let token = 0;
  input.__submit = (q) => run(q);

  function run(q) {
    const my = ++token;
    const query = (q || '').trim();
    clear(results);
    if (query.length < 2) {
      results.appendChild(h('div.hint', { text: t('Digite pelo menos 2 letras e aperte Buscar.') }));
      return;
    }
    results.appendChild(h('div.row', null, [h('div.row-title', { text: t('Buscando "{q}"...', { q: query }) }), h('div.row-track', null, skeletonCards())]));
    addons.load().then(() => {
      if (my !== token) return;
      clear(results);
      const cats = addons.searchCatalogs();
      if (!cats.length) results.appendChild(h('div.hint', { text: t('Nenhum addon com busca instalado.') }));
      let found = 0;
      let pending = cats.length;
      let next = 0;
      let active = 0;
      // Fila: 2 catálogos ao mesmo tempo (todos juntos engasgavam a TV).
      const pump = () => {
        while (my === token && active < SEARCH_AT_ONCE && next < cats.length) {
          const entry = cats[next++];
          active++;
          searchOne(entry).then(() => {
            active--;
            pump();
          });
        }
      };
      const searchOne = (entry) => {
        const row = h('div.row', { 'data-anchor': '30' });
        const track = h('div.row-track', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' });
        row.appendChild(h('div.row-title', null, [entry.catalog.name || entry.catalog.id, h('small', { text: addons.catalogTitle(entry).split(' · ').pop() })]));
        row.appendChild(track);
        return addons
          .fetchCatalog(entry, { search: query })
          .then((metas) => {
            if (my !== token || !metas.length) return;
            found++;
            metas.slice(0, 30).forEach((m) => track.appendChild(card(m, { onSelect: () => openDetails(m.type || entry.catalog.type, m.id) })));
            results.appendChild(row);
            loadVisibleImages(row);
          })
          .catch(() => {})
          .then(() => {
            pending--;
            if (my === token && pending === 0 && !found) results.appendChild(h('div.hint', { text: t('Nada encontrado para "{q}".', { q: query }) }));
          });
      };
      pump();
    });
  }

  run('');

  return {
    el: el,
    destroy: () => {
      token++; // para as buscas em andamento
      bar.__destroy && bar.__destroy();
    },
    focusInput: () => nav.focus(input),
  };
}
