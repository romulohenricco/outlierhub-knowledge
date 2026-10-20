import { describe, expect, it } from "vitest";
import type { Ontologia } from "./ontologia";
import { corPorTexto } from "./ontologia-cores";
import { montarGrafoOntologia } from "./ontologia-grafo";
import { layoutTree, type LayoutInput } from "./ontologia-layout";

/** Fixture mínima inline — o suficiente para exercitar camadas, hierarquia e ligações. */
function fixture(): Ontologia {
  return {
    titulo: "Meu mapa",
    statusCores: { ativo: "#4ade80" },
    regras: [],
    descartes: { itens: 0, ligacoes: 2 },
    camadas: [
      {
        id: "c1",
        rotulo: "Camada 1",
        descricao: "primeira",
        cor: "#112233",
        itens: [
          { id: "a", nome: "Item A", status: "ativo", ligacoes: [{ camada: "c2", item: "z", rotulo: "usa" }, { camada: "c1", item: "b" }], dados: { chave: "valor" }, fonte: "a.md" },
          { id: "b", nome: "Item B", pai: "a", status: "novo", ligacoes: [], dados: {} },
          { id: "c", nome: "Item C", pai: "b", ligacoes: [], dados: {} },
        ],
      },
      { id: "c2", rotulo: "Camada 2", itens: [{ id: "z", nome: "Item Z", ligacoes: [], dados: {} }] },
      { id: "vazia", rotulo: "Sem itens", itens: [] },
    ],
  };
}

describe("montarGrafoOntologia", () => {
  const g = montarGrafoOntologia(fixture());
  const porId = new Map(g.nodes.map((n) => [n.id, n]));

  it("raiz → camadas → itens, com ids únicos e todo parent existente", () => {
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length);
    for (const n of g.nodes) if (n.parent !== null) expect(porId.has(n.parent)).toBe(true);
    expect(g.nodes.filter((n) => n.parent === null)).toHaveLength(1);
    expect(porId.get("raiz")).toMatchObject({ kind: "raiz", label: "Meu mapa", codigo: "00" });
    expect(g.nodes.filter((n) => n.kind === "camada").map((n) => n.id)).toEqual(["camada:c1", "camada:c2", "camada:vazia"]);
    expect(porId.get("camada:c1")).toMatchObject({ parent: "raiz", label: "Camada 1", codigo: "01", resumo: "primeira" });
    expect(porId.get("camada:vazia")?.metrica).toEqual({ valor: 0, rotulo: "itens" });
  });

  it("hierarquia por `pai`; sem pai o item fica sob a camada", () => {
    expect(porId.get("item:c1/a")?.parent).toBe("camada:c1");
    expect(porId.get("item:c1/b")?.parent).toBe("item:c1/a");
    expect(porId.get("item:c1/c")?.parent).toBe("item:c1/b");
    expect(porId.get("item:c2/z")?.parent).toBe("camada:c2");
  });

  it("ligações viram relações com o rótulo (ou o verbo padrão) entre camadas", () => {
    expect(g.links).toEqual([
      { source: "item:c1/a", target: "item:c2/z", verbo: "usa" },
      { source: "item:c1/a", target: "item:c1/b", verbo: "liga a" },
    ]);
  });

  it("cores: camada declarada, camada por hash, item herda a da camada", () => {
    expect(porId.get("camada:c1")?.cor).toBe("#112233");
    expect(porId.get("item:c1/a")?.cor).toBe("#112233");
    expect(porId.get("camada:c2")?.cor).toBe(corPorTexto("c2"));
    expect(porId.get("item:c2/z")?.cor).toBe(corPorTexto("c2"));
  });

  it("status é texto livre: cor do mapa, cor por hash, e vazio quando não há", () => {
    expect(porId.get("item:c1/a")).toMatchObject({ status: "ativo", corStatus: "#4ade80" });
    expect(porId.get("item:c1/b")).toMatchObject({ status: "novo", corStatus: corPorTexto("novo") });
    expect(porId.get("item:c1/c")).toMatchObject({ status: "", corStatus: "" });
  });

  it("item: rótulo da camada no tag, dados viram fatos, fonte vira path", () => {
    expect(porId.get("item:c1/a")).toMatchObject({ tag: "Camada 1", path: "a.md", facts: [{ label: "chave", value: "valor" }] });
  });

  it("a raiz informa os descartes do arquivo", () => {
    expect(porId.get("raiz")?.facts).toContainEqual({ label: "ligações descartadas", value: "2" });
  });

  it("sem título a raiz se chama Ontologia; ontologia sem camadas só tem a raiz", () => {
    const vazio = montarGrafoOntologia({ ...fixture(), titulo: undefined, camadas: [] });
    expect(vazio.nodes.map((n) => [n.id, n.label])).toEqual([["raiz", "Ontologia"]]);
    expect(vazio.links).toEqual([]);
  });

  it("camada e item com o mesmo id não colidem", () => {
    const o = fixture();
    o.camadas.push({ id: "raiz", rotulo: "Raiz", itens: [{ id: "raiz", nome: "x", ligacoes: [], dados: {} }] });
    const gr = montarGrafoOntologia(o);
    expect(new Set(gr.nodes.map((n) => n.id)).size).toBe(gr.nodes.length);
  });
});

describe("layoutTree", () => {
  const folha = (id: string): LayoutInput => ({ id, w: 100, h: 50, children: [] });
  const colide = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    a.x < b.x + 100 && b.x < a.x + 100 && a.y < b.y + 50 && b.y < a.y + 50;

  it("irmãos lado a lado não se sobrepõem", () => {
    const raiz: LayoutInput = {
      id: "r", w: 100, h: 50,
      children: [
        { id: "a", w: 100, h: 50, children: [folha("a1"), folha("a2")] },
        { id: "b", w: 100, h: 50, children: [folha("b1")] },
      ],
    };
    const { positions } = layoutTree(raiz);
    const ps = [...positions.entries()];
    expect(ps).toHaveLength(6);
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) expect(colide(ps[i][1], ps[j][1])).toBe(false);
    // pai centrado acima dos filhos
    expect(positions.get("r")!.y).toBeLessThan(positions.get("a")!.y);
  });

  it("pente (>=4 folhas) também não sobrepõe", () => {
    const raiz: LayoutInput = { id: "r", w: 100, h: 50, children: Array.from({ length: 9 }, (_, i) => folha(`f${i}`)) };
    const { positions, combParents } = layoutTree(raiz);
    expect(combParents.has("r")).toBe(true);
    const ps = [...positions.values()];
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) expect(colide(ps[i], ps[j])).toBe(false);
  });
});
