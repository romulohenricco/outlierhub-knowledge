import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fábrica (kind "local"), composição do LocalProvider (grafo reaproveitado do
 * provider megabrain) e `status()`. O índice é um FTS5 temporário criado com a
 * CLI sqlite3.
 */

// `server-only` é um marcador do Next que lança fora do runtime react-server;
// a fábrica importa também o provider "supabase", que o usa.
vi.mock("server-only", () => ({}));

function temFts5(): boolean {
  try {
    execFileSync("sqlite3", [":memory:", "CREATE VIRTUAL TABLE t USING fts5(x);"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
const TEM_FTS5 = temFts5();

function temSqlite3(): boolean {
  try {
    execFileSync("sqlite3", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
// a CLI pode existir sem FTS5; o que muda o motivo do status() é ela existir ou não
const TEM_SQLITE3 = temSqlite3();

let tmp: string;
let indice: string;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "provider-local-"));
  indice = path.join(tmp, "index.sqlite");
  if (!TEM_FTS5) return;
  const sql = [
    "CREATE VIRTUAL TABLE busca USING fts5(titulo, caminho, texto, tipo UNINDEXED, livro_id UNINDEXED, livro_titulo UNINDEXED, fonte_nome UNINDEXED, chunk_id UNINDEXED, link_local UNINDEXED, doc_rel UNINDEXED, chunk_idx UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');",
    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;",
    "INSERT INTO meta VALUES ('schema_version', '1');",
    "INSERT INTO busca VALUES ('Conclave', 'agents/system/conclave/README.md', 'O conclave delibera com agentes de perspectivas distintas.', 'livro', 'agents-system-conclave-readme', 'Conclave', 'agentes', 'agents-system-conclave-readme.md#0', '/livro/agents-system-conclave-readme', 'agents/system/conclave/README.md', 0);",
  ].join("\n");
  execFileSync("sqlite3", [indice], { input: sql, stdio: ["pipe", "pipe", "pipe"] });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function fabrica() {
  const { getKnowledgeProvider } = await import("../index");
  return getKnowledgeProvider;
}

describe("getKnowledgeProvider: kind local", () => {
  it("local: liga o LocalProvider", async () => {
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "local");
    const { LocalProvider } = await import("./index");
    expect((await fabrica())()).toBeInstanceOf(LocalProvider);
  });

  it("local com espaços em volta continua local", async () => {
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "  local  ");
    const { LocalProvider } = await import("./index");
    expect((await fabrica())()).toBeInstanceOf(LocalProvider);
  });

  it("os outros kinds seguem iguais (demo, supabase, megabrain legado)", async () => {
    const { DemoProvider } = await import("../demo");
    const { MegabrainProvider } = await import("../megabrain");
    const get = await fabrica();
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "demo");
    expect(get()).toBeInstanceOf(DemoProvider);
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "supabase");
    expect(get()).toBeInstanceOf(MegabrainProvider);
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "megabrain");
    expect(get()).toBeInstanceOf(MegabrainProvider);
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "");
    expect(get()).toBeInstanceOf(DemoProvider);
  });

  it("valor inválido: a mensagem cita demo, supabase e local, sem ecoar o valor", async () => {
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "valor-estranho");
    const get = await fabrica();
    expect(() => get()).toThrowError(/"demo" ou "supabase"/);
    expect(() => get()).toThrowError(/"local"/);
    try {
      get();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("valor-estranho");
      expect(msg).not.toContain("megabrain");
    }
  });
});

describe("LocalProvider", () => {
  it("implementa toda a interface KnowledgeProvider", async () => {
    const { LocalProvider } = await import("./index");
    const p = new LocalProvider();
    for (const m of [
      "grafo", "grafoReferencias", "grafoTopologia", "impactoDeMover",
      "evidencias", "fontesDoConceito", "kgStats", "search", "status",
    ] as const) {
      expect(typeof p[m], m).toBe("function");
    }
  });

  it("o grafo é o do provider megabrain (composição, sem reescrever)", async () => {
    const { MegabrainGraphProvider } = await import("../megabrain/graph");
    const { LocalProvider } = await import("./index");
    const stats = { conceitos: 3, livros: 2, confirmed: 1, claimed: 1, disputed: 1 };
    const kg = vi.spyOn(MegabrainGraphProvider.prototype, "kgStats").mockResolvedValue(stats);
    const g = vi.spyOn(MegabrainGraphProvider.prototype, "grafo").mockResolvedValue({ nodes: [], edges: [] });
    const p = new LocalProvider();
    expect(await p.kgStats()).toEqual(stats);
    expect(await p.grafo({ status: ["confirmed"] })).toEqual({ nodes: [], edges: [] });
    expect(kg).toHaveBeenCalledTimes(1);
    expect(g).toHaveBeenCalledWith({ status: ["confirmed"] });
  });

  it("repassa as opções novas do contrato sem filtrar: foco (deep-link ?focus=), topologia e impacto", async () => {
    const { MegabrainGraphProvider } = await import("../megabrain/graph");
    const { LocalProvider } = await import("./index");
    const g = vi.spyOn(MegabrainGraphProvider.prototype, "grafo").mockResolvedValue({ nodes: [], edges: [] });
    const t = vi.spyOn(MegabrainGraphProvider.prototype, "grafoTopologia").mockResolvedValue({
      nodes: [],
      edges: [],
      meta: { totalNos: 0 },
    } as never);
    const imp = vi.spyOn(MegabrainGraphProvider.prototype, "impactoDeMover").mockResolvedValue(null);
    const p = new LocalProvider();
    const opts = { status: ["confirmed", "claimed"], tema: "governanca", incluirLivros: true, maxEdges: 50, foco: "conclave" };
    await p.grafo(opts);
    expect(g).toHaveBeenCalledWith(opts);
    await p.grafoTopologia({ soMortas: true, planos: ["engine"] });
    expect(t).toHaveBeenCalledWith({ soMortas: true, planos: ["engine"] });
    expect(await p.impactoDeMover("engine/intelligence")).toBeNull();
    expect(imp).toHaveBeenCalledWith("engine/intelligence");
  });

  it.skipIf(!TEM_FTS5)("search() consulta o índice local (BILHON_LOCAL_SEARCH_DB)", async () => {
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", indice);
    const { LocalProvider } = await import("./index");
    const hits = await new LocalProvider().search("conclave", 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      livroId: "agents-system-conclave-readme",
      tipo: "livro",
      linkLocal: "/livro/agents-system-conclave-readme",
      chunkId: "agents-system-conclave-readme.md#0",
    });
  });

  it("status() sem índice: configured=false, motivo acionável em PT-BR", async () => {
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", path.join(tmp, "nao-existe.sqlite"));
    const { LocalProvider } = await import("./index");
    const s = await new LocalProvider().status();
    expect(s.configured).toBe(false);
    expect(s.reason).toMatch(/Provider "local"/);
    expect(s.reason).toMatch(/npm run populate/);
    expect(s.reason).toMatch(/BILHON_KNOWLEDGE_PROVIDER=demo/);
  });

  it("status() com arquivo corrompido: configured=false (não lança)", async () => {
    const lixo = path.join(tmp, "corrompido.sqlite");
    writeFileSync(lixo, "sem formato sqlite ".repeat(80));
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", lixo);
    const { LocalProvider } = await import("./index");
    const s = await new LocalProvider().status();
    expect(s.configured).toBe(false);
    // com a CLI o arquivo é ilegível e a saída é repopular; sem ela (ex.: runner Windows do CI) o motivo é instalá-la
    expect(s.reason).toMatch(TEM_SQLITE3 ? /npm run populate/ : /sqlite3/);
  });

  it.skipIf(!TEM_FTS5)("status() com índice e sem grafo: configured=true, avisa modo somente-busca", async () => {
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", indice);
    vi.stubEnv("BILHON_KG_DB", path.join(tmp, "sem-grafo.sqlite"));
    const { LocalProvider } = await import("./index");
    const s = await new LocalProvider().status();
    expect(s.configured).toBe(true);
    expect(s.reason).toMatch(/1 trechos de 1 arquivos/);
    expect(s.reason).toMatch(/somente-busca/);
  });

  it.skipIf(!TEM_FTS5)("status() com índice e grafo: configured=true, sem aviso de grafo", async () => {
    const kg = path.join(tmp, "kg.sqlite");
    writeFileSync(kg, "");
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", indice);
    vi.stubEnv("BILHON_KG_DB", kg);
    const { LocalProvider } = await import("./index");
    const s = await new LocalProvider().status();
    expect(s.configured).toBe(true);
    expect(s.reason).not.toMatch(/somente-busca/);
  });
});
