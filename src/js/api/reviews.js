// O que a crítica diz: "Critics Consensus" e trechos de críticos do Rotten Tomatoes, buscados pelo
// serviço da TV (o site não tem API nem libera CORS) e traduzidos para português.
import { getJSON } from '../lib/http.js';
import * as tr from '../lib/translate.js';
import { IS_WEB } from '../lib/platform.js';

const SERVICE = 'http://127.0.0.1:8092/api/rt';

// { url, consensus, critics: [{ name, outlet, fresh, score, top, quote }], translated } em português
// (o que não traduziu fica em inglês), ou null.
export function forTitle(meta) {
  if (IS_WEB || !meta || !meta.name) return Promise.resolve(null);
  const year = parseInt(String(meta.releaseInfo || meta.year || '').slice(0, 4), 10) || '';
  const q = 'title=' + encodeURIComponent(meta.name) + '&year=' + year + '&type=' + (meta.type === 'series' ? 'series' : 'movie');
  return getJSON(SERVICE + '?' + q, { timeout: 25000, quiet: true })
    .then((r) => {
      if (!r || (!r.consensus && !(r.critics && r.critics.length))) return null;
      const critics = (r.critics || []).slice(0, 3);
      // Traduz o consenso e os trechos juntos; o que falhar fica em inglês.
      const pt = (s) => (s ? tr.text(s).then((x) => x || s, () => s) : Promise.resolve(''));
      return Promise.all([pt(r.consensus)].concat(critics.map((c) => pt(c.quote)))).then((out) => ({
        url: r.url,
        consensus: out[0],
        critics: critics.map((c, i) => Object.assign({}, c, { quote: out[i + 1] })),
        translated: out[0] !== r.consensus || critics.some((c, i) => out[i + 1] !== c.quote),
      }));
    })
    .catch(() => null);
}
