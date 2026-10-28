// Build: esbuild junta os módulos e o Babel reescreve para navegadores antigos (Chromium 38+),
// para rodar também nas TVs Samsung mais velhas.
import { build, context } from 'esbuild';
import { transformAsync, parseSync } from '@babel/core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const watch = process.argv.includes('--watch');
// --web: versão para navegador (site/app/, com tranca de senha) em vez do pacote da TV (dist/).
const web = process.argv.includes('--web');
const mac = process.argv.includes('--mac');
if (web && mac) throw new Error('Escolha só uma plataforma.');
// Pasta de saída: dist/ é o que a TV roda; site/app/ é publicado no GitHub Pages.
const dist = mac ? path.join(root, 'site', 'mac') : web ? path.join(root, 'site', 'app') : path.join(root, 'dist');
// A senha da versão web só vira um hash no build. Sem ela o site ficaria aberto, então não builda.
if (web && !process.env.KAI_WEB_PASSWORD) {
  throw new Error('Build web sem senha: defina KAI_WEB_PASSWORD (no GitHub é o segredo WEB_PASSWORD).');
}

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

// Remove apenas os ramos novos do Mac ANTES do esbuild: até os bytes de TV/web
// ficam preservados. Não é minificação geral, que alteraria o bundle legado.
function withoutMacBranches(source) {
  const ast = parseSync(source, { sourceType: 'module', babelrc: false, configFile: false });
  const edits = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if ((node.type === 'IfStatement' || node.type === 'ConditionalExpression') &&
        node.test.type === 'Identifier' && node.test.name === '__KAI_MAC__') {
      const keep = node.alternate;
      edits.push([node.start, node.end, keep ? source.slice(keep.start, keep.end) : '']);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  return edits.sort((a, b) => b[0] - a[0]).reduce((text, [a, b, replacement]) => text.slice(0, a) + replacement + text.slice(b), source);
}
const legacyPlatform = {
  name: 'preservar-build-legado',
  setup(builder) {
    if (mac) return;
    builder.onLoad({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith(path.join(src, 'js') + path.sep)) return;
      const source = fs.readFileSync(args.path, 'utf8');
      if (!source.includes('__KAI_MAC__')) return;
      return { contents: withoutMacBranches(source), loader: 'js' };
    });
  },
};

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
    // KAI_CALENDAR: link iCal da agenda embutido (segredo CALENDAR_ICAL_URL); só no build da TV.
    __KAI_CALENDAR__: JSON.stringify(web || mac ? '' : process.env.KAI_CALENDAR || ''),
    __KAI_COMMIT__: JSON.stringify(buildInfo.commit),
    __KAI_BUILD_DATE__: JSON.stringify(buildInfo.date),
    __KAI_COMMIT_MSG__: JSON.stringify(buildInfo.message),
    __KAI_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'appinfo.json'), 'utf8')).version),
    __KAI_WEB__: JSON.stringify(web || mac),
    __KAI_MAC__: JSON.stringify(mac),
  },
  plugins: [legacyPlatform],
  logLevel: 'warning',
};

async function emit(result) {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  copyDir(path.join(src, 'static'), dist);
  if (web) {
    // Página de entrada da web (com a tranca), no lugar da de TV. A senha vai como hash salgado.
    copyDir(path.join(src, 'web'), dist);
    const salt = 'seraflix-web:';
    const hash = createHash('sha256').update(salt + process.env.KAI_WEB_PASSWORD).digest('hex');
    fs.writeFileSync(path.join(dist, 'gate-config.js'), 'window.SERA_GATE = ' + JSON.stringify({ salt, hash }) + ';\n');
  }
  if (mac) {
    // Reutiliza palco e estilo desktop, sem carregar a tranca da versão web.
    for (const file of ['stage.js', 'web.css']) fs.copyFileSync(path.join(src, 'web', file), path.join(dist, file));
    copyDir(path.join(src, 'mac'), dist);
    // O HTML da TV também é a base do Mac, inclusive futuras mudanças na marca/boot.
    const html = fs.readFileSync(path.join(src, 'static', 'index.html'), 'utf8')
      .replace('width=1920, height=1080', 'width=device-width, initial-scale=1')
      .replace('<link rel="stylesheet" href="app.css">', '<link rel="stylesheet" href="app.css">\n  <link rel="stylesheet" href="web.css">\n  <link rel="stylesheet" href="mac.css">')
      .replace('<script src="app.js"></script>', '<script src="stage.js"></script>\n  <script src="app.js"></script>');
    fs.writeFileSync(path.join(dist, 'index.html'), html);
  }
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
  for (const [name, weights, subs] of [['bricolage-grotesque', [600, 700, 800], ['latin', 'latin-ext']], ['geist-sans', [400, 500, 600, 700], ['latin']], ['figtree', [600, 700], ['latin', 'latin-ext']]]) {
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
  // hls.js (já em ES5): o player baixa só quando abre um vídeo HLS (.m3u8), fora do app.js.
  fs.copyFileSync(path.join(root, 'node_modules', 'hls.js', 'dist', 'hls.min.js'), path.join(dist, 'hls.js'));
  const code = await downlevel(result.outputFiles[0].text);
  fs.writeFileSync(path.join(dist, 'app.js'), code);
  // Guarda simples: nada de sintaxe que o Chromium 38 não entende pode sobrar.
  for (const bad of ['=>', 'async function']) {
    if (code.includes(bad)) {
      const i = code.indexOf(bad);
      console.warn(`[aviso] "${bad}" ainda aparece no bundle perto de: ${code.slice(i - 60, i + 40).replace(/\n/g, ' ')}`);
    }
  }
  if (mac) {
    const files = {};
    function hashDir(dir, prefix = '') {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) hashDir(path.join(dir, entry.name), name + '/');
        else files[name] = createHash('sha256').update(fs.readFileSync(path.join(dir, entry.name))).digest('hex');
      }
    }
    hashDir(dist);
    fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify({ version: 1, bridgeVersion: 1, commit: buildInfo.commit, files }, null, 2) + '\n');
  }
  console.log(`[build] dist/app.js ${(code.length / 1024).toFixed(0)} KB`);
}

if (watch) {
  const ctx = await context({
    ...esbuildOptions,
    plugins: [legacyPlatform, { name: 'emit', setup(b) { b.onEnd((r) => { if (!r.errors.length) emit(r).catch(console.error); }); } }],
  });
  await ctx.watch();
  console.log('[build] observando src/ ...');
} else {
  await emit(await build(esbuildOptions));
}
