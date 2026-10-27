import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {once} from 'node:events';

const bootstrap = fileURLToPath(new URL('../Resources/server-bootstrap.cjs', import.meta.url));
const fixture = `
const net = require('node:net');
const {spawn} = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
const server = net.createServer(socket => socket.end('ok'));
server.on('error', () => server.listen(11471));
server.listen(11470, () => {
    console.log(JSON.stringify({address:server.address(), child:child.pid,
        noHttps:process.env.NO_HTTPS_SERVER, noCasting:process.env.CASTING_DISABLED}));
});
`;

function launch(path) {
    const child = spawn(process.execPath, [bootstrap, path], {stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.diagnostics = () => stderr;
    return child;
}

async function lineFrom(child) {
    return new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error('Sem resposta: ' + child.diagnostics())), 5000);
        child.stdout.on('data', chunk => {
            output += chunk;
            if (output.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(output.split('\n')[0])); }
        });
        child.once('exit', code => { clearTimeout(timeout); reject(new Error('Saída inesperada: ' + code + child.diagnostics())); });
    });
}

async function stop(child) {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timer);
}

test('bootstrap fixa loopback, recusa porta alternativa e encerra subprocessos', {timeout: 15000}, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seraflix-server-test-'));
    const path = join(directory, 'fixture.cjs');
    await writeFile(path, fixture);
    let child;
    let occupied;
    try {
        child = launch(path);
        const message = await lineFrom(child);
        assert.equal(message.address.address, '127.0.0.1');
        assert.equal(message.address.port, 11470);
        assert.equal(message.noHttps, '1');
        assert.equal(message.noCasting, '1');
        await stop(child);
        assert.equal(child.exitCode, 0);
        assert.throws(() => process.kill(message.child, 0), {code: 'ESRCH'});

        occupied = net.createServer();
        occupied.listen({port:11470, host:'127.0.0.1', exclusive:true});
        await once(occupied, 'listening');
        child = launch(path);
        const [code] = await once(child, 'exit');
        assert.equal(code, 78, child.diagnostics());
        assert.match(child.diagnostics(), /Porta 11470 ocupada/);
    } finally {
        if (child) await stop(child);
        if (occupied?.listening) await new Promise(resolve => occupied.close(resolve));
        await rm(directory, {recursive:true, force:true});
    }
});
