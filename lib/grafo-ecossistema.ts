/**
 * Camada ECOSSISTEMA do /grafo: o grafo deixa de ser só base de conhecimento e
 * passa a mapear o inventário inteiro (skills, squads, agents, workers,
 * workflows, clones, shadows, engines e repos).
 *
 * REUSE: a fonte é o MESMO inventário de /agente (`getEcosystem()` em
 * lib/ecosystem.ts). Este módulo só projeta as entidades em nós/arestas: não
 * lê disco nem reclassifica nada, então os números batem com /agente. Sem
 * entidades (inventário não configurado), a camada nasce vazia.
 *
 * Estrutura: raiz → hub por kind → entidade. Quem tem pai lógico (`squadId`:
 * worker/skill → squad) liga ao squad em vez do hub. Hubs e raiz são
 * `estrutural` (não têm data própria).
 *
 * IDs de aresta: sintéticos e NEGATIVOS, num espaço próprio (`ECO_EDGE_ID_BASE`)
 * afastado dos de outras camadas sintéticas do grafo.
 *
 * Tipos próprios (`NoEcossistema`/`ArestaEcossistema`): estruturalmente
 * compatíveis com `KgNode`/`KgEdge` de lib/kg.ts (que já aceitam a camada
 * "ecossistema" e os campos opcionais `estrutural`, `ecoKind`, `procedencia`,
 * `descricao` e `data`). A rota /api/graph mescla os dois grafos.
 *
 * API estável: `ECO_PREFIXO`, `ECO_EDGE_ID_BASE`, `ECO_KINDS`, `pathAbsoluto`,
 * `montarGrafoEcossistema`, `ligarEcossistemaATopologia` e os tipos exportados.
 */
import type { EcoEntity, EcoKind, EcoProcedencia } from "./types";

/** Prefixo dos nós da camada: não colide com os ids de outras camadas do grafo. */
export const ECO_PREFIXO = "eco:";

/** Base dos ids sintéticos de aresta (decrescentes). Fica longe do espaço de
 *  ids das outras camadas para não haver colisão. */
export const ECO_EDGE_ID_BASE = -3_000_000;

/** Ordem = ordem dos chips no filtro. */
export const ECO_KINDS: EcoKind[] = [
  "squad",
  "agent",
  "skill",
  "worker",
  "workflow",
  "clone",
  "shadow",
  "engine",
  "repo",
];

const PLURAL: Record<EcoKind, string> = {
  squad: "squads",
  agent: "agents",
  skill: "skills",
  worker: "workers",
  workflow: "workflows",
  clone: "clones",
  shadow: "shadows",
  engine: "engines",
  repo: "repos",
};

export type NoEcossistema = {
  id: string;
  label: string;
  tipo: "ecossistema";
  camada: "ecossistema";
  /** raiz e hubs por kind: não são entidades do inventário */
  estrutural?: boolean;
  ecoKind?: EcoKind;
  procedencia?: EcoProcedencia;
  descricao?: string;
  /** caminho absoluto, quando a raiz é informada (ver `pathAbsoluto`) */
  path?: string;
  /** YYYY-MM-DD, vindo do mapa `datas` */
  data?: string;
  grau: number;
};

export type ArestaEcossistema = {
  id: number;
  src: string;
  rel: string;
  dst: string;
  status: "confirmed";
  n_fontes: number;
  peso: number;
  camada: "ecossistema";
};

/** `Entity.path` é relativo à raiz configurada (BILHON_ROOT); o nó leva o
 *  absoluto (é o que casa com os ids da topologia e o que o painel mostra).
 *  Função pura: quem chama passa a raiz (`bilhonRoot()` em lib/bilhon-paths).
 *  Sem raiz, devolve o caminho como veio. */
export function pathAbsoluto(p: string, raiz?: string): string {
  if (!p || !raiz) return p;
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return p;
  return `${raiz.replace(/[\\/]+$/, "")}/${p.replace(/^\.\//, "")}`;
}

export type GrafoEcossistemaOpts = {
  kinds?: EcoKind[];
  procedencias?: EcoProcedencia[];
  /** entity.id → YYYY-MM-DD, calculado pela rota */
  datas?: Map<string, string>;
  /** raiz absoluta usada para completar `path` dos nós */
  raiz?: string;
};

export function montarGrafoEcossistema(
  entidades: EcoEntity[],
  opts: GrafoEcossistemaOpts = {},
): { nodes: NoEcossistema[]; edges: ArestaEcossistema[] } {
  const kinds = opts.kinds?.length ? new Set(opts.kinds) : null;
  const procs = opts.procedencias?.length ? new Set(opts.procedencias) : null;
  const ativas = entidades.filter(
    (e) => (!kinds || kinds.has(e.kind)) && (!procs || procs.has(e.procedencia)),
  );
  if (ativas.length === 0) return { nodes: [], edges: [] };

  const presentes = new Set(ativas.map((e) => e.id));
  const nodes: NoEcossistema[] = [];
  const edges: ArestaEcossistema[] = [];
  const grau = new Map<string, number>();
  let eid = ECO_EDGE_ID_BASE;
  const liga = (src: string, rel: string, dst: string) => {
    edges.push({ id: eid--, src, rel, dst, status: "confirmed", n_fontes: 1, peso: 1, camada: "ecossistema" });
    grau.set(src, (grau.get(src) ?? 0) + 1);
    grau.set(dst, (grau.get(dst) ?? 0) + 1);
  };

  const raiz = `${ECO_PREFIXO}raiz`;
  const porKind = new Map<EcoKind, number>();
  for (const e of ativas) porKind.set(e.kind, (porKind.get(e.kind) ?? 0) + 1);

  for (const k of ECO_KINDS) {
    const n = porKind.get(k);
    if (!n) continue;
    liga(raiz, "contém", `${ECO_PREFIXO}hub:${k}`);
  }
  for (const e of ativas) {
    const id = ECO_PREFIXO + e.id;
    const pai = e.squadId && e.squadId !== e.id && presentes.has(e.squadId) ? e.squadId : null;
    if (pai) liga(id, "pertence a", ECO_PREFIXO + pai);
    else liga(id, "é um", `${ECO_PREFIXO}hub:${e.kind}`);
  }

  nodes.push({
    id: raiz,
    label: `ecossistema (${ativas.length})`,
    tipo: "ecossistema",
    camada: "ecossistema",
    estrutural: true,
    grau: grau.get(raiz) ?? 0,
  });
  for (const k of ECO_KINDS) {
    const n = porKind.get(k);
    if (!n) continue;
    const id = `${ECO_PREFIXO}hub:${k}`;
    nodes.push({
      id,
      label: `${PLURAL[k]} (${n})`,
      tipo: "ecossistema",
      camada: "ecossistema",
      ecoKind: k,
      estrutural: true,
      grau: grau.get(id) ?? 0,
    });
  }
  for (const e of ativas) {
    const id = ECO_PREFIXO + e.id;
    const data = opts.datas?.get(e.id);
    nodes.push({
      id,
      label: e.nome || e.name,
      tipo: "ecossistema",
      camada: "ecossistema",
      ecoKind: e.kind,
      procedencia: e.procedencia,
      descricao: e.descricao ? e.descricao.slice(0, 280) : undefined,
      path: pathAbsoluto(e.path, opts.raiz),
      ...(data ? { data } : {}),
      grau: grau.get(id) ?? 0,
    });
  }
  return { nodes, edges };
}

/**
 * Ponte entre camadas: com ecossistema E topologia ligados, a skill do
 * inventário e a pasta dela no disco viram o mesmo lugar (`mora em`). Só casa
 * path idêntico: aproximar por prefixo ligaria tudo à pasta-mãe.
 */
export function ligarEcossistemaATopologia(
  eco: Pick<NoEcossistema, "id" | "path" | "estrutural">[],
  topo: { id: string; path?: string }[],
  idBase: number,
): ArestaEcossistema[] {
  const topoPorPath = new Map<string, string>();
  for (const t of topo) if (t.path) topoPorPath.set(t.path.replace(/\/$/, ""), t.id);
  const out: ArestaEcossistema[] = [];
  let eid = idBase;
  for (const n of eco) {
    if (n.estrutural || !n.path) continue;
    const alvo = topoPorPath.get(n.path.replace(/\/$/, ""));
    if (alvo)
      out.push({ id: eid--, src: n.id, rel: "mora em", dst: alvo, status: "confirmed", n_fontes: 1, peso: 1, camada: "ecossistema" });
  }
  return out;
}
