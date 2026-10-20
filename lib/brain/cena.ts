/** Cenas do grafo de /agente: posições e arestas PURAS, derivadas do dado. Nada de
 *  número fixo de nós: os tetos abaixo só limitam o desenho (e a UI mostra
 *  "N de M"); a lista completa vive no diretório. */
import type { EcoEntity, EcoKind } from "../types";
import type { PilarFonte } from "./fontes";
import type { Memoria, OrgData } from "./tipos";

export type TipoNo =
  | "pilar"
  | "tarefa"
  | "agente"
  | "humano"
  | "ferramenta"
  | "squad"
  | "worker"
  | "skill"
  | "avulsos";

export type NoCena = {
  id: string;
  tipo: TipoNo;
  rotulo: string;
  x: number;
  y: number;
  cor: string;
  pilarId: string;
  /** id da coisa original (entidade do inventário, linha do arquivo de organização). */
  refId?: string;
  /** segunda linha do rótulo (avulsos: quebra por tipo). */
  detalhe?: string;
  attrs: { funcao?: string; categorias?: string[]; sub?: boolean };
};
export type EstiloAresta = "pontilhada" | "solida" | "fina";
export type ArestaCena = { de: string; para: string; estilo: EstiloAresta };
export type Mostrando = Partial<Record<TipoNo, { de: number; total: number }>>;
export type Cena = { nos: NoCena[]; arestas: ArestaCena[]; largura: number; altura: number; mostrando: Mostrando };

export type PilarCena = {
  id: string;
  nome: string;
  cor: string;
  origem: "org" | "fonte";
  /** ordem do pilar no arquivo de organização (a coluna de pilares da aba Neural segue essa ordem) */
  ordem?: number;
  tagline?: string;
  /** nome do ícone (ver pilar-icones.ts); ausente = ícone padrão */
  icone?: string | null;
  fonte?: PilarFonte;
};

/** Cores dos pilares que não declaram `cor` no arquivo de organização (por posição). */
export const PALETA_PILARES = ["#ef4444", "#22c55e", "#14b8a6", "#f59e0b", "#8b5cf6", "#3b82f6", "#f472b6", "#a3e635", "#38bdf8", "#facc15"];

/** Pilares da organização (na ordem do arquivo) e, depois, os pilares por fonte do inventário. */
export function listarPilares(org: OrgData | null, fontes: PilarFonte[]): PilarCena[] {
  const o: PilarCena[] = (org?.pilares ?? []).map((p, i) => ({
    id: p.id,
    nome: p.nome,
    cor: p.cor ?? PALETA_PILARES[i % PALETA_PILARES.length],
    origem: "org" as const,
    ordem: p.ordem,
    tagline: p.tagline,
    icone: p.icone,
  }));
  const s: PilarCena[] = fontes.map((p) => ({ id: p.id, nome: p.nome, cor: p.cor, origem: "fonte", fonte: p }));
  return [...o, ...s];
}

export const COR_FERRAMENTA = "#ef4444";
export const COR_HUMANO = "#f59e0b";
export const COR_AGENTE = "#e5e7eb";
export const COR_TAREFA = "#9ca3af";

// ── tetos de desenho (o dado completo segue no diretório) ──
export const TETO_SQUADS = 10;
export const TETO_WORKERS = 16;
export const TETO_SKILLS = 16;

const ALTURA = 640;
const Y = { pilar: 560, base: 390, meio: 235, topo: 80 };

// drill de pilar, em coordenadas próprias (1296×678): pilar embaixo, tarefas e agentes
// em fileiras, ferramentas no topo; os vizinhos do anel ficam nas laterais (ver Radial.tsx)
const LARGURA_DRILL = 1296;
const ALTURA_DRILL = 678;
const Y_DRILL = { pilar: 498, base: 340, meio: 205, topo: 88 };
const PASSO_DRILL = { exec: 53.3, ferr: 92 };
const centradoDrill = (n: number, s: number) => {
  const passo = Math.min(s, (LARGURA_DRILL - 260) / Math.max(n - 1, 1));
  return (i: number) => LARGURA_DRILL / 2 + (i - (n - 1) / 2) * passo;
};

/** Distribui `n` posições centradas em W/2 com espaçamento `s`. */
const centrado = (n: number, largura: number, s: number) => (i: number) => largura / 2 + (i - (n - 1) / 2) * s;

function larguraPara(maxN: number, s = 96): number {
  return Math.max(720, (maxN - 1) * s + 220);
}

const categoriasDe = (ids: string[], f: OrgData) => {
  const por = new Map(f.ferramentas.map((t) => [t.id, t.categoria]));
  return [...new Set(ids.map((i) => por.get(i)).filter((c): c is string => !!c))];
};

function cenaOrg(p: PilarCena, f: OrgData): Cena {
  const tarefas = f.tarefas.filter((t) => t.pilarId === p.id);
  const agentes = f.agentes.filter((a) => a.pilarId === p.id);
  const pessoas = f.pessoas.filter((h) => h.pilarId === p.id);
  const idxTarefa = new Map(tarefas.map((t, i) => [`${t.executorTipo}:${t.executorId}`, i]));

  type Exec = { id: string; tipo: "agente" | "humano"; rotulo: string; ferr: string[]; ordem: number; funcao?: string; sub?: boolean };
  const execs: Exec[] = [
    ...agentes.map((a) => ({ id: a.id, tipo: "agente" as const, rotulo: a.nome, ferr: a.ferramentas, ordem: idxTarefa.get(`agent:${a.id}`) ?? 1e6, funcao: a.funcao, sub: !!a.paiId })),
    ...pessoas.map((h) => ({ id: h.id, tipo: "humano" as const, rotulo: h.nome, ferr: h.ferramentas, ordem: idxTarefa.get(`person:${h.id}`) ?? 1e6 })),
  ].sort((a, b) => a.ordem - b.ordem || a.rotulo.localeCompare(b.rotulo));

  const idxExec = new Map(execs.map((e, i) => [e.id, i]));
  const usadas = new Map<string, number[]>();
  for (const e of execs) for (const t of e.ferr) (usadas.get(t) ?? usadas.set(t, []).get(t)!).push(idxExec.get(e.id)!);
  const ferrs = f.ferramentas
    .filter((t) => usadas.has(t.id))
    .sort((a, b) => {
      const m = (id: string) => usadas.get(id)!.reduce((s, v) => s + v, 0) / usadas.get(id)!.length;
      return m(a.id) - m(b.id) || a.nome.localeCompare(b.nome);
    });

  const largura = LARGURA_DRILL;
  const nos: NoCena[] = [{ id: p.id, tipo: "pilar", rotulo: p.nome, x: largura / 2, y: Y_DRILL.pilar, cor: p.cor, pilarId: p.id, attrs: {} }];
  const arestas: ArestaCena[] = [];
  const xt = centradoDrill(tarefas.length, PASSO_DRILL.exec);
  const catExec = new Map(execs.map((e) => [e.id, categoriasDe(e.ferr, f)]));
  tarefas.forEach((t, i) => {
    nos.push({
      id: t.id, tipo: "tarefa", rotulo: t.titulo, x: xt(i), y: Y_DRILL.base, cor: COR_TAREFA, pilarId: p.id, refId: t.id,
      attrs: { categorias: catExec.get(t.executorId) ?? [] },
    });
    arestas.push({ de: p.id, para: t.id, estilo: "pontilhada" });
  });
  const xe = centradoDrill(execs.length, PASSO_DRILL.exec);
  const comTarefa = new Set(tarefas.map((t) => t.executorId));
  execs.forEach((e, i) => {
    nos.push({
      id: e.id, tipo: e.tipo, rotulo: e.rotulo, x: xe(i), y: Y_DRILL.meio, cor: e.tipo === "humano" ? COR_HUMANO : COR_AGENTE,
      pilarId: p.id, refId: e.id, attrs: { funcao: e.funcao, sub: e.sub, categorias: catExec.get(e.id) },
    });
    if (!comTarefa.has(e.id)) arestas.push({ de: p.id, para: e.id, estilo: "pontilhada" });
    for (const t of e.ferr) arestas.push({ de: e.id, para: t, estilo: "fina" });
  });
  for (const t of tarefas) arestas.push({ de: t.id, para: t.executorId, estilo: "solida" });
  const xf = centradoDrill(ferrs.length, PASSO_DRILL.ferr);
  ferrs.forEach((t, i) =>
    nos.push({ id: t.id, tipo: "ferramenta", rotulo: t.nome, x: xf(i), y: Y_DRILL.topo, cor: COR_FERRAMENTA, pilarId: p.id, refId: t.id, attrs: { categorias: [t.categoria] } }),
  );
  // só arestas cujos dois lados existem (executor/ferramenta ausente não vira linha solta)
  const ids = new Set(nos.map((n) => n.id));
  return { nos, arestas: arestas.filter((a) => ids.has(a.de) && ids.has(a.para)), largura, altura: ALTURA_DRILL, mostrando: {} };
}

const KIND_MEIO: EcoKind[] = ["worker", "agent", "clone", "shadow"];

function cenaFonte(p: PilarCena): Cena {
  const g = p.fonte!;
  const ents = g.entidades;
  const filhos = new Map<string, EcoEntity[]>();
  const ids = new Set(ents.map((e) => e.id));
  for (const e of ents) if (e.squadId && ids.has(e.squadId)) (filhos.get(e.squadId) ?? filhos.set(e.squadId, []).get(e.squadId)!).push(e);

  const squads = ents.filter((e) => e.kind === "squad").sort((a, b) => (filhos.get(b.id)?.length ?? 0) - (filhos.get(a.id)?.length ?? 0) || a.nome.localeCompare(b.nome));
  const mostrados = squads.slice(0, TETO_SQUADS);

  // reparte o teto entre os squads mostrados em rodadas (todo squad aparece antes de qualquer um repetir)
  const repartir = (pred: (e: EcoEntity) => boolean, teto: number): { pai: string; e: EcoEntity }[] => {
    const filas = mostrados.map((s) => (filhos.get(s.id) ?? []).filter(pred).sort((a, b) => a.nome.localeCompare(b.nome)));
    const saida: { pai: string; e: EcoEntity }[] = [];
    for (let r = 0; saida.length < teto; r++) {
      let alguma = false;
      filas.forEach((fila, i) => {
        if (fila[r] && saida.length < teto) {
          saida.push({ pai: mostrados[i].id, e: fila[r] });
          alguma = true;
        }
      });
      if (!alguma) break;
    }
    // ordem final agrupada por squad pra linhas não cruzarem à toa
    const ordem = new Map(mostrados.map((s, i) => [s.id, i]));
    return saida.sort((a, b) => ordem.get(a.pai)! - ordem.get(b.pai)!);
  };
  const workers = repartir((e) => KIND_MEIO.includes(e.kind), TETO_WORKERS);
  const skills = repartir((e) => e.kind === "skill", TETO_SKILLS);

  const largura = larguraPara(Math.max(mostrados.length, workers.length, skills.length, 1), 70);
  const x = (n: number) => centrado(n, largura, Math.min(96, (largura - 220) / Math.max(n - 1, 1)));
  const nos: NoCena[] = [{ id: p.id, tipo: "pilar", rotulo: p.nome, x: largura / 2, y: Y.pilar, cor: p.cor, pilarId: p.id, attrs: {} }];
  const arestas: ArestaCena[] = [];
  const xs = x(mostrados.length);
  mostrados.forEach((s, i) => {
    nos.push({ id: s.id, tipo: "squad", rotulo: s.nome, x: xs(i), y: Y.base, cor: p.cor, pilarId: p.id, refId: s.id, attrs: {} });
    arestas.push({ de: p.id, para: s.id, estilo: "pontilhada" });
  });
  const xw = x(workers.length);
  workers.forEach(({ pai, e }, i) => {
    nos.push({ id: e.id, tipo: "worker", rotulo: e.nome, x: xw(i), y: Y.meio, cor: COR_AGENTE, pilarId: p.id, refId: e.id, attrs: {} });
    arestas.push({ de: pai, para: e.id, estilo: "solida" });
  });
  const xk = x(skills.length);
  skills.forEach(({ pai, e }, i) => {
    nos.push({ id: e.id, tipo: "skill", rotulo: e.nome, x: xk(i), y: Y.topo, cor: COR_FERRAMENTA, pilarId: p.id, refId: e.id, attrs: {} });
    arestas.push({ de: pai, para: e.id, estilo: "fina" });
  });
  if (g.avulsos.length > 0) {
    nos.push({
      id: `${p.id}:avulsos`, tipo: "avulsos", rotulo: `${g.avulsos.length} avulsos (sem pai)`,
      detalhe: Object.entries(
        g.avulsos.reduce<Record<string, number>>((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {}),
      )
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${v} ${k}`)
        .join(" · "),
      x: mostrados.length === 0 ? largura / 2 : largura - 90, y: mostrados.length === 0 ? Y.meio : Y.pilar, cor: "#6b7280", pilarId: p.id, attrs: {},
    });
  }
  const nW = ents.filter((e) => KIND_MEIO.includes(e.kind)).length;
  const nS = ents.filter((e) => e.kind === "skill").length;
  return {
    nos, arestas, largura, altura: ALTURA,
    mostrando: {
      squad: { de: mostrados.length, total: squads.length },
      worker: { de: workers.length, total: nW },
      skill: { de: skills.length, total: nS },
    },
  };
}

export function cenaPilar(p: PilarCena, org: OrgData | null): Cena {
  if (p.origem === "org" && org) return cenaOrg(p, org);
  if (p.fonte) return cenaFonte(p);
  return { nos: [], arestas: [], largura: 720, altura: ALTURA, mostrando: {} };
}

// ── visão geral: núcleo no centro, pilares num anel, nós externos esmaecidos em volta ──

export const RAIO_NUCLEO = 62;
/** Raios do anel da visão geral, em px a partir do centro. */
const R = { pilar: 94, tarefa: 163, agente: 228, ferramenta: 284 };
const DEG = Math.PI / 180;

/**
 * Anel da visão geral, sem ângulo fixo por pilar: cada pilar ocupa um BLOCO contíguo de
 * slots no anel dos executores (agentes e pessoas), com pelo menos 1 slot (pilar sem
 * executor, como os pilares por fonte, ocupa 1) e o pilar nasce no centro do próprio
 * bloco. As tarefas do pilar ocupam os mesmos slots, num raio menor. Determinístico.
 */
export function cenaVisaoGeral(pilares: PilarCena[], org: OrgData | null): Cena {
  const nos: NoCena[] = [];
  const arestas: ArestaCena[] = [];
  const pol = (a: number, r: number) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  const idxPilar = new Map(pilares.map((p, i) => [p.id, i]));

  const execsDe = (pid: string) => {
    if (!org) return { tarefas: [] as OrgData["tarefas"], execs: [] as { id: string; tipo: "agente" | "humano"; rotulo: string; ordem: number }[] };
    const tarefasPid = org.tarefas.filter((t) => t.pilarId === pid);
    const ordemTarefa = new Map(tarefasPid.map((t, i) => [`${t.executorTipo}:${t.executorId}`, i]));
    const lista = [
      ...org.agentes.filter((a) => a.pilarId === pid).map((a) => ({ id: a.id, tipo: "agente" as const, rotulo: a.nome, ordem: ordemTarefa.get(`agent:${a.id}`) ?? 1e6 })),
      ...org.pessoas.filter((h) => h.pilarId === pid).map((h) => ({ id: h.id, tipo: "humano" as const, rotulo: h.nome, ordem: ordemTarefa.get(`person:${h.id}`) ?? 1e6 })),
    ];
    return { tarefas: tarefasPid, execs: lista.sort((a, b) => a.ordem - b.ordem || a.rotulo.localeCompare(b.rotulo)) };
  };

  const blocos = pilares.map((p) => {
    const { tarefas, execs } = execsDe(p.id);
    return { p, tarefas, execs, tamanho: Math.max(1, execs.length, tarefas.length) };
  });
  const totalSlots = blocos.reduce((s, b) => s + b.tamanho, 0);
  const passo = totalSlots > 0 ? (2 * Math.PI) / totalSlots : 0;

  let base = 0;
  for (const { p, tarefas, execs, tamanho } of blocos) {
    nos.push({ id: p.id, tipo: "pilar", rotulo: p.nome, ...pol(-Math.PI + (base + tamanho / 2) * passo, R.pilar), cor: p.cor, pilarId: p.id, attrs: {} });
    execs.forEach((e, j) => {
      const a = -Math.PI + (base + j + 0.5) * passo;
      nos.push({ id: e.id, tipo: e.tipo, rotulo: e.rotulo, ...pol(a, R.agente), cor: e.tipo === "humano" ? COR_HUMANO : COR_AGENTE, pilarId: p.id, refId: e.id, attrs: {} });
      arestas.push({ de: p.id, para: e.id, estilo: "pontilhada" });
    });
    tarefas.forEach((t, j) => {
      const a = -Math.PI + (base + j + 0.5) * passo;
      nos.push({ id: t.id, tipo: "tarefa", rotulo: t.titulo, ...pol(a, R.tarefa), cor: COR_TAREFA, pilarId: p.id, refId: t.id, attrs: {} });
      // a tarefa liga ao executor que a faz (quando ele está neste pilar, o slot é o mesmo)
      if (execs.some((e) => e.id === t.executorId)) arestas.push({ de: t.executorId, para: t.id, estilo: "fina" });
    });
    base += tamanho;
  }

  if (org) {
    // ferramentas: anel externo, uniforme, ordenadas pelo pilar do 1º agente que as usa
    const dono = new Map<string, number>();
    for (const a of org.agentes) for (const t of a.ferramentas) if (!dono.has(t)) dono.set(t, idxPilar.get(a.pilarId) ?? 0);
    const ordenadas = [...org.ferramentas].sort((a, b) => (dono.get(a.id) ?? 99) - (dono.get(b.id) ?? 99) || a.nome.localeCompare(b.nome));
    const passoF = ordenadas.length > 0 ? (2 * Math.PI) / ordenadas.length : 0;
    ordenadas.forEach((t, k) => {
      nos.push({ id: t.id, tipo: "ferramenta", rotulo: t.nome, ...pol(-90 * DEG + k * passoF, R.ferramenta), cor: COR_FERRAMENTA, pilarId: "", refId: t.id, attrs: { categorias: [t.categoria] } });
    });
    // ferramenta → agente que a usa (linhas finas, no fundo)
    const porId = new Set(nos.map((n) => n.id));
    for (const a of org.agentes) for (const t of a.ferramentas) if (porId.has(t) && porId.has(a.id)) arestas.push({ de: a.id, para: t, estilo: "fina" });
  }
  return { nos, arestas, largura: 1100, altura: 1100, mostrando: {} };
}

// ── lentes (Entity / Function / Action) ──

export type Lente = { entidade: string; funcao: string; acao: string };
export const LENTE_TODAS: Lente = { entidade: "", funcao: "", acao: "" };

/** Um nó "casa" quando passa nas três lentes; o que não casa fica esmaecido. */
export function casaLente(no: NoCena, l: Lente): boolean {
  if (l.entidade) {
    if (l.entidade === "subagente") {
      if (!(no.tipo === "agente" && no.attrs.sub)) return false;
    } else if (no.tipo !== l.entidade) return false;
  }
  if (l.funcao && no.attrs.funcao !== l.funcao) return false;
  if (l.acao && !(no.attrs.categorias ?? []).includes(l.acao)) return false;
  return true;
}

export const ENTIDADES_LENTE: { id: string; rotulo: string }[] = [
  { id: "pilar", rotulo: "Pilares" },
  { id: "tarefa", rotulo: "Tarefas" },
  { id: "humano", rotulo: "Humanos" },
  { id: "agente", rotulo: "Agentes IA" },
  { id: "subagente", rotulo: "Sub-agentes" },
  { id: "ferramenta", rotulo: "Ferramentas" },
  { id: "squad", rotulo: "Squads" },
  { id: "worker", rotulo: "Workers" },
  { id: "skill", rotulo: "Skills" },
];

/** Opções de Função (função do agente) e Ação (categoria da ferramenta), sempre do dado. */
export function opcoesLente(f: OrgData | null): { funcoes: string[]; acoes: string[] } {
  if (!f) return { funcoes: [], acoes: [] };
  const u = (l: string[]) => [...new Set(l.filter(Boolean))].sort();
  return { funcoes: u(f.agentes.map((a) => a.funcao)), acoes: u(f.ferramentas.map((t) => t.categoria)) };
}

export type ItemLegenda = { id: string; rotulo: string; total: number; cor: string };

export function contagensLegenda(f: OrgData | null, fontes: PilarFonte[], mem: Memoria | null): ItemLegenda[] {
  const cont = (k: EcoKind) => fontes.reduce((s, p) => s + (p.porKind[k] ?? 0), 0);
  const itens: ItemLegenda[] = [];
  // o núcleo de notas conta como um nó; as notas viram nuvem
  if (mem) itens.push({ id: "nota", rotulo: "Notas", total: 1, cor: "#fb923c" });
  itens.push({ id: "pilar", rotulo: "Pilares", total: (f?.pilares.length ?? 0) + fontes.length, cor: "#e5e7eb" });
  if (f) {
    itens.push(
      { id: "tarefa", rotulo: "Tarefas", total: f.tarefas.length, cor: COR_TAREFA },
      { id: "humano", rotulo: "Humanos", total: f.pessoas.length, cor: COR_HUMANO },
      { id: "agente", rotulo: "Agentes IA", total: f.agentes.length, cor: COR_AGENTE },
      { id: "ferramenta", rotulo: "Ferramentas", total: f.ferramentas.length, cor: COR_FERRAMENTA },
    );
  }
  if (fontes.length > 0) {
    itens.push(
      { id: "squad", rotulo: "Squads", total: cont("squad"), cor: "#d4a853" },
      { id: "worker", rotulo: "Workers", total: KIND_MEIO.reduce((s, k) => s + cont(k), 0), cor: "#22d3ee" },
      { id: "skill", rotulo: "Skills", total: cont("skill"), cor: "#a78bfa" },
    );
  }
  return itens;
}
