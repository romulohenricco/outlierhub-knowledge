import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * /ler/[id]: no modo demo o leitor abre o PDF de exemplo; com catálogo configurado mostra o
 * texto do livro, e (arquivo ausente) a página explica em vez de cair em erro 500 com o caminho.
 */

// o vitest compila TSX no modo clássico (tsconfig com jsx preservado): a página usa `React` global
(globalThis as { React?: unknown }).React = React;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ler-page-"));
  vi.stubEnv("BILHON_CATALOGO", path.join(dir, "nao-existe.json"));
  vi.stubEnv("BILHON_LIVROS_DIR", "");
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function abrir(id: string) {
  const { default: Pagina } = await import("./page");
  const elemento = await Pagina({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(elemento);
}

describe("/ler/[id]", () => {
  it("modo demo: abre o PDF de exemplo no leitor", async () => {
    const html = await abrir("guia-knowledge");
    // o visualizador do PDF é um componente de cliente: no HTML do servidor só há o cabeçalho com o título
    expect(html).toContain("← Seu primeiro Knowledge");
    expect(html).not.toContain("Arquivo indisponível");
  });

  it("catálogo configurado: mostra o texto de um livro em .txt", async () => {
    const livros = path.join(dir, "arquivos");
    await mkdir(livros, { recursive: true });
    await writeFile(path.join(livros, "manual.txt"), "Planejar antes de executar evita retrabalho.");
    await writeFile(
      path.join(dir, "catalogo.json"),
      JSON.stringify({
        livros: [
          {
            id: "manual",
            titulo: "Manual de teste",
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

    const html = await abrir("manual");
    expect(html).toContain("Manual de teste");
    expect(html).toContain("Planejar antes de executar evita retrabalho.");
    expect(html).not.toContain("Arquivo indisponível");
  });

  it("livro desconhecido: not found", async () => {
    await expect(abrir("nao-existe")).rejects.toThrow();
  });

  it("arquivo ausente: aviso na tela, sem o caminho do disco", async () => {
    const livros = path.join(dir, "arquivos");
    await mkdir(livros, { recursive: true });
    await writeFile(
      path.join(dir, "catalogo.json"),
      JSON.stringify({
        livros: [
          {
            id: "sumiu",
            titulo: "Livro que sumiu",
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

    const html = await abrir("sumiu");
    expect(html).toContain("Arquivo indisponível");
    expect(html).toContain("Livro que sumiu");
    expect(html).not.toContain(dir);
    expect(html).not.toContain("sumiu.txt");
  });
});
