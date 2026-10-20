import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Lê uma variável de ambiente tratando vazio como ausente: um .env copiado do
 * exemplo com `X=` em branco devolve "" e não pode vencer o valor padrão.
 */
export function lerEnv(nome: string): string | undefined {
  const valor = process.env[nome]?.trim();
  return valor ? valor : undefined;
}

/**
 * Raiz que contém tudo o que esta feature lê e grava (registro, estado local,
 * add-ons, topologia). Padrão: o diretório do app. Definir BILHON_ROOT substitui
 * essa raiz (não a soma ao diretório do app); a contenção continua valendo nela.
 */
export function bilhonRoot(): string {
  return path.resolve(lerEnv("BILHON_ROOT") ?? process.cwd());
}

function dentro(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * `candidate` fica dentro de `root`? Confere também o ancestral existente:
 * junction/symlink dentro da raiz não abre acesso ao que está fora dela, nem
 * para um destino que ainda não existe. Recusa caminho de rede (UNC).
 */
export function caminhoDentroDaRaiz(root: string, candidate: string): boolean {
  try {
    if (typeof candidate !== "string" || !candidate) return false;
    // UNC (\\servidor\pasta, //servidor/pasta): compartilhamento de rede não entra
    if (/^[\\/]{2}/.test(candidate)) return false;
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(candidate);
    if (!dentro(resolvedRoot, target)) return false;
    let ancestor = target;
    while (!existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return false;
      ancestor = parent;
    }
    const physicalRoot = realpathSync(resolvedRoot);
    return dentro(physicalRoot, realpathSync(ancestor));
  } catch {
    return false;
  }
}

export function caminhoBilhonPermitido(candidate: string): boolean {
  return caminhoDentroDaRaiz(bilhonRoot(), candidate);
}

export function exigirCaminhoBilhon(candidate: string): string {
  if (!caminhoBilhonPermitido(candidate)) throw new Error("Caminho fora da raiz permitida (BILHON_ROOT).");
  return path.resolve(candidate);
}
