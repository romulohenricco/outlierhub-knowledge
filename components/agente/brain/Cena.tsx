"use client";

/** Cena persistente do Radial: a visão geral e o drill de pilar usam o MESMO conjunto de
 *  nós (ids estáveis) num único sistema de coordenadas centrado em (0,0). Trocar de
 *  visão não remonta nada: cada nó desliza (transform) e cada linha reencaixa (d) com
 *  transição CSS; quem entra nasce no pilar de origem e quem sai desvanece no lugar. */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Cena, EstiloAresta, NoCena, PilarCena } from "@/lib/brain/cena";
import type { Memoria } from "@/lib/brain/tipos";
import { type Comum, No, NuvemNotas } from "./Radial";
import { trilhaSolta } from "@/lib/brain/trilha";

/** Cena de drill vem em (0..1296, 0..678): converte pro centro. */
const DRILL_OX = 648;
const DRILL_OY = 339;
/** Pilar em foco fica em y=159 (centro); o núcleo de notas abaixo dele, em y=221. */
const NUCLEO_FOCO_Y = 221;
/** Vizinhos do anel: pilar em tamanho real a ±365px, mini-cena esmaecida. */
const VIZ_X = 365;
const VIZ_Y = 234;
const K_VIZ = 0.42;
const DUR = 900;
const EASE = "cubic-bezier(.2,.7,.2,1)";

/** Anéis-guia de fundo: o de 90px gira devagar (150s); os demais ficam parados. */
export function AnelGuia() {
  return (
    <g>
      <g>
        <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="150s" repeatCount="indefinite" />
        <circle r={90} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeDasharray="2 6" />
      </g>
      {[146, 172, 198, 223, 248].map((r) => (
        <circle key={r} r={r} fill="none" stroke="currentColor" strokeOpacity={0.09} />
      ))}
    </g>
  );
}

export const VIEWBOX_CENA = "-648 -480 1296 960";

export type Ponto = NoCena & {
  /** nome do ícone do pilar (ver lib/brain/pilar-icones.ts) */
  icone?: string | null;
  x: number;
  y: number;
  /** escala do nó (vizinhos são mini) */
  k: number;
  /** opacidade alvo (vizinhos e fundo ficam mais fracos) */
  op: number;
  /** sem rótulo (nós do fundo da visão geral e das mini-cenas) */
  fantasma: boolean;
  /** subtítulo (contagens do pilar, só na visão geral) */
  sub?: string;
};
export type Liga = { id: string; de: string; para: string; estilo: EstiloAresta; cor: string; op: number };
export type CenaAlvo = { pontos: Ponto[]; ligas: Liga[] };

const corLinha = { solida: "#e5e7eb", fina: "#94a3b8", pontilhada: "" } as const;

/** Visão geral: todos os nós do anel; o núcleo fica no centro. */
export function cenaGeralAlvo(geral: Cena, pilares: PilarCena[], contagens: Map<string, string>): CenaAlvo {
  const pilarCor = new Map(pilares.map((p) => [p.id, p.cor]));
  const pontos: Ponto[] = [
    { id: "nucleo", tipo: "avulsos", rotulo: "Notas", x: 0, y: 0, k: 1, op: 1, fantasma: false, cor: "#e35c35", pilarId: "", attrs: {} },
    ...geral.nos.map((n) => ({
      ...n,
      k: 1,
      op: 1,
      icone: n.tipo === "pilar" ? pilares.find((p) => p.id === n.id)?.icone : undefined,
      fantasma: n.tipo !== "pilar",
      sub: n.tipo === "pilar" ? contagens.get(n.id) : undefined,
    })),
  ];
  const ligas = geral.arestas.map((a, i) => ({
    id: `g:${i}:${a.de}|${a.para}`,
    de: a.de,
    para: a.para,
    estilo: a.estilo,
    cor: a.estilo === "pontilhada" ? (pilarCor.get(a.de) ?? "#94a3b8") : "#94a3b8",
    op: 1,
  }));
  return { pontos, ligas };
}

type Vizinho = { lado: -1 | 1; pilar: PilarCena; cena: Cena };

/** Drill do pilar em foco + mini-cenas dos vizinhos (ids dos vizinhos prefixados pra não colidir). */
export function cenaFocoAlvo(foco: Cena, pilar: PilarCena, vizinhos: Vizinho[], opVizinho: number): CenaAlvo {
  const local = (x: number, y: number) => ({ x: x - DRILL_OX, y: y - DRILL_OY });
  const pontos: Ponto[] = [
    { id: "nucleo", tipo: "avulsos", rotulo: "Notas", x: 0, y: NUCLEO_FOCO_Y, k: 1, op: 1, fantasma: false, cor: "#e35c35", pilarId: pilar.id, attrs: {} },
  ];
  for (const n of foco.nos) {
    const p = local(n.x, n.y);
    pontos.push({ ...n, x: p.x, y: p.y, k: 1, op: 1, fantasma: false });
  }
  const ligas: Liga[] = foco.arestas.map((a, i) => ({
    id: `f:${i}:${a.de}|${a.para}`,
    de: a.de,
    para: a.para,
    estilo: a.estilo,
    cor: a.estilo === "pontilhada" ? pilar.cor : "",
    op: 1,
  }));
  for (const v of vizinhos) {
    const pn = v.cena.nos.find((n) => n.tipo === "pilar");
    if (!pn) continue;
    const base = local(pn.x, pn.y);
    const ax = v.lado * VIZ_X;
    const ay = VIZ_Y;
    const pref = (id: string) => (id === pn.id ? id : `v:${v.pilar.id}:${id}`);
    pontos.push({ ...pn, id: v.pilar.id, x: ax, y: ay, k: 1, op: opVizinho + 0.35, fantasma: false, pilarId: v.pilar.id });
    for (const n of v.cena.nos) {
      if (n.tipo === "pilar") continue;
      const p = local(n.x, n.y);
      pontos.push({
        ...n,
        id: pref(n.id),
        x: ax + K_VIZ * (p.x - base.x),
        y: ay + K_VIZ * (p.y - base.y),
        k: K_VIZ,
        op: opVizinho,
        fantasma: true,
        pilarId: v.pilar.id,
      });
    }
    v.cena.arestas.forEach((a, i) =>
      ligas.push({
        id: `v:${v.pilar.id}:${i}`,
        de: pref(a.de),
        para: pref(a.para),
        estilo: a.estilo,
        cor: a.estilo === "pontilhada" ? v.pilar.cor : "",
        op: opVizinho * 0.6,
      }),
    );
  }
  return { pontos, ligas };
}

type Vis = { ponto: Ponto; x: number; y: number; k: number; op: number };
type LigaVis = Liga & { ativa: boolean };

/** Renderiza a cena e anima a passagem entre alvos (entrada: origem → alvo; saída: fade no lugar). */
export const CenaGrafo = memo(function CenaGrafo({
  alvo, c, mem, onNotas, pilarFocoId,
}: {
  alvo: CenaAlvo;
  c: Comum;
  mem: Memoria | null;
  onNotas: () => void;
  pilarFocoId: string | null;
}) {
  const [vis, setVis] = useState<Map<string, Vis>>(() => new Map(alvo.pontos.map((p) => [p.id, { ponto: p, x: p.x, y: p.y, k: p.k, op: p.op }])));
  const [ligas, setLigas] = useState<LigaVis[]>(() => alvo.ligas.map((l) => ({ ...l, ativa: true })));
  const primeiro = useRef(true);
  const timers = useRef<number[]>([]);
  const frames = useRef<number[]>([]);

  useEffect(() => {
    if (primeiro.current) {
      primeiro.current = false;
      return;
    }
    timers.current.forEach(clearTimeout);
    frames.current.forEach(cancelAnimationFrame);
    timers.current = [];
    frames.current = [];
    const ids = new Set(alvo.pontos.map((p) => p.id));
    const ligaIds = new Set(alvo.ligas.map((l) => l.id));
    const origemDe = (p: Ponto) => {
      const pai = alvo.pontos.find((q) => q.tipo === "pilar" && q.pilarId === p.pilarId);
      return pai ? { x: pai.x, y: pai.y } : { x: 0, y: 0 };
    };
    // 1) quem entra nasce na origem invisível; quem sai fica onde está e desvanece
    setVis((antes) => {
      const prox = new Map<string, Vis>();
      for (const p of alvo.pontos) {
        const v = antes.get(p.id);
        if (v) prox.set(p.id, { ponto: p, x: v.x, y: v.y, k: v.k, op: v.op });
        else {
          const o = origemDe(p);
          prox.set(p.id, { ponto: p, x: o.x, y: o.y, k: p.k, op: 0 });
        }
      }
      for (const [id, v] of antes) if (!ids.has(id)) prox.set(id, { ...v, op: 0 });
      return prox;
    });
    setLigas((antes) => {
      const idsAntes = new Set(antes.map((l) => l.id));
      const entram = alvo.ligas.map((l) => ({ ...l, ativa: true, op: idsAntes.has(l.id) ? l.op : 0 }));
      const saem = antes.filter((l) => !ligaIds.has(l.id)).map((l) => ({ ...l, ativa: false, op: 0 }));
      return [...entram, ...saem];
    });
    // 2) dois frames depois o alvo: o navegador já pintou a origem, então a transição roda
    const f1 = requestAnimationFrame(() => {
      const f2 = requestAnimationFrame(() => {
        setVis((antes) => {
          const prox = new Map<string, Vis>();
          for (const p of alvo.pontos) prox.set(p.id, { ponto: p, x: p.x, y: p.y, k: p.k, op: p.op });
          for (const [id, v] of antes) if (!ids.has(id)) prox.set(id, { ...v, op: 0 });
          return prox;
        });
        setLigas((antes) => [
          ...alvo.ligas.map((l) => ({ ...l, ativa: true })),
          ...antes.filter((l) => !ligaIds.has(l.id)).map((l) => ({ ...l, ativa: false, op: 0 })),
        ]);
      });
      frames.current.push(f2);
    });
    frames.current.push(f1);
    // 3) remove quem saiu, depois da transição
    timers.current.push(
      window.setTimeout(() => {
        setVis((antes) => new Map([...antes].filter(([id]) => ids.has(id))));
        setLigas(alvo.ligas.map((l) => ({ ...l, ativa: true })));
      }, DUR + 100),
    );
  }, [alvo]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      frames.current.forEach(cancelAnimationFrame);
    },
    [],
  );

  // nível de rótulo (0..2) por ordem em x dentro de cada fileira: vizinhos de fileira ficam em níveis
  // diferentes, então o nome de um não atropela o do outro (o zoom escala texto e espaçamento juntos)
  const niveis = useMemo(() => {
    const fileiras = new Map<number, Ponto[]>();
    for (const p of alvo.pontos) {
      if (p.fantasma || p.tipo === "pilar" || p.tipo === "avulsos") continue;
      const chave = Math.round(p.y / 40);
      fileiras.set(chave, [...(fileiras.get(chave) ?? []), p]);
    }
    const mapa = new Map<string, number>();
    for (const linha of fileiras.values()) {
      linha.sort((a, b) => a.x - b.x).forEach((p, i) => mapa.set(p.id, i % 3));
    }
    return mapa;
  }, [alvo]);
  const porId = new Map([...vis].map(([id, v]) => [id, v]));
  const trans = `transform ${DUR}ms ${EASE}, opacity 600ms ease`;
  return (
    <g>
      <style>{`@keyframes bl-pacote{to{stroke-dashoffset:-45}}.bl-pacote{animation:bl-pacote 1.8s linear infinite}@media (prefers-reduced-motion:reduce){.bl-pacote{animation:none}}`}</style>
      {/* linhas: reencaixam nos novos pontos (d transita) */}
      {ligas.map((l) => {
        const a = porId.get(l.de);
        const b = porId.get(l.para);
        if (!a || !b) return null;
        const forte = l.ativa && (c.hoverId === l.de || c.hoverId === l.para || c.selId === l.de || c.selId === l.para);
        // topologia quieta: a linha base fica fraca; a informação de atividade são os pacotes
        const base = (l.estilo === "pontilhada" ? 0.55 : l.estilo === "solida" ? 0.6 : 0.3) * 0.35;
        const op = l.ativa ? (forte ? 0.95 : base) : 0;
        const cor = l.cor || corLinha[l.estilo] || "#94a3b8";
        const trilha = trilhaSolta(a, b, l.id);
        return (
          <g key={l.id}>
            <path
              d={trilha}
              fill="none"
              stroke={cor}
              strokeWidth={forte ? 1.6 : l.estilo === "fina" ? 0.8 : 1.1}
              strokeDasharray={l.estilo === "pontilhada" ? "2 4" : undefined}
              strokeLinecap="round"
              strokeOpacity={op}
              style={{ transition: `d ${DUR}ms ${EASE}, stroke-opacity 600ms ease` }}
            />
            {/* pacotes: segmentos vivos que percorrem a rota de origem → destino */}
            {l.ativa && (
              <path
                className="bl-pacote"
                d={trilha}
                fill="none"
                stroke={cor}
                strokeWidth={forte ? 2.2 : 1.5}
                strokeDasharray="7 8"
                strokeLinecap="round"
                strokeOpacity={forte ? 1 : 0.7}
                style={{ transition: `d ${DUR}ms ${EASE}, stroke-opacity 600ms ease`, pointerEvents: "none" }}
              />
            )}
          </g>
        );
      })}
      {[...vis.values()].map((v) => {
        const p = v.ponto;
        if (p.id === "nucleo") {
          return (
            <g
              key="nucleo"
              onClick={pilarFocoId ? undefined : onNotas}
              style={{ transform: `translate(${v.x}px, ${v.y}px)`, opacity: v.op, transition: trans, cursor: pilarFocoId ? "default" : "pointer" }}
              role="button"
              aria-label="abrir as notas"
              data-testid="nucleo-notas"
            >
              <circle r={62} fill="var(--bl-bg-card-solid)" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.2} />
              <NuvemNotas quantidade={mem ? (pilarFocoId ? Math.round(mem.notas.length / 6) : mem.notas.length) : 0} raio={pilarFocoId ? 40 : 50} cores={[]} />
              <text y={70} textAnchor="middle" fontSize={11.2} fill="currentColor" fillOpacity={0.55} className="font-mono">
                Notas
              </text>
            </g>
          );
        }
        return (
          <g
            key={p.id}
            style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})`, transformOrigin: "0 0", opacity: v.op, transition: trans, pointerEvents: v.op < 0.05 ? "none" : undefined }}
          >
            <No n={{ ...p, x: 0, y: 0 }} idx={niveis.get(p.id) ?? 0} c={c} fantasma={p.fantasma} />
            {p.sub && (
              <text y={35} textAnchor="middle" fontSize={9.5} fill="currentColor" fillOpacity={0.5} className="font-mono">
                {p.sub}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});
