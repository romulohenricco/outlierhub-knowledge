"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Library,
  Search,
  Waypoints,
  Images,
  Boxes,
  Kanban,
  Archive,
  Star,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
  X,
  Inbox,
  Package,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { ThemePicker } from "./ThemePicker";
import { usePagePanelContent } from "./PagePanel";
import { usePageTopbarContent } from "./PageTopbar";
import { PrimeiroUsoMegabrain } from "./PrimeiroUsoMegabrain";

type NavItem = {
  href: string;
  curto: string;
  rotulo: string;
  desc: string;
  Icon: LucideIcon;
};


// Ordem padrão do menu (quem arrastar os itens guarda a própria em localStorage).
const NAV: NavItem[] = [
  { href: "/agente", curto: "agente", rotulo: "agente", desc: "ecossistema — squads, agents, skills…", Icon: Bot },
  { href: "/ingestoes", curto: "ingest", rotulo: "ingestões", desc: "tudo que foi ingerido + importações em lote", Icon: Inbox },
  { href: "/estante", curto: "estante", rotulo: "estante", desc: "acervo de livros", Icon: Library },
  { href: "/referencias", curto: "refs", rotulo: "referências", desc: "salvos do Instagram + sites", Icon: Images },
  { href: "/ontologia", curto: "onto", rotulo: "ontologia", desc: "modelo de como as coisas se organizam", Icon: Boxes },
  { href: "/grafo", curto: "grafo", rotulo: "grafo", desc: "conhecimento conectado", Icon: Waypoints },
  { href: "/integracoes", curto: "integ", rotulo: "integrações", desc: "catálogo de padrões reaproveitáveis", Icon: Package },
  { href: "/mysocialmedia", curto: "social", rotulo: "minhas redes", desc: "início das redes · Instagram: saves e contas · YouTube: playlists", Icon: UsersRound },
  { href: "/kanban/backlog", curto: "backlog", rotulo: "backlog", desc: "histórico completo de tickets", Icon: Archive },
  { href: "/kanban", curto: "kanban", rotulo: "kanban", desc: "tickets de ingest & melhoria", Icon: Kanban },
];

/** Só o item MAIS ESPECÍFICO acende. Sem isso `/kanban/backlog` casaria com o
 *  prefixo `/kanban` também, e dois itens do menu ficariam ativos ao mesmo tempo. */
function ehAtivo(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  if (!pathname.startsWith(href)) return false;
  return !NAV.some((n) => n.href !== href && n.href.startsWith(href) && pathname.startsWith(n.href));
}

const ORDEM_KEY = "bl-nav-ordem";
const CHROME_KEY = "bl-chrome";

/** Páginas que mudaram de URL — a ordem salva no navegador ainda guarda o href
 *  antigo, e sem esse mapa o item cairia pro fim do menu. */
const HREF_ANTIGO: Record<string, string> = {
  "/": "/estante",
  "/addons": "/integracoes",
};

/** Aplica uma ordem salva (array de href) sobre o NAV canônico — itens novos que
 *  ainda não estão na ordem salva (ex.: página adicionada depois) vão pro fim. */
function aplicarOrdemSalva(salvos: string[]): NavItem[] {
  const hrefs = salvos.map((h) => HREF_ANTIGO[h] ?? h);
  const porHref = new Map(NAV.map((n) => [n.href, n]));
  const ordenado = hrefs.map((h) => porHref.get(h)).filter((n): n is NavItem => !!n);
  const faltando = NAV.filter((n) => !hrefs.includes(n.href));
  return [...ordenado, ...faltando];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const panelContent = usePagePanelContent();
  const topbarContent = usePageTopbarContent();
  // páginas sem conteúdo próprio (busca, grafo, ontologia) não mostram o painel —
  // a lista de nav já vive no rail de ícones, repeti-la aqui seria redundante.
  const temPainel = panelContent != null;
  // estado inicial casa com o data-nav aplicado pelo script inline (evita flash)
  const [colapsado, setColapsado] = useState(false);
  // orb: recolhe/abre TODO o chrome (topbar + rail + painel); só o orb fica na tela
  const [recolhido, setRecolhido] = useState(false);
  const [navOrdem, setNavOrdem] = useState<NavItem[]>(NAV);
  const arrastando = useRef<string | null>(null);
  const [dragOverHref, setDragOverHref] = useState<string | null>(null);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [buscaValor, setBuscaValor] = useState("");
  const buscaInputRef = useRef<HTMLInputElement>(null);

  const abrirBusca = useCallback(() => {
    setBuscaAberta(true);
    requestAnimationFrame(() => buscaInputRef.current?.focus());
  }, []);

  const fecharBusca = useCallback(() => {
    setBuscaAberta(false);
    setBuscaValor("");
  }, []);

  const enviarBusca = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!buscaValor.trim()) return;
      router.push(`/buscar?q=${encodeURIComponent(buscaValor.trim())}`);
      fecharBusca();
    },
    [buscaValor, router, fecharBusca],
  );

  useEffect(() => {
    try {
      const salvo = localStorage.getItem("bl-nav");
      // ≤1023px o painel é overlay → começa colapsado (casa com o script inline)
      const compacto = window.innerWidth <= 1023;
      setColapsado(compacto ? true : salvo === "collapsed");
    } catch {
      setColapsado(window.innerWidth <= 1023);
    }
    try {
      setRecolhido(localStorage.getItem(CHROME_KEY) === "recolhido");
    } catch {
      /* ignora — começa aberto */
    }
    try {
      const ordemSalva = localStorage.getItem(ORDEM_KEY);
      if (ordemSalva) setNavOrdem(aplicarOrdemSalva(JSON.parse(ordemSalva)));
    } catch {
      /* ignora — usa a ordem canônica */
    }
  }, []);

  const onDragStart = useCallback(
    (href: string) => (e: React.DragEvent) => {
      arrastando.current = href;
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const onDragOverItem = useCallback(
    (href: string) => (e: React.DragEvent) => {
      e.preventDefault();
      if (arrastando.current && arrastando.current !== href) setDragOverHref(href);
    },
    [],
  );

  const onDrop = useCallback(
    (hrefAlvo: string) => (e: React.DragEvent) => {
      e.preventDefault();
      const origem = arrastando.current;
      arrastando.current = null;
      setDragOverHref(null);
      if (!origem || origem === hrefAlvo) return;
      setNavOrdem((atual) => {
        const item = atual.find((n) => n.href === origem);
        if (!item) return atual;
        const semOrigem = atual.filter((n) => n.href !== origem);
        const idx = semOrigem.findIndex((n) => n.href === hrefAlvo);
        const novo = [...semOrigem.slice(0, idx), item, ...semOrigem.slice(idx)];
        try {
          localStorage.setItem(ORDEM_KEY, JSON.stringify(novo.map((n) => n.href)));
        } catch {
          /* ignora */
        }
        return novo;
      });
    },
    [],
  );

  const onDragEnd = useCallback(() => {
    arrastando.current = null;
    setDragOverHref(null);
  }, []);

  // fonte única do atributo data-nav (CSS): colapsado por escolha do usuário OU
  // porque a página atual não tem conteúdo pro painel.
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-nav",
      colapsado || !temPainel ? "collapsed" : "expanded",
    );
  }, [colapsado, temPainel]);

  // data-chrome (CSS): o script inline do layout aplica o estado salvo antes da
  // pintura; daqui só se escreve ao alternar. Um effect na montagem regravava
  // "aberto" por um frame e os menus piscavam a cada reload.
  const alternarChrome = useCallback(() => {
    setRecolhido((prev) => {
      const proximo = !prev;
      document.documentElement.setAttribute("data-chrome", proximo ? "recolhido" : "aberto");
      try {
        localStorage.setItem(CHROME_KEY, proximo ? "recolhido" : "aberto");
      } catch {
        /* ignora */
      }
      // foco não pode ficar num menu que acabou de sumir
      if (proximo && document.activeElement instanceof HTMLElement && document.activeElement.closest(".bl-topbar, .bl-sidebar-rail, .bl-sidebar-panel")) {
        document.activeElement.blur();
      }
      return proximo;
    });
  }, []);

  // atalho: Cmd+. (Mac) / Ctrl+. — mesmo efeito do orb, de qualquer página
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "." && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        alternarChrome();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [alternarChrome]);

  const aplicar = useCallback((valor: boolean) => {
    try {
      localStorage.setItem("bl-nav", valor ? "collapsed" : "expanded");
    } catch {
      /* ignora */
    }
    setColapsado(valor);
  }, []);

  const alternar = useCallback(() => {
    setColapsado((prev) => {
      const proximo = !prev;
      try {
        localStorage.setItem("bl-nav", proximo ? "collapsed" : "expanded");
      } catch {
        /* ignora */
      }
      return proximo;
    });
  }, []);

  // em telas compactas (painel overlay) fecha ao navegar, revelando o conteúdo
  const fecharSeCompacto = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth <= 1023) {
      aplicar(true);
    }
  }, [aplicar]);

  return (
    <>
      {/* ── Orb: fixo e sempre visível — abre/recolhe todos os menus flutuantes ── */}
      <button
        type="button"
        onClick={alternarChrome}
        className="bl-orb"
        aria-label="Menus"
        aria-expanded={!recolhido}
        title={recolhido ? "mostrar menus (⌘. / Ctrl+.)" : "recolher menus — fica só o orb (⌘. / Ctrl+.)"}
      >
        <span className="logo-orb" />
      </button>

      {/* ── Topbar (marca + ações globais) ── */}
      <header className="bl-topbar" inert={recolhido}>
        {/* hambúrguer: só aparece em telas compactas (CSS) — abre/fecha o painel overlay */}
        <button
          type="button"
          onClick={alternar}
          className="bl-topbar__menu"
          aria-label="Alternar navegação"
          title="Navegação"
        >
          <Menu size={20} strokeWidth={1.75} />
        </button>
        <Link className="bl-topbar__brand" href="/">
          <span className="bl-topbar__brand-name">Template Knowledge</span>
        </Link>
        {buscaAberta ? (
          <form onSubmit={enviarBusca} className="ml-3 flex items-center gap-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-40" />
              <input
                ref={buscaInputRef}
                value={buscaValor}
                onChange={(e) => setBuscaValor(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && fecharBusca()}
                onBlur={() => !buscaValor && fecharBusca()}
                placeholder="buscar no acervo…"
                className="w-56 rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-1.5 pl-8 pr-2 text-[13px] outline-none ring-1 ring-[var(--bl-border-accent)] placeholder:text-[var(--bl-text-muted)]"
              />
            </div>
            <button
              type="button"
              onClick={fecharBusca}
              className="bl-topbar__action"
              aria-label="fechar busca"
              title="fechar"
            >
              <X size={16} className="bl-topbar__action-icon" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={abrirBusca}
            className="bl-topbar__action ml-3"
            aria-label="Busca semântica"
            title="busca semântica no acervo"
          >
            <Search size={18} className="bl-topbar__action-icon" />
          </button>
        )}
        {/* slot da página (usePageTopbar): abas de visão etc. */}
        {topbarContent && <div className="ml-4 flex items-center gap-1">{topbarContent}</div>}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <Link
            href="/referencias?fav=1"
            className="bl-topbar__action"
            aria-label="Favoritos"
            title="referências favoritas"
          >
            <Star size={18} className="bl-topbar__action-icon" />
          </Link>
          <ThemePicker />
          <span className="ml-3 text-[11px] text-[var(--bl-text-muted)]">
            local-first · 127.0.0.1
          </span>
        </span>
      </header>

      {/* ── Rail (ícones, sempre visível) ── */}
      <nav className="bl-sidebar-rail" aria-label="Navegação principal" inert={recolhido}>
        {/* topo: só existe em página com painel (senão não há o que expandir) */}
        {temPainel && (
          <button
            type="button"
            onClick={alternar}
            className="bl-sidebar-rail__item bl-sidebar-rail__toggle"
            title="Expandir painel"
            aria-label="Expandir painel de navegação"
          >
            <PanelLeftOpen className="bl-sidebar-rail__item-icon" strokeWidth={1.75} />
          </button>
        )}
        {navOrdem.map((item) => {
          const ativo = ehAtivo(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={fecharSeCompacto}
              draggable
              onDragStart={onDragStart(item.href)}
              onDragOver={onDragOverItem(item.href)}
              onDrop={onDrop(item.href)}
              onDragEnd={onDragEnd}
              className={`bl-sidebar-rail__item${ativo ? " bl-sidebar-rail__item--active" : ""}${dragOverHref === item.href ? " bl-sidebar-rail__item--drag-over" : ""}`}
              // a ordem do menu é arrastável e persiste em localStorage, mas nada
              // no ícone indicava isso — a dica no title é a única pista.
              title={`${item.rotulo} — ${item.desc} · arraste para reordenar`}
              aria-current={ativo ? "page" : undefined}
            >
              <item.Icon className="bl-sidebar-rail__item-icon" strokeWidth={1.75} />
              <span className="bl-sidebar-rail__item-label">{item.curto}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Panel (conteúdo da página atual, colapsável) — só existe se a página publicou algo ── */}
      {temPainel && (
        <aside className="bl-sidebar-panel" aria-label="Painel de navegação" aria-hidden={colapsado} inert={colapsado || recolhido}>
          <div className="bl-sidebar-panel__header">
            <span className="bl-sidebar-panel__title">Navegação</span>
            <button
              type="button"
              onClick={alternar}
              className="bl-sidebar-panel__toggle"
              title="Minimizar painel"
              aria-label="Minimizar painel de navegação"
            >
              <PanelLeftClose size={18} strokeWidth={1.75} />
            </button>
          </div>
          {panelContent}
        </aside>
      )}

      {/* ── Backdrop (scrim) — só visível com painel overlay aberto em telas compactas ── */}
      <div
        className="bl-sidebar-backdrop"
        onClick={() => aplicar(true)}
        aria-hidden="true"
      />

      {/* ── Conteúdo da página ── */}
      <div className="bl-content">{children}</div>

      {/* pergunta única na primeira abertura dentro de um Megabrain (lib/primeiro-uso.ts) */}
      <PrimeiroUsoMegabrain />
    </>
  );
}
