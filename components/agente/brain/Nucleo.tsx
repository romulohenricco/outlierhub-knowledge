"use client";

/** Núcleo de memória (SVG): constelação de notas ligadas pelos links reais do
 *  texto, com os hubs (pastas) em hexágono. Coordenadas relativas ao centro. */
import { memo } from "react";
import type { Memoria } from "@/lib/brain/tipos";
import { RAIO_NUCLEO } from "@/lib/brain/cena";
import { layoutNucleo } from "@/lib/brain/nucleo-layout";

const COR_NOTA = "#fb923c";

const hex = (x: number, y: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => `${x + Math.cos((Math.PI / 3) * i + Math.PI / 6) * r},${y + Math.sin((Math.PI / 3) * i + Math.PI / 6) * r}`).join(" ");

export const Nucleo = memo(function Nucleo({
  mem,
  destaque,
  raio = RAIO_NUCLEO,
  aoNota,
}: {
  mem: Memoria;
  destaque: string | null;
  /** raio do disco: o da visão geral, ou maior quando o núcleo vira a tela toda */
  raio?: number;
  aoNota?: (id: string) => void;
}) {
  const lay = layoutNucleo(mem, raio);
  return (
    <g>
      <circle r={raio + 14} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={6} />
      <circle r={raio} fill="var(--bl-bg-card-solid)" stroke="currentColor" strokeOpacity={0.3} />
      <g stroke={COR_NOTA} strokeOpacity={0.3} strokeWidth={0.6}>
        {mem.links.map(([a, b]) => {
          const pa = lay.notas.get(a);
          const pb = lay.notas.get(b);
          return pa && pb ? <line key={`${a}|${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} /> : null;
        })}
      </g>
      {mem.notas.map((n) => {
        const p = lay.notas.get(n.id)!;
        const ativo = destaque === n.id;
        return (
          <circle
            key={n.id}
            cx={p.x}
            cy={p.y}
            r={ativo ? 6 : p.r}
            fill={COR_NOTA}
            fillOpacity={ativo ? 1 : 0.85}
            stroke={ativo ? "#fff" : "none"}
            strokeWidth={1.5}
            style={aoNota ? { cursor: "pointer" } : undefined}
            onClick={aoNota ? () => aoNota(n.id) : undefined}
          >
            <title>{`${n.titulo} · ${n.hub} · ${n.grau} link${n.grau > 1 ? "s" : ""}`}</title>
          </circle>
        );
      })}
      {[...lay.hubs].map(([id, p]) => {
        const h = mem.hubs.find((x) => x.id === id)!;
        return (
          <g key={id}>
            <polygon points={hex(p.x, p.y, 15)} fill="var(--bl-bg-card-solid)" stroke={COR_NOTA} strokeWidth={1.6} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11} fill={COR_NOTA}>
              ✦
            </text>
            <text x={p.x} y={p.y + 30} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.75} className="font-mono">
              {h.nome}
            </text>
            <title>{`${h.nome} · ${h.total} notas`}</title>
          </g>
        );
      })}
      {destaque && lay.notas.get(destaque) && (
        <text x={lay.notas.get(destaque)!.x} y={lay.notas.get(destaque)!.y - 10} textAnchor="middle" fontSize={11} fill="#fff" stroke="var(--bl-bg-card-solid)" strokeWidth={3} paintOrder="stroke" className="font-mono">
          {mem.notas.find((n) => n.id === destaque)?.titulo.slice(0, 40)}
        </text>
      )}
    </g>
  );
});
