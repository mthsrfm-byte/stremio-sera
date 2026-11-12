import { IS_WEB } from './platform.js';

// Versão Seraflix dos textos: chave = texto original, valor = texto com mais personalidade.
// O que não está aqui aparece como está no código.
export const FUN = {
  // Navegação e geral
  'Nada por aqui.': 'Nada por aqui. Só um vento e uma pipoca perdida.',
  'Carregando...': 'Carregando... respira fundo.',
  'carregando...': 'carregando... calma, calabreso.',
  'Sair do Stremio Kai?': 'Já vai embora do Seraflix?',
  'Desconhecido': 'Mistério',

  // Perfis
  '+ Adicionar perfil': '+ Chamar mais gente para o sofá',
  'Com outra conta Stremio (histórico separado)': 'Cada um com seu histórico (sem julgamentos)',
  'Quem está assistindo?': 'Quem tá no controle hoje?',
  'Todos usam a mesma conta Stremio; cada perfil tem o seu histórico.': 'Cada perfil tem seu histórico. Ninguém vai saber que você viu a novela inteira de novo.',
  'Nome do novo perfil': 'Como vamos te chamar?',
  'Ex.: Ana, Pedro, Sala': 'Ex.: Mãe, Tio do Pavê, Sala',
  'Nome do perfil salvo': 'Nome novo, quem é você?',
  'Este perfil usa a conta Stremio abaixo': 'Este perfil usa a conta logo aqui embaixo',
  'Para outra pessoa: mesma conta, histórico separado': IS_WEB ? 'Para aquela pessoa que vive roubando o mouse' : 'Para aquela pessoa que vive roubando o controle',
  'Remove deste aparelho o histórico e as preferências do perfil (a conta Stremio continua)': 'Some só daqui, com o histórico junto. A conta continua vivinha da silva.',

  // Assistente
  'Bem-vindo! Quem vai usar este perfil?': 'Opa, chegou! Quem é você na fila do pão?',
  'Dê um nome ao perfil. Depois você pode criar outros perfis, cada um com a própria conta Stremio e histórico.': 'Dá um nome para o perfil. Depois dá para criar outros, cada um com seu histórico e suas vergonhas.',
  'Bem-vindo ao Stremio Kai': 'Bem-vindo ao Seraflix',
  'Você já está conectado à sua conta Stremio. Seus addons e sua biblioteca já estão aqui.': 'Você já entrou na conta. Addons e biblioteca já chegaram, pode tirar o sapato.',
  'Entre com a sua conta Stremio para trazer seus addons (Torrentio, debrid, Anime Kitsu...) e a biblioteca.': 'Entra na sua conta (a do Stremio, aquela de sempre) para trazer addons e biblioteca para o Seraflix.',
  'Servidor conectado em {url}. Torrents liberados.': 'Servidor achado em {url}. Torrents na área!',
  'Procurando o servidor na rede...': 'Caçando o servidor pela casa...',
  'Servidor encontrado em {ip}': 'Achei! Ele estava escondido em {ip}',
  'Em qual idioma o app deve ligar a legenda sozinho quando o áudio não for no seu idioma?': 'Quando o povo do filme falar enrolado, ligo a legenda em qual idioma?',
  'Não ligar sozinho': 'Deixa que eu me viro',

  // Login
  'Gerando código...': 'Inventando um código secreto...',
  'Use a mesma conta do Stremio. Seus addons e a biblioteca vêm junto.': 'É a mesma conta do Stremio. Addons e biblioteca vêm de brinde.',
  'Aguardando confirmação...': 'Esperando você no celular... sem pressa (mas vai logo).',
  'Código expirou. Gerando outro...': 'O código expirou. Gerando outro...',
  'Preencha e-mail e senha.': 'Preencha o e-mail e a senha.',
  'Entrando...': 'Abrindo a porta...',
  'Falha no login': 'Não foi possível entrar. Confira o e-mail e a senha e tente de novo.',
  'Conectado à conta Stremio': 'Tamo dentro! Conta conectada.',

  // Início, busca, biblioteca, calendário
  'Continuar assistindo': 'Aquele que você largou no meio',
  'Carregando catálogos...': 'Arrumando a prateleira...',
  'Nenhum catálogo. Entre na sua conta em Ajustes.': 'Prateleira vazia. Entra na conta em Ajustes que ela enche.',
  'Buscar filmes e séries...': 'O que vamos maratonar hoje?',
  'Buscando "{q}"...': 'Revirando tudo atrás de "{q}"...',
  'Nada encontrado para "{q}".': 'Procurei "{q}" até embaixo do sofá. Nada.',
  'Sua biblioteca está vazia.': 'Biblioteca vazia. Bora mudar isso?',
  'Carregando biblioteca...': 'Tirando a poeira da biblioteca...',
  'Buscando lançamentos...': 'Espiando o que vem por aí...',
  'Nenhum episódio neste dia.': 'Dia de folga: nenhum episódio. Vai tomar um sol.',
  'Abrindo {name}...': 'Lá vem {name}...',

  // Detalhes e fontes
  'Removido da biblioteca': 'Tchau, foi da biblioteca',
  'Adicionado à biblioteca': 'Guardadinho na biblioteca',
  'Buscando fontes nos addons...': 'Perguntando para os addons quem tem esse...',
  'Nenhuma fonte encontrada.': 'Nenhuma fonte encontrada. Tente de novo mais tarde ou instale outro addon de streams.',
  'Esse tipo de fonte não abre na TV.': 'Esse tipo de fonte não abre na TV. Escolha outra fonte.',
  'Continuar de onde parou?': 'Continua de onde cochilou?',
  'Começar do início': 'Do começo, que eu não lembro de nada',
  'Não foi possível abrir': 'Não foi possível abrir. Escolha outra fonte.',
  'Detalhes não encontrados': 'Detalhes não encontrados. Tente de novo mais tarde.',

  // Player
  'Abertura pulada': 'Abertura pulada. Nem vem cantar junto.',
  'Recapitulação pulada': 'Recap pulado. Você lembra, né?',
  'Encerramento pulado': 'Créditos pulados. Bora pro próximo!',
  'O vídeo parou de carregar': 'O vídeo parou de carregar. Verifique a conexão ou escolha outra fonte.',
  'Reconectando ao vídeo...': 'Assoprando a fita...',
  'Problema na reprodução': 'Não foi possível reproduzir. Escolha outra fonte.',
  'Lendo as faixas do arquivo...': 'Fuçando as faixas do arquivo...',
  'Só uma faixa de áudio.': 'Só tem um áudio. É esse ou o silêncio.',
  'Nenhuma legenda.': 'Nenhuma legenda. Hora de treinar a leitura labial.',
  'Procurando o próximo episódio...': 'Já buscando o próximo, não ouse levantar...',

  // Ajustes
  'Conta Stremio': 'Sua conta',
  'conta Stremio': 'sua conta',
  'Atualizado': 'Tudo fresquinho',
  'Sair da conta Stremio? Sai em todos os perfis.': 'Sair da conta? Vale para todos os perfis.',
  'Nenhum servidor encontrado. Ele está aberto no PC?': 'Nenhum servidor encontrado. Confira se o Stremio está aberto no PC.',
  'Servidor OK': 'Servidor de boa',
  'Aparência (Kai)': 'Aparência',
  'Rolagem animada': 'Rolagem chiquetosa',
  'Mais bonita, porém mais pesada na TV': 'Mais bonita, mas a TV velhinha pode sofrer',
  'O Kai usa negrito': 'Negrito deixa tudo mais confiante',
  'Instalar {name} na sua conta Stremio?': 'Instalar {name} na sua conta?',
  'Instala na sua conta Stremio': 'Instala na sua conta',
  'Manifest inválido': 'Manifest inválido. Confira o endereço do addon.',
  'Você já está na versão mais nova (v{v}).': 'Você já está no Seraflix mais novinho (v{v}).',
  'Atualizado! Reabrindo...': 'Atualizado! Já volto...',

  // Erros de rede e da conta
  'Erro da API Stremio': 'A conta do Stremio respondeu com erro. Tente de novo em instantes.',
  'Tempo esgotado em {url}': 'Tempo esgotado ao falar com {url}. Verifique a conexão e tente de novo.',
};
