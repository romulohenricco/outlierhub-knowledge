"use client";

/**
 * Painel lateral de detalhe do nó, em seções: cabeçalho fixo, corpo rolável, rodapé fixo
 * com o botão que abre o Raio-X. O contêiner (posição/gaveta mobile) fica no canvas.
 */
import { ArrowDownRight, ArrowUpRight, ScanLine, X } from "lucide-react";
import type { OntNo, OntRel } from "@/lib/ontologia-grafo";
import { fatosDoPainel, linhasRelacao, relacoesDoNo, tipoDoNo } from "@/lib/ontologia-raiox";
import { ICONE } from "./icones";

const MAX_LINHAS_REL = 8;

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--bl-border)] px-4 py-3 first:border-t-0">
      <h4 className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--bl-text-muted)]">{titulo}</h4>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--bl-text-muted)]">{rotulo}</p>
      <div className="mt-0.5 break-words text-[13px] text-[var(--bl-text-secondary)]">{children}</div>
    </div>
  );
}

export default function PainelNo({
  no,
  porId,
  filhosDe,
  links,
  onSel,
  onFechar,
  onAbrirRaioX,
  botaoRaioXRef,
}: {
  no: OntNo;
  porId: Map<string, OntNo>;
  filhosDe: Map<string, OntNo[]>;
  links: OntRel[];
  onSel: (id: string) => void;
  onFechar: () => void;
  onAbrirRaioX: () => void;
  botaoRaioXRef?: React.Ref<HTMLButtonElement>;
}) {
  const cor = no.cor;
  const Icone = ICONE[no.kind];
  const { visiveis, resto } = fatosDoPainel(no.facts);
  const linhas = linhasRelacao(relacoesDoNo(no, porId, filhosDe, links));
  const mostradas = linhas.slice(0, MAX_LINHAS_REL);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${cor}, transparent)` }} />
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--bl-border)] px-4 pb-3 pt-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em]" style={{ color: cor }}>
            <Icone className="h-3 w-3 shrink-0" />
            {no.codigo} · {tipoDoNo(no)}
          </p>
          <h3 className="mt-1 break-words text-lg font-semibold leading-tight text-[var(--bl-text-primary,#e8eaf0)]">{no.label}</h3>
        </div>
        <button type="button" aria-label="fechar painel" onClick={onFechar} className="shrink-0 text-[var(--bl-text-dim)] hover:text-[var(--bl-text-secondary)]">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {no.resumo && <p className="px-4 pt-3 text-xs leading-relaxed text-[var(--bl-text-secondary)]">{no.resumo}</p>}

        <Secao titulo="Identidade">
          <Campo rotulo="Nome">{no.label}</Campo>
          {no.status && (
            <Campo rotulo="Status">
              <span className="font-semibold" style={{ color: no.corStatus }}>{no.status}</span>
            </Campo>
          )}
          {no.tag && (
            <Campo rotulo="Rótulo">
              <span className="font-mono text-xs">{no.tag}</span>
            </Campo>
          )}
        </Secao>

        {(no.path || no.metrica) && (
          <Secao titulo="Local e métrica">
            {no.path && (
              <Campo rotulo="Caminho">
                <span className="break-all font-mono text-xs">{no.path}</span>
              </Campo>
            )}
            {no.metrica && (
              <Campo rotulo={no.metrica.rotulo}>
                <span className="font-mono text-2xl font-semibold" style={{ color: "var(--bl-accent)" }}>{no.metrica.valor}</span>
              </Campo>
            )}
          </Secao>
        )}

        {visiveis.length > 0 && (
          <Secao titulo="Fatos">
            {visiveis.map((f) => (
              <Campo key={f.label} rotulo={f.label}>
                <span className="whitespace-pre-line">{f.value}</span>
              </Campo>
            ))}
            {resto > 0 && <p className="font-mono text-[11px] text-[var(--bl-text-muted)]">+{resto} no Raio-X</p>}
          </Secao>
        )}

        {linhas.length > 0 && (
          <Secao titulo="Relações">
            <ul className="space-y-1.5">
              {mostradas.map((l) => (
                <li key={l.chave}>
                  <button
                    type="button"
                    onClick={() => onSel(l.no.id)}
                    className="flex w-full items-center gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-2.5 py-1.5 text-left transition-colors hover:border-[var(--bl-border-hover)] hover:bg-[var(--bl-bg-elevated)]"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase" style={{ color: l.no.cor }}>{l.no.label}</span>
                    <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] italic text-[var(--bl-text-muted)]">
                      {l.dir === "saindo" && <ArrowUpRight className="h-3 w-3" aria-label="saindo" />}
                      {l.dir === "entrando" && <ArrowDownRight className="h-3 w-3" aria-label="entrando" />}
                      {l.rotulo}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {linhas.length > mostradas.length && (
              <p className="font-mono text-[11px] text-[var(--bl-text-muted)]">+{linhas.length - mostradas.length} no Raio-X</p>
            )}
          </Secao>
        )}
      </div>

      <footer className="shrink-0 border-t border-[var(--bl-border)] p-3">
        <button
          ref={botaoRaioXRef}
          type="button"
          onClick={onAbrirRaioX}
          className="flex w-full items-center justify-center gap-2 rounded-[var(--bl-radius-md)] border py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.1em] transition-colors hover:bg-[rgba(255,255,255,0.04)]"
          style={{ color: "var(--bl-accent)", borderColor: "var(--bl-accent)", background: "rgba(251,146,60,0.08)" }}
        >
          <ScanLine className="h-4 w-4" />
          Abrir Raio-X
        </button>
      </footer>
    </div>
  );
}
