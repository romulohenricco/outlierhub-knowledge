"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  Ban,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDot,
  CircleOff,
  Cog,
  Copy,
  GitBranch,
  Ghost,
  HardHat,
  Search,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  Users,
  Workflow,
} from "lucide-react";
import { BRAIN_VAZIO, type BrainDados } from "@/lib/brain/tipos";
import type { EcoEntity, EcoKind, EcoProcedencia, EcoUsoStatus, Ecosystem } from "@/lib/types";
import { Secao } from "./Filtros";
import { usePagePanel } from "./PagePanel";
import { usePageTopbar } from "./PageTopbar";

// visões em grafo: bundle pesado (SVG/d3-force) só carrega quando alguém sai de "cards"
const EcoVisoes = dynamic(() => import("./agente/EcoVisoes").then((m) => m.EcoVisoes), {
  ssr: false,
  loading: () => <div className="h-[680px] animate-pulse rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)]" />,
});

type Visao = "cards" | "radial" | "neural";

/** Só existir já marca a página como canvas: o shell tira o recuo do conteúdo
 *  via CSS :has([data-canvas-page]) — vale no HTML do servidor e ao trocar de visão. */
function MarcaCanvas() {
  return <span data-canvas-page="" hidden />;
}
const VISOES: { id: Visao; rotulo: string }[] = [
  { id: "cards", rotulo: "Cards" },
  { id: "radial", rotulo: "Radial" },
  { id: "neural", rotulo: "Neural" },
];
const visaoValida = (v: string | null): Visao => (v === "radial" || v === "neural" ? v : "cards");

/**
 * Eixo de admissão: de quem é o item. Quem decide é a fonte (procedência declarada,
 * flag de terceiro ou owner fora da lista de owners próprios), não o namespace —
 * ver derivarProcedencia em lib/ecosystem.ts.
 */
const PROCEDENCIA_ORDER: EcoProcedencia[] = ["propria", "adotada", "terceiro"];

const PROCEDENCIA_META: Record<EcoProcedencia, { label: string; cls: string; ajuda: string }> = {
  propria: {
    label: "própria",
    cls: "bg-emerald-500/15 text-emerald-300",
    ajuda: "Item seu: veio da sua configuração e nenhuma regra o marcou como de fora.",
  },
  adotada: {
    label: "adotada",
    cls: "bg-amber-500/15 text-amber-300",
    ajuda: "Item de terceiro que você incorporou de propósito (declarado como adotada na fonte).",
  },
  terceiro: {
    label: "terceiro",
    cls: "bg-sky-500/15 text-sky-300",
    ajuda: "Conteúdo de fora, sem adoção: declarado como de terceiro, ou de um owner fora da sua lista.",
  },
};

const KIND_META: Record<
  EcoKind,
  { label: string; Icon: typeof Users; badge: string }
> = {
  squad: { label: "squad", Icon: Users, badge: "bl-badge-gold" },
  agent: { label: "agent", Icon: Bot, badge: "bl-badge-green" },
  skill: { label: "skill", Icon: Sparkles, badge: "bl-badge-purple" },
  workflow: { label: "workflow", Icon: Workflow, badge: "bl-badge-blue" },
  clone: { label: "clone", Icon: Copy, badge: "bl-badge-orange" },
  shadow: { label: "shadow", Icon: Ghost, badge: "bl-badge-ghost" },
  worker: { label: "worker", Icon: HardHat, badge: "bl-badge-cyan" },
  engine: { label: "engine", Icon: Cog, badge: "bl-badge-red" },
  repo: { label: "repo", Icon: GitBranch, badge: "bl-badge-gold" },
};

const KIND_ORDER: EcoKind[] = [
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

/**
 * Evidência de uso medida (vem de uso.json, quando existe). "sem sinal" NÃO é
 * "morto" — é "não achamos rastro": skill usada por linguagem natural, sem binário,
 * não deixa registro. O número é um piso, e o tooltip diz isso na cara.
 */
const USO_META: Record<
  EcoUsoStatus,
  { label: string; Icon: typeof Activity; cls: string; ajuda: string }
> = {
  frequente: {
    label: "frequente",
    Icon: Activity,
    cls: "bg-emerald-500/15 text-emerald-300",
    ajuda: "20+ na fonte mais forte (eventos de log, registros de sessão ou invocações)",
  },
  ocasional: {
    label: "ocasional",
    Icon: CircleDot,
    cls: "bg-sky-500/15 text-sky-300",
    ajuda: "5 a 19 na fonte mais forte",
  },
  raro: {
    label: "raro",
    Icon: Circle,
    cls: "bg-amber-500/15 text-amber-300",
    ajuda: "1 a 4 na fonte mais forte",
  },
  "sem-sinal": {
    label: "sem sinal",
    Icon: CircleOff,
    cls: "bg-white/[0.06] text-white/40",
    ajuda:
      "nenhum sinal nas 3 fontes consultadas. NÃO significa morto nem 'nunca usado': skill " +
      "invocada por linguagem natural ou por outra ferramenta não deixa rastro nestas " +
      "fontes. O correto é ler como USO DESCONHECIDO.",
  },
};

const USO_ORDER: EcoUsoStatus[] = ["frequente", "ocasional", "raro", "sem-sinal"];

/** Quantos cards pintar por vez. Ver comentário no estado `teto`. */
const TETO_INICIAL = 120;

type FavoritoEntry = { em: string };
type OcultoEntry = { em: string; motivo: string | null };

/** Leitura dupla: chave nova (e.id, tipada) OU legada (e.legacyId) —
 *  a escrita (toggle) sempre grava pelo id novo. */
function marcado(e: EcoEntity, estado: Record<string, unknown>): boolean {
  return e.id in estado || e.legacyId in estado;
}

export function Ecossistema({
  ecosystem,
  favoritos = {},
  ocultos = {},
  brain = BRAIN_VAZIO,
}: {
  ecosystem: Ecosystem;
  favoritos?: Record<string, FavoritoEntry>;
  ocultos?: Record<string, OcultoEntry>;
  /** Organização + notas (lidas no servidor pela page); vazio quando nada foi configurado. */
  brain?: BrainDados;
}) {
  const searchParams = useSearchParams();
  // ?q= inicial -> permite link direto já filtrado (ex.: /agente?q=<id>).
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  // ?visao= persistido na URL; "cards" (padrão) fica sem parâmetro
  const [visao, setVisaoState] = useState<Visao>(() => visaoValida(searchParams.get("visao")));
  const [kind, setKind] = useState<EcoKind | null>(null);
  const [procedencia, setProcedencia] = useState<EcoProcedencia | null>(null);
  const [uso, setUso] = useState<EcoUsoStatus | null>(null);
  const [squadId, setSquadId] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [favs, setFavs] = useState(favoritos);
  const [ocultosState, setOcultosState] = useState(ocultos);
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [verOcultos, setVerOcultos] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  /** Teto de cards no DOM. Com milhares de itens, renderizar tudo travava a aba.
   *  O filtro continua rodando sobre a lista INTEIRA — o teto é só de pintura. */
  const [teto, setTeto] = useState(TETO_INICIAL);

  function setVisao(v: Visao) {
    setVisaoState(v);
    const url = new URL(window.location.href);
    if (v === "cards") url.searchParams.delete("visao");
    else url.searchParams.set("visao", v);
    window.history.replaceState(null, "", url);
  }

  async function copiar(texto: string, chave: string) {
    await navigator.clipboard.writeText(texto);
    setCopiado(chave);
    setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1500);
  }

  /** undo via marcado() (dual-read): favorito gravado só sob legacyId também some.
   *  legacyId sempre vai junto — setFavoritoAgente apaga as duas chaves no undo. */
  async function toggleFavorito(e: EcoEntity) {
    const r = await fetch("/api/agente/favorito", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: e.id, legacyId: e.legacyId, undo: marcado(e, favs) }),
    });
    if (r.ok) setFavs((await r.json()).favoritos);
  }

    async function toggleOculto(e: EcoEntity, undo: boolean) {
    const r = await fetch("/api/agente/ocultar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: e.id, legacyId: e.legacyId, undo }),
    });
    if (r.ok) setOcultosState((await r.json()).ocultos);
  }

  const tags = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of ecosystem.entities) {
      if (kind && e.kind !== kind) continue;
      for (const t of e.tags) c.set(t, (c.get(t) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [ecosystem.entities, kind]);

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return ecosystem.entities.filter(
      (e) =>
        (verOcultos ? marcado(e, ocultosState) : !marcado(e, ocultosState)) &&
        (!soFavoritos || marcado(e, favs)) &&
        (!kind || e.kind === kind) &&
        (!procedencia || e.procedencia === procedencia) &&
        (!uso || e.uso?.status === uso) &&
        (!tag || e.tags.includes(tag)) &&
        (!squadId || e.squadId === squadId || e.id === squadId) &&
        (!qn ||
          e.nome.toLowerCase().includes(qn) ||
          e.descricao.toLowerCase().includes(qn) ||
          e.path.toLowerCase().includes(qn) ||
          e.id.toLowerCase().includes(qn)),
    );
  }, [ecosystem.entities, q, kind, procedencia, uso, tag, squadId, soFavoritos, favs, verOcultos, ocultosState]);

  // Recorte novo, teto zerado: senão o usuário filtra 12 itens e continua vendo
  // o "mostrar mais" de um recorte antigo.
  useEffect(() => {
    setTeto(TETO_INICIAL);
  }, [q, kind, procedencia, uso, tag, squadId, soFavoritos, verOcultos]);

  const usoCounts = useMemo(() => {
    const c = { frequente: 0, ocasional: 0, raro: 0, "sem-sinal": 0 } as Record<EcoUsoStatus, number>;
    let medidos = 0;
    for (const e of ecosystem.entities) {
      if (!e.uso) continue;
      c[e.uso.status]++;
      medidos++;
    }
    return { c, medidos };
  }, [ecosystem.entities]);

  const porId = useMemo(() => new Map(ecosystem.entities.map((e) => [e.id, e])), [ecosystem.entities]);
  const squadAtual = squadId ? porId.get(squadId) : null;
  const nOcultos = Object.keys(ocultosState).length;

  const escolherKind = (k: EcoKind | null) => {
    setKind(k);
    setTag(null);
  };

  const painel = useMemo(
    () => (
      <>
        <div className="relative mb-4">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filtrar por nome, id, descrição ou path…"
            className="w-full rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-1.5 pl-8 pr-2 text-sm outline-none ring-1 ring-[var(--bl-border)] placeholder:text-white/25 focus:ring-[var(--bl-border-accent)]"
          />
        </div>

        <button
          onClick={() => setSoFavoritos(!soFavoritos)}
          className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${soFavoritos ? "bg-[rgba(212,168,83,0.15)] text-[var(--bl-gold)]" : "text-[var(--bl-text-secondary)] hover:text-white/90"}`}
        >
          <Star className="h-4 w-4" fill={soFavoritos ? "currentColor" : "none"} />
          favoritos <span className="text-white/25">({Object.keys(favs).length})</span>
        </button>
        <button
          onClick={() => setVerOcultos(!verOcultos)}
          className={`mb-4 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${verOcultos ? "bg-red-500/20 text-red-200" : "text-[var(--bl-text-secondary)] hover:text-white/90"}`}
        >
          <Ban className="h-4 w-4" />
          ocultos <span className="text-white/25">({nOcultos})</span>
        </button>

        <Secao titulo="tipo" cor="#5b8cff" corRgb="91,140,255">
          <button
            onClick={() => escolherKind(null)}
            className={`mb-1 block w-full px-2 py-0.5 text-left text-sm ${!kind ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
          >
            todos os tipos
          </button>
          <div className="flex flex-wrap gap-1">
            {KIND_ORDER.map((k) => {
              const m = KIND_META[k];
              return (
                <button
                  key={k}
                  onClick={() => escolherKind(kind === k ? null : k)}
                  className={`bl-badge ${kind === k ? m.badge : "bl-badge-ghost"}`}
                >
                  <m.Icon className="h-3 w-3" />
                  {m.label} <span className="opacity-50">{ecosystem.counts[k] ?? 0}</span>
                </button>
              );
            })}
          </div>
        </Secao>

        <Secao titulo="procedência" cor="#c9b79c" corRgb="201,183,156">
          <button
            onClick={() => setProcedencia(null)}
            className={`mb-1 block w-full px-2 py-0.5 text-left text-sm ${!procedencia ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
          >
            tudo
          </button>
          <div className="flex flex-wrap gap-1">
            {PROCEDENCIA_ORDER.map((p) => {
              const pm = PROCEDENCIA_META[p];
              return (
                <button
                  key={p}
                  onClick={() => setProcedencia(procedencia === p ? null : p)}
                  title={pm.ajuda}
                  className={`bl-badge ${procedencia === p ? pm.cls : "bl-badge-ghost"}`}
                >
                  {pm.label}{" "}
                  <span className="opacity-50">{ecosystem.countsPorProcedencia?.[p] ?? 0}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 px-2 text-[10px] leading-snug text-white/30">
            eixo de admissão: própria é o que você configurou como seu; adotada é de terceiro
            incorporada de propósito (declarada na fonte); terceiro é conteúdo de fora, sem adoção.
          </p>
        </Secao>

        {usoCounts.medidos > 0 && (
          <Secao titulo="evidência de uso" cor="#4ade80" corRgb="74,222,128">
            <button
              onClick={() => setUso(null)}
              className={`mb-1 block w-full px-2 py-0.5 text-left text-sm ${!uso ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
            >
              qualquer uso
            </button>
            <div className="flex flex-wrap gap-1">
              {USO_ORDER.map((s) => {
                const um = USO_META[s];
                return (
                  <button
                    key={s}
                    onClick={() => setUso(uso === s ? null : s)}
                    title={um.ajuda}
                    className={`bl-badge ${uso === s ? um.cls : "bl-badge-ghost"}`}
                  >
                    <um.Icon className="h-3 w-3" />
                    {um.label} <span className="opacity-50">{usoCounts.c[s]}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-2 text-[10px] leading-snug text-white/30">
              observado em {usoCounts.medidos} componentes cruzando log de execução, registros
              de sessão e invocações. Sinais não são somados (unidades diferentes); o status vem
              do mais forte. &quot;sem sinal&quot; = uso desconhecido, não morto.
            </p>
          </Secao>
        )}

        {tags.length > 0 && (
          <Secao titulo="tags" cor="#d4a853" corRgb="212,168,83">
            <div className="flex flex-wrap gap-1">
              {tags.map(([t, n]) => (
                <button
                  key={t}
                  onClick={() => setTag(tag === t ? null : t)}
                  className={`bl-badge ${tag === t ? "bl-badge-accent" : "bl-badge-ghost"}`}
                >
                  {t} <span className="opacity-50">{n}</span>
                </button>
              ))}
            </div>
          </Secao>
        )}
      </>
    ),
    [q, kind, procedencia, uso, usoCounts, tag, tags, ecosystem.counts, ecosystem.countsPorProcedencia, soFavoritos, favs, verOcultos, nOcultos],
  );
  usePagePanel(painel);

  // abas Cards | Radial | Neural moram na topbar do app (slot usePageTopbar)
  const visaoRef = useRef(setVisao);
  visaoRef.current = setVisao;
  const abas = useMemo(
    () => (
      <div className="flex items-center gap-1" role="tablist" aria-label="visão do ecossistema">
        {VISOES.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={visao === v.id}
            onClick={() => visaoRef.current(v.id)}
            className={`rounded-[var(--bl-radius-sm)] border px-2.5 py-1 font-mono text-[11px] transition-colors ${visao === v.id ? "border-[var(--bl-border-accent)] text-[var(--bl-accent)]" : "border-[var(--bl-border)] text-[var(--bl-text-dim)] hover:text-[var(--bl-text-secondary)]"}`}
          >
            {v.rotulo}
          </button>
        ))}
      </div>
    ),
    [visao],
  );
  usePageTopbar(abas);

  const aoAbrirCard = (e: EcoEntity) => {
    setQ(e.id);
    setAberto(e.id);
    setVisao("cards");
  };

  // Radial e Neural são página de canvas: grafo de borda a borda, menus flutuando por cima
  if (visao !== "cards") {
    return (
      <>
        <MarcaCanvas />
        <EcoVisoes
          entities={filtrados}
          totalEntidades={ecosystem.entities.length}
          brain={brain}
          visao={visao}
          onAbrirCard={aoAbrirCard}
          filtroSquad={squadAtual ? { nome: squadAtual.nome, limpar: () => setSquadId(null) } : null}
        />
      </>
    );
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Agente · inventário</h1>
        <p className="mt-1 text-xs text-white/40">
          squads, agents, skills, workflows, clones, shadows, workers, engines e repos ·{" "}
          {ecosystem.entities.length} entidades · {ecosystem.countsPorProcedencia.propria} próprias ·{" "}
          {ecosystem.countsPorProcedencia.adotada} adotadas · {ecosystem.countsPorProcedencia.terceiro} de terceiros
        </p>
      </div>
      <p className="mb-4 text-xs text-white/40">
        {verOcultos && <span className="mr-2 text-red-300">ocultos do mapa ·</span>}
        {filtrados.length}/{ecosystem.entities.length} entidades
      </p>

      {squadAtual && (
        <div className="mb-4 flex items-center gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-3 py-2 text-xs text-[var(--bl-text-secondary)]">
          filtrando workers de <strong className="text-white/85">{squadAtual.nome}</strong>
          <button onClick={() => setSquadId(null)} className="ml-auto text-white/40 hover:text-white/80">
            limpar ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] items-start gap-3">
        {filtrados.slice(0, teto).map((e) => {
          const m = KIND_META[e.kind];
          const clicavel = e.kind === "squad";
          const favoritado = marcado(e, favs);
          const oculto = marcado(e, ocultosState);
          const expandido = aberto === e.id;
          const camposMeta = Object.entries(e.meta).filter(
            ([, v]) => v !== null && v !== undefined && v !== "",
          );
          return (
            <div
              key={e.id}
              onClick={
                clicavel
                  ? () => {
                      setSquadId(squadId === e.id ? null : e.id);
                      escolherKind(null);
                    }
                  : undefined
              }
              className={`group rounded-[var(--bl-radius-md)] border bg-[var(--bl-bg-card-solid)] p-3.5 shadow-[var(--bl-shadow-sm)] transition hover:bg-[var(--bl-bg-card-hover)] ${oculto ? "border-red-500/30 opacity-80" : "border-[var(--bl-border)] hover:border-[var(--bl-border-hover)]"} ${clicavel ? "cursor-pointer" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1">
                  <span className={`bl-badge ${m.badge}`}>
                    <m.Icon className="h-3 w-3" />
                    {m.label}
                    {e.subtype ? ` · ${e.subtype}` : ""}
                  </span>
                  {e.uso && (
                    <span
                      className={`bl-badge ${USO_META[e.uso.status].cls}`}
                      title={`${USO_META[e.uso.status].ajuda}\n\n${e.uso.fontes.join("\n")}`}
                    >
                      {(() => {
                        const UIcon = USO_META[e.uso.status].Icon;
                        return <UIcon className="h-3 w-3" />;
                      })()}
                      {USO_META[e.uso.status].label}
                      {e.uso.sinais > 0 ? ` · ${e.uso.sinais}/3 fontes` : ""}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      toggleFavorito(e);
                    }}
                    className={favoritado ? "text-[var(--bl-gold)]" : "text-white/30 hover:text-[var(--bl-gold)]"}
                    title={favoritado ? "remover dos favoritos" : "favoritar"}
                  >
                    <Star className="h-3.5 w-3.5" fill={favoritado ? "currentColor" : "none"} />
                  </button>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      copiar(e.path, e.id);
                    }}
                    className="text-white/30 hover:text-white/80"
                    title="copiar path (colar no terminal)"
                  >
                    {copiado === e.id ? (
                      <Check className="h-3.5 w-3.5 text-green-300" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {oculto ? (
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        toggleOculto(e, true);
                      }}
                      className="text-white/30 hover:text-green-300"
                      title="restaurar no mapa"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        toggleOculto(e, false);
                      }}
                      className="text-white/30 hover:text-red-300"
                      title="ocultar do mapa (reversível — não apaga o arquivo real)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </div>

              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  setAberto(expandido ? null : e.id);
                }}
                className="mt-2 flex w-full items-start justify-between gap-2 text-left"
                title={expandido ? "recolher detalhes" : "ver todos os detalhes"}
              >
                <span className="text-[13px] font-medium text-white/85">{e.nome}</span>
                {expandido ? (
                  <ChevronUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/30" />
                ) : (
                  <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/30" />
                )}
              </button>

              <p
                className={`mt-1 text-[11.5px] leading-snug text-[var(--bl-text-dim)] ${expandido ? "" : "line-clamp-3"}`}
              >
                {e.descricao || "(sem descrição na fonte)"}
              </p>

              {e.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {e.tags.map((t) => (
                    <span key={t} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] text-white/40">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {!expandido && (
                <p className="mt-2 truncate font-mono text-[9.5px] text-white/25" title={e.path}>
                  {e.path}
                </p>
              )}

              {expandido && (
                <div
                  className="mt-3 space-y-2 border-t border-[var(--bl-border)] pt-3"
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
                    <span className="text-white/30">origem</span>
                    <span className="break-words text-white/60">{e.origem}</span>

                    <span className="text-white/30">path</span>
                    <button
                      onClick={() => copiar(e.path, e.id)}
                      className="break-all text-left font-mono text-white/60 hover:text-white/90"
                      title="copiar path"
                    >
                      {e.path}
                    </button>

                    {e.squadId && (
                      <>
                        <span className="text-white/30">squad</span>
                        <button
                          onClick={() => {
                            setSquadId(e.squadId!);
                            escolherKind(null);
                          }}
                          className="text-left text-[var(--bl-accent)] hover:underline"
                        >
                          {porId.get(e.squadId)?.nome ?? e.squadId}
                        </button>
                      </>
                    )}

                    {camposMeta.map(([k, v]) => (
                      <Fragment key={k}>
                        <span className="text-white/30">{k.replace(/_/g, " ")}</span>
                        <span className="break-words text-white/60">{String(v)}</span>
                      </Fragment>
                    ))}

                    <span className="text-white/30">id</span>
                    <span className="break-all font-mono text-white/40">{e.id}</span>
                  </div>

                  {e.uso && (
                    <div className="mt-3 border-t border-[var(--bl-border)] pt-3">
                      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-white/30">
                        evidência de uso
                      </p>
                      <ul className="space-y-1">
                        {e.uso.fontes.map((f) => (
                          <li key={f} className="text-[11px] leading-snug text-white/55">
                            · {f}
                          </li>
                        ))}
                      </ul>
                      {e.uso.proveniencia === "incerta" && (
                        <p className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-snug text-amber-200/80">
                          Proveniência INCERTA: esta skill é exercitada por teste automatizado,
                          então parte do volume acima pode não ser uso. O log de execução não
                          permite separar teste de uso — o número NÃO foi ajustado, porque
                          chutar seria pior.
                        </p>
                      )}
                      {e.uso.status === "sem-sinal" && (
                        <p className="mt-2 rounded bg-white/[0.04] px-2 py-1.5 text-[10.5px] leading-snug text-white/45">
                          Sem sinal não é o mesmo que sem uso. Componente sem binário, invocado
                          por linguagem natural ou por outra ferramenta, é invisível para a
                          medição atual. Leia como USO DESCONHECIDO. Nada foi apagado: isto é
                          documentação, não veredito.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtrados.length > teto && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => setTeto((t) => t + TETO_INICIAL)}
            className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-4 py-2 text-sm text-[var(--bl-text-secondary)] hover:text-white/90"
          >
            mostrar mais {Math.min(TETO_INICIAL, filtrados.length - teto)} ·{" "}
            <span className="text-white/40">{filtrados.length - teto} restantes</span>
          </button>
        </div>
      )}

      {filtrados.length === 0 && (
        <p className="mt-10 text-center text-sm text-white/30">
          {ecosystem.entities.length === 0
            ? "o inventário está vazio: veja as abas Radial e Neural para a organização e as notas."
            : "nada encontrado com esses filtros."}
        </p>
      )}
    </section>
  );
}
