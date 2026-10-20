import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * GET /api/file/[id]: serve o arquivo do livro. No modo demo (sem catálogo) os PDFs de
 * exemplo existem; num catálogo configurado serve o texto, e o arquivo ausente é 404,
 * nunca um 500 com o caminho do disco.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "file-route-"));
  vi.stubEnv("BILHON_CATALOGO", path.join(dir, "nao-existe.json"));
  vi.stubEnv("BILHON_LIVROS_DIR", "");
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const chamar = async (id: string) => {
  const { GET } = await import("./route");
  return GET(new Request(`http://127.0.0.1:3300/api/file/${id}`), { params: Promise.resolve({ id }) });
};

describe("GET /api/file/[id]", () => {
  it("modo demo: serve o PDF de exemplo do livro", async () => {
    const res = await chamar("guia-knowledge");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("catálogo configurado: serve o texto do livro", async () => {
    const livros = path.join(dir, "arquivos");
    await mkdir(livros, { recursive: true });
    await writeFile(path.join(livros, "manual.txt"), "Planejar antes de executar evita retrabalho.");
    await writeFile(
      path.join(dir, "catalogo.json"),
      JSON.stringify({
        livros: [
          {
            id: "manual",
            titulo: "Manual",
            arquivo: "manual.txt",
            formato: "txt",
            tema: "teste",
            cluster: null,
            origem: "INBOX",
            sizeBytes: 1,
            vizinhos: [],
            proveniencia: { origemPath: "teste", motivo: "teste" },
          },
        ],
      }),
    );
    vi.stubEnv("BILHON_CATALOGO", path.join(dir, "catalogo.json"));
    vi.stubEnv("BILHON_LIVROS_DIR", livros);
    vi.resetModules();
    const res = await chamar("manual");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("Planejar antes de executar evita retrabalho.");
  });

  it("livro desconhecido: 404", async () => {
    expect((await chamar("nao-existe")).status).toBe(404);
  });

  it("catálogo lista um arquivo que não está na pasta: 404 de corpo vazio", async () => {
    const livros = path.join(dir, "arquivos");
    await mkdir(livros, { recursive: true });
    await writeFile(
      path.join(dir, "catalogo.json"),
      JSON.stringify({
        livros: [
          {
            id: "sumiu",
            titulo: "Sumiu",
            arquivo: "sumiu.txt",
            formato: "txt",
            tema: "teste",
            cluster: null,
            origem: "INBOX",
            sizeBytes: 1,
            vizinhos: [],
            proveniencia: { origemPath: "teste", motivo: "teste" },
          },
        ],
      }),
    );
    vi.stubEnv("BILHON_CATALOGO", path.join(dir, "catalogo.json"));
    vi.stubEnv("BILHON_LIVROS_DIR", livros);
    vi.resetModules();
    const res = await chamar("sumiu");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });
});
