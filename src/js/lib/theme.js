// Modo do app, com as cores de matheusserafim.com: 'dark' (escuro, padrão) | 'light' (claro).
// A classe "sera" (fontes, logo e acento azul) vale sempre; "light" troca as cores para o creme.
export function themeOf(s) {
  return s.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(s) {
  document.body.classList.add('sera');
  document.body.classList.toggle('light', themeOf(s) === 'light');
  document.body.classList.remove('oled');
}
