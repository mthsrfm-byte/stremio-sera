// Últimas tentativas de play (Ajustes → Sobre e depuração → Últimos plays): o que foi aberto, de
// qual fonte, se tocou e, se não, o motivo. Sem isso, um "não tocou" no aparelho de alguém não dá
// para investigar depois. Fica no aparelho (vale para todos os perfis), só as 8 mais recentes.
const KEY = 'kai.playLog';
const MAX = 8;

export function list() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '[]') || [];
  } catch (e) {
    return [];
  }
}

// result: 'ok' (começou a tocar), 'erro' (o player desistiu) ou 'sem fonte' (nenhuma tocável).
export function add(title, source, result, details) {
  const all = list();
  all.unshift({ at: Date.now(), title: String(title || ''), source: String(source || ''), result: result, details: String(details || '').slice(0, 600) });
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX)));
  } catch (e) {
    /* armazenamento cheio: só não guarda */
  }
}
