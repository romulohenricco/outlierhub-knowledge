"use client";

/** Radial: visão geral em anel (pilares, agentes e pessoas, tarefas, ferramentas,
 *  núcleo de notas) e drill-in de um pilar (pilar embaixo, agentes e tarefas em
 *  fileiras, ferramentas no topo, vizinhos do anel esmaecidos nas laterais). SVG em
 *  px a partir do centro (0,0). */
import { memo } from "react";
import { type Cena, type NoCena, type PilarCena } from "@/lib/brain/cena";
import type { Memoria } from "@/lib/brain/tipos";
import { Glifo } from "./icones";
import { ICONE_PILAR } from "./icones-pilar";
import { MOVIMENTO_GLIFO } from "./icones-movimento";
import { iconePilar } from "@/lib/brain/pilar-icones";
import { Nucleo } from "./Nucleo";

// raio de cada tipo de nó (px)
const RAIO: Record<NoCena["tipo"], number> = {
  pilar: 15, agente: 11, humano: 11, ferramenta: 8.5, tarefa: 6, squad: 12, worker: 9, skill: 8, avulsos: 0,
};
const COR_NOTA = "#e35c35";
const COR_TAREFA = "#9ca3af";

const corta = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type Comum = {
  casa: (n: NoCena) => boolean;
  selId: string | null;
  hoverId: string | null;
  onSelecionar: (n: NoCena) => void;
  onHover: (id: string | null) => void;
};

/** Nuvem de notas do núcleo: uma por nota, espiral áurea (forma estável entre renders). */
export function NuvemNotas({ quantidade, raio, cores }: { quantidade: number; raio: number; cores: string[] }) {
  const pts = Array.from({ length: Math.max(quantidade, 0) }, (_, i) => {
    const a = i * 2.39996;
    const r = raio * Math.sqrt((i + 0.5) / quantidade);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, i };
  });
  return (
    <g>
      {pts.map((p) => {
        const pilar = p.i % 4 === 0 && cores.length > 0;
        return <circle key={p.i} cx={p.x} cy={p.y} r={pilar ? 2.3 : 2} fill={pilar ? cores[p.i % cores.length] : COR_NOTA} fillOpacity={0.9} />;
      })}
    </g>
  );
}

/** Esfera 3D do pilar: cor do pilar com brilho no topo-esquerdo e sombra embaixo (SVG puro). */
function Esfera3D({ x, y, r, cor }: { x: number; y: number; r: number; cor: string }) {
  return (
    <g>
      <defs>
        <radialGradient id="bl-esfera-3d" cx="35%" cy="28%" r="78%">
          <stop offset="0" stopColor="#fff" stopOpacity={0.55} />
          <stop offset="0.42" stopColor="#fff" stopOpacity={0.06} />
          <stop offset="1" stopColor="#000" stopOpacity={0.5} />
        </radialGradient>
        <filter id="bl-sombra-3d" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#000" floodOpacity={0.65} />
        </filter>
      </defs>
      <circle cx={x} cy={y} r={r} fill={cor} fillOpacity={0.28} filter="url(#bl-sombra-3d)" />
      <circle cx={x} cy={y} r={r} fill="url(#bl-esfera-3d)" />
    </g>
  );
}

export function No({ n, idx, c, fantasma, k = 1 }: { n: NoCena & { icone?: string | null }; idx: number; c: Comum; fantasma?: boolean; k?: number }) {
  const r = RAIO[n.tipo] * k;
  const casa = c.casa(n);
  const sel = c.selId === n.id || c.selId === n.refId;
  const op = fantasma ? (casa ? 1 : 0.18) : casa ? 1 : 0.18;
  if (n.tipo === "avulsos") return null;
  const clicavel = !fantasma || n.tipo === "pilar";
  const tarefa = n.tipo === "tarefa";
  // movimento do glifo: o wrapper externo recebe o hover (escala de mola); o interno, o respiro contínuo
  const respira = MOVIMENTO_GLIFO[n.tipo] === "respira";
  const glifo = (
    <g className="bl-glifo">
      <g className={respira ? "bl-respira" : undefined} style={respira ? { animationDelay: `${(idx % 7) * 260}ms` } : undefined}>
        {n.tipo === "tarefa" ? <Glifo tipo="tarefa" x={n.x} y={n.y} r={5.5} cor={COR_TAREFA} sw={1.2} /> : <Glifo tipo={n.tipo} x={n.x} y={n.y} r={r * 0.6} cor={n.cor} sw={1.3} icone={n.tipo === "pilar" ? ICONE_PILAR[iconePilar(n.icone)] : undefined} />}
      </g>
    </g>
  );
  return (
    <g
      className="bl-no"
      style={{ opacity: op, transition: "opacity 350ms ease", cursor: clicavel ? "pointer" : "default" }}
      onClick={clicavel ? () => c.onSelecionar(n) : undefined}
      onMouseEnter={clicavel ? () => c.onHover(n.id) : undefined}
      onMouseLeave={clicavel ? () => c.onHover(null) : undefined}
      role={clicavel ? "button" : undefined}
      aria-label={clicavel ? n.rotulo : undefined}
    >
      {tarefa ? (
        <>
          <rect x={n.x - 6} y={n.y - 6} width={12} height={12} rx={2} fill="var(--bl-bg-card-solid)" stroke={COR_TAREFA} strokeWidth={1} />
          <g className="bl-glifo">
            <g>
              <Glifo tipo="tarefa" x={n.x} y={n.y} r={5.5} cor={COR_TAREFA} sw={1.2} />
            </g>
          </g>
        </>
      ) : (
        <>
          {sel && <circle className="bl-surge" cx={n.x} cy={n.y} r={r + 6} fill="none" stroke={n.cor} strokeWidth={1.2} strokeOpacity={0.8} />}
          {sel && <circle className="bl-anel-pulso" cx={n.x} cy={n.y} r={r + 6} fill="none" stroke={n.cor} strokeWidth={1} />}
          <circle cx={n.x} cy={n.y} r={r} fill="var(--bl-bg-card-solid)" stroke={n.cor} strokeWidth={n.tipo === "pilar" ? 1.5 : 1.3} />
          {n.tipo === "pilar" && <Esfera3D x={n.x} y={n.y} r={r} cor={n.cor} />}
          {glifo}
        </>
      )}
      {!fantasma && (
        <text
          x={n.x}
          y={n.y + (n.tipo === "pilar" ? 22 : tarefa ? 14 + (idx % 3) * 12 : r + 8 + (idx % 3) * 12)}
          textAnchor="middle"
          fontSize={n.tipo === "pilar" ? 11.2 * k : 10.5 * k}
          fill={n.tipo === "pilar" ? n.cor : "currentColor"}
          fillOpacity={n.tipo === "pilar" ? 1 : 0.7}
          className="font-mono"
        >
          {corta(n.rotulo, n.tipo === "pilar" ? 22 : 17)}
        </text>
      )}
      <title>{n.rotulo}</title>
    </g>
  );
}

/** Zoom das notas (clique no núcleo de notas): a constelação ocupa o centro, os pilares formam
 *  um anel maior nos mesmos ângulos e o resto do grafo fica esmaecido ao fundo. */
export const NotasZoom = memo(function NotasZoom({
  cena, pilares, mem, notaDestaque, aoNota, c, contagens,
}: {
  cena: Cena;
  pilares: PilarCena[];
  mem: Memoria;
  notaDestaque: string | null;
  aoNota: (id: string) => void;
  c: Comum;
  contagens: Map<string, string>;
}) {
  const R_PILARES = 300;
  const posPilar = (n: NoCena) => {
    const a = Math.atan2(n.y, n.x);
    return { x: Math.cos(a) * R_PILARES, y: Math.sin(a) * R_PILARES };
  };
  const porId = new Map(cena.nos.map((n) => [n.id, n]));
  return (
    <g>
      <g opacity={0.12} style={{ pointerEvents: "none" }}>
        {cena.nos.filter((n) => n.tipo !== "pilar").map((n, i) => (
          <No key={n.id} n={n} idx={i} c={c} fantasma />
        ))}
      </g>
      <Nucleo mem={mem} destaque={notaDestaque} raio={250} aoNota={aoNota} />
      {pilares.map((p) => {
        const n = porId.get(p.id);
        if (!n) return null;
        const q = posPilar(n);
        return (
          <g key={p.id} transform={`translate(${q.x - n.x} ${q.y - n.y})`}>
            <No n={{ ...n, icone: p.icone }} idx={0} c={c} />
            <text x={n.x} y={n.y + 35} textAnchor="middle" fontSize={9.5} fill="currentColor" fillOpacity={0.5} className="font-mono">
              {contagens.get(p.id)}
            </text>
          </g>
        );
      })}
    </g>
  );
});
