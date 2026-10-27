// Gêneros dos addons (Cinemeta vem em inglês) em português.
const PT = {
  action: 'Ação', adventure: 'Aventura', animation: 'Animação', biography: 'Biografia', comedy: 'Comédia',
  crime: 'Crime', documentary: 'Documentário', drama: 'Drama', family: 'Família', fantasy: 'Fantasia',
  'film-noir': 'Film noir', 'film noir': 'Film noir', 'game-show': 'Game show', 'game show': 'Game show', history: 'História',
  horror: 'Terror', music: 'Música', musical: 'Musical', mystery: 'Mistério', news: 'Notícias',
  'reality-tv': 'Reality show', 'reality tv': 'Reality show', reality: 'Reality show', romance: 'Romance',
  'sci-fi': 'Ficção científica', 'science fiction': 'Ficção científica', 'science-fiction': 'Ficção científica',
  short: 'Curta', sport: 'Esporte', sports: 'Esporte', 'talk-show': 'Talk show', 'talk show': 'Talk show',
  thriller: 'Suspense', war: 'Guerra', western: 'Faroeste', anime: 'Anime', kids: 'Infantil', soap: 'Novela',
  'action & adventure': 'Ação e aventura', 'sci-fi & fantasy': 'Ficção e fantasia', 'war & politics': 'Guerra e política',
  'tv movie': 'Filme para TV', children: 'Infantil', suspense: 'Suspense', superhero: 'Super-herói',
};

export function genreName(g) {
  const key = String(g || '').trim().toLowerCase();
  return PT[key] || g;
}

export function hasGenre(g) {
  return !!PT[String(g || '').trim().toLowerCase()];
}
