import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import React, { type ReactElement } from "react";

// o vitest compila TSX no modo clássico (tsconfig com jsx preservado): a página usa `React` global
(globalThis as { React?: unknown }).React = React;

/** /estante: a página da estante lista o catálogo (no modo demo, os PDFs de exemplo). */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "estante-page-"));
  vi.stubEnv("BILHON_CATALOGO", path.join(dir, "nao-existe.json"));
  vi.stubEnv("BILHON_LIVROS_DIR", "");
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

type Pagina = ReactElement<{ children: ReactElement<{ books: { id: string }[] }> }>;

describe("/estante", () => {
  it("entrega ao componente da estante os livros do catálogo demo", async () => {
    const { default: EstantePage } = await import("./page");
    const main = (await EstantePage()) as Pagina;
    const ids = main.props.children.props.books.map((l) => l.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("guia-knowledge");
  });

  it("o título da aba identifica o template", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Estante · Knowledge");
  });
});
