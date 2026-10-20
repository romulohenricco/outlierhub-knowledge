/**
 * Tipos e filtros PUROS do /mysocialmedia/youtube — sem `node:fs`, pra poderem ser
 * importados tanto pelo servidor (lib/youtube-playlists.ts) quanto pelo componente
 * de cliente e pelos testes.
 */
import {
  contar,
  passaStatus,
  semAcento,
  type DecisaoTriagem,
  type DecisoesTriagem,
  type FiltroStatus,
  type StatusTriagem,
} from "./triagem";

export type PlaylistYT = {
  id: string;
  nome: string;
  url: string;
  visibilidade: "privada" | "nao-listada" | "publica";
  /** `propria` = criada na sua conta; `salva` = playlist de OUTRO canal que você guardou */
  origem: "propria" | "salva";
  criador: string | null;
  /** curtidos · assistir-depois · shorts-salvos · favoritos — listas que o YouTube cria sozinho */
  sistema: string | null;
  /** quantos vídeos o YouTube diz que a lista tem */
  esperados: number;
  /** quantos vieram na coleta (vídeo apagado/privado não aparece, então pode ser menor) */
  coletados: number;
};

export type VideoYT = {
  id: string;
  titulo: string;
  canal: string;
  duracaoS: number;
  views: string;
  /** texto relativo do YouTube no momento da coleta ("3y ago") */
  publicado: string;
  url: string;
  playlists: string[];
  categorias: string[];
  palavras: string[];
  categoriaFonte?: "titulo" | "canal" | "playlist" | null;
};

export type CategoriaYT = { id: string; rotulo: string; n: number };

/** referencia = quer como referência: entra na fila de ingestão (com prompt reverso) pra /referencias */
export type StatusVideo = StatusTriagem;
export type DecisaoVideo = DecisaoTriagem;
export type Decisoes = DecisoesTriagem;

export type { FiltroStatus };
export { contar };

/** Vídeos que JÁ estão em /referencias (post de YouTube cujo code é o videoId). */
export type EmReferencias = Record<string, { titulo: string; comPrompt: boolean }>;
export type FiltroDuracao = "short" | "curto" | "medio" | "longo";

export type FiltroYT = {
  q: string;
  categorias: string[];
  playlist: string | null;
  canal: string | null;
  palavra: string | null;
  status: FiltroStatus;
  duracao: FiltroDuracao | null;
};

export const FILTRO_VAZIO: FiltroYT = {
  q: "",
  categorias: [],
  playlist: null,
  canal: null,
  palavra: null,
  status: "ativos",
  duracao: null,
};

/** Id de vídeo do YouTube: 11 caracteres [A-Za-z0-9_-]. Única forma aceita nas rotas. */
export function idVideoValido(s: unknown): s is string {
  return typeof s === "string" && /^[\w-]{11}$/.test(s);
}

export function faixaDuracao(s: number): FiltroDuracao {
  if (s <= 60) return "short";
  if (s < 600) return "curto";
  if (s < 1800) return "medio";
  return "longo";
}

export const ROTULO_DURACAO: Record<FiltroDuracao, string> = {
  short: "até 1 min",
  curto: "1–10 min",
  medio: "10–30 min",
  longo: "mais de 30 min",
};

export function duracaoHumana(s: number): string {
  if (!s) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${dois(m)}:${dois(seg)}` : `${m}:${dois(seg)}`;
}

/** Aplica o filtro. Categorias são OU entre si (sinônimo de "qualquer uma destas"); os demais filtros são E. */
export function filtrarVideos(
  videos: VideoYT[],
  decisoes: Decisoes,
  f: FiltroYT,
  emRef: EmReferencias = {},
): VideoYT[] {
  const q = semAcento(f.q.trim());
  return videos.filter((v) => {
    if (!passaStatus(f.status, decisoes[v.id]?.status, Boolean(emRef[v.id]))) return false;
    if (f.categorias.length && !f.categorias.some((c) => v.categorias.includes(c))) return false;
    if (f.playlist && !v.playlists.includes(f.playlist)) return false;
    if (f.canal && v.canal !== f.canal) return false;
    if (f.palavra && !v.palavras.includes(f.palavra)) return false;
    if (f.duracao && faixaDuracao(v.duracaoS) !== f.duracao) return false;
    if (q && !semAcento(`${v.titulo} ${v.canal} ${v.palavras.join(" ")}`).includes(q)) return false;
    return true;
  });
}
