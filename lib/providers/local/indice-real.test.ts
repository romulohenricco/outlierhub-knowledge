import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@/lib/types";
import { TEM_SQLITE3_FTS5 } from "../../../scripts/populate/__tests__/_sqlite-cli";
import { LocalProvider } from "./index";
import { caminhoIndiceLocal, extrairTermos } from "./search";

/**
 * Integração com o índice REAL gerado por `npm run populate` (data/search/index.sqlite).
 * Só roda quando foi o populate que gerou o índice (data/.populated.json com o módulo `busca`
 * ok) e a CLI `sqlite3` com FTS5 existe (é por ela que o provider consulta): num clone limpo,
 * sem população, ou sem a CLI (o padrão no Windows), é ignorado.
 *  - sempre: consultas tiradas do PRÓPRIO índice (títulos de documentos da estante e das
 *    coleções), que valem para qualquer mega-brain — os hits são relevantes (os 3 primeiros
 *    contêm algum termo da consulta) e bem formados, e o clique de cada hit abre uma página
 *    que o app sabe ler (estante ou coleção);
 *  - POPULATE_E2E=1: consultas realistas em PT-BR e EN sobre o conteúdo DESTA distribuição do
 *    mega-brain ("pipeline MCE", "conclave", "workspace L0"…), que outro mega-brain não tem.
 * Só leitura: nada em data/ é alterado.
 */

vi.mock("server-only", () => ({}));

// o ambiente do desenvolvedor não pode desviar o teste para outro índice
delete process.env.BILHON_LOCAL_SEARCH_DB;

/** Módulos que `npm run populate` concluiu (`ok: true`) segundo data/.populated.json; vazio sem o marcador. */
function modulosPopulados(dataDir: string): Set<string> {
  try {
    const marcador = JSON.parse(readFileSync(path.join(dataDir, ".populated.json"), "utf8")) as {
      modulos?: Record<string, { ok?: unknown } | null>;
    };
    return new Set(Object.entries(marcador.modulos ?? {}).filter(([, m]) => m?.ok === true).map(([nome]) => nome));
  } catch {
    return new Set();
  }
}

const POPULADOS = modulosPopulados(path.join(process.cwd(), "data"));
const TEM_INDICE = existsSync(caminhoIndiceLocal()) && POPULADOS.has("busca") && TEM_SQLITE3_FTS5;
/** O clique abre /livro/<id> (catálogo do módulo `livros`) ou /colecao/<slug>/<doc> (stores do módulo `colecoes`). */
const TEM_PAGINAS = POPULADOS.has("livros") && POPULADOS.has("colecoes");
/** Conteúdo desta distribuição (padrão de scripts/populate/__tests__/livros-colecoes.test.ts): `POPULATE_E2E=1 npx vitest run <arquivo>`. */
const E2E = TEM_INDICE && process.env.POPULATE_E2E === "1";

const dobrar = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const CONSULTAS_DA_DISTRIBUICAO = [
  "pipeline MCE",
  "conclave",
  "constituicao",
  "governanca",
  "DNA schema",
  "squad",
  "workspace L0",
  "RAG",
  "Constituição do sistema",
  "knowledge buckets isolation",
  "como criar um agente",
  "quality gate",
];

/**
 * Consultas de qualquer mega-brain: os títulos dos primeiros documentos de cada tipo (estante e
 * coleção) do próprio índice, lidos com node:sqlite (sem passar pelo provider que está em teste).
 */
function consultasDoIndice(porTipo = 2): string[] {
  const db = new DatabaseSync(caminhoIndiceLocal(), { readOnly: true });
  try {
    const linhas = db.prepare("SELECT tipo, livro_titulo AS titulo FROM busca ORDER BY rowid").all() as { tipo: string; titulo: string | null }[];
    const porTipoEscolhidas = new Map<string, string[]>();
    for (const { tipo, titulo } of linhas) {
      const lista = porTipoEscolhidas.get(tipo) ?? [];
      // título com ao menos um termo de 4+ letras: casa por prefixo e entra na conferência de relevância
      if (titulo && lista.length < porTipo && !lista.includes(titulo) && extrairTermos(titulo).some((t) => t.length >= 4)) lista.push(titulo);
      porTipoEscolhidas.set(tipo, lista);
    }
    return [...porTipoEscolhidas.values()].flat();
  } finally {
    db.close();
  }
}
const CONSULTAS_DO_INDICE = TEM_INDICE ? consultasDoIndice() : [];

/** Hits relevantes (os 3 primeiros contêm algum termo da consulta), bem formados e dentro do topK. */
function conferirHits(consulta: string, hits: SearchHit[]) {
  expect(hits.length, `"${consulta}" sem hits`).toBeGreaterThan(0);
  expect(hits.length).toBeLessThanOrEqual(18);

  const radicais = extrairTermos(consulta).map((t) => dobrar(t).slice(0, 4));
  for (const h of hits.slice(0, 3)) {
    const alvo = dobrar(`${h.livroTitulo} ${h.snippet} ${h.chunkId}`);
    expect(
      radicais.some((r) => alvo.includes(r)),
      `top-3 sem nenhum termo de "${consulta}": ${h.livroTitulo}`,
    ).toBe(true);
  }

  for (const h of hits) {
    expect(h.score).toBeGreaterThan(0);
    expect(h.score).toBeLessThan(1);
    expect(h.snippet.length).toBeGreaterThan(0);
    expect(h.snippet.length).toBeLessThanOrEqual(400);
    expect(h.snippet).not.toMatch(/<mark/i);
    expect(h.chunkId).toMatch(/#\d+$/);
    expect(h.linkExterno).toBeNull();
    if (h.tipo === "livro") {
      expect(h.livroId).toBeTruthy();
      expect(h.linkLocal).toBe(`/livro/${encodeURIComponent(h.livroId!)}`);
    } else {
      expect(h.tipo).toBe("bilhon");
      expect(h.livroId).toBeNull();
      expect(h.linkLocal).toMatch(/^\/colecao\/[^/]+\/[^/]+$/);
    }
  }
  // ordem não crescente de score
  for (let i = 1; i < hits.length; i++) expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
  // no máximo 3 trechos por arquivo
  const porTitulo = new Map<string, number>();
  for (const h of hits) porTitulo.set(h.livroTitulo, (porTitulo.get(h.livroTitulo) ?? 0) + 1);
  expect(Math.max(...porTitulo.values())).toBeLessThanOrEqual(3);
}

/** O clique de cada hit (6 primeiros de cada consulta) abre uma página que o app lê. */
async function conferirCliques(consultas: string[]) {
  // os mesmos leitores das páginas app/livro/[id] e app/colecao/[slug]/[doc]
  const { getBook } = await import("@/lib/catalog");
  const { getTranscript } = await import("@/lib/colecoes");
  const p = new LocalProvider();
  let livros = 0;
  let colecoes = 0;
  for (const consulta of consultas) {
    for (const h of (await p.search(consulta, 18)).slice(0, 6)) {
      if (h.tipo === "livro") {
        const livro = await getBook(h.livroId!);
        expect(livro, `/livro/${h.livroId} sem entrada no catálogo`).not.toBeNull();
        // o título confere: um link que caísse numa entrada manual do usuário mostraria outro livro
        expect(livro!.titulo).toBe(h.livroTitulo);
        livros++;
      } else {
        const [, slug, doc] = h.linkLocal.split("/").slice(1);
        const t = await getTranscript(decodeURIComponent(slug), decodeURIComponent(doc));
        expect(t, `${h.linkLocal} sem documento no store da coleção`).not.toBeNull();
        colecoes++;
      }
    }
  }
  expect(livros + colecoes).toBeGreaterThan(0);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.skipIf(!TEM_INDICE)("índice real gerado pelo populate (qualquer mega-brain)", () => {
  it("status(): configurado, com trechos e arquivos", async () => {
    const s = await new LocalProvider().status();
    expect(s.configured).toBe(true);
    expect(s.reason).toMatch(/Busca local ativa \(\d+ trechos de \d+ arquivos/);
  });

  it("consultas tiradas do próprio índice (títulos da estante e das coleções): hits relevantes, bem formados e dentro do topK", async () => {
    expect(CONSULTAS_DO_INDICE.length).toBeGreaterThan(0);
    const provider = new LocalProvider();
    for (const consulta of CONSULTAS_DO_INDICE) conferirHits(consulta, await provider.search(consulta, 18));
    console.log("[índice real] consultas tiradas do índice:", JSON.stringify(CONSULTAS_DO_INDICE));
  });

  it.skipIf(!TEM_PAGINAS)("o clique de cada hit abre uma página que o app lê: /livro/<id> no catálogo, /colecao/<slug>/<doc> no store", async () => {
    await conferirCliques(CONSULTAS_DO_INDICE);
  });

  it("rota POST /api/search com BILHON_KNOWLEDGE_PROVIDER=local devolve SearchResposta ok", async () => {
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "local");
    const { POST } = await import("@/app/api/search/route");
    const consulta = CONSULTAS_DO_INDICE[0];
    const res = await POST(
      new Request("http://127.0.0.1:3301/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: consulta }),
      }),
    );
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { ok: boolean; query: string; hits: { chunkId: string; tipo: string }[] };
    expect(corpo.ok).toBe(true);
    expect(corpo.query).toBe(consulta);
    expect(corpo.hits.length).toBeGreaterThan(0);
    expect(corpo.hits.length).toBeLessThanOrEqual(18);
  });

  it("rota POST /api/search: tentativa de injeção responde 200 com hits (não 503) e o índice segue íntegro", async () => {
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "local");
    const { POST } = await import("@/app/api/search/route");
    const res = await POST(
      new Request("http://127.0.0.1:3301/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "\"; DROP TABLE busca; --" }),
      }),
    );
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { ok: boolean; hits: unknown[] };
    expect(corpo.ok).toBe(true);
    expect(Array.isArray(corpo.hits)).toBe(true);
  });

  it("acento e caixa não mudam o resultado: governanca = GOVERNANÇA", async () => {
    const p = new LocalProvider();
    const a = await p.search("governanca", 18);
    const b = await p.search("GOVERNANÇA", 18);
    expect(b).toEqual(a);
  });
});

describe.skipIf(!E2E)("conteúdo desta distribuição do mega-brain (POPULATE_E2E=1)", () => {
  it.each(CONSULTAS_DA_DISTRIBUICAO)("%s: hits relevantes, bem formados e dentro do topK", async (consulta) => {
    conferirHits(consulta, await new LocalProvider().search(consulta, 18));
  });

  it.skipIf(!TEM_PAGINAS)("o clique de cada hit de consultas sobre o conteúdo abre uma página que o app lê", async () => {
    await conferirCliques(["conclave", "pipeline MCE", "squad", "governanca"]);
  });
});
