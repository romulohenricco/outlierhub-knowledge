import { describe, expect, it } from "vitest";
import type { EcoEntity } from "../types";
import { agruparPorFonte } from "./fontes";
import { LENTE_TODAS, PALETA_PILARES, casaLente, cenaPilar, cenaVisaoGeral, contagensLegenda, listarPilares, opcoesLente } from "./cena";
import { ORG, ent } from "./fixtures-teste";

const sq = ent("squad", "equipes/a/squad");
const ents = [sq, ent("worker", "equipes/a/w", sq.id), ent("skill", "equipes/a/s", sq.id), ent("skill", "equipes/a/solta"), ent("agent", "agentes/x")];
const fontes = agruparPorFonte(ents);

describe("listarPilares", () => {
  it("organização primeiro (na ordem do arquivo), depois pilares de fonte; sem organização só fontes", () => {
    const p = listarPilares(ORG, fontes);
    expect(p.map((x) => x.nome)).toEqual(["Pilar A", "Pilar B", "equipes", "agentes"]);
    expect(listarPilares(null, fontes).map((x) => x.origem)).toEqual(["fonte", "fonte"]);
    expect(listarPilares(null, [])).toEqual([]);
  });
  it("cor do arquivo vale; sem cor, paleta por posição", () => {
    const [a, b] = listarPilares(ORG, []);
    expect(a.cor).toBe(PALETA_PILARES[0]);
    expect(b.cor).toBe("#112233");
  });
  it("leva o nome do ícone (ou nulo) para o desenho", () => {
    const [a, b] = listarPilares(ORG, []);
    expect(a.icone).toBe("alvo");
    expect(b.icone).toBeNull();
  });
});

describe("cenaPilar — organização", () => {
  const pilares = listarPilares(ORG, fontes);
  const c = cenaPilar(pilares[0], ORG);
  const y = (t: string) => [...new Set(c.nos.filter((n) => n.tipo === t).map((n) => n.y))];

  it("fileiras de baixo para cima: pilar < tarefas < agentes/pessoas < ferramentas", () => {
    const [yp, yt, ya, yf] = [y("pilar")[0], y("tarefa")[0], y("agente")[0], y("ferramenta")[0]];
    expect(yp).toBeGreaterThan(yt);
    expect(yt).toBeGreaterThan(ya);
    expect(ya).toBeGreaterThan(yf);
    expect(y("humano")).toEqual(y("agente"));
  });

  it("só o conteúdo do pilar, com contagens reais", () => {
    expect(c.nos.filter((n) => n.tipo === "tarefa")).toHaveLength(2);
    expect(c.nos.filter((n) => n.tipo === "agente")).toHaveLength(3); // a0, a1, a3
    expect(c.nos.filter((n) => n.tipo === "humano")).toHaveLength(1);
    expect(c.nos.filter((n) => n.tipo === "ferramenta").map((n) => n.rotulo).sort()).toEqual(["Ferramenta Dois", "Ferramenta Um"]);
  });

  it("arestas: pilar→tarefa pontilhada; tarefa→executor sólida; executor→ferramenta fina", () => {
    const e = (de: string, para: string) => c.arestas.find((a) => a.de === de && a.para === para)?.estilo;
    expect(e("pilar:d1", "tarefa:t1")).toBe("pontilhada");
    expect(e("tarefa:t1", "agente:a1")).toBe("solida");
    expect(e("agente:a1", "ferramenta:t1")).toBe("fina");
  });

  it("agente sem tarefa liga ao pilar (pertencimento real), não a uma tarefa", () => {
    expect(c.arestas.find((a) => a.para === "agente:a3")).toMatchObject({ de: "pilar:d1", estilo: "pontilhada" });
  });

  it("nenhuma aresta aponta pra nó inexistente e nenhum nó se sobrepõe na fileira", () => {
    const ids = new Set(c.nos.map((n) => n.id));
    for (const a of c.arestas) expect(ids.has(a.de) && ids.has(a.para)).toBe(true);
    const porFileira = new Map<number, number[]>();
    for (const n of c.nos) (porFileira.get(n.y) ?? porFileira.set(n.y, []).get(n.y)!).push(n.x);
    for (const xs of porFileira.values()) {
      const s = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeGreaterThanOrEqual(40);
    }
  });
});

describe("cenaPilar — fonte do inventário", () => {
  const pilares = listarPilares(null, fontes);
  const equipes = pilares.find((p) => p.nome === "equipes")!;
  const c = cenaPilar(equipes, null);
  it("fileiras: squads (base) < workers < skills (topo)", () => {
    const yy = (t: string) => c.nos.find((n) => n.tipo === t)!.y;
    expect(yy("pilar")).toBeGreaterThan(yy("squad"));
    expect(yy("squad")).toBeGreaterThan(yy("worker"));
    expect(yy("worker")).toBeGreaterThan(yy("skill"));
  });
  it("avulsos são contados em um nó sem aresta", () => {
    const av = c.nos.find((n) => n.tipo === "avulsos")!;
    expect(av.rotulo).toMatch(/1/);
    expect(c.arestas.some((a) => a.de === av.id || a.para === av.id)).toBe(false);
  });
  it("skill liga ao squad pai por linha fina; worker por linha sólida", () => {
    const skill = c.nos.find((n) => n.tipo === "skill")!;
    const worker = c.nos.find((n) => n.tipo === "worker")!;
    expect(c.arestas.find((a) => a.para === skill.id)?.estilo).toBe("fina");
    expect(c.arestas.find((a) => a.para === worker.id)?.estilo).toBe("solida");
  });
  it("teto por fileira com 'N de M' explícito", () => {
    const grande: EcoEntity[] = [];
    for (let i = 0; i < 40; i++) {
      const s = ent("squad", `equipes/g${i}`);
      grande.push(s, ent("worker", "equipes/w", s.id), ent("worker", "equipes/w", s.id), ent("worker", "equipes/w", s.id));
    }
    const f = agruparPorFonte(grande);
    const cg = cenaPilar(listarPilares(null, f)[0], null);
    expect(cg.nos.filter((n) => n.tipo === "squad").length).toBeLessThanOrEqual(10);
    expect(cg.nos.filter((n) => n.tipo === "worker").length).toBeLessThanOrEqual(16);
    expect(cg.mostrando).toMatchObject({ squad: { de: 10, total: 40 } });
  });
  it("pilar sem dado nenhum devolve cena vazia, sem lançar", () => {
    expect(cenaPilar({ id: "pilar:x", nome: "X", cor: "#fff", origem: "org" }, null).nos).toEqual([]);
  });
});

describe("cenaVisaoGeral", () => {
  const pilares = listarPilares(ORG, fontes);
  const c = cenaVisaoGeral(pilares, ORG);
  it("um nó por pilar e fantasmas de tarefas/agentes/ferramentas vindos do dado", () => {
    expect(c.nos.filter((n) => n.tipo === "pilar")).toHaveLength(4);
    expect(c.nos.filter((n) => n.tipo === "tarefa")).toHaveLength(3);
    expect(c.nos.filter((n) => n.tipo === "ferramenta")).toHaveLength(3);
    expect(c.nos.filter((n) => n.tipo === "agente" || n.tipo === "humano")).toHaveLength(5);
  });
  it("ids únicos e toda aresta aponta para nó existente", () => {
    const ids = c.nos.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of c.arestas) expect(ids.includes(a.de) && ids.includes(a.para)).toBe(true);
  });
  it("cada pilar nasce no ângulo central do próprio bloco de executores (determinístico)", () => {
    const ang = (id: string) => Math.atan2(c.nos.find((n) => n.id === id)!.y, c.nos.find((n) => n.id === id)!.x);
    const diff = (a: number, b: number) => Math.min(Math.abs(a - b), 2 * Math.PI - Math.abs(a - b));
    const a0 = ang("agente:a0");
    const a3 = ang("agente:a3");
    // o pilar A tem 4 executores (a0, a1, a3 e a pessoa): o pilar fica entre o primeiro e o último
    expect(diff(ang("pilar:d1"), a0)).toBeLessThan(Math.PI / 2);
    expect(diff(ang("pilar:d1"), a3)).toBeLessThan(Math.PI / 2);
    expect(cenaVisaoGeral(pilares, ORG)).toEqual(c);
  });
  it("sem organização: só pilares de fonte, sem fantasmas", () => {
    const s = cenaVisaoGeral(listarPilares(null, fontes), null);
    expect(s.nos.filter((n) => n.tipo === "tarefa")).toHaveLength(0);
    expect(s.nos.filter((n) => n.tipo === "pilar")).toHaveLength(2);
  });
  it("nada configurado: cena vazia", () => {
    expect(cenaVisaoGeral([], null).nos).toEqual([]);
  });
});

describe("lentes", () => {
  const pilares = listarPilares(ORG, fontes);
  const c = cenaPilar(pilares[0], ORG);
  const no = (id: string) => c.nos.find((n) => n.id === id)!;
  it("todas = tudo casa", () => {
    expect(c.nos.every((n) => casaLente(n, LENTE_TODAS))).toBe(true);
  });
  it("Entidade: pessoas", () => {
    expect(casaLente(no("pessoa:p1"), { ...LENTE_TODAS, entidade: "humano" })).toBe(true);
    expect(casaLente(no("agente:a1"), { ...LENTE_TODAS, entidade: "humano" })).toBe(false);
  });
  it("Entidade: sub-agentes = agentes com pai", () => {
    expect(casaLente(no("agente:a1"), { ...LENTE_TODAS, entidade: "subagente" })).toBe(true);
    expect(casaLente(no("agente:a0"), { ...LENTE_TODAS, entidade: "subagente" })).toBe(false);
  });
  it("Função do agente", () => {
    expect(casaLente(no("agente:a0"), { ...LENTE_TODAS, funcao: "lead" })).toBe(true);
    expect(casaLente(no("agente:a1"), { ...LENTE_TODAS, funcao: "lead" })).toBe(false);
  });
  it("Ação: categoria de ferramenta alcança a ferramenta e quem a usa", () => {
    const l = { ...LENTE_TODAS, acao: "Cat Y" };
    expect(casaLente(no("ferramenta:t2"), l)).toBe(true);
    expect(casaLente(no("agente:a1"), l)).toBe(true);
    expect(casaLente(no("agente:a0"), l)).toBe(false);
  });
  it("opções vêm do dado e ficam vazias sem organização", () => {
    expect(opcoesLente(ORG)).toEqual({ funcoes: ["lead", "worker"], acoes: ["Cat X", "Cat Y", "Cat Z"] });
    expect(opcoesLente(null)).toEqual({ funcoes: [], acoes: [] });
  });
});

describe("contagensLegenda", () => {
  it("vêm do dado: pilares, tarefas, pessoas, agentes, ferramentas", () => {
    const l = contagensLegenda(ORG, fontes, null);
    const v = Object.fromEntries(l.map((i) => [i.id, i.total]));
    expect(v).toMatchObject({ pilar: 4, tarefa: 3, humano: 1, agente: 4, ferramenta: 3 });
  });
  it("sem nada: legenda vazia", () => {
    expect(contagensLegenda(null, [], null).filter((i) => i.id !== "pilar")).toEqual([]);
  });
});
