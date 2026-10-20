import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Lista de projetos do board: configurável por NEXT_PUBLIC_KANBAN_PROJETOS (CSV) e
 * a MESMA para tipos, validação do servidor e filtros da UI. Variável em branco
 * vale como ausente.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kanban-projetos-"));
  vi.stubEnv("BILHON_KANBAN_DIR", dir);
  vi.stubEnv("NEXT_PUBLIC_KANBAN_PROJETOS", "");
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function carregar(projetos?: string) {
  if (projetos !== undefined) vi.stubEnv("NEXT_PUBLIC_KANBAN_PROJETOS", projetos);
  vi.resetModules();
  return {
    T: await import("./types"),
    K: await import("./kanban"),
    I: await import("../components/kanbanInfo"),
  };
}

describe("KANBAN_PROJETOS", () => {
  it("sem variável: geral e outro, com geral como padrão", async () => {
    const { T } = await carregar();
    expect(T.KANBAN_PROJETOS).toEqual(["geral", "outro"]);
    expect(T.KANBAN_PROJETO_PADRAO).toBe("geral");
  });

  it.each([[""], ["   "], [" , ,, "]])("variável em branco (%j) vale como ausente", async (valor) => {
    const { T } = await carregar(valor);
    expect(T.KANBAN_PROJETOS).toEqual(["geral", "outro"]);
  });

  it("CSV: mantém a ordem, tira vazios e duplicados e deixa outro por último", async () => {
    const { T } = await carregar(" site , api,, site, outro, docs ");
    expect(T.KANBAN_PROJETOS).toEqual(["site", "api", "docs", "outro"]);
    expect(T.KANBAN_PROJETO_PADRAO).toBe("site");
  });

  it("descarta entradas com caracteres fora do padrão", async () => {
    const { T } = await carregar("ok,<script>,a/b,projeto 2");
    expect(T.KANBAN_PROJETOS).toEqual(["ok", "projeto 2", "outro"]);
  });
});

describe("a lista chega ao servidor e à UI", () => {
  it("ticket novo nasce no projeto padrão", async () => {
    const { K } = await carregar("site,api");
    const card = await K.criarCard({ titulo: "um ticket", tipo: "bug" });
    expect(card.projeto).toBe("site");
  });

  it("PATCH aceita projeto da lista e recusa o resto, citando as opções", async () => {
    const { K } = await carregar("site,api");
    const card = await K.criarCard({ titulo: "um ticket", tipo: "bug" });

    const ok = await K.atualizarCard(card.id, { projeto: "api" });
    expect(ok.ok && ok.card.projeto).toBe("api");

    const ruim = await K.atualizarCard(card.id, { projeto: "projeto-que-nao-existe" });
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(ruim.erro).toContain("site|api|outro");
  });

  it("filtros da UI listam a mesma lista e devolvem o próprio valor para projeto desconhecido", async () => {
    const { I } = await carregar("site,api");
    expect(Object.keys(I.PROJETO_INFO)).toEqual(["site", "api", "outro"]);
    expect(I.PROJETO_INFO.site).toBe("site");
    expect(I.PROJETO_INFO["legado-antigo"]).toBe("legado-antigo");
  });
});
