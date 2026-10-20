/**
 * Teto de tamanho para arquivo que o app lê por conta do que o usuário colocou em disco.
 * Sem teto, um JSON/YAML gigante (ou uma "bomba" de aliases YAML) trava o servidor.
 * 8 MB sobra para qualquer inventário real; mais que isso é dado, não configuração.
 */
import { readFile, stat } from "node:fs/promises";

export const TETO_ARQUIVO_BYTES = 8 * 1024 * 1024;

/** true se o arquivo existe e cabe no teto. Ausente/ilegível = false. */
export async function tamanhoDentroDoTeto(abs: string, teto = TETO_ARQUIVO_BYTES): Promise<boolean> {
  try {
    const s = await stat(abs);
    return s.isFile() && s.size <= teto;
  } catch {
    return false;
  }
}

/** Lê texto UTF-8; acima do teto lança ANTES de ler o conteúdo. */
export async function lerTextoComTeto(abs: string, teto = TETO_ARQUIVO_BYTES): Promise<string> {
  const s = await stat(abs);
  if (s.size > teto) throw new Error(`arquivo acima do teto de ${teto} bytes`);
  return readFile(abs, "utf-8");
}
