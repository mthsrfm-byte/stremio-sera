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

var PORT = 8090;
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
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

var FILES = ['index.html', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.webmanifest'];

var server = http.createServer(function (req, res) {
  var url = req.url.split('?')[0];
  if (url === '/api/ip') return json(res, 200, { ip: lanIp() });
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
});

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

server.on('error', function () {}); // porta ocupada (serviço já rodando): ignora
server.listen(PORT, '0.0.0.0');
tvConnect();
enableAutoLaunch();
