/**
 * Derivações PURAS do ecossistema para as visões de grafo de /agente (anéis,
 * camadas neurais, radar, núcleo de saúde, faixas e pipeline de fontes). Tudo
 * sai de `EcoEntity[]` já filtrada: nenhum número é fixo aqui, e o que não dá
 * para derivar do dado não é mostrado.
 *
 * Única relação tipada que existe nos dados é `squadId` (pai lógico):
 * worker→squad, skill→squad e squad→squad. Não há aresta de engine/repo, de
 * workflow nem de agent: por isso o grafo NÃO as inventa; ficam como nós sem
 * ligação e o total vai para a UI (`semLigacao`).
 *
 * API estável (consumida também pela camada de ecossistema do /grafo, ver
 * lib/grafo-ecossistema.ts): `KIND_ORDEM`, `PROCEDENCIA_ORDEM`, `montarGrafo`,
 * `vizinhos`, `ANEIS_RADIAL`, `layoutAneis`, `CAMADAS_NEURAL`, `camadasNeural`,
 * `FORMULA_SAUDE`, `notaSaude`, `avisosSaude`, `eixosRadar`, `faixasProcedencia`,
 * `fonteNormalizada`, `pipelineFontes`, `agruparDiretorio` e os tipos exportados.
 */
import type { EcoEntity, EcoKind, EcoProcedencia, EcoUsoStatus } from "./types";

export const KIND_ORDEM: EcoKind[] = [
  "squad",
  "agent",
  "skill",
  "workflow",
  "clone",
  "shadow",
  "worker",
  "engine",
  "repo",
];

export const PROCEDENCIA_ORDEM: EcoProcedencia[] = ["propria", "adotada", "terceiro"];

// ── grafo ──────────────────────────────────────────────────────────────

export type NoGrafo = {
  id: string;
  kind: EcoKind;
  procedencia: EcoProcedencia;
  uso: EcoUsoStatus | null;
  nome: string;
  namespace: string;
  squadId?: string;
};

export type ArestaGrafo = { source: string; target: string };

export type Grafo = {
  nos: NoGrafo[];
  arestas: ArestaGrafo[];
  /** Entidades com `squadId` cujo pai NÃO está no conjunto (filtrado/ausente).
   *  Exibido na UI: aresta que some por causa do filtro não pode passar por
   *  "não existe". */
  orfas: number;
};

export function montarGrafo(entities: EcoEntity[]): Grafo {
  const ids = new Set(entities.map((e) => e.id));
  const arestas: ArestaGrafo[] = [];
  const vistas = new Set<string>();
  let orfas = 0;
  for (const e of entities) {
    if (!e.squadId || e.squadId === e.id) continue;
    if (!ids.has(e.squadId)) {
      orfas++;
      continue;
    }
    const k = `${e.squadId}→${e.id}`;
    if (vistas.has(k)) continue;
    vistas.add(k);
    arestas.push({ source: e.squadId, target: e.id });
  }
  const nos = entities.map<NoGrafo>((e) => ({
    id: e.id,
    kind: e.kind,
    procedencia: e.procedencia,
    uso: e.uso?.status ?? null,
    nome: e.nome,
    namespace: e.namespace,
    squadId: e.squadId,
  }));
  return { nos, arestas, orfas };
}

/** O próprio nó + pai e filhos diretos (destaque de hover/seleção). */
export function vizinhos(g: Grafo, id: string): Set<string> {
  const s = new Set<string>([id]);
  for (const a of g.arestas) {
    if (a.source === id) s.add(a.target);
    else if (a.target === id) s.add(a.source);
  }
  return s;
}

// ── radial (anéis concêntricos) ────────────────────────────────────────

/** Do centro pra fora: organização → executores → capacidades → origem. */
export const ANEIS_RADIAL: EcoKind[] = [
  "squad",
  "agent",
  "clone",
  "shadow",
  "workflow",
  "worker",
  "skill",
  "engine",
  "repo",
];

export type PosicaoAnel = { x: number; y: number; anel: number };
export type LayoutAneis = {
  pos: Map<string, PosicaoAnel>;
  /** `raio` = meio da faixa; `raioMin/raioMax` = onde os nós realmente caem. */
  aneis: { kind: EcoKind; raio: number; raioMin: number; raioMax: number; trilhas: number; total: number }[];
};

/**
 * Layout polar determinístico (sem simulação): cada kind numa FAIXA circular,
 * ordenada pelo ângulo do pai — o filho nasce no setor do squad dono, então os
 * feixes ficam curtos e a faixa do squad vira o "índice" das outras. Sem física
 * = abre instantâneo com milhares de nós e não "treme".
 *
 * Um anel fino com mais de mil skills exigiria raio enorme (ou nós sobrepostos), então
 * a faixa ganha `trilhas` concêntricas: o nó i cai na trilha `i mod trilhas`
 * (em zigue-zague), e o nº de trilhas é o menor que faz a faixa comportar
 * `n × espacamento` px de arco. Faixas vizinhas ficam `folga` px afastadas, de
 * modo que kinds pequenos (shadow 3, workflow 8) não colapsem no vizinho.
 */
export function layoutAneis(g: Grafo, espacamento = 10, folga = 90, raioInicial = 150): LayoutAneis {
  const porKind = new Map<EcoKind, NoGrafo[]>();
  for (const n of g.nos) porKind.set(n.kind, [...(porKind.get(n.kind) ?? []), n]);
  const pos = new Map<string, PosicaoAnel>();
  const angulo = new Map<string, number>();
  const aneis: LayoutAneis["aneis"] = [];
  let raioAnterior = 0;

  for (const kind of ANEIS_RADIAL) {
    const lista = porKind.get(kind);
    if (!lista?.length) continue;
    const raioMin = raioAnterior ? raioAnterior + folga : raioInicial;
    // menor nº de trilhas cuja faixa comporta o arco necessário
    let trilhas = 1;
    while (trilhas < 60) {
      const meio = raioMin + ((trilhas - 1) * espacamento) / 2;
      if (trilhas * 2 * Math.PI * meio >= lista.length * espacamento) break;
      trilhas++;
    }
    const raioMax = raioMin + (trilhas - 1) * espacamento;
    // com pai posicionado: ordena pelo ângulo do pai; sem pai: por namespace/nome, no fim
    const chave = (n: NoGrafo): [number, string] => {
      const a = n.squadId !== undefined ? angulo.get(n.squadId) : undefined;
      return [a === undefined ? Infinity : a, `${n.namespace}\u0000${n.nome}`];
    };
    const ord = [...lista].sort((a, b) => {
      const [aa, ka] = chave(a);
      const [ab, kb] = chave(b);
      return aa === ab ? ka.localeCompare(kb) : aa - ab;
    });
    ord.forEach((n, i) => {
      const th = (i / ord.length) * 2 * Math.PI - Math.PI;
      const r = raioMin + (i % trilhas) * espacamento;
      angulo.set(n.id, th);
      pos.set(n.id, { x: Math.cos(th) * r, y: Math.sin(th) * r, anel: aneis.length });
    });
    aneis.push({ kind, raio: (raioMin + raioMax) / 2, raioMin, raioMax, trilhas, total: ord.length });
    raioAnterior = raioMax;
  }
  return { pos, aneis };
}

// ── neural (camadas) ───────────────────────────────────────────────────

/**
 * Ordem das colunas, da "matéria-prima" ao "produto", segundo a semântica real
 * dos dados:
 *  1. fontes     — engine/repo: de onde o ecossistema vem (não têm pai tipado)
 *  2. squads     — a unidade de organização (pai de worker, skill e sub-squad)
 *  3. executores — agent/worker/clone/shadow: quem faz o trabalho dentro do squad
 *  4. skills     — capacidades invocáveis (filhas de squad)
 *  5. workflows  — orquestram as camadas anteriores; é a saída
 * Só existem ligações onde `squadId` as prova (squad→executor, squad→skill,
 * squad→squad); as demais colunas ficam sem feixe, e isso é dito na UI.
 */
export const CAMADAS_NEURAL: { id: string; rotulo: string; kinds: EcoKind[] }[] = [
  { id: "fontes", rotulo: "Fontes", kinds: ["engine", "repo"] },
  { id: "squads", rotulo: "Squads", kinds: ["squad"] },
  { id: "executores", rotulo: "Executores", kinds: ["agent", "worker", "clone", "shadow"] },
  { id: "skills", rotulo: "Skills", kinds: ["skill"] },
  { id: "workflows", rotulo: "Workflows", kinds: ["workflow"] },
];

export type ClusterNeural = {
  id: string;
  camada: string;
  rotulo: string;
  total: number;
  /** cluster-resto ("outros") quando o limite por camada estourou. */
  outros: boolean;
  porProcedencia: Record<EcoProcedencia, number>;
};

export type LigacaoNeural = { de: string; para: string; peso: number };

export type Neural = {
  camadas: { id: string; rotulo: string; total: number; clusters: ClusterNeural[] }[];
  ligacoes: LigacaoNeural[];
  /** pai→filho dentro do MESMO cluster (não desenhado como feixe). */
  internas: number;
  /** entidades sem nenhuma aresta resolvida no recorte. */
  semLigacao: number;
};

const camadaDoKind = new Map<EcoKind, string>(
  CAMADAS_NEURAL.flatMap((c) => c.kinds.map((k) => [k, c.id] as const)),
);

/**
 * Agrega por (camada, namespace): Milhares de neurônios não cabem numa coluna, e
 * namespace é a fonte/proveniência que o dado já carrega. Cada camada mantém os
 * `maxClusters - 1` maiores e junta o resto em "outros".
 */
export function camadasNeural(entities: EcoEntity[], maxClusters = 12): Neural {
  const porId = new Map(entities.map((e) => [e.id, e]));
  const vazioProc = (): Record<EcoProcedencia, number> => ({ propria: 0, adotada: 0, terceiro: 0 });

  // 1) cluster bruto por camada+namespace
  const brutos = new Map<string, ClusterNeural>();
  const chaveBruta = (e: EcoEntity) => `${camadaDoKind.get(e.kind)}::${e.namespace}`;
  for (const e of entities) {
    const camada = camadaDoKind.get(e.kind)!;
    const k = chaveBruta(e);
    let c = brutos.get(k);
    if (!c) {
      c = { id: `${camada}:${e.namespace}`, camada, rotulo: e.namespace, total: 0, outros: false, porProcedencia: vazioProc() };
      brutos.set(k, c);
    }
    c.total++;
    c.porProcedencia[e.procedencia]++;
  }

  // 2) corta por camada; mapa chaveBruta -> id final
  const final = new Map<string, string>();
  const camadas = CAMADAS_NEURAL.map((def) => {
    const lista = [...brutos.entries()]
      .filter(([, c]) => c.camada === def.id)
      .sort((a, b) => b[1].total - a[1].total || a[1].rotulo.localeCompare(b[1].rotulo));
    let clusters: ClusterNeural[];
    if (lista.length <= maxClusters) {
      clusters = lista.map(([, c]) => c);
      for (const [k, c] of lista) final.set(k, c.id);
    } else {
      const topo = lista.slice(0, Math.max(1, maxClusters - 1));
      const resto = lista.slice(topo.length);
      const outros: ClusterNeural = {
        id: `${def.id}:__outros`,
        camada: def.id,
        rotulo: `outros (${resto.length})`,
        total: 0,
        outros: true,
        porProcedencia: vazioProc(),
      };
      for (const [k, c] of resto) {
        outros.total += c.total;
        for (const p of PROCEDENCIA_ORDEM) outros.porProcedencia[p] += c.porProcedencia[p];
        final.set(k, outros.id);
      }
      for (const [k, c] of topo) final.set(k, c.id);
      clusters = [...topo.map(([, c]) => c), outros];
    }
    return { id: def.id, rotulo: def.rotulo, total: clusters.reduce((a, c) => a + c.total, 0), clusters };
  });

  // 3) feixes pai→filho agregados
  const pesos = new Map<string, LigacaoNeural>();
  const comAresta = new Set<string>();
  let internas = 0;
  for (const e of entities) {
    if (!e.squadId || e.squadId === e.id) continue;
    const pai = porId.get(e.squadId);
    if (!pai) continue;
    comAresta.add(e.id);
    comAresta.add(pai.id);
    const de = final.get(chaveBruta(pai))!;
    const para = final.get(chaveBruta(e))!;
    if (de === para) {
      internas++;
      continue;
    }
    const k = `${de}→${para}`;
    const l = pesos.get(k);
    if (l) l.peso++;
    else pesos.set(k, { de, para, peso: 1 });
  }

  return {
    camadas,
    ligacoes: [...pesos.values()].sort((a, b) => b.peso - a.peso),
    internas,
    semLigacao: entities.length - comAresta.size,
  };
}

// ── saúde ──────────────────────────────────────────────────────────────

export type Saude = {
  /** 0..100 ou null quando nada foi medido. */
  nota: number | null;
  medidos: number;
  comSinal: number;
  /** % das entidades que têm medição de uso (0..100). */
  cobertura: number;
  total: number;
};

/** Fórmula exibida na UI (tooltip) — mantida junto do cálculo pra não divergir. */
export const FORMULA_SAUDE =
  "nota = entidades medidas com algum sinal de uso (frequente, ocasional ou raro) ÷ entidades medidas × 100. " +
  "Entidade sem medição não entra na conta (aparece em 'cobertura'). " +
  "'Sem sinal' é uso DESCONHECIDO, não morto: a nota é um piso.";

export function notaSaude(entities: EcoEntity[]): Saude {
  let medidos = 0;
  let comSinal = 0;
  for (const e of entities) {
    if (!e.uso) continue;
    medidos++;
    if (e.uso.status !== "sem-sinal") comSinal++;
  }
  const total = entities.length;
  return {
    nota: medidos ? Math.round((comSinal / medidos) * 100) : null,
    medidos,
    comSinal,
    cobertura: total ? Math.round((medidos / total) * 100) : 0,
    total,
  };
}

/** Avisos derivados (nunca texto fixo com número). */
export function avisosSaude(entities: EcoEntity[], g: Grafo = montarGrafo(entities)): string[] {
  const out: string[] = [];
  const s = notaSaude(entities);
  if (entities.length && s.medidos === 0) out.push("nenhuma entidade deste recorte tem uso medido");
  else if (s.cobertura < 100 && entities.length)
    out.push(`${entities.length - s.medidos} entidades sem medição de uso (cobertura ${s.cobertura}%)`);
  if (g.orfas > 0) out.push(`${g.orfas} ligações pai→filho ficam fora do recorte atual`);
  return out;
}

// ── radar ──────────────────────────────────────────────────────────────

export type EixoRadar = {
  kind: EcoKind;
  total: number;
  medidos: number;
  /** % de (frequente+ocasional) entre os medidos; 0 se não há medidos. */
  ativos: number;
  /** % de sem-sinal entre os medidos. */
  semSinal: number;
  /** % de procedência própria sobre o total do kind. */
  propria: number;
  /** √(total / maior total) × 100. Raiz quadrada porque o maior tipo
   *  achataria os demais numa escala linear; a raiz comprime sem
   *  esconder (um tipo com 1/10 do volume do maior vira 32, não 10). */
  volume: number;
};

const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0);

export function eixosRadar(entities: EcoEntity[]): EixoRadar[] {
  const maior = Math.max(
    0,
    ...KIND_ORDEM.map((k) => entities.filter((e) => e.kind === k).length),
  );
  return KIND_ORDEM.map((kind) => {
    const doKind = entities.filter((e) => e.kind === kind);
    const medidos = doKind.filter((e) => e.uso);
    const ativos = medidos.filter((e) => e.uso!.status === "frequente" || e.uso!.status === "ocasional").length;
    const sem = medidos.filter((e) => e.uso!.status === "sem-sinal").length;
    return {
      kind,
      total: doKind.length,
      medidos: medidos.length,
      ativos: pct(ativos, medidos.length),
      semSinal: pct(sem, medidos.length),
      propria: pct(doKind.filter((e) => e.procedencia === "propria").length, doKind.length),
      volume: Math.sqrt(maior ? doKind.length / maior : 0) * 100,
    };
  });
}

// ── faixas por procedência ─────────────────────────────────────────────

export type FaixaProcedencia = {
  procedencia: EcoProcedencia;
  total: number;
  /** % do total filtrado. */
  pct: number;
  medidos: number;
  comSinal: number;
  /** vazio: 0 entidades · sem-medicao: nenhuma medida · sem-sinal: medidas mas nenhuma com sinal · com-sinal. */
  estado: "vazio" | "sem-medicao" | "sem-sinal" | "com-sinal";
};

export function faixasProcedencia(entities: EcoEntity[]): FaixaProcedencia[] {
  return PROCEDENCIA_ORDEM.map((procedencia) => {
    const lista = entities.filter((e) => e.procedencia === procedencia);
    const medidos = lista.filter((e) => e.uso).length;
    const comSinal = lista.filter((e) => e.uso && e.uso.status !== "sem-sinal").length;
    return {
      procedencia,
      total: lista.length,
      pct: pct(lista.length, entities.length),
      medidos,
      comSinal,
      estado: !lista.length ? "vazio" : !medidos ? "sem-medicao" : !comSinal ? "sem-sinal" : "com-sinal",
    };
  });
}

// ── pipeline de fontes ─────────────────────────────────────────────────

/**
 * `origem` é a fonte canônica; para entidades lidas de arquivo vira um path
 * por entidade (centenas de valores). Descarta o arquivo e fica com "dir1/dir2/…".
 */
export function fonteNormalizada(origem: string): string {
  if (!origem.includes("/")) return origem;
  const dirs = origem.split("/").slice(0, -1); // descarta o nome do arquivo
  return dirs.slice(0, 2).join("/") + "/…";
}

export type FontePipeline = { fonte: string; total: number };

export type Pipeline = {
  fontes: FontePipeline[];
  estagios: { rotulo: string; valor: number; sub: string }[];
};

export function pipelineFontes(entities: EcoEntity[], maxFontes = 8): Pipeline {
  const c = new Map<string, number>();
  for (const e of entities) {
    const f = fonteNormalizada(e.origem);
    c.set(f, (c.get(f) ?? 0) + 1);
  }
  const ord = [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let fontes: FontePipeline[] = ord.map(([fonte, total]) => ({ fonte, total }));
  if (fontes.length > maxFontes) {
    const resto = fontes.slice(maxFontes);
    fontes = [
      ...fontes.slice(0, maxFontes),
      { fonte: `outras (${resto.length})`, total: resto.reduce((a, f) => a + f.total, 0) },
    ];
  }
  const g = montarGrafo(entities);
  const comPai = entities.filter((e) => e.squadId && e.squadId !== e.id).length - g.orfas;
  return {
    fontes,
    estagios: [
      { rotulo: "Fontes", valor: c.size, sub: "origens canônicas distintas" },
      { rotulo: "Entidades", valor: entities.length, sub: "normalizadas com id tipado" },
      { rotulo: "Com pai resolvido", valor: comPai, sub: "squadId aponta pra entidade do recorte" },
    ],
  };
}

// ── diretório ──────────────────────────────────────────────────────────

export type GrupoDiretorio = { chave: string; rotulo: string; itens: EcoEntity[] };

const porNome = (a: EcoEntity, b: EcoEntity) => a.nome.localeCompare(b.nome, "pt-BR");

export function agruparDiretorio(entities: EcoEntity[], por: "kind" | "squad"): GrupoDiretorio[] {
  if (por === "kind") {
    return KIND_ORDEM.map((k) => ({
      chave: k,
      rotulo: k,
      itens: entities.filter((e) => e.kind === k).sort(porNome),
    })).filter((g) => g.itens.length);
  }
  const porId = new Map(entities.map((e) => [e.id, e]));
  const grupos = new Map<string, EcoEntity[]>();
  const semSquad: EcoEntity[] = [];
  for (const e of entities) {
    // o squad pertence ao próprio grupo; filho sem pai no recorte vai pra "sem squad"
    const dono = e.kind === "squad" ? e.id : e.squadId && porId.has(e.squadId) ? e.squadId : null;
    if (!dono) semSquad.push(e);
    else grupos.set(dono, [...(grupos.get(dono) ?? []), e]);
  }
  const out: GrupoDiretorio[] = [...grupos.entries()]
    .map(([id, itens]) => ({ chave: id, rotulo: porId.get(id)!.nome, itens: itens.sort(porNome) }))
    .sort((a, b) => b.itens.length - a.itens.length || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  if (semSquad.length) out.push({ chave: "__sem-squad", rotulo: "sem squad", itens: semSquad.sort(porNome) });
  return out;
}
