"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Star, Zap, Network, Plug, BarChart3, Brain } from "lucide-react";
import type { Persona } from "@/lib/personas";
import { PersonaOrganograma } from "./PersonaOrganograma";

const num = (n: number) => String(n).padStart(2, "0");
const MONO = "font-[family-name:var(--bl-font-mono)]";

function Rotulo({ icone, children }: { icone: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`mb-2 flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.16em] text-[var(--bl-text-muted)] ${MONO}`}>
      {icone}
      {children}
    </div>
  );
}

/** Carrossel de personas: setas (botões e teclado ←/→), contador e chips numerados.
 *  Escrito só a partir do comportamento descrito em docs/personas.md. */
export function PersonasViewer({ personas }: { personas: Persona[] }) {
  const [i, setI] = useState(0);
  const total = personas.length;
  const ir = useCallback((d: number) => setI((v) => (v + d + total) % total), [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") ir(-1);
      else if (e.key === "ArrowRight") ir(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ir]);

  // filtro mudou o conjunto: volta ao início se o índice saiu do range
  useEffect(() => {
    setI((v) => (v >= total ? 0 : v));
  }, [total]);

  const p = personas[i];
  if (!p) return <p className="text-sm text-white/40">Nenhuma persona encontrada com esse filtro.</p>;

  return (
    <div className={MONO}>
      <style>{`@keyframes persona-entra{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>

      <div className="mb-4 flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-1.5">
          {([[-1, "Persona anterior", ChevronLeft], [1, "Próxima persona", ChevronRight]] as const).map(([d, rot, Ico]) => (
            <button
              key={d}
              type="button"
              aria-label={rot}
              onClick={() => ir(d)}
              className="flex h-9 w-9 items-center justify-center rounded border border-[var(--bl-border)] text-[var(--bl-text-secondary)] transition-colors hover:border-[var(--bl-border-hover)] hover:text-[var(--bl-text-primary)]"
            >
              <Ico className="h-4 w-4" />
            </button>
          ))}
        </div>
        <div className="min-w-0">
          <div className={`text-[11px] text-[var(--bl-text-muted)] ${MONO}`}>
            <span style={{ color: p.cor }}>{num(i + 1)}</span> / {num(total)}
          </div>
          <div className="truncate text-[13px] font-semibold text-[var(--bl-text-primary)]">{p.nome}</div>
        </div>
        <div role="group" aria-label="Escolher persona" className="ml-auto flex flex-wrap justify-end gap-1.5">
          {personas.map((q, k) => {
            const ativo = k === i;
            return (
              <button
                key={q.id}
                type="button"
                aria-label={`${num(k + 1)} ${q.nome}`}
                aria-current={ativo}
                onClick={() => setI(k)}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] transition-colors ${MONO} ${
                  ativo
                    ? "border-[var(--bl-border-hover)] text-[var(--bl-text-primary)]"
                    : "border-[var(--bl-border)] text-[var(--bl-text-muted)] hover:text-[var(--bl-text-secondary)]"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: ativo ? q.cor : "var(--bl-text-muted)" }} />
                {num(k + 1)}
              </button>
            );
          })}
        </div>
      </div>

      <div key={p.id} className={`w-full ${MONO}`} style={{ animation: "persona-entra .25s ease-out" }}>
        <article
          className="grid grid-cols-1 overflow-hidden rounded-lg xl:grid-cols-[58%_1fr] border border-[var(--bl-border)] bg-[var(--bl-bg-primary)]"
          style={{ borderTop: `2px solid ${p.cor}` }}
        >
          <div className="border-b border-[var(--bl-border)] bg-[var(--bl-bg-primary)] xl:col-start-1 xl:row-start-1">
            <PersonaOrganograma persona={p} />
          </div>

          <div className="border-b border-[var(--bl-border)] px-5 py-4 xl:col-start-1 xl:row-start-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-bold ${MONO}`} style={{ color: p.cor }}>{num(p.ordem)}</span>
                  <h2 className="text-[15px] font-bold text-[var(--bl-text-primary)]">{p.nome}</h2>
                </div>
                <div className="mt-0.5 text-[12px] text-[var(--bl-text-secondary)] [text-wrap:pretty]">{p.slogan}</div>
              </div>
              <span
                className={`shrink-0 rounded border px-2 py-0.5 text-[9.5px] uppercase tracking-[0.025em] ${MONO}`}
                style={{ color: p.cor, borderColor: p.cor }}
              >
                {p.arquetipo}
              </span>
            </div>

            <span
              className={`mt-3 inline-block rounded border border-[var(--bl-border)] px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--bl-text-muted)] ${MONO}`}
            >
              {p.origem}
            </span>

            <p className="mt-3 text-[12px] leading-relaxed text-[var(--bl-text-muted)] [text-wrap:pretty]">{p.resumo}</p>

            <div className="mt-3 flex items-start gap-2 rounded-md border border-[var(--bl-border)] bg-[var(--bl-bg-elevated)] px-3 py-2">
              <Star className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: p.cor }} />
              <div>
                <span className={`text-[9px] uppercase tracking-[0.16em] text-[var(--bl-text-muted)] ${MONO}`}>Estrela-guia</span>
                <div className="text-[12.5px] font-semibold text-[var(--bl-text-primary)]">{p.estrelaGuia}</div>
              </div>
            </div>
          </div>

          <div className="px-5 py-4 xl:col-span-2 xl:row-start-3">
            <Rotulo icone={<Network className="h-3 w-3" />}>Pilares · {p.pilares.length}</Rotulo>
            <div className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
              {p.pilares.map((pl) => (
                <div key={pl.nome} className="rounded-md border border-[var(--bl-border)] bg-[var(--bl-bg-elevated)] px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-[var(--bl-text-primary)]">{pl.nome}</span>
                    <span className={`truncate text-[10px] text-[var(--bl-text-muted)] ${MONO}`} title={pl.foco}>{pl.foco}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {pl.agentes.map((a) => (
                      <span
                        key={a}
                        className={`rounded border border-[var(--bl-border)] bg-[var(--bl-bg-primary)] px-1.5 py-0.5 text-[9.5px] ${MONO}`}
                        style={{ color: p.cor }}
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-start gap-4 border-t border-[var(--bl-border)] px-5 py-4 sm:grid-cols-2 xl:col-start-2 xl:row-start-1 xl:grid-cols-1 xl:border-b xl:border-l xl:border-t-0">
            <div>
              <Rotulo icone={<Plug className="h-3 w-3" />}>Conectores</Rotulo>
              <div className="flex flex-wrap gap-1.5">
                {p.conectores.map((c) => (
                  <span key={c} className={`rounded border border-[var(--bl-border)] bg-[var(--bl-bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--bl-text-secondary)] ${MONO}`}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <Rotulo icone={<BarChart3 className="h-3 w-3" />}>Métricas</Rotulo>
              <ul className="flex flex-col gap-1">
                {p.metricas.map((m) => (
                  <li key={m} className="flex items-baseline gap-1.5 text-[11.5px] text-[var(--bl-text-secondary)]">
                    <span className={MONO} style={{ color: p.cor }}>›</span>
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 border-t border-[var(--bl-border)] px-5 py-4 xl:col-start-2 xl:row-start-2 xl:border-l xl:border-t-0 xl:border-b">
            <div className="flex items-start gap-2">
              <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--bl-text-muted)]" />
              <p className="text-[11.5px] leading-relaxed text-[var(--bl-text-muted)] [text-wrap:pretty]">{p.memoria}</p>
            </div>
            <div
              className="flex items-start gap-2 rounded-md border px-3 py-2.5"
              style={{
                borderColor: `color-mix(in srgb, ${p.cor} 40%, transparent)`,
                background: `color-mix(in srgb, ${p.cor} 8%, var(--bl-bg-primary))`,
              }}
            >
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: p.cor }} />
              <div>
                <span className={`text-[9px] uppercase tracking-[0.16em] ${MONO}`} style={{ color: p.cor }}>Jogada-assinatura</span>
                <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--bl-text-primary)] [text-wrap:pretty]">{p.jogadaAssinatura}</p>
              </div>
            </div>

            {p.evidencias.length > 0 && (
              <div className="rounded-md border border-dashed border-[var(--bl-border)] px-3 py-2.5">
                <div className={`mb-1.5 text-[9px] uppercase tracking-[0.16em] text-[var(--bl-text-muted)] ${MONO}`}>Evidências</div>
                <ul className="flex flex-col gap-0.5">
                  {p.evidencias.map((e) => (
                    <li key={e} className={`flex items-baseline gap-1.5 text-[10px] text-[var(--bl-text-secondary)] ${MONO}`}>
                      <span>›</span>
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
