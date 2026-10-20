"use client";

/** Zoom e pan do canvas do grafo (radial e neural). O estado vive em refs e é aplicado
 *  direto no DOM a cada quadro, sem re-render do React:
 *  - arrastar acompanha o ponteiro 1:1 e, ao soltar, desliza com inércia;
 *  - roda do mouse, botões e atalhos mudam o ALVO e a vista caminha até ele (interpolação
 *    por quadro), então todo zoom é contínuo, nunca um salto;
 *  - `prefers-reduced-motion` troca a interpolação por salto (o arrasto segue igual). */
import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ME, type PointerEvent as PE } from "react";
import { LIMITE_ZOOM, limitarPan, passoMola, zoomEm, type Vista } from "@/lib/brain/vista";

const MARGEM = 48;
/** zoom com massa: mola com rigidez baixa e amortecimento alto → ultrapassa ~8% e assenta (peso) */
const RIGIDEZ = 0.12;
const AMORTECIMENTO = 0.72;
/** distância (px) a partir da qual um pointerdown vira arrasto e não clique */
const LIMIAR_ARRASTO = 4;
/** atrito da inércia por quadro */
const ATRITO = 0.92;

type Medidas = { vw: number; vh: number; cw: number; ch: number; ox: number; oy: number };
type Arrasto = { id: number; sx: number; sy: number; ox: number; oy: number; moveu: boolean; t: number; x: number; y: number; vx: number; vy: number };

/** Vista em coordenadas da área: (x,y) é onde está o canto do conteúdo. `ox,oy` é o canto
 *  de layout do conteúdo (ex.: centralizado no neural), descontado ao aplicar o transform. */
export function usePanZoom(onK?: (k: number) => void) {
  const vistaEl = useRef<HTMLElement | null>(null);
  const conteudoEl = useRef<HTMLElement | null>(null);
  const atual = useRef<Vista | null>(null);
  const alvo = useRef<Vista | null>(null);
  const quadro = useRef(0);
  const arrasto = useRef<Arrasto | null>(null);
  const inercia = useRef({ vx: 0, vy: 0 });
  // velocidade da mola (zoom/pan com peso) por eixo: k, x, y
  const mola = useRef({ k: 0, x: 0, y: 0 });
  const suprimir = useRef(false);
  const onKRef = useRef(onK);
  useEffect(() => {
    onKRef.current = onK;
  });

  const medir = useCallback((): Medidas | null => {
    const v = vistaEl.current;
    const c = conteudoEl.current;
    if (!v || !c) return null;
    return { vw: v.clientWidth, vh: v.clientHeight, cw: c.offsetWidth, ch: c.offsetHeight, ox: c.offsetLeft, oy: c.offsetTop };
  }, []);

  const pintar = useCallback((v: Vista, m: Medidas) => {
    const el = conteudoEl.current;
    if (el) el.style.transform = `translate(${v.x - m.ox}px, ${v.y - m.oy}px) scale(${v.k})`;
  }, []);

  const garantir = useCallback(
    (m: Medidas) => {
      if (atual.current && alvo.current) return;
      const id: Vista = { k: 1, x: m.ox, y: m.oy };
      atual.current = { ...id };
      alvo.current = { ...id };
      pintar(id, m);
    },
    [pintar],
  );

  const passo = useCallback(() => {
    quadro.current = 0;
    const m = medir();
    const a = atual.current;
    const t = alvo.current;
    if (!m || !a || !t) return;
    const i = inercia.current;
    if (!arrasto.current && (Math.abs(i.vx) > 0.05 || Math.abs(i.vy) > 0.05)) {
      // a inércia do arrasto desliza o alvo e perde força a cada quadro
      t.x += i.vx;
      t.y += i.vy;
      i.vx *= ATRITO;
      i.vy *= ATRITO;
      const p = limitarPan(t, m.cw, m.ch, m.vw, m.vh, MARGEM);
      t.x = p.x;
      t.y = p.y;
    }
    const reduz = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const mo = mola.current;
    if (reduz) {
      a.k = t.k;
      a.x = t.x;
      a.y = t.y;
      mo.k = mo.x = mo.y = 0;
    } else {
      const sk = passoMola(a.k, mo.k, t.k, RIGIDEZ, AMORTECIMENTO);
      const sx = passoMola(a.x, mo.x, t.x, RIGIDEZ, AMORTECIMENTO);
      const sy = passoMola(a.y, mo.y, t.y, RIGIDEZ, AMORTECIMENTO);
      a.k = sk.pos; mo.k = sk.vel;
      a.x = sx.pos; mo.x = sx.vel;
      a.y = sy.pos; mo.y = sy.vel;
    }
    pintar(a, m);
    const parado =
      Math.abs(t.k - a.k) < 0.0005 && Math.abs(t.x - a.x) < 0.1 && Math.abs(t.y - a.y) < 0.1 &&
      Math.abs(mo.k) < 0.0005 && Math.abs(mo.x) < 0.1 && Math.abs(mo.y) < 0.1 &&
      Math.abs(i.vx) <= 0.05 && Math.abs(i.vy) <= 0.05;
    if (parado) {
      a.k = t.k;
      a.x = t.x;
      a.y = t.y;
      mo.k = mo.x = mo.y = 0;
      pintar(a, m);
      i.vx = 0;
      i.vy = 0;
      onKRef.current?.(Math.round(a.k * 100) / 100);
      return;
    }
    quadro.current = requestAnimationFrame(passo);
  }, [medir, pintar]);

  const agendar = useCallback(() => {
    if (!quadro.current) quadro.current = requestAnimationFrame(passo);
  }, [passo]);

  /** Zoom por `fator` no ponto `ponto` (coords da área); sem ponto, no centro. */
  const zoomar = useCallback(
    (fator: number, ponto?: { x: number; y: number }) => {
      const m = medir();
      if (!m) return;
      garantir(m);
      const p = ponto ?? { x: m.vw / 2, y: m.vh / 2 };
      const t = zoomEm(alvo.current!, p, fator, LIMITE_ZOOM);
      alvo.current = limitarPan(t, m.cw, m.ch, m.vw, m.vh, MARGEM);
      inercia.current = { vx: 0, vy: 0 };
      agendar();
    },
    [medir, garantir, agendar],
  );

  /** Volta à vista inicial (zoom 1, sem deslocamento), deslizando até lá. */
  const resetar = useCallback(() => {
    const m = medir();
    if (!m) return;
    garantir(m);
    alvo.current = { k: 1, x: m.ox, y: m.oy };
    inercia.current = { vx: 0, vy: 0 };
    agendar();
  }, [medir, garantir, agendar]);

  // roda do mouse: zoom no cursor. Listener nativo (passive: false) para poder cancelar o scroll da página.
  const zoomarRef = useRef(zoomar);
  useEffect(() => {
    zoomarRef.current = zoomar;
  }, [zoomar]);
  const ouvinteRoda = useRef((e: WheelEvent) => {
    e.preventDefault();
    const el = vistaEl.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomarRef.current(Math.exp(-dy * 0.0016), { x: e.clientX - r.left, y: e.clientY - r.top });
  }).current;

  /** Ref da área visível (recorta o conteúdo). Anexa a roda ao montar e solta ao desmontar. */
  const vistaRef = useCallback(
    (el: HTMLElement | null) => {
      if (vistaEl.current && vistaEl.current !== el) vistaEl.current.removeEventListener("wheel", ouvinteRoda);
      vistaEl.current = el;
      if (el) el.addEventListener("wheel", ouvinteRoda, { passive: false });
    },
    [ouvinteRoda],
  );

  /** Ref do conteúdo (o que anda e dá zoom). Ao trocar de elemento, reaplica a vista atual. */
  const conteudoRef = useCallback(
    (el: HTMLElement | null) => {
      conteudoEl.current = el;
      const m = medir();
      if (el && m && atual.current) pintar(atual.current, m);
    },
    [medir, pintar],
  );

  // arrasto: 1:1 com o ponteiro; soltar em movimento vira inércia
  const aoBaixo = (e: PE<HTMLElement>) => {
    if (e.button !== 0) return;
    const m = medir();
    if (!m) return;
    garantir(m);
    suprimir.current = false;
    inercia.current = { vx: 0, vy: 0 };
    // sem captura aqui: capturar já no pointerdown mandaria o clique pra área, não pro nó
    const a = atual.current!;
    arrasto.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: a.x, oy: a.y, moveu: false, t: performance.now(), x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
  };

  const aoMover = (e: PE<HTMLElement>) => {
    const d = arrasto.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moveu && Math.hypot(dx, dy) < LIMIAR_ARRASTO) return;
    if (!d.moveu) e.currentTarget.setPointerCapture(e.pointerId);
    d.moveu = true;
    const agora = performance.now();
    const dt = Math.max(1, agora - d.t);
    // velocidade suavizada, em px por quadro (16ms)
    d.vx = 0.6 * d.vx + 0.4 * ((e.clientX - d.x) / dt) * 16;
    d.vy = 0.6 * d.vy + 0.4 * ((e.clientY - d.y) / dt) * 16;
    d.t = agora;
    d.x = e.clientX;
    d.y = e.clientY;
    const m = medir();
    const a = atual.current;
    if (!m || !a) return;
    const p = limitarPan({ k: a.k, x: d.ox + dx, y: d.oy + dy }, m.cw, m.ch, m.vw, m.vh, MARGEM);
    atual.current = { ...p };
    alvo.current = { ...p };
    mola.current = { k: 0, x: 0, y: 0 };
    pintar(atual.current, m);
  };

  const aoSoltar = (e: PE<HTMLElement>) => {
    const d = arrasto.current;
    if (!d || d.id !== e.pointerId) return;
    arrasto.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moveu) return;
    suprimir.current = true;
    // se o ponteiro ficou parado antes de soltar, não há inércia
    const parado = performance.now() - d.t > 80;
    inercia.current = parado ? { vx: 0, vy: 0 } : { vx: d.vx, vy: d.vy };
    agendar();
  };

  /** Clique que terminou um arrasto não chega aos nós nem ao fundo (fase de captura). */
  const clique = (e: ME) => {
    if (suprimir.current) {
      suprimir.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const aoDuploClique = (e: ME<HTMLElement>) => {
    const el = vistaEl.current;
    if (!el || (e.target as HTMLElement).closest("button,input,select,textarea,a")) return;
    const r = el.getBoundingClientRect();
    zoomar(1.8, { x: e.clientX - r.left, y: e.clientY - r.top });
  };

  // cancela o quadro pendente ao desmontar
  useEffect(
    () => () => {
      if (quadro.current) cancelAnimationFrame(quadro.current);
      quadro.current = 0;
    },
    [],
  );

  const bindings = useMemo(
    () => ({ onPointerDown: aoBaixo, onPointerMove: aoMover, onPointerUp: aoSoltar, onPointerCancel: aoSoltar, onDoubleClick: aoDuploClique }),
    // os handlers só tocam refs e callbacks estáveis; recriá-los a cada render não muda nada
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [medir, garantir, pintar, agendar, zoomar],
  );

  return { vistaRef, conteudoRef, bindings, clique, zoomar, resetar };
}
