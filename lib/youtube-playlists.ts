/**
 * Minhas redes · YouTube — as suas playlists (inclusive as que o YouTube cria sozinho:
 * Curtidos, Assistir mais tarde, Favoritos), com cada vídeo categorizado por tema e
 * palavras-chave, e a decisão manual de descartar o que não vale a pena.
 *
 * Isto NÃO é /referencias. Lá só entra o que passou por ingestão com prompt reverso;
 * aqui é o inventário inteiro pra triagem. O app só marca o pedido ("referencia"); quem
 * faz a ingestão é você ou um script seu.
 *
 * Fonte (produzida por você, em <BILHON_SOCIAL_DIR>/youtube-playlists/; formato em docs/redes-sociais.md):
 *   playlists.json · videos.json · categorias.json
 *   decisoes.json                  ← escrito AQUI (a triagem manual)
 * Re-coletar e re-categorizar NUNCA apaga decisoes.json.
 */
import { getReferencias } from "./referencias";
import { pastaSocial } from "./social-dir";
import { criarTriagemStore } from "./triagem-store";
import {
  idVideoValido,
  type CategoriaYT,
  type Decisoes,
  type EmReferencias,
  type PlaylistYT,
  type StatusVideo,
  type VideoYT,
} from "./youtube-playlists-filtro";

export * from "./youtube-playlists-filtro";

export const youtubeDir = () => pastaSocial("youtube-playlists");

export type YoutubePlaylists = {
  coletadoEm: string | null;
  playlists: PlaylistYT[];
  videos: VideoYT[];
  categorias: CategoriaYT[];
  decisoes: Decisoes;
  emReferencias: EmReferencias;
};

/** Arquivo malformado (sem a lista esperada) vale como vazio — a tela nunca quebra por dado ruim. */
function lista<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

const store = criarTriagemStore({
  dir: youtubeDir,
  ids: async (ler) => lista<VideoYT>((await ler<{ videos?: VideoYT[] }>("videos.json", {})).videos).map((v) => v.id),
  idValido: idVideoValido,
});

export async function getYoutubePlaylists(): Promise<YoutubePlaylists> {
  const [pl, vd, ct, decisoes, refs] = await Promise.all([
    store.lerJson<{ coletadoEm?: string; playlists?: PlaylistYT[] }>("playlists.json", {}),
    store.lerJson<{ videos?: VideoYT[] }>("videos.json", {}),
    store.lerJson<{ categorias?: CategoriaYT[] }>("categorias.json", {}),
    store.lerJson<Decisoes>("decisoes.json", {}),
    getReferencias().catch(() => null),
  ]);
  const emReferencias: EmReferencias = {};
  for (const p of refs?.posts ?? []) {
    if (p.plataforma === "youtube") emReferencias[p.code] = { titulo: p.caption, comPrompt: Boolean(p.promptReverso) };
  }
  return {
    coletadoEm: pl.coletadoEm ?? null,
    playlists: lista<PlaylistYT>(pl.playlists),
    videos: lista<VideoYT>(vd.videos)
      .filter((v) => v && idVideoValido(v.id))
      .map((v) => ({
        ...v,
        titulo: v.titulo ?? "",
        canal: v.canal ?? "",
        duracaoS: v.duracaoS ?? 0,
        views: v.views ?? "",
        publicado: v.publicado ?? "",
        playlists: lista<string>(v.playlists),
        categorias: lista<string>(v.categorias),
        palavras: lista<string>(v.palavras),
      })),
    categorias: lista<CategoriaYT>(ct.categorias),
    decisoes: decisoes && typeof decisoes === "object" && !Array.isArray(decisoes) ? decisoes : {},
    emReferencias,
  };
}

/** Grava a triagem (ver `criarTriagemStore`): `null` desfaz; id malformado ou fora do inventário é ignorado. */
export async function setDecisoes(ids: unknown[], status: StatusVideo | null) {
  return store.setDecisoes(ids, status);
}
