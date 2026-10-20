import { describe, expect, it } from "vitest";
import { agruparPorFonte } from "./fontes";
import { listarPilares } from "./cena";
import { ORG, ent } from "./fixtures-teste";
import { buscar, montarIndice } from "./indice";
import type { Memoria } from "./tipos";

const fontes = agruparPorFonte([ent("skill", "pasta/x", undefined, "deploy"), ent("repo", "repos/algum-repo")]);
const mem: Memoria = { hubs: [], notas: [{ id: "memoria/a.md", titulo: "Nota do deploy", hub: "memoria", grau: 1, caminho: "memoria/a.md", palavras: 3, trecho: "" }], links: [], total: 5, conectadas: 1, naoResolvidos: 0 };
const ind = montarIndice(listarPilares(ORG, fontes), ORG, fontes, mem);

describe("indice", () => {
  it("grupos com contagem real e ferramenta leva ao pilar de quem a usa", () => {
    const g = Object.fromEntries(ind.grupos.map((x) => [x.id, x.itens.length]));
    expect(g).toMatchObject({ agente: 4, humano: 1, tarefa: 3, ferramenta: 3, pilar: 4, skill: 1, outros: 1, nota: 1 });
    expect(ind.itens.find((i) => i.id === "ferramenta:t1")?.pilarId).toBe("pilar:d1");
    expect(ind.itens.find((i) => i.id === "ferramenta:t3")?.pilarId).toBeNull();
  });
  it("busca por nome em notas e nós, sem acento/caixa", () => {
    expect(buscar(ind, "DEPLOY").map((i) => i.tipo).sort()).toEqual(["nota", "skill"]);
    expect(buscar(ind, "coordenacao")[0].id).toBe("agente:a0");
    expect(buscar(ind, "")).toEqual([]);
  });
  it("tudo vazio: índice vazio", () => {
    expect(montarIndice([], null, [], null)).toEqual({ itens: [], grupos: [] });
  });
});
