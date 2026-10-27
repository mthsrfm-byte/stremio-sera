#!/usr/bin/env node
// Torrent de teste privado: só o arquivo CC BY 3.0 do projeto, TCP e tracker loopback.
// Coordenador: node scripts/test-server-torrent.mjs CAMINHO_GATE CAMINHO_RESULTADO
// Isolado: node scripts/test-server-torrent.mjs --standalone SERVER_JS [NODE_OFICIAL]
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, resolve, join} from 'node:path';
import {readFile, writeFile, mkdir, rm, mkdtemp, stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, '.build/torrent-test/package.json'));
const WebTorrent = require('webtorrent');
const {Server: Tracker} = require('bittorrent-tracker');
const args = process.argv.slice(2);
const standalone = args[0] === '--standalone';
const [gate, result] = standalone ? [] : args.map(path => resolve(path));
if (standalone ? !args[1] : (!gate || !result)) {
    throw new Error('Uso: test-server-torrent.mjs GATE RESULTADO | --standalone SERVER_JS [NODE]');
}
const endpoint = 'http://127.0.0.1:11470';
const announce = 'http://127.0.0.1:18766/announce';
const fixturePath = join(root, 'tests/fixtures/hevc-4k-tracks.mkv');
const fixture = await readFile(fixturePath);
const started = Date.now();
const deadline = started + 90_000;
let serverProcess;
let serverState;
let tracker;
let seeder;
let torrent;
let failed = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const remaining = cap => Math.max(1, Math.min(cap, deadline - Date.now()));
const within = (promise, milliseconds, message) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), remaining(milliseconds));
    })]).finally(() => clearTimeout(timer));
};
const checkDeadline = () => {
    if (Date.now() >= deadline) throw new Error('Teste de torrent ultrapassou 90 segundos');
};
const request = (url, init = {}, timeout = 15_000) => fetch(url, {...init, signal: AbortSignal.timeout(remaining(timeout))});

try {
    if (standalone) {
        // Recusa processo alheio, inclusive se também responder como Stremio.
        const portProbe = net.createServer();
        await new Promise((resolve, reject) => {
            portProbe.once('error', error => reject(new Error('Porta 11470 ocupada antes do teste isolado: ' + error.message)));
            portProbe.listen({port:11470, host:'127.0.0.1', exclusive:true}, resolve);
        });
        await new Promise(resolve => portProbe.close(resolve));
        await mkdir(join(root, 'build'), {recursive:true});
        serverState = await mkdtemp(join(tmpdir(), 'seraflix-torrent-server-'));
        const serverJS = resolve(args[1]);
        const data = await readFile(serverJS);
        assert.equal(createHash('sha256').update(data).digest('hex'),
            '405eb494d6708406a30e716c3cfb5abae7a5e9c7a8b79446d64c3f821385930f', 'SHA-256 servidor oficial');
        const log = createWriteStream(join(root, 'build/torrent-server.log'));
        serverProcess = spawn(args[2] || process.execPath,
            [join(root, 'Resources/server-bootstrap.cjs'), serverJS], {
                env: {...process.env, APP_PATH:serverState, SETTINGS_PATH:serverState,
                    NO_HTTPS_SERVER:'1', CASTING_DISABLED:'1', NO_CORS:'1'},
                stdio: ['ignore', 'pipe', 'pipe']
            });
        serverProcess.stdout.pipe(log);
        serverProcess.stderr.pipe(log);
        serverProcess.on('error', error => console.error('Servidor não iniciou:', error.message));
    } else {
        await mkdir(dirname(gate), {recursive:true});
        await rm(gate, {force:true});
        await rm(result, {force:true});
    }

    // Aguarda o processo criado pelo app: nunca inicia/reinicia servidor no coordenador.
    const readyDeadline = Date.now() + 45_000;
    while (true) {
        if (serverProcess && serverProcess.exitCode !== null) {
            throw new Error(`Servidor saiu antes de ficar pronto: ${serverProcess.exitCode}; veja build/torrent-server.log`);
        }
        try {
            const response = await request(endpoint + '/settings', {}, 1500);
            const settings = await response.json();
            assert.equal(response.status, 200);
            assert.equal(typeof settings.values.serverVersion, 'string');
            console.log('Servidor pronto:', settings.values.serverVersion);
            break;
        } catch (error) {
            if (Date.now() >= readyDeadline) throw new Error('Servidor não ficou pronto em 45s: ' + error.message);
            await sleep(250);
        }
    }

    tracker = new Tracker({http:true, udp:false, ws:false, stats:false});
    tracker.on('warning', error => console.error('Tracker:', error.message));
    tracker.on('error', error => console.error('Tracker:', error.message));
    await within(new Promise((resolve, reject) => {
        tracker.once('error', reject);
        tracker.listen(18766, '127.0.0.1', resolve);
    }), 5000, 'Tracker local não abriu a porta 18766');
    seeder = new WebTorrent({dht:false, lsd:false, utp:false, webSeeds:false,
        tracker:{announce:[announce]}, torrentPort:0});
    seeder.on('warning', error => console.error('Seeder:', error.message));
    seeder.on('error', error => console.error('Seeder:', error.message));
    torrent = await within(new Promise((resolve, reject) => {
        seeder.once('error', reject);
        seeder.seed(fixturePath, {announce:[announce], private:true}, resolve);
    }), 15_000, 'Seeder não preparou a mídia local');
    assert.equal(torrent.private, true, 'Torrent deve ser privado (sem DHT)');
    assert.deepEqual(torrent.announce, [announce], 'Único tracker permitido é o loopback');
    assert.equal(torrent.files.length, 1);
    assert.equal(torrent.files[0].length, fixture.length);
    console.log('Seeder privado pronto:', torrent.infoHash, fixture.length, 'bytes');
    // O anúncio do seeder precisa entrar no tracker antes do anúncio do servidor.
    await within(new Promise((resolve, reject) => {
        const swarm = tracker.torrents[torrent.infoHash];
        if (swarm) return resolve();
        tracker.on('start', (_address, params) => { if (params.info_hash === torrent.infoHash) resolve(); });
        torrent.once('error', reject);
    }), 10_000, 'Seeder não anunciou no tracker local');

    const body = {peerSearch:{sources:['tracker:' + announce], min:1, max:5}};
    const created = await request(`${endpoint}/${torrent.infoHash}/create`, {
        method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)
    }, 30_000);
    assert.equal(created.status, 200, 'POST /hash/create deve responder 200');
    const metadata = await created.json();
    assert.ok(metadata.files?.length >= 1, 'Engine deve obter metadados via peer local');
    const url = `${endpoint}/${torrent.infoHash}/0`;
    const response = await request(url, {headers:{Range:'bytes=0-65535'}}, 20_000);
    assert.equal(response.status, 206, 'Streaming deve respeitar Range');
    const received = Buffer.from(await response.arrayBuffer());
    assert.equal(received.length, 65536, 'Primeiro intervalo deve ter 64KiB');
    assert.deepEqual(received, fixture.subarray(0, 65536), 'Bytes devem coincidir com a fixture CC0');
    const evidence = {ok:true, source:'torrent-local-privado', infoHash:torrent.infoHash,
        bytesCompared:received.length, sha256:createHash('sha256').update(received).digest('hex'),
        fixtureBytes:fixture.length, tracker:announce, url, elapsedMs:Date.now()-started};
    await mkdir(join(root, 'build'), {recursive:true});
    await writeFile(join(root, 'build/torrent-range.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log('PASS torrent oficial: metadados e 64KiB recebidos e comparados');

    if (!standalone) {
        await writeFile(gate + '.tmp', url + '\n');
        const {rename} = await import('node:fs/promises');
        await rename(gate + '.tmp', gate);
        console.log('URL liberada para o player nativo:', gate);
        while (true) {
            checkDeadline();
            try {
                await stat(result);
                const player = JSON.parse(await readFile(result, 'utf8'));
                assert.equal(player.ok, true, 'Smoke nativo de torrent deve informar ok=true');
                console.log('PASS player nativo reproduziu torrent:', result);
                break;
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                await sleep(200);
            }
        }
    }
} catch (error) {
    failed = true;
    console.error('FAIL torrent controlado:', error.stack || error.message);
} finally {
    if (seeder) await new Promise(resolve => seeder.destroy(resolve));
    if (tracker) await new Promise(resolve => tracker.close(resolve));
    if (serverProcess && serverProcess.exitCode === null) {
        const exited = once(serverProcess, 'exit');
        serverProcess.kill('SIGTERM');
        const force = setTimeout(() => serverProcess.kill('SIGKILL'), 1500);
        await exited;
        clearTimeout(force);
    }
    if (serverState) await rm(serverState, {recursive:true, force:true});
}
process.exitCode = failed ? 1 : 0;
