// Verifica o snapshot gerado sem confiar em caminhos fornecidos pelo manifesto.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(process.argv[2] || 'Resources/fallback');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.bridgeVersion !== 1 || !/^[a-f0-9]{40}$/.test(manifest.commit) || !manifest.files || !manifest.files['index.html'] || !manifest.files['app.js']) throw Error('Manifesto inválido');
for (const [name, expected] of Object.entries(manifest.files)) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(x => !x || x === '.' || x === '..') || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Caminho/hash inválido: ' + name);
  const file = path.join(root, name);
  if (!fs.lstatSync(file).isFile()) throw Error('Arquivo inválido: ' + name);
  const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== expected) throw Error('SHA-256 incorreto: ' + name);
}
if (fs.existsSync(path.join(root, 'gate.js'))) throw Error('Mac não pode embutir tranca web');
console.log(`UI validada: ${manifest.commit} (${Object.keys(manifest.files).length} arquivos)`);
