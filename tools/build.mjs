// Build: esbuild junta os módulos e o Babel reescreve para navegadores antigos (Chromium 38+),
// para rodar também nas TVs Samsung mais velhas.
import { build, context } from 'esbuild';
import { transformAsync } from '@babel/core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

// Qual commit este build representa (para o botão de atualizar comparar com o GitHub).
// Na GitHub Action vem de KAI_COMMIT/KAI_BUILD_DATE/KAI_COMMIT_MSG; localmente, do git.
function git(cmd) {
  try {
    return execSync('git ' + cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    return '';
  }
}
const buildInfo = {
  commit: process.env.KAI_COMMIT || git('rev-parse HEAD'),
  date: process.env.KAI_BUILD_DATE || git('log -1 --format=%cI'),
  message: (process.env.KAI_COMMIT_MSG || git('log -1 --format=%s')).split('\n')[0],
};

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

async function downlevel(code) {
  const out = await transformAsync(code, {
    babelrc: false,
    configFile: false,
    sourceType: 'script',
    compact: false,
    presets: [['@babel/preset-env', { targets: { chrome: '38' }, modules: false, bugfixes: true }]],
  });
  return out.code;
}

const esbuildOptions = {
  entryPoints: [path.join(src, 'js', 'main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  charset: 'utf8',
  legalComments: 'none',
  // KAI_DEVLOG=http://IP-DO-PC:8099/log liga o log remoto já no build (útil no deploy).
  // KAI_TMDB / KAI_MDBLIST: chaves de API opcionais embutidas no build (evita digitar na TV).
  define: {
    __KAI_DEVLOG__: JSON.stringify(process.env.KAI_DEVLOG || ''),
    __KAI_TMDB__: JSON.stringify(process.env.KAI_TMDB || ''),
    __KAI_MDBLIST__: JSON.stringify(process.env.KAI_MDBLIST || ''),
    __KAI_COMMIT__: JSON.stringify(buildInfo.commit),
    __KAI_BUILD_DATE__: JSON.stringify(buildInfo.date),
    __KAI_COMMIT_MSG__: JSON.stringify(buildInfo.message),
    __KAI_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'appinfo.json'), 'utf8')).version),
  },
  logLevel: 'warning',
};

async function emit(result) {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  copyDir(path.join(src, 'static'), dist);
  fs.copyFileSync(path.join(root, 'appinfo.json'), path.join(dist, 'appinfo.json'));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'appinfo.json'), 'utf8')).version;
  fs.writeFileSync(path.join(dist, 'build.json'), JSON.stringify({ version, ...buildInfo }, null, 2) + '\n');
  const fonts = path.join(root, 'node_modules', '@fontsource', 'montserrat', 'files');
  fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });
  for (const w of [400, 600, 700, 800]) {
    for (const sub of ['latin', 'latin-ext']) {
      for (const ext of ['woff2', 'woff']) {
        const f = `montserrat-${sub}-${w}-normal.${ext}`;
        fs.copyFileSync(path.join(fonts, f), path.join(dist, 'fonts', f));
      }
    }
  }
  // Nata Sans: fonte de legenda do Kai (mpv.conf: sub-font='Nata Sans', sub-bold=yes).
  const nata = path.join(root, 'node_modules', '@fontsource', 'nata-sans', 'files');
  for (const w of [500, 700]) {
    for (const sub of ['latin', 'latin-ext']) {
      for (const ext of ['woff2', 'woff']) {
        const f = `nata-sans-${sub}-${w}-normal.${ext}`;
        fs.copyFileSync(path.join(nata, f), path.join(dist, 'fonts', f));
      }
    }
  }
  // Fontes do Seraflix (as mesmas de matheusserafim.com): Bricolage Grotesque nos títulos, Geist no texto.
  for (const [name, weights, subs] of [['bricolage-grotesque', [600, 700, 800], ['latin', 'latin-ext']], ['geist-sans', [400, 500, 600, 700], ['latin']]]) {
    const dir = path.join(root, 'node_modules', '@fontsource', name, 'files');
    for (const w of weights) {
      for (const sub of subs) {
        for (const ext of ['woff2', 'woff']) {
          const f = `${name}-${sub}-${w}-normal.${ext}`;
          fs.copyFileSync(path.join(dir, f), path.join(dist, 'fonts', f));
        }
      }
    }
  }
  const code = await downlevel(result.outputFiles[0].text);
  fs.writeFileSync(path.join(dist, 'app.js'), code);
  // Guarda simples: nada de sintaxe que o Chromium 38 não entende pode sobrar.
  for (const bad of ['=>', 'async function']) {
    if (code.includes(bad)) {
      const i = code.indexOf(bad);
      console.warn(`[aviso] "${bad}" ainda aparece no bundle perto de: ${code.slice(i - 60, i + 40).replace(/\n/g, ' ')}`);
    }
  }
  console.log(`[build] dist/app.js ${(code.length / 1024).toFixed(0)} KB`);
}

if (watch) {
  const ctx = await context({
    ...esbuildOptions,
    plugins: [{ name: 'emit', setup(b) { b.onEnd((r) => { if (!r.errors.length) emit(r).catch(console.error); }); } }],
  });
  await ctx.watch();
  console.log('[build] observando src/ ...');
} else {
  await emit(await build(esbuildOptions));
}
