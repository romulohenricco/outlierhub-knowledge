"use client";

/** Faixa "saúde do ecossistema": núcleo + radar + faixas por procedência +
 *  pipeline de fontes. Tudo recalculado do recorte filtrado. */
import { useMemo } from "react";
import {
  avisosSaude,
  eixosRadar,
  faixasProcedencia,
  montarGrafo,
  notaSaude,
  pipelineFontes,
} from "@/lib/ecosystem-graph";
import type { EcoEntity } from "@/lib/types";
import { EcoCore } from "./EcoCore";
import { EcoRadar } from "./EcoRadar";
import { COR_PROCEDENCIA, ROTULO_PROCEDENCIA } from "./meta";

const COR_ESTADO = {
  "com-sinal": "#34d399",
  "sem-sinal": "#fbbf24",
  "sem-medicao": "#6b7280",
  vazio: "#3b4252",
} as const;
const AJUDA_ESTADO = {
  "com-sinal": "há entidades com sinal de uso",
  "sem-sinal": "medidas, mas nenhuma com sinal",
  "sem-medicao": "nenhuma entidade medida",
  vazio: "sem entidades neste recorte",
} as const;

function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-3.5">
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-[var(--bl-text-secondary)]">{titulo}</h3>
      {children}
    </section>
  );
}

export function EcoSaude({ entities }: { entities: EcoEntity[] }) {
  const d = useMemo(() => {
    const g = montarGrafo(entities);
    return {
      saude: notaSaude(entities),
      avisos: avisosSaude(entities, g),
      eixos: eixosRadar(entities),
      faixas: faixasProcedencia(entities),
      pipe: pipelineFontes(entities),
    };
  }, [entities]);
  const maiorFonte = Math.max(1, ...d.pipe.fontes.map((f) => f.total));

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Card titulo="Núcleo · nota de saúde">
        <EcoCore entities={entities} saude={d.saude} avisos={d.avisos} />
      </Card>
      <Card titulo="Radar por tipo">
        <EcoRadar eixos={d.eixos} />
      </Card>
      <Card titulo="Camadas por procedência">
        <ul className="space-y-2">
          {d.faixas.map((f) => (
            <li key={f.procedencia} className="flex items-center gap-2.5 text-xs" title={AJUDA_ESTADO[f.estado]}>
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COR_ESTADO[f.estado] }} />
              <span className="w-16 shrink-0 text-[var(--bl-text-primary)]">{ROTULO_PROCEDENCIA[f.procedencia]}</span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded bg-[var(--bl-bg-elevated)]">
                <span
                  className="absolute inset-y-0 left-0 rounded"
                  style={{ width: `${f.pct}%`, background: COR_PROCEDENCIA[f.procedencia] }}
                />
              </span>
              <span className="w-44 shrink-0 text-right whitespace-nowrap text-[var(--bl-text-dim)]">
                {f.total} · {Math.round(f.pct)}%
                {f.medidos > 0 ? ` · ${f.comSinal}/${f.medidos} c/ sinal` : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10.5px] text-[var(--bl-text-dim)]">bolinha = estado da medição de uso naquela faixa.</p>
      </Card>
      <Card titulo="Pipeline de fontes">
        <ol className="mb-3 flex items-stretch gap-1.5">
          {d.pipe.estagios.map((e, i) => (
            <li key={e.rotulo} className="flex flex-1 items-center gap-1.5">
              <div className="flex-1 rounded border border-[var(--bl-border)] px-2 py-1.5" title={e.sub}>
                <div className="text-base font-semibold text-[var(--bl-text-primary)]">{e.valor}</div>
                <div className="text-[10px] leading-tight text-[var(--bl-text-dim)]">{e.rotulo}</div>
              </div>
              {i < d.pipe.estagios.length - 1 && <span className="text-[var(--bl-text-dim)]">→</span>}
            </li>
          ))}
        </ol>
        <ul className="space-y-1">
          {d.pipe.fontes.map((f) => (
            <li key={f.fonte} className="flex items-center gap-2 text-[11px]">
              <span className="w-44 shrink-0 truncate font-mono text-[var(--bl-text-secondary)]" title={f.fonte}>
                {f.fonte}
              </span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded bg-[var(--bl-bg-elevated)]">
                <span className="absolute inset-y-0 left-0 rounded bg-[var(--bl-accent)]" style={{ width: `${(f.total / maiorFonte) * 100}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right text-[var(--bl-text-dim)]">{f.total}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
