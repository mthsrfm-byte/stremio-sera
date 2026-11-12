// Ajustes: a lista principal mostra o mais usado; Legendas, Conta e Sobre abrem subtelas.
// Conta, servidor do PC, Hero Banner, tema, addons e depuração.
import { h, clear } from '../lib/dom.js';
import * as nav from '../lib/nav.js';
import * as store from '../lib/store.js';
import { log } from '../lib/log.js';
import { deviceInfo } from '../lib/tv.js';
import { ico } from '../lib/icons.js';
import { IS_WEB, IS_FIRETV, HAS_TV_SERVICE, android } from '../lib/platform.js';
import * as playlog from '../lib/playlog.js';
import * as substyle from '../lib/substyle.js';
import * as update from '../api/update.js';
import * as stremio from '../api/stremio.js';
import * as server from '../api/server.js';
import * as addons from '../api/addons.js';
import * as hero from '../api/hero.js';
import * as extras from '../api/extras.js';
import * as calendar from '../api/calendar.js';
import * as reco from '../api/recommend.js';
import * as intro from '../lib/intro.js';
import * as screensaver from '../lib/screensaver.js';
import * as debrid from '../api/debrid.js';
import { getJSON, recentErrors } from '../lib/http.js';
import { topbar, toast, menu, confirmDialog, refreshProfileChips, refreshTabs, timeHM, openModal } from '../ui.js';
import * as router from '../router.js';
import { openLogin } from './login.js';
import { avatar, avatarStyle, switchProfile, createProfile, canAddProfile, chooseColor } from './profiles.js';
import { t } from '../lib/i18n.js';
import * as pinLock from './pin.js';
import { themeOf, applyTheme } from '../lib/theme.js';

const SUB_LANGS = [
  { label: 'Português (BR) e Português', value: ['pob', 'por', 'pt', 'pt-br'] },
  { label: 'Inglês', value: ['eng', 'en'] },
  { label: 'Espanhol', value: ['spa', 'es'] },
  { label: 'Nenhum (não ligar sozinho)', value: [] },
];
const AUDIO_LANGS = [
  { label: 'Original do arquivo', value: [] },
  { label: 'Português (dublado) quando houver', value: ['por', 'pt', 'pob'] },
  { label: 'Inglês quando houver', value: ['eng', 'en'] },
  { label: 'Japonês quando houver', value: ['jpn', 'ja'] },
];

// Addons úteis que o app aproveita (Anime Kitsu: catálogos de anime e IDs do calendário/AniSkip).
const RECOMMENDED = [
  { id: 'community.anime.kitsu', name: 'Anime Kitsu', url: 'https://anime-kitsu.strem.fun/manifest.json', desc: 'Catálogos e detalhes de animes (usado pelo calendário)' },
  { id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3', url: 'https://opensubtitles-v3.strem.io/manifest.json', desc: 'Legendas em português para quase tudo' },
];

// Títulos das subtelas (a chave é o id que openSection recebe).
const SECTION_TITLE = { legendas: 'Legendas', conta: 'Conta', sobre: 'Sobre' };

function subLangLabel(s) {
  return (SUB_LANGS.find((x) => JSON.stringify(x.value) === JSON.stringify(s.subtitleLangs)) || { label: (s.subtitleLangs || []).join(', ') }).label;
}

function audioLangLabel(s) {
  return (AUDIO_LANGS.find((x) => JSON.stringify(x.value) === JSON.stringify(s.audioLangs)) || AUDIO_LANGS[0]).label;
}

// Efeitos reduzidos: sem valor salvo, vale o que o aparelho já está usando.
function lowfxOn(s) {
  return s.lowfx === undefined ? document.body.classList.contains('lowfx') : !!s.lowfx;
}

// Rejeita com { timeout: true } se fn() não responder em ms (a conexão segue; só deixa de esperar).
function withLimit(fn, ms) {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail({ timeout: true }), ms);
    Promise.resolve()
      .then(fn)
      .then(
        (v) => {
          clearTimeout(timer);
          ok(v);
        },
        (e) => {
          clearTimeout(timer);
          fail(e);
        }
      );
  });
}

export function SettingsView() {
  const el = h('div.view');
  const scroller = h('div.scroll-y', { 'data-scroll-y': '' });
  const bar = topbar('settings', router.goTab);
  const body = h('div.settings');
  scroller.appendChild(bar);
  scroller.appendChild(body);
  el.appendChild(scroller);

  // Subtela aberta: '' é a lista principal; senão 'legendas', 'conta' ou 'sobre'.
  let section = '';
  // Onde o foco cai no próximo desenho: id de uma entrada, 'first' ou null (fica no mesmo item).
  let focusTo = null;
  // Texto de andamento da linha "Procurar na rede" (muda sem redesenhar a tela a cada sonda).
  let scanText = null;

  let device = '';
  deviceInfo()
    .then((d) => {
      device = [d.modelName, d.firmwareVersion].filter(Boolean).join(' · ');
    })
    .catch(() => {});

  function row(label, sub, value, onSelect, extra) {
    return h('div.set-row', { focusable: true, onSelect: onSelect }, [
      h('div.label', null, [label, sub ? h('small', { text: sub }) : null]),
      extra || h('div.value', { text: value || '' }),
    ]);
  }

  // Entrada que abre uma subtela; o id vira data-entry para o foco voltar a ela no Voltar.
  function entry(id, label, sub, value) {
    const r = row(label, sub, value, () => openSection(id));
    r.setAttribute('data-entry', id);
    return r;
  }

  // Linha com campo de texto (o OK do controle vai para o campo). title: texto ou lista de nós.
  function inputRow(title, sub, input, onSelect) {
    const label = [].concat(title, sub ? h('small', { text: sub }) : null);
    return h('div.set-row', { focusable: true, onSelect: onSelect || (() => nav.select(input)) }, [h('div.label', null, label), input]);
  }

  // ✓/✗ em SVG (a fonte da TV não tem esses caracteres): um ícone antes do texto.
  function mark(ok) {
    return h('span', { html: ico(ok ? 'check' : 'x', 'tiny') });
  }

  // Diagnóstico de rede: testa cada servidor que o app usa e mostra os últimos erros.
  // Tudo ao mesmo tempo (5 s no máximo por teste); cada linha muda ao terminar. Fechar o modal
  // faz as respostas que chegarem depois serem ignoradas.
  function showNetworkCheck() {
    const LIMIT = 5000;
    const list = h('div.diag-list');
    let alive = true;
    const modal = openModal({
      title: t('Teste de conexão'),
      boxCls: 'modal-box center diag-box',
      content: [
        h('p.modal-text', { text: t(IS_WEB ? 'Relógio deste aparelho: {now}' : 'Relógio da TV: {now}', { now: new Date().toLocaleString('pt-BR') }) }),
        list,
        h('div.modal-actions', null, [h('div.btn.primary', { focusable: true, 'data-autofocus': '', text: t('Fechar'), onSelect: () => modal.close() })]),
      ],
      onClose: () => (alive = false),
    });
    function line(name) {
      const res = h('span.diag-res', { text: t('testando...') });
      list.appendChild(h('div.diag-line', null, [h('span.diag-name', { text: name }), res]));
      return res;
    }
    function test(name, run) {
      const res = line(name);
      const t0 = Date.now();
      return withLimit(run, LIMIT).then(
        () => {
          if (!alive) return;
          res.textContent = (Date.now() - t0) + ' ms';
          res.insertBefore(mark(true), res.firstChild);
          res.className = 'diag-res ok';
        },
        (e) => {
          if (!alive) return;
          res.textContent = (e.timeout ? t('tempo esgotado') : e.status ? 'HTTP ' + e.status : t('falha de rede')) + ' (' + (Date.now() - t0) + ' ms)';
          res.insertBefore(mark(false), res.firstChild);
          res.className = 'diag-res bad';
        }
      );
    }
    const image = (src) =>
      new Promise((ok, fail) => {
        const im = new Image();
        im.onload = ok;
        im.onerror = () => fail({ status: 0 });
        im.src = src + '?t=' + Date.now();
      });
    const tests = [
      [t('TMDB (fileiras e busca de títulos)'), () => extras.tmdbPing()],
      [t('Imagens do TMDB (pôsteres)'), () => image('https://image.tmdb.org/t/p/w92/rK1KljqmbvO9HQa1PBFLILWah72.png')],
      [t('Cinemeta (detalhes dos títulos)'), () => getJSON('https://v3-cinemeta.strem.io/manifest.json', { timeout: LIMIT, quiet: true })],
    ];
    if (debrid.available()) tests.push([t('Real-Debrid (torrents sem o PC)'), () => debrid.ping()]);
    addons.list().forEach((a) => {
      if (!/^https?:/.test(a.transportUrl || '') || /cinemeta/.test(a.transportUrl)) return;
      tests.push([t('Addon: {name}', { name: a.manifest.name || a.manifest.id }), () => getJSON(a.transportUrl, { timeout: LIMIT, quiet: true })]);
    });
    Promise.all(tests.map((x) => test(x[0], x[1]))).then(() => {
      if (!alive) return;
      const errs = recentErrors();
      list.appendChild(h('div.diag-head', { text: errs.length ? t('Últimos erros do app') : t('Nenhum erro de rede registrado desde que o app abriu.') }));
      errs.slice(0, 8).forEach((e) => {
        const ago = Math.round((Date.now() - e.at) / 60000);
        list.appendChild(h('div.diag-err', { text: e.msg + ' · ' + e.ms + ' ms · ' + t('há {n} min', { n: ago }) + ' · ' + e.url.slice(0, 70) }));
      });
      // Pornhub/XVideos: o que os sites responderam para o serviço da TV (lista vazia, bloqueio...).
      if (!HAS_TV_SERVICE) return;
      getJSON('http://127.0.0.1:8092/api/tubelog', { timeout: 3000, quiet: true })
        .then((log) => {
          if (!alive) return;
          const items = (Array.isArray(log) ? log : []).slice(-8).reverse();
          if (!items.length) return;
          list.appendChild(h('div.diag-head', { text: t('Pornhub e XVideos (pedidos do serviço da TV)') }));
          items.forEach((x) => {
            const ago = Math.round((Date.now() - x.at) / 60000);
            list.appendChild(h('div.diag-err', { cls: /^ok/.test(x.result) ? 'ok' : '', text: (x.tube === 'ph' ? 'Pornhub' : 'XVideos') + ' · ' + x.what + ' · ' + x.result + ' · ' + t('há {n} min', { n: ago }) }));
          });
        })
        .catch(() => {
          if (alive) list.appendChild(h('div.diag-err', { text: t('O serviço da TV (Pornhub/XVideos) não respondeu.') }));
        });
    });
  }

  let updateStatus = '';

  function checkForUpdate() {
    toast(t('Procurando atualização...'));
    update
      .check()
      .then((info) => {
        const when = update.formatDate(info.date);
        if (!info.isNew) {
          updateStatus = t('Tudo em dia. Última publicada em {date}', { date: when });
          render();
          return toast(t('Você já está na versão mais nova.'));
        }
        updateStatus = t('Versão nova de {date} disponível', { date: when });
        render();
        menu(
          t('Atualização disponível'),
          [
            {
              label: t('Instalar agora'),
              sub: t('Publicada em {date}', { date: when }) + (info.message ? ' · ' + info.message : '') + ' · ' + update.shortCommit(info.commit),
              value: 'install',
            },
            { label: t('Agora não'), value: 'later' },
          ],
          {
            center: true,
            onPick: (v) => {
              if (v !== 'install') return;
              toast(t('Atualizando... já volto!'), 8000);
              update.install(info);
            },
          }
        );
      })
      .catch((e) => toast(t('Não foi possível verificar: {msg}', { msg: e.message }), 5000));
  }

  function installFromUrl(url, name) {
    if (!stremio.isLoggedIn()) return toast(t('Entre na conta primeiro'));
    confirmDialog(t('Instalar {name} na sua conta Stremio?', { name: name }), t('Instalar'), () => {
      toast(t('Instalando...'));
      stremio
        .installAddon(url)
        .then((m) => addons.load(true).then(() => m))
        .then((m) => {
          router.dropTab('home');
          toast(t('{name} instalado na sua conta', { name: m.name || 'Addon' }));
          render();
        })
        .catch((e) => toast(t('Não foi possível instalar: {msg}', { msg: e.message }), 5000));
    });
  }

  // NSFW: a aba própria (por perfil) e quais addons contam como adultos.
  function nsfwSection(list) {
    const s = store.settings();
    const adult = list.filter(addons.isAdult);
    // Mexer nas opções NSFW também pede o PIN (uma vez por sessão).
    const guarded = (fn) => () => pinLock.requirePin(fn);
    body.appendChild(
      row(t('Mostrar aba NSFW'), t('Conteúdo adulto fica só nela, fora do Início, Busca e Biblioteca'), '', guarded(() => {
        store.saveSettings({ nsfwTab: store.settings().nsfwTab === false });
        refreshTabs();
        router.dropTab('nsfw');
        render();
      }), toggle(s.nsfwTab !== false))
    );
    const pinInput = h('input.input', { type: 'password', placeholder: t('Novo PIN (4 a 8 números)') });
    pinInput.__submit = (v) => {
      const p = v.trim();
      if (!/^\d{4,8}$/.test(p)) return toast(t('O PIN precisa ter de 4 a 8 números'));
      store.saveSettings({ nsfwPin: p });
      pinInput.value = '';
      toast(t('PIN da aba NSFW trocado'));
    };
    body.appendChild(inputRow(t('PIN da aba NSFW'), t('Pedido ao entrar na aba; vale até o app fechar ou ir para segundo plano'), pinInput, guarded(() => nav.select(pinInput))));
    body.appendChild(
      row(t('Addons adultos'), t('Detectados sozinhos; marque ou desmarque à mão'), adult.length ? t('{n} addon(s)', { n: adult.length }) : t('nenhum'), guarded(() =>
        menu(
          t('Addons adultos'),
          list.map((a) => ({ label: a.manifest.name || a.manifest.id, sub: addons.adultByManifest(a) ? t('Detectado como adulto') : '', value: a.manifest.id, checked: addons.isAdult(a) })),
          {
            onPick: (id) => {
              const a = list.filter((x) => x.manifest.id === id)[0];
              const cur = store.settings();
              const without = (arr) => (arr || []).filter((x) => x !== id);
              const nowAdult = !addons.isAdult(a);
              // Marca à mão só o que difere da detecção automática.
              const auto = addons.adultByManifest(a);
              store.saveSettings({
                nsfwAddons: nowAdult && !auto ? without(cur.nsfwAddons).concat(id) : without(cur.nsfwAddons),
                sfwAddons: !nowAdult && auto ? without(cur.sfwAddons).concat(id) : without(cur.sfwAddons),
              });
              router.dropTab('home');
              router.dropTab('nsfw');
              refreshTabs();
              render();
            },
          }
        )
      ))
    );
  }

  // Teste do serviço da TV (remote/tv-service.js): cada item com ✓/✗ e um veredito no fim.
  function torrentTest() {
    toast(t('Testando a TV... leva até 40 segundos'), 6000);
    getJSON('http://127.0.0.1:8092/api/torrent-test', { timeout: 45000, quiet: true })
      .then((r) => {
        // Linha com ✓/✗ (nó, não texto: o menu aceita nós no rótulo).
        const yes = (ok, text) => h('span', null, [mark(!!ok), text]);
        const nodeMajor = parseInt(String(r.node || 'v0').slice(1), 10) || 0;
        const disk = r.disk || {};
        const writable = Object.keys(disk).filter((d) => disk[d] === true);
        const lines = [
          { label: yes(nodeMajor >= 8, 'Node ' + r.node), sub: nodeMajor >= 8 ? t('Dá para rodar um motor de torrent') : t('Muito antigo para os motores de torrent atuais') },
          { label: yes(r.memFreeMB >= 150, t('Memória livre: {n} MB', { n: r.memFreeMB })), sub: t('de {n} MB · {c} núcleos', { n: r.memTotalMB, c: r.cpus }) },
          { label: yes(r.udp && r.udp.ok, t('UDP (trackers e DHT)')), sub: r.udp && r.udp.ok ? r.udp.ms + ' ms' : (r.udp && r.udp.why) || '-' },
          { label: yes(r.tcp && r.tcp.ok, t('TCP de saída (peers)')), sub: r.tcp && r.tcp.ok ? r.tcp.ms + ' ms' : (r.tcp && r.tcp.why) || '-' },
          { label: yes(r.speed && r.speed.ok, t('Download: {n} Mbps', { n: (r.speed && r.speed.mbps) || 0 })), sub: r.speed && r.speed.ok ? t('{mb} MB em {s} s', { mb: r.speed.MB, s: r.speed.s }) : (r.speed && r.speed.why) || '-' },
          { label: yes(writable.length > 0, t('Gravar no disco')), sub: writable.length ? writable.join(', ') : t('nenhuma pasta gravável') },
        ];
        const viable = nodeMajor >= 8 && r.memFreeMB >= 150 && r.tcp && r.tcp.ok && r.speed && r.speed.ok;
        lines.push({ label: viable ? t('Veredito: dá para tentar torrent na TV') : t('Veredito: a TV não aguenta torrent sozinha'), sub: viable ? t('Me mande uma foto desta tela') : t('Continue com o PC ou use debrid') });
        log.info('Teste de torrent na TV', JSON.stringify(r));
        menu(t('Torrent na TV'), lines, {});
      })
      .catch(() => toast(t('O serviço da TV não respondeu. Abra o Seraflix pelo TizenBrew e tente de novo.'), 6000));
  }

  function toggle(on) {
    return h('div.toggle', { cls: on ? 'on' : '' }, h('i'));
  }

  // Procurar na rede: uma busca por vez; o texto da linha mostra o andamento.
  function scanNetwork() {
    if (server.isScanning()) return toast(t('Já estou procurando o servidor...'));
    toast(t('Procurando servidor na rede...'), 20000);
    setScanText(t('Procurando o servidor na rede...'));
    server
      .scan((n, total) => setScanText(t('Procurando o servidor na rede...') + ' ' + Math.round((n / total) * 100) + '%'))
      .then((ip) => {
        setScanText(t('Varre a rede local atrás do servidor'));
        if (!ip) return toast(t('Nenhum servidor encontrado. Ele está aberto no PC?'));
        store.saveSettings({ serverUrl: ip });
        return server.check().then(() => {
          toast(t('Servidor encontrado em {ip}', { ip: ip }));
          render();
        });
      })
      .catch((e) => {
        setScanText(t('Varre a rede local atrás do servidor'));
        toast(t('Falha na busca: {msg}', { msg: e.message }));
      });
  }

  function setScanText(txt) {
    if (scanText) scanText.textContent = txt;
  }

  // Liga/desliga uma opção de lista (menu) e redesenha. choose(título, sub, lista, chave, valor, rótulo)
  function choose(title, sub, list, key, value, label) {
    body.appendChild(
      row(title, sub, t(String(label)), () =>
        menu(title, list.map((x) => ({ label: t(String(x.label)), value: x.id, checked: x.id === value })), {
          onPick: (v) => {
            const patch = {};
            patch[key] = v;
            store.saveSettings(patch);
            render();
          },
        })
      )
    );
  }

  // Abre uma subtela ('' volta à lista). from: a entrada que foi aberta, para o foco voltar a ela.
  function openSection(id, from) {
    section = id;
    focusTo = id ? 'first' : from;
    if (id) scroller.scrollTop = 0;
    render();
  }

  // ---- Seções (cada uma desenha no corpo da tela atual) ----

  function secPerfil() {
    // A conta Stremio é de todos; cada perfil tem o seu histórico e preferências.
    const prof = store.activeProfile();
    const allProfiles = store.profiles();
    body.appendChild(h('div.set-section', { text: t('Perfil') }));
    const nameInput = h('input.input', { type: 'text', value: prof.name, maxlength: '20' });
    nameInput.__submit = (v) => {
      const name = v.trim().slice(0, 20);
      if (!name || name === prof.name) return;
      if (allProfiles.some((p) => p.id !== prof.id && p.name.toLowerCase() === name.toLowerCase())) {
        nameInput.value = prof.name;
        return toast(t('Já existe um perfil com esse nome.'));
      }
      store.updateProfile(prof.id, { name: name });
      refreshProfileChips();
      toast(t('Nome do perfil salvo'));
      render();
    };
    body.appendChild(inputRow([avatar(prof, 'small'), ' ' + t('Nome do perfil')], t('Aparece em "Quem está assistindo?"'), nameInput));
    body.appendChild(
      row(t('Cor do perfil'), prof.colorPicked ? '' : t('Sorteada ao criar o perfil'), '', () =>
        chooseColor(prof, () => {
          refreshProfileChips();
          render();
        }),
        h('div.avatar.small', { style: avatarStyle(prof.color), text: ' ' })
      )
    );
    if (allProfiles.length > 1) {
      body.appendChild(
        row(t('Trocar de perfil'), t('{n} perfis neste aparelho', { n: allProfiles.length }), '', () =>
          menu(
            t('Trocar de perfil'),
            allProfiles.map((p) => ({ label: [avatar(p, 'swatch'), p.name], value: p.id, checked: p.id === prof.id })),
            { onPick: (id) => id !== prof.id && switchProfile(id) }
          )
        )
      );
    }
    if (canAddProfile()) body.appendChild(row(t('Adicionar perfil'), t('Para outra pessoa: mesma conta, histórico separado'), '', () => createProfile()));
    else body.appendChild(row(t('Adicionar perfil'), t('Limite de {n} perfis: apague um para criar outro', { n: store.MAX_PROFILES }), '', null));
    if (allProfiles.length > 1) {
      body.appendChild(
        row(t('Perguntar "Quem está assistindo?" ao abrir'), '', '', () => {
          store.saveSettings({ askProfile: !store.settings().askProfile });
          render();
        }, toggle(store.settings().askProfile))
      );
      body.appendChild(
        row(t('Apagar este perfil'), t('Remove deste aparelho o histórico e as preferências do perfil (a conta Stremio continua)'), '', () =>
          confirmDialog(t('Apagar o perfil "{name}"? O histórico dele some deste aparelho.', { name: prof.name }), t('Apagar'), () => {
            store.removeProfile(prof.id);
            switchProfile(store.activeProfile().id);
          })
        )
      );
    }
  }

  function secConta(s) {
    body.appendChild(h('div.set-section', { text: t('Conta Stremio') }));
    if (stremio.isLoggedIn()) {
      const u = stremio.user();
      body.appendChild(row(t('Conectado'), t('A mesma conta em todos os perfis; o que cada um assistiu fica separado'), (u && u.email) || t('conta Stremio'), null));
      body.appendChild(
        row(t('Atualizar addons e biblioteca'), t('Busca de novo a lista de addons instalados'), '', () => {
          Promise.all([addons.load(true), stremio.getLibrary()])
            .then(() => {
              toast(t('Atualizado'));
              router.dropTab('home');
            })
            .catch((e) => toast(t('Erro: {msg}', { msg: e.message })));
        })
      );
      body.appendChild(
        row(t('Sair da conta'), '', '', () =>
          confirmDialog(t('Sair da conta Stremio? Sai em todos os perfis.'), t('Sair'), () => {
            stremio.logout();
            addons.load(true).then(() => {
              router.dropTab('home');
              render();
            });
          })
        )
      );
    } else {
      body.appendChild(
        row(t('Entrar na conta'), t('Traz seus addons (Torrentio, debrid...) e a biblioteca'), '', () =>
          openLogin(() => {
            Promise.all([stremio.refreshUser().catch(() => {}), addons.load(true), stremio.getLibrary()]).then(() => {
              router.dropTab('home');
              render();
            });
          })
        )
      );
    }

    // Chaves de serviços (opcionais): cada uma com o campo e um aviso.
    body.appendChild(h('div.set-section', { text: t('Metadados extras (opcional)') }));
    const keyRow = (title, sub, key, placeholder) => {
      const builtin = !!extras.BUILTIN_KEYS[key];
      if (builtin) sub += ' · ' + t('já vem embutida, só preencha para usar outra');
      const input = h('input.input', { type: 'text', value: s[key] || '', placeholder: builtin ? t('Embutida no app') : placeholder });
      input.__submit = (v) => {
        const patch = {};
        patch[key] = v.trim();
        store.saveSettings(patch);
        toast(v.trim() ? t('Chave salva') : t('Chave removida'));
        render();
      };
      body.appendChild(inputRow(title, sub, input));
    };
    keyRow(t('Chave TMDB'), t('Sinopses e títulos em PT-BR, logos e elenco com fotos (grátis em themoviedb.org)'), 'tmdbKey', 'API key (v3)');
    keyRow(t('Chave MDBList'), t('Notas do Rotten Tomatoes, Metacritic, Trakt e Letterboxd (grátis em mdblist.com)'), 'mdblistKey', 'API key');
    {
      // Real-Debrid: a chave costuma vir sozinha da URL do Torrentio da conta; aqui é só para outra.
      const found = !s.rdKey && debrid.available();
      keyRow(
        t('Chave do Real-Debrid'),
        (found ? t('Achei a da sua conta (pelos addons)') : t('Para tocar torrents sem o PC, inclusive os da área NSFW')) + ' · real-debrid.com/apitoken',
        'rdKey',
        found ? t('Já encontrada nos addons') : 'API token'
      );
    }
  }

  function secServidor(s) {
    body.appendChild(h('div.set-section', { text: t('Servidor de streaming (PC)') }));
    const st = server.lastStatus();
    const stText = !s.serverUrl ? t('não configurado') : st.ok && st.url === server.baseUrl() ? t('conectado') : t('sem resposta');
    const urlInput = h('input.input', { type: 'text', value: s.serverUrl || '', placeholder: 'ex.: 192.168.0.10' });
    urlInput.__submit = (v) => {
      store.saveSettings({ serverUrl: v.trim() });
      server.check().then((r) => {
        toast(r.ok ? t('Servidor conectado') : t('Servidor não respondeu em {url}', { url: server.baseUrl() }));
        render();
      });
    };
    if (!IS_WEB) body.appendChild(inputRow(t('Endereço do PC'), t('Rode o stremio-service no PC (porta 11470). Status: {s}', { s: stText }), urlInput));
    if (!IS_WEB) {
      const scanEl = row(t('Procurar na rede'), server.isScanning() ? t('Procurando o servidor na rede...') : t('Varre a rede local atrás do servidor'), '', () => scanNetwork());
      if (server.isScanning()) scanEl.style.opacity = '0.6';
      scanText = scanEl.querySelector('small');
      body.appendChild(scanEl);
    }
    body.appendChild(
      row(t('Testar servidor'), '', '', () =>
        server.check().then((r) => {
          toast(r.ok ? t('Servidor OK') + (r.version ? ' (v' + r.version + ')' : '') : t('Sem resposta de {url}', { url: server.baseUrl() || '-' }));
          render();
        })
      )
    );
    if (HAS_TV_SERVICE) body.appendChild(row(t('Testar torrent na TV (sem o PC)'), t('Mede se a própria TV aguenta baixar torrent: Node, memória, rede e disco'), '', () => torrentTest()));
  }

  function secAparencia(s) {
    body.appendChild(h('div.set-section', { text: t('Aparência (Kai)') }));
    const heroName = t((hero.SOURCES.find((x) => x.id === s.heroSource) || hero.SOURCES[0]).name);
    body.appendChild(
      row(t('Hero Banner'), t('Destaques no topo da tela inicial'), heroName, () =>
        menu(
          t('Fonte do Hero Banner'),
          hero.SOURCES.map((x) => ({ label: t(x.name), value: x.id, checked: x.id === s.heroSource })),
          {
            onPick: (v) => {
              store.saveSettings({ heroSource: v });
              router.dropTab('home');
              render();
            },
          }
        )
      )
    );
    body.appendChild(
      row(t('Modo claro'), t('Creme de dia, escuro de noite'), '', () => {
        store.saveSettings({ theme: themeOf(store.settings()) === 'light' ? 'dark' : 'light' });
        applyTheme(store.settings());
        render();
      }, toggle(themeOf(s) === 'light'))
    );
    body.appendChild(
      row(t('Rolagem animada'), t('Mais bonita, porém mais pesada na TV'), '', () => {
        const on = !store.settings().smoothScroll;
        store.saveSettings({ smoothScroll: on });
        nav.setSmooth(on);
        render();
      }, toggle(s.smoothScroll))
    );
    body.appendChild(
      row(t('Efeitos reduzidos'), t('Menos efeitos visuais e animações; ajuda em TVs mais fracas'), '', () => {
        const on = !lowfxOn(store.settings());
        store.saveSettings({ lowfx: on });
        document.body.classList.toggle('lowfx', on);
        render();
      }, toggle(lowfxOn(s)))
    );
    const ssMin = screensaver.minutes();
    body.appendChild(
      row(t('Protetor de tela'), t(IS_WEB ? 'Os lançamentos passando na tela quando você fica sem mexer' : 'Os lançamentos passando na tela quando o controle fica parado'), ssMin ? t('{n} min', { n: ssMin }) : t('Desligado'), () =>
        menu(
          t('Protetor de tela'),
          screensaver.OPTIONS.map((m) => ({ label: m ? t('Depois de {n} min parado', { n: m }) : t('Desligado'), value: m, checked: m === ssMin })).concat([
            { label: t('Ver agora'), sub: t('Mostra o protetor de tela já'), value: 'now' },
          ]),
          {
            onPick: (v) => {
              if (v === 'now') return setTimeout(() => screensaver.start(), 300);
              store.saveSettings({ screensaver: v });
              screensaver.arm();
              render();
            },
          }
        )
      )
    );
    body.appendChild(
      row(t('Som de abertura'), t('O clique com acorde quando o Seraflix abre'), '', () => {
        const on = store.settings().introSound === false;
        store.saveSettings({ introSound: on });
        if (on) intro.playSound(); // toca para você ouvir
        render();
      }, toggle(s.introSound !== false))
    );
  }

  function secReproducao(s) {
    body.appendChild(h('div.set-section', { text: t('Reprodução') }));
    body.appendChild(
      row(t('Smart Choice'), IS_FIRETV ? t('Ao escolher um episódio, já abre a melhor fonte: Real-Debrid dublado primeiro; senão a que toca liso no Fire TV (1080p, sem 4K pesado)') : t('Ao escolher um episódio, já abre a melhor fonte: original + dublado, boa qualidade e bem semeada'), '', () => {
        store.saveSettings({ smartChoice: store.settings().smartChoice === false });
        render();
      }, toggle(s.smartChoice !== false))
    );
  }

  function secLegendas(s) {
    body.appendChild(h('div.set-section', { text: t('Legendas e áudio') }));
    // Idioma e áudio são listas de códigos (arrays): a opção atual é marcada pelo rótulo.
    const subName = subLangLabel(s);
    body.appendChild(
      row(t('Idioma da legenda'), t('Escolhida sozinha ao abrir o vídeo'), t(subName), () =>
        menu(t('Idioma da legenda'), SUB_LANGS.map((x) => ({ label: t(x.label), value: x.value, checked: x.label === subName })), {
          onPick: (v) => {
            store.saveSettings({ subtitleLangs: v });
            render();
          },
        })
      )
    );
    body.appendChild(
      row(t('Ligar legenda automaticamente'), t('Se o áudio não estiver no seu idioma'), '', () => {
        store.saveSettings({ subtitlesAuto: !store.settings().subtitlesAuto });
        render();
      }, toggle(s.subtitlesAuto))
    );
    const audName = audioLangLabel(s);
    body.appendChild(
      row(t('Áudio preferido'), t('Precisa do servidor do PC para ler as faixas'), t(audName), () =>
        menu(t('Áudio preferido'), AUDIO_LANGS.map((x) => ({ label: t(x.label), value: x.value, checked: x.label === audName })), {
          onPick: (v) => {
            store.saveSettings({ audioLangs: v });
            render();
          },
        })
      )
    );

    // ---- Aparência da legenda (padrão Kai: Nata Sans, negrito, contorno fino + sombra) ----
    body.appendChild(h('div.set-section', { text: t('Aparência da legenda') }));
    const preview = h('div.subs', null, h('span', { html: t('Oi. Meu nome é Peter Parker.') + '\n<i>' + t('Você não lembra de mim...') + '</i>' }));
    substyle.apply(preview, s);
    body.appendChild(h('div.sub-preview', null, preview));
    const lb = substyle.labels(s);
    choose(t('Fonte'), t('Vale para legendas de addons (OpenSubtitles etc.)'), substyle.FONTS, 'subtitleFont', s.subtitleFont, lb.font);
    choose(t('Estilo'), t('Contorno, sombra ou caixa de fundo'), substyle.STYLES, 'subtitleStyle', s.subtitleStyle, lb.style);
    choose(t('Cor do texto'), '', substyle.COLORS, 'subtitleColor', s.subtitleColor, lb.color);
    choose(
      t('Tamanho'),
      '',
      substyle.SIZES.map((v) => ({ id: v, label: v + '%' })),
      'subtitleSize',
      s.subtitleSize || 100,
      (s.subtitleSize || 100) + '%'
    );
    choose(t('Posição'), t('Distância da borda de baixo'), substyle.POSITIONS, 'subtitlePosition', s.subtitlePosition, lb.position);
    body.appendChild(
      row(t('Negrito'), t('O Kai usa negrito'), '', () => {
        store.saveSettings({ subtitleBold: store.settings().subtitleBold === false });
        render();
      }, toggle(s.subtitleBold !== false))
    );
    body.appendChild(
      h('div.hint', { style: { padding: '6px 4px 0' }, text: t('Legendas embutidas no arquivo são desenhadas pela própria TV: só cor, tamanho, posição e caixa se aplicam a elas.') })
    );
  }

  function secPlayer(s) {
    body.appendChild(h('div.set-section', { text: t('Player') }));
    choose(
      t('Pular abertura e encerramento'),
      t('IntroDB (séries e filmes) e AniSkip (animes)'),
      [
        { id: 'prompt', label: t('Mostrar botão "Pular"') },
        { id: 'auto', label: t('Pular automaticamente') },
        { id: 'off', label: t('Desligado') },
      ],
      'skipMode',
      s.skipMode,
      { prompt: t('Mostrar botão'), auto: t('Automático'), off: t('Desligado') }[s.skipMode] || t('Mostrar botão')
    );
  }

  function secAgenda() {
    if (IS_WEB) return;
    body.appendChild(h('div.set-section', { text: t('Google Agenda') }));
    const s = store.settings();
    const calInput = h('input.input', { type: 'text', value: s.calendarUrl || '', placeholder: calendar.BUILTIN ? t('Embutido no app') : 'https://calendar.google.com/calendar/ical/…/basic.ics' });
    calInput.__submit = (v) => {
      store.saveSettings({ calendarUrl: v.trim() });
      calendar.start();
      toast(v.trim() ? t('Agenda ligada') : t('Agenda desligada'));
      render();
    };
    body.appendChild(
      inputRow(
        t('Link da agenda (iCal)'),
        t('Google Agenda › Configurações › sua agenda › "Endereço secreto no formato iCal". Vários links: separe com espaço.') +
          (calendar.BUILTIN ? ' · ' + t('já vem embutido, só preencha para usar outro') : ''),
        calInput
      )
    );
  }

  function secAddons() {
    body.appendChild(h('div.set-section', { text: t('Addons') }));
    const list = addons.list();
    body.appendChild(
      row(t('Addons ativos'), stremio.isLoggedIn() ? t('Gerencie pela sua conta em web.stremio.com') : t('Sem conta: Cinemeta, OpenSubtitles e os adicionados aqui'), t('{n} addon(s)', { n: list.length }), () =>
        menu(t('Addons ativos'), list.map((a) => ({ label: a.manifest.name || a.manifest.id, sub: a.transportUrl })), {})
      )
    );
    if (HAS_TV_SERVICE) nsfwSection(list); // os addons adultos vêm do serviço da TV (no Fire TV ficam escondidos)
    // Addons recomendados (só aparecem se ainda não estiverem instalados).
    RECOMMENDED.filter((r) => !list.some((a) => a.transportUrl === r.url || (a.manifest && a.manifest.id === r.id))).forEach((r) =>
      body.appendChild(row(t('Instalar {name}', { name: r.name }), t(r.desc), '', () => installFromUrl(r.url, r.name)))
    );
    const addInput = h('input.input', { type: 'text', placeholder: 'https://.../manifest.json' });
    addInput.__submit = (v) => {
      const u = v.trim();
      if (!/^https?:\/\/.+manifest\.json/.test(u)) return toast(t('Cole a URL do manifest.json do addon'));
      if (stremio.isLoggedIn()) return installFromUrl(u, t('o addon'));
      const cur = store.settings().localAddons || [];
      store.saveSettings({ localAddons: cur.concat([u]) });
      addons.load(true).then(() => {
        router.dropTab('home');
        toast(t('Addon adicionado'));
        render();
      });
    };
    body.appendChild(inputRow(t('Adicionar addon por URL'), stremio.isLoggedIn() ? t('Instala na sua conta Stremio') : t('Fica só nesta TV'), addInput));
  }

  function secSobre(s) {
    if (!IS_WEB) {
      body.appendChild(h('div.set-section', { text: t('Atualizações') }));
      // Fire TV: o app Android baixa a versão nova sozinho ao abrir; aqui dá para forçar agora.
      if (IS_FIRETV) body.appendChild(row(t('Procurar atualização'), t('O app se atualiza sozinho ao abrir; aqui busca agora no GitHub ({repo})', { repo: update.REPO }), '', () => {
        const a = android();
        if (!a) return toast(t('Só no app do Fire TV'));
        toast(t('Procurando atualização...'), 15000);
        a.checkUpdate();
      }));
      else body.appendChild(row(t('Procurar atualização'), updateStatus || t('Busca a versão mais nova no GitHub ({repo})', { repo: update.REPO }), '', () => checkForUpdate()));
      const b = update.BUILD;
      body.appendChild(
        row(
          t('Versão instalada'),
          b.date ? t('Publicada em {date}', { date: update.formatDate(b.date) }) + (b.message ? ' · ' + b.message : '') : t('Build local'),
          'v' + update.VERSION + (b.commit ? ' · ' + update.shortCommit(b.commit) : ''),
          null
        )
      );
    }
    if (device && !IS_WEB) body.appendChild(row(t(IS_FIRETV ? 'Aparelho' : 'TV'), '', device, null));

    body.appendChild(h('div.set-section', { text: t('Sobre e depuração') }));
    body.appendChild(row(t('Testar serviços e addons'), t(IS_WEB ? 'Coisas não carregam? Veja qual servidor este aparelho não alcança' : 'Coisas não carregam? Veja qual servidor a TV não alcança'), '', () => showNetworkCheck()));
    body.appendChild(row(t('Último trailer'), t('Resultado do trailer na aba Recomendado'), reco.getTrailerReport() || t('nenhum ainda'), null));
    const plays = playlog.list();
    const lastPlay = plays[0];
    body.appendChild(
      row(t('Últimos plays'), t('O que tocou e o que não tocou, com o motivo'), lastPlay ? null : t('nenhum ainda'), () =>
        menu(
          t('Últimos plays'),
          plays.map((x, i) => ({
            label: h('span', null, [mark(x.result === 'ok'), x.title]),
            sub: [timeHM(new Date(x.at)) + ' · ' + (x.result === 'ok' ? t('tocou') : x.result === 'erro' ? t('não tocou') : t('sem fonte')), x.source, x.details].filter(Boolean).join('\n'),
            value: i,
            wrap: true,
          })),
          { empty: t('Nenhum play ainda.') }
        ),
        null,
        lastPlay ? h('div.value', null, [mark(lastPlay.result === 'ok'), lastPlay.title]) : null
      )
    );
    if (!IS_WEB) body.appendChild(inputRow(t('Log remoto'), t('npm run logs no PC'), logInput()));
  }

  // Campo do log remoto: manda os logs para o PC (npm run logs).
  function logInput() {
    const s = store.settings();
    const input = h('input.input', { type: 'text', value: s.devlogUrl || '', placeholder: 'http://IP-DO-PC:8099/log' });
    input.__submit = (v) => {
      store.saveSettings({ devlogUrl: v.trim() });
      log.setRemote(v.trim());
      log.info(t('Log remoto ligado'));
      toast(v.trim() ? t('Enviando logs para o PC') : t('Log remoto desligado'));
    };
    return input;
  }

  function render() {
    const s = store.settings();
    const keep = nav.current();
    const keepIndex = keep ? Array.prototype.indexOf.call(body.querySelectorAll('.set-row'), keep) : -1;
    clear(body);
    scanText = null;

    if (section === '') {
      // Lista principal: o mais usado; o resto fica nas subtelas (entradas no fim).
      secPerfil();
      secServidor(s);
      secAparencia(s);
      secReproducao(s);
      secPlayer(s);
      secAgenda();
      secAddons();
      const subs = [
        entry('legendas', t('Legendas'), t('Idioma, aparência da legenda e áudio preferido'), t(subLangLabel(s))),
        entry('conta', t('Conta'), t('Conta Stremio e chaves de serviços (TMDB, MDBList, Real-Debrid)'), stremio.isLoggedIn() ? t('conectada') : t('sem conta')),
        entry('sobre', t('Sobre'), t('Atualizações, aparelho, testes de conexão e de reprodução'), IS_WEB ? '' : 'v' + update.VERSION),
      ];
      subs.forEach((r) => body.appendChild(r));
    } else {
      body.appendChild(h('div.set-section', { text: t(SECTION_TITLE[section]) }));
      if (section === 'legendas') secLegendas(s);
      else if (section === 'conta') secConta(s);
      else if (section === 'sobre') secSobre(s);
    }

    // Foco: a entrada de origem (ao voltar), o primeiro item (ao abrir) ou o mesmo item de antes.
    const rows = body.querySelectorAll('.set-row');
    if (focusTo === 'first') {
      if (rows[0]) nav.focus(rows[0]);
    } else if (focusTo) {
      const target = body.querySelector('[data-entry="' + focusTo + '"]');
      if (target) nav.focus(target);
    } else if (keepIndex >= 0 && rows[keepIndex]) nav.focus(rows[keepIndex]);
    focusTo = null;
  }

  render();

  return {
    el: el,
    onShow: () => {
      server.check().then(() => render());
    },
    // Voltar numa subtela leva à lista, com o foco na entrada que foi aberta. Na lista, segue o padrão.
    onBack: () => {
      if (!section) return false;
      const from = section;
      openSection('', from);
      return true;
    },
    destroy: () => bar.__destroy && bar.__destroy(),
  };
}
