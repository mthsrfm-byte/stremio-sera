// Tokens de design do app.css: no CSS, `$nome` vira o valor abaixo no build (tools/build.mjs).
// Os valores vão literais, com as mesmas maiúsculas do CSS antigo, para a saída sair igual.
export const tokens = {
  // Cores base
  paper: '#F5F4EF', // texto claro sobre escuro e fundo claro
  ink: '#111110', // texto escuro sobre claro e foco claro
  white: '#fff', // controles sobre o vídeo e texto sobre acento
  black: '#000',
  bg: '#0d0b14', // fundo do app
  panel: '#1C1C1A', // modais, toasts e painéis
  'surface-light': '#EDEBE4', // placeholder de pôster no tema claro
  accent: '#3347FF', // foco no app (azul)
  'accent-deep': '#2236E0', // texto azul no tema claro
  kai: '#7b5bf5', // roxo do tema Kai
  violet: '#9d85ff', // logo e destaques
  lilac: '#c9bbff', // bordas e textos lilás
  lavender: '#A9B4F5', // destaques sobre o escuro
  muted: '#A3A19A', // texto secundário
  nsfw: '#e5508c', // rosa da área NSFW (ação e foco)
  'nsfw-soft': '#ffc2d9', // borda de foco NSFW e rótulos
  'nsfw-hot': '#FF6B8A', // coração de favorito na área NSFW
  'nsfw-wine-0': '#0e0a0d', // fundo NSFW, base do degradê
  'nsfw-wine-1': '#150b12', // fundo NSFW, meio do degradê
  'nsfw-wine-2': '#22101b', // fundo NSFW, topo e fundo de capas
  'nsfw-wine-a': 'rgba(21,11,18,0.6)', // escrim sobre a capa do destaque
  'nsfw-glow': 'rgba(229,80,140,0.2)', // brilho rosa do canto de cima
  'nsfw-tint': 'rgba(229,80,140,0.16)', // site da vez e fundo leve
  'nsfw-tint-strong': 'rgba(229,80,140,0.42)', // chips e botões sem foco
  'nsfw-surface': 'rgba(255,194,217,0.07)', // painéis, ladrilhos e pílulas
  'nsfw-line': 'rgba(255,194,217,0.18)', // bordas discretas
  'nsfw-dim': 'rgba(255,194,217,0.7)', // rótulos e subtítulos
  'nsfw-side': 'rgba(10,6,9,0.5)', // coluna de categorias da grade
  'nsfw-badge': 'rgba(14,10,13,0.84)', // selos sobre a capa (qualidade, duração, visto)
  'nsfw-wine-clear': 'rgba(21,11,18,0)', // degradê do destaque (fim transparente)
  'nsfw-glow-clear': 'rgba(229,80,140,0)', // degradê do brilho rosa (fim transparente)
  'nsfw-tint-soft': 'rgba(229,80,140,0.1)', // fundo leve de ladrilhos e grade de categorias
  'nsfw-light': '#ffe2ee', // fundo do tema claro
  'nsfw-light-clear': 'rgba(255,226,238,0)', // fim do degradê do tema claro
  'nsfw-ink-dim': 'rgba(160,40,90,0.7)', // rótulos no tema claro
  'nsfw-line-light': 'rgba(160,40,90,0.25)', // bordas no tema claro
  error: '#ff8a8a',
  warn: '#F2A33A',
  ok: '#8FD9A8',
  // Variações com alfa (mesma cor, rgba)
  'paper-dim': 'rgba(245,244,239,0.6)',
  'paper-soft': 'rgba(245,244,239,0.85)',
  'paper-line': 'rgba(245,244,239,0.12)',
  'paper-faint': 'rgba(245,244,239,0.06)',
  'ink-dim': 'rgba(17,17,16,0.6)',
  'ink-faint': 'rgba(17,17,16,0.08)',
  'accent-glow': 'rgba(51,71,255,0.16)',
  'accent-tint': 'rgba(51,71,255,0.22)',
  'white-dim': 'rgba(255,255,255,0.6)',
  'white-soft': 'rgba(255,255,255,0.7)',
  'white-line': 'rgba(255,255,255,0.12)',
  surface: 'rgba(255,255,255,0.06)',
  'black-dim': 'rgba(0,0,0,0.6)',
  // Raios (border-radius)
  'r-xs': '6px',
  'r-sm': '12px',
  'r-card': '14px', // cartões e linhas
  'r-block': '18px', // sites e painéis
  'r-modal': '28px', // modais
  'r-tile': '16px', // ladrilhos e cartões da aba NSFW
  'r-pill': '40px', // pílulas e campos (aba NSFW)
  // Escala de fontes (font-size)
  'fs-label': '20px', // selos, rótulos, nome de cartão
  'fs-text': '22px', // metadados, texto e opções
  'fs-button': '24px', // botões e abas
  'fs-lead': '26px', // destaques
  'fs-row': '30px', // título de fileira
  'fs-section': '34px', // título de seção
  'fs-track': '40px', // título de trilha
  'fs-page': '48px', // título de página
  'fs-stage': '56px', // título do destaque (palco da aba NSFW)
  'fs-hero': '60px', // título de destaque
  'fs-cat': '28px', // nome de categoria em ladrilho (aba NSFW)
};
