# Dados locais

Este template não traz dado nenhum. Aqui está o formato exato de cada arquivo que o app lê, para você trazer os seus.

Tudo fica em `data/`, na raiz do projeto (a pasta não existe no template e o git a ignora). Cada caminho tem um padrão e pode ser trocado por uma variável do [`.env.example`](../.env.example); caminho relativo vale a partir da pasta onde o app é iniciado. Os exemplos abaixo funcionam como estão: copie o conteúdo para o caminho indicado acima de cada bloco.

Nada é obrigatório. O que faltar deixa a tela correspondente vazia ou, em dois casos, mostra os dados de exemplo (primeira tabela).

## O que cada tela lê

| Tela | Fonte | Sem a fonte |
|---|---|---|
| Estante (`/estante`; a raiz `/` encaminha para ela), `/livro/<id>`, `/ler/<id>` | `data/livros/catalogo.json` e a pasta `data/livros/arquivos/` | catálogo ausente ou com JSON inválido: mostra os livros de exemplo (`fixtures/demo/`), **seja qual for o provider** |
| Referências (`/referencias`) | `data/referencias-instagram/referencias.json` | mostra os posts de exemplo (`fixtures/demo/referencias.json`), seja qual for o provider |
| Busca (`/buscar`) | o provider | `demo`: termos nos livros de exemplo. `local`: o índice `data/search/index.sqlite`, ver [`provider-local.md`](provider-local.md). `supabase`: a sua tabela, ver [`provider-supabase.md`](provider-supabase.md) |
| Grafo (`/grafo`) | `demo`: `fixtures/demo/grafo.json`. `local` e `supabase`: o SQLite `data/kg/livros-kg.sqlite` | `demo` sempre tem grafo. `local` ou `supabase` sem o SQLite: canvas vazio e **sem mensagem na tela** (a API `/api/graph` responde 503 com o motivo no campo `detalhe`), **sem cair no demo** |
| Ingestões (`/ingestoes`), `/colecao/<slug>` | `data/colecoes-external/**/_corpus_bge.sqlite` | lista vazia |
| Kanban (`/kanban`, `/kanban/backlog`) | `data/kanban/board.json` | board vazio com as colunas TO DO, DOING, DONE e CANCEL; o arquivo nasce na primeira gravação |
| Agente (`/agente`) | registro opcional e `data/agente/` (inclui `organizacao.json`, gerado pelo `npm run populate`, e a pasta `memoria/` do grafo, que é sua) | página vazia, ver [`agente-registro.md`](agente-registro.md) |
| Integrações (`/integracoes`, antes `/addons`) | `data/addons/manifest.json` | vazio, ver [`agente-registro.md`](agente-registro.md#add-ons-e-topologia) |
| Ontologia (`/ontologia`) | o arquivo YAML/JSON apontado por `BILHON_ONTOLOGIA_MANIFEST` | estado vazio com o formato esperado, ver [`ontologia.md`](ontologia.md) |
| Personas (aba de `/ingestoes`) | o JSON apontado por `BILHON_PERSONAS_JSON` | aba vazia que explica como popular, ver [`personas.md`](personas.md) |
| Minhas redes (`/mysocialmedia`) | `data/social/` (saves e contas do Instagram, playlists do YouTube) | telas vazias que dizem o que colocar, ver [`redes-sociais.md`](redes-sociais.md) |

Consequência de a estante e as referências não dependerem do provider: com `BILHON_KNOWLEDGE_PROVIDER=supabase` e sem catálogo, a estante continua mostrando os livros de exemplo ao lado de resultados reais de busca. Traga o seu catálogo (ou um `{ "livros": [] }`, veja abaixo) para a estante refletir só o que é seu.

## Caminhos e variáveis

| Recurso | Variável | Padrão |
|---|---|---|
| Catálogo de livros | `BILHON_CATALOGO` | `data/livros/catalogo.json` |
| Arquivos dos livros (e capas em `.covers/`) | `BILHON_LIVROS_DIR` | `data/livros/arquivos` |
| Domínio de cada livro | `BILHON_LIVROS_DOMINIOS` | `data/livros/livros-dominios.json` |
| Checksum de cada livro | `BILHON_LIVROS_HASHES` | `data/livros/livros-hashes.json` |
| Níveis editoriais (autolearning e estante) | `BILHON_NIVEIS` | `data/livros/niveis.json` |
| Sinopses por livro (estante e página do livro) | `BILHON_LIVROS_SINOPSES` | `livros-sinopses.json`, ao lado do `niveis.json` |
| Cache do autolearning (o app escreve) | `BILHON_AUTOLEARN_CACHE` | `data/livros/autolearn-cache.json` |
| Índice da busca do provider `local` | `BILHON_LOCAL_SEARCH_DB` | `data/search/index.sqlite` |
| Grafo (SQLite) | `BILHON_KG_DB` | `data/kg/livros-kg.sqlite` |
| Posições pré-calculadas do grafo | `BILHON_GRAPH_LAYOUT` | `data/kg/graph-layout.json` |
| Mapa de vídeos | `BILHON_YOUTUBE_MAP` | `data/kg/youtube-map.json` |
| Mapa de tarefas externas | `BILHON_CLICKUP_MAP` | `data/kg/clickup-map.json` |
| Coleções (stores SQLite) | `BILHON_COLECOES_EXT` | `data/colecoes-external` |
| Coleções que não devem aparecer na lista | `BILHON_COLECOES_EXCLUIR` | vazio (CSV de nomes de pasta) |
| Referências | `BILHON_REFERENCIAS_DIR` | `data/referencias-instagram` |
| Downloads de vídeo (o app escreve) | `BILHON_INBOX_SAVECLIP`, `BILHON_INBOX_YOUTUBE` | `data/inbox/SaveClip`, `data/inbox/YouTube` |
| Kanban | `BILHON_KANBAN_DIR` | `data/kanban` |
| Agente | `BILHON_AGENTE_DIR` e as demais do bloco Agente (inclui `BILHON_BRAIN_ORG_JSON` e `BILHON_BRAIN_STORE`, do grafo) | `data/agente` |
| Add-ons | `BILHON_ADDONS_DIR` | `data/addons` |
| Ontologia | `BILHON_ONTOLOGIA_MANIFEST` | ausente (a página nasce vazia; o arquivo precisa estar dentro de `BILHON_ROOT`) |
| Personas | `BILHON_PERSONAS_JSON` | ausente (a aba nasce vazia; o arquivo precisa estar dentro de `BILHON_ROOT`) |
| Topologia | `BILHON_TOPOLOGY_DIR` | `data/topology` |
| Minhas redes (raiz das três pastas) | `BILHON_SOCIAL_DIR` | `data/social` |
| Miniaturas do YouTube em Minhas redes | `BILHON_SOCIAL_YT_MINIATURAS` | desligado (`1` liga) |

Agente, add-ons e topologia só leem e gravam dentro de `BILHON_ROOT` (padrão: a pasta do projeto). Se você mudar `BILHON_ROOT`, as pastas dessas três funções (padrões acima ou as variáveis que as substituem) precisam ficar dentro da nova raiz.

O app lê SQLite pela linha de comando `sqlite3` (grafo e coleções): ela precisa estar no `PATH`. **No Windows ela não vem instalada**: baixe o pacote *sqlite-tools* em <https://www.sqlite.org/download.html>, extraia e ponha a pasta no `PATH` (abra um terminal novo e confira com `sqlite3 --version`). O macOS já traz a CLI; no Linux instale o pacote `sqlite3` se faltar. Sem ela, a lista de coleções fica vazia (sem aviso), `/colecao/<slug>` responde 404 e o grafo dos providers `local` e `supabase` fica vazio (com o `local`, a busca também deixa de funcionar); o modo demo, sem coleções, não precisa.

Dentro de um Megabrain, `npm run populate` gera a partir do conteúdo dele (só em `data/`) os arquivos da estante, das coleções, do grafo, da busca, do kanban, das referências, do Agente, das integrações e da topologia, e acerta as variáveis num bloco gerenciado do `.env.local`: veja [megabrain.md](megabrain.md#caminho-direto-npm-run-populate) e [provider-local.md](provider-local.md). O marcador `data/.populated.json` guarda o resultado da última população (`npm run populate:status`).

## Biblioteca

### `data/livros/catalogo.json`

Um **objeto** com a lista na chave `livros`. Exemplo mínimo completo:

`data/livros/catalogo.json`:

```json
{
  "livros": [
    {
      "id": "manual-de-exemplo",
      "titulo": "Manual de Exemplo",
      "arquivo": "manual-de-exemplo.txt",
      "formato": "txt",
      "tema": "Exemplos",
      "cluster": null,
      "origem": "minha-biblioteca",
      "sizeBytes": 87,
      "vizinhos": [],
      "proveniencia": { "origemPath": "meus-arquivos/manual-de-exemplo.txt", "motivo": "classificado à mão" }
    },
    {
      "id": "guia-de-exemplo",
      "titulo": "Guia de Exemplo",
      "arquivo": "guia-de-exemplo.md",
      "formato": "md",
      "tema": "Exemplos",
      "cluster": 1,
      "origem": "minha-biblioteca",
      "sizeBytes": 60,
      "paginas": null,
      "chunksTotal": 3,
      "vizinhos": [{ "id": "manual-de-exemplo", "titulo": "Manual de Exemplo", "score": 0.82 }],
      "proveniencia": { "origemPath": "meus-arquivos/guia-de-exemplo.md", "motivo": "classificado à mão" }
    }
  ]
}
```

Os dois arquivos do exemplo ficam em `data/livros/arquivos/`:

`data/livros/arquivos/manual-de-exemplo.txt`:

```text
Manual de Exemplo

Um texto curto para provar que o leitor abre o arquivo do catálogo.
```

`data/livros/arquivos/guia-de-exemplo.md`:

```markdown
# Guia de Exemplo

Outro texto curto, desta vez em Markdown.
```

| Campo | Tipo | Obrigatório | Uso |
|---|---|---|---|
| `id` | texto | sim | identificador único e estável; vai na URL (`/livro/<id>`), então use só letras, números e hífen |
| `titulo` | texto | sim | título exibido |
| `arquivo` | texto | sim | nome do arquivo dentro de `BILHON_LIVROS_DIR`. O caminho resolvido precisa ficar dentro dessa pasta; arquivo ausente: `/ler` mostra "Arquivo indisponível" (txt e md) e `/api/file/<id>` responde 404 |
| `formato` | `pdf`, `txt` ou `md` | sim | define o leitor: PDF usa o visualizador do navegador; txt e md são exibidos como texto |
| `tema` | texto | sim | filtro "tema" da estante e cor do placeholder de capa (veja "Capas" abaixo) |
| `cluster` | número ou `null` | sim | agrupamento de livros parecidos; `null` = sem grupo |
| `origem` | texto livre | sim | filtro "origem" da estante: o app agrupa pelos valores que você usar |
| `sizeBytes` | número | sim | tamanho do arquivo |
| `vizinhos` | lista | **sim** (pode ser `[]`) | livros parecidos: `{ id, titulo, score }` com `score` de 0 a 1. A página `/livro/<id>` quebra se o campo faltar |
| `proveniencia` | `{ origemPath, motivo }` | não | de onde veio o livro e por que foi classificado assim; mostrada na página do livro |
| `paginas` | número ou `null` | não | número de páginas (PDF); habilita a página estimada nas evidências do grafo |
| `chunksTotal` | número | não | quantos trechos do livro estão indexados; mostrado na página do livro |

O app **não valida** o catálogo. Três comportamentos para conhecer:

- arquivo ausente ou JSON inválido: cai nos livros de exemplo, em silêncio;
- JSON válido **sem a chave `livros`** (por exemplo, o array de `fixtures/demo/livros.json` copiado para cá): a estante e toda página que lista livros respondem com erro. As fixtures usam outro formato, mais simples, e servem só ao modo demo;
- `{ "livros": [] }`: estante vazia, sem cair no demo.

Na página do livro o app mostra o caminho do arquivo relativo ao projeto (ou só o nome do arquivo, quando `BILHON_LIVROS_DIR` fica fora da pasta do projeto). O catálogo é lido uma vez por processo: reinicie o app depois de editá-lo.

### Capas

A capa de um livro é o PNG `<BILHON_LIVROS_DIR>/.covers/<nome do arquivo sem extensão>.png` (para `manual-de-exemplo.txt`, `.covers/manual-de-exemplo.png`). O template não gera capas; sem o PNG a estante usa um placeholder tipográfico: o título sobre um degradê.

A cor do degradê vem do próprio texto do `tema`, sem lista fixa de temas: o app calcula um hash do texto e escolhe uma de 8 cores da paleta de `components/Capa.tsx`. O mesmo `tema` cai sempre na mesma cor, qualquer que seja o seu catálogo (dois temas diferentes podem coincidir na mesma cor). Um `tema` vazio ou igual a `Outros` usa um cinza neutro. Para trocar a paleta, edite a lista `PALETA` desse arquivo.

### Arquivos auxiliares (opcionais)

Todos são lidos junto com o catálogo. Arquivo ausente ou inválido é ignorado.

`data/livros/livros-dominios.json`:

```json
{ "porLivro": { "manual-de-exemplo": "operacoes", "guia-de-exemplo": "operacoes" } }
```

`data/livros/livros-hashes.json`:

```json
{ "porLivro": { "manual-de-exemplo": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" } }
```

- `livros-dominios.json`: o valor vira o filtro "domínio" da estante. A chave é o `id` do livro.
- `livros-hashes.json`: SHA-256 do arquivo de cada livro, usado só para mostrar o checksum.
- `niveis.json` (`BILHON_NIVEIS`): usado pelo autolearning para escolher o nível editorial das sugestões. Formato `{ "<arquivo do livro>": { "nivel": "referencia-academica" } }`, com `nivel` igual a `referencia-academica`, `profissional` ou `pratico-mercado`. Sem o arquivo, o nível é "desconhecido" e as sugestões saem no nível `profissional`. O template não traz gerador desse arquivo. A estante também lê dele o campo opcional `justificativa` (texto curto sobre o registro do livro), que aparece como sinopse quando não há uma sinopse melhor.
- `livros-sinopses.json` (`BILHON_LIVROS_SINOPSES`): sinopse curta de cada livro, mostrada no card da estante e na seção "Sobre" da página do livro, e usada pelo filtro de texto da estante. Formato `{ "porLivro": { "<arquivo do livro>": { "sinopse": "..." } } }`. Arquivo ausente ou inválido é ignorado. Para gerá-lo com um modelo local, veja `scripts/gerar-sinopses.mjs` em "Scripts opcionais".

### O que a estante e a página do livro mostram

Tudo abaixo é lido no servidor, sem rede, e cada fonte ausente deixa só o seu campo vazio (a página nunca dá erro por isso):

| Campo | Vem de |
|---|---|
| Sobre (sinopse) | `livros-sinopses.json`; sem ele, a `justificativa` do `niveis.json` |
| Registro editorial | `nivel` do `niveis.json` |
| Conceitos-chave e trechos em destaque | o SQLite do grafo (`BILHON_KG_DB`), ranqueados pela frequência dentro do livro. Exige a CLI `sqlite3` |
| Abertura e sumário | o próprio arquivo do livro: TXT/MD direto, PDF por `pdftotext` (as 30 primeiras páginas; sem `pdftotext` ficam vazios) |

O botão "prompt de estudo" copia um bloco de contexto (título, caminho do arquivo, tema, conceitos) para colar num agente. O caminho copiado é o exibido na tela: relativo à pasta do projeto, ou só o nome do arquivo quando o livro está fora dela.

## Grafo de conhecimento

Com os providers `local` e `supabase`, o grafo vem de um SQLite com três tabelas. Com o provider `demo`, vem de `fixtures/demo/grafo.json` e nada abaixo é necessário.

Você pode gerar o SQLite com o seu próprio processo, desde que ele tenha exatamente este esquema (é o que o app lê):

`grafo-exemplo.sql`:

```sql
CREATE TABLE nodes (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  tipo  TEXT NOT NULL
);
CREATE TABLE edges (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  src      TEXT NOT NULL,
  rel      TEXT NOT NULL,
  dst      TEXT NOT NULL,
  status   TEXT NOT NULL DEFAULT 'claimed',
  n_fontes INTEGER NOT NULL DEFAULT 1,
  peso     REAL NOT NULL DEFAULT 0.3
);
CREATE TABLE evidences (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  edge_id   INTEGER NOT NULL REFERENCES edges(id),
  livro     TEXT NOT NULL,
  chunk_id  TEXT NOT NULL,
  trecho    TEXT NOT NULL,
  confianca REAL NOT NULL
);
CREATE INDEX idx_evidences_edge ON evidences(edge_id);
CREATE INDEX idx_evidences_livro ON evidences(livro);
CREATE INDEX idx_edges_status ON edges(status);

INSERT INTO nodes (id, label, tipo) VALUES
  ('livro:manual-de-exemplo.txt', 'Manual de Exemplo', 'livro'),
  ('planejamento', 'Planejamento', 'conceito'),
  ('revisao', 'Revisão', 'conceito');
INSERT INTO edges (src, rel, dst, status, n_fontes, peso) VALUES
  ('planejamento', 'precede', 'revisao', 'confirmed', 2, 0.55),
  ('livro:manual-de-exemplo.txt', 'menciona', 'planejamento', 'claimed', 1, 0.4);
INSERT INTO evidences (edge_id, livro, chunk_id, trecho, confianca) VALUES
  (1, 'manual-de-exemplo.txt', 'manual-de-exemplo.txt#0', 'O planejamento precede a revisão.', 0.6);
```

Crie a pasta e carregue o exemplo. Os dois comandos abaixo funcionam em bash, PowerShell e `cmd.exe` (o `mkdir -p` não, porque o `cmd.exe` não entende a opção `-p`; por isso a pasta é criada pelo Node), desde que a CLI `sqlite3` esteja no `PATH` (no Windows, veja "Caminhos e variáveis"):

```bash
node -e "require('fs').mkdirSync('data/kg', { recursive: true })"
sqlite3 data/kg/livros-kg.sqlite ".read grafo-exemplo.sql"
```

| Tabela.coluna | Significado |
|---|---|
| `nodes.id` | id do nó. Conceito: um slug em minúsculas e sem acento (ex.: `trabalho-profundo`); o autolearning procura o conceito pelo id em minúsculas. Livro: `livro:` + o `arquivo` do catálogo, **exatamente** como está lá (é o que liga o nó à estante) |
| `nodes.tipo` | `conceito` ou `livro` (são os dois tipos que o painel de estatísticas conta) |
| `edges.status` | `claimed` (uma fonte), `confirmed` (duas ou mais fontes distintas) ou `disputed` (fontes em desacordo). O grafo filtra por esses três valores |
| `edges.rel` | rótulo livre da relação. `menciona` é reservado para "este livro cita este conceito" e não entra nas fontes de um conceito. Toda aresta cujo `src` começa por `livro:` some quando o filtro "livros" é desligado |
| `edges.n_fontes`, `edges.peso` | número de fontes distintas e peso da relação; ordenam as arestas quando o limite de 1500 é atingido (a interface mostra no máximo 1500 arestas) |
| `evidences.livro` | de onde veio o trecho: o `arquivo` de um livro do catálogo; `yt-<slug da coleção>:<documento>` para um documento de coleção; um nome começando por `cu-` para um item de tarefa (veja os mapas abaixo) |
| `evidences.chunk_id` | para livros, `<arquivo>#<n>`; o número depois do `#` escolhe a página estimada (veja a observação sobre `paginas`) |

Observação sobre a página estimada: o app só estima a página do trecho de um PDF quando o catálogo traz `paginas` e o `chunk_id` termina em `#0` (trecho a 20% do texto) ou `#1` (60% do texto). É a convenção do extrator `scripts/kg-extract.py`; se o seu processo numerar de outro jeito, a estimativa some, sem erro.

### Posições do grafo (opcional)

`data/kg/graph-layout.json` guarda as coordenadas pré-calculadas para o grafo abrir já organizado: `{ "<id do nó>": { "x": 12, "y": -40 } }`. Sem ele (ou cobrindo menos de 80% dos nós visíveis) o canvas simula as posições ao abrir, o que é mais lento em grafos grandes. Para gerá-lo a partir do SQLite:

```bash
node scripts/graph-layout.mjs
```

O arquivo é relido sozinho quando muda (não precisa reiniciar o app).

### Mapas de links (opcionais)

Ligam um documento citado nas evidências ao seu link externo. Sem o mapa, o grafo funciona e só omite o link.

**Vídeos** (`BILHON_YOUTUBE_MAP`): a chave é `yt-<slug da coleção>:<documento>` (com ou sem `.txt` no fim do documento) e o valor traz título, link e canal.

`data/kg/youtube-map.json`:

```json
{
  "yt-colecao-exemplo:abc123DEF45.transcript": {
    "titulo": "Título do vídeo",
    "url": "https://example.invalid/video/abc123DEF45",
    "canal": "colecao-exemplo"
  }
}
```

**O campo `canal` precisa ser igual ao slug da coleção**, isto é, o que vem depois de `yt-` na chave (para uma pasta em `data/colecoes-external/sources/<nome>/` é o próprio `<nome>`; para as pastas `dna/` o slug tem prefixo, veja a tabela em "Coleções"). Ele não é um nome de exibição: o painel de evidências do grafo mostra `▶ <canal>` e monta o botão "📖 ler transcript no trecho" com o endereço `/colecao/<canal>/<documento>`. Com um `canal` que não é o slug da coleção (por exemplo, `Canal de exemplo`), o botão leva a uma página 404. Se você não colocar o documento no mapa, o app usa o slug da própria chave e o botão funciona; o mapa só serve para dar título e link ao vídeo.

Quando o documento se chama `<id de 11 caracteres>.transcript` e não há entrada no mapa, o app monta o link do YouTube a partir desse id.

**Tarefas externas** (`BILHON_CLICKUP_MAP`): a chave é igual ao valor de `evidences.livro` (e ao id do nó, sem o `livro:`) e precisa começar por `cu-` para o painel do nó reconhecê-la. O painel e a rota `/api/clickup?doc=<chave>` usam:

`data/kg/clickup-map.json`:

```json
{
  "cu-tarefa-exemplo.md": {
    "url": "https://example.invalid/tarefa/1",
    "pasta": "Projeto",
    "lista": "Backlog",
    "nome": "Tarefa de exemplo",
    "status": "em andamento",
    "tags": ["exemplo"]
  }
}
```

### Scripts opcionais

O template inclui scripts para quem quiser gerar o grafo e as sinopses com um modelo local. Nenhum é necessário: o SQLite acima e os JSONs da estante podem vir de qualquer processo.

| Script | Para que serve | Precisa de |
|---|---|---|
| `python scripts/kg-extract.py` | monta o SQLite do zero: nós para o catálogo e relações extraídas de trechos das coleções e de PDFs. Se já existir um grafo, guarda uma cópia `livros-kg.pre-extract-AAAAMMDD-HHMMSS.bak.sqlite` ao lado do arquivo antes de recriar | Python 3.10 ou superior, Ollama com um modelo de texto (`KG_MODELO`, padrão `qwen2.5:7b`), `pdftotext` (opcional: sem ele os livros entram só como nós) |
| `python scripts/kg-extract.py --v2` | acrescenta ao SQLite existente as coleções que a primeira passada não amostrou, sem alterar o status nem o peso das relações que já existem. Cria uma única vez `livros-kg.v1.bak.sqlite` e nunca o sobrescreve | o mesmo |
| `python scripts/kg-normalize.py --embed`, `--report`, `--apply` | une conceitos escritos de formas diferentes ("Venda", "Vendas") por similaridade de embeddings. Guarda `livros-kg.pre-normalize.bak.sqlite`, o cache `concept-embeddings.npz`, `aliases.json` e `normalize-report.json` ao lado do SQLite | Python 3.10 ou superior, `pip install numpy`, Ollama com o modelo de embeddings (`BILHON_EMBED_MODEL`, padrão `bge-m3`) |
| `node scripts/graph-layout.mjs` | gera o `graph-layout.json` | Node (já instalado) e a CLI `sqlite3` |
| `node scripts/gerar-sinopses.mjs [--limite N] [--refazer]` | gera `livros-sinopses.json` com uma sinopse de 2 a 3 frases por livro do catálogo, a partir do começo do texto. Só gera o que ainda não tem sinopse; grava a cada livro | Ollama com um modelo de texto, informado em `BILHON_SINOPSES_MODEL` (**em branco: o script não gera nada e termina sem erro**), `pdftotext` para PDFs (livros sem texto são pulados) |

Pontos de atenção do `kg-extract.py`:

- ele lê **sempre** `data/livros/catalogo.json`, `data/livros/arquivos/` e `data/colecoes-external/sources/` (não obedece `BILHON_CATALOGO`, `BILHON_LIVROS_DIR` nem `BILHON_COLECOES_EXT`). Aceita o catálogo no formato `{ "livros": [...] }` ou como array simples;
- **o catálogo é obrigatório** na primeira passada (sem `--v2`): se `data/livros/catalogo.json` não existir, o script termina com `FileNotFoundError`, antes de mexer no grafo. Para uma base sem livros, crie o arquivo com `{ "livros": [] }`. Cada livro precisa ter `arquivo` e `titulo`. A passada `--v2` não lê o catálogo, mas exige que o SQLite do grafo já exista (rode a primeira passada antes);
- só amostra as coleções da pasta `sources/`. Para limitar a algumas, preencha `BILHON_KG_COLECOES`;
- os relatórios (`extract-report.json`, `normalize-report.json`) e os backups ficam na mesma pasta do SQLite;
- os scripts leem o ambiente do terminal, não o `.env.local`.

## Coleções

Cada pasta com um store SQLite vira uma "coleção" em `/ingestoes` e `/colecao/<slug>`. O app procura `_corpus_bge.sqlite` em três lugares de `data/colecoes-external/`:

| Pasta | `slug` da coleção | Observação |
|---|---|---|
| `sources/<nome>/` | `<nome>` | tipo "playlist" |
| `dna/sources/<nome>/` | `dna-src-<nome>` | tipo "playlist"; aparece com o rótulo "(DNA)" |
| `dna/persons/<nome>/` | `dna-<nome>` | tipo "pessoa"; aparece com o rótulo "(DNA)" |

Store sem nenhum trecho é ignorado. Se você não precisa da distinção entre as três pastas, use só `sources/`. O tipo também é inferido do nome da pasta: começando por `CLICKUP` vira tipo "clickup" e contendo `CURSO` vira "cursos"; é uma convenção fixa do código (`lib/colecoes.ts`), sem variável para mudar. A lista é guardada em cache por 60 segundos.

O store precisa ter uma tabela `chunks` com estas colunas, e **só estas três são lidas**:

`colecao-exemplo.sql`:

```sql
CREATE TABLE chunks (
  chunk_id TEXT,
  video    TEXT,
  text     TEXT
);
INSERT INTO chunks (chunk_id, video, text) VALUES
  ('abc123DEF45.transcript#0', 'abc123DEF45.transcript', 'Texto do primeiro documento de exemplo, em um único trecho.'),
  ('nota-de-exemplo#0', 'nota-de-exemplo', 'Texto do segundo documento de exemplo, em um único trecho.');
```

```bash
node -e "require('fs').mkdirSync('data/colecoes-external/sources/colecao-exemplo', { recursive: true })"
sqlite3 data/colecoes-external/sources/colecao-exemplo/_corpus_bge.sqlite ".read colecao-exemplo.sql"
```

(Mesmos comandos do exemplo do grafo: funcionam em bash, PowerShell e `cmd.exe`, com a CLI `sqlite3` no `PATH`.)

| Coluna | Uso |
|---|---|
| `video` | nome do documento (a lista de documentos da coleção agrupa por ele). Se começar por `dna-`, é marcado como "DNA". Se for `<id de 11 caracteres>.transcript`, o app deduz o link do YouTube |
| `chunk_id` | precisa terminar em `#<número>`: a ordem dos trechos na leitura completa do documento é pelo número depois do último `#` |
| `text` | o trecho. **Sobreposição:** ao remontar o texto completo, o app descarta as 50 primeiras palavras de todo trecho depois do primeiro, porque assume trechos de 400 palavras com 50 repetidas do trecho anterior. Se os seus trechos não se sobrepõem, o texto remontado perde 50 palavras por trecho: grave-os com essa sobreposição ou aceite a perda |

Arquivos opcionais ao lado do SQLite, na mesma pasta:

- `.provenance.json`: `{ "tier": "A" }`. O valor de `tier` vira o filtro "tier (proveniência)" da lista; sem o arquivo aparece `?`.
- `.ontology.json`: `{ "domain": "operacoes" }`. A primeira palavra em minúsculas vira o domínio da coleção (`engines(2)` vira `engines`). O app procura primeiro em `data/colecoes-external/inbox/<nome da pasta>/.ontology.json` e depois ao lado do SQLite.

O título de cada documento vem do `youtube-map.json` (chave `yt-<slug>:<documento>`, com ou sem `.txt`); sem entrada, usa o nome do documento sem a extensão `.transcript`.

## Referências

`data/referencias-instagram/` guarda posts salvos: um índice e as mídias de cada post. O template não traz coletor: você produz o índice.

`data/referencias-instagram/referencias.json`:

```json
{
  "fonte": "meus-salvos",
  "extraidoEm": "2026-01-15T12:00:00.000Z",
  "colecoes": [{ "id": "produtividade", "nome": "Produtividade", "n": 1 }],
  "posts": [
    {
      "code": "exemplo001",
      "user": "conta-exemplo",
      "caption": "Legenda de exemplo",
      "igUrl": "https://example.invalid/p/exemplo001/",
      "dir": "exemplo001",
      "images": ["01.jpg"],
      "videoIdx": [],
      "colecoes": ["Produtividade"],
      "plataforma": "instagram"
    }
  ]
}
```

| Campo | Obrigatório | Uso |
|---|---|---|
| `fonte`, `extraidoEm` | sim | mostrados sob o título da página (no modo demo a página diz "dados de exemplo") |
| `colecoes[]` | sim | filtro de coleções: `nome` e quantidade `n` de posts. O filtro compara `colecoes[].nome` com o texto de `posts[].colecoes` (`id` é só identificador) |
| `posts[].code` | sim | identificador único do post; chave dos arquivos auxiliares |
| `posts[].user`, `caption`, `igUrl` | sim | perfil, legenda e link de origem (o botão de abrir leva a `igUrl`) |
| `posts[].dir` | sim | nome da subpasta do post dentro de `data/referencias-instagram/`, sem barras |
| `posts[].images` | sim | nomes dos arquivos de imagem em `<dir>/`, sem barras. Cada nome é uma mídia, na ordem; o primeiro é a capa |
| `posts[].videoIdx` | sim (pode ser `[]`) | posições, contando de 1, das mídias que são vídeo; nelas a imagem serve de capa |
| `posts[].colecoes` | sim | nomes das coleções do post |
| `posts[].plataforma` | não | `instagram` (padrão), `youtube`, `linkedin`… filtra por fonte; `youtube` usa proporção 16:9 e a ficha em `youtube` (`videoId`, `canal`, opcionais `canalNome`, `duracao`, `publicadoEm`, `views`) |
| `posts[].dominio` | não | filtro "domínio" |
| `posts[].videos` | não | vídeos já baixados: `[{ "idx": 1, "file": "01.mp4" }]`, com o arquivo em `<dir>/` |
| `posts[].preview` | não | URL (http/https) de uma réplica local do site, para posts de `plataforma: "sites"`: o card ganha um botão "abrir clone local" e o link de `igUrl` passa a ser o botão secundário |
| `posts[].paginas` | não | cadastro de produto com várias páginas num card só: `[{ "titulo": "...", "igUrl": "...", "images": ["01.jpg"], "preview": "...", "prompt": "...", "codigo": ["caminho/arquivo.tsx"] }]`. Cada `images` cita nomes que existem em `posts[].images`; o card aberto agrupa as imagens por página, com botões para copiar o prompt de reuso e os caminhos do código, abrir o clone e abrir a página original. Imagem que nenhuma página cita vai para um grupo "outras"; post sem `paginas` abre como sempre |

Os filtros da página (fonte, domínio, coleções, perfil, busca, favoritos, "o que não fazer" e quantas páginas de cards já foram carregadas) ficam na URL, por exemplo `/referencias?fonte=youtube&col=Produtividade&pag=2`: o link reabre o mesmo recorte e pode ser compartilhado. `?fav=1` continua valendo.

Se uma ingestão gravar `anotacao` ou `promptReverso` dentro do próprio `referencias.json` e a API também gravar nos arquivos `anotacoes.json` / `prompts-reversos.json`, vale o mais novo (`verificadoEm` na anotação, `geradoEm` no prompt). Sem data comparável em algum dos lados, vale o arquivo da API.

As imagens são servidas com o tipo real do arquivo, lido dos primeiros bytes (um `.heic` que na verdade é JPEG abre normalmente), e o nome do arquivo pode conter reticências (`legenda....jpg`). As imagens ficam em `data/referencias-instagram/<dir>/<arquivo>`. Miniaturas são opcionais: `<dir>/.thumbs/<arquivo>.webp` (o nome inclui a extensão original); sem ela o app serve a imagem original.

O app também grava e lê nessa pasta: `favoritos.json`, `antipatterns.json` (posts marcados como "o que não fazer"), `anotacoes.json` e `prompts-reversos.json`. Você não precisa criá-los: a primeira gravação cria também a própria pasta `data/referencias-instagram/` (ou a de `BILHON_REFERENCIAS_DIR`) quando ela não existe, mesmo sem `referencias.json`. Opcionais, para você alimentar: `hashes.json` (`{ "porPost": { "<code>": { "checksum": "..." } } }`) e `videos-urls.json` (`{ "<code>": { "user": "...", "vids": [{ "idx": 1, "url": "https://..." }] } }`, usado pelo botão "baixar vídeo" de posts que não são do YouTube).

No modo demo (sem `referencias.json`), o app grava `favoritos.json` normalmente, mas a lista de favoritos mostrada vem vazia a cada carregamento: a estrela marcada não fica visível depois de recarregar a página. Antipatterns, anotações e prompts reversos continuam sendo lidos.

### Gravações por API

Na interface você só marca favorito, marca "o que não fazer" e baixa vídeo. **Anotações e prompts reversos não têm tela de edição**: quem os escreve é você, um script ou um agente seu, pelos endpoints `anotar` e `prompt-reverso` abaixo. O app não chama nenhum modelo; ele guarda o que receber e mostra na galeria.

| Endpoint | Corpo (JSON) | Grava em | Resposta |
|---|---|---|---|
| `POST /api/referencias/favorito` | `{ "code": "...", "undo": true }` (`undo` opcional: desmarca) | `favoritos.json` | 200 com `{ "ok": true, "favoritos": {...} }` |
| `POST /api/referencias/antipattern` | `{ "code": "...", "motivo": "...", "undo": true }` (`motivo` e `undo` opcionais) | `antipatterns.json` | 200 com `{ "ok": true, "antipatterns": {...} }` |
| `POST /api/referencias/anotar` | `{ "code": "...", "anotacao": {...} }` (abaixo) | `anotacoes.json` | 200 com `{ "ok": true }` |
| `POST /api/referencias/prompt-reverso` | `{ "code": "...", "promptReverso": {...} }` (abaixo) | `prompts-reversos.json` | 200 com `{ "ok": true }` |

Em todos, `code` é o `posts[].code` do post (texto não vazio; o app não confere se o post existe). Corpo inválido volta como **400 sem corpo de resposta**; falha ao gravar, **500 sem corpo**. Uma nova gravação para o mesmo `code` substitui a anterior.

**`anotacao`** (a galeria mostra a `descricao` sob o post; o `texto` aparece no balão ao passar o mouse):

| Campo | Obrigatório | Regra |
|---|---|---|
| `tipo` | sim | `"estudo"` ou `"visual"` |
| `descricao` | sim | texto de 1 a 4000 caracteres |
| `texto` | não | texto livre (transcrição do texto da imagem) |
| `fontes` | não | lista de textos (por exemplo, links) |
| `verificadoEm` | não | texto livre (por exemplo, uma data) |

**`promptReverso`** (a receita para recriar a imagem; a galeria mostra no post um bloco "prompt reverso", com botão para copiar o `prompt` e, ao abrir, o texto e a análise):

| Campo | Obrigatório | Regra |
|---|---|---|
| `prompt` | sim | texto de 1 a 8000 caracteres |
| `negativo` | não | até 4000 caracteres |
| `proporcao` | não | até 40 caracteres (por exemplo, `"4:5"` ou `"16:9"`) |
| `por` | não | até 120 caracteres: quem escreveu |
| `geradoEm` | não | até 40 caracteres; sem ele o app grava o momento da chamada |
| `analise` | não | objeto com **pelo menos um** destes campos de texto (até 2000 caracteres cada): `composicao`, `zonaSegura`, `tipografia`, `cor`, `luz`, `sujeito`, `textoNaImagem`, `gancho` |

Campos que não estão nas tabelas são descartados. Exemplo, com a CLI `curl` e o corpo em um arquivo (no PowerShell escreva `curl.exe`, porque `curl` é um apelido de outro comando):

`anotacao.json`:

```json
{
  "code": "exemplo001",
  "anotacao": { "tipo": "visual", "descricao": "Capa com texto grande sobre fundo claro." }
}
```

```bash
curl -X POST http://127.0.0.1:3300/api/referencias/anotar -H "Content-Type: application/json" --data-binary @anotacao.json
```

O `curl` não envia `Origin` nem `Sec-Fetch-Site`, então passa pela checagem de origem cruzada descrita em [`seguranca.md`](seguranca.md); com o app atrás de um proxy ou túnel, valem as regras daquele documento.

### Baixar vídeo

Baixar vídeo, quando você clica no botão **vídeo** de uma mídia que é vídeo:

- **posts do YouTube** (`plataforma: "youtube"`) usam o `yt-dlp`, que precisa estar instalado; o formato é `BILHON_YT_FORMAT` (padrão: teto de 720p);
- **os demais** baixam a URL registrada em `videos-urls.json`; URLs assinadas expiram;
- o arquivo vai para `data/inbox/...` e é ligado por **hardlink** à pasta do post: `data/inbox` e `data/referencias-instagram` (ou as variáveis que as substituem) precisam estar no **mesmo volume**.

O botão **vídeo** só existe no bloco expandido de um post que tem imagens (é a imagem que serve de capa do vídeo). No modo demo (sem `referencias.json`) os 15 posts de exemplo não têm imagens: cada um aparece como um bloco com a legenda, os que têm vídeo mostram o ícone de reprodução, e o bloco expandido fica vazio. Por isso **o botão de baixar vídeo não é alcançável pela interface no modo demo**. Se você chamar `POST /api/referencias/baixar-video` (corpo `{ "code": "...", "idx": 1 }`) com o app sem `referencias.json`, a resposta é um 502 com `{ "ok": false, "erro": "vídeo indisponível no modo demo" }`.

Os links do modo demo apontam para o domínio reservado `example.invalid` (o botão de abrir a origem não leva a lugar nenhum).

## Kanban

O app cria e mantém tudo em `data/kanban/` (`BILHON_KANBAN_DIR`); você só precisa de arquivos aqui para importar um board existente.

| Caminho | Conteúdo |
|---|---|
| `board.json` | o board inteiro: colunas, limites, contadores e cards |
| `backups/board-AAAAMMDD.json` | cópia do board antes da primeira alteração de cada dia; guarda os 14 mais recentes. **Não é backup**: está no mesmo disco; copie `board.json` para outro lugar se o conteúdo importa |
| `imagens/<id do card>/`, `audio/<id do card>/` | anexos enviados pela interface: imagem PNG, JPEG, WebP ou GIF até 10 MB; áudio até 25 MB. O card precisa existir (404 caso contrário) |
| `aprendizados/<id do card>.md` | resumo opcional gravado ao concluir um ticket |

Formato mínimo de `board.json` (o app preenche o que faltar no nível do board; um card precisa trazer todos os campos abaixo):

`data/kanban/board.json`:

```json
{
  "atualizadoEm": "2026-01-15T12:00:00.000Z",
  "colunas": [
    { "id": "todo", "rotulo": "TO DO" },
    { "id": "doing", "rotulo": "DOING" },
    { "id": "done", "rotulo": "DONE" },
    { "id": "cancel", "rotulo": "CANCEL" }
  ],
  "wipLimites": { "doing": 1 },
  "contadores": { "ingest": 0, "clone": 0, "autolearning": 0, "feature": 1, "melhoria": 0, "bug": 0, "infra": 0, "outro": 0 },
  "cards": [
    {
      "id": "FEA-1",
      "titulo": "Card de exemplo",
      "descricao": "Descrição em Markdown.",
      "tipo": "feature",
      "prioridade": "media",
      "projeto": "geral",
      "coluna": "todo",
      "ordem": 0,
      "responsavel": null,
      "tags": [],
      "origem": { "canal": null, "pedidoOriginal": null, "solicitadoPor": null },
      "ingestao": { "fonteTipo": [], "fonteUrl": [], "fontePath": [], "bucket": null, "pessoaAutor": null },
      "links": [],
      "vinculos": [],
      "audios": [],
      "imagens": [],
      "checklist": [],
      "historico": [],
      "execucao": null,
      "criadoEm": "2026-01-15T12:00:00.000Z",
      "atualizadoEm": "2026-01-15T12:00:00.000Z",
      "concluidoEm": null
    }
  ]
}
```

- O prefixo do `id` segue o `tipo`: `ING` (ingest), `CLN` (clone), `LRN` (autolearning), `FEA` (feature), `MEL` (melhoria), `BUG` (bug), `INF` (infra) e `TSK` (outro). O formato é três letras maiúsculas, hífen e número.
- `projeto` precisa ser um dos aceitos: `geral` e `outro` por padrão, ou a lista de `NEXT_PUBLIC_KANBAN_PROJETOS`.
- Edite o `board.json` à mão só com o app parado: a cada alteração o app lê e regrava o arquivo inteiro, e uma edição simultânea se perde.
- **Board corrompido** (JSON inválido, arquivo truncado): o app se recusa a escrever, para não apagar nada. As páginas do Kanban mostram a tela **Essa página falhou ao carregar**. Em `npm run dev` ela traz a mensagem completa (`board.json ilegível …`); em produção (`npm run start`) o Next a troca por um texto genérico e um `digest`, e a mensagem completa fica no terminal onde o servidor roda (procure a linha com `"evento":"board_corrompido"` e o erro com o mesmo `digest`). A tela também traz, nos dois casos, a orientação de não apagar nada e de restaurar a cópia. As rotas `/api/kanban…` respondem `503` com a mensagem em `erro` e `codigo: "board_corrompido"`. Para recuperar, copie o `backups/board-AAAAMMDD.json` mais recente por cima de `board.json` (ou restaure a sua própria cópia) e recarregue.
- Ao criar um card (`POST /api/kanban`) o corpo é conferido campo a campo: `titulo` e `tipo` são obrigatórios, campo desconhecido e `historico` são recusados, `projeto` precisa ser um dos aceitos e cada link precisa começar por `http://` ou `https://`. Erro volta como 400 com a mensagem do campo.

### Tags que mudam o comportamento

As tags são texto livre (no editor do card, separadas por vírgula) e quase todas só aparecem como etiqueta no card. Estas são lidas pelo código, sem diferenciar maiúsculas de minúsculas (`lib/kanbanLote.ts`):

| Tag | Efeito |
|---|---|
| `blocked:<texto>` | marca o ticket como bloqueado; o texto depois dos dois-pontos é livre (por exemplo, o motivo) |
| `blocked-by:<ID>` | bloqueado por outro ticket (por exemplo, `blocked-by:FEA-3`). Além de bloquear este ticket, conta como "destrava" para o ticket `<ID>` (bônus abaixo) |
| `gate:humano` ou `gate:human` | bloqueado até uma decisão humana. Só vale a tag inteira, sem texto depois |
| `bloqueado` | bloqueado (tag solta, formato antigo) |
| `size:p`, `size:s`, `size:m`, `size:g` ou `size:l` | tamanho estimado; entra no peso de esforço |
| `nivel:subtask`, `nivel:task`, `nivel:bug`, `nivel:incident`, `nivel:story` ou `nivel:epic` | nível do trabalho; entra no peso de esforço |

"Bloqueado" é só uma marca para a ordem do lote: o app não esconde o card, não impede movê-lo e não tira a tag sozinho quando o ticket citado em `blocked-by:` vai para DONE (remova a tag à mão). Um valor de `size:` ou `nivel:` que não esteja na lista vale como se a tag não existisse. Quando há mais de uma tag `size:` ou `nivel:`, vale a primeira.

Duas tags têm efeito só na criação por API (aqui o texto precisa ser exatamente `decisão` ou `urgente`, em minúsculas, e os prefixos de título em maiúsculas), quando o corpo do `POST /api/kanban` **não traz** o campo `execucao` (a interface sempre manda esse campo, então não passa por aqui): `decisão` (ou título começando por `[DECISÃO]`) classifica o ticket como `humano`, e `urgente` (ou título começando por `[URGENTE]`) como `agente + humano` (60% agente), ou `humano` se o texto trouxer algum sinal de dependência humana. Sem nenhuma dessas marcas, o ticket nasce `agente`, ou `agente + humano` (50%) se o título ou a descrição trouxerem uma das frases de dependência humana do código (por exemplo, "requer login", "aprovação humana") ou uma das que você listar em `BILHON_KANBAN_SINAIS_HUMANO`. O executor registrado num ticket `humano` vem de `BILHON_KANBAN_EXECUTOR_HUMANO`, se preenchida.

### Copiar tickets para o terminal

Há três botões de cópia, todos no navegador (usam a área de transferência):

- o ícone de copiar em cada **card** copia aquele ticket;
- o ícone de copiar no cabeçalho de cada **coluna** copia os tickets visíveis dela, respeitando o filtro ativo;
- o botão **copiar N pro terminal** (na linha de contagem acima do board; só aparece com pelo menos um ticket pendente) copia os `N` tickets **pendentes**, isto é, fora das colunas `done` e `cancel`, que passam pelo filtro ativo.

O texto copiado é um bloco só: um cabeçalho (`Kanban — lote de N tickets`, mais os critérios do filtro, e a frase "Executa um de cada vez, na ordem abaixo.") seguido do prompt de cada ticket, separados por `---`. O prompt de um ticket traz o id e o título, a descrição, o tipo, a prioridade, o projeto, a execução, as tags e o responsável. Com mais de 10 tickets, os botões de coluna e o global abrem um menu de quantidade (10, 20, 30, 40 ou um número digitado) e copiam os primeiros nessa ordem. O aviso na tela confirma quantos foram copiados e, a partir de 1500 caracteres, mostra o tamanho e uma estimativa de tokens (cerca de 4 caracteres por token).

A ordem do lote é por pontuação, **do menor para o maior**, para que os tickets mais prontos para rodar sozinhos (sem bloqueio, sem depender de gente, pequenos) venham primeiro:

```
pontuação = bloqueio + 2 × dependência humana + esforço − bônus de destravar
```

| Termo | Valor |
|---|---|
| bloqueio | 20 se o ticket tem qualquer tag de bloqueio da tabela acima; senão 0. Domina os outros termos, que somam no máximo 10 |
| dependência humana | pelo campo **execução** do card: `agente` = 0, `agente + humano` = 1, `humano` = 2, `sem definição` = 1 |
| esforço | peso de `size:` + peso de `nivel:`. `size:`: `p` e `s` = 0, `m` = 2, `g` e `l` = 3. `nivel:`: `subtask`, `task` e `bug` = 0, `incident` = 1, `story` = 2, `epic` = 3. Tag ausente ou com valor desconhecido = 1 |
| bônus de destravar | conta quantos cards do board inteiro (de qualquer coluna, não só os do filtro) trazem `blocked-by:<ID deste ticket>`: 1 ou 2 cards = −1,5; 3 ou mais = −3 |

Em caso de empate, vem primeiro quem destrava mais tickets e, depois, o de maior prioridade (urgente, alta, média, baixa).

### Definição de Pronto

Cada tipo de card tem uma lista de critérios, a definição de pronto (DoD), em `DOD_POR_TIPO` no arquivo `lib/types.ts`. No template ela é:

| Tipo | Itens exigidos para entrar em DONE |
|---|---|
| `bug` | causa raiz registrada na descrição; teste que falha antes e passa depois; suíte relevante verde; **commit + push + PR aberto + merge feito** |
| `feature` | critério de aceite verificado item a item; teste cobrindo o critério de aceite; suíte relevante verde; **commit + push + PR aberto + merge feito** |
| `melhoria` | ganho medido antes/depois (ou por que não é mensurável); evidência de não-regressão; **commit + push + PR aberto + merge feito** |
| `infra` | mudança validada no ambiente alvo; rollback documentado; gate de deploy aprovado quando toca deploy ou exposição; **commit + push + PR aberto + merge feito** |
| `ingest` | contagem conferida: esperado × processado; proveniência registrada por item; artefatos gravados no destino configurado; amostra verificada à mão |
| `clone` | camadas do clone geradas e validadas; recall provado pelo fluxo padrão; dossiê e cópias de referência reconciliados |
| `autolearning` | ciclo rodado com métrica antes/depois; veredito registrado: keep ou discard |
| `outro` | resultado registrado na descrição do card; próximo passo definido (ou explicitamente nenhum) |

Como isso funciona:

- **O card novo da interface nasce com o tipo `melhoria`.** Por isso ele já vem com três itens no checklist, entre eles o de commit, push, PR e merge. Mudar o tipo no editor acrescenta os itens do novo tipo. Pela API, `POST /api/kanban` exige o `tipo` e injeta os itens do tipo informado.
- Os itens da DoD voltam sozinhos, desmarcados, se forem apagados do checklist (valem para cards fora de `done` e `cancel`), e no editor aparecem com um cadeado: não dá para removê-los. O casamento é pelo **texto exato**.
- Mover para a coluna de id `done` exige que todos os itens da DoD do tipo estejam marcados. O servidor confere contra `DOD_POR_TIPO`, e não contra o que está gravado no card: um card antigo, de checklist vazio, é medido do mesmo jeito. Sem isso, a resposta é **409** com `{ "erro": "DoD incompleta: X de Y itens", "faltando": [...] }`, e a interface mostra o aviso com o que falta. Mover para `cancel` é livre. O gate olha só a coluna de id `done`.
- Marcar o último item do checklist de um card leva o card sozinho para DONE.
- O board só **avança**: um card não volta para uma coluna anterior (a API responde `409`). Por isso o "Sim, popular tudo" do primeiro uso, que move o card para DOING, não se desfaz pela tela.
- A única saída sem marcar os itens é a API, com um motivo: `PATCH /api/kanban/<id>` com `{ "coluna": "done", "index": 0, "override": "motivo" }`. O motivo (não pode ser vazio) fica no histórico do card como `done SEM DoD — <motivo>`. A interface não tem esse botão.

Para mudar o fluxo, edite `DOD_POR_TIPO` em `lib/types.ts` (o mesmo arquivo vale para o navegador e para o servidor: reinicie o app, ou refaça o `npm run build` em produção):

- troque os textos pelos critérios do seu time;
- para quem não trabalha com pull request, apague `ITEM_GATE_MERGE` das listas (ou troque o texto da constante, `"commit + push + PR aberto + merge feito"`);
- a lista vazia (`[]`) desliga o gate daquele tipo;
- os cards que já existem mantêm no checklist os itens antigos, que deixam de ser exigidos (e passam a poder ser removidos no editor). Como o casamento é por texto, um texto novo conta como um item novo e entra desmarcado na próxima gravação do card;
- o teste `lib/kanban-dod.test.ts` confere que todo tipo tem pelo menos um item e que o item de merge está nos tipos `bug`, `feature`, `melhoria` e `infra` e fora de `ingest` e `clone`. Ajuste-o junto, ou `npm test` falha.

O `board.json` de exemplo acima tem um card `feature` com checklist vazio: na primeira gravação desse card, os quatro itens da DoD de `feature` entram no checklist, e ele só vai para DONE depois de marcados.

## Minhas redes

Saves e contas do Instagram, playlists e vídeos do YouTube, com a triagem: formatos dos arquivos, pastas e o que o app grava em [`redes-sociais.md`](redes-sociais.md).

## Agente, add-ons e topologia

Formatos do registro de entidades, do estado do Agente, do manifesto de add-ons e do extrato de topologia: [`agente-registro.md`](agente-registro.md).

## O que o app escreve

Para você saber o que pode aparecer em `data/` sem ter criado:

| Arquivo | Quando |
|---|---|
| `data/kanban/**` | ao criar ou alterar cards, anexar mídia, concluir um ticket |
| `data/primeiro-uso.json` | ao responder a pergunta de primeiro uso dentro de um Megabrain (veja [megabrain.md](megabrain.md)), ou por um `npm run populate` completo em que todos os módulos terminaram ok (estado `aceito`, sem card, respondido no fim da população); apague o arquivo para a pergunta voltar |
| `data/agente/favoritos.json`, `ocultos.json` | ao marcar estrela ou lixeira na página Agente |
| `data/referencias-instagram/{favoritos,antipatterns,anotacoes,prompts-reversos}.json` | ao favoritar, marcar, anotar ou registrar um prompt reverso (a primeira gravação cria a pasta, se ela não existir) |
| `data/referencias-instagram/referencias.json` | ao baixar um vídeo (acrescenta `videos` ao post) |
| `data/inbox/**` | ao baixar um vídeo |
| `data/social/{instagram-saves,youtube-playlists}/decisoes.json` | ao descartar, manter ou pôr na fila uma decisão em Minhas redes (nada é criado antes da primeira decisão) |
| `data/livros/autolearn-cache.json` | ao gerar sugestões de autolearning. Se a gravação falhar, as sugestões são entregues mesmo assim, só não ficam guardadas |
