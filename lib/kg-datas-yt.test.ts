import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TEM_SQLITE3_FTS5 } from "../scripts/populate/__tests__/_sqlite-cli";

/**
 * Datas das fontes `yt-…` do grafo de conhecimento (datasDoConhecimento em lib/kg.ts):
 *  - o livro de estante `yt-guia.pdf` vira o nó `livro:yt-guia.pdf`, que NÃO é uma fonte
 *    `yt-<coleção>:<caminho>`. Antes ele entrava nas fontes sem caminho, o path.join
 *    lançava TypeError e o grafo() inteiro caía (/api/graph junto);
 *  - a fonte `yt-docs:README.md` só ganha data quando o manifesto do populate comprova
 *    que a raiz é a do Megabrain que gerou o grafo. Com `--repo` externo o BILHON_ROOT
 *    não é gravado, a raiz vira a pasta do app e ela pegaria o mtime do README do
 *    PRÓPRIO app (data errada com cara de certa).
 * Roda num sqlite sintético; sem a CLI sqlite3 no PATH o bloco é pulado.
 */
describe.skipIf(!TEM_SQLITE3_FTS5)("grafo — datas das fontes yt-", () => {
  let base: string;
  let megabrain: string; // repositório que "gerou" o grafo
  let app: string; // pasta do app: raiz quando o populate leu um --repo externo
  let sqlite: string; // banco sintético, copiado para cada cenário
  let sha: string;
  const status = ["confirmed", "claimed"];

  const toca = (arq: string, dia: string) => {
    const d = new Date(`${dia}T12:00:00`);
    utimesSync(arq, d, d);
  };
  const posix = (p: string) => p.split(path.sep).join("/");

  /** Pasta de grafo com uma cópia do sqlite e, se houver, o manifesto do populate ao lado. */
  function cenario(nome: string, manifesto: Record<string, unknown> | null): string {
    const dir = path.join(base, "kg", nome);
    mkdirSync(dir, { recursive: true });
    const db = path.join(dir, "livros-kg.sqlite");
    copyFileSync(sqlite, db);
    if (manifesto) writeFileSync(path.join(dir, "populate-grafo.json"), JSON.stringify(manifesto));
    return db;
  }
  /** `raiz` como o populate a gravaria: relativa à pasta do manifesto. */
  const raizDe = (db: string, alvo: string) => posix(path.relative(path.dirname(db), alvo));

  async function nos(db: string, raizApp: string) {
    vi.stubEnv("BILHON_KG_DB", db);
    vi.stubEnv("BILHON_ROOT", raizApp);
    vi.resetModules();
    const { grafo } = await import("./kg");
    const g = await grafo({ status });
    return new Map(g.nodes.map((n) => [n.id, n]));
  }

  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), "kg-datas-yt-"));
    megabrain = path.join(base, "megabrain");
    app = path.join(base, "app");
    const livros = path.join(base, "livros");
    for (const d of [megabrain, app, livros]) mkdirSync(d, { recursive: true });

    // o README do Megabrain é a fonte; o do app é o homônimo que não pode emprestar a data
    writeFileSync(path.join(megabrain, "README.md"), "# Megabrain");
    toca(path.join(megabrain, "README.md"), "2026-03-04");
    writeFileSync(path.join(app, "README.md"), "# App");
    toca(path.join(app, "README.md"), "2026-09-09");

    // estante com um livro cujo nome começa com "yt-"
    writeFileSync(path.join(livros, "yt-guia.pdf"), "%PDF-1.4");
    toca(path.join(livros, "yt-guia.pdf"), "2026-01-02");
    const catalogo = path.join(base, "catalogo.json");
    writeFileSync(
      catalogo,
      JSON.stringify({
        livros: [{
          id: "yt-guia", titulo: "Guia", arquivo: "yt-guia.pdf", formato: "pdf", tema: "geral", cluster: null,
          origem: "INBOX", sizeBytes: 8, vizinhos: [], proveniencia: { origemPath: "teste", motivo: "teste" },
        }],
      }),
    );
    vi.stubEnv("BILHON_CATALOGO", catalogo);
    vi.stubEnv("BILHON_LIVROS_DIR", livros);
    vi.stubEnv("BILHON_LIVROS_DOMINIOS", path.join(base, "nao-existe-dominios.json"));
    vi.stubEnv("BILHON_LIVROS_HASHES", path.join(base, "nao-existe-hashes.json"));
    vi.stubEnv("BILHON_GRAPH_LAYOUT", path.join(base, "nao-existe-layout.json"));

    sqlite = path.join(base, "modelo.sqlite");
    execFileSync("sqlite3", [
      sqlite,
      `CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT NOT NULL, tipo TEXT NOT NULL);
       CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT, rel TEXT, dst TEXT,
         status TEXT DEFAULT 'claimed', n_fontes INTEGER DEFAULT 1, peso REAL DEFAULT 0.3);
       CREATE TABLE evidences (id INTEGER PRIMARY KEY AUTOINCREMENT, edge_id INTEGER, livro TEXT,
         chunk_id TEXT, trecho TEXT, confianca REAL);
       INSERT INTO nodes VALUES ('livro:yt-guia.pdf','Guia','livro'),
         ('livro:yt-docs:README.md','README.md','livro'),
         ('c-guia','Conceito do Guia','conceito'),('c-readme','Conceito do README','conceito');
       INSERT INTO edges (id,src,rel,dst,status,n_fontes,peso) VALUES
         (1,'livro:yt-guia.pdf','menciona','c-guia','claimed',1,0.5),
         (2,'livro:yt-docs:README.md','menciona','c-readme','claimed',1,0.5);
       INSERT INTO evidences (edge_id,livro,chunk_id,trecho,confianca) VALUES
         (1,'yt-guia.pdf','yt-guia.pdf#0','guia',0.8),
         (2,'yt-docs:README.md','README.md#0','Megabrain',0.8);`,
    ]);
    sha = createHash("sha256").update(readFileSync(sqlite)).digest("hex");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(base, { recursive: true, force: true });
  });

  it("livro de estante `yt-guia.pdf` não derruba o grafo e fica com a data da estante", async () => {
    // sem manifesto: o TypeError acontecia antes de qualquer leitura dele
    const n = await nos(cenario("estante", null), megabrain);
    expect(n.get("livro:yt-guia.pdf")?.livroId).toBe("yt-guia");
    expect(n.get("livro:yt-guia.pdf")?.data).toBe("2026-01-02");
    expect(n.get("c-guia")?.data).toBe("2026-01-02");
  });

  it("com a raiz comprovada pelo manifesto, a fonte ganha o mtime do arquivo no Megabrain", async () => {
    const db = path.join(base, "kg", "comprovado", "livros-kg.sqlite");
    cenario("comprovado", { sqliteSha256: sha, raiz: raizDe(db, megabrain) });
    const n = await nos(db, megabrain);
    expect(n.get("livro:yt-docs:README.md")?.data).toBe("2026-03-04");
    expect(n.get("c-readme")?.data).toBe("2026-03-04");
    expect(n.get("livro:yt-guia.pdf")?.data).toBe("2026-01-02");
  });

  it("BILHON_ROOT acima do Megabrain também serve: a raiz do grafo fica dentro dela", async () => {
    const db = path.join(base, "kg", "acima", "livros-kg.sqlite");
    cenario("acima", { sqliteSha256: sha, raiz: raizDe(db, megabrain) });
    const n = await nos(db, base);
    expect(n.get("livro:yt-docs:README.md")?.data).toBe("2026-03-04");
  });

  it("--repo externo (raiz = pasta do app): sem data, nunca a do README do próprio app", async () => {
    const db = path.join(base, "kg", "externo", "livros-kg.sqlite");
    cenario("externo", { sqliteSha256: sha, raiz: raizDe(db, megabrain) });
    const n = await nos(db, app);
    expect(n.get("livro:yt-docs:README.md")?.data).toBeUndefined();
    expect(n.get("c-readme")?.data).toBeUndefined();
    // a estante não depende da raiz do grafo
    expect(n.get("livro:yt-guia.pdf")?.data).toBe("2026-01-02");
  });

  it.each([
    { caso: "sem manifesto", dir: "sem-manifesto", manifesto: () => null },
    { caso: "manifesto sem `raiz` (gerado antes de o grafo.mjs gravar o campo)", dir: "sem-raiz", manifesto: () => ({ sqliteSha256: sha }) },
    // a raiz aponta para o Megabrain certo; só o hash é de outro sqlite
    { caso: "manifesto de outro sqlite (hash não confere)", dir: "outro-sqlite", manifesto: () => ({ sqliteSha256: "0".repeat(64), raiz: "../../megabrain" }) },
  ])("$caso: não comprova a raiz e a fonte fica sem data", async ({ dir, manifesto }) => {
    const n = await nos(cenario(dir, manifesto()), megabrain);
    expect(n.has("livro:yt-docs:README.md")).toBe(true);
    expect(n.get("livro:yt-docs:README.md")?.data).toBeUndefined();
    expect(n.get("c-readme")?.data).toBeUndefined();
  });
});
