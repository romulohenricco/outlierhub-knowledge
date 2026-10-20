import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * O grafo vem cortado nas N arestas mais citadas (LIMIT no SQL). Um conceito de
 * nicho, citado por um livro só, nunca entra nesse corte, e o deep-link ?focus=
 * (os chips de conceito da página do livro) não achava nada. Com `foco`, o nó e
 * as arestas dele entram junto do corte. Roda num sqlite sintético; sem a CLI
 * sqlite3 no PATH o teste é pulado.
 */
function temSqlite(): boolean {
  try {
    execFileSync("sqlite3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!temSqlite())("grafo — foco garante o nó fora do corte", () => {
  let dir: string;
  const status = ["confirmed", "claimed"];

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kg-foco-"));
    const db = path.join(dir, "kg.sqlite");
    // 3 conceitos muito citados (entram no corte de 2 arestas) e 1 de nicho (fora dele)
    execFileSync("sqlite3", [
      db,
      `CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT NOT NULL, tipo TEXT NOT NULL);
       CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT, rel TEXT, dst TEXT,
         status TEXT DEFAULT 'claimed', n_fontes INTEGER DEFAULT 1, peso REAL DEFAULT 0.3);
       CREATE TABLE evidences (id INTEGER PRIMARY KEY AUTOINCREMENT, edge_id INTEGER, livro TEXT,
         chunk_id TEXT, trecho TEXT, confianca REAL);
       INSERT INTO nodes VALUES ('hub-a','Hub A','conceito'),('hub-b','Hub B','conceito'),
         ('hub-c','Hub C','conceito'),('nicho','Conceito de Nicho','conceito'),('x','X','conceito');
       INSERT INTO edges (src,rel,dst,status,n_fontes,peso) VALUES
         ('hub-a','relaciona','hub-b','confirmed',9,0.9),
         ('hub-b','relaciona','hub-c','confirmed',8,0.8),
         ('nicho','relaciona','x','claimed',1,0.2);`,
    ]);
    vi.stubEnv("BILHON_KG_DB", db);
    vi.resetModules();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("sem foco, o conceito de nicho fica fora do corte (é o bug)", async () => {
    const { grafo } = await import("./kg");
    const g = await grafo({ status, maxEdges: 2 });
    expect(g.nodes.some((n) => n.id === "nicho")).toBe(false);
  });

  it("com foco, o nó e as arestas dele entram junto do corte", async () => {
    const { grafo } = await import("./kg");
    const g = await grafo({ status, maxEdges: 2, foco: "nicho" });
    expect(g.nodes.some((n) => n.id === "nicho")).toBe(true);
    const dele = g.edges.filter((e) => e.src === "nicho" || e.dst === "nicho");
    expect(dele.length).toBeGreaterThan(0);
    // todo nó de aresta tem que existir em nodes (senão o canvas quebra)
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(dele.every((e) => ids.has(e.src) && ids.has(e.dst))).toBe(true);
  });

  it("foco aceita o label e não duplica aresta que já estava no corte", async () => {
    const { grafo } = await import("./kg");
    const g = await grafo({ status, maxEdges: 2, foco: "Hub B" });
    const ids = g.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("foco com aspas não quebra o SQL", async () => {
    const { grafo } = await import("./kg");
    await expect(grafo({ status, foco: "x' OR '1'='1" })).resolves.toBeTruthy();
  });
});
