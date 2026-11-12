// XHR com Promise: o Chromium 38 não tem fetch().
import { log } from './log.js';
import { t } from './i18n.js';

// Últimos erros de rede (para o diagnóstico em Ajustes), sem chaves nem parâmetros.
const netErrors = [];
export function recentErrors() {
  return netErrors.slice();
}
function shortUrl(url) {
  return String(url).split('?')[0].replace(/^https?:\/\//, '');
}

export function request(method, url, body, opts) {
  const o = opts || {};
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = o.timeout || 20000;
    // form: corpo já montado como formulário (pedido "simples", sem pré-verificação de CORS).
    if (o.form !== undefined && o.form !== null) xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    else if (body !== undefined && body !== null) xhr.setRequestHeader('Content-Type', 'application/json');
    if (o.headers) for (const k in o.headers) xhr.setRequestHeader(k, o.headers[k]);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (o.raw) return resolve(xhr.responseText);
        try {
          resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
        } catch (e) {
          reject(new Error(t('JSON inválido de {url}', { url: url })));
        }
      } else {
        const err = new Error(t('HTTP {code} em {url}', { code: xhr.status, url: url }));
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new Error(t('Falha de rede em {url}', { url: url }));
      err.status = 0;
      reject(err);
    };
    xhr.ontimeout = () => {
      const err = new Error(t('Tempo esgotado em {url}', { url: url }));
      err.status = 0;
      err.timeout = true;
      reject(err);
    };
    xhr.send(o.form !== undefined && o.form !== null ? o.form : body !== undefined && body !== null ? JSON.stringify(body) : null);
  }).catch((err) => {
    err.ms = Date.now() - started;
    if (!/127\.0\.0\.1|localhost/.test(url)) {
      url = String(url).replace(/auth_token=[^&]+/, 'auth_token=…');
      netErrors.unshift({ at: Date.now(), url: shortUrl(url), msg: err.timeout ? 'tempo esgotado' : err.status ? 'HTTP ' + err.status : err.status === 0 ? 'falha de rede' : 'resposta inválida', ms: err.ms });
      if (netErrors.length > 12) netErrors.pop();
    }
    if (!o.quiet) log.warn(err.message);
    throw err;
  });
}

export function getJSON(url, opts) {
  return request('GET', url, null, opts);
}

export function postJSON(url, body, opts) {
  return request('POST', url, body, opts);
}

export function getText(url, opts) {
  return request('GET', url, null, Object.assign({ raw: true }, opts));
}

// Cache em memória com validade (LRU), para catálogos e metadados. Um LRU por categoria (opts.cat):
// uma resposta grande (catálogo) não expulsa os metadados nem as notas.
const CACHE_MAX = { meta: 30, catalogo: 20, notas: 20, outros: 20 };
const memCaches = {};
// opts.fetch: busca alternativa com a mesma assinatura de getJSON (ex.: pelo proxy do PC).
export function cachedJSON(url, ttlMs, opts) {
  const cat = (opts && opts.cat) || 'outros';
  const cache = memCaches[cat] || (memCaches[cat] = new Map());
  const hit = cache.get(url);
  const now = Date.now();
  if (hit && now - hit.t < (ttlMs || 600000)) {
    // Recoloca no fim: as entradas quentes saem por último quando o cache enche.
    cache.delete(url);
    cache.set(url, hit);
    return hit.p;
  }
  const entry = { t: now, p: null };
  const fetcher = (opts && opts.fetch) || getJSON;
  entry.p = fetcher(url, opts).catch((e) => {
    if (cache.get(url) === entry) cache.delete(url);
    throw e;
  });
  // Regravar uma chave expirada põe ela no fim (o Map manteria a posição antiga).
  cache.delete(url);
  cache.set(url, entry);
  // Pouca RAM na TV: guarda só as últimas respostas de cada categoria.
  if (cache.size > (CACHE_MAX[cat] || 20)) cache.delete(cache.keys().next().value);
  return entry.p;
}

// Fila global de pedidos de catálogo: a TV e o serviço dos tubes engasgam com muitos
// scrapes ao mesmo tempo (busca NSFW + fileiras de descoberta).
const CAT_LIMIT = 2;
let catActive = 0;
const catWait = [];

export function catalogSlot(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      catActive++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .then(() => {
          catActive--;
          if (catWait.length) catWait.shift()();
        });
    };
    if (catActive < CAT_LIMIT) run();
    else catWait.push(run);
  });
}
