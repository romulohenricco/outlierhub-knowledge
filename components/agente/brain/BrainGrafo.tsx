"use client";

/** Grafo do /agente (visões radial e neural): núcleo de memória, pilares da
 *  organização + pilares por fonte do inventário, drill-in, lentes, legenda,
 *  diretório, busca e tela cheia. Dados vêm da page (server); o recorte do
 *  inventário chega já filtrado pela lateral do catálogo. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, RotateCcw, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { usePanZoom } from "./usePanZoom";
import { agruparPorFonte } from "@/lib/brain/fontes";
import { LENTE_TODAS, casaLente, cenaPilar, cenaVisaoGeral, contagensLegenda, listarPilares, opcoesLente, type Lente, type NoCena, type TipoNo } from "@/lib/brain/cena";
import { buscar, montarIndice, type Item } from "@/lib/brain/indice";
import { montarNeural } from "@/lib/brain/neural";
import type { BrainDados } from "@/lib/brain/tipos";
import type { EcoEntity } from "@/lib/types";
import { Lateral } from "./Lateral";
import { NeuralView } from "./Neural";
import { Painel, PainelNota } from "./Painel";
import { NotasZoom } from "./Radial";
import { AnelGuia, CenaGrafo, VIEWBOX_CENA, cenaFocoAlvo, cenaGeralAlvo } from "./Cena";
import { IconeRedondo } from "./icones";

const FLUTUA = { background: "rgba(9, 9, 12, 0.88)" } as const;
const LARG_PAINEL = 288;
const BTN =
  "flex items-center gap-1.5 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] px-2.5 py-1.5 backdrop-blur-xl font-mono text-[11px] text-[var(--bl-text-primary)] hover:border-[var(--bl-border-accent)]";

export function BrainGrafo({
  entities,
  totalEntidades,
  brain,
  visao,
  onAbrirCard,
  filtroSquad,
}: {
  entities: EcoEntity[];
  totalEntidades: number;
  brain: BrainDados;
  visao: "radial" | "neural";
  onAbrirCard: (e: EcoEntity) => void;
  filtroSquad: { nome: string; limpar: () => void } | null;
}) {
  const org = brain.org.ok ? brain.org.data : null;
  const mem = brain.memoria;

  // pilares por fonte: derivados dos caminhos do inventário já filtrado (vazio sem inventário)
  const fontes = useMemo(() => agruparPorFonte(entities), [entities]);
  const pilares = useMemo(() => listarPilares(org, fontes), [org, fontes]);
  const geral = useMemo(() => cenaVisaoGeral(pilares, org), [pilares, org]);
  const indice = useMemo(() => montarIndice(pilares, org, fontes, mem), [pilares, org, fontes, mem]);
  const legenda = useMemo(() => contagensLegenda(org, fontes, mem), [org, fontes, mem]);
  const neural = useMemo(() => montarNeural(pilares, org, fontes, mem ? mem.notas.length : null), [pilares, org, fontes, mem]);
  const opcoes = useMemo(() => opcoesLente(org), [org]);
  const semDados = pilares.length === 0 && !mem;
  const porEntidade = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  const [foco, setFoco] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [lente, setLente] = useState<Lente>(LENTE_TODAS);
  // camadas esmaecidas (toggle da legenda): ids = tipo do nó
  const [ocultos, setOcultos] = useState<Set<string>>(() => new Set());
  const toggleCamada = useCallback((id: string) => setOcultos((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const [q, setQ] = useState("");
  const [notaDestaque, setNotaDestaque] = useState<string | null>(null);
  // núcleo de notas aberto em tela cheia (constelação) e a nota escolhida dentro dele
  const [notasAbertas, setNotasAbertas] = useState(false);
  const [notaSel, setNotaSel] = useState<string | null>(null);
  const [cheia, setCheia] = useState(false);
  // coluna direita (lentes, legenda, diretório) flutua sobre o canvas e recolhe
  const [painelAberto, setPainelAberto] = useState(true);
  useEffect(() => {
    try {
      const salvo = localStorage.getItem("bl-agente-painel");
      // em tela estreita o painel (288px) cobriria o grafo inteiro: começa recolhido, sem sobrescrever a escolha salva
      if (salvo === "recolhido" || (salvo === null && window.matchMedia("(max-width: 767px)").matches)) setPainelAberto(false);
    } catch {
      /* sem storage: começa aberto */
    }
  }, []);
  const alternarPainel = () =>
    setPainelAberto((a) => {
      try {
        localStorage.setItem("bl-agente-painel", a ? "recolhido" : "aberto");
      } catch {
        /* ignora */
      }
      return !a;
    });
  const caixa = useRef<HTMLDivElement>(null);
  const busca = useRef<HTMLInputElement>(null);
  // zoom/pan de cada visão: a mesma tela, duas áreas; cada uma guarda a sua vista
  const [kRadial, setKRadial] = useState(1);
  const [kNeural, setKNeural] = useState(1);
  const panRadial = usePanZoom(setKRadial);
  const panNeural = usePanZoom(setKNeural);
  const { zoomar: zoomRadial, resetar: resetRadial } = panRadial;
  const { zoomar: zoomNeural, resetar: resetNeural } = panNeural;
  const kAtivo = visao === "radial" ? kRadial : kNeural;
  const zoomAtivo = visao === "radial" ? zoomRadial : zoomNeural;
  const resetAtivo = visao === "radial" ? resetRadial : resetNeural;

  // pilar em foco que saiu do recorte (filtro da lateral) volta pra visão geral
  const iFoco = foco ? pilares.findIndex((p) => p.id === foco) : -1;
  const pilarFoco = iFoco >= 0 ? pilares[iFoco] : null;
  const cenaFoco = useMemo(() => (pilarFoco ? cenaPilar(pilarFoco, org) : null), [pilarFoco, org]);

  const vizinhos = useMemo(() => {
    if (!pilarFoco || pilares.length < 2) return [];
    const n = pilares.length;
    const prev = pilares[(iFoco - 1 + n) % n];
    const next = pilares[(iFoco + 1) % n];
    const lista: { lado: -1 | 1; pilar: (typeof pilares)[number]; cena: ReturnType<typeof cenaPilar> }[] = [
      { lado: -1, pilar: prev, cena: cenaPilar(prev, org) },
    ];
    if (next.id !== prev.id) lista.push({ lado: 1, pilar: next, cena: cenaPilar(next, org) });
    return lista;
  }, [pilarFoco, pilares, iFoco, org]);

  const contagens = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pilares) {
      if (p.origem === "fonte") m.set(p.id, `${p.fonte!.total} entidades`);
      else if (org) {
        const t = org.tarefas.filter((x) => x.pilarId === p.id).length;
        const a = org.agentes.filter((x) => x.pilarId === p.id).length + org.pessoas.filter((x) => x.pilarId === p.id).length;
        m.set(p.id, `${t} tarefas · ${a} executores`);
      }
    }
    return m;
  }, [pilares, org]);

  // alvo da cena: visão geral ou drill do pilar em foco (mesmos ids, só mudam as posições)
  const alvo = useMemo(
    () => (pilarFoco && cenaFoco ? cenaFocoAlvo(cenaFoco, pilarFoco, vizinhos, cheia ? 0.5 : 0.22) : cenaGeralAlvo(geral, pilares, contagens)),
    [pilarFoco, cenaFoco, vizinhos, cheia, geral, pilares, contagens],
  );

  const totalNos = legenda.reduce((s, l) => s + l.total, 0);

  const irPara = useCallback(
    (i: Item) => {
      setQ("");
      if (i.tipo === "nota") {
        setFoco(null);
        setSelId(null);
        setNotaDestaque(i.id);
        return;
      }
      setNotaDestaque(null);
      if (i.pilarId) setFoco(i.pilarId);
      setSelId(i.tipo === "pilar" ? null : i.id);
    },
    [],
  );

  const aoNo = useCallback(
    (n: NoCena) => {
      if (n.tipo === "pilar") {
        if (foco !== n.id) {
          setFoco(n.id);
          setSelId(null);
        }
        return;
      }
      if (n.tipo === "avulsos") return;
      setSelId(n.refId ?? n.id);
    },
    [foco],
  );

  const navegar = useCallback(
    (d: number) => {
      if (iFoco < 0) return;
      setFoco(pilares[(iFoco + d + pilares.length) % pilares.length].id);
      setSelId(null);
    },
    [iFoco, pilares],
  );

  // teclado: Esc fecha detalhe → pilar; "/" foca a busca
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const digitando = alvo && (alvo.tagName === "INPUT" || alvo.tagName === "SELECT" || alvo.tagName === "TEXTAREA");
      if (e.key === "/" && !digitando && visao === "radial") {
        e.preventDefault();
        busca.current?.focus();
      } else if (e.key === "Escape" && !digitando) {
        if (cheia && !document.fullscreenElement) setCheia(false);
        else if (notaSel) setNotaSel(null);
        else if (notasAbertas) setNotasAbertas(false);
        else if (selId) setSelId(null);
        else if (foco) setFoco(null);
      } else if (!digitando && foco && (e.key === "ArrowLeft" || e.key === "ArrowRight")) navegar(e.key === "ArrowLeft" ? -1 : 1);
      else if (!digitando && (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "0")) {
        // zoom da visão ativa: + aproxima, - afasta, 0 volta à vista inicial
        const v = visao === "radial" ? zoomRadial : zoomNeural;
        const r = visao === "radial" ? resetRadial : resetNeural;
        if (e.key === "0") r();
        else v(e.key === "-" ? 1 / 1.25 : 1.25);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selId, foco, cheia, visao, navegar, notaSel, notasAbertas, zoomRadial, zoomNeural, resetRadial, resetNeural]);

  useEffect(() => {
    const h = () => setCheia(document.fullscreenElement === caixa.current);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  async function alternarTela() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await caixa.current?.requestFullscreen();
    } catch {
      setCheia((c) => !c); // sem API de fullscreen: cai pra tela cheia por CSS
    }
  }

  const comum = useMemo(
    () => ({ casa: (n: NoCena) => casaLente(n, lente) && !ocultos.has(n.tipo), selId, hoverId, onSelecionar: aoNo, onHover: setHoverId }),
    [lente, ocultos, selId, hoverId, aoNo],
  );
  const resultados = useMemo(() => buscar(indice, q), [indice, q]);
  const sel = selId ? (porEntidade.get(selId) ?? null) : null;
  const temPainel = !!selId && (!!sel || org?.agentes.some((a) => a.id === selId) || org?.pessoas.some((a) => a.id === selId) || org?.tarefas.some((a) => a.id === selId) || org?.ferramentas.some((a) => a.id === selId));
  const tinta = pilarFoco ? `radial-gradient(70% 55% at 50% 88%, ${pilarFoco.cor}30, transparent 70%)` : "none";
  const m = cenaFoco?.mostrando;
  const limitado = m ? (Object.entries(m) as [string, { de: number; total: number }][]).filter(([, v]) => v.de < v.total) : [];

  // área livre do canvas: à direita do rail, abaixo da topbar e à esquerda do painel flutuante
  const direita = painelAberto ? 12 + LARG_PAINEL + 12 : 0;
  const alturaBarra = 46;

  const aviso = (texto: string) => (
    <p role="status" className="pointer-events-auto max-w-md rounded-[var(--bl-radius-sm)] border border-amber-500/40 px-3 py-2 text-xs text-amber-200 backdrop-blur-xl" style={{ background: "rgba(40, 28, 6, 0.9)" }}>
      {texto}
    </p>
  );
  // arquivo ausente é o estado normal de partida (a tela de estado vazio explica); só avisa o que está errado
  const avisos = (
    <>
      {!brain.org.ok && brain.org.estado !== "ausente" && aviso(`Organização indisponível: ${brain.org.motivo}. O grafo segue só com o inventário e as notas.`)}
      {brain.org.ok && brain.org.avisos.map((a) => <Fragment key={a}>{aviso(a)}</Fragment>)}
      {brain.memoriaFalha && aviso(`Notas indisponíveis: ${brain.memoriaMotivo}.`)}
    </>
  );

  const chip: ReactNode = (
    <span className="pointer-events-auto rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] px-2.5 py-1.5 font-mono text-[10.5px] text-[var(--bl-text-dim)] backdrop-blur-xl" style={FLUTUA} title="nós do grafo · entidades do ecossistema no recorte atual">
      <strong className="text-[var(--bl-text-primary)]">{totalNos}</strong> nós · {entities.length}/{totalEntidades} entidades
    </span>
  );

  return (
    <div
      ref={caixa}
      className={`relative isolate overflow-hidden text-[var(--bl-text-primary)] ${cheia ? "fixed inset-0 z-50" : ""}`}
      style={
        {
          background: visao === "neural" ? "#070b18" : "var(--bl-bg-primary)",
          // controles flutuam a partir de onde começa a área livre (vem do shell; muda com o orb)
          "--g-esq": cheia ? "12px" : "var(--canvas-left)",
          "--g-topo": cheia ? "12px" : "var(--canvas-top)",
          ...(cheia ? { height: "100vh" } : { height: "calc(100vh - 20px)", minHeight: 480, marginRight: 20, marginBottom: 20 }),
        } as unknown as React.CSSProperties
      }
      data-testid="brain-grafo"
    >
      <style>{`@keyframes bl-entra{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}@keyframes bl-surge{from{opacity:0;transform:scale(.6)}to{opacity:.8;transform:scale(1)}}@keyframes bl-cresce{from{opacity:0}to{opacity:1}}.bl-entra{animation:bl-entra 320ms cubic-bezier(.2,.7,.2,1) both}.bl-surge{transform-box:fill-box;transform-origin:center;animation:bl-surge 260ms cubic-bezier(.2,.7,.2,1) both}.bl-cresce{animation:bl-cresce 400ms ease both}@keyframes bl-respira{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}@keyframes bl-anel-pulso{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(1.7)}}.bl-glifo{transform-box:fill-box;transform-origin:center;transition:transform 260ms cubic-bezier(.34,1.56,.64,1)}.bl-no[role=button]:hover .bl-glifo{transform:scale(1.18)}.bl-respira{transform-box:fill-box;transform-origin:center;animation:bl-respira 3.6s ease-in-out infinite}.bl-anel-pulso{transform-box:fill-box;transform-origin:center;animation:bl-anel-pulso 2.4s cubic-bezier(0,0,.2,1) infinite}.bl-icone-vivo{transition:transform 260ms cubic-bezier(.34,1.56,.64,1)}.bl-icone-vivo:hover{transform:scale(1.12)}@media (max-width:767px){[data-testid="brain-grafo"]{--g-esq:16px!important}}@media (prefers-reduced-motion:reduce){.bl-entra,.bl-surge,.bl-cresce,.bl-respira,.bl-anel-pulso{animation:none}.bl-glifo,.bl-icone-vivo{transition:none}.bl-no[role=button]:hover .bl-glifo,.bl-icone-vivo:hover{transform:none}}`}</style>
      {visao === "radial" && (
        <>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `${tinta}, linear-gradient(rgba(128,128,128,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,128,.10) 1px, transparent 1px)`,
              backgroundSize: "auto, 44px 44px, 44px 44px",
            }}
          />
          {/* área do canvas: recorta o zoom e captura arrasto/roda; o conteúdo é o que anda e escala */}
          <div
            ref={panRadial.vistaRef}
            {...panRadial.bindings}
            onClickCapture={panRadial.clique}
            className="absolute touch-none select-none overflow-hidden transition-[left,top,width,height] duration-300"
            style={{ left: "var(--g-esq)", top: `calc(var(--g-topo) + ${alturaBarra}px)`, width: `calc(100% - var(--g-esq) - ${direita}px)`, height: `calc(100% - var(--g-topo) - ${alturaBarra}px)`, cursor: "grab" }}
            data-testid="grafo-radial-area"
          >
            <div ref={panRadial.conteudoRef} className="absolute inset-0 origin-[0_0] will-change-transform" data-testid="grafo-radial-conteudo">
              <svg
                key={notasAbertas && mem ? "notas" : "cena"}
                viewBox={notasAbertas && mem ? "-500 -480 1000 960" : VIEWBOX_CENA}
                preserveAspectRatio="xMidYMid meet"
                className="block h-full w-full"
                role="img"
                aria-label={pilarFoco ? `pilar ${pilarFoco.nome}` : "visão geral do grafo"}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setSelId(null);
                }}
              >
                {notasAbertas && mem ? (
                  <NotasZoom cena={geral} pilares={pilares} mem={mem} notaDestaque={notaDestaque} aoNota={(id) => setNotaSel(id)} c={comum} contagens={contagens} />
                ) : (
                  <>
                    <AnelGuia />
                    <CenaGrafo alvo={alvo} c={comum} mem={mem} onNotas={() => { setNotasAbertas(true); setFoco(null); setSelId(null); }} pilarFocoId={pilarFoco?.id ?? null} />
                  </>
                )}
              </svg>
            </div>
          </div>

          {/* setas laterais para o pilar vizinho (dentro da área livre) */}
          {pilarFoco && pilares.length > 1 && (
            <>
              <button aria-label="pilar anterior" onClick={() => navegar(-1)} className="absolute top-1/2 z-10 -translate-y-1/2 flex h-16 w-9 items-center justify-center rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] text-[var(--bl-text-dim)] backdrop-blur-xl hover:border-[var(--bl-border-accent)] hover:text-[var(--bl-text-primary)]" style={{ left: "calc(var(--g-esq) + 4px)" }}>
                <ChevronLeft size={26} />
              </button>
              <button aria-label="próximo pilar" onClick={() => navegar(1)} className="absolute top-1/2 z-10 -translate-y-1/2 flex h-16 w-9 items-center justify-center rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] text-[var(--bl-text-dim)] backdrop-blur-xl hover:border-[var(--bl-border-accent)] hover:text-[var(--bl-text-primary)]" style={{ right: direita + 4 }}>
                <ChevronRight size={26} />
              </button>
            </>
          )}

          {limitado.length > 0 && (
            <p className="absolute bottom-3 z-10 font-mono text-[10.5px] text-[var(--bl-text-dim)]" style={{ left: "var(--g-esq)" }}>
              desenhando {limitado.map(([k, v]) => `${v.de} de ${v.total} ${k}`).join(" · ")} — o diretório lista todos
            </p>
          )}
        </>
      )}

      {visao === "neural" && (
        <div
          ref={panNeural.vistaRef}
          {...panNeural.bindings}
          onClickCapture={panNeural.clique}
          className="absolute touch-none select-none overflow-hidden transition-[left,top,right] duration-300"
          style={{ left: "var(--g-esq)", top: `calc(var(--g-topo) + ${alturaBarra}px)`, right: direita, bottom: 0, cursor: "grab" }}
          data-testid="grafo-neural-area"
        >
          <div ref={panNeural.conteudoRef} className="mx-auto w-full max-w-[1100px] origin-[0_0] will-change-transform" data-testid="grafo-neural-conteudo">
            <NeuralView dados={neural} />
          </div>
        </div>
      )}

      {semDados && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6" style={{ left: "var(--g-esq)", top: `calc(var(--g-topo) + ${alturaBarra}px)` }}>
          <section role="status" className="pointer-events-auto max-w-lg rounded-[var(--bl-radius-md)] border border-[var(--bl-border-1)] p-5 text-sm leading-relaxed text-[var(--bl-text-secondary)] backdrop-blur-xl" style={FLUTUA} data-testid="grafo-vazio">
            <h2 className="text-base font-semibold text-[var(--bl-text-primary)]">O grafo ainda está vazio</h2>
            <p className="mt-2">
              Ele desenha só o que você configurar: o inventário do ecossistema (<code className="font-mono text-[12px]">BILHON_REGISTRO_ENTIDADES</code>, <code className="font-mono text-[12px]">repos.json</code> e{" "}
              <code className="font-mono text-[12px]">espelhos.json</code>), a organização em pilares (<code className="font-mono text-[12px]">BILHON_BRAIN_ORG_JSON</code>) e uma pasta de notas .md com
              links <code className="font-mono text-[12px]">[[assim]]</code> (<code className="font-mono text-[12px]">BILHON_BRAIN_STORE</code>).
            </p>
            <p className="mt-2">
              Os formatos estão em <code className="font-mono text-[12px]">docs/agente-registro.md</code>. A aba Cards mostra o estado de cada fonte.
            </p>
          </section>
        </div>
      )}

      {/* legenda das camadas, em tela cheia (canto inferior esquerdo) */}
      {cheia && (
        <div className="pointer-events-none absolute bottom-3 z-20 flex items-center gap-3 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] px-2.5 py-1.5 font-mono text-[10.5px] text-[var(--bl-text-dim)] backdrop-blur-xl" style={{ ...FLUTUA, left: 12 }}>
          {[
            { t: "nota", r: "Notas", c: "#fb923c" },
            { t: "humano", r: "Pessoa", c: "#f59e0b" },
            { t: "agente", r: "Agente", c: "#e5e7eb" },
            { t: "ferramenta", r: "Ferramenta", c: "#ef4444" },
            { t: "tarefa", r: "Tarefa", c: "#9ca3af" },
          ].map((i) => (
            <span key={i.r} className="flex items-center gap-1.5">
              <IconeRedondo tipo={i.t as TipoNo | "nota"} cor={i.c} tamanho={14} />
              {i.r}
            </span>
          ))}
        </div>
      )}

      {/* controles flutuantes: a partir de --canvas-left/--canvas-top, nunca sob topbar/rail */}
      <div className="pointer-events-none absolute z-20 flex max-w-[calc(100%-2rem)] flex-col items-start gap-2 transition-[left,top] duration-300" style={{ left: "var(--g-esq)", top: "var(--g-topo)" }}>
        <div className="flex flex-wrap items-center gap-2">
          {visao === "radial" && notasAbertas && !pilarFoco && (
            <>
              <button className={`pointer-events-auto ${BTN}`} style={FLUTUA} onClick={() => { setNotasAbertas(false); setNotaSel(null); }}>
                <ArrowLeft size={13} /> Voltar
              </button>
              <span className="pointer-events-auto rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] px-2.5 py-1.5 font-mono text-[11px] text-[#fb923c] backdrop-blur-xl" style={FLUTUA}>
                notas · {mem?.notas.length ?? 0} de {mem?.total ?? 0} (com link)
              </span>
            </>
          )}
          {visao === "radial" && pilarFoco && (
            <>
              <button className={`pointer-events-auto ${BTN}`} style={FLUTUA} onClick={() => { setFoco(null); setSelId(null); }}>
                <ArrowLeft size={13} /> Voltar
              </button>
              <div className="pointer-events-auto flex items-center gap-1 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] px-1.5 py-1 font-mono text-[11px] backdrop-blur-xl" style={FLUTUA}>
                <button aria-label="pilar anterior" onClick={() => navegar(-1)} className="px-1 text-[var(--bl-text-dim)] hover:text-[var(--bl-text-primary)]">
                  <ChevronLeft size={13} />
                </button>
                <button aria-label="próximo pilar" onClick={() => navegar(1)} className="px-1 text-[var(--bl-text-dim)] hover:text-[var(--bl-text-primary)]">
                  <ChevronRight size={13} />
                </button>
                <span className="px-1.5" style={{ color: pilarFoco.cor }}>
                  {pilarFoco.nome}
                </span>
                {/* paginação: um ponto por pilar, na ordem do anel; o do pilar em foco fica cheio */}
                <span className="flex items-center gap-1 px-1.5" aria-label="pilares">
                  {pilares.map((p) => (
                    <button
                      key={p.id}
                      aria-label={p.nome}
                      title={p.nome}
                      onClick={() => { setFoco(p.id); setSelId(null); }}
                      className="h-2 w-2 rounded-full border"
                      style={{ borderColor: p.cor, background: p.id === pilarFoco.id ? p.cor : "transparent" }}
                    />
                  ))}
                </span>
                <button aria-label="sair do pilar" onClick={() => { setFoco(null); setSelId(null); }} className="px-1 text-[var(--bl-text-dim)] hover:text-[var(--bl-text-primary)]">
                  <X size={12} />
                </button>
              </div>
            </>
          )}
          {visao === "radial" && !pilarFoco && (
            <div className="pointer-events-auto relative">
              <label className="flex items-center gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--bl-text-dim)] backdrop-blur-xl" style={FLUTUA}>
                <Search size={12} />
                <input
                  ref={busca}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && resultados[0]) irPara(resultados[0]);
                    if (e.key === "Escape") {
                      setQ("");
                      busca.current?.blur();
                    }
                  }}
                  placeholder="buscar nota ou nó…"
                  aria-label="buscar nota ou nó"
                  className="w-44 bg-transparent text-[var(--bl-text-primary)] outline-none placeholder:text-[var(--bl-text-dim)]"
                />
                <kbd className="rounded border border-[var(--bl-border)] px-1 text-[10px]">/</kbd>
              </label>
              {resultados.length > 0 && (
                <ul className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] shadow-xl backdrop-blur-xl" style={{ background: "rgba(9, 9, 12, 0.94)" }}>
                  {resultados.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => irPara(r)} className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-white/5">
                        <span className="min-w-0 flex-1 truncate text-[12px]">{r.rotulo}</span>
                        <span className="font-mono text-[10px] text-[var(--bl-text-dim)]">
                          {r.tipo} · {r.sub}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] px-1 py-1 font-mono text-[11px] text-[var(--bl-text-dim)] backdrop-blur-xl" style={FLUTUA} role="group" aria-label="zoom do grafo">
            <button aria-label="aproximar" title="aproximar (+)" onClick={() => zoomAtivo(1.25)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/5 hover:text-[var(--bl-text-primary)] active:scale-90 transition-[transform,background-color,color] duration-150">
              <ZoomIn size={13} />
            </button>
            <span className="w-10 text-center tabular-nums text-[var(--bl-text-primary)]" aria-live="polite" data-testid="zoom-percent">
              {Math.round(kAtivo * 100)}%
            </span>
            <button aria-label="afastar" title="afastar (−)" onClick={() => zoomAtivo(1 / 1.25)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/5 hover:text-[var(--bl-text-primary)] active:scale-90 transition-[transform,background-color,color] duration-150">
              <ZoomOut size={13} />
            </button>
            <button aria-label="vista inicial" title="vista inicial (0)" onClick={resetAtivo} className="ml-0.5 flex h-6 w-6 items-center justify-center rounded hover:bg-white/5 hover:text-[var(--bl-text-primary)] active:scale-90 transition-[transform,background-color,color] duration-150">
              <RotateCcw size={12} />
            </button>
          </div>
          {chip}
          {filtroSquad && (
            <span className="pointer-events-auto flex items-center gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-1)] px-2.5 py-1.5 text-[11px] text-[var(--bl-text-secondary)] backdrop-blur-xl" style={FLUTUA}>
              workers de <strong className="text-[var(--bl-text-primary)]">{filtroSquad.nome}</strong>
              <button onClick={filtroSquad.limpar} aria-label="limpar filtro de squad" className="text-[var(--bl-text-dim)] hover:text-[var(--bl-text-primary)]">
                <X size={12} />
              </button>
            </span>
          )}
          <button className={`pointer-events-auto ${BTN}`} style={FLUTUA} onClick={alternarTela} aria-pressed={cheia}>
            {cheia ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {cheia ? "Sair da tela cheia" : "Tela cheia"}
          </button>
        </div>
        {avisos}
      </div>

      {/* painel direito flutuante: lentes, legenda e diretório (recolhível) */}
      {painelAberto ? (
        <aside
          className="bl-entra absolute z-20 flex flex-col overflow-hidden rounded-[var(--bl-radius-xl)] border border-[var(--bl-border-1)] shadow-2xl backdrop-blur-xl"
          style={{ right: 12, top: "var(--g-topo)", bottom: 12, width: LARG_PAINEL, background: "rgba(9, 9, 12, 0.92)" }}
          aria-label="lentes, legenda e diretório"
        >
          <header className="flex items-center justify-between border-b border-[var(--bl-border)] px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--bl-text-dim)]">Painel</span>
            <button onClick={alternarPainel} aria-label="recolher painel" title="recolher painel" className="text-[var(--bl-text-dim)] hover:text-[var(--bl-text-primary)]">
              <PanelRightClose size={15} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <Lateral lente={lente} onLente={setLente} funcoes={opcoes.funcoes} acoes={opcoes.acoes} legenda={legenda} grupos={indice.grupos} selId={selId} onItem={irPara} onHover={setHoverId} ocultos={ocultos} onToggleCamada={toggleCamada} />
          </div>
        </aside>
      ) : (
        <button
          onClick={alternarPainel}
          aria-label="abrir painel"
          title="abrir lentes, legenda e diretório"
          className={`absolute z-20 ${BTN}`}
          style={{ ...FLUTUA, right: 12, top: "var(--g-topo)" }}
        >
          <PanelRightOpen size={14} /> Painel
        </button>
      )}

      {notasAbertas && visao === "radial" && notaSel && mem && mem.notas.find((n) => n.id === notaSel) && (
        <PainelNota nota={mem.notas.find((n) => n.id === notaSel)!} direita={painelAberto ? 12 + LARG_PAINEL + 12 : 12 + 96} onFechar={() => setNotaSel(null)} />
      )}
      {temPainel && selId && visao === "radial" && (
        <Painel
          selId={selId}
          org={org}
          pilares={pilares}
          entidade={sel}
          direita={painelAberto ? 12 + LARG_PAINEL + 12 : 12 + 96}
          onFechar={() => setSelId(null)}
          onSelecionar={(id) => {
            const it = indice.itens.find((x) => x.id === id);
            if (it) irPara(it);
            else setSelId(id);
          }}
          onAbrirCard={onAbrirCard}
        />
      )}
    </div>
  );
}
