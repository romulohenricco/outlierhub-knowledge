/**
 * Raiz dos dados de /mysocialmedia (servidor). Tudo o que as telas leem e a
 * triagem grava fica sob ela:
 *
 *   <raiz>/instagram-contas/    contas seguidas por nicho (+ dossiês e miniaturas)
 *   <raiz>/instagram-saves/     posts salvos, categorias, capas e decisões
 *   <raiz>/youtube-playlists/   playlists, vídeos, categorias e decisões
 *
 * Padrão: data/social (a pasta não existe no template; as telas mostram o estado
 * vazio). BILHON_SOCIAL_DIR troca a raiz. Formatos: docs/redes-sociais.md.
 *
 * Funções (e não constantes) para a env valer no momento do uso. Toda leitura e
 * gravação passa por `caminhoDentroDaRaiz`: symlink/junção que aponte para fora
 * da raiz é recusado, inclusive para arquivo que ainda não existe.
 */
import path from "node:path";
import { lerTextoComTeto } from "./arquivo-teto";
import { caminhoDentroDaRaiz, lerEnv } from "./bilhon-paths";

export function socialRoot(): string {
  return path.resolve(lerEnv("BILHON_SOCIAL_DIR") ?? path.join(process.cwd(), "data", "social"));
}

export type PastaSocial = "instagram-contas" | "instagram-saves" | "youtube-playlists";

export function pastaSocial(nome: PastaSocial): string {
  return path.join(socialRoot(), nome);
}

export function caminhoSocialPermitido(candidate: string): boolean {
  return caminhoDentroDaRaiz(socialRoot(), candidate);
}

export function exigirCaminhoSocial(candidate: string): string {
  if (!caminhoSocialPermitido(candidate)) throw new Error("Caminho fora da raiz permitida (BILHON_SOCIAL_DIR).");
  return path.resolve(candidate);
}

/** Lê um JSON de dentro da raiz; ausente, inválido ou fora da raiz devolve `fallback` (tela vazia, sem erro). */
export async function lerJsonSocial<T>(abs: string, fallback: T): Promise<T> {
  if (!caminhoSocialPermitido(abs)) return fallback;
  try {
    return JSON.parse(await lerTextoComTeto(abs)) as T;
  } catch {
    return fallback;
  }
}

/**
 * As miniaturas do YouTube vêm do servidor de imagens do YouTube (o navegador as
 * pede quando a aba abre). Por padrão ficam desligadas: nada sai da sua máquina.
 * BILHON_SOCIAL_YT_MINIATURAS=1 liga.
 */
export function miniaturasYoutubeAtivas(): boolean {
  return ["1", "true", "sim"].includes((lerEnv("BILHON_SOCIAL_YT_MINIATURAS") ?? "").toLowerCase());
}
