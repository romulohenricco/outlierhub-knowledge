import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import React, { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// o vitest compila TSX no modo clássico (tsconfig com jsx preservado): a página usa `React` global
(globalThis as { React?: unknown }).React = React;

/** /ontologia: sem manifesto abre o estado vazio; com um manifesto sintético entrega os nós ao canvas. */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ontologia-page-"));
  vi.stubEnv("BILHON_ROOT", dir);
  vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", "");
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

type Props = { children?: ReactNode; nodes?: { id: string }[]; fonte?: string };

/** Acha, na árvore devolvida pela página, o elemento que recebe `nodes` (o canvas). */
function achaCanvas(no: ReactNode): React.ReactElement<Props> | null {
  if (Array.isArray(no)) {
    for (const f of no) {
      const r = achaCanvas(f);
      if (r) return r;
    }
    return null;
  }
  if (!isValidElement<Props>(no)) return null;
  if (no.props.nodes) return no;
  return achaCanvas(no.props.children);
}

describe("/ontologia", () => {
  it("sem manifesto configurado: estado vazio com a variável, o formato e o doc", async () => {
    const { default: OntologiaPage } = await import("./page");
    const html = renderToStaticMarkup((await OntologiaPage()) as React.ReactElement);
    expect(html).toContain("Nenhuma ontologia carregada");
    expect(html).toContain("BILHON_ONTOLOGIA_MANIFEST");
    expect(html).toContain("docs/ontologia.md");
    expect(html).toContain("A variável ainda não está definida.");
    expect(html).not.toContain("data-canvas-page");
  });

  it("arquivo apontado que não existe: o estado diz isso", async () => {
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", path.join(dir, "nada.yaml"));
    const { default: OntologiaPage } = await import("./page");
    const html = renderToStaticMarkup((await OntologiaPage()) as React.ReactElement);
    expect(html).toContain("O arquivo apontado não existe.");
  });

  it("arquivo no formato antigo (sem `camadas`): estado vazio explicativo, sem lançar", async () => {
    const arq = path.join(dir, "antigo.yaml");
    await writeFile(arq, "manifest:\n  domains: [a]\n  planes:\n    - node: p\n");
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", arq);
    const { default: OntologiaPage } = await import("./page");
    const html = renderToStaticMarkup((await OntologiaPage()) as React.ReactElement);
    expect(html).toContain("Nenhuma ontologia carregada");
    expect(html).toContain("camadas");
    expect(html).toContain("Exemplo mínimo");
  });

  it("com um arquivo sintético: o canvas recebe os nós e o nome do arquivo", async () => {
    const arq = path.join(dir, "m.yaml");
    await writeFile(
      arq,
      "camadas:\n  - id: c1\n    itens:\n      - id: a\n        ligacoes: [{ item: fantasma }]\n      - id: b\n        pai: a\n",
    );
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", arq);
    const { default: OntologiaPage } = await import("./page");
    const pagina = (await OntologiaPage()) as React.ReactElement;
    const canvas = achaCanvas(pagina);
    expect(canvas?.props.fonte).toBe(path.basename(arq));
    expect(canvas?.props.nodes?.map((n) => n.id)).toEqual(["raiz", "camada:c1", "item:c1/a", "item:c1/b"]);
  });

  it("o título da aba identifica o template", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Ontologia · Knowledge");
  });
});
