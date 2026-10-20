import { describe, expect, it } from "vitest";
import { montarCardsReferencia, type NoRef } from "./ontologia-referencia";

const camada = (id: string, codigo: string, label = id, resumo = ""): NoRef => ({
  id: `camada:${id}`,
  parent: "raiz",
  kind: "camada",
  label,
  resumo,
  cor: "#5b8cff",
  codigo,
});
const item = (id: string, parent: string, label = id): NoRef => ({
  id,
  parent,
  kind: "item",
  label,
  resumo: "",
  cor: "#5b8cff",
  codigo: "01",
});

describe("montarCardsReferencia", () => {
  it("um card por camada, na ordem dos nós, com contagem de descendentes", () => {
    const nodes = [
      camada("c1", "01", "Camada A", "resumo da camada"),
      item("a", "camada:c1", "A"),
      item("b", "camada:c1", "B"),
      item("a1", "a"),
      item("a2", "a"),
      item("a2x", "a2"),
      camada("c2", "02", "Camada B"),
    ];
    const [c1, c2] = montarCardsReferencia(nodes);
    expect(c1).toMatchObject({
      id: "camada:c1",
      codigo: "01",
      cor: "#5b8cff",
      titulo: "Camada A",
      resumo: "resumo da camada",
      total: 5,
      resto: 0,
    });
    expect(c1.itens).toEqual([
      { id: "a", label: "A", descendentes: 3 },
      { id: "b", label: "B", descendentes: 0 },
    ]);
    expect(c2).toMatchObject({ codigo: "02", total: 0, itens: [], resto: 0 });
  });

  it("filho único com filhos abre um nível", () => {
    const nodes = [camada("c", "01"), item("grupo", "camada:c"), item("d1", "grupo"), item("d2", "grupo"), item("d2x", "d2")];
    const [card] = montarCardsReferencia(nodes);
    expect(card.itens.map((i) => i.id)).toEqual(["d1", "d2"]);
    expect(card.itens[1].descendentes).toBe(1);
    expect(card.total).toBe(4);
  });

  it("filho único sem filhos permanece na lista", () => {
    const nodes = [camada("c", "01"), item("solo", "camada:c")];
    expect(montarCardsReferencia(nodes)[0].itens.map((i) => i.id)).toEqual(["solo"]);
  });

  it("corta em 8 itens e informa o resto", () => {
    const nodes: NoRef[] = [camada("c", "01")];
    for (let i = 0; i < 11; i++) nodes.push(item(`e${i}`, "camada:c"));
    const [card] = montarCardsReferencia(nodes);
    expect(card.itens).toHaveLength(8);
    expect(card.resto).toBe(3);
    expect(card.total).toBe(11);
  });

  it("ignora raiz e itens, e aceita lista vazia", () => {
    const raiz: NoRef = { id: "raiz", parent: null, kind: "raiz", label: "R", resumo: "", cor: "#fff", codigo: "00" };
    expect(montarCardsReferencia([raiz, item("x", "raiz")])).toEqual([]);
    expect(montarCardsReferencia([])).toEqual([]);
  });

  it("não trava com ciclo em dado ruim", () => {
    const nodes = [camada("c", "01"), item("a", "b"), item("b", "a"), item("p", "camada:c")];
    expect(() => montarCardsReferencia(nodes)).not.toThrow();
  });
});
