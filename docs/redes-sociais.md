# Minhas redes (`/mysocialmedia`)

Inventário das suas redes sociais para **triar**: o que você segue, o que salvou e as suas playlists, cada item com categoria e palavras-chave, e uma decisão sua por item. O app **só lê** os arquivos que você coloca e **só grava** as suas decisões. Ele não entra em conta nenhuma, não baixa nada e não traz coletor: quem coleta e categoriza é você, um script ou um agente seu.

Três áreas, uma aba cada:

| Rota | O que mostra |
|---|---|
| `/mysocialmedia` | início: números de cada rede (a triar, na fila, em `/referencias`) e as categorias mais frequentes |
| `/mysocialmedia/instagram` | aba **Saves** (posts salvos, com capa, categoria, palavras-chave e coleção) e aba **Contas** (quem você segue, por nicho). `?aba=contas` abre a segunda |
| `/mysocialmedia/<username>` | a ficha de uma conta, com bio e, se existir, o dossiê (análise e posts recentes) |
| `/mysocialmedia/youtube` | aba **Playlists** (panorama por categoria e as listas) e aba **Vídeos** (cada vídeo, com filtros) |

Sem nenhum arquivo, todas as telas abrem **vazias** e dizem o que colocar.

## A triagem

Cada save e cada vídeo pode receber uma decisão (ou nenhuma). Os filtros do painel lateral ("triagem") se baseiam nelas:

| Decisão | Efeito |
|---|---|
| `descartado` | "não vale a pena": some da lista (volta em "descartados"); reversível |
| `manter` | continua no inventário, com uma estrela |
| `referencia` | **pedido** de ingestão em `/referencias` ("na fila"). O app não ingere: quando o post passa a existir em `/referencias` (mesmo `code` do save, ou `code` igual ao id do vídeo no YouTube), ele deixa de ser "fila" e passa a "já em referências" |

"A triar" = sem decisão e ainda fora de `/referencias`. Dá para decidir um item (botões do cartão) ou vários (marque os cartões, ou "selecionar os N do filtro"), e desfazer a última ação por 15 segundos.

As decisões vão para `decisoes.json`, na pasta da rede. **Re-coletar ou re-categorizar nunca apaga esse arquivo.** Decisão para um id que não está no inventário é ignorada. Nada é gravado antes da primeira decisão, e o app nunca altera o seu inventário nem a rede de origem (descartar aqui não remove o save do Instagram nem o vídeo da playlist).

## Onde ficam os dados

Tudo sob uma raiz, `BILHON_SOCIAL_DIR` (padrão `data/social`, ignorada pelo git):

```text
data/social/
├── instagram-contas/            contas que você segue
│   ├── contas.json
│   ├── nichos.json              (opcional)
│   ├── progresso.json           (opcional)
│   └── perfis/<username>/       (opcional)
│       ├── dossie.json
│       └── <miniatura>.jpg|.webp
├── instagram-saves/             posts salvos
│   ├── saves.json
│   ├── categorias.json
│   ├── thumbs/<code>.jpg        (capas, opcional)
│   └── decisoes.json            (o app escreve)
└── youtube-playlists/           playlists
    ├── playlists.json
    ├── videos.json
    ├── categorias.json
    └── decisoes.json            (o app escreve)
```

O que faltar deixa a tela correspondente vazia. Arquivo com JSON inválido ou sem a lista esperada vale como ausente. Leitura e gravação ficam **contidas** na raiz: link simbólico (ou junção) que aponte para fora dela é recusado. Veja [`seguranca.md`](seguranca.md).

## Instagram · saves

`data/social/instagram-saves/saves.json`:

```json
{
  "coletadoEm": "2026-01-15T12:00:00.000Z",
  "saves": [
    {
      "code": "exemplo00001",
      "pk": "1000000000000000001",
      "user": "conta-exemplo",
      "legenda": "Legenda de exemplo",
      "tipo": "foto",
      "slides": 1,
      "postadoEm": "2025-12-01T09:30:00.000Z",
      "url": "https://example.invalid/p/exemplo00001/",
      "thumb": "exemplo00001.jpg",
      "colecoes": ["Coleção de exemplo"],
      "categorias": ["design"],
      "palavras": ["exemplo", "capa"],
      "categoriaFonte": "legenda",
      "coletadoEm": "2026-01-15T12:00:00.000Z"
    }
  ]
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `code` | sim | shortcode do post: de 5 a 20 caracteres `A-Z a-z 0-9 _ -`. É a chave da triagem e o mesmo `code` de `/referencias`. Item sem `code` válido é ignorado |
| `pk`, `coletadoEm` | não | identificadores seus (o app não os usa na tela) |
| `user` | sim | conta de origem (vira o filtro "conta") |
| `legenda` | não | texto do post (a busca olha legenda, conta, palavras-chave e coleções) |
| `tipo` | não | `foto` (padrão), `carrossel` ou `reel` |
| `slides` | não | número de imagens do carrossel |
| `postadoEm` | não | ISO; mostrado como mês/ano |
| `url` | não | link de origem. Só `http(s)` vira link |
| `thumb` | não | `null` ou ausente: cartão sem capa. Com valor, a capa é lida de `thumbs/<code>.jpg` (o nome do arquivo é sempre o `code`) |
| `colecoes`, `categorias`, `palavras` | não | listas de texto. `categorias` são **ids** (o nome vem de `categorias.json`) |
| `categoriaFonte` | não | de onde veio a categoria (`legenda`, `conta`, `colecao`); informativo |

`categorias.json`: o nome e a contagem de cada categoria. A ordem e o `n` alimentam o resumo da página inicial (a categoria `outro` e as de `n` zero ficam de fora dele):

```json
{ "categorias": [{ "id": "design", "rotulo": "Design", "n": 1 }] }
```

Categoria cujo id não está aqui aparece com o próprio id. **O app não traz dicionário de categorias nem de palavras-chave**: a classificação vem inteira dos seus arquivos.

## Instagram · contas

`data/social/instagram-contas/contas.json` (uma **lista**):

```json
[
  {
    "username": "conta-exemplo",
    "nome": "Conta de Exemplo",
    "bio": "Bio de exemplo",
    "seguidores": 1500,
    "seguindo": 120,
    "posts": 80,
    "negocio": true,
    "categoria": "Categoria A",
    "privada": false,
    "nichos": ["design"],
    "rede": "instagram"
  }
]
```

`username` é obrigatório (conta sem ele é ignorada). `negocio` marca conta business/creator (filtro "só contas business"); `categoria` é a que o próprio Instagram atribuiu. `nichos` é multi-rótulo, em **ids**.

Opcionais:

- `nichos.json`: `{ "nichos": [{ "id": "design", "rotulo": "Design" }] }`. Sem ele, o id é "humanizado" (`tema_exemplo` vira "Tema exemplo").
- `progresso.json`: `{ "atualizadoEm": "…ISO…", "total": 10, "comBio": 4, "semBio": 6, "porNicho": { "design": 4 } }`. Sem ele, os totais saem das próprias contas.
- `perfis/<username>/dossie.json`: a análise de uma conta e os posts recentes dela:

```json
{
  "username": "conta-exemplo",
  "ingeridoEm": "2026-01-15T12:00:00.000Z",
  "analise": "Quem é a conta e por que importa para o seu benchmark.",
  "posts": [
    {
      "code": "exemplo00001",
      "caption": "Legenda de exemplo",
      "dataPost": "2025-12-01T09:30:00.000Z",
      "likes": 120,
      "comentarios": 8,
      "tipo": "imagem",
      "thumb": "exemplo00001.jpg"
    }
  ]
}
```

`tipo` do post: `imagem`, `video` ou `carrossel`. `thumb` é um arquivo na própria pasta do perfil (`.jpg`, `.jpeg` ou `.webp`); sem ele o cartão mostra só o ícone.

## YouTube · playlists

`data/social/youtube-playlists/playlists.json`:

```json
{
  "coletadoEm": "2026-01-15T12:00:00.000Z",
  "playlists": [
    {
      "id": "lista-exemplo",
      "nome": "Lista de exemplo",
      "url": "https://example.invalid/playlist/lista-exemplo",
      "visibilidade": "privada",
      "origem": "propria",
      "criador": null,
      "sistema": null,
      "esperados": 1,
      "coletados": 1
    }
  ]
}
```

`visibilidade`: `privada`, `nao-listada` ou `publica`. `origem`: `propria` (da sua conta) ou `salva` (de outro canal; `criador` mostra quem). `sistema` marca as listas que a plataforma cria sozinha (por exemplo `curtidos`, `assistir-depois`, `favoritos`) e as separa em "Listas do YouTube". `esperados` x `coletados` mostram quantos vídeos ficaram indisponíveis.

`data/social/youtube-playlists/videos.json`:

```json
{
  "videos": [
    {
      "id": "abcdefghij_",
      "titulo": "Vídeo de exemplo",
      "canal": "Canal de exemplo",
      "duracaoS": 600,
      "views": "1,2 mil",
      "publicado": "há 2 anos",
      "url": "https://example.invalid/watch/abcdefghij_",
      "playlists": ["lista-exemplo"],
      "categorias": ["design"],
      "palavras": ["exemplo"],
      "categoriaFonte": "titulo"
    }
  ]
}
```

`id` tem **11 caracteres** `A-Z a-z 0-9 _ -` (item sem id válido é ignorado) e é o mesmo `code` de um post `plataforma: "youtube"` em `/referencias`. `playlists` lista os `id` das playlists do vídeo; um vídeo em várias listas aparece uma vez. `categorias` são ids, com nome em `categorias.json` (mesmo formato do Instagram).

### Miniaturas do YouTube

Por padrão os cartões de vídeo e de playlist mostram um ícone no lugar da miniatura: **nada é pedido a servidor de terceiros**. Com `BILHON_SOCIAL_YT_MINIATURAS=1`, o navegador pede cada miniatura ao servidor de imagens do YouTube (`i.ytimg.com`, sem enviar referer) quando a aba abre.

## O que o app escreve

Só `decisoes.json`, em `instagram-saves/` e em `youtube-playlists/`, e só depois da primeira decisão. As rotas de escrita são `POST /api/mysocialmedia/instagram/decisao` e `POST /api/mysocialmedia/youtube/decisao`, com `{ "ids": ["…"], "status": "descartado" | "manter" | "referencia" | null }` (`null` desfaz; até 5000 ids). Corpo inválido volta `400` sem corpo. Elas passam pela checagem de origem cruzada descrita em [`seguranca.md`](seguranca.md).
