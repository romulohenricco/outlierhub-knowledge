"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Copy, Check } from "lucide-react";
import type { Colecao, ItemColecao } from "@/lib/colecoes";
import type { EcoEntity } from "@/lib/types";

const COR_TIPO: Record<string, string> = {
  pessoa: "#35a894",
  playlist: "#35a894",
  clickup: "#9b6dd6",
  cursos: "#c07f28",
};
const ICONE: Record<string, string> = {
  pessoa: "👤",
  playlist: "📺",
  clickup: "☑",
  cursos: "📄",
};

export function ColecaoView({
  colecao,
  itens,
  atalho,
}: {
  colecao: Colecao;
  itens: ItemColecao[];
  atalho: EcoEntity | null;
}) {
  const [q, setQ] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);
  const cor = COR_TIPO[colecao.tipo] ?? "var(--bl-accent)";

  async function copiar(texto: string, chave: string) {
    await navigator.clipboard.writeText(texto);
    setCopiado(chave);
    setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1500);
  }

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return qn ? itens.filter((it) => it.titulo.toLowerCase().includes(qn)) : itens;
  }, [itens, q]);

  return (
    <div className="flex gap-8">
      <aside
        className="w-64 shrink-0"
        style={{ "--bl-accent": cor } as React.CSSProperties}
      >
        <Link
          href="/estante"
          className="mb-4 inline-block text-sm text-white/40 hover:text-white/80"
        >
          ← estante
        </Link>

        {/* identidade da coleção */}
        <div className="mb-4 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-4">
          <p
            className="text-[11px] font-bold uppercase tracking-[0.06em]"
            style={{ color: cor }}
          >
            {ICONE[colecao.tipo]} coleção · {colecao.tipo}
          </p>
          <h1 className="mt-1 text-lg font-semibold leading-tight">
            {colecao.nome}
          </h1>
          <p className="mt-1 font-mono text-[11px] text-[var(--bl-text-dim)]">
            {colecao.docs} itens · {colecao.chunks} chunks · tier {colecao.tier}
          </p>
        </div>

        {/* atalhos — entidade correspondente em /agente (skill/agent/squad/clone),
            se essa coleção veio de uma ingestão que já foi mapeada lá */}
        {atalho && (
          <div className="mb-4 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--bl-text-dim)]">
              atalhos
            </p>
            <div className="flex items-center justify-between gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2 py-1.5">
              <Link
                href={`/agente?q=${encodeURIComponent(atalho.id)}`}
                className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/70 hover:text-white"
                title="abrir no /agente, já filtrado"
              >
                {atalho.id}
              </Link>
              <button
                onClick={() => copiar(atalho.id, atalho.id)}
                className="shrink-0 text-white/30 hover:text-white/80"
                title="copiar id (colar em outro prompt/skill)"
              >
                {copiado === atalho.id ? (
                  <Check className="h-3.5 w-3.5 text-green-300" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* filtro de itens */}
        <div className="relative mb-4">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filtrar itens…"
            className="w-full rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-1.5 pl-8 pr-2 text-sm outline-none ring-1 ring-[var(--bl-border)] placeholder:text-white/25 focus:ring-[var(--bl-border-accent)]"
          />
        </div>

        {/* ações */}
        <Link
          href={`/buscar?q=${encodeURIComponent(colecao.nome)}`}
          className="mb-1.5 flex w-full items-center gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-2 py-1.5 text-sm text-[var(--bl-text-secondary)] hover:border-[var(--bl-border-hover)]"
        >
          <Search className="h-4 w-4" /> buscar no acervo
        </Link>
        <Link
          href="/grafo"
          className="flex w-full items-center gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-2 py-1.5 text-sm text-[var(--bl-text-secondary)] hover:border-[var(--bl-border-hover)]"
        >
          ⊕ ver o grafo
        </Link>
      </aside>

      <section className="min-w-0 flex-1">
        <p className="mb-4 text-xs text-white/40">
          {filtrados.length}/{itens.length} itens
        </p>
        <ul className="space-y-1.5">
          {filtrados.map((it) => (
            <li
              key={it.doc}
              className="flex items-center gap-3 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-4 py-2.5 hover:border-[var(--bl-border-hover)]"
            >
              <span className="shrink-0 text-sm" style={{ color: cor }}>
                {it.ehDna ? "🧬" : ICONE[colecao.tipo]}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-white/80">
                {it.titulo}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-white/25">
                {it.chunks} ch
              </span>
              <Link
                href={`/colecao/${encodeURIComponent(colecao.slug)}/${encodeURIComponent(it.doc)}`}
                className="shrink-0 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-solid)] px-2 py-1 text-[11px] text-white/80 hover:bg-[var(--bl-bg-card-hover)]"
                title="ler o transcript completo (local — independe do YouTube)"
              >
                📖 ler
              </Link>
              {it.youtubeUrl && (
                <a
                  href={it.youtubeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-2 py-1 text-[11px] text-white/60 hover:bg-[var(--bl-bg-card-hover)]"
                >
                  ▶ assistir
                </a>
              )}
              <Link
                href={`/grafo?focus=${encodeURIComponent(it.grafoFocus)}`}
                className="shrink-0 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-2 py-1 text-[11px] text-white/60 hover:bg-[var(--bl-bg-card-hover)]"
                title="ver este item no grafo"
              >
                ⊕ grafo
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
