"use client";

/**
 * Modal "Raio-X" de um nó da ontologia: resumo, mini-grafo local, dados, relações e fonte.
 * Renderizado DENTRO da raiz do canvas (overlay absoluto) para continuar visível em tela cheia.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Check, Crosshair, X } from "lucide-react";
import type { OntNo, OntRel } from "@/lib/ontologia-grafo";
import { camposDados, irmaos, relacoesDoNo, tipoDoNo, type RelacoesNo } from "@/lib/ontologia-raiox";
import { ICONE } from "./icones";

const ABAS = ["resumo", "grafo", "dados", "relações", "fonte"] as const;
type Aba = (typeof ABAS)[number];

const MAX_FILHOS_GRAFO = 12;
const MAX_LATERAL = 6;

const corta = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function RaioX({
  no: noInicial,
  porId,
  filhosDe,
  links,
  onFechar,
  onLocalizar,
  fonte: arquivoFonte,
}: {
  no: OntNo;
  porId: Map<string, OntNo>;
  filhosDe: Map<string, OntNo[]>;
  links: OntRel[];
  onFechar: () => void;
  /** Fecha, seleciona e centraliza o nó no canvas. */
  onLocalizar: (id: string) => void;
  /** Arquivo configurado de onde a ontologia foi lida (só exibição). */
  fonte?: string;
}) {
  const [atualId, setAtualId] = useState(noInicial.id);
  const [aba, setAba] = useState<Aba>("resumo");
  const dialogRef = useRef<HTMLDivElement>(null);
  const no = porId.get(atualId) ?? noInicial;
  const cor = no.cor;
  const Icone = ICONE[no.kind];
  const rel = useMemo(() => relacoesDoNo(no, porId, filhosDe, links), [no, porId, filhosDe, links]);
  const viz = useMemo(() => irmaos(no, porId, filhosDe), [no, porId, filhosDe]);

  const irPara = useCallback((id: string | undefined) => {
    if (id) setAtualId(id);
  }, []);

  // foco no modal ao abrir; devolve ao elemento que abriu ao fechar
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (anterior?.isConnected) anterior.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onFechar();
      } else if (e.key === "ArrowLeft" && viz.anterior) {
        e.preventDefault();
        irPara(viz.anterior.id);
      } else if (e.key === "ArrowRight" && viz.proximo) {
        e.preventDefault();
        irPara(viz.proximo.id);
      } else if (e.key === "Tab" && dialogRef.current) {
        // prende o foco dentro do modal
        const foc = [...dialogRef.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")];
        if (foc.length === 0) return;
        const ult = foc[foc.length - 1];
        const pri = foc[0];
        if (e.shiftKey && (document.activeElement === pri || document.activeElement === dialogRef.current)) {
          e.preventDefault();
          ult.focus();
        } else if (!e.shiftKey && document.activeElement === ult) {
          e.preventDefault();
          pri.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onFechar, viz, irPara]);

  const fonte = no.path ?? arquivoFonte ?? "—";
  const aviso = "font-mono text-[10px] uppercase tracking-[0.08em]";

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 p-3 backdrop-blur-md sm:p-6"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Raio-X: ${no.label}`}
        tabIndex={-1}
        className="relative flex h-[min(660px,100%)] w-full max-w-[1100px] flex-col overflow-hidden rounded-[var(--bl-radius-xl)] border border-[var(--bl-border-1)] shadow-2xl outline-none"
        style={{ background: "rgba(14,15,19,0.98)" }}
      >
        <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${cor}, transparent)`, boxShadow: `0 0 18px 1px ${cor}` }} />

        {/* cabeçalho */}
        <header className="relative shrink-0 px-5 pb-0 pt-5 sm:px-6">
          <button
            type="button"
            onClick={onFechar}
            className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-2 py-1 font-mono text-[10px] text-[var(--bl-text-dim)] hover:text-[var(--bl-text-secondary)]"
          >
            <X className="h-3 w-3" /> fechar · ESC
          </button>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3 pr-28">
            <div className="flex items-start gap-1">
              <span className="font-mono text-5xl font-light leading-none" style={{ color: cor, opacity: 0.85 }}>{no.codigo}</span>
              <Icone className="h-4 w-4" style={{ color: cor }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={`flex flex-wrap items-center gap-2 ${aviso} text-[var(--bl-text-muted)]`}>
                {tipoDoNo(no)}
                {no.status && (
                  <span className="rounded-[var(--bl-radius-sm)] border px-1.5 py-px text-[9px] font-semibold" style={{ color: no.corStatus, borderColor: no.corStatus }}>
                    {no.status}
                  </span>
                )}
              </p>
              <h2 className="mt-1 break-words text-2xl font-bold leading-tight text-[var(--bl-text-primary,#e8eaf0)]">{no.label}</h2>
              {no.tag && <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--bl-text-muted)]">{no.tag}</p>}
            </div>
            {no.metrica && (
              <div className="ml-auto self-end text-right leading-none sm:mt-9">
                <p className="font-mono text-4xl font-semibold" style={{ color: "var(--bl-accent)" }}>{no.metrica.valor}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--bl-text-muted)]">{no.metrica.rotulo}</p>
              </div>
            )}
          </div>

          <div role="tablist" aria-label="Seções do Raio-X" className="mt-5 flex gap-5 overflow-x-auto border-b border-[var(--bl-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {ABAS.map((a) => (
              <button
                key={a}
                role="tab"
                type="button"
                id={`rx-aba-${a}`}
                aria-selected={aba === a}
                aria-controls="rx-painel"
                onClick={() => setAba(a)}
                className={`-mb-px border-b-2 pb-2.5 ${aviso} transition-colors ${aba === a ? "" : "border-transparent text-[var(--bl-text-dim)] hover:text-[var(--bl-text-secondary)]"}`}
                style={aba === a ? { color: "var(--bl-accent)", borderColor: "var(--bl-accent)" } : undefined}
              >
                {a}
              </button>
            ))}
          </div>
        </header>

        {/* corpo */}
        <div id="rx-painel" role="tabpanel" aria-labelledby={`rx-aba-${aba}`} className="min-h-[240px] flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {aba === "resumo" && <AbaResumo no={no} cor={cor} />}
          {aba === "grafo" && <AbaGrafo no={no} rel={rel} onIr={irPara} />}
          {aba === "dados" && <AbaDados no={no} />}
          {aba === "relações" && <AbaRelacoes rel={rel} onIr={irPara} />}
          {aba === "fonte" && <AbaFonte no={no} arquivo={arquivoFonte} />}
        </div>

        {/* rodapé */}
        <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--bl-border)] px-5 py-3 sm:px-6">
          <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--bl-text-muted)]" title={fonte}>
            <span className="font-semibold uppercase" style={{ color: "var(--bl-accent)" }}>Fonte</span> · {fonte}
          </p>
          <button
            type="button"
            onClick={() => onLocalizar(no.id)}
            className="inline-flex items-center gap-1.5 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-2.5 py-1 font-mono text-[11px] text-[var(--bl-text-dim)] hover:text-[var(--bl-text-secondary)]"
          >
            <Crosshair className="h-3 w-3" /> localizar no canvas
          </button>
          <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--bl-text-dim)]">
            <button type="button" aria-label="irmão anterior" disabled={!viz.anterior} onClick={() => irPara(viz.anterior?.id)} className="rounded p-1 enabled:hover:text-[var(--bl-accent)] disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span aria-live="polite">{String(viz.indice + 1).padStart(2, "0")} / {String(viz.total).padStart(2, "0")}</span>
            <button type="button" aria-label="próximo irmão" disabled={!viz.proximo} onClick={() => irPara(viz.proximo?.id)} className="rounded p-1 enabled:hover:text-[var(--bl-accent)] disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function AbaResumo({ no, cor }: { no: OntNo; cor: string }) {
  return (
    <div>
      {no.resumo ? (
        <p className="max-w-[62ch] text-[15px] leading-relaxed text-[var(--bl-text-secondary)]">{no.resumo}</p>
      ) : (
        <p className="font-mono text-xs text-[var(--bl-text-muted)]">sem resumo para este nó</p>
      )}
      {no.facts.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {no.facts.map((f) => (
            <div key={f.label} className="rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] px-3.5 py-3" style={{ borderLeft: `2px solid ${cor}` }}>
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--bl-text-muted)]">{f.label}</p>
              <p className="mt-1.5 whitespace-pre-line break-words font-mono text-[13px] text-[var(--bl-text-secondary)]">{f.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BotaoCopiar({ valor }: { valor: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      aria-label="copiar valor"
      onClick={() => {
        void navigator.clipboard?.writeText(valor).then(
          () => {
            setOk(true);
            setTimeout(() => setOk(false), 1200);
          },
          () => {},
        );
      }}
      className="shrink-0 text-[var(--bl-text-muted)] hover:text-[var(--bl-accent)]"
    >
      {ok ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function AbaDados({ no }: { no: OntNo }) {
  return (
    <table className="w-full border-collapse text-left">
      <tbody>
        {camposDados(no).map((c, i) => (
          <tr key={`${c.chave}${i}`} className="border-b border-[var(--bl-border)] align-top">
            <th scope="row" className="w-1/4 py-2 pr-4 font-mono text-[10px] font-normal uppercase tracking-[0.06em] text-[var(--bl-text-muted)]">{c.chave}</th>
            <td className="py-2 pr-3 font-mono text-[12px] text-[var(--bl-text-secondary)]"><span className="whitespace-pre-line break-all">{c.valor}</span></td>
            <td className="w-8 py-2 text-right"><BotaoCopiar valor={c.valor} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AbaRelacoes({ rel, onIr }: { rel: RelacoesNo; onIr: (id: string) => void }) {
  const grupo = (titulo: string, itens: { no: OntNo; rotulo?: string }[]) =>
    itens.length === 0 ? null : (
      <section key={titulo}>
        <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--bl-text-muted)]">{titulo} ({itens.length})</h3>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {itens.map((i, k) => (
            <li key={`${i.no.id}${i.rotulo ?? ""}${k}`}>
              <button
                type="button"
                onClick={() => onIr(i.no.id)}
                className="flex w-full items-center gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-2.5 py-1.5 text-left hover:border-[var(--bl-border-hover)] hover:bg-[var(--bl-bg-elevated)]"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase" style={{ color: i.no.cor }}>{i.no.label}</span>
                {i.rotulo && <span className="shrink-0 font-mono text-[10px] italic text-[var(--bl-text-muted)]">{i.rotulo}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  const vazio = !rel.pai && !rel.filhos.length && !rel.saindo.length && !rel.entrando.length;
  return (
    <div className="space-y-5">
      {vazio && <p className="font-mono text-xs text-[var(--bl-text-muted)]">nenhuma relação</p>}
      {grupo("pai", rel.pai ? [{ no: rel.pai }] : [])}
      {grupo("filhos", rel.filhos.map((no) => ({ no })))}
      {grupo("relações saindo", rel.saindo.map((s) => ({ no: s.no, rotulo: `${s.verbo} →` })))}
      {grupo("relações entrando", rel.entrando.map((s) => ({ no: s.no, rotulo: `← ${s.verbo}` })))}
    </div>
  );
}

function AbaFonte({ no, arquivo }: { no: OntNo; arquivo?: string }) {
  const linha = (rotulo: string, valor: string) => (
    <div className="flex items-center gap-3 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--bl-text-muted)]">{rotulo}</p>
        <p className="mt-1 break-all font-mono text-[12px] text-[var(--bl-text-secondary)]">{valor}</p>
      </div>
      <BotaoCopiar valor={valor} />
    </div>
  );
  return (
    <div className="space-y-2.5">
      {no.path ? linha("Caminho do nó", no.path) : <p className="font-mono text-xs text-[var(--bl-text-muted)]">este nó não tem caminho próprio</p>}
      {arquivo ? linha("Arquivo-fonte da ontologia", arquivo) : null}
      <p className="pt-1 text-xs text-[var(--bl-text-dim)]">Cada card do canvas é uma projeção do arquivo da sua ontologia — a mudança se faz nele e a página lê de novo.</p>
    </div>
  );
}

/* ── mini-grafo local (SVG) ─────────────────────────────────────────── */
const W = 880;
const H = 440;
const NW = 156;
const NH = 34;

function AbaGrafo({ no, rel, onIr }: { no: OntNo; rel: RelacoesNo; onIr: (id: string) => void }) {
  const filhos = rel.filhos.slice(0, MAX_FILHOS_GRAFO);
  const maisFilhos = rel.filhos.length - filhos.length;
  const saindo = rel.saindo.slice(0, MAX_LATERAL);
  const entrando = rel.entrando.slice(0, MAX_LATERAL);
  const cx = W / 2;
  const cy = H / 2;

  type P = { no: OntNo; x: number; y: number; verbo?: string; lado?: "s" | "e" };
  const pontos: P[] = [];
  if (rel.pai) pontos.push({ no: rel.pai, x: cx, y: 34 });
  filhos.forEach((f, i) => {
    const linha = Math.floor(i / 4);
    const naLinha = Math.min(4, filhos.length - linha * 4);
    const col = i % 4;
    pontos.push({ no: f, x: cx + (col - (naLinha - 1) / 2) * (NW + 16), y: H - 40 - (Math.ceil(filhos.length / 4) - 1 - linha) * 46 });
  });
  const lateral = (lista: typeof saindo, lado: "s" | "e") =>
    lista.forEach((r, i) => {
      const y = H / 2 + (i - (lista.length - 1) / 2) * 46;
      pontos.push({ no: r.no, x: lado === "s" ? W - NW / 2 - 8 : NW / 2 + 8, y, verbo: r.verbo, lado });
    });
  lateral(saindo, "s");
  lateral(entrando, "e");

  const cor = (n: OntNo) => n.cor;
  const caixa = (n: OntNo, x: number, y: number, central = false) => (
    <g
      key={`${n.id}-${x}-${y}`}
      role="button"
      tabIndex={central ? -1 : 0}
      aria-label={`ir para ${n.label}`}
      style={{ cursor: central ? "default" : "pointer", outline: "none" }}
      onClick={() => !central && onIr(n.id)}
      onKeyDown={(e) => {
        if (!central && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onIr(n.id);
        }
      }}
    >
      <rect x={x - NW / 2} y={y - NH / 2} width={NW} height={NH} rx={8} fill="#12141a" stroke={cor(n)} strokeWidth={central ? 2 : 1.2} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontFamily="ui-monospace, monospace" fill={cor(n)}>
        {corta(n.label, 20)}
      </text>
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[880px]" role="group" aria-label="Mini-grafo do nó">
      <defs>
        <marker id="rx-seta" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 z" fill="#94a3b8" />
        </marker>
      </defs>
      {pontos.map((p) => {
        let d: string;
        let meio: { x: number; y: number };
        if (p.lado === "e") {
          d = `M ${p.x + NW / 2} ${p.y} L ${cx - NW / 2} ${cy}`;
          meio = { x: (p.x + NW / 2 + cx - NW / 2) / 2, y: (p.y + cy) / 2 };
        } else if (p.lado === "s") {
          d = `M ${cx + NW / 2} ${cy} L ${p.x - NW / 2} ${p.y}`;
          meio = { x: (cx + NW / 2 + p.x - NW / 2) / 2, y: (p.y + cy) / 2 };
        } else if (p.y < cy) {
          d = `M ${p.x} ${p.y + NH / 2} L ${cx} ${cy - NH / 2}`;
          meio = { x: 0, y: 0 };
        } else {
          d = `M ${cx} ${cy + NH / 2} L ${p.x} ${p.y - NH / 2}`;
          meio = { x: 0, y: 0 };
        }
        return (
          <g key={`ar-${p.no.id}-${p.x}-${p.y}`}>
            <path d={d} fill="none" stroke={cor(p.no)} strokeOpacity={0.55} strokeWidth={1.3} strokeDasharray={p.lado ? "6 5" : undefined} markerEnd={p.lado ? "url(#rx-seta)" : undefined} />
            {p.verbo && (
              <g>
                <rect x={meio.x - p.verbo.length * 3.2 - 5} y={meio.y - 9} width={p.verbo.length * 6.4 + 10} height={18} rx={4} fill="#0e0f13" stroke={cor(p.no)} strokeOpacity={0.5} />
                <text x={meio.x} y={meio.y + 3.5} textAnchor="middle" fontSize={10} fontFamily="ui-monospace, monospace" fill="#cbd5e1">{corta(p.verbo, 16)}</text>
              </g>
            )}
          </g>
        );
      })}
      {pontos.map((p) => caixa(p.no, p.x, p.y))}
      {caixa(no, cx, cy, true)}
      {maisFilhos > 0 && (
        <text x={W - 16} y={H - 14} textAnchor="end" fontSize={11} fontFamily="ui-monospace, monospace" fill="#94a3b8">+{maisFilhos} filhos</text>
      )}
      {rel.saindo.length > saindo.length && (
        <text x={W - 16} y={16} textAnchor="end" fontSize={11} fontFamily="ui-monospace, monospace" fill="#94a3b8">+{rel.saindo.length - saindo.length} saindo</text>
      )}
      {rel.entrando.length > entrando.length && (
        <text x={16} y={16} fontSize={11} fontFamily="ui-monospace, monospace" fill="#94a3b8">+{rel.entrando.length - entrando.length} entrando</text>
      )}
    </svg>
  );
}
