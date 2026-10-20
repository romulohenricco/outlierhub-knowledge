/** Glifos SVG dos nós (desenhados aqui, traço 1.6 em caixa 24x24). */
import type { TipoNo } from "@/lib/brain/cena";

type P = { x: number; y: number; r: number; cor: string; sw?: number };

const TRACO = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Desenha o glifo do `tipo` centrado em (x,y) com raio visual `r`. */
export function Glifo({ tipo, x, y, r, cor, sw = 1.6, icone }: P & { tipo: TipoNo | "nota"; icone?: string }) {
  const k = r / 12;
  const g = `translate(${x - 12 * k} ${y - 12 * k}) scale(${k})`;
  const comum = { stroke: cor, strokeWidth: sw / k, ...TRACO };
  // glifo explícito (ícone do pilar, vindo de ICONE_PILAR) tem prioridade sobre o do tipo
  if (icone) return <g transform={g} {...comum} dangerouslySetInnerHTML={{ __html: icone }} />;
  switch (tipo) {
    case "pilar":
      return (
        <g transform={g} {...comum}>
          <circle cx="9" cy="8.5" r="3" />
          <path d="M3.5 19c.4-3.2 2.6-5 5.5-5s5.1 1.8 5.5 5" />
          <circle cx="16.5" cy="9.5" r="2.4" />
          <path d="M16 14.2c2.4.1 4 1.6 4.5 4.3" />
        </g>
      );
    case "agente":
    case "humano":
      return (
        <g transform={g} {...comum}>
          <circle cx="12" cy="8.5" r="3.4" />
          <path d="M5 20c.5-3.8 3.1-6 7-6s6.5 2.2 7 6" />
        </g>
      );
    case "worker":
      return (
        <g transform={g} {...comum}>
          <rect x="4" y="6.5" width="16" height="12" rx="3" />
          <circle cx="9" cy="12.5" r="1.2" />
          <circle cx="15" cy="12.5" r="1.2" />
          <path d="M12 6.5V4M9.5 4h5" />
        </g>
      );
    case "ferramenta":
    case "skill":
      return (
        <g transform={g} {...comum}>
          <path d="M14.5 6.2a4 4 0 0 0 4.9 4.9l-9.8 9.8a2 2 0 0 1-2.8-2.8l9.8-9.8a4 4 0 0 1-2.1-2.1z" />
        </g>
      );
    case "tarefa":
      return (
        <g transform={g} {...comum}>
          <rect x="5" y="4.5" width="14" height="16" rx="2" />
          <path d="M9 4.5V3.5h6v1M8.5 10h7M8.5 13.5h7M8.5 17h4" />
        </g>
      );
    case "squad":
      return (
        <g transform={g} {...comum}>
          <circle cx="12" cy="6.5" r="2.4" />
          <circle cx="6" cy="17" r="2.4" />
          <circle cx="18" cy="17" r="2.4" />
          <path d="M12 9v3M12 12l-4.6 3M12 12l4.6 3" />
        </g>
      );
    case "nota":
      return (
        <g transform={g} {...comum}>
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        </g>
      );
    default:
      return <circle cx={x} cy={y} r={r * 0.45} fill={cor} />;
  }
}

/** Versão HTML (legenda, diretório): círculo com o glifo dentro. */
export function IconeRedondo({ tipo, cor, tamanho = 20 }: { tipo: TipoNo | "nota"; cor: string; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden className="bl-icone-vivo shrink-0">
      <circle cx="12" cy="12" r="11" fill="none" stroke={cor} strokeWidth="1.2" opacity="0.9" />
      <Glifo tipo={tipo} x={12} y={12} r={7} cor={cor} sw={1.5} />
    </svg>
  );
}
