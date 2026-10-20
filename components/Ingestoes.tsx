"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { Colecao } from "@/lib/colecoes";
import { Secao, COR_CAT } from "./Filtros";
import { usePagePanel } from "./PagePanel";
import { PersonasViewer } from "./PersonasViewer";
import type { EstadoPersonas, Persona } from "@/lib/personas";
import { FILTRO_VAZIO, facetasPersonas, filtrarPersonas, type FiltroPersonas } from "@/lib/personas-filtro";

const COR_TIPO: Record<string, string> = {
  pessoa: "#35a894",
  playlist: "#35a894",
  clickup: "#9b6dd6",
  cursos: "#c07f28",
};
const ICONE_TIPO: Record<string, string> = {
  pessoa: "👤",
  playlist: "📺",
  clickup: "☑",
  cursos: "📄",
};

type Aba = "colecoes" | "personas";

/** O que dizer na aba Personas quando não há nenhuma para mostrar. */
const AVISO_PERSONAS: Record<EstadoPersonas, string> = {
  "nao-configurada": "Nenhuma persona configurada ainda.",
  ausente: "O arquivo apontado por BILHON_PERSONAS_JSON não existe.",
  "fora-da-raiz": "O arquivo apontado por BILHON_PERSONAS_JSON está fora de BILHON_ROOT e não foi lido.",
  "grande-demais": "O arquivo apontado por BILHON_PERSONAS_JSON é grande demais (limite de 1 MB).",
  invalida: "O arquivo apontado por BILHON_PERSONAS_JSON não é um JSON válido.",
  ok: "O arquivo foi lido, mas nenhuma persona passou na validação.",
};

export function Ingestoes({
  colecoes,
  personas = [],
  estadoPersonas = "nao-configurada",
  personasDescartadas = 0,
  abaInicial = "colecoes",
}: {
  colecoes: Colecao[];
  personas?: Persona[];
  estadoPersonas?: EstadoPersonas;
  personasDescartadas?: number;
  abaInicial?: Aba;
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState<string | null>(null);
  const [dominio, setDominio] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);

  const [fp, setFp] = useState<FiltroPersonas>(FILTRO_VAZIO);
  const setF = (k: keyof FiltroPersonas, v: string | null) => setFp((o) => ({ ...o, [k]: v }) as FiltroPersonas);
  const facetas = useMemo(() => facetasPersonas(personas), [personas]);
  const personasFiltradas = useMemo(() => filtrarPersonas(personas, fp), [personas, fp]);

  const painelPersonas = useMemo(() => {
    const secoes: [Exclude<keyof FiltroPersonas, "q">, string, string, string, string, number][] = [
      ["origem", "origem", "todas as origens", COR_CAT.origem.cor, COR_CAT.origem.rgb, 99],
      ["arquetipo", "arquétipo", "todos os arquétipos", COR_CAT.tema.cor, COR_CAT.tema.rgb, 99],
      ["conector", "conector", "todos os conectores", COR_CAT.dominios.cor, COR_CAT.dominios.rgb, 12],
      ["pilar", "pilar", "todos os pilares", COR_CAT.colecoes.cor, COR_CAT.colecoes.rgb, 12],
    ];
    return (
      <>
        <div className="relative mb-3">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-white/30" />
          <input
            value={fp.q}
            onChange={(e) => setF("q", e.target.value)}
            placeholder="filtrar por nome…"
            className="w-full rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-1.5 pl-8 pr-2 text-sm outline-none ring-1 ring-[var(--bl-border)] placeholder:text-white/25 focus:ring-[var(--bl-border-accent)]"
          />
        </div>
        {secoes.map(([k, titulo, todos, cor, rgb, topN]) => {
          const val = fp[k];
          const itens = facetas[k];
          if (itens.length === 0) return null;
          return (
            <Secao key={k} titulo={titulo} cor={cor} corRgb={rgb}>
              <button
                onClick={() => setF(k, null)}
                className={`mb-1 block w-full px-2 py-0.5 text-left text-sm ${!val ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
              >
                {todos}
              </button>
              <div className="flex flex-wrap gap-1">
                {itens.slice(0, topN).map(([v, n]) => (
                  <button
                    key={v}
                    onClick={() => setF(k, val === v ? null : v)}
                    className={`bl-badge max-w-full whitespace-normal text-left ${val === v ? "bl-badge-accent" : "bl-badge-ghost"}`}
                  >
                    {v} <span className="opacity-50">{n}</span>
                  </button>
                ))}
              </div>
            </Secao>
          );
        })}
      </>
    );
  }, [fp, facetas]);

  const tipos = useMemo(() => {
    const c = new Map<string, number>();
    for (const col of colecoes) c.set(col.tipo, (c.get(col.tipo) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [colecoes]);

  const dominios = useMemo(() => {
    const c = new Map<string, number>();
    for (const col of colecoes) if (col.dominio) c.set(col.dominio, (c.get(col.dominio) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [colecoes]);

  const tiers = useMemo(() => {
    const c = new Map<string, number>();
    for (const col of colecoes) c.set(col.tier, (c.get(col.tier) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [colecoes]);

  const filtradas = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return colecoes.filter(
      (c) =>
        (!tipo || c.tipo === tipo) &&
        (!dominio || c.dominio === dominio) &&
        (!tier || c.tier === tier) &&
        (!qn || c.nome.toLowerCase().includes(qn)),
    );
  }, [colecoes, q, tipo, dominio, tier]);

  const painel = useMemo(
    () => (
      <>
        <div className="relative mb-3">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filtrar por título…"
            className="w-full rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-1.5 pl-8 pr-2 text-sm outline-none ring-1 ring-[var(--bl-border)] placeholder:text-white/25 focus:ring-[var(--bl-border-accent)]"
          />
        </div>
        <Link
          href="/buscar"
          className="mb-4 flex w-full items-center gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-2 py-1.5 text-sm text-[var(--bl-text-secondary)] hover:border-[var(--bl-border-hover)]"
        >
          <Search className="h-4 w-4" /> busca semântica
        </Link>

        {/* TIPO */}
        <Secao titulo="tipo" cor={COR_CAT.colecoes.cor} corRgb={COR_CAT.colecoes.rgb}>
          <button
            onClick={() => setTipo(null)}
            className={`mb-1 block w-full px-2 py-0.5 text-left text-sm ${!tipo ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
          >
            todos os tipos
          </button>
          <div className="flex flex-wrap gap-1">
            {tipos.map(([t, n]) => (
              <button
                key={t}
                onClick={() => setTipo(tipo === t ? null : t)}
                className={`bl-badge ${tipo === t ? "bl-badge-accent" : "bl-badge-ghost"}`}
              >
                {ICONE_TIPO[t] ?? ""} {t} <span className="opacity-50">{n}</span>
              </button>
            ))}
          </div>
        </Secao>

        {/* DOMÍNIO (ontologia) — só existe pra quem tem o sidecar de ontologia */}
        {dominios.length > 0 && (
          <Secao
            titulo="domínio"
            sub="(ontologia)"
            cor={COR_CAT.dominios.cor}
            corRgb={COR_CAT.dominios.rgb}
          >
            <button
              onClick={() => setDominio(null)}
              className={`mb-1 block w-full px-2 py-0.5 text-left text-sm ${!dominio ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
            >
              todos os domínios
            </button>
            <div className="flex flex-wrap gap-1">
              {dominios.map(([d, n]) => (
                <button
                  key={d}
                  onClick={() => setDominio(dominio === d ? null : d)}
                  className={`bl-badge ${dominio === d ? "bl-badge-accent" : "bl-badge-ghost"}`}
                >
                  {d} <span className="opacity-50">{n}</span>
                </button>
              ))}
            </div>
          </Secao>
        )}

        {/* TIER (proveniência) */}
        <Secao titulo="tier" sub="(proveniência)" cor={COR_CAT.origem.cor} corRgb={COR_CAT.origem.rgb}>
          <button
            onClick={() => setTier(null)}
            className={`mb-1 block w-full px-2 py-0.5 text-left text-sm ${!tier ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
          >
            todos os tiers
          </button>
          <div className="flex flex-wrap gap-1">
            {tiers.map(([t, n]) => (
              <button
                key={t}
                onClick={() => setTier(tier === t ? null : t)}
                className={`bl-badge ${tier === t ? "bl-badge-accent" : "bl-badge-ghost"}`}
              >
                {t} <span className="opacity-50">{n}</span>
              </button>
            ))}
          </div>
        </Secao>
      </>
    ),
    [q, tipo, dominio, tier, tipos, dominios, tiers],
  );
  usePagePanel(aba === "colecoes" ? painel : painelPersonas);

  return (
    <section>
      <h1 className="mb-1 text-lg font-medium text-white/90">Ingestões</h1>
      <p className="mb-4 text-xs text-white/40">
        Tudo que virou conhecimento buscável — fontes ingeridas (YouTube, artigo,
        imagem, Instagram/TikTok/X, curso) ou importadas em lote. Mais recente
        primeiro.
      </p>
      <div role="tablist" aria-label="Seções de ingestões" className="mb-4 flex gap-1 border-b border-[var(--bl-border)]">
        {(
          [
            ["colecoes", `Coleções · ${colecoes.length}`],
            ["personas", `Personas · ${personas.length}`],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            role="tab"
            aria-selected={aba === id}
            onClick={() => setAba(id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
              aba === id
                ? "border-[var(--bl-accent)] text-[var(--bl-accent)]"
                : "border-transparent text-[var(--bl-text-dim)] hover:text-white/70"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === "personas" ? (
        <div role="tabpanel">
          <p className="mb-4 text-xs text-white/40">
            Perfis de operador da sua configuração: pilares, agentes, conectores e métricas de cada um.
          </p>
          {personas.length === 0 ? (
            <div className="rounded-[var(--bl-radius-md)] border border-dashed border-[var(--bl-border)] p-4 text-sm text-white/50">
              <p>{AVISO_PERSONAS[estadoPersonas]}</p>
              <p className="mt-2 text-xs text-white/40">
                Aponte BILHON_PERSONAS_JSON para um JSON dentro de BILHON_ROOT com a lista de personas
                (formato e exemplo em docs/personas.md) e recarregue a página.
              </p>
            </div>
          ) : (
            <>
              {personasDescartadas > 0 && (
                <p className="mb-3 text-xs text-white/40">
                  {personasDescartadas} item(ns) do arquivo foram ignorados por não seguirem o formato.
                </p>
              )}
              <PersonasViewer personas={personasFiltradas} />
            </>
          )}
        </div>
      ) : (
      <>
      <p className="mb-4 text-xs text-white/40">
        {filtradas.length}/{colecoes.length} fontes
      </p>

      {filtradas.length === 0 ? (
        <p className="text-sm text-white/40">
          {colecoes.length === 0
            ? "Nenhuma fonte configurada ainda: as coleções ficam em data/colecoes-external (formato em docs/dados.md)."
            : "Nenhuma ingestão encontrada com esse filtro."}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {filtradas.map((c) => (
            <Link
              key={c.slug}
              href={`/colecao/${encodeURIComponent(c.slug)}`}
              className="group rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-3.5 shadow-[var(--bl-shadow-sm)] transition hover:border-[var(--bl-border-hover)] hover:bg-[var(--bl-bg-card-hover)]"
            >
              <div className="flex items-start justify-between">
                <span className="text-xl">{ICONE_TIPO[c.tipo]}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    color: COR_TIPO[c.tipo],
                    background: `${COR_TIPO[c.tipo]}1a`,
                  }}
                >
                  {c.docs} itens
                </span>
              </div>
              <p className="mt-2 truncate text-[13px] font-medium text-white/85 group-hover:text-white">
                {c.nome}
              </p>
              <p className="mt-0.5 text-[10.5px] text-white/35">
                {c.tipo} · {c.chunks} chunks · tier {c.tier}
                {c.dominio && <span className="ml-1 text-[var(--bl-accent)]/70">· {c.dominio}</span>}
              </p>
            </Link>
          ))}
        </div>
      )}
      </>
      )}
    </section>
  );
}
