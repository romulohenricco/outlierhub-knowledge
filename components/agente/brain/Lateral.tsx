"use client";

/** Coluna direita: lentes, legenda (ícone + nome + contagem) e diretório agrupado. */
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Toggle } from "./Toggle";
import { ENTIDADES_LENTE, type ItemLegenda, type Lente } from "@/lib/brain/cena";
import type { GrupoItens, Item } from "@/lib/brain/indice";
import { IconeRedondo } from "./icones";

const TIPO_ICONE: Record<string, Parameters<typeof IconeRedondo>[0]["tipo"]> = {
  pilar: "pilar", agente: "agente", humano: "humano", tarefa: "tarefa", ferramenta: "ferramenta",
  squad: "squad", worker: "worker", skill: "skill", nota: "nota", outros: "squad",
};

const sel =
  "w-full rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-2 py-1.5 font-mono text-[11px] text-[var(--bl-text-primary)] outline-none focus:border-[var(--bl-border-accent)]";

const Rotulo = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--bl-text-dim)]">{children}</p>
);

const PASSO = 40;

export function Lateral({
  lente, onLente, funcoes, acoes, legenda, grupos, selId, onItem, onHover, ocultos, onToggleCamada,
}: {
  lente: Lente;
  onLente: (l: Lente) => void;
  funcoes: string[];
  acoes: string[];
  legenda: ItemLegenda[];
  /** camadas esmaecidas no grafo (ids da legenda) */
  ocultos: Set<string>;
  onToggleCamada: (id: string) => void;
  grupos: GrupoItens[];
  selId: string | null;
  onItem: (i: Item) => void;
  onHover: (id: string | null) => void;
}) {
  const [aberto, setAberto] = useState(true);
  const [vistos, setVistos] = useState<Record<string, number>>({});
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Rotulo>Lentes</Rotulo>
        <div className="space-y-2">
          <select aria-label="lente entidade" className={sel} value={lente.entidade} onChange={(e) => onLente({ ...lente, entidade: e.target.value })}>
            <option value="">Entidade · todas</option>
            {ENTIDADES_LENTE.map((o) => (
              <option key={o.id} value={o.id}>
                {o.rotulo}
              </option>
            ))}
          </select>
          <select aria-label="lente função" className={sel} value={lente.funcao} onChange={(e) => onLente({ ...lente, funcao: e.target.value })}>
            <option value="">Função · todas</option>
            {funcoes.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select aria-label="lente ação" className={sel} value={lente.acao} onChange={(e) => onLente({ ...lente, acao: e.target.value })}>
            <option value="">Ação · todas</option>
            {acoes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Rotulo>Legenda</Rotulo>
        <ul className="space-y-2">
          {legenda.map((l) => {
            const max = Math.max(1, ...legenda.map((x) => x.total));
            const ligada = !ocultos.has(l.id);
            return (
              <li key={l.id} className={`flex flex-col gap-1 text-[12px] ${ligada ? "text-[var(--bl-text-primary)]" : "text-[var(--bl-text-dim)]"}`}>
                <div className="flex items-center gap-2.5">
                  <IconeRedondo tipo={TIPO_ICONE[l.id] ?? "squad"} cor={ligada ? l.cor : "#6b7280"} />
                  <span>{l.rotulo}</span>
                  <span className="ml-auto font-mono text-[11px] text-[var(--bl-text-dim)]">{l.total}</span>
                  <Toggle ligado={ligada} onChange={() => onToggleCamada(l.id)} rotulo={l.rotulo.toLowerCase()} />
                </div>
                {/* barra proporcional ao total (gráfico de contagem por camada) */}
                <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--bl-border)]" aria-hidden>
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(l.total / max) * 100}%`, background: l.cor, opacity: ligada ? 0.85 : 0.25 }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-h-0 flex-col rounded-[var(--bl-radius-md)] border border-[var(--bl-border)]">
        <button
          onClick={() => setAberto((a) => !a)}
          className="flex items-center justify-between px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--bl-text-dim)]"
          aria-expanded={aberto}
        >
          Diretório
          <ChevronRight size={13} className={aberto ? "rotate-90 transition-transform" : "transition-transform"} />
        </button>
        {aberto && (
          <div className="max-h-[360px] overflow-y-auto border-t border-[var(--bl-border)] pb-1">
            {grupos.map((g) => {
              const n = vistos[g.id] ?? PASSO;
              return (
                <div key={g.id}>
                  <p className="sticky top-0 z-10 flex items-center gap-2 bg-[var(--bl-bg-card-solid)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--bl-text-secondary)]">
                    <IconeRedondo tipo={TIPO_ICONE[g.id] ?? "squad"} cor="currentColor" tamanho={14} />
                    {g.titulo}
                    <span className="ml-auto text-[var(--bl-text-dim)]">{g.itens.length}</span>
                  </p>
                  {g.itens.slice(0, n).map((i) => (
                    <button
                      key={i.id}
                      onClick={() => onItem(i)}
                      onMouseEnter={() => onHover(i.id)}
                      onMouseLeave={() => onHover(null)}
                      className={`flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-[var(--bl-bg-card-hover)] ${selId === i.id ? "bg-[var(--bl-bg-card-hover)]" : ""}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--bl-text-primary)]">{i.rotulo}</span>
                      <span className="max-w-[40%] shrink-0 truncate font-mono text-[10px] text-[var(--bl-text-dim)]">{i.sub}</span>
                    </button>
                  ))}
                  {g.itens.length > n && (
                    <button
                      onClick={() => setVistos((v) => ({ ...v, [g.id]: n + 120 }))}
                      className="w-full px-3 py-1 text-left font-mono text-[10.5px] text-[var(--bl-accent)] hover:underline"
                    >
                      mostrar mais ({g.itens.length - n})
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
