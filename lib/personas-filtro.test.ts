import { describe, expect, it } from "vitest";
import type { Persona } from "./personas";
import { FILTRO_VAZIO, facetasPersonas, filtrarPersonas } from "./personas-filtro";

const mk = (id: string, o: Partial<Persona>): Persona => ({
  id, ordem: 1, nome: id, arquetipo: "Operador", slogan: "", resumo: "x", cor: "#ffffff", estrelaGuia: "",
  pilares: [], conectores: [], metricas: [], memoria: "", jogadaAssinatura: "", origem: "personalizada",
  evidencias: [], ...o,
});
const A = mk("Alfa", { slogan: "Vende rápido", conectores: ["Pagamentos", "Chat"], pilares: [{ nome: "Vendas", foco: "", agentes: [] }] });
const B = mk("Beta", { arquetipo: "Fundador", origem: "equipe", conectores: ["Chat", "Chat"] });
const C = mk("Ção", { arquetipo: "Operador", conectores: ["Chat"] });

describe("personas-filtro", () => {
  it("filtro vazio devolve tudo, na ordem", () => {
    expect(filtrarPersonas([A, B, C], FILTRO_VAZIO)).toEqual([A, B, C]);
  });
  it("busca casa nome, slogan e arquétipo, sem acento", () => {
    expect(filtrarPersonas([A, B, C], { ...FILTRO_VAZIO, q: "rapido" })).toEqual([A]);
    expect(filtrarPersonas([A, B, C], { ...FILTRO_VAZIO, q: "fundador" })).toEqual([B]);
    expect(filtrarPersonas([A, B, C], { ...FILTRO_VAZIO, q: "cao" })).toEqual([C]);
  });
  it("facetas combinam em AND", () => {
    expect(filtrarPersonas([A, B, C], { ...FILTRO_VAZIO, conector: "Chat", arquetipo: "Operador" })).toEqual([A, C]);
    expect(filtrarPersonas([A, B, C], { ...FILTRO_VAZIO, origem: "equipe", pilar: "Vendas" })).toEqual([]);
  });
  it("facetas contam por persona e ordenam por frequência", () => {
    const f = facetasPersonas([A, B, C]);
    expect(f.conector).toEqual([["Chat", 3], ["Pagamentos", 1]]);
    expect(f.origem).toEqual([["personalizada", 2], ["equipe", 1]]);
    expect(f.pilar).toEqual([["Vendas", 1]]);
  });
});
