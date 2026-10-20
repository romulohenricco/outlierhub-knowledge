"use client";

/** Card de detalhe sobre o grafo. Só mostra o que existe no dado: seção sem
 *  conteúdo é omitida (nada é inventado). */
import { X } from "lucide-react";
import type { EcoEntity } from "@/lib/types";
import type { PilarCena } from "@/lib/brain/cena";
import type { MemNota, OrgData } from "@/lib/brain/tipos";

const Secao = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <section className="mt-4">
    <h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bl-text-dim)]">{titulo}</h4>
    {children}
  </section>
);

const Cole = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
  <button
    onClick={onClick}
    disabled={!onClick}
    className="rounded border border-[var(--bl-border)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--bl-text-primary)] enabled:hover:border-[var(--bl-border-accent)]"
  >
    {`[[ ${children} ]]`}
  </button>
);

function Passos({ passos }: { passos: string[] }) {
  return (
    <ol className="mt-1.5 space-y-1.5">
      {passos.map((p, i) => (
        <li key={i} className="flex gap-2 text-[12px] leading-snug text-[var(--bl-text-secondary)]">
          <span className="font-mono text-[10px] text-[var(--bl-text-dim)]">{String(i + 1).padStart(2, "0")}</span>
          <span>{p}</span>
        </li>
      ))}
    </ol>
  );
}

export function Painel({
  selId, org, pilares, entidade, direita, onFechar, onSelecionar, onAbrirCard,
}: {
  selId: string;
  org: OrgData | null;
  pilares: PilarCena[];
  entidade: EcoEntity | null;
  /** distância (px) da borda direita do canvas — fica ao lado do painel flutuante. */
  direita: number;
  onFechar: () => void;
  onSelecionar: (id: string) => void;
  onAbrirCard: (e: EcoEntity) => void;
}) {
  const nomePilar = (id: string) => pilares.find((p) => p.id === id)?.nome ?? "";
  const f = org;
  const agente = f?.agentes.find((a) => a.id === selId);
  const pessoa = f?.pessoas.find((a) => a.id === selId);
  const tarefa = f?.tarefas.find((a) => a.id === selId);
  const ferr = f?.ferramentas.find((a) => a.id === selId);

  let pilarNome = "";
  let titulo = "";
  let sub = "";
  let corpo: React.ReactNode = null;

  const tarefasDe = (id: string) => f?.tarefas.filter((t) => t.executorId === id) ?? [];
  const nomeFerr = (id: string) => f?.ferramentas.find((t) => t.id === id)?.nome ?? id;

  const instrucoes = (id: string) =>
    tarefasDe(id).map((t) => (
      <div key={t.id} className="mb-3">
        <Cole onClick={() => onSelecionar(t.id)}>{t.titulo}</Cole>
        {t.resumo && <p className="mt-1 text-[11px] text-[var(--bl-text-dim)]">{t.resumo}</p>}
        {t.passos.length > 0 && <Passos passos={t.passos} />}
      </div>
    ));

  if (agente && f) {
    pilarNome = nomePilar(agente.pilarId);
    titulo = agente.nome;
    sub = `${agente.papel ? `${agente.papel} · ` : ""}agente`;
    const pai = agente.paiId ? f.agentes.find((a) => a.id === agente.paiId) : null;
    const run = f.ultimaExecucao[agente.id];
    const ins = tarefasDe(agente.id);
    corpo = (
      <>
        {agente.descricao && <p className="mt-3 text-[12.5px] leading-snug text-[var(--bl-text-secondary)]">{agente.descricao}</p>}
        {ins.length > 0 && <Secao titulo="Instruções">{instrucoes(agente.id)}</Secao>}
        <Secao titulo="Detalhes">
          <p className="font-mono text-[11.5px] leading-relaxed text-[var(--bl-text-secondary)]">
            {agente.funcao ? `função ${agente.funcao}` : "função não informada"}
            {agente.ambiente && <> · roda em {agente.ambiente}</>}
            {agente.modelo && <> · {agente.modelo}</>}
            {pai && (
              <>
                <br />
                reporta a{" "}
                <button className="underline decoration-dotted hover:text-[var(--bl-accent)]" onClick={() => onSelecionar(pai.id)}>
                  {pai.nome}
                </button>
              </>
            )}
            <br />
            {agente.status ? `status ${agente.status}` : "status não informado"}
          </p>
        </Secao>
        {agente.ferramentas.length > 0 && (
          <Secao titulo={`Ferramentas (${agente.ferramentas.length})`}>
            <div className="flex flex-wrap gap-1.5">
              {agente.ferramentas.map((t) => (
                <Cole key={t} onClick={() => onSelecionar(t)}>
                  {nomeFerr(t)}
                </Cole>
              ))}
            </div>
          </Secao>
        )}
        <Secao titulo="Última execução">
          <p className="font-mono text-[11.5px] text-[var(--bl-text-secondary)]">
            {run
              ? `${run.status}${run.ok === null ? "" : run.ok ? " · ok" : " · falhou"} · ${run.iniciadoEm}${run.resumo ? ` — ${run.resumo}` : ""}`
              : "sem execução registrada"}
          </p>
        </Secao>
      </>
    );
  } else if (pessoa && f) {
    pilarNome = nomePilar(pessoa.pilarId);
    titulo = pessoa.nome;
    sub = `${pessoa.papel ? `${pessoa.papel} · ` : ""}pessoa`;
    corpo = (
      <>
        {tarefasDe(pessoa.id).length > 0 && <Secao titulo="Instruções">{instrucoes(pessoa.id)}</Secao>}
        {pessoa.ferramentas.length > 0 && (
          <Secao titulo={`Ferramentas (${pessoa.ferramentas.length})`}>
            <div className="flex flex-wrap gap-1.5">
              {pessoa.ferramentas.map((t) => (
                <Cole key={t} onClick={() => onSelecionar(t)}>
                  {nomeFerr(t)}
                </Cole>
              ))}
            </div>
          </Secao>
        )}
      </>
    );
  } else if (tarefa && f) {
    pilarNome = nomePilar(tarefa.pilarId);
    titulo = tarefa.titulo;
    const ex = tarefa.executorTipo === "agent" ? f.agentes.find((a) => a.id === tarefa.executorId) : f.pessoas.find((a) => a.id === tarefa.executorId);
    sub = "tarefa";
    corpo = (
      <>
        {tarefa.resumo && <p className="mt-3 text-[12.5px] leading-snug text-[var(--bl-text-secondary)]">{tarefa.resumo}</p>}
        {tarefa.passos.length > 0 && (
          <Secao titulo="Passos">
            <Passos passos={tarefa.passos} />
          </Secao>
        )}
        {ex && (
          <Secao titulo="Executor">
            <Cole onClick={() => onSelecionar(ex.id)}>{ex.nome}</Cole>
          </Secao>
        )}
      </>
    );
  } else if (ferr && f) {
    titulo = ferr.nome;
    sub = [ferr.categoria, ferr.status].filter(Boolean).join(" · ") || "ferramenta";
    const usam = [...f.agentes.filter((a) => a.ferramentas.includes(ferr.id)), ...f.pessoas.filter((a) => a.ferramentas.includes(ferr.id))];
    corpo = (
      <>
        {ferr.descricao && <p className="mt-3 text-[12.5px] leading-snug text-[var(--bl-text-secondary)]">{ferr.descricao}</p>}
        {usam.length > 0 && (
          <Secao titulo={`Usada por (${usam.length})`}>
            <div className="flex flex-wrap gap-1.5">
              {usam.map((u) => (
                <Cole key={u.id} onClick={() => onSelecionar(u.id)}>
                  {u.nome}
                </Cole>
              ))}
            </div>
          </Secao>
        )}
      </>
    );
  } else if (entidade) {
    titulo = entidade.nome;
    sub = `${entidade.kind} · ${entidade.procedencia}`;
    const pai = entidade.squadId;
    corpo = (
      <>
        {entidade.descricao && <p className="mt-3 text-[12.5px] leading-snug text-[var(--bl-text-secondary)]">{entidade.descricao}</p>}
        <Secao titulo="Origem">
          <p className="break-all font-mono text-[11px] text-[var(--bl-text-secondary)]">{entidade.path}</p>
          <p className="mt-1 font-mono text-[11px] text-[var(--bl-text-dim)]">{entidade.origem}</p>
        </Secao>
        {entidade.uso && (
          <Secao titulo="Uso">
            <p className="font-mono text-[11.5px] text-[var(--bl-text-secondary)]">{entidade.uso.status}</p>
          </Secao>
        )}
        {pai && (
          <Secao titulo="Pertence a">
            <Cole onClick={() => onSelecionar(pai)}>{pai.split(":").pop() ?? pai}</Cole>
          </Secao>
        )}
        <button onClick={() => onAbrirCard(entidade)} className="mt-4 text-[12px] text-[var(--bl-accent)] hover:underline">
          abrir card no catálogo
        </button>
      </>
    );
  } else {
    return null;
  }

  return (
    <div className="bl-entra absolute z-20 w-[340px] max-w-[calc(100%-2rem)] overflow-y-auto rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] p-4 shadow-2xl backdrop-blur-xl"
      // --bl-bg-card-solid tem alpha 0.65 nos temas: o painel precisa ser quase opaco pra o grafo não vazar por trás do texto
      style={{ backgroundColor: "rgba(9, 9, 12, 0.94)", right: direita, top: "calc(var(--g-topo) + 46px)", maxHeight: "calc(100% - var(--g-topo) - 58px)" }}
    >
      <header className="flex items-start justify-between gap-2">
        <button onClick={onFechar} className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--bl-text-dim)] hover:text-[var(--bl-text-primary)]">
          ← voltar{pilarNome ? ` · ${pilarNome}` : ""}
        </button>
        <button onClick={onFechar} aria-label="fechar detalhe" className="text-[var(--bl-text-dim)] hover:text-[var(--bl-text-primary)]">
          <X size={14} />
        </button>
      </header>
      <h3 className="mt-3 text-[17px] font-semibold leading-tight text-[var(--bl-text-primary)]">{titulo}</h3>
      <p className="mt-0.5 text-[12px] text-[var(--bl-text-dim)]">{sub}</p>
      {corpo}
    </div>
  );
}

/** Detalhe de uma nota do núcleo: título, hub, contagem, trecho e a origem na pasta de notas. */
export function PainelNota({
  nota, direita, onFechar,
}: {
  nota: MemNota;
  direita: number;
  onFechar: () => void;
}) {
  return (
    <div className="bl-entra absolute z-20 w-[340px] max-w-[calc(100%-2rem)] overflow-y-auto rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] p-4 shadow-2xl backdrop-blur-xl"
      style={{ backgroundColor: "rgba(9, 9, 12, 0.94)", right: direita, top: "calc(var(--g-topo) + 46px)", maxHeight: "calc(100% - var(--g-topo) - 58px)" }}
    >
      <header className="flex items-start justify-between gap-2">
        <button onClick={onFechar} className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--bl-text-dim)] hover:text-[var(--bl-text-primary)]">
          ← voltar · grafo
        </button>
        <button onClick={onFechar} aria-label="fechar detalhe" className="text-[var(--bl-text-dim)] hover:text-[var(--bl-text-primary)]">
          <X size={14} />
        </button>
      </header>
      <h3 className="mt-3 text-[16px] font-semibold leading-tight text-[#f87171]">{nota.titulo}</h3>
      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--bl-text-dim)]">
        <span className="rounded border border-[#e35c35]/60 px-1.5 py-0.5 uppercase tracking-[0.12em] text-[#fb923c]">{nota.hub}</span>
        <span>{nota.palavras} palavras · {nota.grau} link{nota.grau === 1 ? "" : "s"}</span>
      </div>
      {nota.trecho && <p className="mt-3 whitespace-pre-line text-[12px] leading-relaxed text-[var(--bl-text-secondary)]">{nota.trecho}{nota.palavras > 80 ? "…" : ""}</p>}
      <section className="mt-4">
        <h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bl-text-dim)]">Origem</h4>
        <p className="break-all font-mono text-[11px] text-[var(--bl-text-secondary)]">{nota.caminho}</p>
      </section>
    </div>
  );
}
