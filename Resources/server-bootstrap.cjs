'use strict';
// Adaptador próprio: não modifica nem redistribui o bundle oficial do servidor.
const net = require('node:net');
const path = require('node:path');
const childProcess = require('node:child_process');
const serverPath = process.argv[2];
if (!serverPath || !path.isAbsolute(serverPath)) throw new Error('Caminho absoluto do servidor ausente');

const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
    const first = args[0];
    const port = typeof first === 'object' && first !== null ? Number(first.port) : Number(first);
    if (port >= 11470 && port <= 11474) {
        // O servidor oficial tenta portas alternativas. O contrato do app exige 11470.
        if (port !== 11470) {
            console.error('[Seraflix] Porta 11470 ocupada; não iniciar em porta alternativa.');
            process.exitCode = 78;
            process.kill(process.pid, 'SIGTERM');
            return this;
        }
        const callback = args.find(arg => typeof arg === 'function');
        return originalListen.call(this, {port: 11470, host: '127.0.0.1', exclusive: true}, callback);
    }
    return originalListen.apply(this, args);
};

// FFmpeg/ffprobe pertencem ao app e não devem sobreviver ao fechamento da janela.
const children = new Set();
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (...args) {
    const child = originalSpawn.apply(this, args);
    children.add(child);
    child.once('exit', () => children.delete(child));
    return child;
};
let stopping = false;
function stop(signal) {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
        try { child.kill('SIGTERM'); } catch (_) {}
    }
    setTimeout(() => {
        for (const child of children) {
            try { child.kill('SIGKILL'); } catch (_) {}
        }
        process.exit(process.exitCode || (signal === 'SIGTERM' ? 0 : 1));
    }, 250).unref();
    // Mantém um timer referenciado para permitir limpeza antes de sair.
    setTimeout(() => process.exit(process.exitCode || 0), 300);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('exit', () => {
    for (const child of children) {
        try { child.kill('SIGKILL'); } catch (_) {}
    }
});
process.env.NO_HTTPS_SERVER = '1';
process.env.CASTING_DISABLED = '1';
process.env.NO_CORS = '1';
require(serverPath);
