"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { Search, ExternalLink, BadgeCheck, Building2 } from "lucide-react";
import { Secao, ListaExpansivel, linhaCls, COR_CAT } from "./Filtros";
import { usePagePanel } from "./PagePanel";
import { SocialVazio } from "./SocialVazio";
import type { ContaSocial, ProgressoSocial } from "@/lib/social";
import { dataHumana, numeroHumano, rotuloNicho } from "@/lib/social-formato";

const COR_SECAO = COR_CAT;

export function MySocialMedia({
  contas,
  progresso,
  rotulosNichos,
}: {
  contas: ContaSocial[];
  progresso: ProgressoSocial;
  rotulosNichos: Record<string, string>;
}) {
  const rotulo = (n: string) => rotuloNicho(n, rotulosNichos);
  const [q, setQ] = useState("");
  const [nichoSel, setNichoSel] = useState<string[]>([]);
  const [soNegocio, setSoNegocio] = useState(false);

  const nichos = useMemo(() => {
    const c = new Map<string, number>();
    for (const conta of contas) for (const n of conta.nichos) c.set(n, (c.get(n) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [contas]);

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return contas.filter(
      (c) =>
        (nichoSel.length === 0 || nichoSel.some((n) => c.nichos.includes(n))) &&
        (!soNegocio || c.negocio) &&
        (!qn ||
          c.username.toLowerCase().includes(qn) ||
          c.nome.toLowerCase().includes(qn) ||
          c.bio.toLowerCase().includes(qn)),
    );
  }, [contas, q, nichoSel, soNegocio]);

  const PAGINA = 60;
  const [limite, setLimite] = useState(PAGINA);
  useEffect(() => setLimite(PAGINA), [q, nichoSel, soNegocio]);
  const visiveis = filtrados.slice(0, limite);

  function toggleNicho(n: string) {
    setNichoSel((sel) => (sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n]));
  }

  const painel = useMemo(
    () => (
      <>
        <div className="relative mb-4">
          <Search className="absolute left-2 top-2 h-4 w-4 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filtrar…"
            className="w-full rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-1.5 pl-8 pr-2 text-sm outline-none ring-1 ring-[var(--bl-border)] placeholder:text-white/25 focus:ring-[var(--bl-border-accent)]"
          />
        </div>

        <button
          onClick={() => setSoNegocio(!soNegocio)}
          className={`mb-4 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${soNegocio ? "bg-[rgba(212,168,83,0.15)] text-[var(--bl-gold)]" : "text-[var(--bl-text-secondary)] hover:text-white/90"}`}
        >
          <Building2 className="h-4 w-4" />
          só contas business
        </button>

        <Secao titulo="nicho" cor={COR_SECAO.tema.cor} corRgb={COR_SECAO.tema.rgb}>
          <button
            onClick={() => setNichoSel([])}
            className={`block w-full px-2 py-0.5 text-left text-sm ${nichoSel.length === 0 ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
          >
            todos os nichos
          </button>
          <ListaExpansivel
            itens={nichos}
            topN={12}
            render={([n, count]) => (
              <button key={n} onClick={() => toggleNicho(n)} className={linhaCls(nichoSel.includes(n))}>
                <span className="flex-1 truncate">{rotulo(n)}</span>
                <span className="text-white/30">{count}</span>
              </button>
            )}
          />
        </Secao>

        <Secao titulo="coleta" sub="(progresso)" cor={COR_SECAO.origem.cor} corRgb={COR_SECAO.origem.rgb} defaultAberto={false}>
          <p className="px-2 text-xs leading-relaxed text-white/50">
            {progresso.comBio} de {progresso.total} contas com bio
            <br />
            faltam {progresso.semBio}
            {dataHumana(progresso.atualizadoEm) && (
              <>
                <br />
                atualizado em {dataHumana(progresso.atualizadoEm)}
              </>
            )}
          </p>
        </Secao>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, nichoSel, soNegocio, nichos, progresso, rotulosNichos],
  );
  usePagePanel(painel);

  const pctScan = progresso.total ? Math.round((progresso.comBio / progresso.total) * 100) : 0;

  return (
    <div>
      <section>
        <div className="mb-4 flex items-center gap-3">
          <p className="text-xs text-white/40">
            {filtrados.length} contas
            {nichoSel.length > 0 && (
              <span className="text-white/30"> · nicho: {nichoSel.map((n) => rotulo(n)).join(", ")}</span>
            )}
          </p>
          <div className="ml-auto flex items-center gap-2 text-xs text-white/30">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-[#e1306c]" style={{ width: `${pctScan}%` }} />
            </div>
            {pctScan}% das contas com bio
          </div>
        </div>

        {contas.length === 0 ? (
          <SocialVazio
            titulo="Nenhuma conta mapeada ainda"
            arquivos={["instagram-contas/contas.json", "instagram-contas/nichos.json (opcional)", "instagram-contas/progresso.json (opcional)"]}
          >
            Coloque a lista das contas que você segue, já com os nichos de cada uma. O app só lê; quem coleta e classifica é você ou um script seu.
          </SocialVazio>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visiveis.map((c) => (
              <Link
                key={c.username}
                href={`/mysocialmedia/${encodeURIComponent(c.username)}`}
                className="block overflow-hidden rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-3 shadow-[var(--bl-shadow-md)] transition-colors hover:border-[var(--bl-border-hover)] hover:bg-[var(--bl-bg-card-hover)]"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-white/85">
                    @{c.username}
                    <ExternalLink className="h-3 w-3 shrink-0 text-white/25" />
                  </span>
                  {c.negocio && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-[#e1306c]" />}
                  <span className="ml-auto shrink-0 text-xs text-white/30">{numeroHumano(c.seguidores)} seg.</span>
                </div>
                {c.nome && c.nome !== c.username && (
                  <p className="mb-1 truncate text-xs text-white/50">{c.nome}</p>
                )}
                <p className="mb-2 line-clamp-3 whitespace-pre-line text-xs text-white/60">
                  {c.bio || <span className="italic text-white/25">sem bio</span>}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  {c.categoria && (
                    <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40">
                      {c.categoria}
                    </span>
                  )}
                  {c.nichos.map((n) => (
                    <span
                      key={n}
                      className="rounded-full bg-[rgba(168,85,247,0.15)] px-1.5 py-0.5 text-[10px] text-[#a855f7]"
                    >
                      {rotulo(n)}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}

        {limite < filtrados.length && (
          <button
            onClick={() => setLimite((l) => l + PAGINA)}
            className="mt-4 w-full rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] py-2 text-sm text-white/50 hover:bg-[var(--bl-bg-card-hover)]"
          >
            mostrar mais ({filtrados.length - limite} restantes)
          </button>
        )}
      </section>
    </div>
  );
}
