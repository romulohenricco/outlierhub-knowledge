"use client";

/**
 * Ontologia em GRAFO — dois modos:
 *  · Árvore: cards por nó (HTML) + arestas SVG, pan (arrastar) e zoom (wheel) por transform
 *    próprio — sem @xyflow. Layout determinístico em lib/ontologia-layout.ts.
 *  · Grafo (botão; internamente modo "forca"): react-force-graph-2d (já no projeto, como em Grafo.tsx).
 * Recebe {nodes, links} já montados no servidor (lib/ontologia-grafo.ts) — só serializáveis.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ForceGraphMethods, ForceGraphProps, LinkObject, NodeObject } from "react-force-graph-2d";
import { Maximize, Maximize2, Minimize } from "lucide-react";
import type { OntNo, OntRel } from "@/lib/ontologia-grafo";
import { layoutTree, DEFAULT_LAYOUT, type LayoutInput } from "@/lib/ontologia-layout";
import { ICONE } from "@/components/ontologia/icones";
import PainelNo from "@/components/ontologia/PainelNo";
import RaioX from "@/components/ontologia/RaioX";

const ForceGraph2DBase = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type NoForca = NodeObject & { id: string; no: OntNo };
type LigForca = LinkObject<NoForca> & { rel: boolean; verbo?: string };
const ForceGraph2D = ForceGraph2DBase as unknown as React.FC<
  ForceGraphProps<NoForca, LigForca> & {
    ref?: React.MutableRefObject<ForceGraphMethods<NoForca, LigForca> | undefined>;
  }
>;

const CARD_W = 208;
const CARD_H = 84;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 2;
/** Zoom mínimo em que o texto dos cards ainda se lê. */
const ZOOM_LEITURA = 0.55;

type View = { x: number; y: number; k: number };

export default function OntologiaGrafo({
  nodes,
  links,
  fonte,
}: {
  nodes: OntNo[];
  links: OntRel[];
  /** Arquivo configurado de onde a ontologia veio (exibido no Raio-X). */
  fonte?: string;
}) {
  const [camadasOff, setCamadasOff] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [todasRel, setTodasRel] = useState(false);
  const [modo, setModo] = useState<"arvore" | "forca">("arvore");
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const [cheia, setCheia] = useState(false);
  const [raioX, setRaioX] = useState(false);
  const raizRef = useRef<HTMLDivElement>(null);
  const barraRef = useRef<HTMLDivElement>(null);
  // sonda sem transição em (--ont-esq, --ont-topo): diz onde a área livre começa JÁ no
  // valor final — a barra anima left/top e medir ela no meio do caminho descentralizava
  const sondaRef = useRef<HTMLDivElement>(null);
  // depois que a pessoa mexe na view (arrastar, zoom, focar), mudança de layout dos
  // menus não reenquadra mais — não arrancar a view da mão de quem está navegando
  const interagiuRef = useRef(false);
  const [livre, setLivre] = useState({ esq: 0, topo: 0, barraH: 0 });
  const areaRef = useRef<HTMLDivElement>(null);
  const movidoRef = useRef(false);
  const fgRef = useRef<ForceGraphMethods<NoForca, LigForca> | undefined>(undefined);

  const porId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /* ── visíveis (camada ligada) ───────────────────────────────────── */
  const visiveis = useMemo(
    () => nodes.filter((n) => n.kind === "raiz" || !camadasOff.has(n.camada)),
    [nodes, camadasOff],
  );
  const idsVis = useMemo(() => new Set(visiveis.map((n) => n.id)), [visiveis]);
  const filhosDe = useMemo(() => {
    const m = new Map<string, OntNo[]>();
    for (const n of nodes) if (n.parent) m.set(n.parent, [...(m.get(n.parent) ?? []), n]);
    return m;
  }, [nodes]);

  /* ── layout em árvore ───────────────────────────────────────────── */
  const layout = useMemo(() => {
    const raiz = visiveis.find((n) => n.parent === null);
    if (!raiz) return null;
    const vis = new Map<string, OntNo[]>();
    for (const n of visiveis) if (n.parent) vis.set(n.parent, [...(vis.get(n.parent) ?? []), n]);
    const monta = (n: OntNo): LayoutInput => ({
      id: n.id,
      w: CARD_W,
      h: CARD_H,
      children: (vis.get(n.id) ?? []).map(monta),
    });
    // pente mais alto que o default (7): uma ontologia grande tem
    // camadas com dezenas de folhas (taxonomias), e com 7 linhas a árvore saía
    // ~7x mais larga que alta — enquadrada inteira, ilegível
    return layoutTree(monta(raiz), { combMaxRows: 12 });
  }, [visiveis]);

  /* ── foco: nó + pai + filhos + vizinhos por relação ─────────────── */
  const foco = useMemo(() => {
    if (!sel || !porId.has(sel)) return null;
    const s = new Set<string>([sel]);
    const n = porId.get(sel)!;
    if (n.parent) s.add(n.parent);
    for (const f of filhosDe.get(sel) ?? []) s.add(f.id);
    for (const l of links) {
      if (l.source === sel) s.add(l.target);
      if (l.target === sel) s.add(l.source);
    }
    return s;
  }, [sel, porId, filhosDe, links]);

  /* ── viewport: tamanho, enquadrar, pan, zoom ────────────────────── */
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTam({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setTam({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const mede = useCallback(() => {
    const sonda = sondaRef.current;
    const barra = barraRef.current;
    const barraH = barra ? barra.offsetHeight : 0;
    const m = { esq: sonda ? sonda.offsetLeft : 0, topo: (sonda ? sonda.offsetTop : 0) + barraH, barraH };
    setLivre((v) => (v.esq === m.esq && v.topo === m.topo && v.barraH === m.barraH ? v : m));
    return m;
  }, []);

  const layoutRef = useRef(layout);
  const tamRef = useRef(tam);
  layoutRef.current = layout;
  tamRef.current = tam;

  /** Enquadra a caixa dos nós (de uma camada, ou todos). */
  const enquadrar = useCallback((camada?: string, inicial = false) => {
    interagiuRef.current = false;
    // o canvas do modo grafo já mora só na área livre (ver render) — basta o fit dele
    if (modo === "forca") {
      fgRef.current?.zoomToFit(400, 40);
      return;
    }
    const L = layoutRef.current;
    const area = areaRef.current;
    // tamanho lido do DOM, não do estado: logo após entrar/sair da tela cheia o
    // ResizeObserver ainda não rodou e o tamRef seria o de antes
    const w = area ? area.clientWidth : tamRef.current.w;
    const h = area ? area.clientHeight : tamRef.current.h;
    if (!L || w === 0) return;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [id, p] of L.positions) {
      const n = porId.get(id);
      if (camada && n?.camada !== camada) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + CARD_W);
      y1 = Math.max(y1, p.y + CARD_H);
    }
    if (!isFinite(x0)) return;
    const pad = 24;
    // os menus e a barra de controles flutuam POR CIMA do canvas: enquadra só na
    // área livre (à direita do rail, abaixo da barra)
    const { esq, topo } = mede();
    const W = w - esq;
    const H = h - topo;
    const k = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (y1 - y0), 1)),
    );
    // abertura: se a árvore inteira só cabe num zoom ilegível, abre num zoom
    // de leitura centrado na raiz (camadas à vista) — Enquadrar mostra tudo
    if (inicial && !camada && k < ZOOM_LEITURA) {
      const raiz = [...L.positions.entries()].find(([id]) => porId.get(id)?.parent === null)?.[1];
      if (raiz) {
        setView({ k: ZOOM_LEITURA, x: esq + W / 2 - (raiz.x + CARD_W / 2) * ZOOM_LEITURA, y: topo + pad - raiz.y * ZOOM_LEITURA });
        return;
      }
    }
    setView({
      k,
      x: esq + (W - (x1 - x0) * k) / 2 - x0 * k,
      y: topo + Math.max(pad, (H - (y1 - y0) * k) / 2) - y0 * k,
    });
  }, [modo, porId, mede]);

  // reenquadra quando muda o conjunto de camadas, o modo, ou quando o container ganha tamanho
  const chaveLayout = [...camadasOff].sort().join(",");
  const pronto = tam.w > 0;
  useEffect(() => {
    if (pronto && modo === "arvore") enquadrar(undefined, true);
  }, [chaveLayout, pronto, modo, enquadrar]);

  useEffect(() => {
    if (!pronto) return;
    let quadro = 0;
    const talvez = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        const antes = livre;
        const m = mede();
        if (interagiuRef.current) return;
        if (m.esq !== antes.esq || m.topo !== antes.topo) enquadrar(undefined, true);
      });
    };
    const mo = new MutationObserver(talvez);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-nav", "data-chrome"] });
    const ro = new ResizeObserver(talvez);
    if (barraRef.current) ro.observe(barraRef.current);
    if (areaRef.current) ro.observe(areaRef.current);
    talvez();
    return () => {
      cancelAnimationFrame(quadro);
      mo.disconnect();
      ro.disconnect();
    };
  }, [pronto, livre, mede, enquadrar]);

  // foco num card também é interação
  useEffect(() => {
    if (sel) interagiuRef.current = true;
  }, [sel]);

  // zoom no wheel — listener NÃO passivo, senão o preventDefault não segura o scroll da página
  useEffect(() => {
    const el = areaRef.current;
    if (!el || modo !== "arvore") return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      interagiuRef.current = true;
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * Math.exp(-e.deltaY * 0.0015)));
        const f = k / v.k;
        return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [modo]);

  const comecaArrasto = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    movidoRef.current = false;
    const ini = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    const mover = (ev: PointerEvent) => {
      const dx = ev.clientX - ini.x;
      const dy = ev.clientY - ini.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) movidoRef.current = true;
      if (movidoRef.current) {
        interagiuRef.current = true;
        setView((v) => ({ ...v, x: ini.vx + dx, y: ini.vy + dy }));
      }
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
  };

  const zoomBotao = (f: number) => {
    interagiuRef.current = true;
    setView((v) => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * f));
      const cx = livre.esq + (tam.w - livre.esq) / 2;
      const cy = livre.topo + (tam.h - livre.topo) / 2;
      return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
    });
  };

  const alternaCamada = (id: string) =>
    setCamadasOff((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /* ── geometria das arestas (modo árvore) ────────────────────────── */
  const arestas = useMemo(() => {
    if (!layout) return { arv: [], rel: [] };
    const pos = layout.positions;
    const arv: { id: string; d: string; cor: string; a: string; b: string }[] = [];
    const spineDe = new Set<string>();
    for (const n of visiveis) {
      if (!n.parent) continue;
      const p = pos.get(n.parent);
      const c = pos.get(n.id);
      if (!p || !c) continue;
      const cor = n.cor;
      if (layout.combParents.has(n.parent)) {
        const sx = p.x + DEFAULT_LAYOUT.combIndent / 2;
        const cy = c.y + CARD_H / 2;
        // espinha (uma por pai) + degrau horizontal até o card
        let d = `M ${sx} ${c.y + CARD_H / 2} H ${c.x}`;
        if (!spineDe.has(n.parent)) {
          spineDe.add(n.parent);
          const ys = visiveis
            .filter((x) => x.parent === n.parent)
            .map((x) => pos.get(x.id)?.y)
            .filter((y): y is number => y !== undefined);
          if (ys.length) d += ` M ${sx} ${p.y + CARD_H} V ${Math.max(...ys) + CARD_H / 2}`;
        }
        arv.push({ id: `${n.parent}>${n.id}`, d, cor, a: n.parent, b: n.id });
        void cy;
      } else {
        const sx = p.x + CARD_W / 2;
        const sy = p.y + CARD_H;
        const tx = c.x + CARD_W / 2;
        const my = sy + (c.y - sy) / 2;
        arv.push({ id: `${n.parent}>${n.id}`, d: `M ${sx} ${sy} V ${my} H ${tx} V ${c.y}`, cor, a: n.parent, b: n.id });
      }
    }
    const rel = links.flatMap((l, i) => {
      const s = pos.get(l.source);
      const t = pos.get(l.target);
      if (!s || !t) return [];
      const abaixo = t.y > s.y + CARD_H;
      const sx = s.x + CARD_W / 2;
      const tx = t.x + CARD_W / 2;
      const sy = abaixo ? s.y + CARD_H : s.y;
      const ty = abaixo ? t.y : t.y + CARD_H;
      const dir = abaixo ? 1 : -1;
      const off = 90 + Math.min(220, Math.abs(tx - sx) * 0.15);
      const c1y = sy + dir * off;
      const c2y = ty - dir * off;
      // ponto médio da bezier cúbica (t=.5)
      const mx = (sx + 3 * sx + 3 * tx + tx) / 8;
      const my = (sy + 3 * c1y + 3 * c2y + ty) / 8;
      return [{ id: `${i}`, d: `M ${sx} ${sy} C ${sx} ${c1y}, ${tx} ${c2y}, ${tx} ${ty}`, mx, my, verbo: l.verbo, a: l.source, b: l.target }];
    });
    return { arv, rel };
  }, [layout, visiveis, links]);

  const noSel = sel ? porId.get(sel) ?? null : null;
  // sem nó selecionado não há Raio-X
  useEffect(() => {
    if (!noSel) setRaioX(false);
  }, [noSel]);

  /** Seleciona o nó e põe o centro dele no centro da área livre (sem menus por cima). */
  const localizar = useCallback(
    (id: string) => {
      setSel(id);
      setRaioX(false);
      interagiuRef.current = true;
      if (modo === "forca") {
        const alvo = fgRef.current ? dadosForcaRef.current.nodes.find((n) => n.id === id) : undefined;
        if (alvo && alvo.x !== undefined && alvo.y !== undefined) fgRef.current?.centerAt(alvo.x, alvo.y, 500);
        return;
      }
      const p = layoutRef.current?.positions.get(id);
      const area = areaRef.current;
      if (!p || !area) return;
      const { esq, topo } = mede();
      const W = area.clientWidth - esq;
      const H = area.clientHeight - topo;
      setView((v) => {
        const k = v.k < ZOOM_LEITURA ? ZOOM_LEITURA : v.k;
        return { k, x: esq + W / 2 - (p.x + CARD_W / 2) * k, y: topo + H / 2 - (p.y + CARD_H / 2) * k };
      });
    },
    [modo, mede],
  );

  /* ── modo força ─────────────────────────────────────────────────── */
  const dadosForca = useMemo(() => {
    if (modo !== "forca") return { nodes: [] as NoForca[], links: [] as LigForca[] };
    const ns: NoForca[] = visiveis.map((no) => ({ id: no.id, no }));
    const ls: LigForca[] = [];
    for (const n of visiveis) if (n.parent && idsVis.has(n.parent)) ls.push({ source: n.parent, target: n.id, rel: false });
    for (const l of links)
      if (idsVis.has(l.source) && idsVis.has(l.target)) ls.push({ source: l.source, target: l.target, rel: true, verbo: l.verbo });
    return { nodes: ns, links: ls };
  }, [modo, visiveis, idsVis, links]);

  const dadosForcaRef = useRef(dadosForca);
  dadosForcaRef.current = dadosForca;

  const esmaece = (id: string) => (foco ? !foco.has(id) : false);

  /* ── tela cheia: Fullscreen API; Esc nativo sai e o evento sincroniza o estado ── */
  useEffect(() => {
    const sync = () => setCheia(document.fullscreenElement === raizRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const alternaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void raizRef.current?.requestFullscreen();
  };
  // entrar/sair da tela cheia muda a área livre de verdade: volta a enquadrar
  useEffect(() => {
    interagiuRef.current = false;
  }, [cheia]);

  /* ── UI ─────────────────────────────────────────────────────────── */
  const camadasUI = useMemo(
    () => nodes.filter((n) => n.kind === "camada").map((n) => ({ id: n.camada, rotulo: n.label, cor: n.cor, codigo: n.codigo })),
    [nodes],
  );
  const contagem = (c: string) => nodes.filter((n) => n.kind === "item" && n.camada === c).length;
  const botao =
    "rounded-[var(--bl-radius-sm)] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors";
  const botaoOn = "border-[var(--bl-accent)] text-[var(--bl-accent)] bg-[var(--bl-bg-elevated)]";
  const botaoOff = "border-[var(--bl-border)] text-[var(--bl-text-dim)] hover:text-[var(--bl-text-secondary)]";

  return (
    <div
      ref={raizRef}
      // marca de página de canvas: o shell tira o recuo do conteúdo (CSS :has, já no SSR)
      data-canvas-page=""
      className={`relative overflow-hidden ${cheia ? "h-screen w-screen" : ""}`}
      style={
        {
          background: "#0b0d12",
          // canvas ocupa a tela; os menus do app flutuam por cima. --ont-esq/--ont-topo =
          // onde começa a área livre (vem do shell; muda quando o orb recolhe os menus)
          "--ont-esq": cheia ? "12px" : "var(--canvas-left)",
          "--ont-topo": cheia ? "12px" : "var(--canvas-top)",
          "--ont-barra-h": `${livre.barraH}px`,
          ...(cheia ? {} : { height: "100vh", minHeight: 480 }),
        } as React.CSSProperties
      }
    >
      <div ref={sondaRef} aria-hidden className="pointer-events-none absolute h-0 w-0" style={{ left: "var(--ont-esq)", top: "var(--ont-topo)" }} />
      {/* mission control flutuante: camadas liga/desliga + modos */}
      <div
        ref={barraRef}
        className="absolute right-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--bl-radius-xl)] border border-[var(--bl-border-1)] px-3 py-2 shadow-lg backdrop-blur-xl transition-[left,top] duration-300"
        style={{ top: "var(--ont-topo)", left: "var(--ont-esq)", right: 12, background: "rgba(9, 9, 12, 0.85)" }}
      >
        <div className="flex flex-wrap gap-1.5">
          {camadasUI.map((c) => {
            const lig = !camadasOff.has(c.id);
            const rotulo = c.rotulo;
            return (
              <span key={c.id} className="inline-flex overflow-hidden rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)]">
                <button
                  type="button"
                  onClick={() => alternaCamada(c.id)}
                  aria-pressed={lig}
                  title={lig ? "ocultar camada" : "mostrar camada"}
                  className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em]"
                  style={{ color: lig ? c.cor : "var(--bl-text-muted)", opacity: lig ? 1 : 0.55 }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: lig ? c.cor : "transparent", border: `1px solid ${c.cor}` }} />
                  {c.codigo} {rotulo}
                  <span className="text-[var(--bl-text-muted)]">{contagem(c.id)}</span>
                </button>
                {lig && modo === "arvore" && (
                  <button
                    type="button"
                    onClick={() => enquadrar(c.id)}
                    title="enquadrar só esta camada"
                    className="border-l border-[var(--bl-border)] px-1.5 text-[var(--bl-text-muted)] hover:text-[var(--bl-text-secondary)]"
                  >
                    <Maximize2 className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" className={`${botao} ${modo === "arvore" ? botaoOn : botaoOff}`} onClick={() => setModo("arvore")}>
            Árvore
          </button>
          <button type="button" className={`${botao} ${modo === "forca" ? botaoOn : botaoOff}`} onClick={() => setModo("forca")}>
            Grafo
          </button>
          {modo === "arvore" && (
            <button
              type="button"
              className={`${botao} ${todasRel ? botaoOn : botaoOff}`}
              aria-pressed={todasRel}
              onClick={() => setTodasRel((v) => !v)}
              title="mostrar todas as relações (padrão: só do nó em foco)"
            >
              Relações
            </button>
          )}
          <button type="button" className={`${botao} ${botaoOff}`} onClick={() => enquadrar()}>
            Enquadrar
          </button>
          <button
            type="button"
            className={`${botao} ${cheia ? botaoOn : botaoOff} inline-flex items-center gap-1.5`}
            onClick={alternaCheia}
            title={cheia ? "sair da tela cheia (Esc)" : "tela cheia"}
          >
            {cheia ? <Minimize className="h-3 w-3" /> : <Maximize className="h-3 w-3" />}
            {cheia ? "Sair" : "Tela cheia"}
          </button>
        </div>
      </div>

      {/* canvas */}
      <div className="absolute inset-0">
        <div
          ref={areaRef}
          className="absolute inset-0 select-none overflow-hidden"
          style={{
            touchAction: "none",
            cursor: modo === "arvore" ? "grab" : "default",
            backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
          onPointerDown={modo === "arvore" ? comecaArrasto : undefined}
          onClick={() => {
            if (!movidoRef.current) setSel(null);
          }}
        >
          {modo === "arvore" && layout && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transformOrigin: "0 0",
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
              }}
            >
              <svg
                width={layout.width}
                height={layout.height}
                style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}
              >
                {arestas.arv.map((a) => {
                  const forte = !foco || (foco.has(a.a) && foco.has(a.b));
                  return (
                    <path
                      key={a.id}
                      d={a.d}
                      fill="none"
                      stroke={a.cor}
                      strokeWidth={forte && foco ? 2 : 1.4}
                      strokeOpacity={forte ? 0.55 : 0.1}
                    />
                  );
                })}
                {arestas.rel
                  .filter((r) => todasRel || (sel && (r.a === sel || r.b === sel)))
                  .map((r) => {
                    const forte = !foco || (foco.has(r.a) && foco.has(r.b));
                    const cor = porId.get(r.a)?.cor ?? "#888";
                    return (
                      <g key={r.id} opacity={forte ? 1 : 0.12}>
                        <path d={r.d} fill="none" stroke={cor} strokeWidth={1.6} strokeDasharray="6 5" strokeOpacity={0.85} />
                        <rect x={r.mx - r.verbo.length * 3.3 - 6} y={r.my - 9} width={r.verbo.length * 6.6 + 12} height={18} rx={4} fill="#0b0d12" stroke={cor} strokeOpacity={0.5} />
                        <text x={r.mx} y={r.my + 3.5} textAnchor="middle" fontSize={10.5} fontFamily="ui-monospace, monospace" fill={cor}>
                          {r.verbo}
                        </text>
                      </g>
                    );
                  })}
              </svg>

              {visiveis.map((n) => {
                const p = layout.positions.get(n.id);
                if (!p) return null;
                const cor = n.cor;
                const Icone = ICONE[n.kind];
                const ativo = sel === n.id;
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    data-no={n.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!movidoRef.current) setSel(n.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setSel(n.id);
                    }}
                    className="absolute flex flex-col justify-between rounded-[var(--bl-radius-md)] px-3 py-2 text-left"
                    style={{
                      left: p.x,
                      top: p.y,
                      width: CARD_W,
                      height: CARD_H,
                      background: "var(--bl-bg-card-solid)",
                      border: `1.5px solid ${cor}`,
                      boxShadow: ativo ? `0 0 0 2px ${cor}, 0 0 18px ${cor}55` : undefined,
                      opacity: esmaece(n.id) ? 0.2 : 1,
                      transition: "opacity .15s",
                      cursor: "pointer",
                    }}
                  >
                    <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: cor }}>
                      <Icone className="h-3 w-3 shrink-0" />
                      <span>{n.codigo}</span>
                      <span className="truncate text-[var(--bl-text-muted)]">· {n.kind}</span>
                      {n.status && <span className="ml-auto max-w-[45%] truncate" style={{ color: n.corStatus }} title={n.status}>{n.status}</span>}
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold leading-tight text-[var(--bl-text-primary,#e8eaf0)]" title={n.label}>
                          {n.label}
                        </p>
                        <p className="truncate font-mono text-[9px] text-[var(--bl-text-dim)]">{n.tag}</p>
                      </div>
                      {n.metrica && (
                        <div className="shrink-0 text-right leading-none">
                          <p className="font-mono text-xl font-semibold" style={{ color: cor }}>{n.metrica.valor}</p>
                          <p className="mt-0.5 font-mono text-[8px] uppercase text-[var(--bl-text-muted)]">{n.metrica.rotulo}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {modo === "forca" && tam.w > 0 && (
            // só na área livre: o fit do force-graph tem padding único e deixava nós
            // da borda escondidos sob o rail e a barra
            <div className="absolute" style={{ left: livre.esq, top: livre.topo }}>
            <ForceGraph2D
              ref={fgRef}
              width={Math.max(0, tam.w - livre.esq)}
              height={Math.max(0, tam.h - livre.topo)}
              graphData={dadosForca}
              backgroundColor="rgba(0,0,0,0)"
              cooldownTicks={120}
              onEngineStop={() => {
                if (!movidoRef.current) fgRef.current?.zoomToFit(300, 50);
              }}
              nodeRelSize={5}
              nodeLabel={(n) => `${n.no.label} · ${n.no.kind}`}
              nodeCanvasObject={(n, ctx, escala) => {
                const no = n.no;
                const r = no.kind === "raiz" ? 9 : no.kind === "camada" ? 7 : no.parent && porId.get(no.parent)?.kind === "camada" ? 5 : 3.5;
                const cor = no.cor;
                ctx.globalAlpha = esmaece(no.id) ? 0.15 : 1;
                ctx.beginPath();
                ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
                ctx.fillStyle = cor;
                ctx.fill();
                ctx.lineWidth = (sel === no.id ? 2.5 : 1.2) / escala;
                ctx.strokeStyle = sel === no.id ? "#fff" : cor;
                ctx.stroke();
                if (escala > 1.4 || r >= 5) {
                  ctx.font = `${Math.max(3, 10 / Math.max(escala, 0.8))}px ui-monospace, monospace`;
                  ctx.fillStyle = "#cbd5e1";
                  ctx.textAlign = "center";
                  ctx.fillText(no.label, n.x ?? 0, (n.y ?? 0) + r + 8 / Math.max(escala, 0.8));
                }
                ctx.globalAlpha = 1;
              }}
              nodePointerAreaPaint={(n, cor, ctx) => {
                ctx.fillStyle = cor;
                ctx.beginPath();
                ctx.arc(n.x ?? 0, n.y ?? 0, 7, 0, 2 * Math.PI);
                ctx.fill();
              }}
              linkColor={(l) => {
                const s = typeof l.source === "object" ? (l.source as NoForca) : undefined;
                const t = typeof l.target === "object" ? (l.target as NoForca) : undefined;
                const fraco = foco && s && t ? !(foco.has(s.id) && foco.has(t.id)) : false;
                if (l.rel) return fraco ? "rgba(148,163,184,0.06)" : "rgba(224,168,46,0.7)";
                return fraco ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.35)";
              }}
              linkLineDash={(l) => (l.rel ? [4, 3] : null)}
              linkDirectionalArrowLength={(l) => (l.rel ? 4 : 0)}
              linkDirectionalArrowRelPos={1}
              onNodeClick={(n) => {
                movidoRef.current = false;
                setSel(n.id);
              }}
              onBackgroundClick={() => setSel(null)}
              onNodeDragEnd={() => {
                movidoRef.current = true;
              }}
            />
            </div>
          )}
        </div>

        {/* zoom (árvore) */}
        {modo === "arvore" && (
          <div className="absolute bottom-3 flex flex-col overflow-hidden rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] font-mono text-sm" style={{ left: "var(--ont-esq)" }}>
            <button type="button" aria-label="aproximar" className="px-2.5 py-1 hover:bg-[var(--bl-bg-elevated)]" onClick={() => zoomBotao(1.25)}>+</button>
            <button type="button" aria-label="afastar" className="border-t border-[var(--bl-border)] px-2.5 py-1 hover:bg-[var(--bl-bg-elevated)]" onClick={() => zoomBotao(0.8)}>−</button>
          </div>
        )}
        <p className="pointer-events-none absolute bottom-3 hidden font-mono text-[9px] text-[var(--bl-text-muted)] sm:block" style={{ left: "calc(var(--ont-esq) + 44px)" }}>
          {modo === "arvore" ? "arraste p/ mover · scroll p/ zoom · clique num card p/ focar" : "arraste nós · scroll p/ zoom · clique p/ focar"} · {visiveis.length} nós · {links.length} relações
        </p>

        {/* painel de propriedades — lateral no desktop, gaveta inferior no mobile */}
        {noSel && (
          <aside
            className="absolute inset-x-0 bottom-0 z-10 flex h-[55%] flex-col overflow-hidden rounded-t-[var(--bl-radius-md)] border-t border-[var(--bl-border)] bg-[rgba(9,9,12,0.94)] shadow-2xl backdrop-blur-xl md:inset-x-auto md:bottom-3 md:right-3 md:top-[calc(var(--ont-topo)+var(--ont-barra-h)+12px)] md:h-auto md:w-80 md:rounded-[var(--bl-radius-md)] md:border"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <PainelNo
              no={noSel}
              porId={porId}
              filhosDe={filhosDe}
              links={links}
              onSel={setSel}
              onFechar={() => setSel(null)}
              onAbrirRaioX={() => setRaioX(true)}
            />
          </aside>
        )}
      </div>

      {/* Raio-X dentro da raiz: continua visível em tela cheia */}
      {raioX && noSel && (
        <RaioX
          key={noSel.id}
          no={noSel}
          porId={porId}
          filhosDe={filhosDe}
          links={links}
          onFechar={() => setRaioX(false)}
          onLocalizar={localizar}
          fonte={fonte}
        />
      )}
    </div>
  );
}
