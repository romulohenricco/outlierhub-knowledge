import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import runBusca, { VERSAO_ESQUEMA } from "../../../scripts/populate/busca.mjs";
import runLivros from "../../../scripts/populate/livros.mjs";
import { scanRepo } from "../../../scripts/populate/common.mjs";
import { LocalSearchProvider, VERSAO_ESQUEMA_ESPERADA, diagnosticoIndiceLocal } from "./search";

/**
 * Contrato ESCRITOR x LEITOR do provider "local": o índice que `npm run populate`
 * grava (scripts/populate/busca.mjs, com node:sqlite) tem de ser o que
 * `LocalSearchProvider` lê (CLI sqlite3), e o link de cada hit tem de abrir o
 * registro certo na estante do app — inclusive quando o usuário tem entradas
 * MANUAIS no catálogo (PDFs importados à mão), que o populate preserva.
 * Tudo em pastas temporárias: um mega-brain sintético e um data/ descartável.
 */

function sqliteComFts5(): boolean {
  try {
    execFileSync("sqlite3", [":memory:", "CREATE VIRTUAL TABLE t USING fts5(x);"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
const TEM_FTS5 = sqliteComFts5();

const palavras = (base: string, n: number) => Array.from({ length: n }, (_, i) => `${base}${i % 9}`).join(" ");

/** Mega-brain mínimo: dois documentos (um com id que o usuário também usou), um código e um config. */
const ARQUIVOS: Record<string, string> = {
  "docs/conclave.md": `# Conclave\n\nO conclave delibera com agentes de perspectivas distintas. ${palavras("debate", 40)}\n`,
  "docs/hooks.md": `# Hooks do sistema\n\nGanchos de ciclo de vida: zarabatana dispara antes de cada ferramenta. ${palavras("evento", 40)}\n`,
  "engine/pipeline/runner.py": "def rodar_pipeline(lote):\n    \"\"\"orquestrador quimera do pipeline MCE\"\"\"\n    return lote\n",
  "squads/base/config.yaml": "name: squad-base\ndescricao: squad de exemplo com o termo pelicano\n",
};

let tmp: string;
let repo: string;
let docs: Awaited<ReturnType<typeof scanRepo>>["docs"];
let contador = 0;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "busca-populate-"));
  repo = path.join(tmp, "repo");
  for (const marca of ["engine", ".claude"]) await mkdir(path.join(repo, marca), { recursive: true });
  for (const [rel, texto] of Object.entries(ARQUIVOS)) {
    await mkdir(path.dirname(path.join(repo, rel)), { recursive: true });
    await writeFile(path.join(repo, rel), texto, "utf8");
  }
  ({ docs } = await scanRepo(repo));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** data/ novo a cada teste (o índice e o catálogo de um não vazam para o outro). */
async function novoData(): Promise<string> {
  const d = path.join(tmp, `data-${++contador}`);
  await mkdir(d, { recursive: true });
  return d;
}

const ctxDe = (dataDir: string) => ({ repoRoot: repo, dataDir, docs, excluded: [], opts: {}, resultados: {} });

type Catalogo = { livros: { id: string; titulo: string; arquivo: string; origem: string; proveniencia?: { origemPath: string } }[] };
const lerCatalogo = async (dataDir: string) =>
  JSON.parse(await readFile(path.join(dataDir, "livros", "catalogo.json"), "utf8")) as Catalogo;

const buscar = (dataDir: string, consulta: string) => {
  vi.stubEnv("BILHON_LOCAL_SEARCH_DB", path.join(dataDir, "search", "index.sqlite"));
  return new LocalSearchProvider().search(consulta, 18);
};

const hashDoArquivo = async (f: string) => createHash("sha256").update(await readFile(f)).digest("hex");

it("versão do esquema: a que o populate grava é a que o provider aceita", () => {
  expect(String(VERSAO_ESQUEMA)).toBe(VERSAO_ESQUEMA_ESPERADA);
});

describe.skipIf(!TEM_FTS5)("busca.mjs -> LocalSearchProvider", () => {
  it("documento da estante abre em /livro/<id do catálogo>; código e config abrem na coleção", async () => {
    const data = await novoData();
    await runLivros(ctxDe(data));
    const r = await runBusca(ctxDe(data));
    expect(r.resumo).toMatchObject({ arquivos: 4, livros: 2, colecoes: 2, foraDaEstante: 0 });

    const cat = await lerCatalogo(data);
    const conclave = cat.livros.find((l) => l.proveniencia?.origemPath === "docs/conclave.md")!;
    const [hit] = await buscar(data, "conclave delibera");
    expect(hit).toMatchObject({
      tipo: "livro",
      livroId: conclave.id,
      livroTitulo: conclave.titulo,
      linkLocal: `/livro/${conclave.id}`,
      chunkId: `${docs.find((d) => d.rel === "docs/conclave.md")!.arquivo}#0`,
      linkExterno: null,
    });

    const [codigo] = await buscar(data, "quimera");
    const runner = docs.find((d) => d.rel === "engine/pipeline/runner.py")!;
    expect(codigo).toMatchObject({
      tipo: "bilhon",
      livroId: null,
      chunkId: "engine/pipeline/runner.py#0",
      fonteNome: runner.colecao,
      linkLocal: `/colecao/${encodeURIComponent(runner.colecao)}/${encodeURIComponent("engine/pipeline/runner.py")}`,
    });
    expect((await buscar(data, "pelicano"))[0]?.tipo).toBe("bilhon");

    const diag = await diagnosticoIndiceLocal();
    expect(diag).toEqual({ ok: true, trechos: 4, arquivos: 4 });
  });

  it("entrada MANUAL com o mesmo id de um documento: o link segue o id que o livros deu ao documento, nunca o livro do usuário", async () => {
    const data = await novoData();
    const manual = {
      id: "docs-hooks",
      titulo: "Hooks (PDF importado à mão)",
      arquivo: "hooks.pdf",
      formato: "pdf",
      tema: "Copywriting",
      cluster: null,
      origem: "bilhon-knowledge",
      sizeBytes: 9,
      vizinhos: [],
      proveniencia: { origemPath: "importado/hooks.pdf", motivo: "manual" },
    };
    await mkdir(path.join(data, "livros", "arquivos"), { recursive: true });
    await writeFile(path.join(data, "livros", "arquivos", "hooks.pdf"), "%PDF-1.4\n");
    await writeFile(path.join(data, "livros", "catalogo.json"), `${JSON.stringify({ livros: [manual] }, null, 2)}\n`);
    expect(docs.find((d) => d.rel === "docs/hooks.md")!.id).toBe(manual.id); // a colisão é real

    await runLivros(ctxDe(data));
    await runBusca(ctxDe(data));

    const cat = await lerCatalogo(data);
    expect(cat.livros.find((l) => l.id === manual.id)).toMatchObject({ origem: "bilhon-knowledge", arquivo: "hooks.pdf" });
    const gerado = cat.livros.find((l) => l.proveniencia?.origemPath === "docs/hooks.md")!;
    expect(gerado.id).not.toBe(manual.id);

    const hits = await buscar(data, "zarabatana");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ tipo: "livro", livroId: gerado.id, linkLocal: `/livro/${gerado.id}` });
    expect(hits[0].linkLocal).not.toBe(`/livro/${manual.id}`);
  });

  it("catálogo ausente: documento abre pela coleção (nada de /livro/ que daria 404) e o módulo avisa", async () => {
    const data = await novoData();
    const r = await runBusca(ctxDe(data));
    expect(r.resumo).toMatchObject({ livros: 0, colecoes: 4 });
    expect(r.avisos.join(" ")).toMatch(/catálogo da estante .* ausente ou ilegível/);

    const hits = await buscar(data, "conclave");
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.tipo).toBe("bilhon");
      expect(h.livroId).toBeNull();
      expect(h.linkLocal).toMatch(/^\/colecao\/[^/]+\/docs%2Fconclave\.md$/);
      expect(h.chunkId).toMatch(/^docs\/conclave\.md#\d+$/);
    }
  });

  it("catálogo sem o documento (só entradas manuais): esse documento abre pela coleção, com aviso", async () => {
    const data = await novoData();
    await mkdir(path.join(data, "livros"), { recursive: true });
    await writeFile(
      path.join(data, "livros", "catalogo.json"),
      JSON.stringify({ livros: [{ id: "docs-conclave", titulo: "Outro livro", arquivo: "x.pdf", origem: "manual" }] }),
    );
    const r = await runBusca(ctxDe(data));
    expect(r.resumo).toMatchObject({ livros: 0, foraDaEstante: 2 });
    expect(r.avisos.join(" ")).toMatch(/2 documento\(s\) fora do catálogo da estante/);
    const [hit] = await buscar(data, "conclave delibera");
    // a entrada manual com o id natural do documento NUNCA vira destino do link
    expect(hit).toMatchObject({ tipo: "bilhon", livroId: null });
    expect(hit.linkLocal).not.toContain("/livro/");
  });

  it("idempotente: a mesma entrada dá os mesmos bytes, sem sobras de temporários", async () => {
    const data = await novoData();
    await runLivros(ctxDe(data));
    const indice = path.join(data, "search", "index.sqlite");
    await runBusca(ctxDe(data));
    const antes = await hashDoArquivo(indice);
    await runLivros(ctxDe(data));
    await runBusca(ctxDe(data));
    expect(await hashDoArquivo(indice)).toBe(antes);
    expect(await readdir(path.join(data, "search"))).toEqual(["index.sqlite"]);
  });
});
