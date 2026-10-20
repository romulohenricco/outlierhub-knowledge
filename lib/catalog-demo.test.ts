import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Catálogo demo: sem catálogo configurado, cada livro das fixtures abre de verdade
 * ("Ler agora" e o download dependem disso) e o caminho mostrado não carrega o
 * diretório da máquina. Os PDFs de exemplo abrem, têm capa e domínio. Com catálogo
 * configurado, arquivo ausente vira null (404), e nunca erro de leitura, e as capas
 * vêm da pasta de livros (não das do demo).
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "catalog-demo-"));
  vi.stubEnv("BILHON_CATALOGO", path.join(dir, "nao-existe.json"));
  vi.stubEnv("BILHON_LIVROS_DIR", "");
  vi.resetModules();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const carregar = () => import("./catalog");

type Fixture = { id: string; arquivo: string; formato: string; dominio?: string };
const lerFixtures = async () =>
  JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "demo", "livros.json"), "utf-8")) as Fixture[];

/** Primeiros bytes do arquivo (PDFs de exemplo são grandes: não lê o arquivo inteiro). */
async function cabecalho(arquivo: string, n = 8): Promise<string> {
  const fh = await open(arquivo, "r");
  try {
    const buf = Buffer.alloc(n);
    await fh.read(buf, 0, n, 0);
    return buf.toString("latin1");
  } finally {
    await fh.close();
  }
}

const livroDoCatalogo = (id: string, arquivo: string) => ({
  id,
  titulo: id,
  arquivo,
  formato: "txt",
  tema: "teste",
  cluster: null,
  origem: "INBOX",
  sizeBytes: 1,
  vizinhos: [],
  proveniencia: { origemPath: "teste", motivo: "teste" },
});

describe("catálogo demo (nenhum catálogo configurado)", () => {
  it("todo livro das fixtures tem o arquivo em fixtures/demo/livros e abre", async () => {
    const fixtures = await lerFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
    const { getBooks, resolveFilePath } = await carregar();
    expect((await getBooks()).map((l) => l.id)).toEqual(fixtures.map((f) => f.id));
    for (const f of fixtures) {
      const p = await resolveFilePath(f.id);
      expect(p, f.id).not.toBeNull();
      expect(path.basename(p!), f.id).toBe(f.arquivo);
    }
  });

  it("o tamanho vem do arquivo e o caminho mostrado é relativo ao projeto", async () => {
    const { getBook } = await carregar();
    const livro = await getBook("guia-knowledge");
    expect(livro?.path).toBe("fixtures/demo/livros/guia-knowledge.pdf");
    expect(path.isAbsolute(livro!.path)).toBe(false);
    expect(livro!.sizeBytes).toBeGreaterThan(0);
  });

  it("id fora do catálogo: nulo nas duas funções", async () => {
    const { getBook, resolveFilePath } = await carregar();
    expect(await getBook("nao-existe")).toBeNull();
    expect(await resolveFilePath("nao-existe")).toBeNull();
  });

  it("os PDFs de exemplo abrem, têm capa PNG e domínio na estante", async () => {
    const pdfs = await lerFixtures();
    expect(pdfs.length).toBeGreaterThan(0);
    const { getBooks, getBook, resolveFilePath, coverPathFor } = await carregar();
    const livros = await getBooks();
    for (const f of pdfs) {
      const livro = livros.find((l) => l.id === f.id);
      expect(livro, f.id).toBeDefined();
      expect(livro!.formato, f.id).toBe("pdf");
      expect(livro!.dominio, f.id).toBe(f.dominio);
      expect(livro!.temCapa, f.id).toBe(true);
      const p = await resolveFilePath(f.id);
      expect(p, f.id).not.toBeNull();
      expect((await cabecalho(p!)).startsWith("%PDF-"), f.id).toBe(true);
      expect((await cabecalho(coverPathFor(f.arquivo))).slice(1, 4), f.id).toBe("PNG");
      expect((await getBook(f.id))?.proveniencia?.motivo, f.id).toMatch(/original Knowledge, licença MIT/);
    }
  });

  it("o demo só traz PDFs, todos com capa e domínio: nenhum texto sintético na estante", async () => {
    const livros = await lerFixtures();
    expect(livros.filter((f) => f.formato !== "pdf").map((f) => f.id)).toEqual([]);
    const { getBooks } = await carregar();
    expect((await getBooks()).filter((l) => !l.temCapa || !l.dominio).map((l) => l.id)).toEqual([]);
  });
});

describe("catálogo configurado", () => {
  async function montar(arquivos: Record<string, string>) {
    const livros = path.join(dir, "arquivos");
    await mkdir(livros, { recursive: true });
    for (const [nome, texto] of Object.entries(arquivos)) await writeFile(path.join(livros, nome), texto);
    await writeFile(
      path.join(dir, "catalogo.json"),
      JSON.stringify({
        livros: [
          livroDoCatalogo("presente", "presente.txt"),
          livroDoCatalogo("ausente", "ausente.txt"),
          livroDoCatalogo("fuga", "../fora.txt"),
        ],
      }),
    );
    await writeFile(path.join(dir, "fora.txt"), "fora da pasta de livros");
    vi.stubEnv("BILHON_CATALOGO", path.join(dir, "catalogo.json"));
    vi.stubEnv("BILHON_LIVROS_DIR", livros);
    vi.resetModules();
    return carregar();
  }

  it("arquivo presente resolve; ausente vira null; fuga da pasta continua recusada", async () => {
    const { resolveFilePath } = await montar({ "presente.txt": "texto" });
    expect(await resolveFilePath("presente")).toBe(path.join(dir, "arquivos", "presente.txt"));
    expect(await resolveFilePath("ausente")).toBeNull();
    expect(await resolveFilePath("fuga")).toBeNull();
  });

  it("as capas vêm da pasta de livros: capa do demo não vale no catálogo configurado", async () => {
    const { getBooks } = await montar({ "presente.txt": "texto" });
    expect((await getBooks()).find((l) => l.id === "presente")?.temCapa).toBe(false);
    await mkdir(path.join(dir, "arquivos", ".covers"), { recursive: true });
    await writeFile(path.join(dir, "arquivos", ".covers", "presente.png"), "png");
    vi.resetModules();
    const { getBooks: depois } = await carregar();
    expect((await depois()).find((l) => l.id === "presente")?.temCapa).toBe(true);
  });

  it("fora do projeto, o caminho mostrado é só o nome do arquivo", async () => {
    const { getBook } = await montar({ "presente.txt": "texto" });
    vi.spyOn(process, "cwd").mockReturnValue(path.join(dir, "outro-projeto"));
    expect((await getBook("presente"))?.path).toBe("presente.txt");
  });
});
