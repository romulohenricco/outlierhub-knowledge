import { describe, expect, it } from "vitest";
import {
  CAMADAS_NEURAL,
  agruparDiretorio,
  camadasNeural,
  eixosRadar,
  layoutAneis,
  faixasProcedencia,
  fonteNormalizada,
  montarGrafo,
  notaSaude,
  pipelineFontes,
  vizinhos,
} from "./ecosystem-graph";
import type { EcoEntity, EcoKind, EcoProcedencia, EcoUsoStatus } from "./types";

let seq = 0;
function ent(
  kind: EcoKind,
  extra: {
    id?: string;
    squadId?: string;
    procedencia?: EcoProcedencia;
    uso?: EcoUsoStatus;
    namespace?: string;
    origem?: string;
    nome?: string;
  } = {},
): EcoEntity {
  const n = ++seq;
  const id = extra.id ?? `${kind}:x:${n}`;
  return {
    id,
    legacyId: id,
    kind,
    namespace: extra.namespace ?? "core",
    name: `n${n}`,
    nome: extra.nome ?? `Nome ${n}`,
    descricao: "",
    origem: extra.origem ?? "registro",
    path: `p/${n}`,
    procedencia: extra.procedencia ?? "propria",
    squadId: extra.squadId,
    tags: [],
    meta: {},
    uso: extra.uso
      ? {
          eventos: 0,
          logsession: 0,
          invocacao: 0,
          leitura_fraca: 0,
          sinais: extra.uso === "sem-sinal" ? 0 : 1,
          status: extra.uso,
          dias: 0,
          ultimo: null,
          ambiguo: false,
          tocada_por_teste: false,
          proveniencia: "atribuida",
          fontes: [],
        }
      : undefined,
  };
}

describe("montarGrafo", () => {
  it("liga filho ao pai por squadId e conta arestas órfãs sem inventar o pai", () => {
    const s = ent("squad", { id: "squad:a" });
    const w1 = ent("worker", { squadId: "squad:a" });
    const w2 = ent("worker", { squadId: "squad:fora-do-recorte" });
    const g = montarGrafo([s, w1, w2]);
    expect(g.nos.map((n) => n.id)).toEqual([s.id, w1.id, w2.id]);
    expect(g.arestas).toEqual([{ source: "squad:a", target: w1.id }]);
    expect(g.orfas).toBe(1);
  });

  it("ignora auto-laço e não duplica aresta", () => {
    const s = ent("squad", { id: "squad:a", squadId: "squad:a" });
    const g = montarGrafo([s]);
    expect(g.arestas).toHaveLength(0);
    expect(g.orfas).toBe(0);
  });

  it("nó carrega uso (null quando não medido)", () => {
    const a = ent("skill", { uso: "raro" });
    const b = ent("skill");
    const g = montarGrafo([a, b]);
    expect(g.nos[0].uso).toBe("raro");
    expect(g.nos[1].uso).toBeNull();
  });
});

describe("vizinhos", () => {
  it("devolve pai e filhos diretos + o próprio nó", () => {
    const s = ent("squad", { id: "squad:a" });
    const w = ent("worker", { squadId: "squad:a" });
    const outro = ent("worker");
    const g = montarGrafo([s, w, outro]);
    expect([...vizinhos(g, w.id)].sort()).toEqual([s.id, w.id].sort());
    expect(vizinhos(g, s.id).has(outro.id)).toBe(false);
  });
});

describe("camadasNeural", () => {
  it("ordem das camadas cobre todos os kinds exatamente uma vez", () => {
    const todos = CAMADAS_NEURAL.flatMap((c) => c.kinds);
    expect(new Set(todos).size).toBe(todos.length);
    expect(todos.sort()).toEqual(
      ["agent", "clone", "engine", "repo", "shadow", "skill", "squad", "worker", "workflow"].sort(),
    );
  });

  it("agrega por camada+namespace e pesa ligações pai→filho entre clusters", () => {
    const s = ent("squad", { id: "squad:a", namespace: "ns1" });
    const w = ent("worker", { squadId: "squad:a", namespace: "ns1" });
    const w2 = ent("worker", { squadId: "squad:a", namespace: "ns1" });
    const sk = ent("skill", { squadId: "squad:a", namespace: "ns2" });
    const r = camadasNeural([s, w, w2, sk]);
    const camadaExec = r.camadas.find((c) => c.id === "executores")!;
    expect(camadaExec.clusters).toHaveLength(1);
    expect(camadaExec.clusters[0].total).toBe(2);
    const pesoExec = r.ligacoes.find((l) => l.para === camadaExec.clusters[0].id)!;
    expect(pesoExec.peso).toBe(2);
    expect(r.ligacoes.reduce((a, l) => a + l.peso, 0)).toBe(3);
  });

  it("limita clusters por camada e junta o resto em 'outros'", () => {
    const es = Array.from({ length: 5 }, (_, i) => ent("skill", { namespace: `ns${i}` }));
    const r = camadasNeural(es, 3);
    const sk = r.camadas.find((c) => c.id === "skills")!;
    expect(sk.clusters).toHaveLength(3);
    expect(sk.clusters.at(-1)!.outros).toBe(true);
    expect(sk.clusters.reduce((a, c) => a + c.total, 0)).toBe(5);
  });

  it("conta ligações internas (mesmo cluster) à parte e entidades sem ligação", () => {
    const s = ent("squad", { id: "squad:a", namespace: "ns" });
    const sub = ent("squad", { squadId: "squad:a", namespace: "ns" });
    const e = ent("engine");
    const r = camadasNeural([s, sub, e]);
    expect(r.internas).toBe(1);
    expect(r.ligacoes).toHaveLength(0);
    expect(r.semLigacao).toBe(1); // só a engine: s e sub estão ligados entre si
  });
});

describe("notaSaude", () => {
  it("é % das entidades medidas com algum sinal de uso; null sem medição", () => {
    const es = [ent("skill", { uso: "frequente" }), ent("skill", { uso: "raro" }), ent("skill", { uso: "sem-sinal" }), ent("skill", { uso: "sem-sinal" }), ent("skill")];
    const s = notaSaude(es);
    expect(s.medidos).toBe(4);
    expect(s.comSinal).toBe(2);
    expect(s.nota).toBe(50);
    expect(s.cobertura).toBe(80);
    expect(notaSaude([ent("skill")]).nota).toBeNull();
    expect(notaSaude([]).nota).toBeNull();
  });
});

describe("eixosRadar", () => {
  it("um eixo por kind, camadas derivadas, volume normalizado pelo maior", () => {
    const es = [
      ent("skill", { uso: "frequente", procedencia: "propria" }),
      ent("skill", { uso: "ocasional", procedencia: "adotada" }),
      ent("skill", { uso: "sem-sinal", procedencia: "adotada" }),
      ent("skill", { uso: "raro", procedencia: "terceiro" }),
      ent("agent", { procedencia: "propria" }),
    ];
    const r = eixosRadar(es);
    expect(r).toHaveLength(9);
    const sk = r.find((a) => a.kind === "skill")!;
    expect(sk.total).toBe(4);
    expect(sk.volume).toBe(100);
    // escala √: agent (1) vs skill (4) = 50, não 25
    expect(sk.ativos).toBe(50); // frequente+ocasional / medidos
    expect(sk.semSinal).toBe(25);
    expect(sk.propria).toBe(25);
    const ag = r.find((a) => a.kind === "agent")!;
    expect(ag.volume).toBeCloseTo(50, 5);
    expect(ag.medidos).toBe(0);
    expect(ag.ativos).toBe(0);
    expect(ag.propria).toBe(100);
    expect(r.find((a) => a.kind === "repo")!.total).toBe(0);
  });
});

describe("faixasProcedencia", () => {
  it("uma faixa por procedência com pct do total e estado derivado", () => {
    const es = [
      ent("skill", { procedencia: "propria", uso: "frequente" }),
      ent("skill", { procedencia: "propria" }),
      ent("skill", { procedencia: "adotada" }),
    ];
    const f = faixasProcedencia(es);
    expect(f.map((x) => x.procedencia)).toEqual(["propria", "adotada", "terceiro"]);
    expect(f[0]).toMatchObject({ total: 2, comSinal: 1, estado: "com-sinal" });
    expect(Math.round(f[0].pct)).toBe(67);
    expect(f[1].estado).toBe("sem-medicao");
    expect(f[2].estado).toBe("vazio");
  });
});

describe("fonteNormalizada / pipelineFontes", () => {
  it("origem com path de arquivo colapsa nos 2 primeiros diretórios", () => {
    expect(fonteNormalizada("pasta/sub/squads/equipe/agents/revisor.md")).toBe("pasta/sub/…");
    expect(fonteNormalizada("equipes/revisao.yaml")).toBe("equipes/…");
    expect(fonteNormalizada("registro.yaml")).toBe("registro.yaml");
  });

  it("estágios saem dos dados: fontes → entidades → com pai resolvido", () => {
    const s = ent("squad", { id: "squad:a", origem: "a.yaml" });
    const w = ent("worker", { squadId: "squad:a", origem: "x/y/z.md" });
    const w2 = ent("worker", { origem: "x/y/w.md" });
    const p = pipelineFontes([s, w, w2]);
    expect(p.fontes.map((f) => [f.fonte, f.total])).toEqual([
      ["x/y/…", 2],
      ["a.yaml", 1],
    ]);
    expect(p.estagios.map((e) => e.valor)).toEqual([2, 3, 1]);
  });

  it("limita a lista de fontes e agrega o resto", () => {
    const es = ["a", "b", "c", "d"].map((o) => ent("skill", { origem: `${o}.yaml` }));
    const p = pipelineFontes(es, 2);
    expect(p.fontes).toHaveLength(3);
    expect(p.fontes.at(-1)!.fonte).toBe("outras (2)");
    expect(p.estagios[0].valor).toBe(4);
  });
});

describe("agruparDiretorio", () => {
  it("agrupa por kind na ordem canônica, ordenando por nome", () => {
    const es = [ent("worker", { nome: "b" }), ent("squad", { nome: "z" }), ent("worker", { nome: "a" })];
    const g = agruparDiretorio(es, "kind");
    expect(g.map((x) => x.chave)).toEqual(["squad", "worker"]);
    expect(g[1].itens.map((i) => i.nome)).toEqual(["a", "b"]);
  });

  it("agrupa por squad; sem pai vai pro grupo 'sem squad'", () => {
    const s = ent("squad", { id: "squad:a", nome: "Alfa" });
    const w = ent("worker", { squadId: "squad:a" });
    const solto = ent("skill");
    const g = agruparDiretorio([s, w, solto], "squad");
    expect(g[0].rotulo).toBe("Alfa");
    expect(g[0].itens).toHaveLength(2); // squad + filho
    expect(g.at(-1)!.chave).toBe("__sem-squad");
  });
});

describe("layoutAneis", () => {
  it("uma faixa por kind presente, afastadas, com os nós dentro da faixa", () => {
    const s = ent("squad", { id: "squad:a" });
    const ws = Array.from({ length: 400 }, () => ent("worker", { squadId: "squad:a" }));
    const e = ent("engine");
    const l = layoutAneis(montarGrafo([e, ...ws, s]));
    expect(l.aneis.map((a) => a.kind)).toEqual(["squad", "worker", "engine"]);
    expect(l.aneis[1].raioMin).toBeGreaterThan(l.aneis[0].raioMax + 50);
    expect(l.aneis[2].raioMin).toBeGreaterThan(l.aneis[1].raioMax + 50);
    expect(l.aneis[1].trilhas).toBeGreaterThan(1); // 400 nós não cabem num anel fino
    for (const w of ws) {
      const p = l.pos.get(w.id)!;
      const d = Math.hypot(p.x, p.y);
      expect(d).toBeGreaterThanOrEqual(l.aneis[1].raioMin - 1e-6);
      expect(d).toBeLessThanOrEqual(l.aneis[1].raioMax + 1e-6);
    }
  });

  it("é determinístico e não sobrepõe nós do mesmo anel", () => {
    const s = ent("squad", { id: "squad:a" });
    const ws = Array.from({ length: 30 }, () => ent("worker", { squadId: "squad:a" }));
    const g = montarGrafo([s, ...ws]);
    const a = layoutAneis(g);
    const b = layoutAneis(g);
    expect([...a.pos.entries()]).toEqual([...b.pos.entries()]);
    const pts = ws.map((w) => a.pos.get(w.id)!);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)).toBeGreaterThan(5);
    }
  });

  it("filho cai perto do ângulo do pai (feixes curtos)", () => {
    const squads = Array.from({ length: 8 }, (_, i) => ent("squad", { id: `squad:${i}`, nome: `s${i}` }));
    const w = ent("worker", { squadId: "squad:6" });
    const outros = squads.slice(0, 6).map((s) => ent("worker", { squadId: s.id }));
    const l = layoutAneis(montarGrafo([...squads, w, ...outros]));
    const ang = (id: string) => Math.atan2(l.pos.get(id)!.y, l.pos.get(id)!.x);
    const d = Math.abs(ang(w.id) - ang("squad:6"));
    expect(Math.min(d, 2 * Math.PI - d)).toBeLessThan(Math.PI / 3);
  });
});
