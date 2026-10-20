/**
 * Busca semântica sobre um Supabase (pgvector) do PRÓPRIO usuário: a RPC
 * híbrida `match_rag_chunks_hybrid` (vetor + texto) já devolve os trechos
 * ranqueados, então o ranking não é reimplementado aqui. O embedding da
 * pergunta vem de um Ollama local, com o mesmo modelo da ingestão — o texto
 * da consulta não passa por API de terceiros. A tabela `rag_chunks` e a RPC
 * são criadas por supabase/schema.sql no projeto do usuário (contrato em
 * docs/provider-supabase.md).
 *
 * Dois controles vivem aqui: (a) fail-fast quando o valor lido é uma
 * referência de segredo `op://` que ninguém resolveu (o app subiu sem o
 * carregador de segredos), para ele não se declarar saudável com uma chave
 * que não é chave; (b) escopo de bucket declarativo, para a chave
 * `service_role` (que ignora RLS) nunca alcançar a base inteira por omissão
 * de configuração.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SemanticSearchProvider } from "../types";
import { ProviderSearchError } from "../types";
import type { SearchHit } from "@/lib/types";

/** Valor sentinela de `BILHON_KNOWLEDGE_BUCKET_FILTER` que declara, de forma
 *  auditável, a escolha de buscar em TODO o corpus (`bucket_filter: null` na
 *  RPC). Verboso de propósito: "esqueci de configurar" e "quis o corpus
 *  inteiro" eram indistinguíveis (ambos string vazia) — a sentinela separa os
 *  dois casos. */
export const SENTINELA_CORPUS_INTEIRO = "__TODO_O_CORPUS__";

const OLLAMA_URL_PADRAO = "http://127.0.0.1:11434";
const EMBED_MODEL_PADRAO = "bge-m3:latest";

/** Env lida no ponto de uso (não no import): o estado de configuração é
 *  avaliado a cada busca/`status()`, nunca congelado num snapshot de boot —
 *  é o que permite falha localizada em vez de derrubar o processo, e o que
 *  torna os testes hermetizáveis por variável. String vazia ou só-espaço conta
 *  como ausente. */
function lerEnv(nome: string): string | null {
  const valor = process.env[nome];
  return valor && valor.trim() !== "" ? valor : null;
}

/** true quando o valor é uma referência de segredo `op://…` NÃO resolvida — o
 *  app subiu sem o carregador de segredos e a string literal seria usada como
 *  se fosse chave. */
export function segredoNaoResolvido(valor: string | null | undefined): boolean {
  return typeof valor === "string" && valor.trim().startsWith("op://");
}

/** Nomes (nunca valores) das variáveis com referência `op://`. */
function nomesNaoResolvidos(): string[] {
  return ["BILHON_SUPABASE_URL", "BILHON_SUPABASE_SERVICE_ROLE_KEY"].filter((nome) =>
    segredoNaoResolvido(lerEnv(nome)),
  );
}

function msgSegredoNaoResolvido(nomes: string[]): string {
  return (
    `Segredo op:// não resolvido em ${nomes.join(" + ")} — o valor ainda é uma referência literal. ` +
    "Defina o valor real em .env.local."
  );
}

const MSG_SUPABASE_AUSENTE =
  "Supabase não configurado — defina BILHON_SUPABASE_URL + BILHON_SUPABASE_SERVICE_ROLE_KEY em .env.local (ver README).";

const MSG_ESCOPO_AUSENTE =
  `BILHON_KNOWLEDGE_BUCKET_FILTER não definida — declare o bucket do escopo da busca, ` +
  `ou assuma o corpus inteiro com o valor sentinela ${SENTINELA_CORPUS_INTEIRO} (ver .env.example).`;

/** As três formas de `BILHON_KNOWLEDGE_BUCKET_FILTER`. */
export type EscopoBusca =
  | { kind: "bucket"; valor: string }
  | { kind: "corpus-inteiro" }
  | { kind: "ausente" };

export function lerEscopoBusca(): EscopoBusca {
  const bruto = lerEnv("BILHON_KNOWLEDGE_BUCKET_FILTER");
  if (!bruto) return { kind: "ausente" };
  const valor = bruto.trim();
  if (valor === SENTINELA_CORPUS_INTEIRO) return { kind: "corpus-inteiro" };
  return { kind: "bucket", valor };
}

let escolhaCorpusInteiroRegistrada = false;

/** Registro estruturado em stdout, UMA vez por processo: buscar o corpus
 *  inteiro é legítimo (a RPC pode já estar restrita por outro mecanismo), mas
 *  precisa ser auditável. Só imprime nome de variável e a sentinela (constante
 *  pública do código) — nunca valor de env. */
function registrarEscolhaCorpusInteiro(): void {
  if (escolhaCorpusInteiroRegistrada) return;
  escolhaCorpusInteiroRegistrada = true;
  console.log(
    JSON.stringify({
      evento: "busca.escopo.corpus-inteiro-declarado",
      provider: "supabase-corpus",
      variavel: "BILHON_KNOWLEDGE_BUCKET_FILTER",
      sentinela: SENTINELA_CORPUS_INTEIRO,
      efeito: "bucket_filter=null em match_rag_chunks_hybrid — a busca alcança todo o corpus",
      ts: new Date().toISOString(),
    }),
  );
}

type RagChunkRow = {
  chunk_id: string;
  chunk_text: string;
  source_path: string | null;
  bucket: string | null;
  person: string | null;
  similarity: number | null;
  rrf_score: number | null;
};

function getClient() {
  const naoResolvidos = nomesNaoResolvidos();
  if (naoResolvidos.length > 0) {
    // recusa em vez de resolver: o app não entra no caminho do segredo
    // (resolvê-lo é de quem sobe o processo) e também não finge estar configurado
    throw new ProviderSearchError("backend", msgSegredoNaoResolvido(naoResolvidos));
  }
  const url = lerEnv("BILHON_SUPABASE_URL");
  const key = lerEnv("BILHON_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function embed(text: string): Promise<number[]> {
  const ollamaUrl = (lerEnv("BILHON_OLLAMA_URL") ?? OLLAMA_URL_PADRAO).trim().replace(/\/+$/, "") || OLLAMA_URL_PADRAO;
  const model = lerEnv("BILHON_EMBED_MODEL") ?? EMBED_MODEL_PADRAO;
  const res = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ollama /api/embeddings HTTP ${res.status}`);
  const data = (await res.json()) as { embedding?: number[] };
  if (!data.embedding?.length) throw new Error("ollama retornou embedding vazio");
  return data.embedding;
}

export class BilhonCorpusSearchProvider implements SemanticSearchProvider {
  async search(query: string, topK = 18): Promise<SearchHit[]> {
    const client = getClient();
    if (!client) {
      throw new ProviderSearchError("backend", MSG_SUPABASE_AUSENTE);
    }

    // escopo resolvido ANTES do embedding: erro de configuração não custa uma
    // chamada ao Ollama nem chega à RPC com bucket_filter: null por omissão
    const escopo = lerEscopoBusca();
    if (escopo.kind === "ausente") {
      throw new ProviderSearchError("backend", MSG_ESCOPO_AUSENTE);
    }
    if (escopo.kind === "corpus-inteiro") registrarEscolhaCorpusInteiro();
    // UM único bucket (igualdade estrita na RPC — lista não é suportada); null
    // só chega aqui pela sentinela, ou seja, por decisão declarada
    const bucketFilter = escopo.kind === "bucket" ? escopo.valor : null;

    let embedding: number[];
    try {
      embedding = await embed(query);
    } catch (e) {
      const detalhe = e instanceof Error ? e.message : String(e);
      throw new ProviderSearchError("ollama-offline", detalhe);
    }

    const { data, error } = await client
      .rpc("match_rag_chunks_hybrid", {
        query_embedding: embedding,
        query_text: query,
        match_count: topK,
        bucket_filter: bucketFilter,
        rrf_k: 60,
        p_rid: null,
      })
      .abortSignal(AbortSignal.timeout(30_000));
    if (error) throw new ProviderSearchError("backend", `match_rag_chunks_hybrid: ${error.message}`);

    const rows = (data ?? []) as RagChunkRow[];
    // ordem de ranking vem da RPC (rrf); pro DISPLAY usa-se `similarity`
    // (cosseno 0-1) — rrf_score tem teto ~2/rrf_k e viraria "3%" na UI
    return rows.map((row) => ({
      score: Math.round((row.similarity ?? 0) * 1000) / 1000,
      snippet: (row.chunk_text ?? "").slice(0, 400),
      chunkId: row.chunk_id,
      tipo: "bilhon" as const,
      fonteNome: row.bucket ?? row.person ?? "corpus",
      livroId: null,
      livroTitulo: row.source_path ?? row.chunk_id,
      // sem leitor dedicado para trechos do corpus — honesto: sem link
      linkLocal: "#",
      linkExterno: null,
    }));
  }
}

/** Resultado do diagnóstico de configuração do corpus — `motivo` é texto
 *  acionável para o operador, com nome de variável e nunca valor. */
export type DiagnosticoCorpus =
  | { ok: true; escopo: "bucket" | "corpus-inteiro" }
  | { ok: false; motivo: string };

/** Mesmo critério que a busca aplica, para o `status()` do provider não
 *  reportar "configurado" quando a busca já está condenada a falhar. */
export function bilhonCorpusDiagnostico(): DiagnosticoCorpus {
  const naoResolvidos = nomesNaoResolvidos();
  if (naoResolvidos.length > 0) return { ok: false, motivo: msgSegredoNaoResolvido(naoResolvidos) };
  if (!lerEnv("BILHON_SUPABASE_URL") || !lerEnv("BILHON_SUPABASE_SERVICE_ROLE_KEY")) {
    return { ok: false, motivo: MSG_SUPABASE_AUSENTE };
  }
  const escopo = lerEscopoBusca();
  if (escopo.kind === "ausente") return { ok: false, motivo: MSG_ESCOPO_AUSENTE };
  return { ok: true, escopo: escopo.kind };
}

export async function bilhonCorpusConfigured(): Promise<boolean> {
  return bilhonCorpusDiagnostico().ok;
}
