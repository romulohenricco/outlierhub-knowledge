# Provider local (busca FTS5 + grafo em arquivos)

O provider `local` é a terceira implementação de `KnowledgeProvider` (`lib/providers/types.ts`). Ele serve a **busca** e o **grafo** só com arquivos de `data/`, sem Supabase, sem Ollama e sem nenhuma chamada de rede. É o provider pensado para o conteúdo do mega-brain populado por `npm run populate`.

| | `local` |
|---|---|
| Busca | índice FTS5 do SQLite (`data/search/index.sqlite`), ranking bm25, **lexical** |
| Grafo | o mesmo do provider `supabase`: o SQLite `data/kg/livros-kg.sqlite` (reuso por composição, sem reescrever; inclui o `foco` do deep-link `?focus=`, a topologia e o impacto) |
| Rede / serviços | nenhum |
| Código | `lib/providers/local/` (`index.ts`, `search.ts`) e `scripts/populate/busca.mjs` |

## Como ligar

```bash
npm run populate -- --yes             # gera data/search/index.sqlite (e o resto de data/)
```

O último módulo do populate (`ambiente`) grava `BILHON_KNOWLEDGE_PROVIDER=local` no bloco gerenciado do `.env.local`, **só** quando o índice ficou utilizável (presente, legível pela CLI `sqlite3`, da versão certa e com trechos). Do contrário a variável fica de fora e o app abre no modo demo. Se você já definiu `BILHON_KNOWLEDGE_PROVIDER` fora do bloco, com valor (por exemplo `supabase`), o seu valor vence: o populate não grava a variável no bloco e avisa (para usar o `local`, apague a sua linha e rode `npm run populate -- --yes --only ambiente`). Para ligar à mão:

```bash
# .env.local
BILHON_KNOWLEDGE_PROVIDER=local
# opcional: outro caminho para o índice
BILHON_LOCAL_SEARCH_DB=
```

Reinicie o app depois de editar o `.env.local` ou de rodar o populate (o `.env.local` só é lido ao iniciar). Em branco, `BILHON_LOCAL_SEARCH_DB` vale como ausente e o padrão é `data/search/index.sqlite`, relativo à pasta de onde o app é iniciado.

Com `local` selecionado e o índice ausente, vazio, ilegível ou de outra versão do esquema, o app mostra a tela **Provider não configurado** no lugar do app inteiro (a checagem acontece no layout raiz, como no `supabase`), com a ação: rodar `npm run populate`. Para voltar ao modo demo, apague o valor de `BILHON_KNOWLEDGE_PROVIDER`. Sem o grafo (`data/kg/livros-kg.sqlite`) o provider continua configurado, em modo somente-busca.

Requisito: a CLI `sqlite3` (3.35 ou superior, **com FTS5**) no `PATH`, a mesma que os demais leitores do app já usam. O módulo de população usa o `node:sqlite` (Node 22.13 ou superior) para construir o índice.

## Fluxo de uma busca

```
usuário digita a consulta
  -> POST /api/search                       (app/api/search/route.ts)
  -> LocalProvider.search(consulta, 18)     (lib/providers/local/search.ts)
       1. extrairTermos     consulta -> só letras/números (Unicode, NFC)
       2. montarMatch       "termo"* AND "termo"...   (fallback: OR)
       3. sqlite3 -readonly -json           bm25 + snippet, até 8x o topK de candidatos
       4. no máximo 3 trechos por arquivo, score 0..1, snippet em texto puro
  -> JSON { ok: true, query, hits }
```

A mesma rota atende a página `/buscar` (`components/Busca.tsx`) e a busca de vínculos do card no kanban (`components/Kanban.tsx`, que guarda `livroId`, ou `fonteNome:chunkId` quando o hit não é da estante).

Falhas viram `ProviderSearchError` com código `backend` (CLI ausente, índice ausente ou ilegível, tempo esgotado de 15 s) e a rota responde HTTP 503. O código `ollama-offline` nunca é usado por este provider.

## Formato do índice

`data/search/index.sqlite` é reconstruído do zero a cada `populate` (arquivo temporário + `rename`, então o app nunca lê um índice pela metade) e é **determinístico**: a mesma entrada (corpus e catálogo da estante) produz exatamente os mesmos bytes. Não é versionado (a pasta `data/` é ignorada pelo git).

Tabela virtual `busca` (FTS5, `tokenize = 'unicode61 remove_diacritics 2'`, então "governanca" casa "governança" e a caixa não importa). A **ordem das colunas importa**: `bm25()` e `snippet()` as referenciam por posição.

| # | Coluna | Indexada | Conteúdo |
|---|---|---|---|
| 0 | `titulo` | sim | título do arquivo (sem o sufixo de desempate " (pasta)" que a UI usa para títulos repetidos) |
| 1 | `caminho` | sim | caminho relativo no mega-brain (`engine/intelligence/rag/config.py`): a busca por "rag" acha arquivos sob `rag/` |
| 2 | `texto` | sim | um trecho de 400 palavras (50 de sobreposição, o mesmo `chunkWords` das coleções) |
| 3 | `tipo` | não | `livro` ou `bilhon` (regra abaixo) |
| 4 | `livro_id` | não | id do livro no catálogo da estante; `NULL` fora de `livro` |
| 5 | `livro_titulo` | não | título completo, como a UI mostra |
| 6 | `fonte_nome` | não | slug da coleção do arquivo (`regras`, `skills`, `engine-docs`, …) |
| 7 | `chunk_id` | não | id do trecho, ver abaixo |
| 8 | `link_local` | não | destino do clique na busca |
| 9 | `doc_rel` | não | caminho relativo (agrupa os trechos de um mesmo arquivo) |
| 10 | `chunk_idx` | não | índice do trecho no arquivo, a partir de 0 |

Tabela `meta (key, value)`: `schema_version` (hoje `1`; o provider recusa índice de outra versão), `trechos`, `arquivos`, `livros` (arquivos ligados à estante), `colecoes` (arquivos que abrem pela coleção), `tokenizer`, `chunk_words`, `fonte` e `conteudo_sha256` (hash do corpus indexado e dos links). Não há data em lugar nenhum: é isso que mantém o arquivo idêntico entre duas execuções.

### Regra do tipo e do link

O texto vem só da varredura do mega-brain. O **link** de um documento vem do catálogo que o módulo `livros` grava logo antes (`data/livros/catalogo.json`): só contam as entradas geradas pelo populate (`origem` começando com `mega-brain/`), casadas pelo `proveniencia.origemPath`.

| Arquivo do mega-brain | `tipo` | `livroId` | `linkLocal` | `chunkId` |
|---|---|---|---|---|
| documento (`.md`, `.txt`) listado na estante | `livro` | id do catálogo | `/livro/<id>` | `<id natural>.<ext>#<n>` |
| configuração ou código (`.yaml`, `.json`, `.py`, `.js`, `.sh` …) | `bilhon` (rótulo "corpus" na UI) | `null` | `/colecao/<colecao>/<caminho>` (cada parte com `encodeURIComponent`, o mesmo link que `ColecaoView` monta) | `<caminho>#<n>` |
| documento que a estante não lista (catálogo ausente ou ilegível, módulo `livros` pulado ou com falha) | `bilhon` | `null` | `/colecao/<colecao>/<caminho>` | `<caminho>#<n>` |

Por que o id do catálogo e não o id natural do documento: quando você importa um livro à mão (um PDF, por exemplo) com o mesmo id de um documento do mega-brain, o populate preserva a sua entrada e dá ao documento gerado o id `<id>-<hash>`. Um link pelo id natural abriria o **seu** livro. Pela mesma razão, um documento fora da estante abre pela coleção (que guarda todos os arquivos do corpus), em vez de um `/livro/<id>` que daria 404 ou cairia numa entrada sua; o módulo avisa quantos ficaram nessa situação.

`bilhon` é o único `SearchHit.tipo` que não promete YouTube nem ClickUp, por isso é o usado para o que abre pela coleção. O `chunkId` bate com o trecho das coleções e do grafo (`n` é o índice do trecho de 400 palavras), então um hit pode ser ligado aos outros dados sem tabela de tradução.

## Ranking e score

- Ordenação: `bm25(busca, 10, 2, 1)` (título pesa 10, caminho 2, texto 1), do mais relevante ao menos, com desempate estável pelo `rowid` (ordem de inserção: caminho e depois trecho). A mesma consulta devolve sempre a mesma lista.
- `score` entre 0 e 1: `raw = -bm25`, `score = raw / (raw_max + 4)`, em que `raw_max` é o do melhor candidato. O melhor hit vale `raw_max / (raw_max + 4)`: perto de 1 quando a consulta tem termos raros e fortes, baixo quando só casa palavras comuns. Os demais ficam em proporção ao melhor. Arredondado em 3 casas, nunca chega a 1.
- No máximo 3 trechos por arquivo (a UI mostra 3 por grupo), então 18 hits cobrem vários arquivos em vez de um só.
- Termos: todos precisam aparecer (`AND`). Se nada casar com todos, a busca cai para `OR` e o bm25 põe no topo quem casa mais termos.
- Prefixo: termos com 4 ou mais caracteres também casam por prefixo (`squad` acha `squads`, `agent` acha `agentes`). Termos curtos (`RAG`, `L0`) casam exatos.
- Palavras funcionais PT/EN ("o que é", "how to") saem da consulta, a menos que sejam tudo o que sobrou.
- `topK` é respeitado (máximo 50; `0` ou negativo devolve lista vazia).

## Segurança

O texto digitado **nunca** vira SQL nem sintaxe FTS5:

1. a consulta é cortada em 512 caracteres e reduzida a tokens de letras e números Unicode (no máximo 12 termos de 64 caracteres). Aspas, `AND`/`OR`/`NOT`/`NEAR`, `titulo:`, `^`, `*`, parênteses, `;`, `--`, `.shell` e o resto viram separador e somem; `NEAR` e `NOT` sobrevivem apenas como palavras comuns;
2. a expressão `MATCH` é montada só com `"termo"` (e `*` de prefixo) unidos por `AND`/`OR` escritos pelo código, e conferida por uma regex estrita antes do uso. Se a regex falhar, a busca lança em vez de executar;
3. a expressão entra no SQL como um único literal; os limites (`LIMIT`, pesos) são constantes do código;
4. o `sqlite3` roda por `execFile` (sem shell), com `-readonly`: o app não altera o índice nem se a injeção funcionasse.

**Snippet.** É texto puro, sem marcador de destaque. A UI (`components/Busca.tsx`) o renderiza como nó de texto do React (`…{h.snippet}…`), que escapa tudo: um arquivo indexado cheio de `<script>` aparece como texto. Por isso o provider não monta HTML nem insere `<mark>`; o resumo é só centrado na primeira ocorrência de um termo, com no máximo 400 caracteres, molduras de ASCII-art e réguas removidas e espaços colapsados.

Os testes (`lib/providers/local/*.test.ts`) cobrem as tentativas de injeção, aspas, operadores do FTS5, consulta vazia ou só pontuação, acentos, consulta gigante, HTML no texto indexado, o contrato entre o índice que o populate grava e o que o provider lê (`busca-populate.test.ts`, inclusive a colisão com uma entrada manual da estante) e, quando já existe um índice real, se o clique de cada hit abre uma página que o app lê (`indice-real.test.ts`).

## Limites

- **Lexical, sem embeddings.** Casa palavras, não significado: "como criar um agente" acha o que contém "criar" e "agente", não sinônimos nem paráfrases. Para busca semântica use o provider `supabase`.
- Sem stemming de verdade: só o prefixo de 4 ou mais caracteres. "agentes" não acha "agente" (o prefixo vai no sentido contrário); "agente" acha os dois.
- A frase digitada não é buscada como frase: os termos podem aparecer em qualquer ordem e posição do trecho.
- Cada consulta abre um processo `sqlite3`. No Windows isso custa de 100 a 300 ms por busca (medido: média de ~190 ms sobre ~3.800 trechos); o grosso é o custo de criar o processo, não a consulta.
- Escopo: o que o populate coloca no corpus (documentos, configs e código do mega-brain; `knowledge/personal` e `agents/personal` ficam de fora por padrão; material com cara de segredo nunca entra). O índice não vê o que mudou no repositório depois da população: rode `npm run populate` de novo.
- **Livros que você adicionou à mão não entram na busca.** As entradas manuais da estante (por exemplo, PDFs em `data/livros/arquivos/`) continuam na estante e no leitor, mas o populate não extrai texto de PDF (nenhuma dependência para isso) e não indexa o que não veio do mega-brain.

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| "Índice de busca local não encontrado" | `npm run populate`, ou aponte `BILHON_LOCAL_SEARCH_DB` para um índice existente |
| "Índice de busca local vazio (0 trechos)" | o corpus estava vazio: confira `--repo`/`BILHON_MEGABRAIN_ROOT` (a raiz precisa ser reconhecida como Megabrain, pela mesma regra de [megabrain.md](megabrain.md)) e rode o populate de novo |
| "esquema "X" (esperado "1")" | índice de outra versão do app: `npm run populate` o reconstrói |
| "CLI sqlite3 não encontrada no PATH" | instale o SQLite 3.35+ com FTS5 e reinicie o app |
| "Índice local de busca ilegível…" | arquivo corrompido ou sem FTS5: `npm run populate` |
| aviso do populate "catálogo da estante … ausente ou ilegível" ou "documento(s) fora do catálogo da estante" | o módulo `livros` não rodou ou falhou: os documentos abrem pela coleção. Rode o populate completo (sem `--skip livros`) |
