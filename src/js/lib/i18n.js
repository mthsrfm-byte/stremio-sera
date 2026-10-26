// Textos do app: só português do Brasil. A chave é o próprio texto em português e a
// versão Seraflix (i18n-fun.js) troca o que tiver graça; t('Olá {nome}', { nome: 'Ana' })
// troca os {parâmetros}.
import { FUN } from './i18n-fun.js';

export function init() {
  document.documentElement.setAttribute('lang', 'pt-BR');
  return 'pt';
}

export function current() {
  return 'pt';
}

// Idioma para APIs de metadados (TMDB).
export function apiLang() {
  return 'pt-BR';
}

export function t(text, params) {
  let out = FUN[text] !== undefined ? FUN[text] : text;
  if (params) {
    Object.keys(params).forEach((k) => {
      out = out.split('{' + k + '}').join(String(params[k]));
    });
  }
  return out;
}
