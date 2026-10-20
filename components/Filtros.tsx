"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

// cor por categoria de filtro (destaque no título + estado ativo dos itens)
export const COR_CAT = {
  fonte: { cor: "#c13584", rgb: "193,53,132" },
  tema: { cor: "#a855f7", rgb: "168,85,247" },
  dominios: { cor: "#5b8cff", rgb: "91,140,255" },
  colecoes: { cor: "#6bc950", rgb: "107,201,80" },
  origem: { cor: "#d4a853", rgb: "212,168,83" },
  perfis: { cor: "#d4a853", rgb: "212,168,83" },
} as const;

/** Seção recolhível — título em DESTAQUE colorido; injeta a cor da categoria como
 *  --bl-accent para os itens ativos herdarem (sem scroll interno). */
export function Secao({
  titulo,
  sub,
  cor,
  corRgb,
  defaultAberto = true,
  compact = false,
  children,
}: {
  titulo: string;
  sub?: string;
  cor: string;
  corRgb: string;
  defaultAberto?: boolean;
  /** versão reduzida (~30%) — usada no modal de ticket do kanban, que precisa caber na tela */
  compact?: boolean;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(defaultAberto);
  return (
    <div
      className={compact ? "mb-2.5" : "mb-4"}
      style={
        {
          "--bl-accent": cor,
          "--bl-accent-rgb": corRgb,
          "--bl-accent-dim": `rgba(${corRgb},0.15)`,
        } as React.CSSProperties
      }
    >
      <button
        onClick={() => setAberto((a) => !a)}
        className={`mb-1.5 flex w-full items-center gap-1 font-bold uppercase tracking-[0.06em] ${compact ? "text-[9px]" : "text-[12px]"}`}
        style={{ color: cor }}
      >
        <ChevronRight
          className={`transition-transform ${compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} ${aberto ? "rotate-90" : ""}`}
        />
        {titulo}
        {sub && (
          <span className="font-normal normal-case opacity-60"> {sub}</span>
        )}
      </button>
      {aberto && children}
    </div>
  );
}

/** Lista com top-N + "mostrar todos" (evita barra de rolagem). */
export function ListaExpansivel<T>({
  itens,
  topN,
  render,
}: {
  itens: T[];
  topN: number;
  render: (item: T) => React.ReactNode;
}) {
  const [todos, setTodos] = useState(false);
  const vis = todos ? itens : itens.slice(0, topN);
  return (
    <>
      {vis.map(render)}
      {itens.length > topN && (
        <button
          onClick={() => setTodos((t) => !t)}
          className="mt-1 block px-2 text-[11px] text-[var(--bl-accent)] hover:brightness-125"
        >
          {todos ? "recolher ▲" : `mostrar todos (${itens.length}) ▾`}
        </button>
      )}
    </>
  );
}

/** Linha de filtro compacta (rótulo + contagem), ativa na cor da seção. */
export function linhaCls(on: boolean) {
  return `flex w-full items-center gap-1.5 rounded-[var(--bl-radius-sm)] border-l-2 px-2 py-1 text-left text-sm ${
    on
      ? "bg-[var(--bl-accent-dim)] text-[var(--bl-accent)]"
      : "border-transparent text-[var(--bl-text-secondary)] hover:bg-[var(--bl-bg-card-hover)]"
  }`;
}
