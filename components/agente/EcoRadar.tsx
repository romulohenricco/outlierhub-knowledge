"use client";

/**
 * Teia de saúde por tipo: um eixo por kind, camadas sobrepostas, todas derivadas
 * dos dados (ver `eixosRadar`). Passar o mouse numa chip da legenda isola a camada.
 */
import { useState } from "react";
import type { EixoRadar } from "@/lib/ecosystem-graph";

const S = 480;
const C = S / 2;
const R = 150;
const LABEL_R = R + 34;

type ChaveCamada = "volume" | "ativos" | "semSinal" | "propria";
const CAMADAS: { chave: ChaveCamada; rotulo: string; cor: string; dash?: string; ajuda: string }[] = [
  { chave: "volume", rotulo: "Volume (√)", cor: "#d4a853", ajuda: "escala raiz quadrada: √(total do tipo ÷ maior tipo) × 100 — evita que o maior tipo achate os outros" },
  { chave: "ativos", rotulo: "Em uso", cor: "#34d399", dash: "6 4", ajuda: "% frequente + ocasional entre os medidos" },
  { chave: "semSinal", rotulo: "Sem sinal", cor: "#94a3b8", dash: "2 4", ajuda: "% sem-sinal entre os medidos (uso desconhecido, não morto)" },
  { chave: "propria", rotulo: "Próprias", cor: "#38bdf8", ajuda: "% de procedência própria sobre o total do tipo" },
];

const ponto = (i: number, n: number, raio: number): [number, number] => {
  const a = (i / n) * 2 * Math.PI - Math.PI / 2;
  return [C + Math.cos(a) * raio, C + Math.sin(a) * raio];
};

export function EcoRadar({ eixos }: { eixos: EixoRadar[] }) {
  const n = eixos.length;
  const [ativa, setAtiva] = useState<ChaveCamada | null>(null);
  const anel = (k: number) => Array.from({ length: n }, (_, i) => ponto(i, n, R * k).join(",")).join(" ");
  const poli = (ch: ChaveCamada) => eixos.map((a, i) => ponto(i, n, (Math.max(2, a[ch]) / 100) * R).join(",")).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto block w-full max-w-[520px]" role="img" aria-label="Radar de saúde por tipo">
        {[1 / 3, 2 / 3, 1].map((k) => (
          <polygon key={k} points={anel(k)} fill="none" stroke="var(--bl-border)" strokeWidth={1} opacity={k === 1 ? 0.9 : 0.5} />
        ))}
        {eixos.map((a, i) => {
          const [x, y] = ponto(i, n, R);
          const [lx, ly] = ponto(i, n, LABEL_R);
          return (
            <g key={a.kind}>
              <line x1={C} y1={C} x2={x} y2={y} stroke="var(--bl-border)" opacity={0.5} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-[var(--bl-text-secondary)] text-[12px] font-medium">
                {a.kind}
              </text>
              <text x={lx} y={ly + 13} textAnchor="middle" dominantBaseline="middle" className="fill-[var(--bl-text-dim)] text-[10.5px]">
                {a.total}
              </text>
            </g>
          );
        })}
        {CAMADAS.map((c) => {
          const on = ativa === c.chave;
          const op = ativa === null ? 0.9 : on ? 1 : 0.08;
          return (
            <polygon
              key={c.chave}
              points={poli(c.chave)}
              fill={c.cor}
              fillOpacity={on || (ativa === null && c.chave === "volume") ? 0.12 : 0}
              stroke={c.cor}
              strokeWidth={on ? 3 : 1.8}
              strokeDasharray={on ? undefined : c.dash}
              strokeLinejoin="round"
              opacity={op}
              style={{ transition: "opacity .15s" }}
            />
          );
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap justify-center gap-1.5 text-[11px]">
        {CAMADAS.map((c) => (
          <li key={c.chave}>
            <button
              onMouseEnter={() => setAtiva(c.chave)}
              onMouseLeave={() => setAtiva(null)}
              onFocus={() => setAtiva(c.chave)}
              onBlur={() => setAtiva(null)}
              title={c.ajuda}
              className="flex items-center gap-1.5 rounded border border-[var(--bl-border)] px-2 py-0.5 text-[var(--bl-text-secondary)]"
            >
              <span className="inline-block h-0.5 w-4" style={{ background: c.cor }} />
              {c.rotulo}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
