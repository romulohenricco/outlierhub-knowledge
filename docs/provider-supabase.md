# Provider de busca com Supabase

Este documento descreve o contrato entre o app e o seu Supabase: a tabela, a função de busca, o que o servidor envia e o que espera receber. Serve para quem vai alimentar a tabela, ajustar o esquema ou trocar o Supabase por outro engine.

O arquivo [`supabase/schema.sql`](../supabase/schema.sql) cria tudo o que está descrito aqui. Este template não traz banco, chaves nem dados: o projeto Supabase é o seu.

## Visão geral

O app fala com a base de conhecimento por uma interface única, `KnowledgeProvider`, definida em `lib/providers/types.ts`. Existem dois providers:

| Valor de `BILHON_KNOWLEDGE_PROVIDER` | O que faz |
|---|---|
| vazio, ausente ou `demo` | Fixtures sintéticas (`fixtures/demo/`). Não precisa de rede, banco nem Ollama. É o padrão. |
| `supabase` | Busca semântica no seu Supabase (tabela `rag_chunks` + função `match_rag_chunks_hybrid`), com o embedding da consulta gerado pelo Ollama. Nenhum outro serviço externo é usado. O grafo continua sendo lido do SQLite local `data/kg/livros-kg.sqlite` (formato em [`dados.md`](dados.md#grafo-de-conhecimento)): sem ele o canvas do grafo fica vazio, **sem cair no demo** e sem mensagem na tela (a API `/api/graph` responde 503 com o motivo no campo `detalhe`). |

O provider só decide a **busca** e o **grafo**. A estante (`data/livros/catalogo.json`) e as referências leem sempre os arquivos locais, e mostram os dados de exemplo quando eles não existem, seja qual for o provider ([`dados.md`](dados.md#o-que-cada-tela-lê)).

Um valor desconhecido em `BILHON_KNOWLEDGE_PROVIDER` faz o app falhar de forma explícita (tela **O app não conseguiu iniciar**). A mensagem cita o nome da variável e os valores aceitos, sem ecoar o valor digitado (ele poderia ser um segredo colado no lugar errado). Ela só aparece inteira na tela em `npm run dev`: em produção (`npm run start`) o Next troca o texto dos erros de página por uma mensagem genérica e um `digest`, e a mensagem completa fica no terminal onde o servidor roda, na linha com o mesmo `digest` (veja "Erros em produção" no [README](../README.md#erros-em-produção)).

Com `supabase` selecionado e URL, chave ou escopo em branco, o app mostra a tela **Provider não configurado**, com o que falta. Essa tela **substitui o app inteiro** (menu, Kanban e Agente também), porque a checagem acontece no layout raiz: não é só a busca que fica indisponível. Preencha o que falta ou apague o valor de `BILHON_KNOWLEDGE_PROVIDER` para voltar ao modo demo.

### Fluxo de uma busca

```
usuário digita a consulta
  -> POST /api/search                      (app/api/search/route.ts)
  -> provider.search(consulta, 18)
       1. escopo da busca resolvido (bucket ou corpus inteiro)
       2. Ollama /api/embeddings            -> vetor de 1024 números
       3. RPC match_rag_chunks_hybrid       -> até 18 trechos ranqueados
       4. cada linha vira um SearchHit      (lib/types.ts)
  -> JSON { ok: true, query, hits }
```

Falhas viram `ProviderSearchError` com um de dois códigos, e a rota responde HTTP 503 com `{ ok: false, erro, detalhe }`:

| Código | Quando |
|---|---|
| `ollama-offline` | o Ollama não respondeu, devolveu HTTP de erro ou um embedding vazio |
| `backend` | Supabase não configurado, escopo não declarado ou erro devolvido pela RPC |

## A tabela `public.rag_chunks`

Um registro por trecho de texto. O **seu** pipeline de ingestão grava nela; o app só lê.

| Coluna | Tipo | Obrigatória | Uso |
|---|---|---|---|
| `chunk_id` | `text` (PK) | sim | Identificador estável do trecho, definido por você. Estável permite reingerir com upsert sem duplicar. Vira `SearchHit.chunkId`. |
| `chunk_text` | `text` | sim | O texto do trecho. A UI mostra os primeiros 400 caracteres (`snippet`) e a busca lexical indexa o conteúdo inteiro. |
| `source_path` | `text` | não | Origem do trecho (caminho, URL, título). Vira o título do resultado; se nulo, a UI usa o `chunk_id`. |
| `bucket` | `text` | não | Agrupador de escopo da busca (coleção, setor, projeto…). Vira o rótulo de origem do resultado. |
| `person` | `text` | não | Autor/proprietário do conteúdo. Rótulo de origem quando o `bucket` é nulo. |
| `rid` | `text` | não | Identificador opcional de um recurso/entidade. O app hoje não filtra por ele; o parâmetro `p_rid` da função permite restringir a busca a um recurso. |
| `metadata` | `jsonb` | não (padrão `{}`) | Livre. O app não lê. |
| `embedding` | `vector(1024)` | não | Vetor do trecho. Nulo é aceito: o trecho já é achado pela busca lexical e passa a entrar na vetorial quando o vetor chegar. |
| `fts` | `tsvector` (gerada) | n/a | Calculada pelo banco a partir de `chunk_text` com a configuração `portuguese`. Não escreva nela. |
| `created_at` | `timestamptz` | não (padrão `now()`) | Controle seu. O app não lê. |

Índices criados: HNSW em `embedding` (cosseno), GIN em `fts`, e btree em `bucket` e em `rid`.

### Gravando trechos (ingestão)

A ingestão não vem no template. Em resumo, o seu pipeline precisa: quebrar os documentos em trechos, gerar o embedding de cada um **com o mesmo modelo que será usado nas consultas** (veja a seção de dimensão abaixo) e fazer upsert com a `service_role`. Exemplo mínimo com `@supabase/supabase-js` (já é dependência do projeto):

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.BILHON_SUPABASE_URL!,
  process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// `trechos` vem do seu pipeline: { chunk_id, chunk_text, source_path, bucket, embedding: number[1024] }[]
const { error } = await supabase.from("rag_chunks").upsert(trechos, { onConflict: "chunk_id" });
if (error) throw error;
```

Grave em lotes (algumas centenas por chamada) e rode o script fora do app: a chave `service_role` nunca deve ir para código de navegador.

## A função `public.match_rag_chunks_hybrid`

### Argumentos

Os nomes abaixo são exatamente os que o servidor envia na RPC (JSON, em um único objeto):

| Argumento | Tipo SQL | Padrão | O que o app envia | Efeito |
|---|---|---|---|---|
| `query_embedding` | `vector(1024)` | n/a | array de 1024 números (embedding da consulta) | Ramo vetorial. Se nulo, só o ramo lexical roda. |
| `query_text` | `text` | n/a | o texto digitado | Ramo lexical, via `websearch_to_tsquery`: aceita `"frase exata"`, `or` e `-exclusão`, e nunca falha com símbolos soltos. Vazio desliga o ramo. |
| `match_count` | `integer` | `18` | `18` | Quantos resultados devolver. Limitado ao intervalo 1 a 100. |
| `bucket_filter` | `text` | `null` | o bucket configurado, ou `null` | `null` = todo o corpus; texto = só esse bucket, por igualdade estrita (lista de buckets não é suportada). |
| `rrf_k` | `integer` | `60` | `60` | Constante do RRF; maior suaviza o ranking. |
| `p_rid` | `text` | `null` | `null` | `null` = sem filtro; texto = só trechos com esse `rid`. |

O PostgREST resolve a RPC pelo **conjunto de nomes** enviados. Por isso, se você alterar a lista de argumentos da função, o provider de busca precisa enviar o mesmo conjunto.

### Retorno

Uma linha por trecho, já ordenada do melhor para o pior (ordem pelo `rrf_score`, desempate pelo `chunk_id`):

| Coluna | Tipo | Como o app usa |
|---|---|---|
| `chunk_id` | `text` | `SearchHit.chunkId`; também é o título do resultado quando `source_path` é nulo |
| `chunk_text` | `text` | `SearchHit.snippet` (primeiros 400 caracteres) |
| `source_path` | `text` (pode ser nulo) | `SearchHit.livroTitulo` |
| `bucket` | `text` (pode ser nulo) | `SearchHit.fonteNome` |
| `person` | `text` (pode ser nulo) | `SearchHit.fonteNome`, quando `bucket` é nulo |
| `similarity` | `double precision` (pode ser nula) | `SearchHit.score`: cosseno entre 0 e 1, arredondado em 3 casas. Nulo vira 0 |
| `rrf_score` | `double precision` (pode ser nula) | não é exibido; só define a ordem |

A porcentagem mostrada na tela usa a `similarity`, e não o `rrf_score`, porque o `rrf_score` tem teto por volta de `2 / (rrf_k + 1)` e apareceria como "3%".

### Como o ranking funciona

1. **Ramo vetorial:** os trechos mais próximos do `query_embedding` por distância de cosseno (`<=>`), usando o índice HNSW.
2. **Ramo lexical:** os trechos cujo `fts` casa com `query_text`, ordenados por `ts_rank_cd`, usando o índice GIN.
3. **Fusão (RRF, Reciprocal Rank Fusion):** a pontuação de um trecho é a soma de `1 / (rrf_k + posição)` em cada ramo em que aparece. Quem aparece nos dois ramos sobe, e não é preciso comparar escalas diferentes.
4. Cada ramo traz `max(2 x match_count, 40)` candidatos; o resultado final é cortado em `match_count`.

### Segurança

- **`security invoker`:** a função roda com as permissões de quem chama, nunca com as do dono.
- **`search_path` fixo** (`public, extensions, pg_temp`): impede que objetos homônimos em outro schema sequestrem a função.
- **RLS ligada na tabela, sem nenhuma política:** `anon` e `authenticated` não enxergam nada, mesmo que a chave pública do projeto vaze.
- **Privilégios revogados** de `public`, `anon` e `authenticated` na tabela e na função (o Supabase concede privilégios a esses papéis em objetos novos do schema `public`, e o PostgREST publicaria a função como `/rpc`). Só a `service_role` recebe `grant`.
- O Security Advisor do Supabase avisa "RLS habilitada sem políticas" para `rag_chunks`. Isso é esperado e intencional.

Como a `service_role` ignora a RLS, **é o escopo da busca que limita o alcance dela**. Por isso o provider exige que o escopo seja declarado em `BILHON_KNOWLEDGE_BUCKET_FILTER`:

| Valor | Efeito na RPC |
|---|---|
| o nome de um bucket | `bucket_filter = '<bucket>'`: a busca fica restrita a ele |
| `__TODO_O_CORPUS__` | `bucket_filter = null`: a busca alcança tudo. Escolha legítima, mas declarada; a primeira busca do processo registra a decisão em stdout |
| ausente ou vazio | erro explícito antes de qualquer chamada ao Ollama ou ao banco |

O escopo limita o que **a busca** devolve, não o que a **chave** alcança: a `service_role` lê e escreve em todas as tabelas do projeto Supabase, ignorando a RLS. **Use um projeto dedicado a este app** e não reaproveite um projeto que guarde outros dados. O app exige essa chave porque a tabela e a função não têm política para `anon` nem `authenticated`.

A chave vai só em `BILHON_SUPABASE_SERVICE_ROLE_KEY`, lida no servidor. O app não resolve referências de um gerenciador de segredos no formato `op://…` (usado pelo CLI do 1Password): se um carregador de segredos injeta o ambiente, ele precisa entregar o valor já resolvido; ao encontrar uma referência em `BILHON_SUPABASE_URL` ou `BILHON_SUPABASE_SERVICE_ROLE_KEY`, a busca recusa e o `status()` aponta o nome da variável. Sem carregador de segredos, ignore isto: o valor real vai direto no `.env.local`.

## Embeddings e dimensão do vetor

A consulta é transformada em vetor pelo Ollama (`POST {BILHON_OLLAMA_URL}/api/embeddings`, corpo `{ model, prompt }`). Padrões do provider, usados quando as variáveis estão em branco:

| Variável | Padrão |
|---|---|
| `BILHON_OLLAMA_URL` | `http://127.0.0.1:11434` |
| `BILHON_EMBED_MODEL` | `bge-m3:latest` |

O `bge-m3` gera vetores de **1024 dimensões**, e é essa a dimensão do esquema. Regras:

- Ingestão e consulta têm de usar o **mesmo modelo**. Vetores de modelos diferentes não são comparáveis, mesmo quando têm a mesma dimensão.
- Outro modelo de **1024 dimensões** funciona sem mexer no esquema.
- Dimensão diferente exige: trocar `vector(1024)` na coluna `embedding` e no argumento `query_embedding` da função, recriar o índice HNSW e reembutir todos os trechos. Se a dimensão da consulta não bater com a da tabela, o banco responde `different vector dimensions` e a busca falha com código `backend`.
- O índice HNSW do pgvector suporta até 2000 dimensões no tipo `vector`.

## Ajustes finos

- **Idioma da busca lexical:** o esquema usa a configuração `portuguese` (stemming e stopwords) na coluna gerada `fts` e na função. Para outro idioma, troque nos dois lugares (a configuração tem de ser a mesma) e recrie a coluna `fts`. A configuração `simple` serve para qualquer idioma, sem stemming.
- **Revocação do HNSW com filtro de bucket (leia antes de ter vários buckets):** o app **sempre** filtra por bucket quando `BILHON_KNOWLEDGE_BUCKET_FILTER` nomeia um. O índice HNSW é aproximado e o filtro é aplicado **depois** da varredura, que por padrão considera `hnsw.ef_search = 40` candidatos. Se o bucket escolhido tem 10% das linhas da tabela, o ramo vetorial devolve em média só uns 4 candidatos, e num bucket pequeno pode devolver nenhum; a busca lexical (GIN) não sofre disso. O resultado é uma busca semântica pobre sem nenhum erro. Não acontece com `__TODO_O_CORPUS__` nem com um único bucket que seja quase toda a tabela. Como ajustar:
  1. veja a versão do pgvector: `select extversion from pg_extension where extname = 'vector';`;
  2. com **pgvector 0.8.0 ou superior**, ligue a varredura iterativa, que continua o índice até completar os candidatos do filtro (`strict_order` mantém a ordem exata por distância; `relaxed_order` ganha velocidade aceitando uma ordem levemente fora). Como o app chama a função por RPC, uma configuração de sessão não persiste entre chamadas; grave-a na própria função:

     ```sql
     alter function public.match_rag_chunks_hybrid(vector, text, integer, text, integer, text)
       set hnsw.iterative_scan = 'strict_order';
     ```

     **Reaplique este `alter function` depois de qualquer nova execução do `schema.sql`:** o `create or replace function` redefine a configuração da função e apaga o ajuste (a busca continua funcionando, só perde recall com filtro de bucket).

     O limite de linhas varridas é `hnsw.max_scan_tuples` (padrão 20000). Para desfazer: `alter function public.match_rag_chunks_hybrid(vector, text, integer, text, integer, text) reset hnsw.iterative_scan;`;
  3. em versões anteriores, aumente `hnsw.ef_search` (até 1000) do mesmo modo (`set hnsw.ef_search = 200`), ao custo de consultas mais lentas;
  4. confira o efeito com uma busca real do seu bucket e compare a contagem de resultados antes e depois. Não há como validar isto sem os seus dados, por isso o `supabase/schema.sql` não ativa nada por conta própria.
- **Candidatos por consulta:** cada ramo da função pede ao índice o `pool` (o dobro de `match_count`, com piso de 40), mas o HNSW não devolve mais que `hnsw.ef_search` (40 por padrão). O app usa `match_count = 18`, então o pool fica em 40; se você mudar isso para mais de 20, aumente também o `ef_search` para pelo menos o valor do pool.
- **Tabelas pequenas:** com poucos milhares de linhas o planejador pode preferir varrer a tabela em vez de usar o HNSW. É o comportamento correto: o índice passa a ser usado quando a tabela cresce.

## Diagnóstico de problemas comuns

| Sintoma | Causa provável |
|---|---|
| Tela "Provider não configurado" no lugar do app | `BILHON_KNOWLEDGE_PROVIDER=supabase` com URL, chave ou escopo em branco. A mensagem cita o que falta. Apague o valor da variável para voltar ao modo demo |
| Tela "O app não conseguiu iniciar" (em produção só com um `digest`; a mensagem, que cita `BILHON_KNOWLEDGE_PROVIDER`, está no terminal do servidor) | o valor não é `demo` nem `supabase` |
| Mensagem de "segredo `op://` não resolvido" | `BILHON_SUPABASE_URL` ou `BILHON_SUPABASE_SERVICE_ROLE_KEY` ainda traz a referência literal. Coloque o valor real no `.env.local` ou suba o app por um carregador que a resolva |
| Busca com poucos resultados semânticos (ou só os de texto) num bucket pequeno | HNSW aplicando o filtro depois da varredura: veja "Revocação do HNSW com filtro de bucket" em Ajustes finos |
| Busca responde 503 com `backend` e cita `match_rag_chunks_hybrid` | A função não existe (rode `supabase/schema.sql`) ou o catálogo do PostgREST está desatualizado (rode `notify pgrst, 'reload schema';`) |
| Erro `permission denied for function` | A chave usada não é a `service_role` (por exemplo, a chave `anon` foi colada no lugar) |
| Erro `different vector dimensions` | A dimensão do modelo de embeddings não é a do esquema |
| Busca responde 503 com `ollama-offline` | Ollama parado, modelo não baixado (`ollama pull bge-m3`) ou `BILHON_OLLAMA_URL` errada |
| Busca devolve vazio | Tabela sem dados, `bucket` do escopo sem trechos, ou embeddings ainda nulos e consulta sem termos em comum |

## Trocando por outro engine

Nada fora de `lib/providers/` precisa mudar. Para usar outro armazenamento de vetores (Qdrant, um Postgres próprio, uma API sua…):

1. Crie uma pasta em `lib/providers/` e uma classe que implemente `KnowledgeProvider` (`lib/providers/types.ts`):

   ```ts
   import type { KnowledgeProvider, ProviderStatus } from "../types";
   import { ProviderSearchError } from "../types";
   import type { SearchHit } from "@/lib/types";

   export class MeuEngineProvider implements KnowledgeProvider {
     async search(query: string, topK = 18): Promise<SearchHit[]> {
       // consulte o seu engine; lance ProviderSearchError("backend", "...") em caso de falha
       return [];
     }
     async status(): Promise<ProviderStatus> {
       return { configured: false, reason: "diga ao operador o que falta configurar" };
     }
     // grafo, grafoReferencias, grafoTopologia, impactoDeMover,
     // evidencias, fontesDoConceito e kgStats: veja a interface em types.ts
   }
   ```

2. Registre o novo valor no `switch` de `lib/providers/index.ts`, que é o único ponto de seleção.
3. Aponte `BILHON_KNOWLEDGE_PROVIDER` para ele no `.env.local`.

O contrato que o resto do app assume:

- `search` devolve `SearchHit[]` já ordenados (`score` entre 0 e 1, `snippet` curto, `chunkId`, `fonteNome`, `livroTitulo`, `linkLocal`). Falhas devem ser `ProviderSearchError` com código `ollama-offline` ou `backend`; qualquer outro erro vira 503 genérico.
- `status()` nunca lança: devolve `{ configured: false, reason }` com texto acionável (nome de variável, nunca valor). O `reason` aparece na tela de orientação inicial.
- Os métodos de grafo que o seu engine não tiver devem devolver estruturas vazias, e não lançar erro. Para `grafoTopologia`, uma camada vazia com `meta.totalNos = 0`.
- Mensagens de erro nunca devem ecoar valores de variáveis de ambiente.
- Os testes do provider devem ser herméticos: simulam o cliente e o `fetch`, e limpam as variáveis `BILHON_*` antes de cada caso para não herdar o ambiente da máquina.
