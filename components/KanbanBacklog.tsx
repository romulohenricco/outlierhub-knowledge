"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, ChevronRight, Copy, Check, X, Clock } from "lucide-react";
import { Secao, ListaExpansivel, linhaCls } from "./Filtros";
import { usePagePanel } from "./PagePanel";
import {
  CANAL_INFO,
  EXECUCAO_INFO,
  LINK_INFO,
  PRIORIDADE_INFO,
  PROJETO_INFO,
  TIPO_INFO,
  type KanbanExecucaoFiltro,
} from "./kanbanInfo";
import type {
  KanbanBoard,
  KanbanCanalPedido,
  KanbanCard,
  KanbanPrioridade,
  KanbanProjeto,
  KanbanTipo,
} from "@/lib/types";

/** Escala compacta — mesma calibragem do modal do board. */
const COMPACT_SCALE_STYLE = {
  "--bl-text-xs": "9.1px",
  "--bl-text-sm": "10.4px",
  "--bl-text-base": "11.7px",
  "--bl-space-1": "3.3px",
  "--bl-space-2": "6.5px",
  "--bl-space-3": "9.8px",
  "--bl-radius-sm": "5.2px",
  "--bl-radius-md": "6.5px",
} as unknown as React.CSSProperties;

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const novo = new Set(set);
  if (novo.has(v)) novo.delete(v);
  else novo.add(v);
  return novo;
}

function paramParaSet<T extends string>(sp: URLSearchParams, chave: string): Set<T> {
  const v = sp.get(chave);
  if (!v) return new Set();
  return new Set(v.split(",").filter(Boolean) as T[]);
}

const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

/** Tempo entre criação e conclusão — o dado que só o arquivo consegue mostrar
 *  (no board o card já saiu de vista quando essa conta passa a importar). */
function tempoDeCiclo(card: KanbanCard): string | null {
  if (!card.concluidoEm) return null;
  const ms = new Date(card.concluidoEm).getTime() - new Date(card.criadoEm).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const horas = ms / 3_600_000;
  if (horas < 1) return `${Math.max(1, Math.round(ms / 60_000))}min`;
  if (horas < 48) return `${Math.round(horas)}h`;
  return `${Math.round(horas / 24)}d`;
}

export function KanbanBacklog({ board: boardInicial }: { board: KanbanBoard }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [board, setBoard] = useState(boardInicial);
  // Default = done: o pedido foi "o backlog de todas que entram em DONE". A
  // coluna é filtro (não hardcode) pra que a mesma página sirva de arquivo
  // completo — inclusive dos cancelados, que somem do board e não têm outro lar.
  const [filtroColuna, setFiltroColuna] = useState<Set<string>>(() => {
    const v = paramParaSet<string>(sp, "coluna");
    return v.size > 0 ? v : new Set(["done"]);
  });
  const [filtroTipo, setFiltroTipo] = useState<Set<KanbanTipo>>(() => paramParaSet(sp, "tipo"));
  const [filtroPrioridade, setFiltroPrioridade] = useState<Set<KanbanPrioridade>>(() => paramParaSet(sp, "prioridade"));
  const [filtroProjeto, setFiltroProjeto] = useState<Set<KanbanProjeto>>(() => paramParaSet(sp, "projeto"));
  const [filtroExecucao, setFiltroExecucao] = useState<Set<KanbanExecucaoFiltro>>(() => paramParaSet(sp, "execucao"));
  const [filtroResponsavel, setFiltroResponsavel] = useState<Set<string>>(() => paramParaSet(sp, "responsavel"));
  const [filtroTags, setFiltroTags] = useState<Set<string>>(() => paramParaSet(sp, "tags"));
  const [filtroCanal, setFiltroCanal] = useState<Set<KanbanCanalPedido>>(() => paramParaSet(sp, "canal"));
  const [de, setDe] = useState(() => sp.get("de") ?? "");
  const [ate, setAte] = useState(() => sp.get("ate") ?? "");
  const [busca, setBusca] = useState(() => sp.get("q") ?? "");
  const [aberto, setAberto] = useState<string | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  // Mesmo polling do board: tickets entram em DONE por fora (agente rodando em
  // background), e um arquivo que só atualiza no F5 mente sobre o que já fechou.
  useEffect(() => {
    const id = setInterval(async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const r = await fetch("/api/kanban");
      if (r.ok) setBoard(await r.json());
    }, 8000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams();
    const add = <T extends string>(k: string, s: Set<T>) => {
      if (s.size > 0) q.set(k, Array.from(s).join(","));
    };
    add("coluna", filtroColuna);
    add("tipo", filtroTipo);
    add("prioridade", filtroPrioridade);
    add("projeto", filtroProjeto);
    add("execucao", filtroExecucao);
    add("responsavel", filtroResponsavel);
    add("tags", filtroTags);
    add("canal", filtroCanal);
    if (de) q.set("de", de);
    if (ate) q.set("ate", ate);
    if (busca.trim()) q.set("q", busca.trim());
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [filtroColuna, filtroTipo, filtroPrioridade, filtroProjeto, filtroExecucao, filtroResponsavel, filtroTags, filtroCanal, de, ate, busca, pathname, router]);

  const contagens = useMemo(() => {
    const coluna: Record<string, number> = {};
    const tipo: Partial<Record<KanbanTipo, number>> = {};
    const prioridade: Partial<Record<KanbanPrioridade, number>> = {};
    const projeto: Partial<Record<KanbanProjeto, number>> = {};
    const execucao: Partial<Record<KanbanExecucaoFiltro, number>> = {};
    const canal: Partial<Record<KanbanCanalPedido, number>> = {};
    const responsavel: Record<string, number> = {};
    const tags: Record<string, number> = {};
    for (const c of board.cards) {
      coluna[c.coluna] = (coluna[c.coluna] ?? 0) + 1;
      tipo[c.tipo] = (tipo[c.tipo] ?? 0) + 1;
      prioridade[c.prioridade] = (prioridade[c.prioridade] ?? 0) + 1;
      projeto[c.projeto] = (projeto[c.projeto] ?? 0) + 1;
      const m = c.execucao?.modo ?? "sem-definicao";
      execucao[m] = (execucao[m] ?? 0) + 1;
      if (c.origem.canal) canal[c.origem.canal] = (canal[c.origem.canal] ?? 0) + 1;
      if (c.responsavel) responsavel[c.responsavel] = (responsavel[c.responsavel] ?? 0) + 1;
      for (const t of c.tags) tags[t] = (tags[t] ?? 0) + 1;
    }
    return { coluna, tipo, prioridade, projeto, execucao, canal, responsavel, tags };
  }, [board.cards]);

  const responsaveis = useMemo(
    () => Object.keys(contagens.responsavel).sort((a, b) => contagens.responsavel[b] - contagens.responsavel[a]),
    [contagens.responsavel],
  );
  const tagsDisponiveis = useMemo(
    () => Object.keys(contagens.tags).sort((a, b) => contagens.tags[b] - contagens.tags[a]),
    [contagens.tags],
  );

  /** Data usada pra ordenar/filtrar por período: conclusão quando existe,
   *  criação no resto (card cancelado nunca ganha `concluidoEm`). */
  const dataRef = (c: KanbanCard) => c.concluidoEm ?? c.criadoEm;

  const resultado = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return board.cards
      .filter((c) => {
        if (filtroColuna.size > 0 && !filtroColuna.has(c.coluna)) return false;
        if (filtroTipo.size > 0 && !filtroTipo.has(c.tipo)) return false;
        if (filtroPrioridade.size > 0 && !filtroPrioridade.has(c.prioridade)) return false;
        if (filtroProjeto.size > 0 && !filtroProjeto.has(c.projeto)) return false;
        if (filtroExecucao.size > 0 && !filtroExecucao.has(c.execucao?.modo ?? "sem-definicao")) return false;
        if (filtroResponsavel.size > 0 && !(c.responsavel && filtroResponsavel.has(c.responsavel))) return false;
        if (filtroTags.size > 0 && !c.tags.some((t) => filtroTags.has(t))) return false;
        if (filtroCanal.size > 0 && !(c.origem.canal && filtroCanal.has(c.origem.canal))) return false;
        const d = dataRef(c).slice(0, 10);
        if (de && d < de) return false;
        if (ate && d > ate) return false;
        if (termo) {
          const alvo = `${c.id} ${c.titulo} ${c.descricao} ${c.tags.join(" ")} ${c.responsavel ?? ""}`.toLowerCase();
          if (!alvo.includes(termo)) return false;
        }
        return true;
      })
      .sort((a, b) => dataRef(b).localeCompare(dataRef(a)));
  }, [board.cards, filtroColuna, filtroTipo, filtroPrioridade, filtroProjeto, filtroExecucao, filtroResponsavel, filtroTags, filtroCanal, de, ate, busca]);

  const temFiltro =
    filtroTipo.size > 0 ||
    filtroPrioridade.size > 0 ||
    filtroProjeto.size > 0 ||
    filtroExecucao.size > 0 ||
    filtroResponsavel.size > 0 ||
    filtroTags.size > 0 ||
    filtroCanal.size > 0 ||
    !!de ||
    !!ate ||
    !!busca.trim() ||
    !(filtroColuna.size === 1 && filtroColuna.has("done"));

  const limpar = useCallback(() => {
    setFiltroColuna(new Set(["done"]));
    setFiltroTipo(new Set());
    setFiltroPrioridade(new Set());
    setFiltroProjeto(new Set());
    setFiltroExecucao(new Set());
    setFiltroResponsavel(new Set());
    setFiltroTags(new Set());
    setFiltroCanal(new Set());
    setDe("");
    setAte("");
    setBusca("");
  }, []);

  const painel = useMemo(
    () => (
      <>
        <Secao titulo="coluna" sub="onde o ticket parou" cor="#38bdf8" corRgb="56,189,248" defaultAberto>
          {board.colunas.map((col) => (
            <button key={col.id} onClick={() => setFiltroColuna((s) => toggle(s, col.id))} className={linhaCls(filtroColuna.has(col.id))}>
              {col.rotulo}
              <span className="ml-auto opacity-50">{contagens.coluna[col.id] ?? 0}</span>
            </button>
          ))}
        </Secao>
        <Secao titulo="tipo" cor="#60a5fa" corRgb="96,165,250">
          {(Object.keys(TIPO_INFO) as KanbanTipo[]).map((t) => (
            <button key={t} onClick={() => setFiltroTipo((s) => toggle(s, t))} className={linhaCls(filtroTipo.has(t))}>
              {TIPO_INFO[t].rotulo}
              <span className="ml-auto opacity-50">{contagens.tipo[t] ?? 0}</span>
            </button>
          ))}
        </Secao>
        <Secao titulo="execução" sub="quem rodou" cor="#22d3ee" corRgb="34,211,238" defaultAberto={false}>
          {(Object.keys(EXECUCAO_INFO) as KanbanExecucaoFiltro[]).map((m) => {
            const { rotulo, Icon } = EXECUCAO_INFO[m];
            return (
              <button key={m} onClick={() => setFiltroExecucao((s) => toggle(s, m))} className={linhaCls(filtroExecucao.has(m))}>
                <Icon size={12} strokeWidth={2} />
                {rotulo}
                <span className="ml-auto opacity-50">{contagens.execucao[m] ?? 0}</span>
              </button>
            );
          })}
        </Secao>
        <Secao titulo="prioridade" cor="#fb923c" corRgb="251,146,60" defaultAberto={false}>
          {(Object.keys(PRIORIDADE_INFO) as KanbanPrioridade[]).map((p) => (
            <button key={p} onClick={() => setFiltroPrioridade((s) => toggle(s, p))} className={linhaCls(filtroPrioridade.has(p))}>
              {PRIORIDADE_INFO[p].rotulo}
              <span className="ml-auto opacity-50">{contagens.prioridade[p] ?? 0}</span>
            </button>
          ))}
        </Secao>
        <Secao titulo="projeto" cor="#a855f7" corRgb="168,85,247" defaultAberto={false}>
          {(Object.keys(PROJETO_INFO) as KanbanProjeto[]).map((p) => (
            <button key={p} onClick={() => setFiltroProjeto((s) => toggle(s, p))} className={linhaCls(filtroProjeto.has(p))}>
              {PROJETO_INFO[p]}
              <span className="ml-auto opacity-50">{contagens.projeto[p] ?? 0}</span>
            </button>
          ))}
        </Secao>
        <Secao titulo="período" sub="conclusão (ou criação)" cor="#6bc950" corRgb="107,201,80" defaultAberto={false}>
          <div className="flex flex-col gap-1 px-2" style={COMPACT_SCALE_STYLE}>
            <label className="text-[10px] text-[var(--bl-text-dim)]">
              de
              <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="bl-input mt-1 w-full" />
            </label>
            <label className="text-[10px] text-[var(--bl-text-dim)]">
              até
              <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="bl-input mt-1 w-full" />
            </label>
          </div>
        </Secao>
        <Secao titulo="responsável" cor="#f472b6" corRgb="244,114,182" defaultAberto={false}>
          <ListaExpansivel
            itens={responsaveis}
            topN={6}
            render={(r) => (
              <button key={r} onClick={() => setFiltroResponsavel((s) => toggle(s, r))} className={linhaCls(filtroResponsavel.has(r))}>
                {r}
                <span className="ml-auto opacity-50">{contagens.responsavel[r] ?? 0}</span>
              </button>
            )}
          />
        </Secao>
        <Secao titulo="tags" cor="#6bc950" corRgb="107,201,80" defaultAberto={false}>
          <ListaExpansivel
            itens={tagsDisponiveis}
            topN={10}
            render={(t) => (
              <button key={t} onClick={() => setFiltroTags((s) => toggle(s, t))} className={linhaCls(filtroTags.has(t))}>
                {t}
                <span className="ml-auto opacity-50">{contagens.tags[t] ?? 0}</span>
              </button>
            )}
          />
        </Secao>
        <Secao titulo="canal de origem" cor="#d4a853" corRgb="212,168,83" defaultAberto={false}>
          {(Object.keys(CANAL_INFO) as KanbanCanalPedido[]).map((c) => (
            <button key={c} onClick={() => setFiltroCanal((s) => toggle(s, c))} className={linhaCls(filtroCanal.has(c))}>
              {CANAL_INFO[c]}
              <span className="ml-auto opacity-50">{contagens.canal[c] ?? 0}</span>
            </button>
          ))}
        </Secao>
        {temFiltro && (
          <button onClick={limpar} className="mt-1 block px-2 text-[11px] text-[var(--bl-accent)] hover:brightness-125">
            limpar filtros
          </button>
        )}
      </>
    ),
    [board.colunas, contagens, filtroColuna, filtroTipo, filtroExecucao, filtroPrioridade, filtroProjeto, filtroResponsavel, filtroTags, filtroCanal, de, ate, responsaveis, tagsDisponiveis, temFiltro, limpar],
  );
  usePagePanel(painel);

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--bl-text-dim)]" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="buscar por id, título, descrição, tag, responsável…"
            className="bl-input w-full pl-8"
          />
          {busca && (
            <button
              onClick={() => setBusca("")}
              aria-label="limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-[var(--bl-text-dim)]">
          <strong className="text-[var(--bl-text-secondary)]">{resultado.length}</strong> ticket
          {resultado.length === 1 ? "" : "s"}
        </span>
      </div>

      {resultado.length === 0 && (
        <p className="py-10 text-center text-[12px] text-[var(--bl-text-dim)]">nenhum ticket com esses filtros</p>
      )}

      <div className="flex flex-col gap-1">
        {resultado.map((card) => {
          const info = TIPO_INFO[card.tipo];
          const expandido = aberto === card.id;
          const ciclo = tempoDeCiclo(card);
          const feitos = card.checklist.filter((i) => i.feito).length;
          return (
            <div
              key={card.id}
              className="rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-elevated)]"
              style={{ borderLeft: `2px solid ${info.cor}` }}
            >
              <button
                onClick={() => setAberto(expandido ? null : card.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02]"
              >
                <ChevronRight
                  size={13}
                  className={`shrink-0 text-[var(--bl-text-dim)] transition-transform ${expandido ? "rotate-90" : ""}`}
                />
                <span className="shrink-0 font-mono text-[10px] text-[var(--bl-text-dim)]">{card.id}</span>
                <span className="min-w-0 flex-1 truncate text-[12px]">{card.titulo}</span>
                <span className={`bl-badge ${info.badge} shrink-0`}>{info.rotulo}</span>
                {card.execucao && (
                  <span className="shrink-0 text-[10px] text-[var(--bl-text-dim)]">
                    {EXECUCAO_INFO[card.execucao.modo].rotulo}
                  </span>
                )}
                {ciclo && (
                  <span className="hidden shrink-0 items-center gap-1 text-[10px] text-[var(--bl-text-dim)] sm:inline-flex" title="tempo entre criação e conclusão">
                    <Clock size={10} /> {ciclo}
                  </span>
                )}
                <span className="shrink-0 tabular-nums text-[10px] text-[var(--bl-text-dim)]">{fmtData(dataRef(card))}</span>
              </button>

              {expandido && (
                <div className="border-t border-[var(--bl-border)] px-3 py-2.5 text-[11px] text-[var(--bl-text-secondary)]">
                  <div className="mb-2 flex flex-wrap gap-1">
                    <span className={`bl-badge ${PRIORIDADE_INFO[card.prioridade].badge}`}>
                      {PRIORIDADE_INFO[card.prioridade].rotulo}
                    </span>
                    <span className="bl-badge bl-badge-ghost">{PROJETO_INFO[card.projeto]}</span>
                    {card.responsavel && <span className="bl-badge bl-badge-ghost">{card.responsavel}</span>}
                    {card.tags.map((t) => (
                      <span key={t} className="bl-badge bl-badge-ghost">
                        {t}
                      </span>
                    ))}
                  </div>

                  {card.descricao && (
                    <p className="mb-2.5 whitespace-pre-wrap leading-relaxed text-[var(--bl-text-secondary)]">
                      {card.descricao}
                    </p>
                  )}

                  {card.checklist.length > 0 && (
                    <div className="mb-2.5">
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--bl-text-dim)]">
                        checklist {feitos}/{card.checklist.length}
                      </p>
                      {card.checklist.map((i, n) => (
                        <p key={n} className={i.feito ? "opacity-60 line-through" : ""}>
                          {i.feito ? "[x]" : "[ ]"} {i.texto}
                        </p>
                      ))}
                    </div>
                  )}

                  {card.links.length > 0 && (
                    <div className="mb-2.5">
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--bl-text-dim)]">links</p>
                      {card.links.map((l, n) => {
                        const li = LINK_INFO[l.tipo];
                        return (
                          <div key={n} className="flex items-center gap-1.5">
                            <li.Icon size={11} style={{ color: li.cor }} className="shrink-0" />
                            <a href={l.url} target="_blank" rel="noreferrer" className="truncate hover:underline" title={l.url}>
                              {l.url}
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {card.historico.length > 0 && (
                    <div className="mb-2.5">
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--bl-text-dim)]">histórico</p>
                      {card.historico.map((h, n) => (
                        <p key={n} className="text-[10px] text-[var(--bl-text-dim)]">
                          {h.de ?? "criado"} → {h.para} · {new Date(h.em).toLocaleString("pt-BR")}
                          {h.nota ? ` — ${h.nota}` : ""}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-[10px] text-[var(--bl-text-dim)]">
                    <span>criado {fmtData(card.criadoEm)}</span>
                    {card.concluidoEm && <span>concluído {fmtData(card.concluidoEm)}</span>}
                    {ciclo && <span>ciclo {ciclo}</span>}
                    {card.origem.canal && <span>via {CANAL_INFO[card.origem.canal]}</span>}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${card.id}: ${card.titulo}\n\n${card.descricao}`);
                        setCopiadoId(card.id);
                        setTimeout(() => setCopiadoId((a) => (a === card.id ? null : a)), 1500);
                      }}
                      className="ml-auto inline-flex items-center gap-1 hover:text-[var(--bl-accent)]"
                    >
                      {copiadoId === card.id ? <Check size={11} /> : <Copy size={11} />} copiar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
