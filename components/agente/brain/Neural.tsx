"use client";

/** Aba Neural: FERRAMENTAS → EXECUTORES → TAREFAS → PILARES → MEMÓRIA, com feixes
 *  curvos na cor do pilar. Cada feixe é uma relação real (ver lib/brain/neural.ts). */
import { useMemo, useState } from "react";
import type { Neural as NeuralDados } from "@/lib/brain/neural";

// 5 colunas, linhas de ~19px, rótulos das ferramentas à esquerda
const LARG = 1100;
const PASSO = 19;
const TOPO = 70;
// reserva à esquerda pro maior rótulo das ferramentas (truncado em ROTULO_MAX; nome inteiro no tooltip)
const ROTULO_MAX = 24;
const MARGEM_ESQ = 200;
const MARGEM_DIR = 160;
const corta = (s: string) => (s.length > ROTULO_MAX ? `${s.slice(0, ROTULO_MAX - 1)}…` : s);

export function NeuralView({ dados }: { dados: NeuralDados }) {
  const [hover, setHover] = useState<string | null>(null);
  const maxLinhas = Math.max(1, ...dados.colunas.map((c) => c.nos.length));
  const alt = Math.max(420, TOPO + maxLinhas * PASSO + 30);
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    dados.colunas.forEach((c, ci) => {
      const x = MARGEM_ESQ + (ci * (LARG - MARGEM_ESQ - MARGEM_DIR)) / (dados.colunas.length - 1);
      const alturaCol = c.nos.length * PASSO;
      const y0 = TOPO + (alt - TOPO - 20 - alturaCol) / 2;
      c.nos.forEach((n, i) => m.set(n.id, { x, y: y0 + i * PASSO + PASSO / 2 }));
    });
    return m;
  }, [dados, alt]);
  const ligados = useMemo(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    // propaga nas duas direções pra mostrar o caminho inteiro do nó
    for (const dir of ["de", "para"] as const) {
      let fronteira = [hover];
      while (fronteira.length) {
        const prox: string[] = [];
        for (const f of dados.feixes) {
          const a = dir === "de" ? f.de : f.para;
          const b = dir === "de" ? f.para : f.de;
          if (fronteira.includes(a) && !s.has(b)) {
            s.add(b);
            prox.push(b);
          }
        }
        fronteira = prox;
      }
    }
    return s;
  }, [hover, dados.feixes]);

  return (
    <svg viewBox={`0 0 ${LARG} ${alt}`} className="block w-full text-[var(--bl-text-primary)]" role="img" aria-label="camadas neurais do grafo">
      <rect width={LARG} height={alt} fill="#070b18" />
      {/* elipses-guia de fundo */}
      <g fill="none" stroke="#1e2a4a" strokeOpacity={0.7}>
        {[0.42, 0.5, 0.58].map((f) => (
          <ellipse key={f} cx={LARG / 2} cy={alt / 2} rx={LARG * f} ry={alt * f * 0.62} />
        ))}
      </g>
      {dados.colunas.map((c) => {
        const x = pos.get(c.nos[0]?.id ?? "")?.x ?? 0;
        return (
          c.nos.length > 0 && (
            <text key={c.id} x={x} y={56} textAnchor="middle" fontSize={10} letterSpacing={1.5} fill="#8aa0d8" className="font-mono">
              {c.titulo}
            </text>
          )
        );
      })}
      <g fill="none">
        {dados.feixes.map((f, i) => {
          const a = pos.get(f.de);
          const b = pos.get(f.para);
          if (!a || !b) return null;
          const m = (a.x + b.x) / 2;
          const quente = ligados ? ligados.has(f.de) && ligados.has(f.para) : false;
          return (
            <path
              key={i}
              d={`M${a.x} ${a.y} C${m} ${a.y} ${m} ${b.y} ${b.x} ${b.y}`}
              stroke={f.cor}
              strokeWidth={quente ? 1.8 : 0.9}
              strokeOpacity={ligados ? (quente ? 0.95 : 0.04) : 0.32}
              style={{ transition: "stroke-opacity 300ms ease, stroke-width 300ms ease" }}
            />
          );
        })}
      </g>
      {dados.colunas.map((c, ci) =>
        c.nos.map((n) => {
          const p = pos.get(n.id)!;
          const rotulo = ci === 0 || ci === 3 || ci === 4;
          return (
            <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
              <circle cx={p.x} cy={p.y} r={ci === 3 ? 4 : 2.6} fill={ci === 3 || ci === 4 ? n.cor : "#fff"} fillOpacity={ligados && !ligados.has(n.id) ? 0.2 : 0.95} style={{ transition: "fill-opacity 300ms ease" }} />
              {rotulo && (
                <text
                  x={ci === 0 ? p.x - 9 : p.x + 9}
                  y={p.y + 3}
                  textAnchor={ci === 0 ? "end" : "start"}
                  fontSize={ci === 0 ? 8.5 : 11}
                  fill={ci === 0 ? "#8aa0d8" : "#cbd5f5"}
                  fillOpacity={ligados && !ligados.has(n.id) ? 0.25 : 0.85}
                  style={{ transition: "fill-opacity 300ms ease" }}
                  className="font-mono"
                >
                  {ci === 0 ? corta(n.rotulo) : n.rotulo}
                </text>
              )}
              <title>{n.rotulo}</title>
            </g>
          );
        }),
      )}
    </svg>
  );
}
