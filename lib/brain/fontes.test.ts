import { describe, expect, it } from "vitest";
import type { EcoEntity, EcoKind } from "../types";
import { FAMILIA_OUTRAS, FAMILIA_RAIZ, agruparPorFonte, familiaDaFonte } from "./fontes";

let n = 0;
function ent(kind: EcoKind, path: string, squadId?: string, nome = `e${++n}`): EcoEntity {
  return {
    id: `${kind}:x:${nome}`,
    legacyId: nome,
    kind,
    namespace: "x",
    name: nome,
    nome,
    descricao: "",
    origem: "t",
    path,
    procedencia: "propria",
    squadId,
    tags: [],
    meta: {},
  };
}

describe("familiaDaFonte (pasta de primeiro nível do path)", () => {
  it.each([
    ["agentes/equipe/revisor", "agentes"],
    ["./agentes/equipe", "agentes"],
    ["/agentes/equipe", "agentes"],
    ["agentes\\equipe", "agentes"],
    ["repos/projeto", "repos"],
    ["arquivo-solto.md", FAMILIA_RAIZ],
    ["", FAMILIA_RAIZ],
  ])("%s -> %s", (p, esperado) => {
    expect(familiaDaFonte(ent("skill", p))).toBe(esperado);
  });
});

describe("agruparPorFonte", () => {
  const sq = ent("squad", "equipes/a/squad", undefined, "sqA");
  const lista = [
    sq,
    ent("worker", "equipes/a/agents", sq.id),
    ent("skill", "equipes/a/skills/s", sq.id),
    ent("skill", "equipes/a/skills/solta"), // sem pai
    ent("agent", "agentes/b"),
    ent("repo", "repos/algum-repo"),
  ];
  const grupos = agruparPorFonte(lista);

  it("nunca descarta entidade: a soma dos pilares é o total", () => {
    expect(grupos.reduce((s, g) => s + g.total, 0)).toBe(lista.length);
  });

  it("ordena pela maior família, omite fonte sem entidade e traz contagem por tipo", () => {
    expect(grupos.map((g) => g.slug)).toEqual(["equipes", "agentes", "repos"]);
    const s = grupos.find((g) => g.slug === "equipes")!;
    expect(s.porKind).toMatchObject({ squad: 1, worker: 1, skill: 2 });
  });

  it("avulso = entidade sem pai dentro do mesmo pilar; é contada", () => {
    const s = grupos.find((g) => g.slug === "equipes")!;
    expect(s.avulsos).toHaveLength(1); // só a skill solta; o squad é raiz do pilar, não avulso
  });

  it("pai em outro pilar também deixa a entidade avulsa no pilar dela", () => {
    const pai = ent("squad", "outra/squad", undefined, "pai");
    const filho = ent("skill", "equipes/z", pai.id);
    const g = agruparPorFonte([pai, filho]).find((x) => x.slug === "equipes")!;
    expect(g.avulsos).toHaveLength(1);
  });

  it("cores estáveis e distintas por posição", () => {
    expect(new Set(grupos.map((g) => g.cor)).size).toBe(grupos.length);
    expect(agruparPorFonte(lista).map((g) => g.cor)).toEqual(grupos.map((g) => g.cor));
  });

  it("acima do teto, as menores se juntam em 'outras' sem perder entidade", () => {
    const muitas = Array.from({ length: 12 }, (_, i) => ent("skill", `pasta${String(i).padStart(2, "0")}/x`));
    const g = agruparPorFonte(muitas, 5);
    expect(g).toHaveLength(5);
    expect(g.at(-1)!.slug).toBe(FAMILIA_OUTRAS);
    expect(g.at(-1)!.nome).toBe("outras (8)");
    expect(g.reduce((s, x) => s + x.total, 0)).toBe(12);
  });

  it("entrada vazia: nenhum pilar", () => {
    expect(agruparPorFonte([])).toEqual([]);
  });
});
