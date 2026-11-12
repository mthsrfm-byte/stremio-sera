'use strict';
// Serviço do Seraflix que roda DENTRO da TV (serviceFile do TizenBrew; liga quando o Seraflix abre).
// Serve os addons do Seraflix (XVideos e Pornhub, com o vídeo passando pela TV) na porta 8092 (só em 127.0.0.1), e os
// diagnósticos de Ajustes (/api/info e /api/torrent-test). Não há mais controle pelo celular: este
// serviço não escuta a porta 8090; só pede para a versão antiga que ainda a usa sair.
// Só usa módulos nativos do Node e ES5, porque a versão do Node muda de TV para TV.
var http = require('http');
var https = require('https');
var fs = require('fs');
var os = require('os');
var urlLib = require('url');

var OLD_PORT = 8090; // controle remoto das versões antigas (até a 14): só para pedir que saiam
var ADDON_PORT = 8092; // addons XVideos/Pornhub e vídeo (porta nova a cada mudança que versões antigas não sabem largar)
var SERVICE_VERSION = 16; // 16: catálogo sem corte (skip = n × pageSize), sort, cache e orçamento de tempo; 15: sem o controle pelo celular (8090 saiu; /api/info e /api/torrent-test foram para a 8092)
var TIZENBREW_CONFIG = '/home/owner/share/tizenbrewConfig.json';
var MODULE_NAME = 'mthsrfm-byte/stremio-sera'; // como o TizenBrew chama o módulo na lista de serviços

function bufAlloc(n) { return Buffer.alloc ? Buffer.alloc(n) : new Buffer(n).fill(0); }

function json(res, code, obj) {
  // CORS liberado: o app do Seraflix (WebView da TV) chama estas rotas em 127.0.0.1.
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true' });
  res.end(JSON.stringify(obj));
}

// ---------- Addons "Seraflix Tube": XVideos e Pornhub servidos daqui da TV ----------
// Os links de vídeo desses sites saem assinados para o IP de quem pediu a página. Pedindo daqui,
// a TV que toca é a mesma que pediu: funciona sem servidor na internet e sem o PC.
// Rotas no protocolo de addons do Stremio: /xv/manifest.json, /ph/manifest.json, catalog, meta, stream.
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Conexões reaproveitadas (keep-alive), só se o Node desta TV tiver a opção; senão segue como antes.
var AGENT_HTTP = null;
var AGENT_HTTPS = null;
try {
  if (typeof http.Agent === 'function') AGENT_HTTP = new http.Agent({ keepAlive: true });
  if (typeof https.Agent === 'function') AGENT_HTTPS = new https.Agent({ keepAlive: true });
} catch (e) { AGENT_HTTP = null; AGENT_HTTPS = null; }
function agentFor(opts) {
  var a = opts.protocol === 'http:' ? AGENT_HTTP : AGENT_HTTPS;
  if (a) opts.agent = a;
  return opts;
}

// Certificados raiz que o Node 4.4.3 do TizenBrew (2016) não conhece: ISRG Root X1 e X2 (Let's
// Encrypt). A CDN de vídeo do Pornhub (phncdn.com) usa essa cadeia e o Node recusava a conexão.
// Só entram quando a verificação normal falha, e só para aquele site (nunca desligam a verificação).
var EXTRA_CA = [
  "-----BEGIN CERTIFICATE-----\n" +
  "MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAwTzELMAkG\n" +
  "A1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2VhcmNoIEdyb3VwMRUw\n" +
  "EwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4WhcNMzUwNjA0MTEwNDM4WjBP\n" +
  "MQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3Jv\n" +
  "dXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoC\n" +
  "ggIBAK3oJHP0FDfzm54rVygch77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj\n" +
  "/RQSa78f0uoxmyF+0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7i\n" +
  "S4+3mX6UA5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW\n" +
  "T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyHB5T0Y3Hs\n" +
  "LuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UCB5iPNgiV5+I3lg02\n" +
  "dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUvKBds0pjBqAlkd25HN7rOrFle\n" +
  "aJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWnOlFuhjuefXKnEgV4We0+UXgVCwOPjdAv\n" +
  "BbI+e0ocS3MFEvzG6uBQE3xDk3SzynTnjh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymC\n" +
  "zLq9gwQbooMDQaHWBfEbwrbwqHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC\n" +
  "1CLQJ13hef4Y53CIrU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIB\n" +
  "BjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq\n" +
  "hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZLubhzEFnT\n" +
  "IZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ3BebYhtF8GaV0nxv\n" +
  "wuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KKNFtY2PwByVS5uCbMiogziUwt\n" +
  "hDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5ORAzI4JMPJ+GslWYHb4phowim57iaztX\n" +
  "OoJwTdwJx4nLCgdNbOhdjsnvzqvHu7UrTkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIu\n" +
  "vtd7u+Nxe5AW0wdeRlN8NwdCjNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1N\n" +
  "bdWhscdCb+ZAJzVcoyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4k\n" +
  "qKOJ2qxq4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA\n" +
  "mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57demyPxgcY\n" +
  "xn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=\n" +
  "-----END CERTIFICATE-----\n",
  "-----BEGIN CERTIFICATE-----\n" +
  "MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQswCQYDVQQG\n" +
  "EwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNV\n" +
  "BAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00MDA5MTcxNjAwMDBaME8xCzAJ\n" +
  "BgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBTZWN1cml0eSBSZXNlYXJjaCBHcm91cDEV\n" +
  "MBMGA1UEAxMMSVNSRyBSb290IFgyMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJ\n" +
  "SvMWSj5cz3es3mcFDR0HttwW+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvX\n" +
  "RdgKam7mAHf7AlF9ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYw\n" +
  "DwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI\n" +
  "zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdWtL4ndQav\n" +
  "Ei51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1/q4AaOeMSQ+2b1tb\n" +
  "FfLn\n" +
  "-----END CERTIFICATE-----\n"
];
// Hosts que já precisaram da CA extra, com a hora. A CA vale por CA_TTL e depois sai (não fica presa
// para sempre: se o certificado do site mudar, a verificação normal volta a valer).
var extraCaHosts = {};
var CA_TTL = 5 * 60000;
function caOn(host) {
  var t = extraCaHosts[host];
  return !!t && Date.now() - t < CA_TTL;
}
function caSet(host) { extraCaHosts[host] = Date.now(); }

function isCertError(e) {
  return !!e && /UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|CERT_UNTRUSTED|issuer certificate|leaf signature/i.test(String(e.code || '') + ' ' + String(e.message || ''));
}

// Opções do https.get com as raízes extras quando aquele site já precisou delas.
function withCa(opts) {
  if (opts.protocol !== 'http:' && caOn(opts.hostname)) opts.ca = EXTRA_CA;
  return opts;
}

// Cookies de sessão que os sites mandam. O Pornhub só entrega links de vídeo que funcionam para
// quem já tem sessão: no primeiro pedido, a página às vezes vem com links que respondem 410.
var jar = {};
var BASE_COOKIES = { platform: 'pc', age_verified: '1', accessAgeDisclaimerPH: '1' };
function siteOf(host) { return String(host || '').split('.').slice(-2).join('.'); }
function keepCookies(host, list) {
  if (!list) return;
  var c = jar[siteOf(host)] || (jar[siteOf(host)] = {});
  (Array.isArray(list) ? list : [list]).forEach(function (line) {
    var kv = String(line).split(';')[0];
    var i = kv.indexOf('=');
    if (i > 0 && !BASE_COOKIES[kv.slice(0, i).trim()]) c[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
}
function cookieHeader(host) {
  var all = {};
  var c = jar[siteOf(host)] || {};
  Object.keys(BASE_COOKIES).forEach(function (k) { all[k] = BASE_COOKIES[k]; });
  Object.keys(c).forEach(function (k) { all[k] = c[k]; });
  return Object.keys(all).map(function (k) { return k + '=' + all[k]; }).join('; ');
}

// Corpo máximo de uma resposta de texto (HTML, iCal, JSON): acima disso para, sem encher a memória da TV.
var MAX_BODY = 3 * 1024 * 1024;

// limitMs: tempo total do pedido (padrão 30 s); redirecionamentos gastam do mesmo tempo.
function fetchText(url, cb, hops, limitMs) {
  var t0 = Date.now();
  var done = false;
  var deadline = null;
  function end(err, text) {
    if (done) return;
    done = true;
    clearTimeout(deadline);
    cb(err, text);
  }
  // Node 4 (o da TV) não aceita https.get(url, opções, cb): as opções vão num objeto só.
  var opts = urlLib.parse(url);
  opts.headers = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8', Cookie: cookieHeader(opts.hostname) };
  var req;
  try {
    req = https.get(agentFor(withCa(opts)), onResponse);
  } catch (e) {
    return end(e);
  }
  // Tempo total: o timeout de inatividade (abaixo) não corta quem manda os bytes devagar.
  deadline = setTimeout(function () { req.abort(); end(new Error('tempo esgotado')); }, limitMs || 30000);
  function onResponse(r) {
    keepCookies(opts.hostname, r.headers['set-cookie']);
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && (hops || 0) < 4) {
      r.resume();
      // urlLib.resolve cobre URL completa, //host/caminho e caminho relativo
      var next = urlLib.resolve(url, r.headers.location);
      var left = (limitMs || 30000) - (Date.now() - t0);
      if (left < 500) return end(new Error('tempo esgotado'));
      return fetchText(next, end, (hops || 0) + 1, left);
    }
    if (r.statusCode !== 200) { r.resume(); return end(new Error('HTTP ' + r.statusCode)); }
    var chunks = [];
    var size = 0;
    r.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) {
        r.destroy();
        return end(new Error('resposta grande demais'));
      }
      chunks.push(c);
    });
    r.on('end', function () { end(null, Buffer.concat(chunks).toString('utf8')); });
    r.on('error', function (e) { end(e); });
  }
  req.on('error', function (e) {
    if (isCertError(e) && !caOn(opts.hostname)) {
      caSet(opts.hostname);
      done = true; // o novo pedido responde pelo cb
      clearTimeout(deadline);
      return fetchText(url, cb, hops, limitMs);
    }
    end(e);
  });
  req.setTimeout(15000, function () { req.abort(); end(new Error('tempo esgotado')); });
}

// O link responde? (só o status; a playlist HLS é pequena e o corpo é descartado)
function urlOk(url, cb, limitMs) {
  var done = false;
  function end(ok) { if (!done) { done = true; cb(ok); } }
  var opts = urlLib.parse(url);
  opts.headers = { 'User-Agent': UA, Accept: '*/*' };
  var req;
  try {
    req = https.get(agentFor(withCa(opts)), function (r) { r.resume(); end(r.statusCode === 200); });
  } catch (e) {
    return end(false);
  }
  req.on('error', function (e) {
    if (isCertError(e) && !caOn(opts.hostname) && !done) {
      caSet(opts.hostname);
      done = true;
      return urlOk(url, cb, limitMs);
    }
    end(false);
  });
  req.setTimeout(limitMs || 10000, function () { req.abort(); end(false); });
}

// ---------- Cache, pedidos em voo e paginação ----------
// Guarda só o resultado já lido (lista ou página parseada), nunca o HTML. Até CACHE_MAX entradas; sai a
// mais antiga. Se o site falhar, serve o que tiver de até STALE_MS atrás.
var CACHE = Object.create(null);
var CACHE_MAX = 40;
var STALE_MS = 60 * 60000;
var LIST_TTL = 10 * 60000; // catálogo e busca
var PAGE_TTL = 5 * 60000; // página de vídeo (meta e stream) e lista MP4
var STREAM_BUDGET_MS = 20000; // stream do Pornhub: o que tiver até aqui sai (o app desiste em 30 s)
var inflight = Object.create(null); // url → callbacks à espera (um pedido só para todos)

function cacheSet(key, value, ttl) {
  CACHE[key] = { at: Date.now(), ttl: ttl, value: value };
  var keys = Object.keys(CACHE);
  if (keys.length <= CACHE_MAX) return;
  var oldest = keys[0];
  keys.forEach(function (k) { if (CACHE[k].at < CACHE[oldest].at) oldest = k; });
  delete CACHE[oldest];
}

function callAll(list, args) {
  list.forEach(function (f) { try { f.apply(null, args); } catch (e) {} });
}

// Lê a URL e devolve cb(erro, valor, veioDoCacheAntigo). o: { ttl, limit (ms), fresh (ignora o cache
// de leitura), ok(valor) (só entra no cache, e só serve, se for true) }. Pedidos iguais em voo viram um.
function cachedFetch(url, o, parse, cb) {
  var hit = CACHE[url];
  if (!o.fresh && hit && Date.now() - hit.at < hit.ttl) return cb(null, hit.value, false);
  if (inflight[url]) return inflight[url].push(cb);
  var waiting = (inflight[url] = [cb]);
  fetchText(url, function (err, html) {
    var value = null;
    if (!err) {
      try { value = parse(html); } catch (e) { err = e; }
    }
    var good = !err && (!o.ok || o.ok(value));
    if (good) cacheSet(url, value, o.ttl);
    delete inflight[url];
    // Falhou ou veio vazio: serve o resultado antigo, se houver (até STALE_MS)
    var stale = good ? null : CACHE[url];
    if (stale && Date.now() - stale.at < STALE_MS) return callAll(waiting, [null, stale.value, true]);
    callAll(waiting, [err || null, value, false]);
  }, 0, o.limit);
}

// Paginação. Contrato: skip = n × pageSize ⇒ página n do site. Quem soma os itens recebidos (skip = soma
// dos itens já vistos, como o grid do app) também cai na página certa: lembra quantos itens veio em cada
// página de cada catálogo (pageSizes) e, quando o skip é a soma exata de páginas vistas, usa essa página.
var pageSizes = Object.create(null); // base do catálogo → [itens da página 0, 1, ...]
var sizeStats = { xv: { sum: 0, n: 0 }, ph: { sum: 0, n: 0 } }; // média de páginas vistas, por site
function notePage(tube, base, n, count) {
  if (!(count > 0)) return;
  if (!pageSizes[base]) {
    if (Object.keys(pageSizes).length >= 60) pageSizes = Object.create(null);
    pageSizes[base] = [];
  }
  if (pageSizes[base][n] !== undefined) return;
  pageSizes[base][n] = count;
  sizeStats[tube].sum += count;
  sizeStats[tube].n++;
}

// Número da página do site para este skip (ver o contrato acima).
function pageFor(tube, base, skip, pageSize) {
  var s = parseInt(skip, 10) || 0;
  if (s <= 0) return 0;
  var sizes = pageSizes[base] || [];
  var n = 0;
  var acc = 0;
  // Soma exata das páginas já vistas (a página 0 começa em 0)
  for (;;) {
    if (acc === s) return n;
    if (sizes[n] === undefined) break;
    acc += sizes[n];
    n++;
  }
  if (s % pageSize === 0) return s / pageSize;
  // Sem essa soma na tabela (ex.: serviço reiniciado no meio): estima pelo tamanho médio visto
  var st = sizeStats[tube];
  var avg = st && st.n ? st.sum / st.n : pageSize;
  return Math.round(s / avg);
}

var ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', period: '.', comma: ',', excl: '!', quest: '?', colon: ':', semi: ';', lpar: '(', rpar: ')', num: '#', percnt: '%', plus: '+', equals: '=', sol: '/', hyphen: '-', lowbar: '_', ast: '*', commat: '@', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', trade: '™', copy: '©', reg: '®', deg: '°', times: '×', bull: '•', middot: '·', eacute: 'é', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', atilde: 'ã', otilde: 'õ', ccedil: 'ç', ecirc: 'ê', acirc: 'â', ocirc: 'ô', agrave: 'à', ntilde: 'ñ', uuml: 'ü' };

function unhtml(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/&([a-z]+);/gi, function (m, n) { return ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m; })
    .replace(/\s+/g, ' ')
    .trim();
}

// Lê o array JSON que vem depois de "chave": no HTML, contando colchetes (e ignorando os que estão dentro de textos).
function jsonArrayAfter(html, key) {
  return jsonAfter(html, key, '[') || [];
}

// O mesmo para objeto ou array (open: '{' ou '['); null quando não acha.
function jsonAfter(html, key, open) {
  var i = html.indexOf('"' + key + '":' + open);
  if (i < 0) return null;
  var start = html.indexOf(open, i);
  var depth = 0;
  var inStr = false;
  for (var j = start; j < html.length; j++) {
    var ch = html[j];
    if (inStr) {
      if (ch === '\\') j++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, j + 1)); } catch (e) { return null; }
      }
    }
  }
  return null;
}

// Miniaturas da linha do tempo (prévia ao avançar/voltar no player): imagens em grade que o próprio
// site publica. { urls: [uma por folha], cols, rows, w, h (px de cada quadro), every (s por quadro) }.
// XVideos: uma folha por minuto (mozaiquemin_0.jpg, _1...), 10×6 quadros de 208×117, um por segundo.
function xvThumbs(html) {
  var pattern = (html.match(/setThumbSlideMinute\('([^']+)'\)/) || [])[1];
  var duration = parseInt(ogTag(html, 'duration'), 10);
  if (!pattern || pattern.indexOf('NUM') < 0 || !(duration > 0)) return null;
  var urls = [];
  for (var n = 0; n < Math.ceil(duration / 60); n++) urls.push(pattern.replace('NUM', n));
  return { urls: urls, cols: 10, rows: 6, w: 208, h: 117, every: 1 };
}

// Pornhub: "thumbs" da página (folhas 5×5 de 160×90, um quadro a cada samplingFrequency segundos).
function phThumbs(html) {
  var t = jsonAfter(html, 'thumbs', '{');
  if (!t || !t.spritePatterns || !t.spritePatterns.length) return null;
  var grid = String(t.format || '5x5').split('x');
  return { urls: t.spritePatterns, cols: parseInt(grid[0], 10) || 5, rows: parseInt(grid[1], 10) || 5, w: parseInt(t.thumbWidth, 10) || 160, h: parseInt(t.thumbHeight, 10) || 90, every: Number(t.samplingFrequency) || 4 };
}

// ---------- Números de qualidade (cartões e detalhes da aba NSFW) ----------
// stats: { views, duration, quality, channel, likes, approval } — textos curtos já prontos para a
// tela ("3,2 mi", "10:14", "4K"); approval é um número de 0 a 100. Campos que o site não dá ficam de fora.
function m1(re, text) {
  var m = String(text || '').match(re);
  return m ? unhtml(m[1]) : '';
}

// "36,549,064" ou "3M"/"47K"/"66.6k" → número
function countOf(text) {
  var t = String(text || '').replace(/\s/g, '');
  var m = t.match(/^([\d.,]+)([KkMmBb])?$/);
  if (!m) return 0;
  if (!m[2]) return parseInt(m[1].replace(/[.,]/g, ''), 10) || 0;
  return Math.round(parseFloat(m[1].replace(',', '.')) * { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()]);
}

// 3200000 → "3,2 mi"; 640000 → "640 mil"; 950 → "950"
function shortCount(n) {
  if (!(n > 0)) return '';
  function d(x) { return (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).toString().replace('.', ','); }
  if (n >= 1e9) return d(n / 1e9) + ' bi';
  if (n >= 1e6) return d(n / 1e6) + ' mi';
  if (n >= 1e3) return d(n / 1e3) + ' mil';
  return String(n);
}

function clock(sec) {
  sec = Math.round(sec);
  if (!(sec > 0)) return '';
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

// "6 min" / "1 h 2 min" / "10:14" como vem nas listagens
function listDuration(text) {
  var t = String(text || '').trim();
  if (/^\d+(:\d\d){1,2}$/.test(t)) return t;
  var h = (t.match(/(\d+)\s*h/) || [])[1];
  var m = (t.match(/(\d+)\s*min/) || [])[1];
  var s = (t.match(/(\d+)\s*sec/) || [])[1];
  if (!h && !m && !s) return '';
  return clock((+h || 0) * 3600 + (+m || 0) * 60 + (+s || 0));
}

function quality(text) {
  var t = String(text || '').toLowerCase();
  if (/2160|4k/.test(t)) return '4K';
  var m = t.match(/(1440|1080|720|480|360)p/);
  return m ? m[1] + 'p' : '';
}

function compact(o) {
  var out = {};
  Object.keys(o).forEach(function (k) { if (o[k] !== '' && o[k] !== 0 && o[k] !== null && o[k] !== undefined) out[k] = o[k]; });
  return out;
}

function xvListStats(chunk) {
  return compact({
    quality: quality(m1(/class="video-(?:hd|sd|4k|uhd)-mark">([^<]+)</, chunk)),
    duration: listDuration(m1(/<span class="duration">([^<]+)</, chunk)),
    channel: m1(/<span class="name">([^<]+)</, chunk),
    views: shortCount(countOf(m1(/([\d.,]+\s*[KMBkmb]?)\s*<span class="sprfluous">Views/, chunk)))
  });
}

function xvPageStats(html) {
  var good = countOf(m1(/class="rating-good-nbr">([^<]+)</, html));
  var bad = countOf(m1(/class="rating-bad-nbr">([^<]+)</, html));
  return compact({
    views: shortCount(countOf(m1(/id="v-views">[\s\S]{0,120}?<strong class="mobile-hide">([^<]+)</, html))),
    likes: shortCount(good),
    approval: good + bad > 0 ? Math.round((good / (good + bad)) * 100) : '',
    duration: clock(parseInt(ogTag(html, 'duration'), 10)),
    channel: m1(/uploader-tag hover-name"><span class="name">(?:<span[^>]*><\/span>)?\s*([^<]+)</, html)
  });
}

function phListStats(chunk) {
  var title = m1(/title="([^"]*)"/, chunk);
  return compact({
    quality: quality(title),
    duration: listDuration(m1(/<var class="[^"]*\bduration\b[^"]*"[^>]*>([^<]+)</, chunk)),
    channel: m1(/class="usernameWrap[^"]*">\s*<a[^>]*>([^<]+)</, chunk),
    views: shortCount(countOf(m1(/class="views">(?:<i[^>]*><\/i>)?\s*<var>([^<]+)</, chunk))),
    approval: parseInt(m1(/<div class="value">(\d+)%</, chunk), 10) || ''
  });
}

function phPageStats(html) {
  return compact({
    views: shortCount(countOf(m1(/<span class="count">([^<]+)</, html))),
    likes: shortCount(parseInt(m1(/class="votesUp" data-rating="(\d+)"/, html), 10)),
    duration: clock(parseInt(m1(/"video_duration":"?(\d+)/, html), 10)),
    channel: m1(/'video_uploader_name' : '([^']+)'/, html)
  });
}

// Fim da <ul> que começa em "start", contando as listas de dentro (cada vídeo da categoria tem
// uma <ul> própria: o primeiro "</ul>" cortava a lista depois de uns 6 vídeos).
function closingUl(html, start) {
  var depth = 0;
  var re = /<ul\b|<\/ul>/g;
  re.lastIndex = html.lastIndexOf('<ul', start);
  var m;
  while ((m = re.exec(html))) {
    if (m[0] === '</ul>') {
      depth--;
      if (depth <= 0) return m.index;
    } else depth++;
  }
  return -1;
}

function withThumbs(list, thumbs) {
  if (thumbs) list.forEach(function (s) { s.thumbs = thumbs; });
  return list;
}

function attr(chunk, name) {
  var m = chunk.match(new RegExp(name + '="([^"]*)"'));
  return m ? unhtml(m[1]) : '';
}

function ogTag(html, prop) {
  var m = html.match(new RegExp('<meta property="og:' + prop + '" content="([^"]*)"'));
  if (m) return unhtml(m[1]);
  // Fallback: atributos em outra ordem ou com aspas simples
  var want = new RegExp('\\bproperty=["\']og:' + prop + '["\']', 'i');
  var tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (var i = 0; i < tags.length; i++) {
    if (!want.test(tags[i])) continue;
    var c = tags[i].match(/\bcontent="([^"]*)"/i) || tags[i].match(/\bcontent='([^']*)'/i);
    if (c) return unhtml(c[1]);
  }
  return '';
}

// Logos em SVG embutido (nítidos em qualquer tamanho e sem depender do site no ar).
function svgLogo(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }
var XV_LOGO = svgLogo('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0d0d0d"/>' +
  '<text x="32" y="39" text-anchor="middle" font-family="Arial Black,Arial,Helvetica,sans-serif" font-weight="900" font-size="34" fill="#de2600">X</text>' +
  '<text x="32" y="53" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="10.5" letter-spacing="0.6" fill="#ffffff">VIDEOS</text></svg>');
var PH_LOGO = svgLogo('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#000"/>' +
  '<text x="32" y="28" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="17" fill="#fff">Porn</text>' +
  '<rect x="11" y="33" width="42" height="21" rx="4" fill="#ff9000"/>' +
  '<text x="32" y="49" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="17" fill="#000">hub</text></svg>');

// Categorias dos sites (rótulo em português → termo de busca no XVideos / número da categoria no
// Pornhub). Os rótulos vão no manifest como opções do extra "genre": a aba NSFW mostra cada um como
// um cartão e abre a grade da categoria.
var XV_CATS = [
  ['Amador', 'amateur'], ['Anal', 'anal'], ['Asiáticas', 'asian'], ['Brasileiras', 'brasileira'], ['Bundudas', 'big ass'],
  ['Caseiro', 'homemade'], ['Casal', 'couple'], ['Dotados', 'big cock'], ['Gozada', 'cumshot'], ['Hentai', 'hentai'],
  ['Inter-racial', 'interracial'], ['Japonesas', 'japanese'], ['Latinas', 'latina'], ['Lésbicas', 'lesbian'], ['Loiras', 'blonde'],
  ['Maduras', 'mature'], ['Massagem', 'massage'], ['Masturbação', 'masturbation'], ['Ménage', 'threesome'], ['MILF', 'milf'],
  ['Morenas', 'brunette'], ['Negras', 'ebony'], ['Novinhas (18+)', 'teen'], ['Oral', 'blowjob'], ['Orgia', 'orgy'],
  ['Peitudas', 'big tits'], ['POV', 'pov'], ['Em público', 'public'], ['Romântico', 'romantic'], ['Ruivas', 'redhead'],
  ['Squirt', 'squirt'], ['Brinquedos', 'toys']
];
var XV_GAY_CATS = [
  ['Amador', 'amateur'], ['Bareback', 'bareback'], ['Brasileiros', 'brasileiro'], ['Caseiro', 'homemade'], ['Daddy', 'daddy'],
  ['Dotados', 'big cock'], ['Grupo', 'group'], ['Hétero curioso', 'straight'], ['Inter-racial', 'interracial'], ['Latinos', 'latino'],
  ['Musculosos', 'muscle'], ['Negros', 'black'], ['Oral', 'blowjob'], ['POV', 'pov'], ['Twinks (18+)', 'twink'], ['Ursos', 'bear']
];
var PH_CATS = [
  ['Amador', '3'], ['Anal', '35'], ['Asiáticas', '1'], ['Brasileiras', '102'], ['Bundudas', '4'], ['Casal verificado', '482'],
  ['Dotados', '7'], ['Gozada', '16'], ['Hentai', '36'], ['Inter-racial', '25'], ['Japonesas', '111'], ['Latinas', '26'],
  ['Lésbicas', '27'], ['Loiras', '9'], ['Maduras', '28'], ['Massagem', '78'], ['Ménage', '65'], ['MILF', '29'], ['Morenas', '11'],
  ['Negras', '17'], ['Oral', '13'], ['Orgasmo feminino', '502'], ['Peitudas', '8'], ['POV', '41'], ['Em público', '24'],
  ['Romântico', '522'], ['Ruivas', '42'], ['Sexo bruto', '67'], ['Squirt', '69'], ['Brinquedos', '23'], ['Amadoras verificadas', '138']
];
var PH_GAY_CATS = [
  ['Amador', '252'], ['Bareback', '40'], ['Daddy', '47'], ['Dotados', '58'], ['Grupo', '62'], ['Héteros', '82'], ['Inter-racial', '64'],
  ['Japoneses', '39'], ['Latinos', '50'], ['Musculosos', '51'], ['Negros', '44'], ['Oral', '56'], ['POV', '372'], ['Twinks (18+)', '49'],
  ['Ursos', '66'], ['Amadores verificados', '731']
];
function optionsOf(list) { return list.map(function (x) { return x[0]; }); }
function termOf(list, label) {
  for (var i = 0; i < list.length; i++) if (list[i][0] === label) return list[i][1];
  return '';
}

// Ordenação (extra "sort", opcional): só o que o site aceita segundo o que o código já usava.
// XVideos: new = mais recentes; top-week/top-month = mais vistos (semana/mês); rating = mais bem avaliados.
// Pornhub: new = mais recentes; hot = em alta; top-week/top-month = mais vistos (semana/mês).
var XV_SORT = { new: 'sort=uploaddate', 'top-week': 'sort=views&datef=week', 'top-month': 'sort=views&datef=month', rating: 'sort=rating&datef=6month' };
var PH_SORT = { new: 'o=cm', hot: 'o=ht', 'top-week': 'o=mv&t=w', 'top-month': 'o=mv&t=m' };
var SORT_XV = { name: 'sort', options: ['new', 'top-week', 'top-month', 'rating'] };
var SORT_PH = { name: 'sort', options: ['new', 'hot', 'top-week', 'top-month'] };
// Valor de sort que o site aceita (qualquer outro é ignorado: fica o padrão do catálogo)
function sortOf(table, value) {
  return Object.prototype.hasOwnProperty.call(table, value) ? table[value] : '';
}

// Pornhub: só a lista principal da página (antes dela vêm vídeos promovidos e, depois, recomendados).
// Usa o primeiro marcador que existir; sem vídeo no recorte, a página inteira (ver parseList).
function phScope(html) {
  var at = [html.indexOf('id="videoSearchResult"'), html.indexOf('id="videoCategory"'), html.indexOf('id="mostRecentVideosSection"')]
    .filter(function (i) { return i >= 0; });
  if (!at.length) return html;
  var start = Math.min.apply(null, at);
  var end = closingUl(html, start);
  return end > start ? html.slice(start, end) : html.slice(start);
}

function phItems(html) {
  var out = [];
  var seen = Object.create(null);
  html.split('data-video-vkey="').slice(1).forEach(function (chunk) {
    var key = chunk.slice(0, chunk.indexOf('"'));
    if (!/^[\w]+$/.test(key) || seen[key]) return;
    var img = chunk.match(/<img[^>]*\ssrc="([^"]+)"/);
    // Sem título: usa o alt da imagem ou o código do vídeo (o item não some da lista)
    var title = attr(chunk, 'title') || unhtml((chunk.match(/<img[^>]*\salt="([^"]+)"/) || [])[1]) || 'Vídeo ' + key;
    seen[key] = true;
    // preview: WebM de 180p do "mediabook" (o link vale por umas horas e só para o IP da TV, que abriu a página).
    out.push({ id: 'ph:' + key, type: 'movie', name: title, poster: img ? unhtml(img[1]) : '', posterShape: 'landscape', preview: attr(chunk, 'data-mediabook'), stats: phListStats(chunk) });
  });
  return out;
}

// Pornhub: playlists HLS da página, e o link da lista MP4 (o site responde JSON com as qualidades).
function phHls(html) {
  return jsonArrayAfter(html, 'mediaDefinitions')
    .filter(function (d) { return d.format === 'hls' && d.videoUrl && /^\d+$/.test(String(d.quality)); })
    .sort(function (a, b) { return Number(b.quality) - Number(a.quality); });
}
function phMp4Url(html) {
  var d = jsonArrayAfter(html, 'mediaDefinitions').filter(function (x) { return x.format === 'mp4' && x.videoUrl; })[0];
  return d ? urlLib.resolve('https://www.pornhub.com/', d.videoUrl) : '';
}

var TUBES = {
  xv: {
    manifest: {
      id: 'seraflix.xvideos',
      version: '1.0.0',
      name: 'XVideos',
      description: 'XVideos pela própria TV (Seraflix). Conteúdo adulto.',
      logo: XV_LOGO,
      resources: ['catalog', 'meta', 'stream'],
      types: ['movie'],
      idPrefixes: ['xv:'],
      behaviorHints: { adult: true },
      catalogs: [
        // Recomendadas primeiro: são as primeiras fileiras da aba NSFW. Creampie: o que está em alta
        // agora (mais vistos da semana/do mês), para a fileira mudar sempre em vez de repetir os
        // mais vistos de todos os tempos. "sort" (opcional) troca a ordem padrão; "Novidades" é por data.
        { type: 'movie', id: 'xv-cp', name: 'Creampie hétero', extra: [{ name: 'skip' }, SORT_XV] },
        { type: 'movie', id: 'xv-cpgay', name: 'Creampie gay', extra: [{ name: 'skip' }, SORT_XV] },
        { type: 'movie', id: 'xv-cpnew', name: 'Creampie: lançamentos', extra: [{ name: 'skip' }, SORT_XV] },
        { type: 'movie', id: 'xv-new', name: 'Novidades', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'xv-top', name: 'Em alta no mês', extra: [{ name: 'skip' }, SORT_XV] },
        { type: 'movie', id: 'xv-4k', name: '4K mais bem avaliados', extra: [{ name: 'skip' }, SORT_XV] },
        { type: 'movie', id: 'xv-cat', name: 'Categorias', extra: [{ name: 'genre', isRequired: true, options: optionsOf(XV_CATS) }, { name: 'skip' }, SORT_XV] },
        { type: 'movie', id: 'xv-gaycat', name: 'Categorias gay', extra: [{ name: 'genre', isRequired: true, options: optionsOf(XV_GAY_CATS) }, { name: 'skip' }, SORT_XV] },
        { type: 'movie', id: 'xv-search', name: 'Busca', extra: [{ name: 'search', isRequired: true }, { name: 'skip' }, SORT_XV] }
      ]
    },
    // Itens por página nominal: skip = n × PAGE ⇒ página n. O site manda ~27 a 32 e todos vão ao app
    // (sem corte); quem soma os itens recebidos também cai na página certa (ver pageFor).
    PAGE: 20,
    listUrl: function (cat, page, extra) {
      var p = page ? '&p=' + page : '';
      // orientation=gay|straight: a busca da aba NSFW pede as duas listas (bissexual).
      var gay = extra.orientation === 'gay' || extra.gay === '1' || extra.gay === 'true';
      var s = sortOf(XV_SORT, extra.sort); // '' sem sort: fica o padrão de cada catálogo
      function site(term, typef, dflt) {
        return 'https://www.xvideos.com/?k=' + encodeURIComponent(term) + (typef ? '&typef=gay' : '') + '&' + (s || dflt) + p;
      }
      if (cat === 'xv-search') {
        return 'https://www.xvideos.com/?k=' + encodeURIComponent(extra.search || '') + (gay ? '&typef=gay' : '') + (s ? '&' + s : '') + p;
      }
      if (cat === 'xv-cp') return site('creampie', false, 'sort=views&datef=week');
      if (cat === 'xv-cpgay') return site('creampie', true, 'sort=views&datef=month');
      if (cat === 'xv-cpnew') return site('creampie', false, 'sort=uploaddate');
      if (cat === 'xv-top') return site('hd', false, 'sort=views&datef=month');
      if (cat === 'xv-4k') return site('4k', false, 'sort=rating&datef=6month');
      if (cat === 'xv-cat' || cat === 'xv-gaycat') {
        var term = termOf(cat === 'xv-cat' ? XV_CATS : XV_GAY_CATS, extra.genre);
        if (!term) return '';
        return site(term, cat === 'xv-gaycat', 'sort=views&datef=month');
      }
      // Novidades: a primeira página é a inicial; as seguintes, /new/1, /new/2...
      return page ? 'https://www.xvideos.com/new/' + page : 'https://www.xvideos.com/';
    },
    parseList: function (html) {
      var out = [];
      html.split('id="video_').slice(1).forEach(function (chunk) {
        var href = attr(chunk, 'href');
        if (href.indexOf('/video') !== 0) return;
        var title = (chunk.match(/<p class="title"><a href="[^"]*" title="([^"]*)"/) || [])[1];
        // Sem o formato usual: qualquer <a> com title, ou o nome do endereço (/videoN/nome-do-video)
        if (!title) title = (chunk.match(/<a\b[^>]*\btitle="([^"]*)"/) || [])[1];
        if (!title) title = href.split('/').slice(2).join(' ').replace(/[-_]+/g, ' ').trim() || 'Vídeo sem título';
        var thumb = attr(chunk, 'data-src');
        // preview: o MP4 curtinho que o site toca ao passar o mouse (o app toca no cartão em foco).
        out.push({ id: 'xv:' + href, type: 'movie', name: unhtml(title), poster: thumb, posterShape: 'landscape', preview: attr(chunk, 'data-pvv'), stats: xvListStats(chunk) });
      });
      return out;
    },
    pageUrl: function (id) { return 'https://www.xvideos.com' + id.slice(3); },
    parseMeta: function (id, html) {
      return { id: id, type: 'movie', name: ogTag(html, 'title') || 'XVideos', poster: ogTag(html, 'image'), background: ogTag(html, 'image'), posterShape: 'landscape', description: ogTag(html, 'description'), stats: xvPageStats(html) };
    },
    // Uma leitura da página do vídeo (cache de 5 min): meta e fontes saem do mesmo HTML.
    parsePage: function (id, html) {
      var streams = this.parseStreams(html);
      return { meta: this.parseMeta(id, html), streams: streams, good: streams.length > 0 };
    },
    parseStreams: function (html) {
      var out = [];
      var hls = (html.match(/setVideoHLS\('([^']+)'\)/) || [])[1];
      var high = (html.match(/setVideoUrlHigh\('([^']+)'\)/) || [])[1];
      // Direto primeiro: a página foi aberta daqui da TV, então o link já vale para ela, e o vídeo
      // não depende do serviço ficar de pé enquanto toca. Pelo serviço fica de reserva.
      if (hls) out.push({ name: 'XVideos\nHLS até 1080p', title: 'Melhor qualidade disponível (1080p HD)', url: hls });
      if (hls) out.push({ name: 'XVideos\nHLS pela TV', title: 'Mesmo vídeo passando pelo serviço da TV', url: proxied(hls, 'hls.m3u8') });
      if (high) out.push({ name: 'XVideos\n360p', title: 'MP4 360p (mais leve)', url: high });
      if (high) out.push({ name: 'XVideos\n360p pela TV', title: 'MP4 360p passando pelo serviço da TV', url: proxied(high, 'video.mp4') });
      var thumbs = null;
      try { thumbs = xvThumbs(html); } catch (e) {}
      return withThumbs(out, thumbs);
    }
  },
  ph: {
    manifest: {
      id: 'seraflix.pornhub',
      version: '1.0.0',
      name: 'Pornhub',
      description: 'Pornhub pela própria TV (Seraflix). Conteúdo adulto.',
      logo: PH_LOGO,
      resources: ['catalog', 'meta', 'stream'],
      types: ['movie'],
      idPrefixes: ['ph:'],
      behaviorHints: { adult: true },
      catalogs: [
        { type: 'movie', id: 'ph-cp', name: 'Creampie hétero', extra: [{ name: 'skip' }, SORT_PH] },
        { type: 'movie', id: 'ph-cpgay', name: 'Creampie gay', extra: [{ name: 'skip' }, SORT_PH] },
        { type: 'movie', id: 'ph-cpnew', name: 'Creampie: lançamentos', extra: [{ name: 'skip' }, SORT_PH] },
        { type: 'movie', id: 'ph-new', name: 'Novidades', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'ph-hot', name: 'Em alta', extra: [{ name: 'skip' }, SORT_PH] },
        { type: 'movie', id: 'ph-top', name: 'Mais vistos do mês', extra: [{ name: 'skip' }, SORT_PH] },
        { type: 'movie', id: 'ph-cat', name: 'Categorias', extra: [{ name: 'genre', isRequired: true, options: optionsOf(PH_CATS) }, { name: 'skip' }, SORT_PH] },
        { type: 'movie', id: 'ph-gaycat', name: 'Categorias gay', extra: [{ name: 'genre', isRequired: true, options: optionsOf(PH_GAY_CATS) }, { name: 'skip' }, SORT_PH] },
        { type: 'movie', id: 'ph-search', name: 'Busca', extra: [{ name: 'search', isRequired: true }, { name: 'skip' }, SORT_PH] }
      ]
    },
    // Itens por página nominal (ver o PAGE do XVideos). "Novidades" (o=cm) é por data, sem sort.
    PAGE: 24,
    listUrl: function (cat, page, extra) {
      var p = '&page=' + ((page || 0) + 1);
      var gay = extra.orientation === 'gay' || extra.gay === '1' || extra.gay === 'true';
      var s = sortOf(PH_SORT, extra.sort); // '' sem sort: fica o padrão de cada catálogo
      // Creampie: os mais vistos da semana (hétero) e do mês (gay, que tem menos vídeos novos).
      if (cat === 'ph-cp') return 'https://www.pornhub.com/video/search?search=creampie&' + (s || 'o=mv&t=w') + p;
      if (cat === 'ph-cpgay') return 'https://www.pornhub.com/gay/video/search?search=creampie&' + (s || 'o=mv&t=m') + p;
      if (cat === 'ph-cpnew') return 'https://www.pornhub.com/video?c=15&' + (s || 'o=cm') + p;
      // Busca: /gay/video/search para a lista gay; senão a busca hétero padrão.
      if (cat === 'ph-search') {
        return 'https://www.pornhub.com/' + (gay ? 'gay/' : '') + 'video/search?search=' + encodeURIComponent(extra.search || '') + (s ? '&' + s : '') + p;
      }
      if (cat === 'ph-cat' || cat === 'ph-gaycat') {
        var c = termOf(cat === 'ph-cat' ? PH_CATS : PH_GAY_CATS, extra.genre);
        if (!c) return '';
        return 'https://www.pornhub.com/' + (cat === 'ph-gaycat' ? 'gay/' : '') + 'video?c=' + c + '&' + (s || 'o=mv&t=m') + p; // mais vistos do mês: novo e sempre com a página cheia
      }
      if (cat === 'ph-new') return 'https://www.pornhub.com/video?o=cm' + p;
      if (cat === 'ph-top') return 'https://www.pornhub.com/video?' + (s || 'o=mv&t=m') + p;
      return 'https://www.pornhub.com/video?' + (s || 'o=ht') + p; // ph-hot (em alta) e o padrão
    },
    parseList: function (html) {
      // Recorte da lista principal; se o recorte não tiver vídeo (o site mudou o marcador), vale a página inteira
      var out = phItems(phScope(html));
      return out.length ? out : phItems(html);
    },
    pageUrl: function (id) { return 'https://www.pornhub.com/view_video.php?viewkey=' + id.slice(3); },
    parseMeta: function (id, html) {
      return { id: id, type: 'movie', name: ogTag(html, 'title') || 'Pornhub', poster: ogTag(html, 'image'), background: ogTag(html, 'image'), posterShape: 'landscape', description: ogTag(html, 'description'), stats: phPageStats(html) };
    },
    // Uma leitura da página do vídeo (cache de 5 min): meta, playlists HLS, link da lista MP4 e miniaturas.
    parsePage: function (id, html) {
      var hls = phHls(html);
      var gm = '';
      var thumbs = null;
      try { gm = phMp4Url(html); } catch (e) {}
      try { thumbs = phThumbs(html); } catch (e) {}
      return { meta: this.parseMeta(id, html), hls: hls, gm: gm, thumbs: thumbs, good: hls.length > 0 };
    },
    // Pornhub: na primeira visita a página às vezes traz links que respondem 410. O serviço confere
    // a playlist e, se ela não abre, pede a página de novo já com os cookies de sessão (até 3 visitas).
    // A ordem: HLS na melhor qualidade (não depende do IP), MP4 (o próprio site, toca sem hls.js, mas
    // vale só para o IP que abriu a página) e, de reserva, o HLS passando pelo serviço. A checagem da
    // playlist e a lista MP4 correm juntas; o orçamento de STREAM_BUDGET_MS devolve o que já tiver.
    streams: function (id, cb) {
      var self = this;
      var page = this.pageUrl(id);
      var t0 = Date.now();
      var st = { hls: [], mp4: null, thumbs: null };
      var finished = false;
      var timer = setTimeout(function () { finish(null); }, STREAM_BUDGET_MS);
      function left() { return Math.max(1000, STREAM_BUDGET_MS - (Date.now() - t0)); }
      function finish(err) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (err && !st.hls.length && !st.mp4) return cb(err);
        cb(null, withThumbs(build(st.hls, st.mp4 || []), st.thumbs));
      }
      function load(tries) {
        if (finished) return;
        var last = tries >= 2;
        var opts = { ttl: PAGE_TTL, fresh: tries > 0, limit: left(), ok: function (v) { return v.good; } };
        cachedFetch(page, opts, function (html) { return self.parsePage(id, html); }, function (err, v) {
          if (finished) return;
          if (err) return finish(err);
          st.hls = v.hls;
          st.thumbs = v.thumbs;
          var okHls = false;
          var jobs = 2; // a playlist e a lista MP4
          function job() { if (--jobs === 0) decide(); }
          function decide() {
            if (finished) return;
            if (okHls || last) return finish(null);
            load(tries + 1);
          }
          if (v.hls.length) urlOk(v.hls[0].videoUrl, function (ok) { okHls = ok; job(); }, left());
          else job();
          if (v.gm) {
            cachedFetch(v.gm, { ttl: PAGE_TTL, limit: left(), ok: Array.isArray }, function (text) { return JSON.parse(text); }, function (e, list) {
              st.mp4 = e ? [] : list;
              job();
            });
          } else job();
        });
      }
      function build(hls, mp4) {
        var out = [];
        if (hls.length) out.push({ name: 'Pornhub\n' + hls[0].quality + 'p', title: 'HLS ' + hls[0].quality + 'p', url: hls[0].videoUrl });
        mp4.filter(function (d) { return d && d.videoUrl && /^\d+$/.test(String(d.quality)); })
          .sort(function (a, b) { return Number(b.quality) - Number(a.quality); })
          .slice(0, 2)
          .forEach(function (d) { out.push({ name: 'Pornhub\n' + d.quality + 'p MP4', title: 'MP4 ' + d.quality + 'p', url: d.videoUrl }); });
        if (hls.length) out.push({ name: 'Pornhub\n' + hls[0].quality + 'p pela TV', title: 'HLS ' + hls[0].quality + 'p passando pelo serviço da TV', url: proxied(hls[0].videoUrl, 'hls.m3u8') });
        return out;
      }
      load(0);
    }
  }
};

// Tamanho nominal de página em cada catálogo: o app pede a página n com skip = n × pageSize.
Object.keys(TUBES).forEach(function (k) {
  TUBES[k].manifest.catalogs.forEach(function (c) { c.pageSize = TUBES[k].PAGE; });
});

// /xv/catalog/movie/xv-new/skip=27.json → { tube: 'xv', resource: 'catalog', id: 'xv-new', extra: { skip: '27' } }
function parseAddonUrl(url) {
  var m = url.match(/^\/(xv|ph)\/(manifest\.json|(catalog|meta|stream)\/movie\/([^/]+?)(?:\/([^/]+))?\.json)$/);
  if (!m) return null;
  var extra = {};
  if (m[5]) m[5].split('&').forEach(function (kv) { var p = kv.split('='); extra[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
  return { tube: m[1], resource: m[3] || 'manifest', id: m[4] ? decodeURIComponent(m[4]) : '', extra: extra };
}

// Erro ao ler uma página (o site mudou o HTML) não pode derrubar o serviço: vira resposta vazia.
function safe(res, empty, fn) {
  return function (err, html) {
    try { fn(err, html); } catch (e) { json(res, 200, empty); }
  };
}

// ---------- Vídeo pelo serviço da TV ----------
// O <video> da TV não toca bem direto dos sites: o XVideos manda as playlists HLS como text/plain e
// os links do Pornhub valem só para o IP que abriu a página. Passando por aqui, playlist e pedaços
// do vídeo são pedidos com o mesmo IP e cabeçalhos que abriram a página, e as playlists saem com o
// tipo certo. Só repassa endereços desses sites (o serviço escuta na rede de casa).
var PX_HOSTS = /(^|\.)(xvideos-cdn\.com|xvideos\.com|phncdn\.com|pornhub\.com)$/i;

var PLAYLIST_MAX = 512 * 1024; // playlist HLS que o serviço lê inteira (para reescrever)

// Últimos pedidos de vídeo (para o aviso de erro do player mostrar o que o site respondeu).
var pxLog = [];
function pxNote(target, status, error) {
  var u = urlLib.parse(target);
  pxLog.push({ at: Date.now(), host: u.hostname, file: (u.pathname || '').split('/').pop().slice(0, 40), status: status, error: error ? String(error.code || error.message || error).slice(0, 80) : '' });
  if (pxLog.length > 20) pxLog.shift();
}

function proxied(target, file) {
  return 'http://127.0.0.1:' + ADDON_PORT + '/px/' + file + '?u=' + encodeURIComponent(target);
}

function isPlaylist(target, type) {
  return /mpegurl/i.test(type || '') || /\.m3u8($|\?)/i.test(urlLib.parse(target).pathname || '');
}

// Reescreve cada endereço da playlist (linhas e URI="...") para passar por aqui também.
function rewritePlaylist(text, base) {
  function wrap(ref) {
    var abs = urlLib.resolve(base, ref.trim());
    return proxied(abs, isPlaylist(abs) ? 'hls.m3u8' : 'seg.ts');
  }
  return text.split(/\r?\n/).map(function (line) {
    if (!line) return line;
    if (line.charAt(0) === '#') return line.replace(/URI="([^"]+)"/g, function (m, ref) { return 'URI="' + wrap(ref) + '"'; });
    return wrap(line);
  }).join('\n');
}

function proxyRoute(req, res, query) {
  var target = query.u;
  var parsed = target ? urlLib.parse(target) : null;
  if (!parsed || !/^https?:$/.test(parsed.protocol || '') || !PX_HOSTS.test(parsed.hostname || '')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('endereço não permitido');
  }
  var hops = 0;
  var done = false;
  function fail(code, err) {
    if (done) return;
    done = true;
    pxNote(target, code || 502, err || 'falhou');
    try { res.writeHead(code || 502, { 'Content-Type': 'text/plain' }); res.end('falhou'); } catch (e) {}
  }
  function go(addr) {
    var opts = urlLib.parse(addr);
    // Cada endereço (inclusive os de redirecionamento) precisa ser de site permitido
    if (!/^https?:$/.test(opts.protocol || '') || !PX_HOSTS.test(opts.hostname || '')) return fail(400, 'endereço não permitido');
    var site =/phncdn|pornhub/i.test(opts.hostname) ? 'https://www.pornhub.com/' : 'https://www.xvideos.com/';
    opts.headers = { 'User-Agent': UA, Referer: site, Origin: site.slice(0, -1), Accept: '*/*' };
    // Playlist é reescrita inteira: pedaço dela (Range) não serve.
    if (req.headers.range && !isPlaylist(addr)) opts.headers.Range = req.headers.range;
    var lib = opts.protocol === 'http:' ? http : https;
    var up;
    try {
      up = lib.get(agentFor(withCa(opts)), function (r) {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops++ < 4) {
          r.resume();
          return go(urlLib.resolve(addr, r.headers.location));
        }
        var type = r.headers['content-type'] || '';
        pxNote(addr, r.statusCode, '');
        if ((r.statusCode === 200 || r.statusCode === 206) && isPlaylist(addr, type)) {
          var parts = [];
          var size = 0;
          r.on('data', function (c) {
            size += c.length;
            // playlist grande demais: para (não enche a memória da TV)
            if (size > PLAYLIST_MAX) { r.destroy(); return fail(502, 'playlist grande demais'); }
            parts.push(c);
          });
          r.on('end', function () {
            if (done) return;
            done = true;
            var body = rewritePlaylist(Buffer.concat(parts).toString('utf8'), addr);
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
            res.end(body);
          });
          r.on('error', function () { fail(); });
          return;
        }
        if (done) return r.resume();
        done = true;
        var head = { 'Access-Control-Allow-Origin': '*' };
        // .ts vem como application/octet-stream de alguns CDNs: a TV prefere o tipo certo.
        head['Content-Type'] = /\.ts($|\?)/i.test(opts.pathname || '') ? 'video/mp2t' : type || 'application/octet-stream';
        ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'].forEach(function (k) {
          if (r.headers[k]) head[k] = r.headers[k];
        });
        res.writeHead(r.statusCode, head);
        r.pipe(res);
        r.on('error', function () { try { res.end(); } catch (e) {} });
      });
    } catch (e) {
      return fail();
    }
    up.on('error', function (e) {
      if (isCertError(e) && !caOn(opts.hostname) && !done) {
        caSet(opts.hostname);
        return go(addr);
      }
      fail(502, e);
    });
    up.setTimeout(20000, function () { up.abort(); fail(504, 'tempo esgotado'); });
    // A TV desistiu (trocou de qualidade, fechou o player): para de baixar.
    res.on('close', function () { try { up.abort(); } catch (e) {} });
  }
  go(target);
}

// ---------- Agenda (iCal) ----------
// O app não consegue ler o .ics do Google direto (sem CORS): o serviço baixa e repassa. Só de
// serviços de agenda conhecidos (o serviço escuta na rede de casa e não pode virar proxy aberto).
var CAL_HOSTS = /(^|\.)(calendar\.google\.com|icloud\.com|outlook\.office365\.com|outlook\.live\.com)$/i;
function calendarRoute(res, query) {
  var target = String(query.u || '');
  var parsed = urlLib.parse(target);
  if (parsed.protocol !== 'https:' || !CAL_HOSTS.test(parsed.hostname || '')) {
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    return res.end('endereço de agenda não permitido');
  }
  fetchText(target, function (err, text) {
    if (err) {
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      return res.end(String(err.message || err));
    }
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(text);
  });
}

// Últimos pedidos aos sites (catálogo e fontes): /api/tubelog, para o app explicar quando um site
// não responde ("Pornhub: vazio (verificação de idade)") em vez de só mostrar a fileira vazia.
var tubeLog = [];
function tubeNote(tube, what, result) {
  tubeLog.push({ at: Date.now(), tube: tube, what: String(what).slice(0, 80), result: String(result).slice(0, 120) });
  if (tubeLog.length > 30) tubeLog.shift();
}
// O que veio no lugar da lista (para o diagnóstico).
function pageKind(html) {
  var t = String(html || '');
  if (!t) return 'sem resposta';
  if (/age[_ -]?verif|ageVerification|are you 18|over 18|idade/i.test(t.slice(0, 20000))) return 'verificação de idade';
  if (/cf-chl|challenge-platform|captcha/i.test(t)) return 'bloqueio anti-robô';
  if (/not available in your (country|region)|blocked in your/i.test(t)) return 'bloqueado na região';
  return 'página sem vídeos, ' + Math.round(t.length / 1024) + ' KB';
}

// Catálogo: uma tentativa (até 6 s) e, se falhar ou vier vazio, mais uma depois de uma pausa curta
// (a 2ª já com os cookies da sessão). No total ~10 s; o app espera 12 s. Sem resultado: lista vazia.
var CATALOG_BUDGET_MS = 9500;
function listParser(tube) {
  return function (html) {
    var metas = tube.parseList(html);
    return { metas: metas, kind: metas.length ? '' : pageKind(html) };
  };
}
function catalogRoute(tube, r, res) {
  var base = tube.listUrl(r.id, 0, r.extra);
  if (!base) return json(res, 200, { metas: [] });
  var page = pageFor(r.tube, base, r.extra.skip, tube.PAGE);
  var listUrl = tube.listUrl(r.id, page, r.extra);
  var t0 = Date.now();
  var what = 'catalog ' + r.id + (r.extra.genre ? ' ' + r.extra.genre : '') + (r.extra.sort ? ' ' + r.extra.sort : '') + (page ? ' p' + page : '');
  function attempt(n) {
    var left = CATALOG_BUDGET_MS - (Date.now() - t0);
    var limit = n === 0 ? Math.min(6000, left) : Math.max(1000, left);
    var opts = { ttl: LIST_TTL, fresh: n > 0, limit: limit, ok: function (v) { return v.metas.length > 0; } };
    cachedFetch(listUrl, opts, listParser(tube), function (err, got, stale) {
      try {
        var metas = got && got.metas ? got.metas : [];
        if (!metas.length && n === 0 && CATALOG_BUDGET_MS - (Date.now() - t0) > 2000) return setTimeout(function () { attempt(1); }, 700);
        if (metas.length) notePage(r.tube, base, page, metas.length);
        var result = err ? String(err.message || err) : metas.length ? (stale ? 'ok (cache) ' : 'ok ') + metas.length : 'vazio (' + ((got && got.kind) || 'sem resposta') + ')';
        tubeNote(r.tube, what, result);
        json(res, 200, { metas: metas });
      } catch (e) {
        json(res, 200, { metas: [] });
      }
    });
  }
  attempt(0);
}

function addonRoute(url, res) {
  var r = parseAddonUrl(url);
  if (!r) return false;
  var tube = TUBES[r.tube];
  if (r.resource === 'manifest') { json(res, 200, tube.manifest); return true; }
  if (r.resource === 'catalog') { catalogRoute(tube, r, res); return true; }
  var empty = r.resource === 'meta' ? { meta: null } : { streams: [] };
  if (r.resource === 'stream' && tube.streams) {
    tube.streams(r.id, safe(res, empty, function (err, list) {
      tubeNote(r.tube, 'stream ' + r.id, err ? String(err.message || err) : list.length ? 'ok ' + list.length : 'sem link');
      json(res, 200, { streams: err ? [] : list });
    }));
    return true;
  }
  // Meta e fontes do XVideos: a página é lida uma vez (cache de 5 min) e serve os dois pedidos
  var opts = { ttl: PAGE_TTL, ok: function (v) { return v.good; } };
  cachedFetch(tube.pageUrl(r.id), opts, function (html) { return tube.parsePage(r.id, html); }, safe(res, empty, function (err, v) {
    if (err || !v) return json(res, 200, empty);
    if (r.resource === 'meta') return json(res, 200, { meta: v.meta });
    json(res, 200, { streams: v.streams });
  }));
  return true;
}

// ---------- Teste: dá para rodar torrent aqui na TV, sem o PC? ----------
// Mede o que um motor de torrent precisa: Node, memória livre, UDP (trackers/DHT), TCP de saída
// (troca com os peers), velocidade de download e onde dá para gravar. Cada parte tem tempo-limite.
function torrentTest(done) {
  var out = {
    node: process.version,
    arch: process.arch,
    memTotalMB: Math.round(os.totalmem() / 1048576),
    memFreeMB: Math.round(os.freemem() / 1048576),
    cpus: (os.cpus() || []).length
  };
  var left = 4;
  var finished = false;
  function step() {
    if (--left === 0 && !finished) { finished = true; done(out); }
  }
  setTimeout(function () { if (!finished) { finished = true; out.timeout = true; done(out); } }, 40000);
  testUdp(function (r) { out.udp = r; step(); });
  testTcp(function (r) { out.tcp = r; step(); });
  testSpeed(function (r) { out.speed = r; step(); });
  out.disk = testDisk();
  step();
}

// Pedido "connect" do protocolo de tracker UDP (BEP 15): resposta de 16 bytes = UDP funciona.
function testUdp(cb) {
  var dgram;
  try { dgram = require('dgram'); } catch (e) { return cb({ ok: false, why: 'sem dgram' }); }
  var sock = dgram.createSocket('udp4');
  var t0 = Date.now();
  var tid = Math.floor(Math.random() * 0xffffffff);
  var msg = bufAlloc(16);
  msg.writeUInt32BE(0x417, 0);
  msg.writeUInt32BE(0x27101980, 4);
  msg.writeUInt32BE(0, 8);
  msg.writeUInt32BE(tid, 12);
  var ended = false;
  function end(r) { if (ended) return; ended = true; try { sock.close(); } catch (e) {} cb(r); }
  sock.on('error', function (e) { end({ ok: false, why: e.code || e.message }); });
  sock.on('message', function (m) {
    if (m.length >= 16 && m.readUInt32BE(4) === tid) end({ ok: true, ms: Date.now() - t0 });
  });
  sock.send(msg, 0, 16, 1337, 'tracker.opentrackr.org', function (e) { if (e) end({ ok: false, why: e.code || e.message }); });
  setTimeout(function () { end({ ok: false, why: 'sem resposta' }); }, 8000);
}

// TCP de saída para uma porta alta (peers costumam usar 6881+): portquiz responde em qualquer porta.
function testTcp(cb) {
  var net = require('net');
  var t0 = Date.now();
  var s = net.connect({ host: 'portquiz.net', port: 6881 });
  var ended = false;
  function end(r) { if (ended) return; ended = true; s.destroy(); cb(r); }
  s.setTimeout(8000, function () { end({ ok: false, why: 'tempo esgotado' }); });
  s.on('connect', function () { end({ ok: true, ms: Date.now() - t0 }); });
  s.on('error', function (e) { end({ ok: false, why: e.code || e.message }); });
}

// Baixa 10 MB e mede a velocidade (Mbps). Também mostra se o Node aguenta HTTPS moderno.
function testSpeed(cb) {
  var bytes = 10000000;
  var t0 = Date.now();
  var got = 0;
  var req = https.get('https://speed.cloudflare.com/__down?bytes=' + bytes, function (r) {
    if (r.statusCode !== 200) { r.resume(); return cb({ ok: false, why: 'HTTP ' + r.statusCode }); }
    r.on('data', function (c) { got += c.length; });
    r.on('end', function () {
      var s = (Date.now() - t0) / 1000;
      cb({ ok: got > 0, mbps: Math.round((got * 8) / s / 1e5) / 10, MB: Math.round(got / 1e5) / 10, s: Math.round(s * 10) / 10 });
    });
  });
  req.on('error', function (e) { cb({ ok: false, why: e.code || e.message }); });
  req.setTimeout(30000, function () { req.abort(); cb({ ok: false, why: 'tempo esgotado', MB: Math.round(got / 1e5) / 10 }); });
}

// Onde dá para gravar pedaços do vídeo (1 MB de teste em cada pasta, apagado em seguida).
function testDisk() {
  var dirs = [os.tmpdir ? os.tmpdir() : '/tmp', '/tmp', '/home/owner/share', '/opt/usr/home/owner/content'];
  var res = {};
  var chunk = bufAlloc(1048576);
  dirs.forEach(function (d) {
    if (res[d] !== undefined) return;
    var f = d + '/seraflix-test-' + Date.now();
    try {
      fs.writeFileSync(f, chunk);
      fs.unlinkSync(f);
      res[d] = true;
    } catch (e) {
      res[d] = e.code || false;
    }
  });
  return res;
}

// Uma versão mais nova deste serviço quer a porta: sai e deixa ela assumir.
function quit(res) {
  json(res, 200, { ok: true });
  setTimeout(function () {
    try { addonServer.close(); } catch (e) {}
  }, 100);
}

// Pede para quem estiver nessa porta sair (uma versão antiga do serviço, que atende /api/quit).
function askQuit(port) {
  var q = http.request({ host: '127.0.0.1', port: port, path: '/api/quit', method: 'POST' }, function (r) { r.resume(); });
  q.on('error', function () {});
  q.setTimeout(3000, function () { q.abort(); });
  q.end();
}

// Versões antigas (até a 14) ainda abrem a 8090 com o controle remoto, e só saem quando alguém pede.
// Esta versão não usa mais a 8090: ao ligar, pede que a antiga saia e confere se a porta fechou
// (a antiga leva uns instantes). Conexão recusada = porta livre, e então para.
var oldChecks = 0;
function retireOld() {
  askQuit(OLD_PORT);
  setTimeout(checkOld, 1500);
}
function checkOld() {
  if (oldChecks++ >= 10) return;
  var c = http.get({ host: '127.0.0.1', port: OLD_PORT, path: '/api/version' }, function (r) {
    r.resume();
    retireOld(); // ainda respondeu: pede de novo
  });
  c.on('error', function () {}); // recusada: a porta ficou livre
  c.setTimeout(3000, function () { c.abort(); });
}
// Erro solto num retorno assíncrono derrubaria o processo inteiro do TizenBrew (e com ele este
// serviço e o vídeo que passa por aqui). Fica anotado no /api/pxlog e o serviço segue de pé.
// Um handler só por processo, mesmo com versões novas assumindo: ele anota na versão da vez.
process.__seraflixNote = function (e) { pxNote('http://tv/servico', 'erro', e); };
if (!process.__seraflixGuard) {
  process.__seraflixGuard = true;
  process.on('uncaughtException', function (e) {
    try { process.__seraflixNote(e); } catch (e2) {}
  });
}

// Um erro num pedido nunca pode derrubar o serviço: ele roda dentro do processo do TizenBrew.
function guarded(handler) {
  return function (req, res) {
    try {
      handler(req, res);
    } catch (e) {
      try { json(res, 500, { error: String(e && e.message) }); } catch (e2) {}
    }
  };
}

// Coloca o Seraflix na lista de serviços que o TizenBrew liga sozinho ao abrir. Assim os addons
// (aba NSFW) já respondem só de ligar o TizenBrew, sem abrir o Seraflix. Só mexe no arquivo se ele
// existir e for JSON válido.
function enableAutoLaunch() {
  try {
    var config = JSON.parse(fs.readFileSync(TIZENBREW_CONFIG, 'utf8'));
    var list = Array.isArray(config.autoLaunchServiceList) ? config.autoLaunchServiceList : [];
    if (list.indexOf(MODULE_NAME) >= 0) return;
    config.autoLaunchServiceList = list.concat([MODULE_NAME]);
    fs.writeFileSync(TIZENBREW_CONFIG, JSON.stringify(config, null, 4));
  } catch (e) {}
}

var addonServer = http.createServer(guarded(function (req, res) {
  var url = req.url.split('?')[0];
  if (url.indexOf('/px/') === 0) return proxyRoute(req, res, urlLib.parse(req.url, true).query);
  if (url === '/api/version') return json(res, 200, { version: SERVICE_VERSION });
  if (url === '/api/quit' && req.method === 'POST') return quit(res);
  if (url === '/api/pxlog') return json(res, 200, pxLog);
  if (url === '/api/tubelog') return json(res, 200, tubeLog);
  if (url === '/api/cal') return calendarRoute(res, urlLib.parse(req.url, true).query);
  // Diagnósticos (Ajustes → Sobre → teste da TV): o que a TV tem para rodar coisas mais pesadas.
  if (url === '/api/info') {
    return json(res, 200, {
      node: process.version,
      arch: process.arch,
      platform: process.platform,
      memTotalMB: Math.round(os.totalmem() / 1048576),
      memFreeMB: Math.round(os.freemem() / 1048576),
      cpus: (os.cpus() || []).length,
      uptimeMin: Math.round(os.uptime() / 60)
    });
  }
  if (url === '/api/torrent-test') return torrentTest(function (r) { json(res, 200, r); });
  if (addonRoute(url, res)) return;
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404');
}));
var addonTries = 0;
addonServer.on('error', function (e) {
  // Outra versão deste serviço está na porta: pede para ela sair e tenta de novo.
  if (e && e.code === 'EADDRINUSE' && addonTries++ < 10) {
    askQuit(ADDON_PORT);
    setTimeout(function () { addonServer.listen(ADDON_PORT, '127.0.0.1'); }, 1500);
  }
});
addonServer.listen(ADDON_PORT, '127.0.0.1'); // só a própria TV (o app fala em 127.0.0.1)
retireOld();
enableAutoLaunch();
