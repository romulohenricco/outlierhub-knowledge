/**
 * Tipos e filtros PUROS dos saves do Instagram em /mysocialmedia/instagram, sem `node:fs`,
 * pra servirem ao servidor (lib/instagram-saves.ts), ao componente de cliente e aos testes.
 */
import { passaStatus, semAcento, type FiltroStatus } from "./triagem";

export type TipoSave = "foto" | "carrossel" | "reel";

export const ROTULO_TIPO: Record<TipoSave, string> = {
  foto: "foto",
  carrossel: "carrossel",
  reel: "reel / vídeo",
};

export type SaveIG = {
  /** shortcode do post (a mesma chave de /referencias) */
  code: string;
  /** media pk numérico do Instagram, em texto — o ingestor precisa dele pra pedir a mídia fresca */
  pk: string;
  user: string;
  legenda: string;
  tipo: TipoSave;
  slides: number;
  /** quando o post foi publicado (ISO) */
  postadoEm: string | null;
  url: string;
  /** arquivo em thumbs/ (a URL de CDN do Instagram expira, então a capa é baixada na coleta); null se falhou */
  thumb: string | null;
  /** nomes das coleções do Instagram em que você guardou o post */
  colecoes: string[];
  categorias: string[];
  palavras: string[];
  categoriaFonte?: "legenda" | "conta" | "colecao" | null;
  /** quando entrou no inventário */
  coletadoEm: string;
};

export type CategoriaIG = { id: string; rotulo: string; n: number };

/** Saves que JÁ estão em /referencias (post cujo `code` é o shortcode). */
export type SaveEmReferencias = Record<string, { user: string; comPrompt: boolean }>;

export type FiltroIG = {
  q: string;
  categorias: string[];
  colecao: string | null;
  conta: string | null;
  tipo: TipoSave | null;
  palavra: string | null;
  status: FiltroStatus;
};

export const FILTRO_IG_VAZIO: FiltroIG = {
  q: "",
  categorias: [],
  colecao: null,
  conta: null,
  tipo: null,
  palavra: null,
  status: "ativos",
};

/** Shortcode do Instagram: letras, dígitos, `_` e `-`. Única forma aceita nas rotas. */
export function codeValido(s: unknown): s is string {
  return typeof s === "string" && /^[\w-]{5,20}$/.test(s);
}

/** Aplica o filtro. Categorias são OU entre si; os demais filtros são E. */
export function filtrarSaves(
  saves: SaveIG[],
  decisoes: Record<string, { status: "descartado" | "manter" | "referencia" } | undefined>,
  f: FiltroIG,
  emRef: SaveEmReferencias = {},
): SaveIG[] {
  const q = semAcento(f.q.trim());
  return saves.filter((s) => {
    if (!passaStatus(f.status, decisoes[s.code]?.status, Boolean(emRef[s.code]))) return false;
    if (f.categorias.length && !f.categorias.some((c) => s.categorias.includes(c))) return false;
    if (f.colecao && !s.colecoes.includes(f.colecao)) return false;
    if (f.conta && s.user !== f.conta) return false;
    if (f.tipo && s.tipo !== f.tipo) return false;
    if (f.palavra && !s.palavras.includes(f.palavra)) return false;
    if (q && !semAcento(`${s.legenda} ${s.user} ${s.palavras.join(" ")} ${s.colecoes.join(" ")}`).includes(q)) return false;
    return true;
  });
}
