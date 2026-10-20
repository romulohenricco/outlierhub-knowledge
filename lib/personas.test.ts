/** Personas: validação do formato e leitura do JSON do usuário (BILHON_PERSONAS_JSON). */
import { mkdirSync, readFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { carregarPersonas, validarPersonas } from "./personas";

const minima = { id: "a", nome: "Alfa", resumo: "Resumo da Alfa" };

describe("validarPersonas", () => {
  it("aceita lista ou { personas } e preenche os padrões", () => {
    const { personas } = validarPersonas({ personas: [minima] });
    expect(personas).toHaveLength(1);
    expect(personas[0]).toMatchObject({
      id: "a", ordem: 1, nome: "Alfa", resumo: "Resumo da Alfa", arquetipo: "Persona",
      origem: "personalizada", pilares: [], conectores: [], metricas: [], evidencias: [],
    });
    expect(validarPersonas([minima]).personas).toHaveLength(1);
  });

  it("descarta item inválido sem lançar e conta as descartadas", () => {
    const r = validarPersonas([
      minima,
      null,
      "texto",
      { id: "b", nome: "", resumo: "x" },
      { id: "c", nome: "Sem resumo" },
      { id: "../x", nome: "Id ruim", resumo: "x" },
      { ...minima, nome: "Duplicada" },
    ]);
    expect(r.personas.map((p) => p.id)).toEqual(["a"]);
    expect(r.descartadas).toBe(6);
  });

  it("entrada que não é lista nem { personas } vira vazio", () => {
    expect(validarPersonas(42)).toEqual({ personas: [], descartadas: 0 });
    expect(validarPersonas({ personas: "x" })).toEqual({ personas: [], descartadas: 0 });
  });

  it("cor só vale se for hexadecimal; senão usa a cor padrão", () => {
    const [ok] = validarPersonas([{ ...minima, cor: "#5b8cff" }]).personas;
    const [ruim] = validarPersonas([{ ...minima, id: "b", cor: "red;background:url(x)" }]).personas;
    expect(ok.cor).toBe("#5b8cff");
    expect(ruim.cor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("limpa pilares e listas: tipos errados somem, tamanhos são limitados", () => {
    const [p] = validarPersonas([
      {
        ...minima,
        pilares: [
          { nome: "Vendas", foco: "Receita", agentes: ["x", 3, "", "y"] },
          { foco: "sem nome" },
          "lixo",
        ],
        conectores: ["Slack", 7, "Slack", ""],
        metricas: Array.from({ length: 40 }, (_, i) => `m${i}`),
      },
    ]).personas;
    expect(p.pilares).toEqual([{ nome: "Vendas", foco: "Receita", agentes: ["x", "y"] }]);
    expect(p.conectores).toEqual(["Slack"]);
    expect(p.metricas.length).toBeLessThanOrEqual(20);
  });

  it("corta texto longo por code point", () => {
    const [p] = validarPersonas([{ ...minima, resumo: "😀".repeat(2000) }]).personas;
    expect([...p.resumo].length).toBeLessThanOrEqual(600);
    expect(() => JSON.stringify(p)).not.toThrow();
  });
});

describe("docs/personas.md", () => {
  it("o exemplo da documentação passa na validação sem descartes", () => {
    const md = readFileSync(path.join(process.cwd(), "docs", "personas.md"), "utf8");
    const bloco = /```json\r?\n([\s\S]*?)\r?\n```/.exec(md)?.[1] ?? "";
    const r = validarPersonas(JSON.parse(bloco));
    expect(r.descartadas).toBe(0);
    expect(r.personas).toHaveLength(1);
    expect(r.personas[0].pilares).toHaveLength(3);
  });
});

describe("carregarPersonas", () => {
  let base: string;
  let raiz: string;
  beforeAll(() => {
    base = mkdtempSync(path.join(os.tmpdir(), "personas-"));
    raiz = path.join(base, "raiz");
    mkdirSync(raiz, { recursive: true });
    writeFileSync(path.join(raiz, "ok.json"), JSON.stringify([minima, { id: "z" }]));
    writeFileSync(path.join(raiz, "quebrado.json"), "{ nao e json");
    writeFileSync(path.join(raiz, "grande.json"), JSON.stringify([{ ...minima, resumo: "x".repeat(3_000_000) }]));
    writeFileSync(path.join(base, "fora.json"), JSON.stringify([minima]));
    symlinkSync(path.join(base, "fora.json"), path.join(raiz, "atalho.json"));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  afterEach(() => vi.unstubAllEnvs());

  const com = (arquivo?: string) => {
    vi.stubEnv("BILHON_ROOT", raiz);
    vi.stubEnv("BILHON_PERSONAS_JSON", arquivo ?? "");
  };

  it("sem configuração: lista vazia, sem lançar", async () => {
    com();
    expect(await carregarPersonas()).toEqual({ personas: [], descartadas: 0, estado: "nao-configurada" });
  });

  it("lê o arquivo, valida e informa as descartadas", async () => {
    com(path.join(raiz, "ok.json"));
    const r = await carregarPersonas();
    expect(r.estado).toBe("ok");
    expect(r.personas.map((p) => p.id)).toEqual(["a"]);
    expect(r.descartadas).toBe(1);
  });

  it("arquivo ausente, quebrado ou grande demais: vazio com o motivo", async () => {
    com(path.join(raiz, "nao-existe.json"));
    expect((await carregarPersonas()).estado).toBe("ausente");
    com(path.join(raiz, "quebrado.json"));
    expect((await carregarPersonas()).estado).toBe("invalida");
    com(path.join(raiz, "grande.json"));
    expect((await carregarPersonas()).estado).toBe("grande-demais");
  });

  it("fora da raiz, inclusive por symlink: não lê", async () => {
    com(path.join(base, "fora.json"));
    expect((await carregarPersonas()).estado).toBe("fora-da-raiz");
    com(path.join(raiz, "atalho.json"));
    const r = await carregarPersonas();
    expect(r.estado).toBe("fora-da-raiz");
    expect(r.personas).toEqual([]);
  });
});
