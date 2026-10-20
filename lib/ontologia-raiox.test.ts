import { describe, expect, it } from "vitest";
import type { OntNo, OntRel } from "./ontologia-grafo";
import {
  camposDados,
  fatosDoPainel,
  irmaos,
  linhasRelacao,
  relacoesDoNo,
  tipoDoNo,
} from "./ontologia-raiox";

const no = (id: string, parent: string | null, extra: Partial<OntNo> = {}): OntNo => ({
  id,
  parent,
  camada: "c1",
  kind: "item",
  label: id.toUpperCase(),
  tag: `tag-${id}`,
  status: "",
  resumo: "",
  facts: [],
  cor: "#5b8cff",
  corStatus: "",
  codigo: "01",
  ...extra,
});

const nodes = [no("r", null), no("a", "r"), no("b", "r"), no("c", "r"), no("a1", "a"), no("x", "b")];
const porId = new Map(nodes.map((n) => [n.id, n]));
const filhosDe = new Map<string, OntNo[]>();
for (const n of nodes) if (n.parent) filhosDe.set(n.parent, [...(filhosDe.get(n.parent) ?? []), n]);
const links: OntRel[] = [
  { source: "a", target: "x", verbo: "usa" },
  { source: "x", target: "a", verbo: "alimenta" },
  { source: "a", target: "fantasma", verbo: "quebrado" },
];

describe("fatosDoPainel", () => {
  const facts = Array.from({ length: 9 }, (_, i) => ({ label: `f${i}`, value: `v${i}` }));
  it("limita a 6 e informa o resto", () => {
    const r = fatosDoPainel(facts);
    expect(r.visiveis).toHaveLength(6);
    expect(r.resto).toBe(3);
  });
  it("sem excesso, resto é 0", () => {
    expect(fatosDoPainel(facts.slice(0, 2))).toEqual({ visiveis: facts.slice(0, 2), resto: 0 });
  });
  it("aceita limite customizado", () => {
    expect(fatosDoPainel(facts, 2).resto).toBe(7);
  });
});

describe("relacoesDoNo", () => {
  it("separa pai, filhos, saindo e entrando; descarta alvo inexistente", () => {
    const r = relacoesDoNo(porId.get("a")!, porId, filhosDe, links);
    expect(r.pai?.id).toBe("r");
    expect(r.filhos.map((n) => n.id)).toEqual(["a1"]);
    expect(r.saindo).toEqual([{ no: porId.get("x"), verbo: "usa" }]);
    expect(r.entrando).toEqual([{ no: porId.get("x"), verbo: "alimenta" }]);
  });
  it("raiz não tem pai", () => {
    expect(relacoesDoNo(porId.get("r")!, porId, filhosDe, links).pai).toBeNull();
  });
});

describe("linhasRelacao", () => {
  it("achata na ordem pai, filhos, saindo, entrando com direção", () => {
    const l = linhasRelacao(relacoesDoNo(porId.get("a")!, porId, filhosDe, links));
    expect(l.map((x) => [x.no.id, x.rotulo, x.dir])).toEqual([
      ["r", "pai", "pai"],
      ["a1", "filho", "filho"],
      ["x", "usa", "saindo"],
      ["x", "alimenta", "entrando"],
    ]);
  });
});

describe("irmaos", () => {
  it("indice e total na ordem de filhosDe", () => {
    const r = irmaos(porId.get("b")!, porId, filhosDe);
    expect(r.indice).toBe(1);
    expect(r.total).toBe(3);
    expect(r.anterior?.id).toBe("a");
    expect(r.proximo?.id).toBe("c");
  });
  it("pontas não têm vizinho além", () => {
    expect(irmaos(porId.get("a")!, porId, filhosDe).anterior).toBeNull();
    expect(irmaos(porId.get("c")!, porId, filhosDe).proximo).toBeNull();
  });
  it("raiz é 1/1", () => {
    const r = irmaos(porId.get("r")!, porId, filhosDe);
    expect([r.indice, r.total, r.anterior, r.proximo]).toEqual([0, 1, null, null]);
  });
});

describe("camposDados", () => {
  it("lista campos básicos, omite ausentes e inclui cada fato", () => {
    const n = no("z", "r", {
      path: "/p",
      metrica: { valor: 14, rotulo: "itens" },
      facts: [{ label: "Chave", value: "V" }],
    });
    const c = camposDados(n);
    const chaves = c.map((x) => x.chave);
    expect(chaves).toEqual(["id", "kind", "camada", "tag", "path", "parent", "métrica", "Chave"]);
    expect(c.find((x) => x.chave === "métrica")?.valor).toBe("14 itens");
  });
  it("status só aparece quando o item tem", () => {
    expect(camposDados(no("z", "r")).map((x) => x.chave)).not.toContain("status");
    expect(camposDados(no("z", "r", { status: "ativo" })).map((x) => x.chave)).toContain("status");
  });
  it("sem path/parent/métrica, omite", () => {
    const chaves = camposDados(no("r", null)).map((x) => x.chave);
    expect(chaves).not.toContain("path");
    expect(chaves).not.toContain("parent");
    expect(chaves).not.toContain("métrica");
  });
});

describe("tipoDoNo", () => {
  it("item mostra a camada; os outros mostram o kind", () => {
    expect(tipoDoNo({ kind: "item", tag: "Camada A" })).toBe("Camada A · item");
    expect(tipoDoNo({ kind: "item", tag: "" })).toBe("item");
    expect(tipoDoNo({ kind: "camada", tag: "camada" })).toBe("camada");
  });
});
