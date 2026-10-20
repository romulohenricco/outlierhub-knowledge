/**
 * Rótulos, cores e ícones da taxonomia do kanban — compartilhados entre o board
 * (`Kanban.tsx`) e o backlog (`KanbanBacklog.tsx`). Vive fora dos dois de
 * propósito: duplicar esses mapas faria a taxonomia divergir na primeira vez que
 * um tipo/prioridade novo entrasse só num lado.
 */
import {
  Bot,
  CheckCircle2,
  Cloud,
  CircleDashed,
  File,
  FileText,
  Github,
  Instagram,
  Link2,
  Linkedin,
  ListChecks,
  Newspaper,
  Play,
  Rss,
  Twitter,
  User,
  Users,
  XCircle,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import type {
  KanbanCanalPedido,
  KanbanColunaId,
  KanbanFonteTipo,
  KanbanLinkTipo,
  KanbanPrioridade,
  KanbanProjeto,
  KanbanTipo,
} from "@/lib/types";
import { KANBAN_PROJETOS } from "@/lib/types";

export const FONTE_TIPOS: KanbanFonteTipo[] = ["livro", "canal", "clickup", "curso", "video", "pdf", "doc", "outro"];
export const FONTE_ROTULO: Record<KanbanFonteTipo, string> = {
  livro: "livro",
  canal: "canal",
  clickup: "clickup",
  curso: "curso",
  video: "vídeo",
  pdf: "pdf",
  doc: "doc",
  outro: "outro",
};

export const LINK_TIPOS: KanbanLinkTipo[] = [
  "clickup",
  "github",
  "drive",
  "youtube",
  "instagram",
  "x",
  "tiktok",
  "linkedin",
  "blog",
  "imprensa",
  "output",
  "doc",
  "outro",
];

export const LINK_INFO: Record<KanbanLinkTipo, { rotulo: string; Icon: LucideIcon; cor: string }> = {
  clickup: { rotulo: "ClickUp", Icon: ListChecks, cor: "#7b68ee" },
  github: { rotulo: "GitHub (commit)", Icon: Github, cor: "#f4f4e8" },
  drive: { rotulo: "cloud / drive", Icon: Cloud, cor: "#4285f4" },
  youtube: { rotulo: "YouTube", Icon: Youtube, cor: "#ff0000" },
  instagram: { rotulo: "Instagram", Icon: Instagram, cor: "#e1306c" },
  x: { rotulo: "X (Twitter)", Icon: Twitter, cor: "#e8e8e8" },
  tiktok: { rotulo: "TikTok", Icon: Link2, cor: "#25f4ee" },
  linkedin: { rotulo: "LinkedIn", Icon: Linkedin, cor: "#0a66c2" },
  blog: { rotulo: "blog", Icon: Rss, cor: "#fb923c" },
  imprensa: { rotulo: "assessoria de imprensa", Icon: Newspaper, cor: "#d4a853" },
  output: { rotulo: "arquivo de output", Icon: File, cor: "#a1a1aa" },
  doc: { rotulo: "doc relacionado", Icon: FileText, cor: "#a1a1aa" },
  outro: { rotulo: "outro", Icon: Link2, cor: "#a1a1aa" },
};

export const TIPO_INFO: Record<KanbanTipo, { rotulo: string; cor: string; rgb: string; badge: string }> = {
  ingest: { rotulo: "ingest", cor: "#60a5fa", rgb: "96,165,250", badge: "bl-badge-blue" },
  clone: { rotulo: "clone", cor: "#06b6d4", rgb: "6,182,212", badge: "bl-badge-cyan" },
  autolearning: { rotulo: "autolearning", cor: "#a855f7", rgb: "168,85,247", badge: "bl-badge-purple" },
  feature: { rotulo: "feature", cor: "#ec4899", rgb: "236,72,153", badge: "bl-badge-pink" },
  melhoria: { rotulo: "melhoria", cor: "#6bc950", rgb: "107,201,80", badge: "bl-badge-green" },
  bug: { rotulo: "bug", cor: "#ef4444", rgb: "239,68,68", badge: "bl-badge-red" },
  infra: { rotulo: "infra", cor: "#d4a853", rgb: "212,168,83", badge: "bl-badge-gold" },
  outro: { rotulo: "outro", cor: "#a1a1aa", rgb: "161,161,170", badge: "bl-badge-ghost" },
};

export const PRIORIDADE_INFO: Record<KanbanPrioridade, { rotulo: string; badge: string }> = {
  baixa: { rotulo: "baixa", badge: "bl-badge-ghost" },
  media: { rotulo: "média", badge: "bl-badge-blue" },
  alta: { rotulo: "alta", badge: "bl-badge-orange" },
  urgente: { rotulo: "urgente", badge: "bl-badge-red" },
};

/** Rótulo por projeto, derivado da lista configurável (KANBAN_PROJETOS). O
 *  Proxy devolve o próprio valor para um projeto que não está mais na lista
 *  (ex.: ticket antigo depois de a lista ser trocada) em vez de `undefined`. */
const PROJETO_ROTULOS: Record<KanbanProjeto, string> = Object.fromEntries(KANBAN_PROJETOS.map((p) => [p, p]));
export const PROJETO_INFO: Record<KanbanProjeto, string> = new Proxy(PROJETO_ROTULOS, {
  get: (alvo, chave) => (typeof chave === "string" ? (alvo[chave] ?? chave) : undefined),
});

export const CANAL_INFO: Record<KanbanCanalPedido, string> = {
  terminal: "terminal",
  kanban: "kanban",
  doc: "doc",
  chat: "chat",
  outro: "outro",
};

/** Filtro de execução — mesmos valores de `KanbanExecucao.modo` + um bucket
 *  "sem-definicao" pros cards que ainda não passaram por essa classificação. */
export type KanbanExecucaoFiltro = "agente" | "misto" | "humano" | "sem-definicao";

export const EXECUCAO_INFO: Record<KanbanExecucaoFiltro, { rotulo: string; Icon: LucideIcon }> = {
  humano: { rotulo: "humano", Icon: User },
  misto: { rotulo: "agente + humano", Icon: Users },
  agente: { rotulo: "agente", Icon: Bot },
  "sem-definicao": { rotulo: "sem definição", Icon: CircleDashed },
};

/** Ícone semântico por coluna padrão. Coluna é
 *  dinâmica (usuário cria/renomeia livre, ver `KanbanColunaId`), então isto é
 *  um mapa por id conhecido com fallback neutro pra coluna custom. */
const COLUNA_ICONE_PADRAO: Record<string, LucideIcon> = {
  todo: ListChecks,
  doing: Play,
  done: CheckCircle2,
  cancel: XCircle,
};

export function iconeDaColuna(id: KanbanColunaId): LucideIcon {
  return COLUNA_ICONE_PADRAO[id] ?? CircleDashed;
}
