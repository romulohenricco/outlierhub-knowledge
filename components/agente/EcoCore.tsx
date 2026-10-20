"use client";

/**
 * Núcleo: nota de saúde no centro, anel externo repartido por procedência e
 * satélites por tipo (área = volume). A fórmula da nota é a mesma que o
 * tooltip mostra (`FORMULA_SAUDE`), vinda da lib.
 */
import { FORMULA_SAUDE, KIND_ORDEM, type Saude } from "@/lib/ecosystem-graph";
import type { EcoEntity, EcoProcedencia } from "@/lib/types";
import { COR_KIND, COR_PROCEDENCIA, ROTULO_PROCEDENCIA } from "./meta";

const S = 280;
const C = S / 2;

export function EcoCore({ entities, saude, avisos }: { entities: EcoEntity[]; saude: Saude; avisos: string[] }) {
  const total = entities.length;
  const porProc: Record<EcoProcedencia, number> = { propria: 0, adotada: 0, terceiro: 0 };
  for (const e of entities) porProc[e.procedencia]++;

  // arcos do anel de procedência
  const R1 = 62;
  const R2 = 74;
  let acc = 0;
  const arcos = (Object.keys(porProc) as EcoProcedencia[])
    .filter((p) => porProc[p] > 0)
    .map((p) => {
      const a0 = (acc / total) * 2 * Math.PI - Math.PI / 2;
      acc += porProc[p];
      const a1 = (acc / total) * 2 * Math.PI - Math.PI / 2;
      const grande = a1 - a0 > Math.PI ? 1 : 0;
      const pt = (r: number, a: number) => `${C + Math.cos(a) * r} ${C + Math.sin(a) * r}`;
      // arco fechado de 360° degenera; encurta 0.001rad
      const fim = a1 - a0 >= 2 * Math.PI ? a1 - 0.001 : a1;
      return {
        p,
        d: `M ${pt(R2, a0)} A ${R2} ${R2} 0 ${grande} 1 ${pt(R2, fim)} L ${pt(R1, fim)} A ${R1} ${R1} 0 ${grande} 0 ${pt(R1, a0)} Z`,
      };
    });

  const kinds = KIND_ORDEM.map((k) => ({ k, n: entities.filter((e) => e.kind === k).length })).filter((x) => x.n > 0);
  const maior = Math.max(1, ...kinds.map((x) => x.n));

  return (
    <div>
      <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto block w-full max-w-[260px]" role="img" aria-label="Núcleo de saúde do ecossistema">
        <title>{FORMULA_SAUDE}</title>
        <circle cx={C} cy={C} r={R1 - 6} fill="var(--bl-bg-elevated)" stroke="var(--bl-border)" />
        {arcos.map((a) => (
          <path key={a.p} d={a.d} fill={COR_PROCEDENCIA[a.p]} opacity={0.85}>
            <title>{`${ROTULO_PROCEDENCIA[a.p]}: ${porProc[a.p]} de ${total}`}</title>
          </path>
        ))}
        {kinds.map(({ k, n }, i) => {
          const ang = (i / kinds.length) * 2 * Math.PI - Math.PI / 2;
          const r = 3 + Math.sqrt(n / maior) * 8;
          return (
            <circle key={k} cx={C + Math.cos(ang) * 110} cy={C + Math.sin(ang) * 110} r={r} fill={COR_KIND[k]}>
              <title>{`${k}: ${n}`}</title>
            </circle>
          );
        })}
        <text x={C} y={C + 6} textAnchor="middle" className="fill-[var(--bl-text-primary)] text-[30px] font-semibold">
          {saude.nota === null ? "—" : saude.nota}
        </text>
        <text x={C} y={C + 24} textAnchor="middle" className="fill-[var(--bl-text-dim)] text-[9px] uppercase tracking-wide">
          {saude.nota === null ? "sem medição" : "de 100"}
        </text>
      </svg>
      <p className="mt-1 text-center text-[11px] text-[var(--bl-text-secondary)]">
        {saude.comSinal} de {saude.medidos} medidas com sinal · cobertura {saude.cobertura}% de {total}
      </p>
      <details className="mt-1 text-[10.5px] leading-snug text-[var(--bl-text-dim)]">
        <summary className="cursor-pointer">como a nota é calculada</summary>
        <p className="mt-1">{FORMULA_SAUDE}</p>
      </details>
      {avisos.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[10.5px] text-amber-300/90">
          {avisos.map((a) => (
            <li key={a}>⚠ {a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
