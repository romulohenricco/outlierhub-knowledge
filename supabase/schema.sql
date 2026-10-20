-- =============================================================================
-- supabase/schema.sql — esquema mínimo da busca semântica híbrida
-- =============================================================================
-- Rode este arquivo no SEU projeto Supabase: cole-o no SQL Editor e execute.
-- É idempotente: rodar de novo não duplica nem apaga dados. A função é recriada (create or
-- replace) e perde a configuração que você tenha aplicado nela depois (ex.: o ajuste de
-- recall do HNSW em docs/provider-supabase.md): reaplique-a.
--
-- Para versioná-lo como migração, copie-o para
-- supabase/migrations/<timestamp>_rag_chunks.sql (depois de `supabase init` e
-- `supabase link`). O `supabase db push` só aplica arquivos dessa pasta, e este
-- template não traz a pasta nem o supabase/config.toml; rodar o push sem isso não
-- executa este arquivo.
--
-- O que ele cria
--   1. a extensão pgvector (vetores e distância por cosseno);
--   2. a tabela public.rag_chunks, onde o SEU pipeline de ingestão grava os
--      trechos de texto e os respectivos embeddings (este template não traz
--      ingestão nem dado nenhum);
--   3. índices: HNSW (busca vetorial) e GIN (busca lexical), mais apoio aos
--      filtros por bucket e por rid;
--   4. a função public.match_rag_chunks_hybrid(...), a ÚNICA porta de leitura
--      que o app usa (chamada como RPC pelo servidor);
--   5. as travas de segurança: RLS ligada e acesso exclusivo da service_role.
--
-- Contrato com o app (detalhes em docs/provider-supabase.md)
--   * o embedding da consulta vem do Ollama com o modelo bge-m3: 1024 dimensões.
--     Outro modelo serve desde que gere a mesma dimensão; se não gerar, troque
--     o 1024 abaixo (coluna e parâmetro da função) e reindexe tudo;
--   * os nomes e tipos das 7 colunas devolvidas pela função são lidos pelo app
--     ao pé da letra: não os renomeie sem alterar o provider de busca;
--   * pressupõe um projeto Supabase: os papéis anon, authenticated e
--     service_role já existem lá;
--   * use um projeto dedicado a este app: a chave service_role que ele exige ignora
--     a RLS em TODAS as tabelas do projeto, não só nesta (ver seção 4);
--   * com mais de um bucket, leia a nota sobre revocação do HNSW na seção 2.
-- =============================================================================

-- Garante que o pgvector (schema "extensions") esteja visível nesta sessão, para
-- que o tipo vector e o operador <=> resolvam em qualquer cliente SQL.
set search_path = public, extensions;

create extension if not exists vector with schema extensions;


-- -----------------------------------------------------------------------------
-- 1. Tabela de trechos
-- -----------------------------------------------------------------------------
-- Um registro por trecho (chunk) de documento. As colunas têm o mesmo nome dos
-- campos que a função devolve, para o contrato ficar legível de ponta a ponta.
create table if not exists public.rag_chunks (
  -- identificador estável do trecho, definido por você (hash, uuid, "doc#12"…).
  -- Ser estável permite reingerir com upsert sem duplicar.
  chunk_id    text primary key,
  -- o texto em si; é o que a UI exibe (primeiros 400 caracteres) e o que a busca
  -- lexical indexa.
  chunk_text  text not null,
  -- de onde o trecho veio (caminho, URL, título). Aparece como título do
  -- resultado; se vazio, a UI cai para o chunk_id.
  source_path text,
  -- agrupador de escopo da busca (uma coleção, um setor, um projeto…). O filtro
  -- da função é igualdade estrita: UM bucket por vez.
  bucket      text,
  -- autor/pessoa/proprietário do conteúdo, opcional. Serve de rótulo de origem
  -- quando o bucket é nulo.
  person      text,
  -- identificador opcional do recurso/entidade a que o trecho pertence. O app
  -- hoje não filtra por ele (envia p_rid nulo); fica disponível para quem
  -- precisar restringir a busca a um recurso específico.
  rid         text,
  -- campo livre para o que o seu pipeline quiser guardar (página, idioma,
  -- timestamps…). O app não lê.
  metadata    jsonb not null default '{}'::jsonb,
  -- vetor do trecho. Nulo é aceito (ingestão em duas etapas): o trecho já é
  -- achado pela busca lexical e passa a entrar na vetorial quando o vetor chegar.
  embedding   vector(1024),
  -- índice lexical mantido pelo próprio banco a partir do texto. A configuração
  -- 'portuguese' faz stemming e remove stopwords; para outro idioma troque aqui E
  -- na função (precisa ser a mesma nos dois lugares) e recrie a coluna.
  fts         tsvector generated always as (to_tsvector('portuguese', coalesce(chunk_text, ''))) stored,
  created_at  timestamptz not null default now()
);

comment on table public.rag_chunks is
  'Trechos de texto com embedding (1024 dim) e índice lexical, lidos pela busca híbrida do app. Acesso só pela service_role.';


-- -----------------------------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------------------------
-- Busca vetorial aproximada por cosseno. HNSW não precisa de treino prévio nem
-- de dados na tabela (ao contrário do ivfflat) e mantém boa revocação.
create index if not exists rag_chunks_embedding_hnsw
  on public.rag_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ATENÇÃO ao filtro de bucket. O app filtra por bucket em toda busca (exceto com
-- __TODO_O_CORPUS__), mas o HNSW é aproximado: o índice varre hnsw.ef_search = 40
-- candidatos (padrão) e SÓ DEPOIS o filtro `bucket = ...` descarta linhas. Se o
-- bucket tem 10% da tabela, o ramo vetorial devolve em média ~4 candidatos; num
-- bucket pequeno, pode devolver nenhum. Não dá erro: a busca só fica pior (o ramo
-- lexical não é afetado). Se você tem vários buckets, com pgvector 0.8.0 ou superior
-- considere a varredura iterativa, gravada na função porque a chamada é por RPC e
-- configuração de sessão não persiste entre chamadas:
--
--   alter function public.match_rag_chunks_hybrid(vector, text, integer, text, integer, text)
--     set hnsw.iterative_scan = 'strict_order';
--
-- Não é ativado aqui porque depende da versão do pgvector e do seu corpus. Versão:
-- select extversion from pg_extension where extname = 'vector'; detalhes e
-- alternativas em docs/provider-supabase.md, seção "Ajustes finos".

-- Busca lexical (full-text) sobre o tsvector gerado.
create index if not exists rag_chunks_fts_gin
  on public.rag_chunks using gin (fts);

-- Filtros de escopo: sem estes, filtrar por bucket/rid varre a tabela inteira.
create index if not exists rag_chunks_bucket_idx
  on public.rag_chunks (bucket);

create index if not exists rag_chunks_rid_idx
  on public.rag_chunks (rid) where rid is not null;


-- -----------------------------------------------------------------------------
-- 3. Busca híbrida: semântica + lexical, fundidas por RRF
-- -----------------------------------------------------------------------------
-- Parâmetros (os nomes são os que o app envia à RPC):
--   query_embedding  vetor da consulta (1024 dimensões, número[] no JSON).
--   query_text       consulta em texto livre (aceita "frase exata", OR e -exclusão).
--   match_count      quantos resultados devolver (limitado a 1..100; padrão 18).
--   bucket_filter    nulo = todo o corpus; texto = só esse bucket (igualdade).
--   rrf_k            constante do RRF (padrão 60); maior = ranking mais suave.
--   p_rid            nulo = sem filtro; texto = só trechos com esse rid.
--
-- Como ranqueia: cada ramo (vetorial e lexical) produz seus melhores candidatos,
-- ordenados do melhor para o pior. A pontuação RRF de um trecho é a soma de
-- 1 / (rrf_k + posição) em cada ramo em que ele aparece, então quem aparece nos
-- dois sobe, sem precisar comparar escalas diferentes (distância x ts_rank).
-- O teto de rrf_score é, portanto, ~2 / (rrf_k + 1).
--
-- Colunas devolvidas:
--   similarity  cosseno entre 0 e 1 (1 = idêntico), para exibir ao usuário;
--               nulo quando o trecho ainda não tem embedding. A ORDEM do
--               resultado segue rrf_score, não a similarity.
--   rrf_score   pontuação fundida usada na ordenação.
--
-- security invoker: roda com as permissões de quem chama (a service_role), nunca
-- com as do dono da função. search_path fixo: impede que um objeto homônimo em
-- outro schema sequestre a função.
create or replace function public.match_rag_chunks_hybrid(
  query_embedding vector(1024),
  query_text      text,
  match_count     integer default 18,
  bucket_filter   text    default null,
  rrf_k           integer default 60,
  p_rid           text    default null
)
returns table (
  chunk_id    text,
  chunk_text  text,
  source_path text,
  bucket      text,
  person      text,
  similarity  double precision,
  rrf_score   double precision
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with cfg as (
    select
      least(greatest(coalesce(match_count, 18), 1), 100)              as n,
      greatest(coalesce(rrf_k, 60), 1)                                as k,
      -- candidatos por ramo: o dobro do pedido, com piso de 40 (igual ao
      -- hnsw.ef_search padrão, que é o máximo que o índice HNSW devolve por consulta)
      greatest(least(greatest(coalesce(match_count, 18), 1), 100) * 2, 40) as pool
  ),
  -- websearch_to_tsquery nunca falha com texto digitado por usuário (aspas
  -- soltas, símbolos…); consulta vazia vira tsquery vazia e o ramo não devolve nada.
  consulta as (
    select websearch_to_tsquery('portuguese', coalesce(query_text, '')) as tsq
  ),
  -- Ramo vetorial. O ORDER BY ... LIMIT fica na subconsulta, direto sobre o
  -- operador de distância, que é a forma que permite ao planejador usar o HNSW.
  vetorial as (
    select s.chunk_id, row_number() over (order by s.dist) as posicao
    from (
      select c.chunk_id, c.embedding <=> query_embedding as dist
      from public.rag_chunks c
      where query_embedding is not null
        and c.embedding is not null
        and (bucket_filter is null or c.bucket = bucket_filter)
        and (p_rid is null or c.rid = p_rid)
      order by c.embedding <=> query_embedding
      limit (select pool from cfg)
    ) s
  ),
  -- Ramo lexical: casa o tsvector e ordena por ts_rank_cd (leva em conta a
  -- proximidade dos termos).
  lexical as (
    select s.chunk_id, row_number() over (order by s.relevancia desc, s.chunk_id) as posicao
    from (
      select c.chunk_id, ts_rank_cd(c.fts, q.tsq) as relevancia
      from public.rag_chunks c
      cross join consulta q
      where c.fts @@ q.tsq
        and (bucket_filter is null or c.bucket = bucket_filter)
        and (p_rid is null or c.rid = p_rid)
      order by relevancia desc, c.chunk_id
      limit (select pool from cfg)
    ) s
  ),
  -- Fusão RRF: full join porque um trecho pode estar em só um dos ramos.
  fundido as (
    select
      coalesce(v.chunk_id, l.chunk_id) as chunk_id,
      coalesce(1.0::double precision / ((select k from cfg) + v.posicao), 0)
        + coalesce(1.0::double precision / ((select k from cfg) + l.posicao), 0) as score
    from vetorial v
    full outer join lexical l on l.chunk_id = v.chunk_id
  )
  select
    c.chunk_id,
    c.chunk_text,
    c.source_path,
    c.bucket,
    c.person,
    case
      when c.embedding is null or query_embedding is null then null
      -- cosseno vai de -1 a 1; a UI espera 0..1, então o negativo vira 0
      else greatest(0::double precision, 1 - (c.embedding <=> query_embedding))
    end as similarity,
    f.score as rrf_score
  from fundido f
  join public.rag_chunks c on c.chunk_id = f.chunk_id
  order by f.score desc, c.chunk_id
  limit (select n from cfg);
$$;

comment on function public.match_rag_chunks_hybrid(vector, text, integer, text, integer, text) is
  'Busca híbrida (vetorial cosseno + lexical) com fusão RRF sobre public.rag_chunks. Chamada só pelo servidor, com a service_role.';


-- -----------------------------------------------------------------------------
-- 4. Segurança
-- -----------------------------------------------------------------------------
-- O app só acessa o banco pelo servidor, com a chave service_role (que ignora a
-- RLS por definição). Por isso:
--   * a RLS fica LIGADA e SEM nenhuma política: para anon e authenticated a
--     tabela fica vazia/negada, mesmo que alguém exponha a chave pública;
--   * os privilégios também são retirados de anon e authenticated (cinto e
--     suspensório: o Supabase concede ALL a esses papéis em tabelas novas do
--     schema public, e a API REST exporia a tabela);
--   * a função, que o PostgREST publica como /rpc, só pode ser executada pela
--     service_role.
-- O aviso "RLS habilitada sem políticas" do Security Advisor, para esta tabela,
-- é esperado e intencional.
--
-- A service_role, porém, não é restrita a esta tabela: ela lê e escreve em tudo o
-- que existir no projeto. Por isso o projeto deve ser dedicado a este app, e a chave
-- só pode viver no servidor (BILHON_SUPABASE_SERVICE_ROLE_KEY no .env.local).
alter table public.rag_chunks enable row level security;

revoke all on table public.rag_chunks from public, anon, authenticated;
grant select, insert, update, delete on table public.rag_chunks to service_role;

revoke all on function public.match_rag_chunks_hybrid(vector, text, integer, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.match_rag_chunks_hybrid(vector, text, integer, text, integer, text)
  to service_role;

-- Pede ao PostgREST para recarregar o catálogo e já enxergar a função nova.
notify pgrst, 'reload schema';
