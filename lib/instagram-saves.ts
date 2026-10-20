/**
 * Minhas redes · Instagram · SAVES — os posts que você salvou e que AINDA NÃO estão em
 * /referencias, categorizados por tema e palavras-chave, com triagem manual: descartar o que
 * não vale, manter, ou pôr na fila de /referencias.
 *
 * Isto NÃO é /referencias. Lá só entra o que passou por ingestão com prompt reverso (leitura
 * de imagem por um agente seu — o app não chama LLM); aqui fica o inventário pra decidir o que
 * merece. O app só marca o pedido ("referencia"); quem faz a ingestão é você ou um script seu.
 *
 * Fonte (produzida por você, em <BILHON_SOCIAL_DIR>/instagram-saves/; formato em docs/redes-sociais.md):
 *   saves.json · categorias.json · thumbs/<code>.jpg
 *   decisoes.json                  ← escrito AQUI (a triagem manual)
 * Re-coletar e re-categorizar NUNCA apaga decisoes.json.
 */
import path from "node:path";
import { getReferencias } from "./referencias";
import { caminhoSocialPermitido, pastaSocial } from "./social-dir";
import { codeValido, type CategoriaIG, type SaveEmReferencias, type SaveIG } from "./instagram-saves-filtro";
import type { DecisoesTriagem, StatusTriagem } from "./triagem";
import { criarTriagemStore } from "./triagem-store";

export * from "./instagram-saves-filtro";

export const savesDir = () => pastaSocial("instagram-saves");

export type InstagramSaves = {
  coletadoEm: string | null;
  saves: SaveIG[];
  categorias: CategoriaIG[];
  decisoes: DecisoesTriagem;
  emReferencias: SaveEmReferencias;
};

const store = criarTriagemStore({
  dir: savesDir,
  ids: async (ler) => lista<SaveIG>((await ler<{ saves?: SaveIG[] }>("saves.json", {})).saves).map((s) => s.code),
  idValido: codeValido,
});

/** Arquivo malformado (sem a lista esperada) vale como vazio — a tela nunca quebra por dado ruim. */
function lista<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export async function getInstagramSaves(): Promise<InstagramSaves> {
  const [sv, ct, decisoes, refs] = await Promise.all([
    store.lerJson<{ coletadoEm?: string; saves?: SaveIG[] }>("saves.json", {}),
    store.lerJson<{ categorias?: CategoriaIG[] }>("categorias.json", {}),
    store.lerJson<DecisoesTriagem>("decisoes.json", {}),
    getReferencias().catch(() => null),
  ]);
  const saves = lista<SaveIG>(sv.saves).filter((s) => s && codeValido(s.code)).map(normalizarSave);
  const doInventario = new Set(saves.map((s) => s.code));
  const emReferencias: SaveEmReferencias = {};
  for (const p of refs?.posts ?? []) {
    // só os saves do inventário importam — o acervo pode ter milhares de outros posts
    if ((p.plataforma ?? "instagram") === "instagram" && doInventario.has(p.code)) {
      emReferencias[p.code] = { user: p.user, comPrompt: Boolean(p.promptReverso) };
    }
  }
  return {
    coletadoEm: sv.coletadoEm ?? null,
    saves,
    categorias: lista<CategoriaIG>(ct.categorias),
    decisoes: decisoes && typeof decisoes === "object" && !Array.isArray(decisoes) ? decisoes : {},
    emReferencias,
  };
}

/** Campos de lista ausentes viram `[]`: o componente nunca recebe `undefined.map`. */
function normalizarSave(s: SaveIG): SaveIG {
  return {
    ...s,
    user: s.user ?? "",
    legenda: s.legenda ?? "",
    tipo: s.tipo === "carrossel" || s.tipo === "reel" ? s.tipo : "foto",
    slides: s.slides ?? 1,
    postadoEm: s.postadoEm ?? null,
    thumb: s.thumb ?? null,
    colecoes: lista<string>(s.colecoes),
    categorias: lista<string>(s.categorias),
    palavras: lista<string>(s.palavras),
  };
}

/** Grava a triagem (ver `criarTriagemStore`): `null` desfaz; code malformado ou fora do inventário é ignorado. */
export async function setDecisoesSaves(codes: unknown[], status: StatusTriagem | null) {
  return store.setDecisoes(codes, status);
}

/** Caminho absoluto da capa de um save, recusando qualquer escape (inclusive symlink para fora da raiz). */
export function capaPathFor(code: string): string | null {
  if (!codeValido(code)) return null;
  const abs = path.join(savesDir(), "thumbs", `${code}.jpg`);
  return caminhoSocialPermitido(abs) ? abs : null;
}
