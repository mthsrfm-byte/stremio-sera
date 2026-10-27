'use strict';
// Serviço do Seraflix que roda DENTRO da TV (serviceFile do TizenBrew; liga quando o Seraflix abre).
// Serve o controle remoto em http://IP-DA-TV:8090 e repassa as teclas para o controle remoto
// de rede da própria TV (wss://127.0.0.1:8002). Assim o celular fala só HTTP simples com a TV:
// sem certificado, sem aviso de segurança, funciona no iPhone.
// Só usa módulos nativos do Node e ES5, porque a versão do Node muda de TV para TV.
var http = require('http');
var https = require('https');
var tls = require('tls');
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var urlLib = require('url');

var PORT = 8090;
var ADDON_PORT = 8092; // addons XVideos/Pornhub e vídeo (porta nova a cada mudança que versões antigas não sabem largar)
var SERVICE_VERSION = 5;
var PAGE_BASE = 'https://cdn.jsdelivr.net/gh/mthsrfm-byte/stremio-sera/remote/';
var APP_NAME = 'Seraflix Controle';
var TOKEN_FILE = '/home/owner/share/seraflixRemote.json';
var PAGE_TTL = 5 * 60 * 1000;
var TIZENBREW_CONFIG = '/home/owner/share/tizenbrewConfig.json';
var MODULE_NAME = 'mthsrfm-byte/stremio-sera'; // como o TizenBrew chama o módulo na lista de serviços

function buf(x, enc) { return Buffer.from && Buffer.from !== Uint8Array.from ? Buffer.from(x, enc) : new Buffer(x, enc); }
function bufAlloc(n) { return Buffer.alloc ? Buffer.alloc(n) : new Buffer(n).fill(0); }

// ---------- Token da TV (a TV pede "Permitir?" só na primeira vez) ----------
function readToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token || ''; } catch (e) { return ''; }
}
function saveToken(token) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: token })); } catch (e) {}
}

// ---------- Cliente WebSocket mínimo para o controle remoto da TV ----------
var tv = { socket: null, state: 'off', queue: [], retry: null };
var quitting = false; // outra versão do serviço assumiu

function tvConnect() {
  if (tv.socket) return;
  clearTimeout(tv.retry);
  var token = readToken();
  var path = '/api/v2/channels/samsung.remote.control?name=' + encodeURIComponent(buf(APP_NAME).toString('base64')) +
    (token ? '&token=' + encodeURIComponent(token) : '');
  var key = crypto.randomBytes(16).toString('base64');
  var s = tls.connect({ host: '127.0.0.1', port: 8002, rejectUnauthorized: false, servername: 'localhost' });
  tv.socket = s;
  tv.state = token ? 'connecting' : 'waiting';
  var handshake = true;
  var pending = bufAlloc(0);

  s.on('secureConnect', function () {
    s.write('GET ' + path + ' HTTP/1.1\r\nHost: 127.0.0.1:8002\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  s.on('data', function (chunk) {
    pending = Buffer.concat([pending, chunk]);
    if (handshake) {
      var end = pending.indexOf('\r\n\r\n');
      if (end < 0) return;
      var head = pending.slice(0, end).toString();
      pending = pending.slice(end + 4);
      if (head.indexOf(' 101') < 0) return s.destroy();
      handshake = false;
    }
    // Frames do servidor (sem máscara)
    while (pending.length >= 2) {
      var op = pending[0] & 0x0f;
      var len = pending[1] & 0x7f;
      var off = 2;
      if (len === 126) { if (pending.length < 4) return; len = pending.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (pending.length < 10) return; len = pending.readUInt32BE(6); off = 10; }
      if (pending.length < off + len) return;
      var payload = pending.slice(off, off + len);
      pending = pending.slice(off + len);
      if (op === 1) onTvMessage(payload.toString());
      else if (op === 9) sendFrame(0x0a, payload);
      else if (op === 8) s.destroy();
    }
  });
  function done() {
    if (tv.socket !== s) return;
    tv.socket = null;
    if (tv.state === 'on' || tv.state === 'connecting') tv.state = 'off';
    if (quitting) return;
    tv.retry = setTimeout(tvConnect, tv.state === 'refused' ? 15000 : 3000);
  }
  s.on('error', done);
  s.on('close', done);
}

function onTvMessage(text) {
  var msg = {};
  try { msg = JSON.parse(text); } catch (e) { return; }
  if (msg.event === 'ms.channel.connect') {
    if (msg.data && msg.data.token) saveToken(msg.data.token);
    tv.state = 'on';
    var q = tv.queue; tv.queue = [];
    q.forEach(tvSend);
  } else if (msg.event === 'ms.channel.unauthorized') {
    saveToken('');
    tv.state = 'refused';
    tv.queue = [];
  }
}

function sendFrame(op, data) {
  if (!tv.socket) return;
  var payload = typeof data === 'string' ? buf(data) : data;
  var len = payload.length;
  var head = len < 126 ? bufAlloc(2) : bufAlloc(4);
  head[0] = 0x80 | op;
  if (len < 126) head[1] = 0x80 | len;
  else { head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  var mask = crypto.randomBytes(4);
  var masked = bufAlloc(len);
  for (var i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  tv.socket.write(Buffer.concat([head, mask, masked]));
}

function tvSend(params) {
  if (tv.state !== 'on') {
    if (tv.queue.length < 20) tv.queue.push(params);
    tvConnect();
    return;
  }
  sendFrame(1, JSON.stringify({ method: 'ms.remote.control', params: params }));
}

// IP da TV na rede de casa (o primeiro IPv4 que não é o localhost).
function lanIp() {
  var ifaces = os.networkInterfaces();
  for (var name in ifaces) {
    for (var i = 0; i < ifaces[name].length; i++) {
      var a = ifaces[name][i];
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) return a.address;
    }
  }
  return '';
}

// ---------- "Mandar para a TV" ----------
// O celular escolhe um filme/série (POST /api/open) e o app do Seraflix, que pergunta aqui a cada
// poucos segundos (GET /api/pending), abre a tela dele. O pedido vale por 2 minutos.
var pendingOpen = null;
var lastPoll = 0; // última vez que o app perguntou: diz se o Seraflix está aberto
var OPEN_TTL = 2 * 60 * 1000;

function takePending() {
  if (!pendingOpen || Date.now() - pendingOpen.at > OPEN_TTL) { pendingOpen = null; return null; }
  var p = pendingOpen;
  pendingOpen = null;
  return p;
}

// ---------- Página do controle (vem do GitHub via jsDelivr, com cache curto) ----------
var pageCache = {};
var TYPES = { html: 'text/html; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json', js: 'application/javascript' };

function servePage(file, res) {
  var hit = pageCache[file];
  if (hit && Date.now() - hit.at < PAGE_TTL) return send(hit);
  https.get(PAGE_BASE + file, function (r) {
    if (r.statusCode !== 200) { r.resume(); return hit ? send(hit) : fail(); }
    var parts = [];
    r.on('data', function (c) { parts.push(c); });
    r.on('end', function () {
      pageCache[file] = { at: Date.now(), body: Buffer.concat(parts) };
      send(pageCache[file]);
    });
  }).on('error', function () { return hit ? send(hit) : fail(); });

  function send(entry) {
    var ext = file.split('.').pop();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(entry.body);
  }
  function fail() {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não consegui baixar o controle. A TV está com internet?');
  }
}

function readBody(req, cb) {
  var data = '';
  req.on('data', function (c) { data += c; if (data.length > 10000) req.destroy(); });
  req.on('end', function () { try { cb(JSON.parse(data || '{}')); } catch (e) { cb({}); } });
}

function json(res, code, obj) {
  // CORS liberado: o app do Seraflix (em 127.0.0.1:8081) lê o /api/ip para montar o QR code.
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true' });
  res.end(JSON.stringify(obj));
}

var FILES = ['index.html', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.webmanifest'];

// ---------- Addons "Seraflix Tube": XVideos e Pornhub servidos daqui da TV ----------
// Os links de vídeo desses sites saem assinados para o IP de quem pediu a página. Pedindo daqui,
// a TV que toca é a mesma que pediu: funciona sem servidor na internet e sem o PC.
// Rotas no protocolo de addons do Stremio: /xv/manifest.json, /ph/manifest.json, catalog, meta, stream.
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Certificados raiz que o Node 4.4.3 do TizenBrew (2016) não conhece: ISRG Root X1 e X2 (Let's
// Encrypt). A CDN de vídeo do Pornhub (phncdn.com) usa essa cadeia e o Node recusava a conexão.
// Só entram quando a verificação normal falha, e só para aquele site (nunca desligam a verificação).
var EXTRA_CA = [
  "-----BEGIN CERTIFICATE-----\n" +
  "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\n" +
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
var extraCaHosts = {};

function isCertError(e) {
  return !!e && /UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|CERT_UNTRUSTED|issuer certificate|leaf signature/i.test(String(e.code || '') + ' ' + String(e.message || ''));
}

// Opções do https.get com as raízes extras quando aquele site já precisou delas.
function withCa(opts) {
  if (opts.protocol !== 'http:' && extraCaHosts[opts.hostname]) opts.ca = EXTRA_CA;
  return opts;
}

function fetchText(url, cb, hops) {
  var done = false;
  function end(err, text) { if (!done) { done = true; cb(err, text); } }
  // Node 4 (o da TV) não aceita https.get(url, opções, cb): as opções vão num objeto só.
  var opts = urlLib.parse(url);
  opts.headers = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8', Cookie: 'platform=pc; age_verified=1; accessAgeDisclaimerPH=1' };
  var req;
  try {
    req = https.get(withCa(opts), onResponse);
  } catch (e) {
    return end(e);
  }
  function onResponse(r) {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && (hops || 0) < 4) {
      r.resume();
      var next = r.headers.location.indexOf('http') === 0 ? r.headers.location : url.split('/').slice(0, 3).join('/') + r.headers.location;
      return fetchText(next, end, (hops || 0) + 1);
    }
    if (r.statusCode !== 200) { r.resume(); return end(new Error('HTTP ' + r.statusCode)); }
    var chunks = [];
    r.on('data', function (c) { chunks.push(c); });
    r.on('end', function () { end(null, Buffer.concat(chunks).toString('utf8')); });
  }
  req.on('error', function (e) {
    if (isCertError(e) && !extraCaHosts[opts.hostname]) {
      extraCaHosts[opts.hostname] = true;
      done = true; // o novo pedido responde pelo cb
      return fetchText(url, cb, hops);
    }
    end(e);
  });
  req.setTimeout(15000, function () { req.abort(); end(new Error('tempo esgotado')); });
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
  var i = html.indexOf('"' + key + '":[');
  if (i < 0) return [];
  var start = html.indexOf('[', i);
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
        try { return JSON.parse(html.slice(start, j + 1)); } catch (e) { return []; }
      }
    }
  }
  return [];
}

function attr(chunk, name) {
  var m = chunk.match(new RegExp(name + '="([^"]*)"'));
  return m ? unhtml(m[1]) : '';
}

function ogTag(html, prop) {
  var m = html.match(new RegExp('<meta property="og:' + prop + '" content="([^"]*)"'));
  return m ? unhtml(m[1]) : '';
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
        // Recomendadas primeiro: são as primeiras fileiras da aba NSFW.
        { type: 'movie', id: 'xv-cp', name: 'Creampie hétero', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'xv-cpgay', name: 'Creampie gay', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'xv-new', name: 'Novidades', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'xv-top', name: 'Mais vistos em HD', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'xv-4k', name: '4K mais bem avaliados', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'xv-search', name: 'Busca', extra: [{ name: 'search', isRequired: true }, { name: 'skip' }] }
      ]
    },
    PAGE: 27,
    listUrl: function (cat, page, extra) {
      var p = page ? '&p=' + page : '';
      if (cat === 'xv-search') return 'https://www.xvideos.com/?k=' + encodeURIComponent(extra.search || '') + p;
      if (cat === 'xv-cp') return 'https://www.xvideos.com/?k=creampie' + p;
      if (cat === 'xv-cpgay') return 'https://www.xvideos.com/?k=creampie&typef=gay' + p;
      if (cat === 'xv-top') return 'https://www.xvideos.com/?k=hd&sort=views' + p;
      if (cat === 'xv-4k') return 'https://www.xvideos.com/?k=4k&sort=rating' + p;
      // Novidades: a primeira página é a inicial; as seguintes, /new/1, /new/2...
      return page ? 'https://www.xvideos.com/new/' + page : 'https://www.xvideos.com/';
    },
    parseList: function (html) {
      var out = [];
      html.split('id="video_').slice(1).forEach(function (chunk) {
        var href = attr(chunk, 'href');
        if (href.indexOf('/video') !== 0) return;
        var title = (chunk.match(/<p class="title"><a href="[^"]*" title="([^"]*)"/) || [])[1];
        var thumb = attr(chunk, 'data-src');
        if (!title) return;
        out.push({ id: 'xv:' + href, type: 'movie', name: unhtml(title), poster: thumb, posterShape: 'landscape' });
      });
      return out;
    },
    pageUrl: function (id) { return 'https://www.xvideos.com' + id.slice(3); },
    parseMeta: function (id, html) {
      return { id: id, type: 'movie', name: ogTag(html, 'title') || 'XVideos', poster: ogTag(html, 'image'), background: ogTag(html, 'image'), posterShape: 'landscape', description: ogTag(html, 'description') };
    },
    parseStreams: function (html) {
      var out = [];
      var hls = (html.match(/setVideoHLS\('([^']+)'\)/) || [])[1];
      var high = (html.match(/setVideoUrlHigh\('([^']+)'\)/) || [])[1];
      if (hls) out.push({ name: 'XVideos\nHLS até 1080p', title: 'Melhor qualidade disponível (1080p HD)', url: proxied(hls, 'hls.m3u8') });
      if (high) out.push({ name: 'XVideos\n360p', title: 'MP4 360p (mais leve)', url: proxied(high, 'video.mp4') });
      if (hls) out.push({ name: 'XVideos\nDireto', title: 'Link do site sem passar pela TV (se os outros falharem)', url: hls });
      return out;
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
        { type: 'movie', id: 'ph-cp', name: 'Creampie hétero', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'ph-cpgay', name: 'Creampie gay', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'ph-hot', name: 'Em alta', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'ph-top', name: 'Mais vistos', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'ph-search', name: 'Busca', extra: [{ name: 'search', isRequired: true }, { name: 'skip' }] }
      ]
    },
    PAGE: 32,
    listUrl: function (cat, page, extra) {
      var p = '&page=' + ((page || 0) + 1);
      if (cat === 'ph-cp') return 'https://www.pornhub.com/video/search?search=creampie' + p;
      if (cat === 'ph-cpgay') return 'https://www.pornhub.com/gay/video/search?search=creampie' + p;
      if (cat === 'ph-search') return 'https://www.pornhub.com/video/search?search=' + encodeURIComponent(extra.search || '') + p;
      return 'https://www.pornhub.com/video?o=' + (cat === 'ph-top' ? 'mv' : 'ht') + p;
    },
    parseList: function (html) {
      var out = [];
      var seen = {};
      html.split('data-video-vkey="').slice(1).forEach(function (chunk) {
        var key = chunk.slice(0, chunk.indexOf('"'));
        if (!/^[\w]+$/.test(key) || seen[key]) return;
        var title = attr(chunk, 'title');
        var img = chunk.match(/<img[^>]*\ssrc="([^"]+)"/);
        if (!title) return;
        seen[key] = true;
        out.push({ id: 'ph:' + key, type: 'movie', name: title, poster: img ? unhtml(img[1]) : '', posterShape: 'landscape' });
      });
      return out;
    },
    pageUrl: function (id) { return 'https://www.pornhub.com/view_video.php?viewkey=' + id.slice(3); },
    parseMeta: function (id, html) {
      return { id: id, type: 'movie', name: ogTag(html, 'title') || 'Pornhub', poster: ogTag(html, 'image'), background: ogTag(html, 'image'), posterShape: 'landscape', description: ogTag(html, 'description') };
    },
    parseStreams: function (html) {
      return jsonArrayAfter(html, 'mediaDefinitions')
        .filter(function (d) { return d.format === 'hls' && d.videoUrl && /^\d+$/.test(String(d.quality)); })
        .sort(function (a, b) { return Number(b.quality) - Number(a.quality); })
        .map(function (d) { return { name: 'Pornhub\n' + d.quality + 'p', title: 'HLS ' + d.quality + 'p', url: proxied(d.videoUrl, 'hls.m3u8') }; });
    }
  }
};

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
    var site = /phncdn|pornhub/i.test(opts.hostname) ? 'https://www.pornhub.com/' : 'https://www.xvideos.com/';
    opts.headers = { 'User-Agent': UA, Referer: site, Origin: site.slice(0, -1), Accept: '*/*' };
    // Playlist é reescrita inteira: pedaço dela (Range) não serve.
    if (req.headers.range && !isPlaylist(addr)) opts.headers.Range = req.headers.range;
    var lib = opts.protocol === 'http:' ? http : https;
    var up;
    try {
      up = lib.get(withCa(opts), function (r) {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops++ < 4) {
          r.resume();
          return go(urlLib.resolve(addr, r.headers.location));
        }
        var type = r.headers['content-type'] || '';
        pxNote(addr, r.statusCode, '');
        if ((r.statusCode === 200 || r.statusCode === 206) && isPlaylist(addr, type)) {
          var parts = [];
          r.on('data', function (c) { parts.push(c); });
          r.on('end', function () {
            if (done) return;
            done = true;
            var body = rewritePlaylist(Buffer.concat(parts).toString('utf8'), addr);
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
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
      if (isCertError(e) && !extraCaHosts[opts.hostname] && !done) {
        extraCaHosts[opts.hostname] = true;
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

function addonRoute(url, res) {
  var r = parseAddonUrl(url);
  if (!r) return false;
  var tube = TUBES[r.tube];
  if (r.resource === 'manifest') { json(res, 200, tube.manifest); return true; }
  if (r.resource === 'catalog') {
    var page = Math.floor((parseInt(r.extra.skip, 10) || 0) / tube.PAGE);
    fetchText(tube.listUrl(r.id, page, r.extra), safe(res, { metas: [] }, function (err, html) {
      json(res, 200, { metas: err ? [] : tube.parseList(html) });
    }));
    return true;
  }
  var empty = r.resource === 'meta' ? { meta: null } : { streams: [] };
  fetchText(tube.pageUrl(r.id), safe(res, empty, function (err, html) {
    if (err) return json(res, 200, empty);
    if (r.resource === 'meta') return json(res, 200, { meta: tube.parseMeta(r.id, html) });
    json(res, 200, { streams: tube.parseStreams(html) });
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

// Uma versão mais nova deste serviço quer as portas: sai e deixa ela assumir.
function quit(res) {
  json(res, 200, { ok: true });
  quitting = true;
  clearTimeout(tv.retry);
  setTimeout(function () {
    try { server.close(); } catch (e) {}
    try { addonServer.close(); } catch (e) {}
    if (tv.socket) tv.socket.destroy();
  }, 100);
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

var server = http.createServer(guarded(function (req, res) {
  var url = req.url.split('?')[0];
  // Pré-verificação de CORS / acesso à rede local (navegadores mais novos perguntam antes).
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600'
    });
    return res.end();
  }
  if (url === '/api/ip') return json(res, 200, { ip: lanIp() });
  if (url === '/api/version') return json(res, 200, { version: SERVICE_VERSION });
  // Uma versão mais nova deste serviço quer a porta: sai e deixa ela assumir.
  if (url === '/api/quit' && req.method === 'POST') return quit(res);
  if (url === '/api/pending') {
    lastPoll = Date.now();
    return json(res, 200, { open: takePending() });
  }
  if (url === '/api/open' && req.method === 'POST') {
    return readBody(req, function (b) {
      var type = String(b.type || '');
      var id = String(b.id || '');
      if (!/^(movie|series)$/.test(type) || !/^[\w:.-]{1,80}$/.test(id)) return json(res, 400, { error: 'pedido inválido' });
      pendingOpen = { type: type, id: id, name: String(b.name || '').slice(0, 120), play: !!b.play, at: Date.now() };
      json(res, 200, { ok: true, appOpen: Date.now() - lastPoll < 10000 });
    });
  }
  // Diagnóstico: o que a TV tem para rodar coisas mais pesadas (ex.: torrent sem o PC).
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
  if (addonRoute(url, res)) return;
  if (url === '/api/torrent-test') {
    return torrentTest(function (r) { json(res, 200, r); });
  }
  if (url === '/api/status') {
    if (tv.state !== 'on') tvConnect();
    return json(res, 200, { tv: tv.state });
  }
  if (url === '/api/key' && req.method === 'POST') {
    return readBody(req, function (b) {
      if (!/^KEY_[A-Z0-9_]+$/.test(b.key || '')) return json(res, 400, { error: 'tecla inválida' });
      tvSend({ Cmd: 'Click', DataOfCmd: b.key, Option: 'false', TypeOfRemote: 'SendRemoteKey' });
      json(res, 200, { tv: tv.state });
    });
  }
  if (url === '/api/text' && req.method === 'POST') {
    return readBody(req, function (b) {
      var text = String(b.text || '').slice(0, 500);
      if (!text) return json(res, 400, { error: 'texto vazio' });
      tvSend({ Cmd: buf(text).toString('base64'), DataOfCmd: 'base64', TypeOfRemote: 'SendInputString' });
      tvSend({ TypeOfRemote: 'SendInputEnd' });
      json(res, 200, { tv: tv.state });
    });
  }
  var file = url === '/' ? 'index.html' : url.slice(1);
  if (FILES.indexOf(file) >= 0) return servePage(file, res);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404');
}));

// Coloca o Seraflix na lista de serviços que o TizenBrew liga sozinho ao abrir. Assim o controle
// funciona só de abrir o TizenBrew (ou quando a TV pré-carrega o TizenBrew ao ligar), sem entrar
// no Seraflix. Só mexe no arquivo se ele existir e for JSON válido.
function enableAutoLaunch() {
  try {
    var config = JSON.parse(fs.readFileSync(TIZENBREW_CONFIG, 'utf8'));
    var list = Array.isArray(config.autoLaunchServiceList) ? config.autoLaunchServiceList : [];
    if (list.indexOf(MODULE_NAME) >= 0) return;
    config.autoLaunchServiceList = list.concat([MODULE_NAME]);
    fs.writeFileSync(TIZENBREW_CONFIG, JSON.stringify(config, null, 4));
  } catch (e) {}
}

// Porta ocupada: costuma ser uma versão antiga deste serviço que o TizenBrew deixou rodando (ele só
// some quando a TV reinicia). Pede para ela sair (versões novas atendem /api/quit) e tenta de novo.
// Enquanto isso os addons ficam também na porta 8091, que a versão antiga não usa: o app procura nas duas.
var listenTries = 0;
server.on('error', function (e) {
  if (e && e.code === 'EADDRINUSE' && listenTries++ < 10) {
    var q = http.request({ host: '127.0.0.1', port: PORT, path: '/api/quit', method: 'POST' }, function (r) { r.resume(); });
    q.on('error', function () {});
    q.end();
    setTimeout(function () { server.listen(PORT, '0.0.0.0'); }, 1500);
  }
});
server.listen(PORT, '0.0.0.0');
var addonServer = http.createServer(guarded(function (req, res) {
  var url = req.url.split('?')[0];
  if (url.indexOf('/px/') === 0) return proxyRoute(req, res, urlLib.parse(req.url, true).query);
  if (url === '/api/version') return json(res, 200, { version: SERVICE_VERSION });
  if (url === '/api/quit' && req.method === 'POST') return quit(res);
  if (url === '/api/pxlog') return json(res, 200, pxLog);
  if (addonRoute(url, res)) return;
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404');
}));
var addonTries = 0;
addonServer.on('error', function (e) {
  // Outra versão deste serviço está na porta: pede para ela sair e tenta de novo.
  if (e && e.code === 'EADDRINUSE' && addonTries++ < 10) {
    var q = http.request({ host: '127.0.0.1', port: ADDON_PORT, path: '/api/quit', method: 'POST' }, function (r) { r.resume(); });
    q.on('error', function () {});
    q.end();
    setTimeout(function () { addonServer.listen(ADDON_PORT, '0.0.0.0'); }, 1500);
  }
});
addonServer.listen(ADDON_PORT, '0.0.0.0');
tvConnect();
enableAutoLaunch();
