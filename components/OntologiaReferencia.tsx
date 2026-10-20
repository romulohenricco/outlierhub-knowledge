import type { Regra } from "@/lib/ontologia";
import { montarCardsReferencia, type NoRef } from "@/lib/ontologia-referencia";

/**
 * Modelo de referência — um card por camada do arquivo: código, rótulo, descrição
 * e os itens de primeiro nível com a contagem do que há embaixo, seguido das
 * `regras` do arquivo. Tudo vem do arquivo do usuário. Server component, só leitura.
 */
export default function OntologiaReferencia({ nodes, regras = [] }: { nodes: NoRef[]; regras?: Regra[] }) {
  const cards = montarCardsReferencia(nodes);
  if (!cards.length && !regras.length) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--bl-text-dim)]">
        modelo de referência <span className="normal-case">— as suas camadas e o que mora em cada uma</span>
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {cards.map((c) => (
          <article
            key={c.id}
            className="flex flex-col rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-4"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-xs font-semibold" style={{ color: c.cor }}>
                {c.codigo}
              </span>
              <span className="font-mono text-[10px] text-[var(--bl-text-dim)]">{c.total} itens</span>
            </div>
            {/* h3 é laranja no tema: a cor primária é forçada de propósito */}
            <h3 className="mt-2 text-sm font-semibold !text-[var(--bl-text-primary)]">{c.titulo}</h3>
            <p className="mt-1 line-clamp-2 min-h-[2lh] text-[11px] text-[var(--bl-text-secondary)]">
              {c.resumo}
            </p>
            <ul className="mt-3 space-y-1.5">
              {c.itens.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2.5 py-1.5"
                >
                  <span className="min-w-0 truncate font-mono text-[11px] text-[var(--bl-text-secondary)]">
                    {i.label}
                  </span>
                  {i.descendentes > 0 && (
                    <span className="shrink-0 font-mono text-[10px] text-[var(--bl-text-dim)]">
                      {i.descendentes}
                    </span>
                  )}
                </li>
              ))}
              {c.resto > 0 && (
                <li className="px-1 font-mono text-[10px] text-[var(--bl-text-muted)]">
                  +{c.resto} no grafo
                </li>
              )}
            </ul>
          </article>
        ))}
      </div>
      {regras.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] !text-[var(--bl-text-dim)]">regras</h3>
          <ul className="grid gap-2 md:grid-cols-2">
            {regras.map((r) => (
              <li
                key={r.id}
                className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-3"
              >
                <p className="text-sm font-semibold">{r.titulo}</p>
                {r.descricao ? (
                  <p className="mt-1 text-[11px] text-[var(--bl-text-secondary)]">{r.descricao}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
