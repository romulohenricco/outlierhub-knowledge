"use client";

/**
 * Grafo de conhecimento — visão maximalista.
 * Motor: react-force-graph-2d.
 * Paleta validada (dataviz): conceito #5b8cff · livro #c07f28 ·
 * confirmed #2aa968 · claimed #5b6575 (contexto recessivo) · disputed #d64545 + TRACEJADA.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cortaTexto } from "@/lib/texto";
import { ampliarParaFoco } from "@/lib/grafo-foco";
import {
  PRESETS_DATA,
  filtroDataAtivo,
  inicioDoPreset,
  recortarPorData,
  type PresetData,
} from "@/lib/grafo-data";
import { ECO_KINDS } from "@/lib/grafo-ecossistema";
import { PROCEDENCIA_ORDEM } from "@/lib/ecosystem-graph";
import { COR_KIND } from "@/components/agente/meta";
import type { EcoKind } from "@/lib/types";
import { useToast } from "@/components/Toast";
import dynamic from "next/dynamic";
import { urlHttp } from "@/lib/social-url";
import type {
  ForceGraphMethods,
  ForceGraphProps,
  NodeObject,
  LinkObject,
} from "react-force-graph-2d";

const ForceGraph2DBase = dynamic(() => import("react-force-graph-2d"), { ssr: false });

/* ── tipos ─────────────────────────────────────────────────────────── */
type Nodo = NodeObject & {
  id: string;
  label: string;
  tipo:
    | "conceito"
    | "livro"
    | "referencia"
    | "video"
    | "perfil"
    | "colecao-ig"
    | "topologia"
    | "ecossistema";
  igUrl?: string;
  livroId?: string;
  grau: number;
  camada?: "conhecimento" | "topologia" | "ecossistema";
  tipoTopo?: string; // "repo" | "skill" | "engine" | … (só na camada topologia)
  path?: string; // caminho absoluto no disco (topologia e ecossistema)
  plano?: string;
  ecoKind?: EcoKind; // só na camada ecossistema
  procedencia?: string;
  descricao?: string;
  data?: string; // YYYY-MM-DD — ver lib/grafo-data.ts
  estrutural?: boolean; // hub sem data própria (raiz, hub de kind, perfil IG, plano)
};
type Aresta = LinkObject<Nodo> & {
  id: number;
  src: string;
  dst: string;
  rel: string;
  status: "confirmed" | "claimed" | "disputed";
  n_fontes: number;
  peso: number;
  camada?: "conhecimento" | "topologia" | "ecossistema";
  tipoTopo?: string;
  alvoMorto?: boolean; // referência que aponta pra path inexistente
};
/** Meta da camada de topologia — `truncado` PRECISA aparecer na UI: o cap
 *  corta ~11k arestas de influência pra 1500, e cap silencioso passa a
 *  impressão de que o canvas mostra o disco inteiro. */
type TopoMeta = {
  versao: string;
  geradoEm: string;
  totalNos: number;
  totalArestas: number;
  arestasFiltradas: number;
  arestasMostradas: number;
  truncado: boolean;
  planosDisponiveis: string[];
  tiposNoDisponiveis: string[];
};

/** Tipos de aresta da topologia oferecidos no filtro. `contem`/`pertence_a`
 *  existem no extrato mas ficam fora: são arestas de hierarquia pura, a grande
 *  maioria do extrato, e enchem o canvas sem responder "o que quebra se eu mover X". */
const TOPO_ARESTAS = ["referencia", "symlink", "git_remote", "ponte", "executa"] as const;

/** Camada ecossistema — vocabulário (kinds, procedências, cores) é o do /agente. */
type EcoMeta = { total: number; mostrados: number; counts: Record<string, number> };
type Evid = {
  livro: string;
  livroId: string | null;
  livroTitulo: string;
  formato: string | null;
  chunk_id: string;
  chunkIdx: number;
  paginaEstimada: number | null;
  trecho: string;
  confianca: number;
  clickup: { url: string; pasta: string; lista: string } | null;
  youtube: { titulo: string; url: string; canal: string } | null;
};
type LivroMeta = {
  id: string;
  titulo: string;
  tema: string;
  cluster: number | null;
  formato: string;
  origem: string;
  sizeBytes: number;
  temCapa: boolean;
  path: string;
  paginas: number | null;
  chunksTotal: number;
  proveniencia: { origemPath: string; motivo: string } | null;
  vizinhos: { id: string; titulo: string; score: number }[];
};

// re-tipa o componente dinâmico com os NOSSOS genéricos (dynamic() os perde)
const ForceGraph2D = ForceGraph2DBase as unknown as React.FC<
  ForceGraphProps<Nodo, Aresta> & {
    ref?: React.MutableRefObject<ForceGraphMethods<Nodo, Aresta> | undefined>;
  }
>;

const COR = {
  conceito: "#5b8cff",
  livro: "#c07f28",
  referencia: "#fb923c",
  video: "#ec4899",
  perfil: "#60a5fa",
  "colecao-ig": "#D4A853",
  clickup: "#9b6dd6", // fonte ClickUp (itens importados de tarefas externas)
  canal: "#35a894", // fonte canal/clone (YouTube, DNA de especialistas)
  topologia: "#a3e635", // camada do DISCO — hue livre, longe do conhecimento
  confirmed: "#2aa968",
  claimed: "#5b6575",
  disputed: "#d64545",
} as const;

const ehClickup = (id: string) => id.startsWith("livro:cu-");
const ehCanal = (id: string) => id.startsWith("livro:yt-");
const corDoNo = (n: { id: string; tipo: Nodo["tipo"]; ecoKind?: EcoKind }) =>
  n.tipo === "ecossistema"
    ? n.ecoKind
      ? COR_KIND[n.ecoKind]
      : "#f5f5f4" // raiz do ecossistema
    : ehClickup(n.id)
      ? COR.clickup
      : ehCanal(n.id)
        ? COR.canal
        : COR[n.tipo];
/** Nó desenhado grande: hubs (livro, perfil, coleção IG e os estruturais do ecossistema). */
const ehNoGrande = (n: Nodo) =>
  n.tipo === "livro" || n.tipo === "perfil" || n.tipo === "colecao-ig" ||
  (n.tipo === "ecossistema" && !!n.estrutural);
const labelLimpo = (s: string) =>
  s.replace(/^yt-[^:]+:/, "").replace(/\.transcript(\.txt)?$/, "").replace(/^dna-/, "DNA · ");

const RELACOES = [
  "é tipo de", "causa", "previne", "aumenta", "diminui", "melhora", "piora",
  "ativa", "inibe", "acelera", "retarda", "fortalece", "enfraquece",
  "requer", "compõe", "influencia",
];

function mb(n: number) {
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** Liga/desliga um valor numa lista de filtro (imutável). Lista vazia = sem
 *  restrição, então desmarcar tudo volta a mostrar tudo — não some com o grafo. */
const alterna = (lista: string[], v: string) =>
  lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];

type Impacto = {
  alvo: string;
  nosNoEscopo: number;
  ativo: { arestas: number; ocorrencias: number; arquivos: number; formas: Record<string, number> };
  dado: { ocorrencias: number; arquivos: number };
  symlinksEntrando: { src: string; quebrado: boolean }[];
  launchagents: string[];
  pontes: { src: string; dst: string; papel: string | null }[];
  gitRemotes: { remote: string | null; url: string | null; pushDesabilitado: boolean }[];
  topReferenciadores: { src: string; n: number; escopo: string | null }[];
};

const semVolume = (p: string) => p.replace(/^[A-Za-z]:[\\/]/, "");

/**
 * Painel do nó de topologia, com a query "se eu mover isto, o que quebra?".
 * O número que importa é o de refs em escopo ATIVO (código/doc/config): é o que
 * quebra de verdade. As refs em escopo DADO (board, dump, log) aparecem
 * separadas de propósito — somar as duas dá um número assustador e inútil
 * (tipicamente poucas ativas contra muitas de dado).
 */
function PainelTopologia({ n, onEgo }: { n: Nodo; onEgo: () => void }) {
  const [imp, setImp] = useState<Impacto | null>(null);
  const [estado, setEstado] = useState<"parado" | "carregando" | "vazio" | "erro">("parado");

  // troca de nó invalida o relatório anterior — senão o painel mostraria o
  // impacto do nó antigo sob o título do novo
  useEffect(() => {
    setImp(null);
    setEstado("parado");
  }, [n.id]);

  const consultar = async () => {
    if (!n.path) return;
    setEstado("carregando");
    try {
      const r = await fetch(`/api/graph/impacto?path=${encodeURIComponent(n.path)}`);
      if (r.status === 404) return setEstado("vazio");
      if (!r.ok) return setEstado("erro");
      setImp(await r.json());
      setEstado("parado");
    } catch {
      setEstado("erro");
    }
  };

  return (
    <div className="space-y-2 text-sm">
      <p className="text-[var(--bl-text-primary)]">{n.label}</p>
      <p className="text-[11px] text-[var(--bl-text-dim)]">
        <span style={{ color: COR.topologia }}>●</span> {n.tipoTopo}
        {n.plano ? ` · plano ${n.plano}` : ""} · grau {n.grau}
      </p>
      {n.path && (
        <p className="break-all rounded border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2 py-1 font-mono text-[10px] text-[var(--bl-text-dim)]">
          {semVolume(n.path)}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          onClick={onEgo}
          className="flex-1 rounded border border-[var(--bl-border)] px-2.5 py-1.5 hover:bg-[var(--bl-bg-card-hover)]"
        >
          ego-grafo
        </button>
        {n.path && (
          <button
            onClick={consultar}
            disabled={estado === "carregando"}
            className="flex-1 rounded border border-[var(--bl-border-hover)] px-2.5 py-1.5 hover:bg-[var(--bl-bg-card-hover)] disabled:opacity-50"
          >
            {estado === "carregando" ? "calculando…" : "o que quebra se eu mover"}
          </button>
        )}
      </div>

      {estado === "vazio" && (
        <p className="text-[11px] text-[var(--bl-text-dim)]">
          nenhum nó do grafo cobre esse caminho — o extrato não sabe responder.
        </p>
      )}
      {estado === "erro" && (
        <p className="text-[11px]" style={{ color: COR.disputed }}>
          não consegui calcular o impacto.
        </p>
      )}

      {imp && (
        <div className="space-y-2 rounded border border-[var(--bl-border)] p-2 text-[11px]">
          <p className="text-[var(--bl-text-secondary)]">
            {imp.nosNoEscopo} nó(s) do grafo dentro deste caminho
          </p>
          <p style={{ color: imp.ativo.ocorrencias > 0 ? COR.disputed : COR.confirmed }}>
            <strong>{imp.ativo.ocorrencias}</strong> referência(s) em código/config, em{" "}
            <strong>{imp.ativo.arquivos}</strong> arquivo(s) — isto quebra
          </p>
          <p className="text-[var(--bl-text-dim)]">
            {imp.dado.ocorrencias} menção(ões) em board/dump/log, em {imp.dado.arquivos}{" "}
            arquivo(s) — não quebra execução
          </p>
          {imp.launchagents.length > 0 && (
            <p style={{ color: COR.disputed }}>
              LaunchAgent na cadeia: {imp.launchagents.join(", ")} — quebra sozinho, agendado
            </p>
          )}
          {imp.symlinksEntrando.length > 0 && (
            <div>
              <p className="text-[var(--bl-text-secondary)]">
                {imp.symlinksEntrando.length} symlink(s) apontando pra dentro:
              </p>
              {imp.symlinksEntrando.map((s) => (
                <p key={s.src} className="break-all font-mono text-[10px] text-[var(--bl-text-dim)]">
                  {semVolume(s.src)}
                  {s.quebrado ? " [já quebrado]" : ""}
                </p>
              ))}
            </div>
          )}
          {imp.pontes.length > 0 && (
            <p className="text-[var(--bl-text-secondary)]">{imp.pontes.length} ponte(s) envolvida(s)</p>
          )}
          {imp.gitRemotes.map((g) => (
            <p key={g.remote ?? ""} className="break-all text-[var(--bl-text-dim)]">
              git remote {g.remote}
              {g.pushDesabilitado ? " (push desabilitado)" : ""}
            </p>
          ))}
          {imp.topReferenciadores.length > 0 && (
            <div>
              <p className="text-[var(--bl-text-secondary)]">quem mais cita:</p>
              {imp.topReferenciadores.slice(0, 8).map((t, i) => (
                <p key={`${t.src}-${i}`} className="break-all font-mono text-[10px] text-[var(--bl-text-dim)]">
                  {t.n}x [{t.escopo ?? "?"}] {semVolume(t.src)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Painel do nó do ecossistema: o que é, de onde vem, onde mora e quem está
 *  ligado a ele (membros do squad, ou o squad/hub a que pertence). */
function PainelEcossistema({
  n,
  links,
  nodes,
  onNo,
  onEgo,
}: {
  n: Nodo;
  links: Aresta[];
  nodes: Nodo[];
  onNo: (x: Nodo) => void;
  onEgo: () => void;
}) {
  const porId = useMemo(() => new Map(nodes.map((x) => [x.id, x])), [nodes]);
  const vizinhos = links
    .filter((l) => l.src === n.id || l.dst === n.id)
    .map((l) => ({ rel: l.rel, sai: l.src === n.id, no: porId.get(l.src === n.id ? l.dst : l.src) }))
    .filter((v): v is { rel: string; sai: boolean; no: Nodo } => !!v.no)
    .sort((a, b) => b.no.grau - a.no.grau);
  const cor = n.ecoKind ? COR_KIND[n.ecoKind] : "#f5f5f4";
  return (
    <div className="space-y-2 text-sm">
      <p className="text-[var(--bl-text-primary)]">{n.label}</p>
      <p className="text-[11px] text-[var(--bl-text-dim)]">
        <span style={{ color: cor }}>●</span> {n.ecoKind ?? "raiz"}
        {n.procedencia ? ` · ${n.procedencia}` : ""} · grau {n.grau}
      </p>
      {n.descricao && <p className="text-xs text-[var(--bl-text-secondary)]">{n.descricao}</p>}
      {n.path && (
        <p className="break-all rounded border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2 py-1 font-mono text-[10px] text-[var(--bl-text-dim)]">
          {semVolume(n.path)}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          onClick={onEgo}
          className="flex-1 rounded border border-[var(--bl-border)] px-2.5 py-1.5 hover:bg-[var(--bl-bg-card-hover)]"
        >
          ego-grafo
        </button>
        {!n.estrutural && (
          <Link
            href="/agente"
            className="flex-1 rounded border border-[var(--bl-border)] px-2.5 py-1.5 text-center hover:bg-[var(--bl-bg-card-hover)]"
          >
            ver no /agente
          </Link>
        )}
      </div>
      {vizinhos.length > 0 && (
        <div>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wider text-[var(--bl-text-dim)]">
            ligações ({vizinhos.length})
          </h3>
          <ul className="mt-1 space-y-0.5">
            {vizinhos.slice(0, 40).map((v) => (
              <li key={`${v.rel}-${v.no.id}`}>
                <button
                  onClick={() => onNo(v.no)}
                  className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--bl-bg-card-hover)]"
                >
                  <span className="shrink-0 text-[var(--bl-text-muted)]">{v.sai ? v.rel : `← ${v.rel}`}</span>
                  <span style={{ color: corDoNo(v.no) }}>●</span>
                  <span className="truncate text-[var(--bl-text-primary)]">{v.no.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {vizinhos.length > 40 && (
            <p className="mt-1 text-[11px] text-[var(--bl-text-dim)]">+{vizinhos.length - 40} — use o ego-grafo</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Grupo de chips de filtro multi-seleção. Nada de emoji. */
function ChipsFiltro({
  rotulo,
  opcoes,
  ativos,
  onToggle,
}: {
  rotulo: string;
  opcoes: string[];
  ativos: string[];
  onToggle: (v: string) => void;
}) {
  if (opcoes.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-[var(--bl-text-muted)]">{rotulo}:</span>
      {opcoes.map((o) => {
        const on = ativos.includes(o);
        return (
          <button
            key={o}
            onClick={() => onToggle(o)}
            aria-pressed={on}
            className={`rounded-full border px-2 py-0.5 ${
              on
                ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)] text-[var(--bl-text-secondary)]"
                : "border-[var(--bl-border)] text-[var(--bl-text-dim)]"
            }`}
          >
            {o}
          </button>
        );
      })}
    </span>
  );
}

/* ── componente ────────────────────────────────────────────────────── */
export function Grafo() {
  const fgRef = useRef<ForceGraphMethods<Nodo, Aresta> | undefined>(undefined);
  const boxRef = useRef<HTMLDivElement>(null);
  const sp = useSearchParams();
  const mostrarToast = useToast();
  const focoAmpliado = useRef(false); // o deep-link só amplia os filtros uma vez

  const [dados, setDados] = useState<{ nodes: Nodo[]; links: Aresta[] }>({ nodes: [], links: [] });
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [carregando, setCarregando] = useState(true);
  const [fisica, setFisica] = useState(false); // default: usa layout precomputado (instantâneo)

  // filtros
  const [status, setStatus] = useState<string[]>(["confirmed", "claimed"]);
  const [temas, setTemas] = useState<string[]>([]);
  const [tema, setTema] = useState("");
  const [rel, setRel] = useState("");
  const [minFontes, setMinFontes] = useState(1);
  const [comConhecimento, setComConhecimento] = useState(true);
  const [comLivros, setComLivros] = useState(true);
  const [comRefs, setComRefs] = useState(false);
  const [comVideos, setComVideos] = useState(false);
  // camada topologia — off por default: é outro eixo (o disco),
  // não um filtro do conhecimento, e dobra o tamanho do canvas.
  const [comTopologia, setComTopologia] = useState(false);
  const [topoMeta, setTopoMeta] = useState<TopoMeta | null>(null);
  const [topoErro, setTopoErro] = useState<string | null>(null);
  // filtros da topologia — vazio = sem restrição
  const [topoPlanos, setTopoPlanos] = useState<string[]>([]);
  const [topoTiposNo, setTopoTiposNo] = useState<string[]>([]);
  const [topoArestas, setTopoArestas] = useState<string[]>([]);
  const [topoMortas, setTopoMortas] = useState(false);
  // camada ecossistema — skills, squads, agents… (mesmo inventário do /agente)
  const [comEco, setComEco] = useState(false);
  const [ecoKinds, setEcoKinds] = useState<string[]>([]);
  const [ecoProc, setEcoProc] = useState<string[]>([]);
  const [ecoMeta, setEcoMeta] = useState<EcoMeta | null>(null);
  const [ecoErro, setEcoErro] = useState<string | null>(null);
  // filtro por data (client-side, sobre o que já veio) — "" = sem limite
  const [presetData, setPresetData] = useState<PresetData | "tudo" | "custom">("tudo");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [semData, setSemData] = useState(false);
  const [rotulos, setRotulos] = useState(true); // rótulos adaptativos ao zoom (toggle off = mais leve)
  const [busca, setBusca] = useState("");

  // seleção / foco
  const [sel, setSel] = useState<Nodo | null>(null);
  const [selMeta, setSelMeta] = useState<LivroMeta | null>(null);
  const [selEdge, setSelEdge] = useState<Aresta | null>(null);
  const [evid, setEvid] = useState<Evid[]>([]);
  const [ego, setEgo] = useState<string | null>(null); // duplo-clique = só a vizinhança
  const [hoverNode, setHoverNode] = useState<Nodo | null>(null);

  /* ── carga de dados ── */
  const carregar = useCallback(async () => {
    setCarregando(true);
    const qs = new URLSearchParams({ status: status.join(",") });
    if (!comConhecimento) qs.set("conhecimento", "0");
    if (comEco) {
      qs.set("ecossistema", "1");
      if (ecoKinds.length) qs.set("kinds", ecoKinds.join(","));
      if (ecoProc.length) qs.set("procedencias", ecoProc.join(","));
    }
    if (tema) qs.set("tema", tema);
    if (!comLivros) qs.set("livros", "0");
    // deep-link: o servidor corta nas arestas mais citadas e o conceito de nicho
    // ficaria de fora — o foco garante o nó e as arestas dele na carga
    const foco = sp.get("focus");
    if (foco) qs.set("foco", foco);
    if (comRefs) qs.set("refs", "1");
    if (comVideos) qs.set("videos", "1");
    if (comTopologia) {
      qs.set("topologia", "1");
      if (topoPlanos.length) qs.set("topoPlanos", topoPlanos.join(","));
      if (topoTiposNo.length) qs.set("topoTiposNo", topoTiposNo.join(","));
      if (topoArestas.length) qs.set("topoTipos", topoArestas.join(","));
      if (topoMortas) qs.set("topoMortas", "1");
    }
    const r = await fetch(`/api/graph?${qs}`);
    const d = await r.json();
    if (d.erro) {
      setStats(null);
      setTopoMeta(null);
      setTopoErro(null);
      setEcoMeta(null);
      setEcoErro(null);
      setDados({ nodes: [], links: [] });
      setCarregando(false);
      return;
    }
    setStats(d.stats);
    setTopoMeta((d.topo as TopoMeta) ?? null);
    setTopoErro((d.topoErro as string) ?? null);
    setEcoMeta((d.eco as EcoMeta) ?? null);
    setEcoErro((d.ecoErro as string) ?? null);
    const porId = new Map((d.nodes as Nodo[]).map((n) => [n.id, n]));
    const links: Aresta[] = (d.edges as Aresta[])
      .filter((e) => porId.has(e.src) && porId.has(e.dst))
      .map((e) => ({ ...e, source: e.src, target: e.dst }));
    setDados({ nodes: d.nodes, links });
    setCarregando(false);
  }, [
    status, tema, comConhecimento, comLivros, comRefs, comVideos,
    comTopologia, topoPlanos, topoTiposNo, topoArestas, topoMortas, sp,
    comEco, ecoKinds, ecoProc,
  ]);

  useEffect(() => void carregar(), [carregar]);

  useEffect(() => {
    fetch("/api/books")
      .then((r) => r.json())
      .then((d) => setTemas([...new Set((d.books as { tema: string }[]).map((b) => b.tema))].sort()));
  }, []);

  // dimensões responsivas
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() =>
      setDims({ w: el.clientWidth, h: el.clientHeight }),
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* ── recorte client-side: data, relação, min fontes, ego ── */
  const filtroData = useMemo(
    () =>
      presetData === "tudo"
        ? {}
        : presetData === "custom"
          ? { de: dataDe || undefined, ate: dataAte || undefined, semData }
          : { de: inicioDoPreset(presetData), semData },
    [presetData, dataDe, dataAte, semData],
  );
  const recorteData = useMemo(
    () => recortarPorData(dados.nodes, dados.links, filtroData),
    [dados, filtroData],
  );
  const visivel = useMemo(() => {
    let links = recorteData.links;
    if (rel) links = links.filter((l) => l.rel === rel || l.rel === "menciona");
    if (minFontes > 1)
      links = links.filter((l) => l.rel === "menciona" || l.n_fontes >= minFontes);
    if (ego) {
      const viz = new Set<string>([ego]);
      for (const l of links) {
        if (l.src === ego || l.dst === ego) {
          viz.add(l.src);
          viz.add(l.dst);
        }
      }
      // 2º hop
      for (const l of links) {
        if (viz.has(l.src) || viz.has(l.dst)) {
          viz.add(l.src);
          viz.add(l.dst);
        }
      }
      links = links.filter((l) => viz.has(l.src) && viz.has(l.dst));
    }
    const ids = new Set<string>();
    for (const l of links) {
      ids.add(l.src);
      ids.add(l.dst);
    }
    const nodes = dados.nodes.filter((n) => ids.has(n.id));
    return { nodes, links };
  }, [dados, recorteData, rel, minFontes, ego]);

  // recorte por data mantém as posições antigas — sem reenquadrar, o que
  // sobra fica espalhado pelo canvas inteiro e parece vazio
  useEffect(() => {
    if (!filtroDataAtivo(filtroData)) return;
    const t = setTimeout(() => fgRef.current?.zoomToFit(600, 60), 350);
    return () => clearTimeout(t);
  }, [filtroData]);

  /* ── vizinhança destacada (hover ou seleção) ── */
  const destaque = useMemo(() => {
    const foco = hoverNode?.id ?? sel?.id;
    if (!foco) return null;
    const nos = new Set<string>([foco]);
    const arestas = new Set<number>();
    for (const l of visivel.links) {
      if (l.src === foco || l.dst === foco) {
        nos.add(l.src);
        nos.add(l.dst);
        arestas.add(l.id);
      }
    }
    return { nos, arestas };
  }, [hoverNode, sel, visivel]);

  /* ── seleção de nó ── */
  const selecionaNo = useCallback(async (n: Nodo | null) => {
    setSel(n);
    setSelEdge(null);
    setSelMeta(null);
    if (n?.tipo === "livro" && n.livroId) {
      const r = await fetch(`/api/books/${n.livroId}`);
      if (r.ok) setSelMeta(await r.json());
    }
  }, []);

  const selecionaAresta = useCallback(async (l: Aresta) => {
    setSelEdge(l);
    setSel(null);
    setSelMeta(null);
    setEvid([]);
    const r = await fetch(`/api/graph/edge/${l.id}`);
    if (r.ok) setEvid((await r.json()).evidencias ?? []);
  }, []);

  /* ── deep-link ?focus= ── */
  useEffect(() => {
    const foco = sp.get("focus");
    if (!foco || carregando || dados.nodes.length === 0) return;
    const n = dados.nodes.find((x) => x.id === foco || x.label === foco);
    if (n) {
      void selecionaNo(n);
      setTimeout(() => fgRef.current?.centerAt(n.x ?? 0, n.y ?? 0, 800), 600);
      setTimeout(() => fgRef.current?.zoom(3, 800), 700);
      return;
    }
    // fora dos filtros padrão (disputada, outro tema, livros ocultos): amplia e recarrega uma vez
    const mais = focoAmpliado.current ? null : ampliarParaFoco({ status, tema, comLivros });
    focoAmpliado.current = true;
    if (mais) {
      setStatus(mais.status);
      setTema(mais.tema);
      setComLivros(mais.comLivros);
    } else {
      mostrarToast(`conceito "${foco}" não encontrado no grafo`, "aviso");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, dados.nodes.length]);

  /* ── busca de nó ── */
  const resultadosBusca = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 2) return [];
    return visivel.nodes
      .filter((n) => n.label.toLowerCase().includes(q))
      .sort((a, b) => b.grau - a.grau)
      .slice(0, 8);
  }, [busca, visivel]);

  const irParaNo = useCallback(
    (n: Nodo) => {
      setBusca("");
      void selecionaNo(n);
      fgRef.current?.centerAt(n.x ?? 0, n.y ?? 0, 800);
      fgRef.current?.zoom(3.5, 800);
    },
    [selecionaNo],
  );

  /* ── hubs (painel default) ── */
  const hubs = useMemo(
    () =>
      [...visivel.nodes]
        .filter((n) => n.tipo === "conceito" || (n.tipo === "ecossistema" && !n.estrutural))
        .sort((a, b) => b.grau - a.grau)
        .slice(0, 10),
    [visivel],
  );

  /* ── exports ── */
  const exportPng = useCallback(() => {
    const cv = boxRef.current?.querySelector("canvas");
    if (!cv) return;
    const a = document.createElement("a");
    a.download = `grafo-livros-${new Date().toISOString().slice(0, 10)}.png`;
    a.href = cv.toDataURL("image/png");
    a.click();
  }, []);

  const exportJson = useCallback(() => {
    const blob = new Blob(
      [JSON.stringify({ nodes: visivel.nodes, edges: visivel.links }, null, 1)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.download = `grafo-livros-${new Date().toISOString().slice(0, 10)}.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
  }, [visivel]);

  /* ── desenho custom ── */
  const desenhaNo = useCallback(
    (n: Nodo, ctx: CanvasRenderingContext2D, escala: number) => {
      const dim = destaque && !destaque.nos.has(n.id);
      const r = ehNoGrande(n) ? (n.id === "eco:raiz" ? 10 : 7) : 3.5 + Math.min(n.grau, 14) * 0.5;
      ctx.globalAlpha = dim ? 0.12 : 1;
      ctx.fillStyle = corDoNo(n);
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
      ctx.fill();
      if (sel?.id === n.id || hoverNode?.id === n.id) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5 / escala;
        ctx.stroke();
      }
      // Rótulo adaptativo ao zoom: afastado → só mega-hubs (senão vira borrão branco
      // ilegível E pesado); conforme aproxima, o limiar de grau cai e revela mais texto.
      // Ativo/hover sempre aparece. Toggle "rótulos" desliga tudo (render mais leve).
      const limiteGrau =
        escala >= 4 ? 0 : escala >= 2.5 ? 3 : escala >= 1.2 ? 8 : escala >= 0.6 ? 20 : Infinity;
      const ehHub = ehNoGrande(n);
      const mostraLabel =
        rotulos &&
        !dim &&
        (sel?.id === n.id ||
          hoverNode?.id === n.id ||
          n.grau >= limiteGrau ||
          (ehHub && escala >= 1.2));
      if (mostraLabel) {
        ctx.globalAlpha = dim ? 0.2 : 0.9;
        ctx.fillStyle = "rgba(231,236,243,.9)";
        ctx.font = `${Math.max(10 / escala, 1.8)}px sans-serif`;
        ctx.fillText(cortaTexto(labelLimpo(n.label), 30), n.x! + r + 2, n.y! + 2);
      }
      ctx.globalAlpha = 1;
    },
    [destaque, sel, hoverNode, rotulos],
  );

  const toggleStatus = (s: string) =>
    setStatus((f) => (f.includes(s) ? f.filter((x) => x !== s) : [...f, s]));

  /* ── painel flutuante: largura arrastável + minimizar (persistidos) ── */
  const [painelW, setPainelW] = useState(384);
  const [painelAberto, setPainelAberto] = useState(true);
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("knowledge-grafo-painel") ?? "{}");
      if (s.w) setPainelW(Math.min(Math.max(s.w, 280), 720));
      if (typeof s.aberto === "boolean") setPainelAberto(s.aberto);
    } catch { /* primeiro uso */ }
  }, []);
  useEffect(() => {
    localStorage.setItem("knowledge-grafo-painel", JSON.stringify({ w: painelW, aberto: painelAberto }));
  }, [painelW, painelAberto]);

  const arrastaPainel = useCallback((ev: React.MouseEvent) => {
    ev.preventDefault();
    const move = (e: MouseEvent) =>
      setPainelW(Math.min(Math.max(window.innerWidth - e.clientX - 12, 280), 720));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);

  // cobertura do layout precomputado nos nós visíveis (sidecar graph-layout.json)
  const layoutCobre = useMemo(() => {
    const ns = visivel.nodes;
    if (!ns.length) return 0;
    return ns.filter((n) => typeof n.x === "number").length / ns.length;
  }, [visivel]);
  // simula quando: física ligada OU não há layout pra maioria (refs/vídeos = fallback).
  // Com layout, render é INSTANTÂNEO (posições precomputadas, sem simulação).
  const simular = fisica || layoutCobre < 0.8;

  /* ── UI ── */
  return (
    <div className="relative h-[calc(100vh-110px)] w-full">
      <div className="absolute inset-0 overflow-hidden rounded-lg border border-white/10 bg-[#0a0b0d]" ref={boxRef}>
        <ForceGraph2D
          ref={fgRef}
          width={dims.w}
          height={dims.h}
          graphData={visivel}
          backgroundColor="#0a0b0d"
          // Layout precomputado (sidecar) → cooldownTicks=0 = render instantâneo. Sem
          // layout (refs/vídeos) ou "física" ligada → assenta com orçamento e congela.
          warmupTicks={simular ? 60 : 0}
          cooldownTicks={simular ? 90 : 0}
          d3AlphaDecay={0.035}
          d3VelocityDecay={0.45}
          nodeId="id"
          nodeVal={(n: Nodo) => (ehNoGrande(n) ? 8 : 2 + Math.min(n.grau, 14))}
          nodeLabel={() => ""}
          nodeCanvasObject={desenhaNo}
          nodePointerAreaPaint={(n: Nodo, cor, ctx) => {
            ctx.fillStyle = cor;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, 12, 0, 2 * Math.PI); // alvo ≥ mark (regra dataviz/44px)
            ctx.fill();
          }}
          linkColor={(l: Aresta) =>
            destaque && !destaque.arestas.has(l.id)
              ? "rgba(80,90,105,.06)"
              : l.rel === "menciona"
                ? "rgba(192,127,40,.16)"
                : l.camada === "ecossistema"
                  ? "rgba(196,132,252,.22)"
                  : COR[l.status]
          }
          linkWidth={(l: Aresta) =>
            l.rel === "menciona" || l.camada === "ecossistema" ? 0.5 : Math.min(1 + l.n_fontes, 6)
          }
          linkLineDash={(l: Aresta) => (l.status === "disputed" ? [4, 3] : null)}
          onNodeClick={(n: Nodo) => void selecionaNo(n)}
          onNodeRightClick={(n: Nodo) => setEgo((e) => (e === n.id ? null : n.id))}
          onLinkClick={(l: Aresta) => void selecionaAresta(l)}
          onNodeHover={(n: Nodo | null) => setHoverNode(n)}
          onBackgroundClick={() => {
            setSel(null);
            setSelEdge(null);
            setSelMeta(null);
          }}
          enableNodeDrag
        />

        {/* barra de filtros */}
        <div className="absolute left-3 top-3 right-3 z-30 flex flex-wrap items-center gap-2 text-xs">
          {/* modo essencial: só arestas confirmadas (≥2 obras) — bem mais leve */}
          <button
            onClick={() =>
              setStatus((s) =>
                s.length === 1 && s[0] === "confirmed"
                  ? ["confirmed", "claimed"]
                  : ["confirmed"],
              )
            }
            aria-pressed={status.length === 1 && status[0] === "confirmed"}
            title="mostrar só relações confirmadas (≥2 obras) — visão essencial, bem mais leve"
            className={`rounded-full border px-3 py-1.5 ${status.length === 1 && status[0] === "confirmed" ? "border-[var(--bl-border-accent)] bg-[var(--bl-accent-dim)] text-[var(--bl-accent)]" : "border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] text-[var(--bl-text-dim)]"}`}
          >
            ⚡ essencial
          </button>
          {(["confirmed", "claimed", "disputed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              aria-pressed={status.includes(s)}
              className={`rounded-full border px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--bl-border-accent)] ${status.includes(s) ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)]" : "border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] text-[var(--bl-text-dim)]"}`}
              style={{ color: status.includes(s) ? COR[s] : undefined }}
            >
              {s === "disputed" ? "⚠ disputed" : s}
              {stats ? ` ${stats[s] ?? 0}` : ""}
            </button>
          ))}
          <select
            value={tema}
            onChange={(e) => setTema(e.target.value)}
            className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2 py-1.5"
            aria-label="filtrar por tema"
          >
            <option value="">todos os temas</option>
            {temas.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            value={rel}
            onChange={(e) => setRel(e.target.value)}
            className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2 py-1.5"
            aria-label="filtrar por relação"
          >
            <option value="">todas as relações</option>
            {RELACOES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2 py-1.5">
            ≥
            <input
              type="range"
              min={1}
              max={4}
              value={minFontes}
              onChange={(e) => setMinFontes(Number(e.target.value))}
              className="w-16 accent-[var(--bl-accent)]"
            />
            {minFontes} fonte{minFontes > 1 ? "s" : ""}
          </label>
          <button
            onClick={() => setComConhecimento((v) => !v)}
            aria-pressed={comConhecimento}
            title="grafo de conceitos dos livros — desligue pra ver só o ecossistema/topologia"
            className={`rounded-full border px-3 py-1.5 ${comConhecimento ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)]" : "border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] text-[var(--bl-text-dim)]"}`}
            style={{ color: comConhecimento ? COR.conceito : undefined }}
          >
            ● conhecimento
          </button>
          <button
            onClick={() => setComLivros((v) => !v)}
            aria-pressed={comLivros}
            className={`rounded-full border px-3 py-1.5 ${comLivros ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)]" : "border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] text-[var(--bl-text-dim)]"}`}
            style={{ color: comLivros ? COR.livro : undefined }}
          >
            ● livros
          </button>
          <button
            onClick={() => setComRefs((v) => !v)}
            aria-pressed={comRefs}
            className={`rounded-full border px-3 py-1.5 ${comRefs ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)]" : "border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] text-[var(--bl-text-dim)]"}`}
            style={{ color: comRefs ? COR.referencia : undefined }}
          >
            ● referências
          </button>
          <button
            onClick={() => setComVideos((v) => !v)}
            aria-pressed={comVideos}
            className={`rounded-full border px-3 py-1.5 ${comVideos ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)]" : "border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] text-[var(--bl-text-dim)]"}`}
            style={{ color: comVideos ? COR.video : undefined }}
          >
            ● vídeos
          </button>
          <button
            onClick={() => setComTopologia((v) => !v)}
            aria-pressed={comTopologia}
            title="camada do disco: pastas, repos, skills, engines e as arestas reais entre eles (rede de influência)"
            className={`rounded-full border px-3 py-1.5 ${comTopologia ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)]" : "border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] text-[var(--bl-text-dim)]"}`}
            style={{ color: comTopologia ? COR.topologia : undefined }}
          >
            ● topologia
          </button>
          <button
            onClick={() => setComEco((v) => !v)}
            aria-pressed={comEco}
            title="mapa do ecossistema: squads, agents, skills, workers, workflows, clones, shadows, engines e repos (mesmo inventário do /agente)"
            className={`rounded-full border px-3 py-1.5 ${comEco ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)]" : "border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] text-[var(--bl-text-dim)]"}`}
            style={{ color: comEco ? COR_KIND.skill : undefined }}
          >
            ● ecossistema
          </button>
          {/* filtro por data — recorta o que já veio (sem recarregar) */}
          <label className="flex items-center gap-1.5 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2 py-1.5">
            <span className="text-[var(--bl-text-muted)]">data</span>
            <select
              value={presetData}
              onChange={(e) => setPresetData(e.target.value as typeof presetData)}
              aria-label="filtrar por data"
              title="data = última modificação no disco (livro, post, skill, pasta) ou último uso/push; conceito herda a obra mais antiga que o sustenta"
              className="bg-transparent outline-none"
            >
              <option value="tudo">qualquer</option>
              {PRESETS_DATA.map((p) => (
                <option key={p} value={p}>
                  {p === "1a" ? "último ano" : `últimos ${p.slice(0, -1)} dias`}
                </option>
              ))}
              <option value="custom">intervalo…</option>
            </select>
          </label>
          {presetData === "custom" && (
            <span className="flex items-center gap-1">
              <input
                type="date"
                value={dataDe}
                max={dataAte || undefined}
                onChange={(e) => setDataDe(e.target.value)}
                aria-label="data inicial"
                className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2 py-1 [color-scheme:dark]"
              />
              <span className="text-[var(--bl-text-muted)]">até</span>
              <input
                type="date"
                value={dataAte}
                min={dataDe || undefined}
                onChange={(e) => setDataAte(e.target.value)}
                aria-label="data final"
                className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2 py-1 [color-scheme:dark]"
              />
            </span>
          )}
          {filtroDataAtivo(filtroData) && (
            <button
              onClick={() => setSemData((v) => !v)}
              aria-pressed={semData}
              title="nós sem data conhecida (fontes sem arquivo no disco, caminhos que sumiram) — escondidos por padrão"
              className={`rounded-full border px-3 py-1.5 ${semData ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)] text-[var(--bl-text-secondary)]" : "border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] text-[var(--bl-text-dim)]"}`}
            >
              {semData ? "com" : "sem"} os sem data
              {!semData && recorteData.ocultosSemData > 0 ? ` (${recorteData.ocultosSemData} ocultos)` : ""}
            </button>
          )}
          <button
            onClick={() => setRotulos((v) => !v)}
            aria-pressed={rotulos}
            title="rótulos adaptativos ao zoom — desligar deixa o render mais leve"
            className={`rounded-full border px-3 py-1.5 ${rotulos ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)] text-[var(--bl-text-secondary)]" : "border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] text-[var(--bl-text-dim)]"}`}
          >
            {rotulos ? "A" : "A̶"} rótulos
          </button>
          <div className="relative ml-auto">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="achar nó…"
              className="w-44 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-3 py-1.5 outline-none placeholder:text-[var(--bl-text-muted)] focus:border-[var(--bl-border-accent)]"
            />
            {resultadosBusca.length > 0 && (
              <div className="absolute right-0 top-9 z-40 w-64 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-elevated)] p-1 shadow-[var(--bl-shadow-lg)]">
                {resultadosBusca.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => irParaNo(n)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--bl-bg-card-hover)]"
                  >
                    <span style={{ color: corDoNo(n) }}>●</span>
                    <span className="truncate">{n.label}</span>
                    <Badge className="ml-auto">{n.grau}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* filtros da topologia — só aparecem com a camada ligada; o vocabulário vem
              do extrato (meta.*Disponiveis), nunca hardcodado, porque muda a
              cada rodada do extrator.
              Fica DENTRO da barra de cima (que é flex-wrap) com w-full, ganhando
              linha própria: posicionar por offset absoluto (top-16) sobrepunha os
              controles assim que eles quebravam em 2 linhas — e quebram, ainda
              mais com o botão "topologia" adicionado. */}
          {comEco && (ecoMeta || ecoKinds.length > 0 || ecoProc.length > 0) && (
            <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-topbar-bg)] px-3 py-2 text-[11px] backdrop-blur-[var(--bl-glass-blur)] backdrop-saturate-[var(--bl-glass-saturate)]">
              <span className="flex flex-wrap items-center gap-1">
                <span className="text-[var(--bl-text-muted)]">tipo:</span>
                {ECO_KINDS.map((k) => {
                  const on = ecoKinds.includes(k);
                  return (
                    <button
                      key={k}
                      onClick={() => setEcoKinds(alterna(ecoKinds, k))}
                      aria-pressed={on}
                      className={`rounded-full border px-2 py-0.5 ${on ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)] text-[var(--bl-text-secondary)]" : "border-[var(--bl-border)] text-[var(--bl-text-dim)]"}`}
                    >
                      <span style={{ color: COR_KIND[k] }}>●</span> {k}
                      {ecoMeta?.counts[k] !== undefined ? ` ${ecoMeta.counts[k]}` : ""}
                    </button>
                  );
                })}
              </span>
              <ChipsFiltro
                rotulo="procedência"
                opcoes={[...PROCEDENCIA_ORDEM]}
                ativos={ecoProc}
                onToggle={(v) => setEcoProc(alterna(ecoProc, v))}
              />
              {(ecoKinds.length > 0 || ecoProc.length > 0) && (
                <button
                  onClick={() => {
                    setEcoKinds([]);
                    setEcoProc([]);
                  }}
                  className="ml-auto rounded-full border border-[var(--bl-border)] px-2 py-0.5 text-[var(--bl-text-dim)] hover:text-[var(--bl-text-secondary)]"
                >
                  limpar filtros
                </button>
              )}
            </div>
          )}

          {comTopologia && topoMeta && topoMeta.totalNos > 0 && (
            <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-topbar-bg)] px-3 py-2 text-[11px] backdrop-blur-[var(--bl-glass-blur)] backdrop-saturate-[var(--bl-glass-saturate)]">
            <ChipsFiltro
              rotulo="plano"
              opcoes={topoMeta.planosDisponiveis}
              ativos={topoPlanos}
              onToggle={(v) => setTopoPlanos(alterna(topoPlanos, v))}
            />
            <ChipsFiltro
              rotulo="nó"
              opcoes={topoMeta.tiposNoDisponiveis}
              ativos={topoTiposNo}
              onToggle={(v) => setTopoTiposNo(alterna(topoTiposNo, v))}
            />
            <ChipsFiltro
              rotulo="aresta"
              opcoes={[...TOPO_ARESTAS]}
              ativos={topoArestas}
              onToggle={(v) => setTopoArestas(alterna(topoArestas, v))}
            />
            <button
              onClick={() => setTopoMortas((v) => !v)}
              aria-pressed={topoMortas}
              title="só referências apontando pra path que não existe mais — o sinal de fóssil que o extrato realmente tem (não há mtime)"
              className={`rounded-full border px-2 py-0.5 ${topoMortas ? "border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-hover)]" : "border-[var(--bl-border)] text-[var(--bl-text-dim)]"}`}
              style={{ color: topoMortas ? COR.disputed : undefined }}
            >
              só refs mortas
            </button>
            {(topoPlanos.length > 0 ||
              topoTiposNo.length > 0 ||
              topoArestas.length > 0 ||
              topoMortas) && (
              <button
                onClick={() => {
                  setTopoPlanos([]);
                  setTopoTiposNo([]);
                  setTopoArestas([]);
                  setTopoMortas(false);
                }}
                className="ml-auto rounded-full border border-[var(--bl-border)] px-2 py-0.5 text-[var(--bl-text-dim)] hover:text-[var(--bl-text-secondary)]"
              >
                  limpar filtros
                </button>
              )}
            </div>
          )}
        </div>

        {/* controles inferiores — mesma receita glass do topbar do DS (blur+saturate, nunca opaco) */}
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-2 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-topbar-bg)] px-3 py-2 text-[11px] text-[var(--bl-text-dim)] backdrop-blur-[var(--bl-glass-blur)] backdrop-saturate-[var(--bl-glass-saturate)]">
          <span><span style={{ color: COR.livro }}>●</span> livro</span>
          <span><span style={{ color: COR.clickup }}>●</span> clickup</span>
          <span><span style={{ color: COR.canal }}>●</span> canal/clone</span>
          <span><span style={{ color: COR.conceito }}>●</span> conceito</span>
          <span><span style={{ color: COR.referencia }}>●</span> referência</span>
          <span><span style={{ color: COR.video }}>●</span> vídeo</span>
          <span><span style={{ color: COR.perfil }}>●</span> perfil IG</span>
          <span><span style={{ color: COR["colecao-ig"] }}>●</span> coleção IG</span>
          {comTopologia && (
            <span><span style={{ color: COR.topologia }}>●</span> topologia (disco)</span>
          )}
          {comEco &&
            ECO_KINDS.filter((k) => !ecoKinds.length || ecoKinds.includes(k)).map((k) => (
              <span key={k}><span style={{ color: COR_KIND[k] }}>●</span> {k}</span>
            ))}
          {comEco && ecoErro && (
            <span style={{ color: COR.disputed }} title={ecoErro}>
              camada ecossistema indisponível
            </span>
          )}
          {comEco && ecoMeta && ecoMeta.total > 0 && (
            <span>ecossistema: {ecoMeta.mostrados} de {ecoMeta.total} entidades</span>
          )}
          {comEco && ecoMeta && ecoMeta.total === 0 && !ecoErro && (
            <span style={{ color: COR.disputed }}>
              camada ecossistema vazia — inventário não configurado (veja docs/agente-registro.md)
            </span>
          )}
          <span><span style={{ color: COR.confirmed }}>—</span> confirmada</span>
          <span><span style={{ color: COR.disputed }}>╌</span> disputada</span>
          {comTopologia && (topoErro || (topoMeta && topoMeta.totalNos === 0)) && (
            <span style={{ color: COR.disputed }} title={topoErro ?? undefined}>
              {topoErro
                ? "camada de topologia indisponível — extrato não encontrado (BILHON_TOPOLOGY_DIR)"
                : "camada de topologia vazia neste provider"}
            </span>
          )}
          {comTopologia && topoMeta && topoMeta.totalNos > 0 && (
            <span
              title={`extrato v${topoMeta.versao} de ${topoMeta.geradoEm} — ${topoMeta.totalNos} nós / ${topoMeta.totalArestas} arestas no disco`}
              style={{ color: topoMeta.truncado ? COR.disputed : undefined }}
            >
              {topoMeta.truncado
                ? `topologia truncada: ${topoMeta.arestasMostradas} de ${topoMeta.arestasFiltradas} arestas`
                : `topologia: ${topoMeta.arestasMostradas} arestas`}
            </span>
          )}
          <span>espessura = nº fontes · clique nó/aresta · botão-direito = ego-grafo · arraste nós</span>
          <span className="ml-auto flex gap-1.5">
            {ego && (
              <button onClick={() => setEgo(null)} className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-amber-200">
                sair do ego-grafo
              </button>
            )}
            <button onClick={() => setFisica((f) => !f)} className="rounded border border-[var(--bl-border)] px-2 py-1 hover:bg-[var(--bl-bg-card-hover)]">
              {fisica ? "⏸ física" : "▶ física"}
            </button>
            <button onClick={() => fgRef.current?.zoomToFit(600, 40)} className="rounded border border-[var(--bl-border)] px-2 py-1 hover:bg-[var(--bl-bg-card-hover)]">
              ⤢ ajustar
            </button>
            <button onClick={exportPng} className="rounded border border-[var(--bl-border)] px-2 py-1 hover:bg-[var(--bl-bg-card-hover)]">
              ⇩ PNG
            </button>
            <button onClick={exportJson} className="rounded border border-[var(--bl-border)] px-2 py-1 hover:bg-[var(--bl-bg-card-hover)]">
              ⇩ JSON
            </button>
          </span>
        </div>

        {carregando && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white/60">
            carregando grafo…
          </div>
        )}
      </div>

      {/* ── painel flutuante SOBRE o canvas (arrastável + minimizável) ──
         opacidade quase sólida (98%) + blur pesado (token --bl-glass-blur)
         pra nunca deixar o grafo por trás comer o contraste do texto. */}
      {painelAberto ? (
        <aside
          className="absolute bottom-2 right-2 top-14 z-20 flex overflow-hidden rounded-[var(--bl-radius-md)] border border-[var(--bl-border-hover)] bg-[var(--bl-bg-elevated)]/[.97] text-sm shadow-[var(--bl-shadow-xl)] backdrop-blur-[var(--bl-glass-blur)] backdrop-saturate-[var(--bl-glass-saturate)]"
          style={{ width: painelW }}
        >
          {/* alça de redimensionar (borda esquerda) */}
          <div
            onMouseDown={arrastaPainel}
            title="arrastar pra redimensionar"
            className="group flex w-2.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-[var(--bl-bg-card-hover)]"
          >
            <div className="h-10 w-1 rounded bg-[var(--bl-border-hover)] group-hover:bg-[var(--bl-text-dim)]" />
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-[var(--bl-text-dim)]">
                painel
              </span>
              <button
                onClick={() => setPainelAberto(false)}
                title="minimizar painel (canvas inteiro)"
                className="rounded border border-[var(--bl-border)] px-2.5 py-1 text-xs text-[var(--bl-text-dim)] hover:bg-[var(--bl-bg-card-hover)] hover:text-[var(--bl-text-primary)]"
              >
                ✕ minimizar
              </button>
            </div>
            {!sel && !selEdge && (
              <PainelDefault stats={stats} hubs={hubs} onHub={irParaNo} />
            )}
            {sel?.tipo === "conceito" && (
              <PainelConceito n={sel} links={visivel.links} nodes={dados.nodes} onNo={irParaNo} onAresta={selecionaAresta} onEgo={() => setEgo(sel.id)} />
            )}
            {sel?.tipo === "livro" && <PainelLivro n={sel} meta={selMeta} onEgo={() => setEgo(sel.id)} />}
            {(sel?.tipo === "referencia" || sel?.tipo === "video") && (
              <div className="space-y-2 text-sm">
                <p className="text-[var(--bl-text-primary)]">{sel.label}</p>
                <p className="text-[11px] text-[var(--bl-text-dim)]">
                  {sel.tipo === "video" ? "🎬 post com vídeo" : "🖼 post de imagens"} — salvos IG
                </p>
                {sel.igUrl && (
                  <a href={urlHttp(sel.igUrl)} target="_blank" rel="noreferrer" className="block rounded border border-[var(--bl-border)] px-2.5 py-1.5 text-center hover:bg-[var(--bl-bg-card-hover)]">
                    abrir no Instagram ↗
                  </a>
                )}
                <a href="/referencias" className="block rounded border border-[var(--bl-border)] px-2.5 py-1.5 text-center hover:bg-[var(--bl-bg-card-hover)]">
                  ver na galeria de referências
                </a>
              </div>
            )}
            {sel?.tipo === "topologia" && (
              <PainelTopologia n={sel} onEgo={() => setEgo(sel.id)} />
            )}
            {sel?.tipo === "ecossistema" && (
              <PainelEcossistema n={sel} links={visivel.links} nodes={dados.nodes} onNo={irParaNo} onEgo={() => setEgo(sel.id)} />
            )}
            {sel?.data && (
              <p className="mt-3 border-t border-[var(--bl-border)] pt-2 text-[11px] text-[var(--bl-text-dim)]">
                data {sel.data}
                {sel.tipo === "conceito" ? " — obra mais antiga que sustenta o conceito" : " — última modificação/atividade"}
              </p>
            )}
            {selEdge && <PainelAresta l={selEdge} evid={evid} />}
          </div>
        </aside>
      ) : (
        <button
          onClick={() => setPainelAberto(true)}
          title="mostrar painel"
          className="absolute right-2 top-14 z-20 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-hover)] bg-[var(--bl-bg-elevated)]/[.97] px-3 py-2 text-sm text-[var(--bl-text-secondary)] shadow-[var(--bl-shadow-lg)] backdrop-blur-[var(--bl-glass-blur)] backdrop-saturate-[var(--bl-glass-saturate)] hover:bg-[var(--bl-bg-card-hover)]"
        >
          ☰ painel
        </button>
      )}
    </div>
  );
}

/* ── painéis ───────────────────────────────────────────────────────── */
function PainelDefault({
  stats,
  hubs,
  onHub,
}: {
  stats: Record<string, number> | null;
  hubs: Nodo[];
  onHub: (n: Nodo) => void;
}) {
  return (
    <div>
      <p className="font-medium text-[var(--bl-text-primary)]">Grafo de conhecimento</p>
      <p className="mt-2 text-[var(--bl-text-secondary)]">
        {stats
          ? `${stats.conceitos} conceitos · ${stats.livros} livros · ${stats.confirmed} confirmadas (≥2 obras) · ${stats.claimed} alegadas · ${stats.disputed} disputadas`
          : "carregando…"}
      </p>
      <p className="mt-2 text-xs text-[var(--bl-text-dim)]">
        Toda aresta carrega evidência. Clique numa aresta → trechos e link direto
        pra leitura. Clique num nó → detalhes. Botão-direito → ego-grafo (2 saltos).
      </p>
      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-[var(--bl-text-dim)]">
        Maiores hubs
      </h3>
      <ul className="mt-2 space-y-1">
        {hubs.map((h) => (
          <li key={h.id}>
            <button
              onClick={() => onHub(h)}
              className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--bl-bg-card-hover)]"
            >
              <span className="text-[var(--bl-text-primary)]">{h.label}</span>
              <Badge className="ml-auto">{h.grau} conexões</Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PainelConceito({
  n,
  links,
  nodes,
  onNo,
  onAresta,
  onEgo,
}: {
  n: Nodo;
  links: Aresta[];
  nodes: Nodo[];
  onNo: (x: Nodo) => void;
  onAresta: (l: Aresta) => void;
  onEgo: () => void;
}) {
  const porId = useMemo(() => new Map(nodes.map((x) => [x.id, x])), [nodes]);
  const minhas = links.filter(
    (l) => l.rel !== "menciona" && (l.src === n.id || l.dst === n.id),
  );
  const livros = links
    .filter((l) => l.rel === "menciona" && l.dst === n.id)
    .map((l) => porId.get(l.src))
    .filter(Boolean) as Nodo[];
  return (
    <div>
      <p className="text-xs uppercase tracking-wider" style={{ color: COR.conceito }}>
        conceito
      </p>
      <p className="mt-1 text-lg font-medium text-[var(--bl-text-primary)]">{n.label}</p>
      <p className="text-[var(--bl-text-dim)]">{n.grau} conexões · {livros.length} obra(s) mencionam</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onEgo} className="rounded border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-3 py-1.5 text-xs text-[var(--bl-text-primary)] hover:bg-[var(--bl-bg-card-hover)]">
          ⊕ ego-grafo
        </button>
        <Link
          href={`/buscar?q=${encodeURIComponent(n.label)}`}
          className="rounded border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-3 py-1.5 text-xs text-[var(--bl-text-primary)] hover:bg-[var(--bl-bg-card-hover)]"
        >
          🔍 buscar no acervo
        </Link>
      </div>

      <Autolearn conceito={n.id} />

      {minhas.length > 0 && (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-[var(--bl-text-dim)]">
            Relações ({minhas.length})
          </h3>
          <ul className="mt-2 space-y-1 text-[13px]">
            {minhas.slice(0, 20).map((l) => (
              <li key={l.id}>
                <button
                  onClick={() => onAresta(l)}
                  className="w-full rounded px-2 py-1 text-left hover:bg-[var(--bl-bg-card-hover)]"
                >
                  <span className="text-[var(--bl-text-primary)]">{porId.get(l.src)?.label}</span>{" "}
                  <span style={{ color: COR[l.status] }}>—{l.rel}→</span>{" "}
                  <span className="text-[var(--bl-text-primary)]">{porId.get(l.dst)?.label}</span>
                  <Badge className="ml-1">{l.n_fontes}f</Badge>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {livros.length > 0 && (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-[var(--bl-text-dim)]">
            Obras que mencionam
          </h3>
          <ul className="mt-2 space-y-1">
            {livros.map((lv) => (
              <li key={lv.id}>
                <button
                  onClick={() => onNo(lv)}
                  className="w-full truncate rounded px-2 py-1 text-left text-[13px] text-[var(--bl-text-secondary)] hover:bg-[var(--bl-bg-card-hover)]"
                >
                  <span style={{ color: COR.livro }}>●</span> {lv.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PainelLivro({
  n,
  meta,
  onEgo,
}: {
  n: Nodo;
  meta: LivroMeta | null;
  onEgo: () => void;
}) {
  const cuDoc = ehClickup(n.id) ? n.id.replace(/^livro:/, "") : null;
  const [cu, setCu] = useState<{
    url: string;
    pasta: string;
    lista: string;
    nome: string;
    status: string;
    tags: string[];
  } | null>(null);
  useEffect(() => {
    if (!cuDoc) return;
    fetch(`/api/clickup?doc=${encodeURIComponent(cuDoc)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setCu)
      .catch(() => setCu(null));
  }, [cuDoc]);

  if (ehCanal(n.id)) {
    const canal = n.id.slice("livro:yt-".length, n.id.indexOf(":", 9));
    return (
      <div>
        <p className="text-xs uppercase tracking-wider" style={{ color: COR.canal }}>
          ▶ canal / clone
        </p>
        <p className="mt-1 font-medium leading-snug text-[var(--bl-text-primary)]">{labelLimpo(n.label)}</p>
        <p className="mt-1 text-xs text-[var(--bl-text-dim)]">fonte: {canal}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={onEgo} className="rounded border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-3 py-1.5 text-xs text-[var(--bl-text-primary)] hover:bg-[var(--bl-bg-card-hover)]">
            ⊕ ego-grafo
          </button>
        </div>
        <p className="mt-4 text-[11px] text-[var(--bl-text-dim)]">
          Extração do corpus (transcript de vídeo ou DNA de clone). Clique numa
          aresta pra ver o trecho e o link ▶ assistir no YouTube.
        </p>
      </div>
    );
  }

  if (cuDoc) {
    return (
      <div>
        <p className="text-xs uppercase tracking-wider" style={{ color: COR.clickup }}>
          ☑ item do ClickUp
        </p>
        <p className="mt-1 font-medium leading-snug text-[var(--bl-text-primary)]">{cu?.nome ?? n.label}</p>
        {cu && (
          <dl className="mt-3 space-y-1.5 text-[12.5px]">
            <Linha k="Pasta › Lista" v={`${cu.pasta} › ${cu.lista}`} />
            {cu.status && <Linha k="Status" v={cu.status} />}
            {cu.tags.length > 0 && <Linha k="Tags" v={cu.tags.join(", ")} />}
          </dl>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {cu && (
            <a
              href={cu.url}
              target="_blank"
              rel="noreferrer"
              className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-[var(--bl-bg-card-hover)]"
              style={{ borderColor: "rgba(155,109,214,.5)", color: COR.clickup }}
            >
              ☑ abrir no ClickUp →
            </a>
          )}
          <button onClick={onEgo} className="rounded border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-3 py-1.5 text-xs text-[var(--bl-text-primary)] hover:bg-[var(--bl-bg-card-hover)]">
            ⊕ ego-grafo
          </button>
        </div>
        <p className="mt-4 text-[11px] text-[var(--bl-text-dim)]">
          Backup/construção do usuário no ClickUp — ingerido no corpus e
          conectado ao grafo. A evidência liga direto na task original.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs uppercase tracking-wider" style={{ color: COR.livro }}>
        livro
      </p>
      <div className="mt-2 flex gap-3">
        {meta?.temCapa && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/covers/${meta.id}`}
            alt=""
            className="h-28 w-20 shrink-0 rounded border border-[var(--bl-border)] object-cover"
          />
        )}
        <div className="min-w-0">
          <p className="font-medium leading-snug text-[var(--bl-text-primary)]">{meta?.titulo ?? n.label}</p>
          {meta && (
            <p className="mt-1 text-xs text-[var(--bl-text-dim)]">
              {meta.tema}
              {meta.cluster ? ` · cluster ${meta.cluster}` : ""}
            </p>
          )}
        </div>
      </div>

      {meta && (
        <dl className="mt-4 space-y-1.5 text-[12.5px]">
          <Linha k="Extensão" v={meta.formato.toUpperCase()} />
          <Linha k="Peso" v={mb(meta.sizeBytes)} />
          {meta.paginas && <Linha k="Páginas" v={String(meta.paginas)} />}
          <Linha k="Chunks indexados" v={String(meta.chunksTotal)} />
          <Linha k="Origem" v={meta.origem} />
          <div>
            <dt className="text-[var(--bl-text-muted)]">Onde está (pasta)</dt>
            <dd className="break-all font-mono text-[11px] text-[var(--bl-text-secondary)]">{meta.path}</dd>
          </div>
          {meta.proveniencia && (
            <div>
              <dt className="text-[var(--bl-text-muted)]">Proveniência</dt>
              <dd className="break-all font-mono text-[11px] text-[var(--bl-text-dim)]">
                {meta.proveniencia.origemPath}
              </dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {n.livroId && (
          <>
            <Link href={`/livro/${n.livroId}`} className="rounded border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-3 py-1.5 text-xs text-[var(--bl-text-primary)] hover:bg-[var(--bl-bg-card-hover)]">
              ficha do livro
            </Link>
            <Link href={`/ler/${n.livroId}`} className="rounded border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-3 py-1.5 text-xs text-[var(--bl-text-primary)] hover:bg-[var(--bl-bg-card-hover)]">
              📖 ler agora
            </Link>
          </>
        )}
        <button onClick={onEgo} className="rounded border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-3 py-1.5 text-xs text-[var(--bl-text-primary)] hover:bg-[var(--bl-bg-card-hover)]">
          ⊕ ego-grafo
        </button>
      </div>

      {meta && <Autolearn livroArquivo={meta ? n.id.replace(/^livro:/, "") : undefined} />}

      {meta && meta.vizinhos.length > 0 && (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-[var(--bl-text-dim)]">
            Vizinhos semânticos (kNN)
          </h3>
          <ul className="mt-2 space-y-1 text-[13px]">
            {meta.vizinhos.map((v) => (
              <li key={v.id}>
                <Link href={`/livro/${v.id}`} className="flex items-center gap-2 truncate rounded px-2 py-1 text-[var(--bl-text-secondary)] hover:bg-[var(--bl-bg-card-hover)]">
                  <span className="truncate">{v.titulo}</span>
                  <Badge className="ml-auto shrink-0">{(v.score * 100).toFixed(0)}%</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PainelAresta({ l, evid }: { l: Aresta; evid: Evid[] }) {
  const s = l.source as Nodo | string;
  const t = l.target as Nodo | string;
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-[var(--bl-text-dim)]">
        aresta ·{" "}
        <span style={{ color: COR[l.status] }}>
          {l.status === "confirmed" && "✓ confirmada (≥2 obras)"}
          {l.status === "claimed" && "alegada (1 obra)"}
          {l.status === "disputed" && "⚠ DISPUTADA — fontes se contradizem"}
        </span>
      </p>
      <p className="mt-1.5 font-medium leading-snug text-[var(--bl-text-primary)]">
        {typeof s === "object" ? s.label : s}{" "}
        <span className="text-[var(--bl-text-secondary)]">—{l.rel}→</span>{" "}
        {typeof t === "object" ? t.label : t}
      </p>
      <p className="mt-1 text-[var(--bl-text-dim)]">
        {l.n_fontes} fonte(s) · confiança média {l.peso}
      </p>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--bl-text-dim)]">
        De onde veio (evidências)
      </h3>
      <div className="mt-2 space-y-2">
        {evid.length === 0 && <p className="text-xs text-[var(--bl-text-muted)]">carregando…</p>}
        {evid.map((e, i) => (
          <div
            key={i}
            className="rounded border p-2.5 text-xs"
            style={{
              borderColor: e.clickup ? "rgba(155,109,214,.35)" : "var(--bl-border)",
              background: e.clickup ? "rgba(155,109,214,.09)" : "var(--bl-bg-card-solid)",
            }}
          >
            <p className="font-medium text-[var(--bl-text-primary)]">
              {e.clickup && <span style={{ color: COR.clickup }}>☑ ClickUp · </span>}
              {e.youtube && <span style={{ color: COR.canal }}>▶ {e.youtube.canal} · </span>}
              {e.livroId ? (
                <Link href={`/livro/${e.livroId}`} className="hover:underline">
                  {e.livroTitulo}
                </Link>
              ) : (
                e.livroTitulo
              )}
            </p>
            {e.clickup && (
              <p className="mt-0.5 text-[10px] text-[var(--bl-text-dim)]">
                {e.clickup.pasta} › {e.clickup.lista}
              </p>
            )}
            <p className="mt-0.5 font-mono text-[10px] text-[var(--bl-text-muted)]">
              chunk #{e.chunkIdx}
              {e.paginaEstimada ? ` · ~pág. ${e.paginaEstimada}` : ""} · confiança{" "}
              {e.confianca}
            </p>
            {e.trecho && (
              <p className="mt-1.5 border-l-2 border-[var(--bl-border-hover)] pl-2 leading-relaxed text-[var(--bl-text-secondary)]">
                …{cortaTexto(e.trecho, 260)}…
              </p>
            )}
            {e.clickup ? (
              <a
                href={e.clickup.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block rounded border px-2.5 py-1 text-[11px] font-medium hover:bg-[var(--bl-bg-card-hover)]"
                style={{ borderColor: "rgba(155,109,214,.5)", color: COR.clickup }}
              >
                ☑ abrir no ClickUp →
              </a>
            ) : e.youtube ? (
              <span className="mt-2 flex flex-wrap gap-1.5">
                <Link
                  href={`/colecao/${encodeURIComponent(e.youtube.canal)}/${encodeURIComponent(e.livro.replace(/^yt-[^:]+:/, ""))}?q=${encodeURIComponent(cortaTexto(e.trecho, 60))}`}
                  className="inline-block rounded border px-2.5 py-1 text-[11px] font-medium hover:bg-[var(--bl-bg-card-hover)]"
                  style={{ borderColor: "rgba(53,168,148,.5)", color: COR.canal }}
                >
                  📖 ler transcript no trecho →
                </Link>
                {e.youtube.url && (
                  <a
                    href={urlHttp(e.youtube.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block rounded border border-[var(--bl-border)] px-2.5 py-1 text-[11px] text-[var(--bl-text-secondary)] hover:bg-[var(--bl-bg-card-hover)]"
                  >
                    ▶ YouTube
                  </a>
                )}
              </span>
            ) : (
              e.livroId && (
                <Link
                  href={
                    e.formato === "pdf" && e.paginaEstimada
                      ? `/ler/${e.livroId}?page=${e.paginaEstimada}`
                      : `/ler/${e.livroId}?q=${encodeURIComponent(cortaTexto(e.trecho, 60))}`
                  }
                  className="mt-2 inline-block rounded border border-[var(--bl-border-accent)] bg-[var(--bl-bg-card-solid)] px-2.5 py-1 text-[11px] font-medium text-[var(--bl-text-primary)] hover:bg-[var(--bl-bg-card-hover)]"
                >
                  📖 ir pro trecho no livro →
                </Link>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Linha({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-[var(--bl-text-muted)]">{k}</dt>
      <dd className="text-[var(--bl-text-secondary)]">{v}</dd>
    </div>
  );
}

/** Chip de valor numérico (conexões, nº fontes, score) — diferenciação por
 *  forma+fundo, não só cor, pra não repetir o antipadrão "tudo cinza translúcido". */
function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-[var(--bl-border-1)] px-2 py-0.5 font-mono text-[10px] text-[var(--bl-text-muted)] ${className}`}
    >
      {children}
    </span>
  );
}

/* ── ⚡ Autolearning nivelado ───────────────────────────────────────
   Busca material NOVO do MESMO registro editorial das fontes do conceito
   (manual técnico puxa manual técnico; nunca apostila pra conceito acadêmico). */
type AutoResp = {
  ok: boolean;
  nivelAlvo?: string;
  nivelAlvoNome?: string;
  fontes?: { titulo: string; nivel: string }[];
  sugestoes?: { assunto: string; query: string; porque: string }[];
  buscaUrl?: string | null; // modelo com {query}; ausente = sem botão de busca
  persistido?: boolean; // false = as sugestões não puderam ser gravadas em disco
  geradoEm?: string;
  erro?: string;
};

export function Autolearn({
  conceito,
  livroArquivo,
}: {
  conceito?: string;
  livroArquivo?: string;
}) {
  const [estado, setEstado] = useState<"idle" | "carregando" | "pronto" | "erro">("idle");
  const [resp, setResp] = useState<AutoResp | null>(null);

  // buscas anteriores ficam SEMPRE ativas: ao abrir o nó, carrega o que já foi gerado
  useEffect(() => {
    let vivo = true;
    setEstado("idle");
    setResp(null);
    const qs = conceito
      ? `conceito=${encodeURIComponent(conceito)}`
      : `livroArquivo=${encodeURIComponent(livroArquivo ?? "")}`;
    fetch(`/api/autolearn?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AutoResp | null) => {
        if (vivo && d?.ok) {
          setResp(d);
          setEstado("pronto");
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [conceito, livroArquivo]);

  const rodar = useCallback(async () => {
    setEstado("carregando");
    try {
      const r = await fetch("/api/autolearn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceito, livroArquivo }),
      });
      const d = (await r.json()) as AutoResp;
      setResp(d);
      setEstado(d.ok ? "pronto" : "erro");
    } catch {
      setEstado("erro");
    }
  }, [conceito, livroArquivo]);

  return (
    <div className="mt-5">
      {estado === "idle" && (
        <button
          onClick={rodar}
          className="w-full rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-300/20 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
        >
          ⚡ autolearning — complementar no MESMO nível
        </button>
      )}
      {estado === "carregando" && (
        <p className="rounded-lg border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-3 py-2 text-xs text-[var(--bl-text-secondary)]">
          ⚡ analisando fontes e nível editorial… (~20-40s, LLM local)
        </p>
      )}
      {estado === "erro" && (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
          {resp?.erro === "modelo-nao-configurado"
            ? "autolearning sem modelo — defina BILHON_AUTOLEARN_MODEL (um modelo do seu Ollama) e tente de novo."
            : `motor local offline (${resp?.erro ?? "falha"}) — sobe o Ollama e tenta de novo.`}{" "}
          <button onClick={rodar} className="underline">retentar</button>
        </p>
      )}
      {estado === "pronto" && resp?.ok && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-200/80">
            ⚡ Complementar o grafo · nível: {resp.nivelAlvoNome}
          </h3>
          {resp.geradoEm && resp.persistido === false && (
            <p className="mt-0.5 text-[10px] text-[var(--bl-text-muted)]">
              ⚠ não foi possível salvar esta busca em disco — ela some ao fechar este nó
            </p>
          )}
          {resp.geradoEm && resp.persistido !== false && (
            <p className="mt-0.5 text-[10px] text-[var(--bl-text-muted)]">
              💾 salvo em{" "}
              {new Date(resp.geradoEm).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              — sempre disponível ao reabrir este nó
            </p>
          )}
          {resp.fontes && resp.fontes.length > 0 && (
            <p className="mt-1 text-[11px] text-[var(--bl-text-dim)]">
              calibrado por: {resp.fontes.slice(0, 3).map((f) => f.titulo).join(" · ")}
            </p>
          )}
          <div className="mt-2 space-y-2">
            {(resp.sugestoes ?? []).map((s, i) => (
              <div key={i} className="rounded border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-2.5 text-xs">
                <p className="font-medium text-[var(--bl-text-primary)]">{s.assunto}</p>
                <p className="mt-0.5 leading-relaxed text-[var(--bl-text-dim)]">{s.porque}</p>
                <div className="mt-1.5 flex gap-2">
                  {resp.buscaUrl && (
                    <a
                      href={resp.buscaUrl.split("{query}").join(encodeURIComponent(s.query))}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-[var(--bl-border)] bg-[var(--bl-bg-card-hover)] px-2.5 py-1 text-[11px] text-[var(--bl-text-primary)] hover:bg-[var(--bl-bg-card-hover)]"
                    >
                      🔍 buscar a obra →
                    </a>
                  )}
                  <Link
                    href={`/buscar?q=${encodeURIComponent(s.query)}`}
                    className="rounded border border-[var(--bl-border)] px-2.5 py-1 text-[11px] text-[var(--bl-text-secondary)] hover:bg-[var(--bl-bg-card-hover)]"
                    title="conferir se já não temos algo assim no acervo"
                  >
                    já temos?
                  </Link>
                </div>
              </div>
            ))}
            {(resp.sugestoes ?? []).length === 0 && (
              <p className="text-[var(--bl-text-dim)]">sem sugestões — tente outro nó.</p>
            )}
          </div>
          <button onClick={rodar} className="mt-2 text-[11px] text-[var(--bl-text-dim)] underline hover:text-[var(--bl-text-secondary)]">
            ↻ gerar de novo
          </button>
        </div>
      )}
    </div>
  );
}
