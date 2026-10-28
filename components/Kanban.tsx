"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUpWideNarrow,
  Bot,
  CalendarClock,
  CalendarPlus,
  Check,
  CircleDashed,
  Cloud,
  Copy,
  File,
  FileText,
  GripHorizontal,
  GripVertical,
  ImagePlus,
  Lightbulb,
  Link2,
  ListChecks,
  Lock,
  Mic,
  Newspaper,
  PanelLeft,
  PanelRight,
  Pencil,
  Play,
  Plus,
  Rss,
  Search,
  Square,
  Trash2,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Secao, ListaExpansivel, linhaCls } from "./Filtros";
import {
  CANAL_INFO,
  EXECUCAO_INFO,
  FONTE_ROTULO,
  FONTE_TIPOS,
  iconeDaColuna,
  LINK_INFO,
  LINK_TIPOS,
  PRIORIDADE_INFO,
  PROJETO_INFO,
  TIPO_INFO,
  type KanbanExecucaoFiltro,
} from "./kanbanInfo";
import { usePagePanel } from "./PagePanel";
import { useToast } from "./Toast";
import { estimarTokens, ordenarParaLote } from "@/lib/kanbanLote";
import type {
  KanbanBoard,
  KanbanCanalPedido,
  KanbanCard,
  KanbanColunaId,
  KanbanExecucao,
  KanbanFonteTipo,
  KanbanLink,
  KanbanLinkTipo,
  KanbanPrioridade,
  KanbanProjeto,
  KanbanTipo,
  KanbanVinculo,
  SearchHit,
} from "@/lib/types";
import { DOD_POR_TIPO, KANBAN_PROJETO_PADRAO } from "@/lib/types";

// Escala compacta (~65% do padrão) reaproveitada em qualquer área apertada
// que precise que .bl-input/.bl-select/.bl-textarea/.bl-btn encolham — eles
// herdam automático por já usarem var(--bl-*). Via `style` inline (não CSS
// externo: um bloco de stylesheet só com custom properties não é aplicado de
// forma confiável pelo build). Histórico da
// calibragem (modal de ticket): 70% grande demais → 40% pequeno demais → 55%
// ainda pequeno → 65% certo.
const COMPACT_SCALE_STYLE = {
  "--bl-text-xs": "9.1px",
  "--bl-text-sm": "10.4px",
  "--bl-text-base": "11.7px",
  "--bl-text-md": "13.7px",
  "--bl-text-lg": "15px",
  "--bl-space-1": "3.3px",
  "--bl-space-2": "6.5px",
  "--bl-space-3": "9.8px",
  "--bl-space-4": "13px",
  "--bl-space-5": "16.3px",
  "--bl-space-6": "19.5px",
  "--bl-space-8": "26px",
  "--bl-radius-sm": "5.2px",
  "--bl-radius-md": "6.5px",
  "--bl-radius-lg": "9.1px",
  "--bl-radius-xl": "13px",
} as unknown as React.CSSProperties;

// Modal de ticket usa a mesma escala + seu próprio z-index.
const MODAL_COMPACT_STYLE = {
  ...COMPACT_SCALE_STYLE,
  zIndex: "var(--bl-z-modal)",
} as unknown as React.CSSProperties;

/** Texto pra colar direto no terminal e já começar o ticket numa sessão nova —
 *  botão "copiar" no card (1 ticket por sessão, dentro do orçamento de
 *  contexto). Autocontido: título+descrição+metadados, sem
 *  precisar abrir o board de novo pra saber do que se trata. */
function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function construirPromptTicket(card: KanbanCard): string {
  const linhas = [
    `Kanban — inicia o ticket ${card.id}: ${card.titulo}`,
    "",
    card.descricao || "(sem descrição)",
    "",
    `tipo: ${TIPO_INFO[card.tipo].rotulo} · prioridade: ${PRIORIDADE_INFO[card.prioridade].rotulo} · projeto: ${PROJETO_INFO[card.projeto]} · execução: ${
      card.execucao ? EXECUCAO_INFO[card.execucao.modo].rotulo : "sem definição"
    }`,
  ];
  if (card.tags.length > 0) linhas.push(`tags: ${card.tags.join(", ")}`);
  if (card.responsavel) linhas.push(`responsável: ${card.responsavel}`);
  return linhas.join("\n");
}

/** Lista compacta de valores de texto (URL, path…) — "adicionar mais de 1" pra
 *  qualquer campo, sem ocupar espaço: 1 input + Enter, valores viram chips
 *  pequenos abaixo, sem título de seção nem padding extra. */
function ListaCompacta({
  valores,
  onChange,
  placeholder,
}: {
  valores: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [texto, setTexto] = useState("");
  const adicionar = () => {
    const v = texto.trim();
    if (!v) return;
    onChange([...valores, v]);
    setTexto("");
  };
  return (
    <div>
      <div className="flex gap-1">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              adicionar();
            }
          }}
          placeholder={placeholder}
          className="bl-input flex-1"
        />
        <button type="button" onClick={adicionar} className="bl-kanban-col-btn" title="adicionar" aria-label="adicionar">
          <Plus size={13} strokeWidth={2} />
        </button>
      </div>
      {valores.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {valores.map((v, i) => (
            <span key={i} className="bl-badge bl-badge-ghost max-w-[220px]" title={v}>
              <span className="truncate">{v}</span>
              <button
                type="button"
                onClick={() => onChange(valores.filter((_, j) => j !== i))}
                aria-label="remover"
                className="shrink-0 opacity-70 hover:opacity-100"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Editor da lista de links tipados (plataforma + URL, GitHub também pede repo
 *  pra achar o commit exato sem confundir entre projetos rodando em paralelo). */
function LinksEditor({ links, onChange }: { links: KanbanLink[]; onChange: (v: KanbanLink[]) => void }) {
  const [tipo, setTipo] = useState<KanbanLinkTipo>("outro");
  const [url, setUrl] = useState("");
  const [repo, setRepo] = useState("");

  const adicionar = () => {
    const u = url.trim();
    if (!u) return;
    const item: KanbanLink = { tipo, url: u, ...(tipo === "github" && repo.trim() ? { repo: repo.trim() } : {}) };
    onChange([...links, item]);
    setUrl("");
    setRepo("");
  };

  return (
    <div>
      {links.length > 0 && (
        <div className="mb-1.5 flex flex-col gap-1">
          {links.map((l, i) => {
            const info = LINK_INFO[l.tipo];
            return (
              <div key={i} className="flex items-center gap-1.5 text-[10px] text-[var(--bl-text-secondary)]">
                <info.Icon size={11} style={{ color: info.cor }} className="shrink-0" />
                <a href={l.url} target="_blank" rel="noreferrer" className="truncate hover:underline" title={l.url}>
                  {l.url}
                </a>
                {l.repo && <span className="bl-badge bl-badge-ghost shrink-0">{l.repo}</span>}
                <button
                  type="button"
                  onClick={() => onChange(links.filter((_, j) => j !== i))}
                  aria-label="remover link"
                  className="ml-auto shrink-0 opacity-70 hover:opacity-100"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex gap-1">
        <select value={tipo} onChange={(e) => setTipo(e.target.value as KanbanLinkTipo)} className="bl-select w-[38%]">
          {LINK_TIPOS.map((t) => (
            <option key={t} value={t}>
              {LINK_INFO[t].rotulo}
            </option>
          ))}
        </select>
        {tipo === "github" && (
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="repo"
            className="bl-input w-[22%]"
            title="nome do repo — evita confundir commit entre projetos"
          />
        )}
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              adicionar();
            }
          }}
          placeholder="URL"
          className="bl-input flex-1"
        />
        <button type="button" onClick={adicionar} className="bl-kanban-col-btn shrink-0" title="adicionar" aria-label="adicionar">
          <Plus size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/** Autor default de card novo — configurável (nunca hardcode pessoal); vazio
 *  quando a env var não está setada, o campo simplesmente fica em branco. */
const AUTOR_DEFAULT = process.env.NEXT_PUBLIC_KANBAN_DEFAULT_AUTHOR || null;

function novoDraft(coluna: KanbanColunaId): KanbanCard {
  const agora = new Date().toISOString();
  return {
    id: "",
    titulo: "",
    descricao: "",
    tipo: "melhoria",
    prioridade: "media",
    projeto: KANBAN_PROJETO_PADRAO,
    coluna,
    ordem: 0,
    responsavel: null,
    tags: [],
    origem: { canal: null, pedidoOriginal: null, solicitadoPor: AUTOR_DEFAULT },
    ingestao: { fonteTipo: [], fonteUrl: [], fontePath: [], bucket: null, pessoaAutor: null },
    links: [],
    vinculos: [],
    audios: [],
    imagens: [],
    checklist: [],
    historico: [],
    execucao: null,
    criadoEm: agora,
    atualizadoEm: agora,
    concluidoEm: null,
  };
}

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const novo = new Set(set);
  if (novo.has(v)) novo.delete(v);
  else novo.add(v);
  return novo;
}

/** Query params dos filtros ⇄ estado — a URL do board vira copiável/compartilhável
 *  (ex.: colar no terminal pra pedir ao agente "roda os tickets desse filtro"). */
const FILTRO_PARAMS = {
  tipo: "tipo",
  prioridade: "prioridade",
  projeto: "projeto",
  responsavel: "responsavel",
  tags: "tags",
  canal: "canal",
  execucao: "execucao",
} as const;

function paramParaSet<T extends string>(sp: URLSearchParams, chave: string): Set<T> {
  const v = sp.get(chave);
  if (!v) return new Set();
  return new Set(v.split(",").filter(Boolean) as T[]);
}

/** Ordem padrão das seções do painel de filtro — arrastável (ver
 *  secoesOrdem/SECOES_FILTRO_KEY), o usuário escolhe a melhor ordem. */
const SECOES_FILTRO_DEFAULT = [
  "execucao",
  "tipo",
  "prioridade",
  "projeto",
  "periodo",
  "responsavel",
  "tags",
  "canal",
];
const SECOES_FILTRO_KEY = "bl-kanban-filtros-ordem";

/** Aplica uma ordem salva sobre a lista canônica — seções novas que ainda não
 *  estão na ordem salva (ex.: seção adicionada depois) vão pro fim. Mesmo
 *  padrão de `aplicarOrdemSalva` em AppShell.tsx. */
function aplicarOrdemSecoes(salvo: string[]): string[] {
  const ordenado = salvo.filter((k) => SECOES_FILTRO_DEFAULT.includes(k));
  const faltando = SECOES_FILTRO_DEFAULT.filter((k) => !ordenado.includes(k));
  return [...ordenado, ...faltando];
}

/** Concatena o prompt autocontido de cada ticket filtrado num único bloco pra
 *  colar no terminal e mandar rodar em lote (ex.: de madrugada). */
function construirPromptLote(cards: KanbanCard[], criterios: string[]): string {
  const cabecalho = [
    `Kanban — lote de ${cards.length} ticket${cards.length > 1 ? "s" : ""}${
      criterios.length > 0 ? ` (${criterios.join(" · ")})` : ""
    }`,
    "Executa um de cada vez, na ordem abaixo.",
  ].join("\n");
  const corpo = cards.map((c) => construirPromptTicket(c)).join("\n\n---\n\n");
  return `${cabecalho}\n\n${corpo}`;
}

// Lote pequeno não precisa perguntar quantidade — só atrapalharia. Acima
// disso, o menu de quantidade entra em cena (ver MenuQuantidade abaixo).
const LOTE_SEM_MENU_ATE = 10;
const LOTE_PRESETS = [10, 20, 30, 40];

// Texto copiado a partir daqui já entra no toast com contagem de
// grande, sem virar ruído pra cópia de 1 ticket só).
const AVISO_TAMANHO_A_PARTIR_DE = 1500;

/** Menu de "quantos tickets copiar" — usado tanto pelo botão de coluna quanto
 *  pelo botão global do topo. Atalhos + campo pra digitar um número
 *  qualquer; fecha ao clicar fora, rolar a página/board ou Escape (mesmo
 *  padrão do ThemePicker pro clique-fora).
 *
 *  Renderiza via portal em `document.body`, posicionado `fixed` a partir do
 *  retângulo do botão que abriu — NUNCA como filho absoluto do card/coluna:
 *  `.bl-kanban-board` tem `overflow-x: auto` (scroll horizontal das colunas)
 *  e corta qualquer descendente absoluto que passe da borda esquerda do
 *  container, não importa o z-index (overflow corta antes de chequear
 *  stacking). Bug real: coluna TO DO (primeira, sem coluna à esquerda) tinha
 *  o menu cortado ao meio quando a sidebar estava colapsada. */
function MenuQuantidade({
  legenda,
  total,
  anchorEl,
  onEscolher,
  onFechar,
}: {
  legenda: string;
  total: number;
  anchorEl: HTMLElement;
  onEscolher: (quantidade: number) => void;
  onFechar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [customizado, setCustomizado] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const DROPDOWN_W = 260;
    const rect = anchorEl.getBoundingClientRect();
    const left = Math.min(window.innerWidth - DROPDOWN_W - 8, Math.max(8, rect.right - DROPDOWN_W));
    setPos({ top: rect.bottom + 8, left });
  }, [anchorEl]);

  useEffect(() => {
    const fecha = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onFechar();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    document.addEventListener("mousedown", fecha);
    document.addEventListener("keydown", esc);
    document.addEventListener("scroll", onFechar, true);
    window.addEventListener("resize", onFechar);
    return () => {
      document.removeEventListener("mousedown", fecha);
      document.removeEventListener("keydown", esc);
      document.removeEventListener("scroll", onFechar, true);
      window.removeEventListener("resize", onFechar);
    };
  }, [onFechar]);

  const presets = LOTE_PRESETS.filter((n) => n < total);

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      className="bl-lote-menu__dropdown"
      role="menu"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="bl-lote-menu__titulo">quantos tickets {legenda} copiar?</p>
      <div className="bl-lote-menu__opcoes">
        {presets.map((n) => (
          <button key={n} type="button" className="bl-lote-menu__opcao" onClick={() => onEscolher(n)}>
            {n}
          </button>
        ))}
        <button type="button" className="bl-lote-menu__opcao bl-lote-menu__opcao--todos" onClick={() => onEscolher(total)}>
          todos ({total})
        </button>
      </div>
      <form
        className="bl-lote-menu__custom"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Math.max(1, Math.min(total, parseInt(customizado, 10) || 0));
          if (n > 0) onEscolher(n);
        }}
      >
        <input
          type="number"
          min={1}
          max={total}
          value={customizado}
          onChange={(e) => setCustomizado(e.target.value)}
          placeholder="outro número"
          className="bl-lote-menu__input"
        />
        <button type="submit" className="bl-lote-menu__ir">
          copiar
        </button>
      </form>
      <p className="bl-lote-menu__dica">
        entram primeiro os mais rápidos e prontos pra rodar sozinhos (sem depender de humano) — quem destrava mais
        tickets ganha preferência.
      </p>
    </div>,
    document.body,
  );
}

export function Kanban({ board: boardInicial }: { board: KanbanBoard }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParamsIniciais = useSearchParams();
  const mostrarToast = useToast();
  const [board, setBoard] = useState(boardInicial);

  const [ordemCron, setOrdemCron] = useState<"desc" | "asc">("desc");
  const [filtroTipo, setFiltroTipo] = useState<Set<KanbanTipo>>(() =>
    paramParaSet(searchParamsIniciais, FILTRO_PARAMS.tipo),
  );
  const [filtroPrioridade, setFiltroPrioridade] = useState<Set<KanbanPrioridade>>(() =>
    paramParaSet(searchParamsIniciais, FILTRO_PARAMS.prioridade),
  );
  const [filtroProjeto, setFiltroProjeto] = useState<Set<KanbanProjeto>>(() =>
    paramParaSet(searchParamsIniciais, FILTRO_PARAMS.projeto),
  );
  const [filtroResponsavel, setFiltroResponsavel] = useState<Set<string>>(() =>
    paramParaSet(searchParamsIniciais, FILTRO_PARAMS.responsavel),
  );
  const [filtroTags, setFiltroTags] = useState<Set<string>>(() => paramParaSet(searchParamsIniciais, FILTRO_PARAMS.tags));
  const [filtroCanal, setFiltroCanal] = useState<Set<KanbanCanalPedido>>(() =>
    paramParaSet(searchParamsIniciais, FILTRO_PARAMS.canal),
  );
  const [filtroDataDe, setFiltroDataDe] = useState(() => searchParamsIniciais.get("de") ?? "");
  const [filtroDataAte, setFiltroDataAte] = useState(() => searchParamsIniciais.get("ate") ?? "");
  const [filtroExecucao, setFiltroExecucao] = useState<Set<KanbanExecucaoFiltro>>(() =>
    paramParaSet(searchParamsIniciais, FILTRO_PARAMS.execucao),
  );
  const [copiadoId, setCopiadoId] = useState<string | null>(null);
  const [copiadoLote, setCopiadoLote] = useState(false);
  const [copiadoColuna, setCopiadoColuna] = useState<KanbanColunaId | null>(null);
  const [menuColunaAberto, setMenuColunaAberto] = useState<KanbanColunaId | null>(null);
  const [menuGlobalAberto, setMenuGlobalAberto] = useState(false);
  // Elemento que abriu o menu de quantidade — o dropdown usa isso pra se
  // posicionar `fixed` via portal (ver MenuQuantidade acima do porquê).
  const [menuAncoraEl, setMenuAncoraEl] = useState<HTMLElement | null>(null);
  const [sincronizadoEm, setSincronizadoEm] = useState<number | null>(null);
  const [mudouAgora, setMudouAgora] = useState(false);
  const assinaturaRef = useRef<string>("");
  const pulseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draft, setDraft] = useState<KanbanCard | null>(null);
  const [criando, setCriando] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [novoItemChecklist, setNovoItemChecklist] = useState("");
  const [historicoAberto, setHistoricoAberto] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  // O botão de escalar só aparece quando o servidor tem um executor externo
  // configurado (BILHON_EXECUTION_URL); sem ele o recurso está desligado.
  const [escalarDisponivel, setEscalarDisponivel] = useState(false);
  useEffect(() => {
    let cancelado = false;
    fetch("/api/kanban/execucao")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelado) setEscalarDisponivel(Boolean(j?.escalar));
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);
  const [escalando, setEscalando] = useState(false);
  const [escalado, setEscalado] = useState<string | null>(null);
  const [aprendizadoTexto, setAprendizadoTexto] = useState("");
  const [aprendizadoSalvo, setAprendizadoSalvo] = useState(false);
  const [salvandoAprendizado, setSalvandoAprendizado] = useState(false);
  const arrastando = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const arrastandoColuna = useRef<string | null>(null);
  const [dragOverColuna, setDragOverColuna] = useState<string | null>(null);
  const [novaColunaAberta, setNovaColunaAberta] = useState(false);

  const [secoesOrdem, setSecoesOrdem] = useState<string[]>(SECOES_FILTRO_DEFAULT);
  const arrastandoSecao = useRef<string | null>(null);
  const [dragOverSecao, setDragOverSecao] = useState<string | null>(null);
  const [novaColunaTexto, setNovaColunaTexto] = useState("");
  const [editandoColuna, setEditandoColuna] = useState<string | null>(null);
  const [edicaoColunaTexto, setEdicaoColunaTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const erroTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [posicao, setPosicao] = useState<"centro" | "esquerda" | "direita">("centro");

  useEffect(() => {
    try {
      const salvo = localStorage.getItem("bl-kanban-modal-pos");
      if (salvo === "esquerda" || salvo === "direita" || salvo === "centro") setPosicao(salvo);
    } catch {
      /* ignora — usa centro */
    }
  }, []);

  const mudarPosicao = useCallback((p: "centro" | "esquerda" | "direita") => {
    setPosicao(p);
    try {
      localStorage.setItem("bl-kanban-modal-pos", p);
    } catch {
      /* ignora */
    }
  }, []);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(SECOES_FILTRO_KEY);
      if (salvo) setSecoesOrdem(aplicarOrdemSecoes(JSON.parse(salvo)));
    } catch {
      /* ignora — usa a ordem canônica */
    }
  }, []);

  const onDragStartSecao = useCallback(
    (key: string) => (e: React.DragEvent) => {
      arrastandoSecao.current = key;
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const onDragOverSecao = useCallback(
    (key: string) => (e: React.DragEvent) => {
      e.preventDefault();
      if (arrastandoSecao.current && arrastandoSecao.current !== key) setDragOverSecao(key);
    },
    [],
  );

  const onDropSecao = useCallback(
    (keyAlvo: string) => (e: React.DragEvent) => {
      e.preventDefault();
      const origem = arrastandoSecao.current;
      arrastandoSecao.current = null;
      setDragOverSecao(null);
      if (!origem || origem === keyAlvo) return;
      setSecoesOrdem((atual) => {
        const semOrigem = atual.filter((k) => k !== origem);
        const idx = semOrigem.findIndex((k) => k === keyAlvo);
        const novo = [...semOrigem.slice(0, idx), origem, ...semOrigem.slice(idx)];
        try {
          localStorage.setItem(SECOES_FILTRO_KEY, JSON.stringify(novo));
        } catch {
          /* ignora */
        }
        return novo;
      });
    },
    [],
  );

  const onDragEndSecao = useCallback(() => {
    arrastandoSecao.current = null;
    setDragOverSecao(null);
  }, []);

  const avisar = useCallback((msg: string) => {
    setErro(msg);
    if (erroTimeout.current) clearTimeout(erroTimeout.current);
    erroTimeout.current = setTimeout(() => setErro(null), 6000);
  }, []);

  // Carrega o aprendizado já salvo (se houver) quando abre um
  // card concluído — opt-in, nunca captura automático.
  const aprendizadoCardId = draft?.id;
  const aprendizadoColuna = draft?.coluna;
  useEffect(() => {
    setAprendizadoTexto("");
    setAprendizadoSalvo(false);
    if (!aprendizadoCardId || aprendizadoColuna !== "done") return;
    let cancelado = false;
    fetch(`/api/kanban/${aprendizadoCardId}/aprendizado`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelado || !j) return;
        setAprendizadoTexto(j.texto ?? "");
        setAprendizadoSalvo(!!j.texto);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [aprendizadoCardId, aprendizadoColuna]);

  const salvarAprendizadoHandler = useCallback(async () => {
    if (!draft || !aprendizadoTexto.trim()) return;
    setSalvandoAprendizado(true);
    try {
      const r = await fetch(`/api/kanban/${draft.id}/aprendizado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo: draft.titulo, texto: aprendizadoTexto }),
      });
      if (r.ok) setAprendizadoSalvo(true);
      else avisar("falha ao salvar aprendizado");
    } finally {
      setSalvandoAprendizado(false);
    }
  }, [draft, aprendizadoTexto, avisar]);

  /**
   * Escala o ticket para uma tarefa no executor externo configurado.
   *
   * O ticket NÃO é movido nem copiado: ele continua sendo a verdade aqui. O
   * executor cria uma tarefa que aponta de volta para este id.
   */
  const escalarHandler = useCallback(async () => {
    if (!draft) return;
    setEscalando(true);
    try {
      // Mesma origem: o proxy no servidor daqui é que fala com o executor externo,
      // para o botão não exigir CORS aberto lá.
      const r = await fetch(`/api/kanban/${draft.id}/escalar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.ok) {
        avisar(b?.erro ?? `falha ao escalar (${r.status})`);
        return;
      }
      setEscalado(b.taskId ?? "criada");
    } catch {
      avisar("falha de rede ao escalar");
    } finally {
      setEscalando(false);
    }
  }, [draft, avisar]);

  // Espelha o filtro ativo na URL (query params) — dá pra copiar o link e colar
  // no terminal ou salvar como atalho de um recorte do board.
  useEffect(() => {
    const sp = new URLSearchParams();
    const add = <T extends string>(chave: string, valores: Set<T>) => {
      if (valores.size > 0) sp.set(chave, Array.from(valores).join(","));
    };
    add(FILTRO_PARAMS.tipo, filtroTipo);
    add(FILTRO_PARAMS.prioridade, filtroPrioridade);
    add(FILTRO_PARAMS.projeto, filtroProjeto);
    add(FILTRO_PARAMS.responsavel, filtroResponsavel);
    add(FILTRO_PARAMS.tags, filtroTags);
    add(FILTRO_PARAMS.canal, filtroCanal);
    add(FILTRO_PARAMS.execucao, filtroExecucao);
    if (filtroDataDe) sp.set("de", filtroDataDe);
    if (filtroDataAte) sp.set("ate", filtroDataAte);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [
    filtroTipo,
    filtroPrioridade,
    filtroProjeto,
    filtroResponsavel,
    filtroTags,
    filtroCanal,
    filtroExecucao,
    filtroDataDe,
    filtroDataAte,
    pathname,
    router,
  ]);

  const refrescar = useCallback(async () => {
    const r = await fetch("/api/kanban");
    if (!r.ok) return;
    const novo: KanbanBoard = await r.json();
    // Assinatura do que importa visualmente (quais cards, em que coluna, e o
    // que o filtro observa) — detecta mudança vinda de fora sem diff do board
    // inteiro. Inclui `execucao` de propósito: trocar esse campo tira o card do
    // filtro ativo, e sem sinal isso parece "o ticket sumiu".
    const assinatura = novo.cards
      .map((c) => `${c.id}:${c.coluna}:${c.execucao?.modo ?? "-"}:${c.tipo}:${c.prioridade}`)
      .sort()
      .join("|");
    if (assinaturaRef.current && assinatura !== assinaturaRef.current) {
      setMudouAgora(true);
      if (pulseTimeout.current) clearTimeout(pulseTimeout.current);
      pulseTimeout.current = setTimeout(() => setMudouAgora(false), 2500);
    }
    assinaturaRef.current = assinatura;
    setBoard(novo);
    setSincronizadoEm(Date.now());
  }, []);

  // Polling: o board muda por fora o tempo todo (outra sessão, agente rodando
  // em background). Sem isso a tela mente sobre o estado real até um F5 manual.
  // Pausa durante edição/arrasto — refrescar no meio sobrescreveria o que está
  // sendo mexido — e com a aba em segundo plano, pra não gastar request à toa.
  useEffect(() => {
    const id = setInterval(() => {
      if (draft || arrastando.current || arrastandoColuna.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refrescar();
    }, 4000);
    return () => clearInterval(id);
  }, [draft, refrescar]);

  const criarColuna = useCallback(async () => {
    if (!novaColunaTexto.trim()) return;
    const r = await fetch("/api/kanban/colunas", {
      method: "POST",
      body: JSON.stringify({ rotulo: novaColunaTexto.trim() }),
    });
    if (r.ok) {
      setBoard(await r.json());
      setNovaColunaTexto("");
      setNovaColunaAberta(false);
    } else {
      avisar("não deu pra criar a coluna");
    }
  }, [novaColunaTexto, avisar]);

  const iniciarEdicaoColuna = useCallback((id: string, rotuloAtual: string) => {
    setEditandoColuna(id);
    setEdicaoColunaTexto(rotuloAtual);
  }, []);

  const salvarEdicaoColuna = useCallback(async () => {
    if (!editandoColuna || !edicaoColunaTexto.trim()) {
      setEditandoColuna(null);
      return;
    }
    const r = await fetch(`/api/kanban/colunas/${editandoColuna}`, {
      method: "PATCH",
      body: JSON.stringify({ rotulo: edicaoColunaTexto.trim() }),
    });
    if (r.ok) setBoard(await r.json());
    else avisar("não deu pra renomear a coluna");
    setEditandoColuna(null);
  }, [editandoColuna, edicaoColunaTexto, avisar]);

  const excluirColuna = useCallback(
    async (id: string, rotulo: string) => {
      const r = await fetch(`/api/kanban/colunas/${id}`, { method: "DELETE" });
      if (r.ok) {
        setBoard(await r.json());
      } else {
        const body = await r.json().catch(() => null);
        avisar(body?.erro ?? `não deu pra excluir "${rotulo}"`);
      }
    },
    [avisar],
  );

  const moverColuna = useCallback(
    async (destino: string) => {
      const origem = arrastandoColuna.current;
      arrastandoColuna.current = null;
      setDragOverColuna(null);
      if (!origem || origem === destino) return;
      const atual = board.colunas.map((c) => c.id);
      const semOrigem = atual.filter((id) => id !== origem);
      const idx = semOrigem.indexOf(destino);
      const nova = [...semOrigem.slice(0, idx), origem, ...semOrigem.slice(idx)];
      setBoard((b) => ({
        ...b,
        colunas: nova.map((id) => b.colunas.find((c) => c.id === id)!).filter(Boolean),
      }));
      const r = await fetch("/api/kanban/colunas", { method: "PATCH", body: JSON.stringify({ ordem: nova }) });
      if (r.ok) setBoard(await r.json());
    },
    [board],
  );

  const abrirNovo = useCallback((coluna: KanbanColunaId) => {
    setDraft(novoDraft(coluna));
    setCriando(true);
    setTagsInput("");
    setNovoItemChecklist("");
  }, []);

  const abrirEditar = useCallback((card: KanbanCard) => {
    setDraft(JSON.parse(JSON.stringify(card)));
    setCriando(false);
    setTagsInput(card.tags.join(", "));
    setNovoItemChecklist("");
  }, []);

  const fechar = useCallback(() => {
    if (salvando) return;
    setDraft(null);
  }, [salvando]);

  const salvar = useCallback(async () => {
    if (!draft || !draft.titulo.trim()) return;
    setSalvando(true);
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const corpo = {
      titulo: draft.titulo.trim(),
      tipo: draft.tipo,
      descricao: draft.descricao,
      prioridade: draft.prioridade,
      projeto: draft.projeto,
      responsavel: draft.responsavel,
      tags,
      origem: draft.origem,
      ingestao: draft.ingestao,
      links: draft.links,
      vinculos: draft.vinculos,
      checklist: draft.checklist,
      execucao: draft.execucao,
      ...(criando ? { coluna: draft.coluna } : { historico: draft.historico }),
    };
    try {
      const r = criando
        ? await fetch("/api/kanban", { method: "POST", body: JSON.stringify(corpo) })
        : await fetch(`/api/kanban/${draft.id}`, { method: "PATCH", body: JSON.stringify(corpo) });
      if (r.ok) {
        await refrescar();
        setDraft(null);
      } else {
        // a allowlist do PATCH recusa forma inválida com 400 e a mensagem
        // diz qual campo — sem este ramo, "Salvar" seria um no-op MUDO (ex.: % de
        // agente fora de 0-100, que o input não impede colar)
        const body = await r.json().catch(() => null);
        avisar(body?.erro ?? `não deu pra salvar (HTTP ${r.status})`);
      }
    } finally {
      setSalvando(false);
    }
  }, [draft, criando, tagsInput, refrescar, avisar]);

  const excluir = useCallback(async () => {
    if (!draft || criando) return;
    if (!confirm(`Excluir o ticket ${draft.id}? Essa ação não pode ser desfeita.`)) return;
    setSalvando(true);
    try {
      const r = await fetch(`/api/kanban/${draft.id}`, { method: "DELETE" });
      if (r.ok) {
        await refrescar();
        setDraft(null);
      }
    } finally {
      setSalvando(false);
    }
  }, [draft, criando, refrescar]);

  const [gravando, setGravando] = useState(false);
  const [enviandoAudio, setEnviandoAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCardIdRef = useRef<string | null>(null);

  const iniciarGravacao = useCallback(async () => {
    if (!draft || criando) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      audioCardIdRef.current = draft.id;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const cardId = audioCardIdRef.current;
        if (!cardId) return;
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        setEnviandoAudio(true);
        try {
          const fd = new FormData();
          fd.append("audio", blob, "nota");
          const r = await fetch(`/api/kanban/${cardId}/audio`, { method: "POST", body: fd });
          if (r.ok) {
            const atualizado = await r.json();
            setDraft((d) => (d && d.id === cardId ? { ...d, audios: atualizado.audios } : d));
            await refrescar();
          } else {
            avisar("não deu pra salvar o áudio");
          }
        } finally {
          setEnviandoAudio(false);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setGravando(true);
    } catch {
      avisar("não consegui acessar o microfone");
    }
  }, [draft, criando, refrescar, avisar]);

  const pararGravacao = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setGravando(false);
  }, []);

  const excluirAudio = useCallback(
    async (arquivo: string) => {
      if (!draft) return;
      const r = await fetch(`/api/kanban/${draft.id}/audio/${encodeURIComponent(arquivo)}`, { method: "DELETE" });
      if (r.ok) {
        const atualizado = await r.json();
        setDraft((d) => (d ? { ...d, audios: atualizado.audios } : d));
        await refrescar();
      }
    },
    [draft, refrescar],
  );

  const [enviandoImagem, setEnviandoImagem] = useState(false);

  const enviarImagem = useCallback(
    async (blob: Blob) => {
      if (!draft || criando) return;
      const cardId = draft.id;
      setEnviandoImagem(true);
      try {
        const fd = new FormData();
        fd.append("imagem", blob, "print");
        const r = await fetch(`/api/kanban/${cardId}/imagem`, { method: "POST", body: fd });
        if (r.ok) {
          const atualizado = await r.json();
          setDraft((d) => (d && d.id === cardId ? { ...d, imagens: atualizado.imagens } : d));
          await refrescar();
        } else {
          avisar("não deu pra salvar a imagem (formato suportado: png/jpg/webp/gif)");
        }
      } finally {
        setEnviandoImagem(false);
      }
    },
    [draft, criando, refrescar, avisar],
  );

  const onEscolherImagens = useCallback(
    async (arquivos: FileList | null) => {
      if (!arquivos) return;
      for (const arquivo of Array.from(arquivos)) await enviarImagem(arquivo);
    },
    [enviarImagem],
  );

  const onColarImagem = useCallback(
    async (e: React.ClipboardEvent) => {
      const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const blob = item.getAsFile();
      if (blob) await enviarImagem(blob);
    },
    [enviarImagem],
  );

  const excluirImagem = useCallback(
    async (arquivo: string) => {
      if (!draft) return;
      const r = await fetch(`/api/kanban/${draft.id}/imagem/${encodeURIComponent(arquivo)}`, { method: "DELETE" });
      if (r.ok) {
        const atualizado = await r.json();
        setDraft((d) => (d ? { ...d, imagens: atualizado.imagens } : d));
        await refrescar();
      }
    },
    [draft, refrescar],
  );

  const [buscaVinculo, setBuscaVinculo] = useState("");
  const [resultadosVinculo, setResultadosVinculo] = useState<SearchHit[]>([]);
  const [buscandoVinculo, setBuscandoVinculo] = useState(false);
  const [selecaoVinculo, setSelecaoVinculo] = useState<Set<string>>(new Set());

  const buscarVinculos = useCallback(async () => {
    if (!buscaVinculo.trim()) return;
    setBuscandoVinculo(true);
    try {
      const r = await fetch("/api/search", { method: "POST", body: JSON.stringify({ query: buscaVinculo }) });
      const j = await r.json();
      if (j.ok) {
        setResultadosVinculo(j.hits);
        setSelecaoVinculo(new Set());
      } else {
        avisar(j.erro === "ollama-offline" ? "busca semântica offline (Ollama)" : "busca falhou");
      }
    } finally {
      setBuscandoVinculo(false);
    }
  }, [buscaVinculo, avisar]);

  const vincularSelecionados = useCallback(() => {
    if (!draft) return;
    const novos: KanbanVinculo[] = resultadosVinculo
      .filter((h) => selecaoVinculo.has(h.chunkId))
      .map((h) => ({ tipo: h.tipo, id: h.livroId ?? `${h.fonteNome}:${h.chunkId}`, titulo: h.livroTitulo, linkLocal: h.linkLocal }));
    const semDuplicata = novos.filter((n) => !draft.vinculos.some((v) => v.id === n.id));
    setDraft({ ...draft, vinculos: [...draft.vinculos, ...semDuplicata] });
    setSelecaoVinculo(new Set());
  }, [draft, resultadosVinculo, selecaoVinculo]);

  const removerVinculo = useCallback(
    (id: string) => {
      if (!draft) return;
      setDraft({ ...draft, vinculos: draft.vinculos.filter((v) => v.id !== id) });
    },
    [draft],
  );

  const colIndex = useCallback((colunaId: string) => board.colunas.findIndex((c) => c.id === colunaId), [board.colunas]);

  /** Regra do board: status não volta — só avança ou fica parado (reordenar
   *  dentro da mesma coluna é sempre permitido). */
  const podeMover = useCallback(
    (cardId: string, colunaDestino: string) => {
      const card = board.cards.find((c) => c.id === cardId);
      if (!card) return true;
      if (card.coluna === colunaDestino) return true;
      return colIndex(colunaDestino) >= colIndex(card.coluna);
    },
    [board.cards, colIndex],
  );

  const mover = useCallback(
    async (cardId: string, coluna: KanbanColunaId, antesDe: string | null) => {
      if (!podeMover(cardId, coluna)) {
        avisar("status não volta — só avança ou fica parado");
        return;
      }
      const outros = board.cards
        .filter((c) => c.coluna === coluna && c.id !== cardId)
        .sort((a, b) => a.ordem - b.ordem);
      const idx = antesDe ? outros.findIndex((c) => c.id === antesDe) : -1;
      const index = idx === -1 ? outros.length : idx;
      const r = await fetch(`/api/kanban/${cardId}`, { method: "PATCH", body: JSON.stringify({ coluna, index }) });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        // Gate de DoD: o aviso precisa dizer o que falta, senão o card parece
        // travado sem motivo e a saída (marcar os itens) fica invisível.
        const faltando: string[] = Array.isArray(body?.faltando) ? body.faltando : [];
        avisar(
          faltando.length > 0
            ? `${body.erro} — falta: ${faltando.join(" · ")}`
            : (body?.erro ?? "não deu pra mover o ticket"),
        );
      }
      await refrescar();
    },
    [board, refrescar, podeMover, avisar],
  );

  const onDropCard = useCallback(
    (coluna: KanbanColunaId, alvoId: string) => {
      const origemId = arrastando.current;
      arrastando.current = null;
      setDragOverId(null);
      if (!origemId || origemId === alvoId) return;
      void mover(origemId, coluna, alvoId);
    },
    [mover],
  );

  const onDropColuna = useCallback(
    (coluna: KanbanColunaId) => {
      const origemId = arrastando.current;
      arrastando.current = null;
      setDragOverId(null);
      if (!origemId) return;
      void mover(origemId, coluna, null);
    },
    [mover],
  );

  const contagens = useMemo(() => {
    const tipo: Partial<Record<KanbanTipo, number>> = {};
    const prioridade: Partial<Record<KanbanPrioridade, number>> = {};
    const projeto: Partial<Record<KanbanProjeto, number>> = {};
    const canal: Partial<Record<KanbanCanalPedido, number>> = {};
    const responsavel: Record<string, number> = {};
    const tags: Record<string, number> = {};
    const execucao: Partial<Record<KanbanExecucaoFiltro, number>> = {};
    for (const c of board.cards) {
      tipo[c.tipo] = (tipo[c.tipo] ?? 0) + 1;
      prioridade[c.prioridade] = (prioridade[c.prioridade] ?? 0) + 1;
      projeto[c.projeto] = (projeto[c.projeto] ?? 0) + 1;
      if (c.origem.canal) canal[c.origem.canal] = (canal[c.origem.canal] ?? 0) + 1;
      if (c.responsavel) responsavel[c.responsavel] = (responsavel[c.responsavel] ?? 0) + 1;
      for (const t of c.tags) tags[t] = (tags[t] ?? 0) + 1;
      const modoExec = c.execucao?.modo ?? "sem-definicao";
      execucao[modoExec] = (execucao[modoExec] ?? 0) + 1;
    }
    return { tipo, prioridade, projeto, canal, responsavel, tags, execucao };
  }, [board.cards]);

  const responsaveis = useMemo(
    () => Object.keys(contagens.responsavel).sort((a, b) => contagens.responsavel[b] - contagens.responsavel[a]),
    [contagens.responsavel],
  );
  const tagsDisponiveis = useMemo(
    () => Object.keys(contagens.tags).sort((a, b) => contagens.tags[b] - contagens.tags[a]),
    [contagens.tags],
  );

  const passaFiltro = useCallback(
    (c: KanbanCard) =>
      (filtroTipo.size === 0 || filtroTipo.has(c.tipo)) &&
      (filtroPrioridade.size === 0 || filtroPrioridade.has(c.prioridade)) &&
      (filtroProjeto.size === 0 || filtroProjeto.has(c.projeto)) &&
      (filtroResponsavel.size === 0 || (!!c.responsavel && filtroResponsavel.has(c.responsavel))) &&
      (filtroTags.size === 0 || c.tags.some((t) => filtroTags.has(t))) &&
      (filtroCanal.size === 0 || (!!c.origem.canal && filtroCanal.has(c.origem.canal))) &&
      (!filtroDataDe || c.criadoEm.slice(0, 10) >= filtroDataDe) &&
      (!filtroDataAte || c.criadoEm.slice(0, 10) <= filtroDataAte) &&
      (filtroExecucao.size === 0 || filtroExecucao.has(c.execucao?.modo ?? "sem-definicao")),
    [filtroTipo, filtroPrioridade, filtroProjeto, filtroResponsavel, filtroTags, filtroCanal, filtroDataDe, filtroDataAte, filtroExecucao],
  );

  const temFiltro =
    filtroTipo.size > 0 ||
    filtroPrioridade.size > 0 ||
    filtroProjeto.size > 0 ||
    filtroResponsavel.size > 0 ||
    filtroTags.size > 0 ||
    filtroCanal.size > 0 ||
    !!filtroDataDe ||
    !!filtroDataAte ||
    filtroExecucao.size > 0;

  // Tickets que passam no filtro ativo e ainda são acionáveis (fora done/cancel)
  // — a base do lote que vai pro botão "copiar N tickets pro terminal".
  const cardsFiltrados = useMemo(
    () => board.cards.filter((c) => c.coluna !== "done" && c.coluna !== "cancel" && passaFiltro(c)),
    [board.cards, passaFiltro],
  );

  // Tickets acionáveis que o filtro ATIVO está escondendo. Existe porque editar
  // um campo filtrado (ex.: execucao agente→misto) tira o card da tela sem
  // aviso — o que já fez parecer que tickets tinham sumido do board.
  const ocultosPeloFiltro = useMemo(
    () =>
      temFiltro
        ? board.cards.filter((c) => c.coluna !== "done" && c.coluna !== "cancel" && !passaFiltro(c)).length
        : 0,
    [board.cards, passaFiltro, temFiltro],
  );

  // Descrição legível do filtro ativo — prefixa o bloco de "copiar em lote",
  // seja o lote global (painel de filtros) ou o de uma coluna só.
  const criteriosAtivos = useMemo(() => {
    const criterios: string[] = [];
    if (filtroExecucao.size > 0) {
      criterios.push(`execução: ${Array.from(filtroExecucao).map((m) => EXECUCAO_INFO[m].rotulo).join(", ")}`);
    }
    if (filtroTipo.size > 0) criterios.push(`tipo: ${Array.from(filtroTipo).map((t) => TIPO_INFO[t].rotulo).join(", ")}`);
    if (filtroPrioridade.size > 0) {
      criterios.push(`prioridade: ${Array.from(filtroPrioridade).map((p) => PRIORIDADE_INFO[p].rotulo).join(", ")}`);
    }
    if (filtroProjeto.size > 0) criterios.push(`projeto: ${Array.from(filtroProjeto).map((p) => PROJETO_INFO[p]).join(", ")}`);
    return criterios;
  }, [filtroExecucao, filtroTipo, filtroPrioridade, filtroProjeto]);

  // Copia + avisa: escreve no clipboard, dá o feedback local (ícone Check no
  // botão clicado, via `aoTerminar`) e sobe um toast mais robusto que o ícone
  // — sobrevive a perda de foco da aba e mostra tamanho quando o bloco é
  // confirma QUANTO foi copiado).
  const copiarELocalizar = useCallback(
    (cardsParaCopiar: KanbanCard[], criterios: string[], aoTerminar: () => void) => {
      const texto = construirPromptLote(cardsParaCopiar, criterios);
      navigator.clipboard.writeText(texto);
      aoTerminar();
      const detalheTamanho =
        texto.length >= AVISO_TAMANHO_A_PARTIR_DE
          ? ` · ~${texto.length.toLocaleString("pt-BR")} caracteres (~${estimarTokens(texto).toLocaleString("pt-BR")} tokens)`
          : "";
      const n = cardsParaCopiar.length;
      mostrarToast(`${n} ticket${n > 1 ? "s" : ""} copiado${n > 1 ? "s" : ""} pro terminal${detalheTamanho}`);
    },
    [mostrarToast],
  );

  const copiarLote = useCallback(
    (anchorEl: HTMLElement) => {
      if (cardsFiltrados.length === 0) return;
      if (cardsFiltrados.length <= LOTE_SEM_MENU_ATE) {
        const ordenado = ordenarParaLote(cardsFiltrados, board.cards);
        copiarELocalizar(ordenado, criteriosAtivos, () => {
          setCopiadoLote(true);
          setTimeout(() => setCopiadoLote(false), 1500);
        });
        return;
      }
      setMenuAncoraEl(anchorEl);
      setMenuGlobalAberto((v) => !v);
    },
    [cardsFiltrados, board.cards, criteriosAtivos, copiarELocalizar],
  );

  const secoesMapa: Record<string, React.ReactNode> = {
    execucao: (
      <Secao titulo="execução" sub="quem roda o ticket" cor="#38bdf8" corRgb="56,189,248" defaultAberto>
        {(Object.keys(EXECUCAO_INFO) as KanbanExecucaoFiltro[]).map((modo) => {
          const { rotulo, Icon } = EXECUCAO_INFO[modo];
          return (
            <button
              key={modo}
              onClick={() => setFiltroExecucao((s) => toggle(s, modo))}
              className={linhaCls(filtroExecucao.has(modo))}
            >
              <Icon size={12} strokeWidth={2} />
              {rotulo}
              <span className="ml-auto opacity-50">{contagens.execucao[modo] ?? 0}</span>
            </button>
          );
        })}
      </Secao>
    ),
    tipo: (
      <Secao titulo="tipo" cor="#60a5fa" corRgb="96,165,250">
        {(Object.keys(TIPO_INFO) as KanbanTipo[]).map((t) => (
          <button key={t} onClick={() => setFiltroTipo((s) => toggle(s, t))} className={linhaCls(filtroTipo.has(t))}>
            {TIPO_INFO[t].rotulo}
            <span className="ml-auto opacity-50">{contagens.tipo[t] ?? 0}</span>
          </button>
        ))}
      </Secao>
    ),
    prioridade: (
      <Secao titulo="prioridade" cor="#fb923c" corRgb="251,146,60">
        {(Object.keys(PRIORIDADE_INFO) as KanbanPrioridade[]).map((p) => (
          <button
            key={p}
            onClick={() => setFiltroPrioridade((s) => toggle(s, p))}
            className={linhaCls(filtroPrioridade.has(p))}
          >
            {PRIORIDADE_INFO[p].rotulo}
            <span className="ml-auto opacity-50">{contagens.prioridade[p] ?? 0}</span>
          </button>
        ))}
      </Secao>
    ),
    projeto: (
      <Secao titulo="projeto" cor="#a855f7" corRgb="168,85,247">
        {(Object.keys(PROJETO_INFO) as KanbanProjeto[]).map((p) => (
          <button key={p} onClick={() => setFiltroProjeto((s) => toggle(s, p))} className={linhaCls(filtroProjeto.has(p))}>
            {PROJETO_INFO[p]}
            <span className="ml-auto opacity-50">{contagens.projeto[p] ?? 0}</span>
          </button>
        ))}
      </Secao>
    ),
    periodo: (
      <Secao titulo="período" sub="criado entre" cor="#22d3ee" corRgb="34,211,238">
        {/* bl-input é dimensionado pra formulário de página inteira — gigante
             dentro do painel de filtro compacto. Reescala local via style
             (ver COMPACT_SCALE_STYLE acima). */}
        <div className="flex flex-col gap-1 px-2" style={COMPACT_SCALE_STYLE}>
          <label className="text-[10px] text-[var(--bl-text-dim)]">
            de
            <input
              type="date"
              value={filtroDataDe}
              onChange={(e) => setFiltroDataDe(e.target.value)}
              className="bl-input mt-1 w-full"
            />
          </label>
          <label className="text-[10px] text-[var(--bl-text-dim)]">
            até
            <input
              type="date"
              value={filtroDataAte}
              onChange={(e) => setFiltroDataAte(e.target.value)}
              className="bl-input mt-1 w-full"
            />
          </label>
        </div>
      </Secao>
    ),
    responsavel: (
      <Secao titulo="responsável" cor="#f472b6" corRgb="244,114,182" defaultAberto={responsaveis.length > 0}>
        <ListaExpansivel
          itens={responsaveis}
          topN={6}
          render={(r) => (
            <button key={r} onClick={() => setFiltroResponsavel((s) => toggle(s, r))} className={linhaCls(filtroResponsavel.has(r))}>
              {r}
              <span className="ml-auto opacity-50">{contagens.responsavel[r] ?? 0}</span>
            </button>
          )}
        />
      </Secao>
    ),
    tags: (
      <Secao titulo="tags" cor="#6bc950" corRgb="107,201,80" defaultAberto={false}>
        <ListaExpansivel
          itens={tagsDisponiveis}
          topN={8}
          render={(t) => (
            <button key={t} onClick={() => setFiltroTags((s) => toggle(s, t))} className={linhaCls(filtroTags.has(t))}>
              {t}
              <span className="ml-auto opacity-50">{contagens.tags[t] ?? 0}</span>
            </button>
          )}
        />
      </Secao>
    ),
    canal: (
      <Secao titulo="canal de origem" sub="de onde veio o pedido" cor="#d4a853" corRgb="212,168,83" defaultAberto={false}>
        {(Object.keys(CANAL_INFO) as KanbanCanalPedido[]).map((c) => (
          <button key={c} onClick={() => setFiltroCanal((s) => toggle(s, c))} className={linhaCls(filtroCanal.has(c))}>
            {CANAL_INFO[c]}
            <span className="ml-auto opacity-50">{contagens.canal[c] ?? 0}</span>
          </button>
        ))}
      </Secao>
    ),
  };

  const painel = useMemo(
    () => (
      <>
        {secoesOrdem.map((key) => (
          <div
            key={key}
            draggable
            onDragStart={onDragStartSecao(key)}
            onDragOver={onDragOverSecao(key)}
            onDrop={onDropSecao(key)}
            onDragEnd={onDragEndSecao}
            title="arraste para reordenar"
            className={`bl-filtros-secao${dragOverSecao === key ? " bl-filtros-secao--drag-over" : ""}`}
          >
            {secoesMapa[key]}
          </div>
        ))}
        {temFiltro && (
          <button
            onClick={() => {
              setFiltroTipo(new Set());
              setFiltroPrioridade(new Set());
              setFiltroProjeto(new Set());
              setFiltroResponsavel(new Set());
              setFiltroTags(new Set());
              setFiltroCanal(new Set());
              setFiltroDataDe("");
              setFiltroDataAte("");
              setFiltroExecucao(new Set());
            }}
            className="mt-1 block px-2 text-[11px] text-[var(--bl-accent)] hover:brightness-125"
          >
            limpar filtros
          </button>
        )}
      </>
    ),
    [
      filtroTipo,
      filtroPrioridade,
      filtroProjeto,
      filtroResponsavel,
      filtroTags,
      filtroCanal,
      filtroDataDe,
      filtroDataAte,
      filtroExecucao,
      responsaveis,
      tagsDisponiveis,
      contagens,
      temFiltro,
      secoesOrdem,
      dragOverSecao,
    ],
  );
  usePagePanel(painel);

  return (
    <>
      {erro && (
        <div className="bl-kanban-alerta">
          <AlertTriangle size={14} strokeWidth={2} />
          <span>{erro}</span>
          <button onClick={() => setErro(null)} aria-label="fechar aviso">
            <X size={13} />
          </button>
        </div>
      )}
      <div className="mb-2 flex items-center gap-2 px-1 text-[11px] text-[var(--bl-text-dim)]">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
            mudouAgora ? "bg-[var(--bl-accent)]" : "bg-[var(--bl-text-dim)] opacity-40"
          }`}
          title={mudouAgora ? "board mudou agora" : "sincronizando a cada 4s"}
        />
        <span>
          <strong className="text-[var(--bl-text-secondary)]">{cardsFiltrados.length}</strong> pendente
          {cardsFiltrados.length === 1 ? "" : "s"}
          {temFiltro ? " no filtro" : ""}
        </span>
        {ocultosPeloFiltro > 0 && (
          <span title="tickets acionáveis que existem no board mas o filtro atual esconde">
            · {ocultosPeloFiltro} oculto{ocultosPeloFiltro === 1 ? "" : "s"} pelo filtro
          </span>
        )}
        {cardsFiltrados.length > 0 && (
          <div className="bl-lote-menu">
            <button
              type="button"
              onClick={(e) => copiarLote(e.currentTarget)}
              title="copia o prompt de cada ticket filtrado (fora done/cancel) num bloco só, pra colar no terminal e mandar rodar em lote"
              className="bl-lote-trigger"
            >
              {copiadoLote ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={2} />}
              copiar {cardsFiltrados.length} pro terminal
            </button>
            {menuGlobalAberto && menuAncoraEl && (
              <MenuQuantidade
                legenda="filtrados"
                total={cardsFiltrados.length}
                anchorEl={menuAncoraEl}
                onFechar={() => setMenuGlobalAberto(false)}
                onEscolher={(n) => {
                  const ordenado = ordenarParaLote(cardsFiltrados, board.cards).slice(0, n);
                  copiarELocalizar(ordenado, criteriosAtivos, () => {
                    setCopiadoLote(true);
                    setTimeout(() => setCopiadoLote(false), 1500);
                  });
                  setMenuGlobalAberto(false);
                }}
              />
            )}
          </div>
        )}
        {mudouAgora && <span className="text-[var(--bl-accent)]">· atualizado</span>}
        <button
          type="button"
          onClick={() => setOrdemCron((o) => (o === "desc" ? "asc" : "desc"))}
          className="ml-auto flex items-center gap-1 hover:text-[var(--bl-text-secondary)]"
          title={
            ordemCron === "desc"
              ? "mais novo primeiro — clique pra inverter"
              : "mais antigo primeiro — clique pra inverter"
          }
        >
          {ordemCron === "desc" ? (
            <ArrowDownWideNarrow size={12} strokeWidth={2} />
          ) : (
            <ArrowUpWideNarrow size={12} strokeWidth={2} />
          )}
          {ordemCron === "desc" ? "mais novo" : "mais antigo"}
        </button>
        {sincronizadoEm && (
          <span className="tabular-nums opacity-60">
            sync {new Date(sincronizadoEm).toLocaleTimeString("pt-BR")}
          </span>
        )}
      </div>
      <div className="bl-kanban-board">
        {board.colunas.map((col) => {
          const cards = board.cards
            .filter((c) => c.coluna === col.id && passaFiltro(c))
            .sort((a, b) =>
              ordemCron === "desc" ? b.criadoEm.localeCompare(a.criadoEm) : a.criadoEm.localeCompare(b.criadoEm),
            );
          const limite = board.wipLimites[col.id];
          const estourou = limite != null && cards.length > limite;
          const vazia = cards.length === 0;
          const IconeColuna = iconeDaColuna(col.id);
          const soltarNaColuna = (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (arrastandoColuna.current) void moverColuna(col.id);
            else onDropColuna(col.id);
          };
          return (
            <div
              key={col.id}
              className={`bl-kanban-col${dragOverColuna === col.id ? " bl-kanban-col--drag-over" : ""}`}
              onDragOver={(e) => {
                // arrasto de coluna sempre pode soltar; arrasto de card só se não voltar status
                if (arrastandoColuna.current || podeMover(arrastando.current ?? "", col.id)) e.preventDefault();
              }}
              onDrop={soltarNaColuna}
            >
              <div
                className="bl-kanban-col-header"
                draggable={editandoColuna !== col.id}
                onDragStart={() => {
                  arrastandoColuna.current = col.id;
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (arrastandoColuna.current) setDragOverColuna(col.id);
                }}
                onDrop={soltarNaColuna}
                onDragEnd={() => {
                  arrastandoColuna.current = null;
                  setDragOverColuna(null);
                }}
              >
                <GripHorizontal size={13} className="bl-kanban-col-grip" />
                <IconeColuna size={13} strokeWidth={2} className="bl-kanban-col-icon" aria-hidden="true" />
                {editandoColuna === col.id ? (
                  <input
                    autoFocus
                    value={edicaoColunaTexto}
                    onChange={(e) => setEdicaoColunaTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void salvarEdicaoColuna();
                      if (e.key === "Escape") setEditandoColuna(null);
                    }}
                    onBlur={salvarEdicaoColuna}
                    className="bl-kanban-col-title-input"
                  />
                ) : (
                  <span className="bl-kanban-col-title">{col.rotulo}</span>
                )}
                <span className={`bl-kanban-col-count${estourou ? " bl-kanban-col-count--over" : ""}`}>
                  {estourou && <AlertTriangle size={11} strokeWidth={2} />}
                  {cards.length}
                  {limite != null && <span className="opacity-50">/{limite}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => iniciarEdicaoColuna(col.id, col.rotulo)}
                  className="bl-kanban-col-btn"
                  title="renomear coluna"
                  aria-label="renomear coluna"
                >
                  <Pencil size={13} strokeWidth={2} />
                </button>
                <div className="bl-lote-menu">
                  <button
                    type="button"
                    onClick={(e) => {
                      if (vazia) return;
                      if (cards.length <= LOTE_SEM_MENU_ATE) {
                        const ordenado = ordenarParaLote(cards, board.cards);
                        const criterios = [`coluna: ${col.rotulo}`, ...criteriosAtivos];
                        copiarELocalizar(ordenado, criterios, () => {
                          setCopiadoColuna(col.id);
                          setTimeout(() => setCopiadoColuna((atual) => (atual === col.id ? null : atual)), 1500);
                        });
                        return;
                      }
                      setMenuAncoraEl(e.currentTarget);
                      setMenuColunaAberto((atual) => (atual === col.id ? null : col.id));
                    }}
                    className={`bl-kanban-col-btn${vazia ? " bl-kanban-col-btn--disabled" : ""}`}
                    title={
                      vazia
                        ? "sem tickets pra copiar"
                        : `copia os ${cards.length} tickets visíveis nesta coluna (respeitando o filtro ativo) pro terminal`
                    }
                    aria-label="copiar tickets desta coluna"
                  >
                    {copiadoColuna === col.id ? (
                      <Check size={13} strokeWidth={2} />
                    ) : (
                      <Copy size={13} strokeWidth={2} />
                    )}
                  </button>
                  {menuColunaAberto === col.id && menuAncoraEl && (
                    <MenuQuantidade
                      legenda={`de ${col.rotulo}`}
                      total={cards.length}
                      anchorEl={menuAncoraEl}
                      onFechar={() => setMenuColunaAberto(null)}
                      onEscolher={(n) => {
                        const ordenado = ordenarParaLote(cards, board.cards).slice(0, n);
                        const criterios = [`coluna: ${col.rotulo}`, ...criteriosAtivos];
                        copiarELocalizar(ordenado, criterios, () => {
                          setCopiadoColuna(col.id);
                          setTimeout(() => setCopiadoColuna((atual) => (atual === col.id ? null : atual)), 1500);
                        });
                        setMenuColunaAberto(null);
                      }}
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => vazia && excluirColuna(col.id, col.rotulo)}
                  className={`bl-kanban-col-btn${vazia ? "" : " bl-kanban-col-btn--disabled"}`}
                  title={vazia ? "excluir coluna" : "só dá pra excluir coluna vazia"}
                  aria-label="excluir coluna"
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => abrirNovo(col.id)}
                  className="bl-kanban-col-btn"
                  title="novo ticket nesta coluna"
                  aria-label="novo ticket"
                >
                  <Plus size={14} strokeWidth={2} />
                </button>
              </div>
              <div className="bl-kanban-col-body">
                {cards.length === 0 && <p className="bl-kanban-empty">sem tickets</p>}
                {cards.map((card) => {
                  const info = TIPO_INFO[card.tipo];
                  const feitos = card.checklist.filter((i) => i.feito).length;
                  return (
                    <div
                      key={card.id}
                      draggable
                      onDragStart={() => {
                        arrastando.current = card.id;
                      }}
                      onDragOver={(e) => {
                        e.stopPropagation();
                        if (!podeMover(arrastando.current ?? "", col.id)) return;
                        e.preventDefault();
                        setDragOverId(card.id);
                      }}
                      onDrop={(e) => {
                        e.stopPropagation();
                        if (!podeMover(arrastando.current ?? "", col.id)) return;
                        e.preventDefault();
                        onDropCard(col.id, card.id);
                      }}
                      onDragEnd={() => {
                        arrastando.current = null;
                        setDragOverId(null);
                      }}
                      onClick={() => abrirEditar(card)}
                      className={`bl-kanban-card${dragOverId === card.id ? " bl-kanban-card--drag-over" : ""}`}
                      style={{ "--bl-kanban-card-accent": info.cor } as React.CSSProperties}
                    >
                      <button
                        type="button"
                        className="bl-kanban-card-copy"
                        title="copiar pra colar no terminal e começar este ticket"
                        aria-label="copiar ticket"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(construirPromptTicket(card));
                          setCopiadoId(card.id);
                          setTimeout(() => setCopiadoId((atual) => (atual === card.id ? null : atual)), 1500);
                          mostrarToast(`ticket ${card.id} copiado pro terminal`);
                        }}
                      >
                        {copiadoId === card.id ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={2} />}
                      </button>
                      <div className="bl-kanban-card-top">
                        <GripVertical size={13} className="bl-kanban-card-grip" />
                        <span className="bl-kanban-card-id">{card.id}</span>
                        <span className={`bl-badge ${PRIORIDADE_INFO[card.prioridade].badge} bl-kanban-card-prio`}>
                          {PRIORIDADE_INFO[card.prioridade].rotulo}
                        </span>
                      </div>
                      <p className="bl-kanban-card-titulo">{card.titulo}</p>
                      <div className="bl-kanban-card-meta">
                        <span className={`bl-badge ${info.badge}`}>{info.rotulo}</span>
                        {card.tags.slice(0, 3).map((t) => (
                          <span key={t} className="bl-badge bl-badge-ghost">
                            {t}
                          </span>
                        ))}
                      </div>
                      <div className="bl-kanban-card-footer">
                        <div className="bl-kanban-card-footer-linha">
                          {card.responsavel && <span>{card.responsavel}</span>}
                          {card.execucao && (
                            <span className="inline-flex items-center gap-1" title={card.execucao.executor ?? undefined}>
                              {card.execucao.modo === "agente" && (
                                <>
                                  <Bot size={11} strokeWidth={2} /> 100%
                                </>
                              )}
                              {card.execucao.modo === "humano" && (
                                <>
                                  <User size={11} strokeWidth={2} /> 100%
                                </>
                              )}
                              {card.execucao.modo === "misto" && (
                                <>
                                  <Bot size={11} strokeWidth={2} /> {card.execucao.pctAgente ?? "?"}%
                                  <User size={11} strokeWidth={2} />{" "}
                                  {card.execucao.pctAgente != null ? 100 - card.execucao.pctAgente : "?"}%
                                </>
                              )}
                            </span>
                          )}
                          {card.checklist.length > 0 && (
                            <span className="ml-auto">
                              {feitos}/{card.checklist.length}
                            </span>
                          )}
                        </div>
                        <div
                          className="bl-kanban-card-footer-linha opacity-70"
                          title={`criado em ${new Date(card.criadoEm).toLocaleString("pt-BR")} · atualizado em ${new Date(card.atualizadoEm).toLocaleString("pt-BR")}`}
                        >
                          <span className="inline-flex items-center gap-0.5">
                            <CalendarPlus size={10} strokeWidth={2} />
                            {dataCurta(card.criadoEm)}
                          </span>
                          <span className="inline-flex items-center gap-0.5">
                            <CalendarClock size={10} strokeWidth={2} />
                            {dataCurta(card.atualizadoEm)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {novaColunaAberta ? (
          <div className="bl-kanban-col bl-kanban-col-nova">
            <input
              autoFocus
              value={novaColunaTexto}
              onChange={(e) => setNovaColunaTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void criarColuna();
                if (e.key === "Escape") {
                  setNovaColunaAberta(false);
                  setNovaColunaTexto("");
                }
              }}
              placeholder="nome da coluna"
              className="bl-input"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => {
                  setNovaColunaAberta(false);
                  setNovaColunaTexto("");
                }}
                className="bl-btn bl-btn-secondary bl-btn-sm"
              >
                cancelar
              </button>
              <button onClick={criarColuna} disabled={!novaColunaTexto.trim()} className="bl-btn bl-btn-primary bl-btn-sm">
                <Check size={14} /> criar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setNovaColunaAberta(true)} className="bl-kanban-col-add-ghost">
            <Plus size={18} strokeWidth={1.75} />
            <span>nova coluna</span>
          </button>
        )}
      </div>

      {draft && (
        <div
          className={`fixed inset-0 flex bg-black/60 ${
            posicao === "centro" ? "items-center justify-center p-4" : posicao === "esquerda" ? "items-stretch justify-start" : "items-stretch justify-end"
          }`}
          style={{ zIndex: "var(--bl-z-modal-backdrop)" as unknown as number }}
          onClick={fechar}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`bl-kanban-modal relative flex w-full flex-col overflow-y-auto border border-[var(--bl-border-hover)] bg-[var(--bl-bg-elevated)] p-4 shadow-[var(--bl-shadow-xl)] ${
              posicao === "centro"
                ? "max-h-[92vh] max-w-xl rounded-[var(--bl-radius-xl)]"
                : `h-full max-h-full max-w-md sm:max-w-lg ${posicao === "esquerda" ? "rounded-r-[var(--bl-radius-xl)]" : "rounded-l-[var(--bl-radius-xl)]"}`
            }`}
            style={MODAL_COMPACT_STYLE}
          >
            <div className="mb-2.5 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--bl-text-dim)]">
                  {criando ? "novo ticket" : draft.id}
                </p>
                <input
                  autoFocus
                  value={draft.titulo}
                  onChange={(e) => setDraft({ ...draft, titulo: e.target.value })}
                  placeholder="título do ticket"
                  className="bl-input mt-1 w-full text-[15px] font-semibold"
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => mudarPosicao("esquerda")}
                  className={`bl-kanban-col-btn${posicao === "esquerda" ? " bl-kanban-col-btn--ativo" : ""}`}
                  title="encaixar à esquerda"
                  aria-label="encaixar à esquerda"
                >
                  <PanelLeft size={13} strokeWidth={2} />
                </button>
                <button
                  onClick={() => mudarPosicao("centro")}
                  className={`bl-kanban-col-btn${posicao === "centro" ? " bl-kanban-col-btn--ativo" : ""}`}
                  title="centralizar"
                  aria-label="centralizar"
                >
                  <Square size={12} strokeWidth={2} />
                </button>
                <button
                  onClick={() => mudarPosicao("direita")}
                  className={`bl-kanban-col-btn${posicao === "direita" ? " bl-kanban-col-btn--ativo" : ""}`}
                  title="encaixar à direita"
                  aria-label="encaixar à direita"
                >
                  <PanelRight size={13} strokeWidth={2} />
                </button>
                <button onClick={fechar} className="bl-btn bl-btn-ghost bl-btn-sm" aria-label="fechar">
                  <X size={13} />
                </button>
              </div>
            </div>

            <div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-[10px] text-[var(--bl-text-dim)]">
                tipo
                <select
                  value={draft.tipo}
                  onChange={(e) => setDraft({ ...draft, tipo: e.target.value as KanbanTipo })}
                  className="bl-select mt-1"
                >
                  {(Object.keys(TIPO_INFO) as KanbanTipo[]).map((t) => (
                    <option key={t} value={t}>
                      {TIPO_INFO[t].rotulo}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-[var(--bl-text-dim)]">
                prioridade
                <select
                  value={draft.prioridade}
                  onChange={(e) => setDraft({ ...draft, prioridade: e.target.value as KanbanPrioridade })}
                  className="bl-select mt-1"
                >
                  {(Object.keys(PRIORIDADE_INFO) as KanbanPrioridade[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORIDADE_INFO[p].rotulo}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-[var(--bl-text-dim)]">
                projeto
                <select
                  value={draft.projeto}
                  onChange={(e) => setDraft({ ...draft, projeto: e.target.value as KanbanProjeto })}
                  className="bl-select mt-1"
                >
                  {(Object.keys(PROJETO_INFO) as KanbanProjeto[]).map((p) => (
                    <option key={p} value={p}>
                      {PROJETO_INFO[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-[var(--bl-text-dim)]">
                responsável
                <input
                  value={draft.responsavel ?? ""}
                  onChange={(e) => setDraft({ ...draft, responsavel: e.target.value || null })}
                  placeholder="Você / Claude / Codex…"
                  className="bl-input mt-1"
                />
              </label>
            </div>

            <div className="mb-2.5 grid grid-cols-3 gap-2 rounded-md border border-[var(--bl-border)] p-2">
              <label className="text-[10px] text-[var(--bl-text-dim)]">
                execução
                <select
                  value={draft.execucao?.modo ?? ""}
                  onChange={(e) => {
                    const modo = e.target.value as KanbanExecucao["modo"] | "";
                    setDraft({ ...draft, execucao: modo ? { modo, executor: draft.execucao?.executor } : null });
                  }}
                  className="bl-select mt-1"
                >
                  <option value="">— não marcado —</option>
                  <option value="agente">100% agente</option>
                  <option value="misto">agente + humano</option>
                  <option value="humano">100% humano</option>
                </select>
              </label>
              {draft.execucao?.modo === "misto" && (
                <label className="text-[10px] text-[var(--bl-text-dim)]">
                  % agente
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.execucao?.pctAgente ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        execucao: { ...draft.execucao!, pctAgente: e.target.value ? Number(e.target.value) : undefined },
                      })
                    }
                    placeholder="ex.: 70"
                    className="bl-input mt-1"
                  />
                </label>
              )}
              {draft.execucao && (
                <label className="text-[10px] text-[var(--bl-text-dim)]">
                  executor
                  <input
                    value={draft.execucao.executor ?? ""}
                    onChange={(e) => setDraft({ ...draft, execucao: { ...draft.execucao!, executor: e.target.value || undefined } })}
                    placeholder="Claude Sonnet 5 / Você…"
                    className="bl-input mt-1"
                  />
                </label>
              )}
            </div>

            <label className="mb-2.5 block text-[10px] text-[var(--bl-text-dim)]">
              descrição — tudo que for necessário pra executar o ticket vai aqui
              <textarea
                value={draft.descricao}
                onChange={(e) => setDraft({ ...draft, descricao: e.target.value })}
                rows={3}
                placeholder="contexto, passos, critério de pronto…"
                className="bl-textarea mt-1"
              />
            </label>

            <label className="mb-2.5 block text-[10px] text-[var(--bl-text-dim)]">
              tags (separadas por vírgula)
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="ex.: acervo, prioridade-alta"
                className="bl-input mt-1"
              />
            </label>

            <Secao titulo="origem do pedido" sub="de onde veio isso" cor="#d4a853" corRgb="212,168,83" compact>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-[var(--bl-text-dim)]">
                  canal
                  <select
                    value={draft.origem.canal ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        origem: { ...draft.origem, canal: (e.target.value || null) as KanbanCanalPedido | null },
                      })
                    }
                    className="bl-select mt-1"
                  >
                    <option value="">—</option>
                    <option value="terminal">terminal</option>
                    <option value="kanban">kanban</option>
                    <option value="doc">doc</option>
                    <option value="chat">chat</option>
                    <option value="outro">outro</option>
                  </select>
                </label>
                <label className="text-[10px] text-[var(--bl-text-dim)]">
                  solicitado por
                  <input
                    value={draft.origem.solicitadoPor ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, origem: { ...draft.origem, solicitadoPor: e.target.value || null } })
                    }
                    className="bl-input mt-1"
                  />
                </label>
              </div>
              <label className="mt-2 block text-[10px] text-[var(--bl-text-dim)]">
                pedido original (cole o texto literal)
                <textarea
                  value={draft.origem.pedidoOriginal ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, origem: { ...draft.origem, pedidoOriginal: e.target.value || null } })
                  }
                  rows={2}
                  className="bl-textarea mt-1"
                />
              </label>
            </Secao>

            <Secao titulo="ingestão" sub="quando tipo=ingest/clone" cor="#60a5fa" corRgb="96,165,250" defaultAberto={draft.tipo === "ingest" || draft.tipo === "clone"} compact>
              <div className="mb-2 text-[10px] text-[var(--bl-text-dim)]">
                fonte (marca quantas precisar)
                <div className="mt-1 flex flex-wrap gap-1">
                  {FONTE_TIPOS.map((ft) => {
                    const ativo = draft.ingestao.fonteTipo.includes(ft);
                    return (
                      <button
                        key={ft}
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            ingestao: {
                              ...draft.ingestao,
                              fonteTipo: ativo
                                ? draft.ingestao.fonteTipo.filter((x) => x !== ft)
                                : [...draft.ingestao.fonteTipo, ft],
                            },
                          })
                        }
                        className={`bl-badge ${ativo ? "bl-badge-accent" : "bl-badge-ghost"}`}
                      >
                        {FONTE_ROTULO[ft]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-[var(--bl-text-dim)]">
                  bucket
                  <select
                    value={draft.ingestao.bucket ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        ingestao: { ...draft.ingestao, bucket: (e.target.value || null) as KanbanCard["ingestao"]["bucket"] },
                      })
                    }
                    className="bl-select mt-1"
                  >
                    <option value="">—</option>
                    <option value="external">external</option>
                    <option value="personal">personal</option>
                    <option value="business">business</option>
                  </select>
                </label>
                <label className="col-span-2 text-[10px] text-[var(--bl-text-dim)]">
                  URL da fonte (uma ou mais)
                  <div className="mt-1">
                    <ListaCompacta
                      valores={draft.ingestao.fonteUrl}
                      onChange={(v) => setDraft({ ...draft, ingestao: { ...draft.ingestao, fonteUrl: v } })}
                      placeholder="URL + Enter"
                    />
                  </div>
                </label>
                <label className="col-span-2 text-[10px] text-[var(--bl-text-dim)]">
                  path local (um ou mais)
                  <div className="mt-1">
                    <ListaCompacta
                      valores={draft.ingestao.fontePath}
                      onChange={(v) => setDraft({ ...draft, ingestao: { ...draft.ingestao, fontePath: v } })}
                      placeholder="path + Enter"
                    />
                  </div>
                </label>
                <label className="col-span-2 text-[10px] text-[var(--bl-text-dim)]">
                  pessoa / autor
                  <input
                    value={draft.ingestao.pessoaAutor ?? ""}
                    onChange={(e) => setDraft({ ...draft, ingestao: { ...draft.ingestao, pessoaAutor: e.target.value || null } })}
                    className="bl-input mt-1"
                  />
                </label>
              </div>
            </Secao>

            <Secao titulo="links" sub="clickup, github, drive, redes, blog, imprensa…" cor="#a855f7" corRgb="168,85,247" defaultAberto={false} compact>
              <LinksEditor links={draft.links} onChange={(v) => setDraft({ ...draft, links: v })} />
            </Secao>

            <Secao
              titulo="vínculos"
              sub="linkar livro/canal/clickup/curso já no acervo"
              cor="#6bc950"
              corRgb="107,201,80"
              defaultAberto={draft.vinculos.length > 0}
              compact
            >
              {draft.vinculos.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {draft.vinculos.map((v) => (
                    <span key={v.id} className="bl-badge bl-badge-ghost max-w-[200px]" title={v.titulo}>
                      <span className="truncate">{v.titulo}</span>
                      <button
                        type="button"
                        onClick={() => removerVinculo(v.id)}
                        aria-label="remover vínculo"
                        className="shrink-0 opacity-70 hover:opacity-100"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-1">
                <input
                  value={buscaVinculo}
                  onChange={(e) => setBuscaVinculo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void buscarVinculos();
                    }
                  }}
                  placeholder="buscar no acervo…"
                  className="bl-input flex-1"
                />
                <button
                  type="button"
                  onClick={buscarVinculos}
                  disabled={buscandoVinculo}
                  className="bl-kanban-col-btn shrink-0"
                  title="buscar"
                  aria-label="buscar"
                >
                  <Search size={13} strokeWidth={2} />
                </button>
              </div>
              {resultadosVinculo.length > 0 && (
                <div className="mt-1.5 flex max-h-[140px] flex-col gap-1 overflow-y-auto">
                  {resultadosVinculo.slice(0, 8).map((h) => (
                    <label key={h.chunkId} className="flex items-center gap-1.5 text-[10px] text-[var(--bl-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={selecaoVinculo.has(h.chunkId)}
                        onChange={() =>
                          setSelecaoVinculo((s) => {
                            const n = new Set(s);
                            if (n.has(h.chunkId)) n.delete(h.chunkId);
                            else n.add(h.chunkId);
                            return n;
                          })
                        }
                      />
                      <span className="bl-badge bl-badge-ghost shrink-0">{h.tipo}</span>
                      <span className="truncate">{h.livroTitulo}</span>
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={vincularSelecionados}
                    disabled={selecaoVinculo.size === 0}
                    className="bl-btn bl-btn-secondary bl-btn-sm mt-1 self-start"
                  >
                    vincular{selecaoVinculo.size > 0 ? ` (${selecaoVinculo.size})` : ""}
                  </button>
                </div>
              )}
            </Secao>

            {!criando && (
              <Secao titulo="áudio" sub="grave uma nota de voz explicando" cor="#ef4444" corRgb="239,68,68" defaultAberto={draft.audios.length > 0} compact>
                {draft.audios.length > 0 && (
                  <div className="mb-1.5 flex flex-col gap-1.5">
                    {draft.audios.map((a) => (
                      <div key={a.arquivo} className="flex items-center gap-1.5">
                        <audio
                          controls
                          preload="none"
                          src={`/api/kanban/${draft.id}/audio/${encodeURIComponent(a.arquivo)}`}
                          className="h-7 flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => excluirAudio(a.arquivo)}
                          aria-label="remover áudio"
                          className="shrink-0 text-[var(--bl-text-muted)] hover:text-[var(--bl-red)]"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={gravando ? pararGravacao : iniciarGravacao}
                  disabled={enviandoAudio}
                  className={`bl-btn bl-btn-sm ${gravando ? "bl-btn-danger" : "bl-btn-secondary"}`}
                >
                  {gravando ? (
                    <>
                      <Square size={12} /> parar
                    </>
                  ) : enviandoAudio ? (
                    "salvando…"
                  ) : (
                    <>
                      <Mic size={12} /> gravar
                    </>
                  )}
                </button>
              </Secao>
            )}

            {!criando && escalarDisponivel && (
              <Secao
                titulo="escalar para execução"
                sub="vira tarefa no executor externo configurado — o ticket continua sendo a verdade aqui"
                cor="#5b8def"
                corRgb="91,141,239"
                compact
              >
                <button
                  type="button"
                  onClick={escalarHandler}
                  disabled={escalando || Boolean(escalado)}
                  className="bl-btn bl-btn-secondary bl-btn-sm"
                >
                  {escalado ? (
                    <>
                      <Check size={12} /> tarefa {escalado}
                    </>
                  ) : escalando ? (
                    "escalando…"
                  ) : (
                    <>
                      <ArrowRight size={12} /> escalar para o executor externo
                    </>
                  )}
                </button>
              </Secao>
            )}

            {!criando && draft.coluna === "done" && (
              <Secao
                titulo="aprendizado"
                sub="opt-in — vira markdown buscável, fora do board"
                cor="#d4a853"
                corRgb="212,168,83"
                defaultAberto={aprendizadoSalvo}
                compact
              >
                <textarea
                  value={aprendizadoTexto}
                  onChange={(e) => {
                    setAprendizadoTexto(e.target.value);
                    setAprendizadoSalvo(false);
                  }}
                  placeholder="o que esse ticket ensinou?"
                  rows={3}
                  className="w-full resize-y rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] p-2 text-xs outline-none ring-1 ring-[var(--bl-border)] placeholder:text-white/25 focus:ring-[var(--bl-border-accent)]"
                />
                <button
                  type="button"
                  onClick={salvarAprendizadoHandler}
                  disabled={!aprendizadoTexto.trim() || salvandoAprendizado || aprendizadoSalvo}
                  className="bl-btn bl-btn-secondary bl-btn-sm mt-1.5"
                >
                  {aprendizadoSalvo ? (
                    <>
                      <Check size={12} /> capturado
                    </>
                  ) : salvandoAprendizado ? (
                    "salvando…"
                  ) : (
                    <>
                      <Lightbulb size={12} /> capturar aprendizado
                    </>
                  )}
                </button>
              </Secao>
            )}

            {!criando && (
              <Secao
                titulo="imagens"
                sub="cole (⌘V) ou escolha um print/referência visual"
                cor="#3b82f6"
                corRgb="59,130,246"
                defaultAberto={draft.imagens.length > 0}
                compact
              >
                <div onPaste={onColarImagem} tabIndex={0} className="rounded-md outline-none">
                  {draft.imagens.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {draft.imagens.map((img) => (
                        <div key={img.arquivo} className="group relative">
                          <a href={`/api/kanban/${draft.id}/imagem/${encodeURIComponent(img.arquivo)}`} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/kanban/${draft.id}/imagem/${encodeURIComponent(img.arquivo)}`}
                              alt={img.legenda ?? "imagem anexada"}
                              className="h-16 w-16 rounded-md object-cover border border-[var(--bl-border)]"
                            />
                          </a>
                          <button
                            type="button"
                            onClick={() => excluirImagem(img.arquivo)}
                            aria-label="remover imagem"
                            className="absolute -right-1 -top-1 rounded-full bg-[var(--bl-bg-2)] p-0.5 text-[var(--bl-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--bl-red)]"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className={`bl-btn bl-btn-sm bl-btn-secondary inline-flex cursor-pointer ${enviandoImagem ? "opacity-60" : ""}`}>
                    <ImagePlus size={12} /> {enviandoImagem ? "salvando…" : "escolher / colar"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={enviandoImagem}
                      onChange={(e) => onEscolherImagens(e.target.files)}
                      className="hidden"
                    />
                  </label>
                </div>
              </Secao>
            )}

            <Secao titulo="checklist" cor="#6bc950" corRgb="107,201,80" defaultAberto={draft.checklist.length > 0} compact>
              {draft.checklist.map((item, i) => {
                // Todo item da DoD do tipo é obrigatório, não só o de merge: é
                // ele que o gate de "done" cobra na hora de mover.
                const obrigatorio = (DOD_POR_TIPO[draft.tipo] ?? []).includes(item.texto);
                return (
                  <div key={i} className="mb-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.feito}
                      onChange={() => {
                        const checklist = [...draft.checklist];
                        checklist[i] = { ...checklist[i], feito: !checklist[i].feito };
                        setDraft({ ...draft, checklist });
                      }}
                    />
                    <span className={`flex-1 text-[11px] ${item.feito ? "text-[var(--bl-text-muted)] line-through" : ""}`}>
                      {item.texto}
                    </span>
                    {obrigatorio ? (
                      <span
                        className="shrink-0 opacity-50"
                        title="definição de pronto do tipo — o card não vai pra done sem isso"
                      >
                        <Lock size={11} aria-label="obrigatório — não pode remover" />
                      </span>
                    ) : (
                      <button
                        onClick={() => setDraft({ ...draft, checklist: draft.checklist.filter((_, j) => j !== i) })}
                        className="text-[var(--bl-text-muted)] hover:text-[var(--bl-red)]"
                        aria-label="remover item"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="mt-1.5 flex gap-2">
                <input
                  value={novoItemChecklist}
                  onChange={(e) => setNovoItemChecklist(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && novoItemChecklist.trim()) {
                      setDraft({ ...draft, checklist: [...draft.checklist, { texto: novoItemChecklist.trim(), feito: false }] });
                      setNovoItemChecklist("");
                    }
                  }}
                  placeholder="novo item + Enter"
                  className="bl-input flex-1"
                />
              </div>
            </Secao>

            {!criando && draft.historico.length > 0 && (
              <div className="mt-2.5 border-t border-[var(--bl-border)] pt-2 text-[9px] text-[var(--bl-text-dim)]">
                <p className="mb-1 font-mono uppercase tracking-wider">
                  histórico <span className="normal-case opacity-70">— clique numa linha pra anexar evidência (log, commit, link…)</span>
                </p>
                {draft.historico.map((h, i) => {
                  const abertoAqui = historicoAberto === i;
                  return (
                    <div key={i} className="mb-1">
                      <button
                        type="button"
                        onClick={() => setHistoricoAberto(abertoAqui ? null : i)}
                        className="flex w-full items-center gap-1.5 text-left hover:text-[var(--bl-text-secondary)]"
                      >
                        <span className="flex-1">
                          {h.tipo === "checklist" ? (
                            <>checklist · {new Date(h.em).toLocaleString("pt-BR")}</>
                          ) : (
                            <>
                              {h.de ?? "criado"} → {h.para} · {new Date(h.em).toLocaleString("pt-BR")}
                            </>
                          )}
                        </span>
                        {(h.links?.length ?? 0) > 0 &&
                          h.links!.map((l, j) => {
                            const info = LINK_INFO[l.tipo];
                            // só o ícone aparece: role="img" + aria-label dão o tipo do link ao leitor de tela
                            return (
                              <info.Icon
                                key={j}
                                size={10}
                                style={{ color: info.cor }}
                                className="shrink-0"
                                role="img"
                                aria-label={info.rotulo}
                              />
                            );
                          })}
                      </button>
                      {h.nota && !abertoAqui && <p className="pl-1 opacity-80">{h.nota}</p>}
                      {abertoAqui && (
                        <div className="mt-1 rounded-md border border-[var(--bl-border)] p-1.5">
                          <textarea
                            value={h.nota ?? ""}
                            onChange={(e) => {
                              const historico = [...draft.historico];
                              historico[i] = { ...historico[i], nota: e.target.value };
                              setDraft({ ...draft, historico });
                            }}
                            placeholder="o que foi feito de verdade nessa transição…"
                            className="bl-textarea w-full"
                            rows={2}
                          />
                          <div className="mt-1">
                            <LinksEditor
                              links={h.links ?? []}
                              onChange={(v) => {
                                const historico = [...draft.historico];
                                historico[i] = { ...historico[i], links: v };
                                setDraft({ ...draft, historico });
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="mt-1">criado em {new Date(draft.criadoEm).toLocaleString("pt-BR")}</p>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-[var(--bl-border)] pt-2.5">
              {!criando ? (
                <button onClick={excluir} disabled={salvando} className="bl-btn bl-btn-danger bl-btn-sm">
                  <Trash2 size={12} /> excluir
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button onClick={fechar} disabled={salvando} className="bl-btn bl-btn-secondary bl-btn-sm">
                  cancelar
                </button>
                <button
                  onClick={salvar}
                  disabled={salvando || !draft.titulo.trim()}
                  className="bl-btn bl-btn-primary bl-btn-sm"
                >
                  {criando ? "criar ticket" : "salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
