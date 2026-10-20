import { describe, expect, it } from "vitest";
import { agruparPorFonte } from "./fontes";
import { listarPilares } from "./cena";
import { ORG, ent } from "./fixtures-teste";
import { montarNeural } from "./neural";

const sq = ent("squad", "equipes/a/x");
const fontes = agruparPorFonte([sq, ent("worker", "equipes/a/x", sq.id), ent("skill", "equipes/a/x", sq.id), ent("skill", "equipes/a/x", sq.id)]);

describe("montarNeural", () => {
  const n = montarNeural(listarPilares(ORG, fontes), ORG, fontes, 42);
  const col = (id: string) => n.colunas.find((c) => c.id === id)!;

  it("5 colunas na ordem ferramentas → executores → tarefas → pilares → memória", () => {
    expect(n.colunas.map((c) => c.id)).toEqual(["ferramentas", "executores", "tarefas", "pilares", "memoria"]);
    expect(n.colunas.map((c) => c.titulo)).toEqual(["FERRAMENTAS", "EXECUTORES", "TAREFAS", "PILARES", "MEMÓRIA"]);
  });
  it("a coluna de ferramentas tem uma linha por ferramenta do catálogo (3) + skills do squad", () => {
    expect(col("ferramentas").nos.filter((x) => x.rotulo !== "skills ×2")).toHaveLength(3);
    expect(col("ferramentas").nos.some((x) => x.rotulo === "skills ×2")).toBe(true);
  });
  it("pilares = todos (organização + fonte); memória = total de notas", () => {
    expect(col("pilares").nos).toHaveLength(3);
    expect(col("memoria").nos[0].rotulo).toContain("42");
  });
  it("feixes só entre nós existentes, sempre da coluna i para i+1", () => {
    const por = new Map(n.colunas.flatMap((c, i) => c.nos.map((x) => [x.id, i] as const)));
    expect(n.feixes.length).toBeGreaterThan(0);
    for (const f of n.feixes) expect(por.get(f.para)! - por.get(f.de)!).toBe(1);
  });
  it("tarefa de pessoa chega ao pilar; pessoa não é executor automático, então não tem coluna", () => {
    expect(n.feixes.some((f) => f.de === "tarefa:t2" && f.para === "pilar:d1")).toBe(true);
    expect(col("executores").nos.some((x) => x.id === "pessoa:p1")).toBe(false);
  });
  it("sem organização, sem fontes e sem notas: colunas vazias, sem lançar", () => {
    const v = montarNeural([], null, [], null);
    expect(v.feixes).toEqual([]);
    expect(v.colunas.every((c) => c.nos.length === 0)).toBe(true);
  });
});
