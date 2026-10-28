/**
 * Camada ECOSSISTEMA do /grafo: skills, squads, agents, workers, workflows,
 * clones, shadows, engines e repos como nós, lidos do MESMO inventário de
 * /agente (lib/ecosystem.ts). Fixture inline: não depende de disco nem de rede.
 */
import { describe, expect, it } from "vitest";
import {
  ECO_EDGE_ID_BASE,
  ECO_PREFIXO,
  ligarEcossistemaATopologia,
  montarGrafoEcossistema,
  pathAbsoluto,
} from "./grafo-ecossistema";
import type { EcoEntity } from "./types";

function ent(p: Partial<EcoEntity> & Pick<EcoEntity, "id" | "kind">): EcoEntity {
  return {
    legacyId: p.id,
    namespace: "registro",
    name: p.id.split(":").pop()!,
    nome: p.nome ?? p.id.split(":").pop()!,
    descricao: "",
    origem: "teste",
    path: `skills/${p.id.split(":").pop()}`,
    procedencia: "propria",
    tags: [],
    meta: {},
    ...p,
  };
}

const ENTIDADES: EcoEntity[] = [
  ent({ id: "squad:crew:conteudo", kind: "squad", path: "equipes/conteudo" }),
  ent({ id: "worker:squad:crew:conteudo:redator", kind: "worker", squadId: "squad:crew:conteudo" }),
  ent({ id: "skill:x:kanban", kind: "skill", squadId: "squad:crew:conteudo" }),
  ent({ id: "skill:x:solta", kind: "skill" }),
  ent({ id: "agent:x:revisor", kind: "agent", procedencia: "adotada" }),
  // pai que não existe no inventário — não pode virar aresta pendurada
  ent({ id: "worker:squad:x:orfao", kind: "worker", squadId: "squad:inexistente" }),
];

describe("montarGrafoEcossistema", () => {
  const g = montarGrafoEcossistema(ENTIDADES, { raiz: "/raiz" });
  const ids = new Set(g.nodes.map((n) => n.id));

  it("todo nó leva o prefixo da camada e a camada ecossistema", () => {
    for (const n of g.nodes) {
      expect(n.id.startsWith(ECO_PREFIXO)).toBe(true);
      expect(n.camada).toBe("ecossistema");
      expect(n.tipo).toBe("ecossistema");
    }
  });

  it("toda aresta aponta pra nós existentes e usa ID negativo no espaço próprio", () => {
    for (const e of g.edges) {
      expect(ids.has(e.src)).toBe(true);
      expect(ids.has(e.dst)).toBe(true);
      expect(e.id).toBeLessThanOrEqual(ECO_EDGE_ID_BASE);
      expect(e.camada).toBe("ecossistema");
    }
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(g.edges.length);
  });

  it("filho de squad liga ao squad (pertence a), não ao hub do kind", () => {
    const w = g.edges.find((e) => e.src === `${ECO_PREFIXO}worker:squad:crew:conteudo:redator`);
    expect(w?.dst).toBe(`${ECO_PREFIXO}squad:crew:conteudo`);
    expect(w?.rel).toBe("pertence a");
  });

  it("entidade sem pai — ou com pai fora do inventário — liga ao hub do seu kind", () => {
    const solta = g.edges.find((e) => e.src === `${ECO_PREFIXO}skill:x:solta`);
    expect(solta?.dst).toBe(`${ECO_PREFIXO}hub:skill`);
    const orfao = g.edges.find((e) => e.src === `${ECO_PREFIXO}worker:squad:x:orfao`);
    expect(orfao?.dst).toBe(`${ECO_PREFIXO}hub:worker`);
  });

  it("nenhuma entidade fica isolada (o canvas só desenha nó com aresta)", () => {
    const comAresta = new Set(g.edges.flatMap((e) => [e.src, e.dst]));
    for (const n of g.nodes) expect(comAresta.has(n.id)).toBe(true);
  });

  it("hubs são estruturais e contam o kind; entidades carregam path absoluto e kind", () => {
    const hub = g.nodes.find((n) => n.id === `${ECO_PREFIXO}hub:skill`);
    expect(hub?.estrutural).toBe(true);
    expect(hub?.label).toContain("2");
    const k = g.nodes.find((n) => n.id === `${ECO_PREFIXO}skill:x:kanban`);
    expect(k?.ecoKind).toBe("skill");
    expect(k?.estrutural).toBeFalsy();
    expect(k?.path).toBe("/raiz/skills/kanban");
  });

  it("filtro de kind tira o kind E o hub; filho do squad removido cai pro hub do próprio kind", () => {
    const s = montarGrafoEcossistema(ENTIDADES, { kinds: ["skill", "worker"] });
    expect(s.nodes.some((n) => n.ecoKind === "squad")).toBe(false);
    const w = s.edges.find((e) => e.src === `${ECO_PREFIXO}worker:squad:crew:conteudo:redator`);
    expect(w?.dst).toBe(`${ECO_PREFIXO}hub:worker`);
  });

  it("filtro de procedência", () => {
    const s = montarGrafoEcossistema(ENTIDADES, { procedencias: ["adotada"] });
    const ents = s.nodes.filter((n) => !n.estrutural);
    expect(ents.map((n) => n.id)).toEqual([`${ECO_PREFIXO}agent:x:revisor`]);
  });

  it("data vem do mapa passado pela rota (montagem continua pura)", () => {
    const s = montarGrafoEcossistema(ENTIDADES, {
      datas: new Map([["skill:x:solta", "2026-10-01"]]),
    });
    expect(s.nodes.find((n) => n.id === `${ECO_PREFIXO}skill:x:solta`)?.data).toBe("2026-10-01");
  });

  it("inventário vazio devolve camada vazia, sem hub fantasma", () => {
    expect(montarGrafoEcossistema([])).toEqual({ nodes: [], edges: [] });
  });
});

describe("pathAbsoluto", () => {
  it("completa com a raiz, preserva absoluto e não inventa raiz", () => {
    expect(pathAbsoluto("a/b", "/raiz/")).toBe("/raiz/a/b");
    expect(pathAbsoluto("./a", "/raiz")).toBe("/raiz/a");
    expect(pathAbsoluto("/ja/absoluto", "/raiz")).toBe("/ja/absoluto");
    expect(pathAbsoluto("C:\\x\\y", "/raiz")).toBe("C:\\x\\y");
    expect(pathAbsoluto("a/b")).toBe("a/b");
    expect(pathAbsoluto("", "/raiz")).toBe("");
  });
});

describe("ligarEcossistemaATopologia", () => {
  it("liga entidade ao nó do disco com o mesmo path e ignora quem não tem par", () => {
    const g = montarGrafoEcossistema(ENTIDADES, { raiz: "/raiz" });
    const topo = [{ id: "topo:/raiz/skills/kanban", path: "/raiz/skills/kanban" }];
    const arestas = ligarEcossistemaATopologia(g.nodes, topo, ECO_EDGE_ID_BASE - 10_000);
    expect(arestas).toHaveLength(1);
    expect(arestas[0]).toMatchObject({
      src: `${ECO_PREFIXO}skill:x:kanban`,
      dst: "topo:/raiz/skills/kanban",
      rel: "mora em",
    });
  });

  it("casa o path da topologia no formato do Windows (\\ e unidade) com o de pathAbsoluto (/)", () => {
    const g = montarGrafoEcossistema(ENTIDADES, { raiz: "x:\\raiz" });
    const topo = [
      { id: "topo:kanban", path: "X:\\raiz\\skills\\kanban" },
      // pasta-mãe não pode casar: a comparação continua exata, só o separador muda
      { id: "topo:skills", path: "X:\\raiz\\skills\\" },
    ];
    const arestas = ligarEcossistemaATopologia(g.nodes, topo, ECO_EDGE_ID_BASE - 10_000);
    expect(arestas.map((a) => [a.src, a.dst])).toEqual([[`${ECO_PREFIXO}skill:x:kanban`, "topo:kanban"]]);
  });
});
