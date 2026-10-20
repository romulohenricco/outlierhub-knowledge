
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { exigirCaminhoBilhon, lerEnv } from "./bilhon-paths";
import type { KgEdge, KgNode, TopoEdgeTipo, TopoNodeTipo } from "./kg";

/**
 * Diretório do extrato. Resolvido a CADA chamada, de propósito — diferente de
 * `KG_DB`/`GRAPH_LAYOUT` (consts lidas no import) em lib/kg.ts. O motivo é
 * testabilidade: com const, trocar `BILHON_TOPOLOGY_DIR` depois do import não tem
 * efeito, e o teste de contrato contra o extrato real precisaria de truque de
 * cache-busting no import pra funcionar (frágil e silencioso quando quebra).
 */
export function topologyDir(): string {
  return exigirCaminhoBilhon(lerEnv("BILHON_TOPOLOGY_DIR") ?? path.join(process.cwd(), "data", "topology"));
}

/**
 * Base do espaço de IDs sintéticos das arestas de topologia. Precisa ser
 * negativo (o sqlite só emite positivos) E afastado de -1,-2,-3… (já ocupados
 * pelas refs do Instagram em `grafoReferencias`). Com -1.000.000 só haveria
 * colisão se a galeria IG passasse de 1 milhão de arestas.
 */
export const TOPO_EDGE_ID_BASE = -1_000_000;


export const TOPO_PREFIXO = "topo:";

/**
 * Tipos de aresta que formam a REDE DE INFLUÊNCIA — o que o ticket pede.
 * `contem` e `pertence_a` ficam de fora do default por serem pura hierarquia
 * (a maioria das arestas de um extrato real): inflam o canvas sem responder "o que quebra".
 * Continuam acessíveis via `tipos` explícito.
 */
export const TIPOS_ARESTA_INFLUENCIA: TopoEdgeTipo[] = [
  "referencia",
  "symlink",
  "git_remote",
  "ponte",
  "executa",
];

export const TIPOS_ARESTA_VALIDOS: TopoEdgeTipo[] = [
  "contem",
  "pertence_a",
  ...TIPOS_ARESTA_INFLUENCIA,
];

/** Rótulo humano da aresta — vira o `rel`, que é o que a UI já exibe. */
const REL_DE_TIPO: Record<TopoEdgeTipo, string> = {
  contem: "contém",
  pertence_a: "pertence a",
  referencia: "referencia",
  symlink: "symlink",
  git_remote: "git remote",
  ponte: "ponte",
  executa: "executa",
};

/* ── formato bruto dos JSONs do extrator (só o que este módulo consome) ── */

type TopoNodeBruto = {
  id: string;
  type: string;
  label: string;
  path?: string;
};

type TopoEdgeBruto = {
  src: string;
  dst: string;
  type: string;
  n: number;
  alvo_morto?: boolean;
  quebrado?: boolean;
  /** "ativo" = código/doc/config que quebra de verdade; qualquer outra coisa
   *  (board, dump, log) só MENCIONA o caminho. É a distinção que faz o relatório
   *  de impacto valer — sem ela, 300 menções num log parecem 300 quebras. */
  escopo?: string;
  formas?: Record<string, number>;
  papel?: string;
  remote?: string;
  url?: string;
  push_desabilitado?: boolean;
};

type TopoEnvelope = {
  gerado_em?: string;
  versao?: string;
  total?: number;
  truncado?: boolean;
};

export type TopologiaMeta = {
  geradoEm: string;
  versao: string;
  /** total de nós/arestas no extrato em disco, ANTES de qualquer filtro */
  totalNos: number;
  totalArestas: number;
  /** quantas arestas sobraram do filtro de tipo, antes do corte por maxEdges */
  arestasFiltradas: number;
  /** quantas de fato voltaram (== arestasFiltradas quando não truncou) */
  arestasMostradas: number;
  /** true quando maxEdges cortou — a UI PRECISA dizer isso, cap silencioso mente */
  truncado: boolean;
  /** vocabulário real do extrato, pra UI montar os filtros sem hardcodar
   *  (o conjunto de planos/tipos muda quando o extrator roda de novo). */
  planosDisponiveis: string[];
  tiposNoDisponiveis: string[];
};

export type GrafoTopologiaOpts = {
  tipos?: TopoEdgeTipo[];
  maxEdges?: number;
  /** só arestas cuja referência aponta pra path inexistente */
  soMortas?: boolean;
  /** planos aceitos (sem o prefixo "plano:" do id do nó). Vazio = todos. */
  planos?: string[];
  /** tipos de nó aceitos. Vazio = todos. */
  tiposNo?: TopoNodeTipo[];
};

export type GrafoTopologiaResultado = {
  nodes: KgNode[];
  edges: KgEdge[];
  meta: TopologiaMeta;
};

/* ── carga com cache por mtime ────────────────────────────────────────── */

type Extrato = {
  nodes: TopoNodeBruto[];
  edges: TopoEdgeBruto[];
  envelope: TopoEnvelope;
};

let cache: { chave: string; extrato: Extrato } | null = null;

function arquivoNodes() {
  return exigirCaminhoBilhon(path.join(topologyDir(), "nodes.json"));
}
function arquivoEdges() {
  return exigirCaminhoBilhon(path.join(topologyDir(), "edges.json"));
}

/**
 * Lê os dois JSONs (podem passar de dezenas de MB) e guarda em memória, invalidando
 * por mtime — mesmo contrato de `carregarLayout` em lib/kg.ts. Sem isso, cada request
 * de `/api/graph?topologia=1` reparsearia o extrato inteiro.
 */
export async function carregarExtrato(): Promise<Extrato> {
  const [sn, se] = await Promise.all([stat(arquivoNodes()), stat(arquivoEdges())]);
  // o diretório entra na chave: com `topologyDir()` dinâmico, dois extratos
  // diferentes poderiam ter o mesmo par de mtimes e servir dado do outro.
  const chave = `${topologyDir()}|${sn.mtimeMs}:${se.mtimeMs}`;
  if (cache && cache.chave === chave) return cache.extrato;

  const [brutoNodes, brutoEdges] = await Promise.all([
    readFile(arquivoNodes(), "utf-8"),
    readFile(arquivoEdges(), "utf-8"),
  ]);
  const jn = JSON.parse(brutoNodes) as TopoEnvelope & { nodes?: TopoNodeBruto[] };
  const je = JSON.parse(brutoEdges) as TopoEnvelope & { edges?: TopoEdgeBruto[] };
  // envelope montado campo a campo de propósito: um spread de `jn`/`je` arrastaria
  // os arrays `nodes`/`edges` pra dentro dele e seguraria tudo em memória
  // duas vezes. `versao`/`gerado_em` são iguais nos dois arquivos (mesma execução);
  // `total` é ignorado e recontado a partir dos arrays, que são a verdade.
  const extrato: Extrato = {
    nodes: jn.nodes ?? [],
    edges: je.edges ?? [],
    envelope: {
      versao: jn.versao ?? je.versao,
      gerado_em: jn.gerado_em ?? je.gerado_em,
      truncado: Boolean(jn.truncado || je.truncado),
    },
  };
  cache = { chave, extrato };
  return extrato;
}

/** Só pra teste — força a próxima carga a reler o disco. */
export function limparCacheTopologia() {
  cache = null;
}

/* ── montagem da camada ───────────────────────────────────────────────── */

const ehTipoAresta = (t: string): t is TopoEdgeTipo =>
  (TIPOS_ARESTA_VALIDOS as string[]).includes(t);

/**
 * Monta a camada de topologia no formato KgNode/KgEdge, pronta pra concatenar
 * com o grafo de conhecimento no mesmo canvas.
 *
 * Ordem das operações (importa): filtra por tipo → descarta aresta com ponta
 * desconhecida → ordena por `n` desc (mais citado = mais influente) → corta em
 * maxEdges → só então coleta os nós tocados. Descartar a ponta órfã ANTES do
 * corte evita gastar a cota do canvas com aresta que a UI dropa depois (o
 * Grafo.tsx filtra `porId.has(src) && porId.has(dst)`).
 */
export async function grafoTopologia(
  opts: GrafoTopologiaOpts = {},
): Promise<GrafoTopologiaResultado> {
  const extrato = await carregarExtrato();
  const maxEdges = opts.maxEdges ?? 1500;
  const tipos = new Set<TopoEdgeTipo>(
    (opts.tipos?.length ? opts.tipos : TIPOS_ARESTA_INFLUENCIA).filter(ehTipoAresta),
  );

  const nosConhecidos = new Set(extrato.nodes.map((n) => n.id));

  // plano de cada nó. O extrator NÃO grava plano como campo do nó (no máximo uma
  // sugestão em poucos nós); a filiação real vem das arestas `pertence_a` apontando
  // pra nós `plano:*`. Por isso o índice é construído varrendo TODAS as arestas,
  // antes de qualquer filtro.
  const planoDoNo = new Map<string, string>();
  for (const e of extrato.edges) {
    if (e.type === "pertence_a" && e.dst.startsWith("plano:")) {
      planoDoNo.set(e.src, e.dst.slice("plano:".length));
    }
  }

  const planosFiltro = new Set(opts.planos ?? []);
  const tiposNoFiltro = new Set<string>(opts.tiposNo ?? []);
  /** Nó passa nos filtros de nó (plano e tipo). Nó sem plano conhecido é EXCLUÍDO quando
   *  há filtro de plano ativo — incluí-lo seria afirmar uma filiação que o
   *  extrato não tem. */
  const noPassa = (id: string, tipo: string) => {
    if (tiposNoFiltro.size && !tiposNoFiltro.has(tipo)) return false;
    if (planosFiltro.size) {
      const p = planoDoNo.get(id);
      if (!p || !planosFiltro.has(p)) return false;
    }
    return true;
  };
  const tipoDoNo = new Map(extrato.nodes.map((n) => [n.id, n.type]));

  const candidatas = extrato.edges.filter((e) => {
    if (!ehTipoAresta(e.type) || !tipos.has(e.type)) return false;
    if (opts.soMortas && !e.alvo_morto) return false;
    if (!nosConhecidos.has(e.src) || !nosConhecidos.has(e.dst)) return false;
    // aresta só entra se as DUAS pontas passarem — senão o canvas mostraria um
    // nó filtrado fora reaparecendo pendurado numa aresta
    return (
      noPassa(e.src, tipoDoNo.get(e.src) ?? "") && noPassa(e.dst, tipoDoNo.get(e.dst) ?? "")
    );
  });
  candidatas.sort((a, b) => (b.n ?? 0) - (a.n ?? 0));

  const escolhidas = candidatas.slice(0, maxEdges);

  const edges: KgEdge[] = escolhidas.map((e, i) => ({
    id: TOPO_EDGE_ID_BASE - i,
    src: TOPO_PREFIXO + e.src,
    dst: TOPO_PREFIXO + e.dst,
    rel: REL_DE_TIPO[e.type as TopoEdgeTipo],
    status: "confirmed",
    n_fontes: e.n ?? 1,
    peso: e.n ?? 1,
    camada: "topologia",
    tipoTopo: e.type as TopoEdgeTipo,
    ...(e.alvo_morto || e.quebrado ? { alvoMorto: true } : {}),
  }));

  const tocados = new Set<string>();
  for (const e of escolhidas) {
    tocados.add(e.src);
    tocados.add(e.dst);
  }
  const grau = new Map<string, number>();
  for (const e of escolhidas) {
    grau.set(e.src, (grau.get(e.src) ?? 0) + 1);
    grau.set(e.dst, (grau.get(e.dst) ?? 0) + 1);
  }

  const nodes: KgNode[] = extrato.nodes
    .filter((n) => tocados.has(n.id))
    .map((n) => ({
      id: TOPO_PREFIXO + n.id,
      label: n.label,
      tipo: "topologia" as const,
      camada: "topologia" as const,
      tipoTopo: n.type as TopoNodeTipo,
      grau: grau.get(n.id) ?? 0,
      ...(n.path ? { path: n.path } : {}),
      ...(planoDoNo.get(n.id) ? { plano: planoDoNo.get(n.id) } : {}),
    }));

  return {
    nodes,
    edges,
    meta: {
      geradoEm: extrato.envelope.gerado_em ?? "",
      versao: extrato.envelope.versao ?? "",
      totalNos: extrato.nodes.length,
      totalArestas: extrato.edges.length,
      arestasFiltradas: candidatas.length,
      arestasMostradas: escolhidas.length,
      truncado: candidatas.length > escolhidas.length,
      // vocabulário do extrato INTEIRO, não do recorte — senão o filtro sumiria
      // da UI assim que o próprio filtro reduzisse o resultado
      planosDisponiveis: [...new Set(planoDoNo.values())].sort(),
      tiposNoDisponiveis: [...new Set(extrato.nodes.map((n) => n.type))].sort(),
    },
  };
}

/* ── impacto de mover ─────────────────────────────────────────────────── */

export type ImpactoRef = {
  arestas: number;
  ocorrencias: number;
  arquivos: number;
  formas: Record<string, number>;
};

export type ImpactoDeMover = {
  alvo: string;
  /** quantos nós do grafo caem dentro do alvo (ele + subárvore) */
  nosNoEscopo: number;
  /** referências de código/doc/config — o que QUEBRA de verdade */
  ativo: ImpactoRef;
  /** referências em board/dump/log — só menção, não quebra execução */
  dado: ImpactoRef;
  symlinksEntrando: { src: string; quebrado: boolean }[];
  /** agendadores (launchd) a 2 saltos: agendador → script → alvo (a cadeia que faz
   *  algo quebrar de madrugada sem ninguém encostar no código) */
  launchagents: string[];
  pontes: { src: string; dst: string; papel: string | null }[];
  gitRemotes: { remote: string | null; url: string | null; pushDesabilitado: boolean }[];
  topReferenciadores: { src: string; n: number; escopo: string | null }[];
};

/**
 * "Se eu mover X, o que quebra?" — ego-grafo REVERSO sobre a camada de topologia.
 *
 * Função pura sobre as listas já materializadas: a rota já tem os JSONs em memória
 * e cacheados, e um subprocess por request seria mais lento e mais frágil.
 *
 * Devolve `null` quando nenhum nó do grafo cobre o caminho — distinto de "cobre
 * e não tem impacto nenhum", que devolve o objeto com tudo zerado.
 */
export async function impactoDeMover(alvoBruto: string): Promise<ImpactoDeMover | null> {
  const extrato = await carregarExtrato();
  const alvo = path.resolve(alvoBruto);
  const prefixo = alvo.endsWith(path.sep) ? alvo : alvo + path.sep;

  // escopo = o alvo + tudo abaixo dele
  const escopo = new Set(
    extrato.nodes
      .filter((n) => n.path && (n.path === alvo || n.path.startsWith(prefixo)))
      .map((n) => n.id),
  );
  if (escopo.size === 0) return null;

  const rotuloDoNo = new Map(extrato.nodes.map((n) => [n.id, n.label]));
  const tipoDoNo = new Map(extrato.nodes.map((n) => [n.id, n.type]));

  const entrada = new Map<string, TopoEdgeBruto[]>();
  const saida = new Map<string, TopoEdgeBruto[]>();
  // índice executa: dst -> arestas, pra achar LaunchAgent sem varrer tudo por ref
  const executaPorDst = new Map<string, TopoEdgeBruto[]>();
  const empurra = (m: Map<string, TopoEdgeBruto[]>, k: string, e: TopoEdgeBruto) => {
    const l = m.get(k);
    if (l) l.push(e);
    else m.set(k, [e]);
  };

  for (const e of extrato.edges) {
    const srcDentro = escopo.has(e.src);
    const dstDentro = escopo.has(e.dst);
    if (dstDentro && !srcDentro) empurra(entrada, e.type, e);
    if (srcDentro && !dstDentro) empurra(saida, e.type, e);
    if (e.type === "executa") empurra(executaPorDst, e.dst, e);
  }

  const refs = entrada.get("referencia") ?? [];
  const ativos = refs.filter((e) => e.escopo === "ativo");
  const dados = refs.filter((e) => e.escopo !== "ativo");

  const porForma = (lista: TopoEdgeBruto[]) => {
    const acc: Record<string, number> = {};
    for (const e of lista) {
      for (const [f, c] of Object.entries(e.formas ?? {})) acc[f] = (acc[f] ?? 0) + c;
    }
    return acc;
  };
  const resumo = (lista: TopoEdgeBruto[]): ImpactoRef => ({
    arestas: lista.length,
    ocorrencias: lista.reduce((s, e) => s + (e.n ?? 0), 0),
    arquivos: new Set(lista.map((e) => e.src)).size,
    formas: porForma(lista),
  });

  const launchagents = new Set<string>();
  for (const e of ativos) {
    for (const e2 of executaPorDst.get(e.src) ?? []) {
      if (tipoDoNo.get(e2.src) === "launchagent") {
        launchagents.add(rotuloDoNo.get(e2.src) ?? e2.src);
      }
    }
  }

  return {
    alvo,
    nosNoEscopo: escopo.size,
    ativo: resumo(ativos),
    dado: resumo(dados),
    symlinksEntrando: (entrada.get("symlink") ?? []).map((e) => ({
      src: e.src,
      quebrado: Boolean(e.quebrado),
    })),
    launchagents: [...launchagents].sort(),
    pontes: [...(entrada.get("ponte") ?? []), ...(saida.get("ponte") ?? [])].map((e) => ({
      src: e.src,
      dst: e.dst,
      papel: e.papel ?? null,
    })),
    gitRemotes: (saida.get("git_remote") ?? []).map((e) => ({
      remote: e.remote ?? null,
      url: e.url ?? null,
      pushDesabilitado: Boolean(e.push_desabilitado),
    })),
    topReferenciadores: [...refs]
      .sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
      .slice(0, 15)
      .map((e) => ({ src: e.src, n: e.n ?? 0, escopo: e.escopo ?? null })),
  };
}

// Havia aqui um `topologiaExiste()` (espelho do `kgDbExiste()`), nunca chamado.
// Removido: a rota trata extrato ausente com try/catch próprio, que além de ser o
// mecanismo que de fato usamos não tem a corrida entre "checar" e "ler" que um
// pré-teste teria. Se algum dia precisar de checagem prévia, ela volta COM chamador.
