// Filmografia de quem está no elenco: painel à direita como o de episódios, do mais antigo ao
// mais recente, com filtro Tudo / Filmes / Séries. Escolher um título abre os detalhes dele.
import { h, clear, loadVisibleImages } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import * as router from '../router.js';
import * as extras from '../api/extras.js';
import { spinnerLine } from '../ui.js';
import { openItem } from './recommended.js';
import { t } from '../lib/i18n.js';

export function openFilmography(person) {
  if (!person || !person.id) return;
  router.push(FilmographyView(person));
}

const FILTERS = [
  { id: 'all', label: 'Tudo' },
  { id: 'movie', label: 'Filmes' },
  { id: 'tv', label: 'Séries' },
];

function FilmographyView(person) {
  const el = h('div.view.filmo');
  const photo = h('div.filmo-photo');
  if (person.photo) {
    const im = h('img', { alt: '' });
    im.onload = () => photo.classList.add('img-loaded');
    im.onerror = () => (im.style.display = 'none');
    im.src = person.photo.replace('/w185/', '/h632/');
    photo.appendChild(im);
  }
  const countEl = h('div.filmo-count');
  el.appendChild(h('div.filmo-side', null, [photo, h('div.filmo-name', { text: person.name }), countEl]));
  const panel = h('div.details-panel');
  const chips = h('div.seasons', { 'data-group': '' });
  const list = h('div.list', { 'data-scroll-y': '', 'data-pad-y': '120', 'data-group': '', 'data-vertical': '' });
  list.style.top = '190px';
  panel.appendChild(h('div.panel-head', null, h('h2', { text: t('Filmografia') })));
  panel.appendChild(chips);
  panel.appendChild(list);
  el.appendChild(panel);

  let items = null;
  let filter = 'all';

  function renderChips() {
    clear(chips);
    FILTERS.forEach((f, i) =>
      chips.appendChild(
        h('div.chip', {
          focusable: true,
          cls: f.id === filter ? 'active' : '',
          text: t(f.label),
          onSelect: () => {
            filter = f.id;
            renderChips();
            renderList();
            nav.focus(chips.children[i]);
          },
        })
      )
    );
  }

  function renderList() {
    clear(list);
    const shown = items.filter((it) => filter === 'all' || it.mediaType === filter);
    countEl.textContent = t('{n} títulos', { n: items.length });
    if (!shown.length) {
      list.appendChild(h('div.loading-line', { text: t('Nada por aqui.') }));
      return;
    }
    shown.forEach((it) => {
      const thumb = h('div.thumb.poster');
      const im = h('img', { alt: '' });
      im.setAttribute('data-lazy', it.poster);
      im.onerror = () => {
        im.style.display = 'none';
        thumb.classList.add('img-loaded');
      };
      thumb.appendChild(im);
      const sub = [it.year, it.mediaType === 'tv' ? t('Série') : t('Filme')];
      if (it.mediaType === 'tv' && it.episodes) sub.push(t('{n} ep.', { n: it.episodes }));
      list.appendChild(
        h('div.episode.filmo-item', { focusable: true, onSelect: () => openItem(it) }, [
          thumb,
          h('div.ep-info', null, [
            h('div.ep-title', { text: it.name }),
            h('div.ep-sub', { text: sub.join(' · ') }),
            h('div.ep-desc', { text: it.character ? t('como {who}', { who: it.character }) : '' }),
          ]),
        ])
      );
    });
    loadVisibleImages(panel, 300);
  }

  list.appendChild(spinnerLine(t('Carregando filmografia...')));
  extras
    .personCredits(person.id)
    .then((list2) => {
      items = list2;
      renderChips();
      renderList();
      const first = list.querySelector('.episode');
      if (first && router.currentView() === view) nav.focus(first);
    })
    .catch(() => {
      clear(list);
      list.appendChild(h('div.loading-line', { text: t('Não foi possível carregar a filmografia.') }));
    });

  const view = {
    el: el,
    onShow: () => loadVisibleImages(panel, 300),
  };
  return view;
}
