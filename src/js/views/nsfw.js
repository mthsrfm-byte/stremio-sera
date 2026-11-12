// Aba NSFW: tudo que vem dos addons adultos, separado do resto do app.
// Organização por site: no topo, um bloco por site (Pornhub, XVideos e os outros addons; as
// instalações divididas do mesmo addon, como "TPB 4K Porn (1/2)" e "(2/2)", viram um site só) e a
// Busca (XVideos, Pornhub, TPB 4K e outros adultos; PT/EN; listas hétero e gay). Dentro do site:
// Continuar assistindo, Favoritos e Vistos recentemente, Creampie hétero/gay, lançamentos e temas
// da sessão (sorteados a cada abertura e em "Embaralhar"), categorias em cartões e as demais
// fileiras. A categoria abre numa grade com a lista de categorias ao lado.
import { h, clear, loadVisibleImages, $$ } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import { KEY } from '../lib/nav.js';
import * as addons from '../api/addons.js';
import * as stremio from '../api/stremio.js';
import { topbar, card, skeletonCards, statsLine, confirmDialog, seeAllCard, rowRetry, pagedGrid } from '../ui.js';
import * as router from '../router.js';
import { openDetails as openDetailsRaw } from './details.js';
import { showRetry } from './recommended.js';
import { t } from '../lib/i18n.js';
import * as tr from '../lib/translate.js';
import * as store from '../lib/store.js';
import * as nsfwSaved from '../lib/nsfwSaved.js';
import * as nsfwHistory from '../lib/nsfwHistory.js';
import * as nsfwSearch from '../lib/nsfwSearch.js';
import { makeRng, mixSeed, hashStr, shuffleWith, newSeed } from '../lib/nsfwSearch.js';
import { sharpThumb } from '../lib/img.js';

const ROW_LIMIT = 20;
const PAGE_SLOTS = 8; // a página sorteada de uma fileira de descoberta: 0 a 7
const ICON_SEARCH = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
const ICON_SHUFFLE = '<svg viewBox="0 0 24 24"><path d="M16 4h4v4"/><path d="M4 20 20 4"/><path d="M20 16v4h-4"/><path d="m4 4 5 5"/><path d="m15 15 5 5"/></svg>';

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

// Tudo que abre daqui fica marcado como adulto (some do resto do app) e entra nos "Vistos recentemente".
// Muitos addons adultos não têm "meta": os detalhes usam o próprio item do catálogo.
function openDetails(type, id, opts, item) {
  addons.markAdult(id);
  if (item && item.name) nsfwHistory.add(Object.assign({}, item, { id: id, type: type }));
  openDetailsRaw(type, id, Object.assign({ fallbackMeta: item || null }, opts));
}

// Marca o cartão com o id do vídeo (foco se mantém pelo id ao refazer a aba).
function tagVid(c, id) {
  c.setAttribute('data-vid', String(id));
  return c;
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

// Com efeitos reduzidos (body.lowfx, ligado por padrão na TV) não há prévia: só a capa.
function lowfx() {
  return document.body.classList.contains('lowfx');
}

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
  if (lowfx()) return;
  const wrap = cardEl.querySelector('.poster-wrap');
  if (!wrap) return;
  let node = null;
  const timer = setTimeout(() => {
    // Cartão que já saiu da tela não ganha prévia.
    if (!document.body.contains(cardEl)) return stop();
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
    const n = node;
    node = null;
    n.onerror = null;
    n.onload = null;
    if (n.tagName === 'VIDEO') {
      n.pause();
      n.removeAttribute('src');
      n.load(); // solta o decodificador da TV
    }
    if (n.parentNode) n.parentNode.removeChild(n);
  }
  previewStop = stop;
}

// entry: catálogo de origem (null nas listas pessoais e no histórico).
function itemCard(m, entry) {
  const wide = m.posterShape === 'landscape' || (!!entry && entry.catalog.posterShape === 'landscape');
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
      openDetails(m.type || (entry && entry.catalog.type), m.id, null, m);
    },
    onFocus: pv ? () => startPreview(el, pv) : undefined,
  });
  tagVid(el, m.id);
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

// ---------- Descoberta: sorteio das fileiras ----------
// Opções do extra "sort" do catálogo (só se o addon declarar; sem ele, nada é enviado).
function sortOptions(entry) {
  const s = (entry.catalog.extra || []).filter((e) => e && e.name === 'sort')[0];
  return s && s.options && s.options.length ? s.options : [];
}

// Tamanho de página do catálogo (manifesto); sem ele, 20. Os tubes do serviço da TV cortam em 24.
function pageSizeOf(entry) {
  const n = Number(entry && entry.catalog && entry.catalog.pageSize);
  if (n > 0) return n;
  const id = entry && entry.addon && entry.addon.manifest && entry.addon.manifest.id;
  return id === 'seraflix.pornhub' ? 24 : 20;
}

// Chave estável da fileira (site, catálogo, título e filtros): a mesma fileira tem o mesmo sorteio.
function rowKeyOf(entry) {
  const x = entry.extra || {};
  return [entry.addon.transportUrl || entry.addon.manifest.id, entry.catalog.id, entry.title || '', x.search || '', x.orientation || '', x.genre || ''].join('|');
}

// Sort que vale para o catálogo da grade (mantém o da fileira quando o outro catálogo aceita).
function sortFor(entry, value) {
  return value && sortOptions(entry).indexOf(value) >= 0 ? { sort: value } : {};
}

// Vídeos sem repetir (por id), na ordem em que chegaram.
function mergeUnique(lists) {
  const ids = {};
  const out = [];
  lists.forEach((list) =>
    (list || []).forEach((m) => {
      if (!m || !m.id || ids[m.id]) return;
      ids[m.id] = true;
      out.push(m);
    })
  );
  return out;
}

// Não vistos primeiro (embaralhados); os já abertos vão para o fim da fileira.
function unseenFirst(metas, rng) {
  const fresh = [];
  const old = [];
  metas.forEach((m) => (addons.wasOpened(m.id) ? old : fresh).push(m));
  return shuffleWith(fresh, rng).concat(shuffleWith(old, rng));
}

function fetchPage(entry, skip) {
  return addons.fetchCatalog(entry, Object.assign(skip ? { skip: skip } : {}, entry.extra || {}));
}

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Como ui.retrying(): tenta de novo se vier vazio ou falhar, mas para quando alive() cai (a aba
// trocou de site ou saiu da tela) e não pede mais nada.
function fetchAlive(fn, alive) {
  const delays = [1500, 4000];
  const attempt = (n) => {
    if (!alive()) return Promise.resolve([]);
    return Promise.resolve()
      .then(fn)
      .then(
        (items) => ((items && items.length) || n >= delays.length ? items || [] : wait(delays[n]).then(() => attempt(n + 1))),
        (err) => {
          if (n >= delays.length) throw err;
          return wait(delays[n]).then(() => attempt(n + 1));
        }
      );
  };
  return attempt(0);
}

// Fileira de descoberta: a página sorteada (com a seguinte, menos nos temas); se ela vier vazia ou
// falhar, cai para a primeira página. Ordena os não vistos primeiro.
function plannedFetch(entry, plan, alive, lite) {
  const at = (skip) => (alive() ? addons.fetchCatalog(entry, Object.assign(skip ? { skip: skip } : {}, plan.extra)) : Promise.resolve([]));
  const pair = (skip) => (lite ? at(skip).then((a) => mergeUnique([a])) : Promise.all([at(skip), at(skip + plan.page).catch(() => [])]).then((l) => mergeUnique(l)));
  const sorted = plan.skip ? pair(plan.skip).catch(() => []) : Promise.resolve([]);
  return sorted
    .then((metas) => (metas.length || !alive() ? metas : fetchAlive(() => pair(0), alive)))
    .then((metas) => (alive() ? unseenFirst(metas, makeRng(plan.order)) : []));
}

// Testa se a aba está na tela (display:none quando há detalhes ou o player por cima).
// Fora de vista não se mexe no DOM: a aba marca "sujo" e refaz ao voltar.
function shownEl(el) {
  return el.offsetParent !== null && !el.classList.contains('hidden');
}

// Id de quem tem o foco, para recolocar o foco depois de refazer o DOM (pelo id, senão pelo vizinho).
function focusKey(cur) {
  const row = cur.closest('[data-row]');
  return {
    row: row ? row.getAttribute('data-row') : null,
    vid: cur.getAttribute('data-vid'),
    action: cur.getAttribute('data-action'),
    site: cur.getAttribute('data-site'),
    idx: row ? $$('[data-focus]', row).indexOf(cur) : -1,
  };
}

// Elemento de dentro de root com o atributo igual a value.
function byAttr(root, name, value) {
  const all = root.querySelectorAll('[' + name + ']');
  for (let i = 0; i < all.length; i++) if (all[i].getAttribute(name) === value) return all[i];
  return null;
}

function restoreFocus(root, key) {
  let target = null;
  if (key.row) {
    const row = byAttr(root, 'data-row', key.row);
    if (row) {
      const cards = $$('[data-focus]', row);
      target =
        (key.vid && byAttr(row, 'data-vid', key.vid)) ||
        (key.action && byAttr(row, 'data-action', key.action)) ||
        (cards.length ? cards[Math.min(Math.max(key.idx, 0), cards.length - 1)] : null);
    }
  } else if (key.site) target = byAttr(root, 'data-site', key.site);
  else if (key.action) target = byAttr(root, 'data-action', key.action);
  if (!target) return false;
  nav.focus(target);
  return true;
}

// Refaz o DOM dentro de root mantendo o foco (se ele estava lá). Sem o item, usa o fallback.
function keepFocus(root, fn, fallback) {
  const cur = nav.current();
  const inside = !!cur && root.contains(cur);
  const key = inside ? focusKey(cur) : null;
  fn();
  if (inside && !(key && restoreFocus(root, key)) && fallback) fallback();
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
  let onSearchScroll = null; // busca ativa: confere, ao rolar, se a lista gay já entrou na tela
  let token = 0; // troca a cada refazer do corpo e ao sair da aba: o que estiver em voo não toca mais no DOM
  let stopSearch = null; // para a busca em curso ao sair da aba
  let dirty = false; // mudou algo com a aba escondida: refaz ao voltar
  let seed = newSeed(); // semente da aba: muda a cada abertura e a cada "Embaralhar"
  let overrides = {}; // fileira -> quantas vezes foi trocada nesta semente

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
        h('div.provider.site-tile', { focusable: true, cls: f.id === scope ? 'on' : '', title: f.label, 'data-site': f.id, onFocus: () => scheduleSwitch(f.id), onSelect: () => pick(f.id, true) }, [
          siteMark(f),
          h('div.site-text', null, [h('div.provider-name', { text: f.label }), h('div.site-sub', { text: f.sub })]),
        ])
      )
    );
    // "Embaralhar" fica depois dos sites (não muda a ordem deles); não aparece na busca.
    if (list.length && scope !== 'search') filters.appendChild(h('div.btn', { focusable: true, 'data-action': 'shuffle', text: t('Embaralhar'), onSelect: reshuffle }));
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

  function shown() {
    return shownEl(el);
  }

  // Mesma ideia da tela inicial: só busca o catálogo quando a fileira chega perto, 2 por vez.
  function startLoad(p) {
    p.state = 'loading';
    active++;
    const mine = token;
    p.load().then(
      () => {
        // Trocou de site ou saiu da aba: esta resposta já não vale (active já foi zerado).
        if (mine !== token) return;
        p.state = 'done';
        active--;
        if (p.refocus) {
          // Fileira trocada com o foco nela: o foco vai para a primeira capa nova (ou para os sites, se a fileira sumiu).
          p.refocus = false;
          const cur = nav.current();
          if (!(cur && document.body.contains(cur))) {
            const c = p.row.parentNode && p.row.querySelector('[data-focus]');
            if (c) nav.focus(c);
            else onRail();
          }
        }
        loadNearby();
      },
      () => {
        if (mine !== token) return;
        p.state = 'done';
        active--;
        showRetry(p.track, () => p.load());
        loadNearby();
      }
    );
  }

  function loadNearby() {
    if (!shown()) return;
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

  // Sorteio de uma fileira: a semente da aba + a chave da fileira + as trocas dela. A mesma combinação
  // dá o mesmo sorteio, então refazer a aba (ex.: voltar dos detalhes) não reembaralha sozinho.
  function planRow(entry, key) {
    const rng = makeRng(mixSeed(hashStr(key), seed, overrides[key] || 0));
    const pg = pageSizeOf(entry);
    const opts = sortOptions(entry);
    const p = Math.floor(rng() * PAGE_SLOTS);
    const sort = opts.length ? opts[Math.floor(rng() * opts.length)] : null;
    const extra = Object.assign({}, entry.extra || {});
    if (sort !== null) extra.sort = sort;
    return { skip: p * pg, page: pg, sort: sort, extra: extra, order: Math.floor(rng() * 4294967296) >>> 0 };
  }

  // Fileira de um catálogo. plan: sorteio da fileira de descoberta (com "Trocar estes"); null: fixa.
  function catalogRow(entry, plan, key) {
    const row = h('div.row', { 'data-anchor': '30', 'data-row': key });
    const sub = entry.extra && entry.extra.search ? t('busca no {site}', { site: siteName(entry.addon) }) : ROW_SUB[entry.catalog.id] ? t(ROW_SUB[entry.catalog.id]) : siteName(entry.addon);
    const track = h('div.row-track.pending', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, skeletonCards(6, wideCatalog(entry)));
    row.appendChild(h('div.row-title', null, [catName(entry), h('small', { text: sub })]));
    row.appendChild(track);
    const out = { row: row, track: track, key: key, entry: entry, plan: plan, state: 'idle', refocus: false };
    out.load = () => {
      const mine = token;
      const alive = () => mine === token;
      const got = plan ? plannedFetch(entry, plan, alive, !!entry.discoveryLite) : fetchAlive(() => fetchPage(entry, 0), alive);
      return got
        .then((metas) => {
          if (!alive()) return;
          clear(track);
          track.classList.remove('pending');
          if (!metas.length) {
            if (row.parentNode) row.parentNode.removeChild(row);
            return;
          }
          metas.slice(0, ROW_LIMIT).forEach((m) => track.appendChild(itemCard(m, entry)));
          if (plan) track.appendChild(reshuffleCard(key, wideCatalog(entry)));
          if (metas.length >= ROW_LIMIT)
            track.appendChild(
              seeAllCard({
                label: catName(entry),
                wide: wideCatalog(entry),
                onSelect: () => router.push(GridView(entry, plan ? plan.extra : entry.extra || {}, null, undefined, plan ? plan.skip : 0)),
              })
            );
          loadVisibleImages(row);
        })
        .catch(() => {
          if (alive()) showRetry(track, () => out.load());
        });
    };
    return out;
  }

  // "Trocar estes": no fim da fileira de descoberta, antes de "Ver tudo".
  function reshuffleCard(key, wide) {
    return h('div.card.see-all', { focusable: true, cls: wide ? 'wide' : '', 'data-action': 'reshuffle-row', onSelect: () => reshuffleRow(key) }, [
      h('div.poster-wrap', null, h('div.see-all-label', null, [h('i', { html: ICON_SHUFFLE }), h('b', { text: t('Trocar estes') })])),
    ]);
  }

  // Troca só uma fileira por outra página/ordenação sorteada; ignora se ela ainda carrega.
  function reshuffleRow(key) {
    const i = pending.map((p) => p.key).indexOf(key);
    if (i < 0 || pending[i].state === 'loading') return;
    const old = pending[i];
    if (!old.row.parentNode) return;
    let plan = null;
    for (let tries = 0; tries < 6; tries++) {
      overrides[key] = (overrides[key] || 0) + 1;
      plan = planRow(old.entry, key);
      if (!old.plan || plan.skip !== old.plan.skip || plan.sort !== old.plan.sort) break;
    }
    const had = old.row.contains(nav.current());
    const fresh = catalogRow(old.entry, plan, key);
    fresh.refocus = had;
    old.row.parentNode.replaceChild(fresh.row, old.row);
    pending[i] = fresh;
    startLoad(fresh);
  }

  // "Embaralhar": nova semente para sites, temas e fileiras de descoberta. Continuar, Favoritos e o
  // histórico ficam como estão. Ignora toques enquanto alguma fileira carrega.
  function reshuffle() {
    if (active > 0 || pending.some((p) => p.state === 'loading')) return;
    seed = newSeed();
    overrides = {};
    renderBody();
  }

  // Arquitetura de cada site, de cima para baixo: o que é seu (Continuar assistindo, Favoritos,
  // Vistos recentemente), as fileiras preferidas (Creampie hétero, gay e lançamentos), as categorias
  // como cartões e as outras fileiras do site. Sem a barra de atalhos: Voltar leva de qualquer ponto aos sites.
  function renderBody() {
    token++; // o que estava em voo (outro site, busca, fileiras) não toca mais no DOM
    pending = [];
    active = 0;
    stopSearch = null;
    clear(body);
    onSearchScroll = null;
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
    const searchable = [];
    site.addons.forEach((a) => addons.adultCatalogs(a).forEach((e) => addons.supportsSearch(e.catalog) && searchable.push(e)));
    if (!entries.some((e) => catalogOrder(e) < 3) && searchable.length) {
      entries.unshift(Object.assign({}, searchable[0], { extra: { search: 'gay creampie' }, title: t('Creampie gay'), order: 1 }));
      entries.unshift(Object.assign({}, searchable[0], { extra: { search: 'creampie' }, title: t('Creampie hétero'), order: 0 }));
    }
    // Temas extras desta semente (mudam a cada abertura e a cada Embaralhar): mais variedade além do Creampie.
    // discoveryLite: uma página só (não vale 2 scrapes por tema na TV).
    if (searchable.length) {
      nsfwSearch.sessionThemes(seed).forEach((theme) => {
        entries.push(
          Object.assign({}, searchable[0], {
            extra: nsfwSearch.searchExtra(searchable[0], theme.search, theme.orientation),
            title: t(theme.title),
            order: theme.order,
            discovery: true,
            discoveryLite: true,
          })
        );
      });
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
      const disc = orderOf(x.e) < 3 || !!x.e.discovery;
      const key = rowKeyOf(x.e);
      const r = catalogRow(x.e, disc ? planRow(x.e, key) : null, key);
      body.appendChild(r.row);
      pending.push(r);
    });
    if (!catsDone) categoryRows(site);
    loadVisibleImages(el);
    loadNearby();
  }

  // Continuar assistindo, Favoritos e Vistos recentemente, só com o que é deste site.
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
    const watchIds = {};
    watching.forEach((it) => (watchIds[it._id] = true));
    const hist = nsfwHistory.list().filter((m) => mine(m.id) && !watchIds[m.id]);
    if (watching.length)
      staticRow(
        t('Continuar assistindo'),
        '',
        'watch',
        watching.slice(0, ROW_LIMIT).map((it) => {
          const s = it.state;
          const left = s.duration ? Math.max(1, Math.round((s.duration - s.timeOffset) / 60000)) : 0;
          return tagVid(
            card(
              { id: it._id, type: it.type, name: it.name, poster: it.poster },
              {
                wide: true,
                rich: true,
                image: it.background || it.poster,
                duration: left ? t('faltam {n} min', { n: left }) : '',
                progress: s.duration ? s.timeOffset / s.duration : 0,
                onSelect: () => openDetails(it.type, it._id, { videoId: s.video_id, autoStreams: true }, { name: it.name, poster: it.poster }),
              }
            ),
            it._id
          );
        })
      );
    if (favs.length)
      staticRow(
        t('Favoritos'),
        t(favs.length === 1 ? '{n} vídeo' : '{n} vídeos', { n: favs.length }),
        'favs',
        favs.slice(0, 40).map((it) =>
          tagVid(card(it, { wide: it.posterShape !== 'poster', rich: true, image: it.posterShape !== 'poster' ? it.poster : undefined, onSelect: () => openDetails(it.type, it.id, null, it) }), it.id)
        )
      );
    if (hist.length)
      staticRow(
        t('Vistos recentemente'),
        t(hist.length === 1 ? '{n} vídeo' : '{n} vídeos', { n: hist.length }),
        'history',
        hist.slice(0, 40).map((m) => itemCard(m, null))
      );
    loadVisibleImages(personalSlot);
  }

  function staticRow(title, sub, key, cards) {
    const track = h('div.row-track', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, cards);
    const row = h('div.row', { 'data-anchor': '30', 'data-row': key }, [h('div.row-title', null, [title, sub ? h('small', { text: sub }) : null]), track]);
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
        h('div.row.nsfw-cats', { 'data-anchor': '30', 'data-row': 'cats:' + group.title }, [
          h('div.row-title', null, [group.title, h('small', { text: t('{n} categorias', { n: group.cats.length }) })]),
          track,
        ])
      );
    });
  }

  // Busca só nos catálogos adultos (a aba Buscar do app não mostra nada daqui).
  // Em todos os sites com busca (XVideos, Pornhub, TPB 4K Porn…), em português e inglês,
  // com duas listas: resultados hétero e resultados gay.
  // No máximo 2 scrapes ao mesmo tempo; variante PT/EN só se a primeira busca vier magra.
  const SEARCH_LIMIT = 15;
  const SEARCH_MIN = 8;

  function renderSearch() {
    const input = h('input.input', {
      type: 'text',
      placeholder: t('Buscar em português ou inglês...'),
      focusable: true,
    });
    const go = h('div.btn.primary.search-go', { focusable: true, text: t('Buscar'), onSelect: () => run(input.value) });
    const results = h('div.rows');
    input.__submit = (q) => run(q);
    body.appendChild(h('div.search-box', { 'data-group': '' }, [input, go]));
    body.appendChild(
      h('div.hint', { text: t('Resultados do XVideos, Pornhub e dos seus addons adultos (ex.: TPB 4K), em listas hétero e gay.') })
    );
    body.appendChild(results);
    let runNo = 0; // cada busca nova troca a anterior
    let lastQuery = '';
    let inflight = []; // fileiras de resultado ainda carregando

    // Ao sair da aba as buscas param: a fileira que ficou pela metade mostra "Tentar de novo".
    stopSearch = () => {
      inflight.forEach((j) => {
        if (j.done) return;
        j.done = true;
        clear(j.track);
        j.track.appendChild(
          rowRetry(() => {
            run(lastQuery);
            nav.focus(input);
          })
        );
      });
      inflight = [];
    };

    function searchCats() {
      const cats = [];
      const seen = {};
      addons.adultAddons().forEach((a) =>
        addons.adultCatalogs(a).forEach((e) => {
          if (!addons.supportsSearch(e.catalog)) return;
          // transportUrl: instalações TPB (1/2) e (2/2) têm o mesmo manifest.id.
          const key = (a.transportUrl || a.manifest.id) + '|' + (e.catalog.id || e.catalog.name || '');
          if (seen[key]) return;
          seen[key] = true;
          cats.push(e);
        })
      );
      return cats;
    }

    function mergeMetas(into, metas, ids) {
      (metas || []).forEach((m) => {
        if (!m || !m.id || ids[m.id]) return;
        ids[m.id] = true;
        into.push(m);
      });
      return into;
    }

    // Primeiro o termo original; só pede a variante PT/EN se veio pouco resultado (e a busca ainda vale).
    function fetchSmart(entry, orientation, queries, alive) {
      const ids = {};
      const out = [];
      const primary = queries[0];
      const alt = queries[1];
      return addons
        .fetchCatalog(entry, nsfwSearch.searchExtra(entry, primary, orientation))
        .then((metas) => {
          mergeMetas(out, metas, ids);
          if (out.length >= SEARCH_MIN || !alt || !alive()) return out;
          return addons
            .fetchCatalog(entry, nsfwSearch.searchExtra(entry, alt, orientation))
            .then((more) => mergeMetas(out, more, ids))
            .catch(() => out);
        })
        .catch(() => out);
    }

    function run(q) {
      const query = (q || '').trim();
      clear(results);
      onSearchScroll = null;
      if (query.length < 2) return results.appendChild(h('div.hint', { text: t('Digite pelo menos 2 letras e aperte Buscar.') }));
      const mine = ++runNo;
      const tok = token;
      const alive = () => mine === runNo && tok === token;
      lastQuery = query;
      inflight = [];
      const queries = nsfwSearch.expandQueries(query);
      const cats = searchCats();
      if (!cats.length) return results.appendChild(h('div.hint', { text: t('Nenhum site com busca disponível agora.') }));

      const sections = [
        { id: 'straight', title: t('Resultados hétero'), orientation: 'straight' },
        { id: 'gay', title: t('Resultados gay'), orientation: 'gay' },
      ];
      const slots = {};
      const jobs = [];
      let cursor = 0;
      let running = 0;
      let found = 0;
      let allHint = false;
      const PARALLEL = 2;

      sections.forEach((sec) => {
        const block = h('div.nsfw-search-section');
        block.appendChild(h('div.row-title', null, [sec.title, h('small', { text: t('em todos os sites') })]));
        const host = h('div.rows');
        block.appendChild(host);
        results.appendChild(block);
        slots[sec.id] = { host: host, block: block, found: 0, queued: false };
      });

      // Cada lista só busca quando entra na tela: a hétero logo; a gay ao aparecer (ou ao rolar até ela).
      function queue(sec) {
        const slot = slots[sec.id];
        if (slot.queued || !alive()) return;
        slot.queued = true;
        cats.forEach((entry) => jobs.push({ sec: sec, entry: entry }));
        pump();
      }
      function checkGay() {
        if (!alive() || slots.gay.queued) return;
        if (slots.gay.block.getBoundingClientRect().top < window.innerHeight) queue(sections[1]);
      }

      function finish() {
        if (!alive() || running || cursor < jobs.length) return;
        sections.forEach((s) => {
          const slot = slots[s.id];
          if (!slot.queued || slot.found || slot.hinted) return;
          slot.hinted = true;
          slot.host.appendChild(h('div.hint', { text: t('Nada nesta lista para "{q}".', { q: query }) }));
        });
        if (!found && !allHint && slots.straight.queued && slots.gay.queued) {
          allHint = true;
          results.appendChild(h('div.hint', { text: t('Nada encontrado para "{q}".', { q: query }) }));
        }
      }

      function pump() {
        if (!alive()) return;
        while (running < PARALLEL && cursor < jobs.length) {
          const job = jobs[cursor++];
          running++;
          const track = h('div.row-track', { 'data-scroll-x': '', 'data-group': '', 'data-trap': '' }, skeletonCards(6, true));
          const row = h('div.row', { 'data-anchor': '30' }, [
            h('div.row-title', null, [siteName(job.entry.addon), h('small', { text: t('busca') })]),
            track,
          ]);
          slots[job.sec.id].host.appendChild(row);
          const rec = { track: track, done: false };
          inflight.push(rec);
          fetchSmart(job.entry, job.sec.orientation, queries, alive)
            .then((metas) => {
              rec.done = true;
              if (!alive()) return;
              clear(track);
              if (!metas.length) {
                if (row.parentNode) row.parentNode.removeChild(row);
                return;
              }
              found++;
              slots[job.sec.id].found++;
              metas.slice(0, SEARCH_LIMIT).forEach((m) => track.appendChild(itemCard(m, job.entry)));
              loadVisibleImages(row);
            })
            .catch(() => {
              rec.done = true;
              if (!alive()) return;
              if (row.parentNode) row.parentNode.removeChild(row);
            })
            .then(() => {
              running--;
              if (!alive()) return;
              pump();
              checkGay(); // a lista de cima mudou de tamanho: a gay pode ter entrado na tela
              finish();
            });
        }
      }

      queue(sections[0]);
      checkGay();
      onSearchScroll = checkGay;
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

  // Refaz a aba se ela está na tela; fora de vista só marca "sujo" (refaz ao voltar, em onShow).
  function refresh() {
    if (!shown()) {
      dirty = true;
      return;
    }
    dirty = false;
    keepFocus(el, render, onRail);
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
    if (providersKey() === lastKey) return;
    refresh();
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

  // Carrega os addons. Em falha mostra o erro com "Tentar de novo" (antes ficava em "Carregando" para sempre).
  function loadAddons(force) {
    return addons
      .load(force)
      .then(() => {
        ready = true;
        if (shown()) {
          render();
          onRail(); // a aba abre com o site atual em foco
        } else dirty = true;
      })
      .catch(() => {
        clear(body);
        const retry = h('div.btn.primary', {
          focusable: true,
          text: t('Tentar de novo'),
          onSelect: () => {
            clear(body);
            body.appendChild(h('div.hint', { text: t('Carregando addons...') }));
            loadAddons(true);
          },
        });
        body.appendChild(h('div.hint', { text: t('Não foi possível carregar os sites agora.') }));
        body.appendChild(retry);
        if (el.offsetParent !== null) nav.focus(retry);
      });
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

  // Continuar/Favoritos/histórico mudam nos detalhes e no player: refaz só essa parte, com o foco.
  function refreshPersonal() {
    const all = sites();
    const site = all.filter((s) => s.id === scope)[0];
    if (!site || !personalSlot) return;
    keepFocus(
      personalSlot,
      () => renderPersonal(site, all),
      () => {
        const c = personalSlot.querySelector('[data-focus]');
        if (c) nav.focus(c);
        else onRail();
      }
    );
  }

  return {
    el: el,
    onKey: onKey,
    onBack: onBack,
    onShow: () => {
      if (!ready) {
        loadAddons(false);
        return;
      }
      if (dirty) {
        dirty = false;
        keepFocus(el, render, onRail);
      } else if (scope !== 'search') refreshPersonal();
      loadNearby();
    },
    onScroll: () => {
      loadNearby();
      if (onSearchScroll) onSearchScroll();
    },
    onHide: () => {
      stopPreview();
      token++; // o que estava em voo para de tocar no DOM; as fileiras paradas recarregam ao voltar
      active = 0;
      pending.forEach((p) => {
        if (p.state === 'loading') p.state = 'idle';
      });
      if (stopSearch) stopSearch();
    },
    destroy: () => {
      token++;
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

// ---------- Grade ("Ver tudo" e categorias) ----------
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
// from: skip de onde a grade começa (a fileira de origem já andou essas páginas); sort vem no extra.
function GridView(entry, extra, group, at, from) {
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
  let startAt = from || 0;
  let buildNo = 0; // cada grade montada troca a anterior: a busca que ainda vem não entra nela
  let viewDead = false;

  // Busca uma página do catálogo; no filtro, junta páginas até ter o bastante (ou o catálogo acabar).
  // FILL_MIN: ~2 linhas da grade. A grade só mostra linhas cheias, então com menos a tela ficaria parada.
  const FILL_MIN = 12;
  function fetcher(alive) {
    let skip = startAt;
    const keep = FILTER_KEEP[mode];
    const e = entry;
    const x = extra;
    return function load() {
      const got = [];
      const step = (tries) => {
        // Grade trocada ou tela fechada: não pede a próxima página.
        if (!alive()) return Promise.resolve(got);
        return addons.fetchCatalog(e, Object.assign({ skip: skip || undefined }, x)).then((metas) => {
          skip += metas.length;
          metas.forEach((m) => keep(m) && got.push(m));
          if (!metas.length || got.length >= FILL_MIN || tries >= 5) return got;
          return step(tries + 1);
        });
      };
      return step(0);
    };
  }

  // stay: trocou de categoria pela lista do lado; o foco continua nela.
  function build(stay) {
    stopPreview();
    if (pg) pg.destroy();
    const mine = ++buildNo;
    const load = fetcher(() => mine === buildNo && !viewDead);
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
    extra = Object.assign({ genre: c.g }, sortFor(c.e, extra.sort));
    startAt = 0;
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
      viewDead = true;
      buildNo++;
      clearTimeout(switchTimer);
      stopPreview();
      if (pg) pg.destroy();
    },
  };
}
