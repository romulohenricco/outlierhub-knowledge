/**
 * Cores da ontologia em grafo. Nenhum nome é fixo: a cor de uma camada é a que o
 * arquivo declara (`cor`) ou uma da paleta, escolhida por hash estável do id; a do
 * selo de status vem de `status_cores` ou, igualmente, do hash. Sem imports de
 * servidor: usado tanto pelo montador do grafo (server) quanto pelos componentes.
 */

export const COR_RAIZ = "#e5e7eb";

const PALETA = ["#5b8cff", "#fb923c", "#35a894", "#a855f7", "#ec4899", "#d4a853", "#06b6d4", "#94a3b8", "#6bc950"];

/** "#RGB" ou "#RRGGBB"; qualquer outra coisa (inclusive CSS arbitrário) é descartada. */
export function corValida(v: unknown): string | undefined {
  return typeof v === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : undefined;
}

/** Cor estável de um texto: a mesma palavra sempre cai na mesma cor. */
export function corPorTexto(texto: string): string {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}

export function corDaCamada(id: string, cor?: string): string {
  return corValida(cor) ?? corPorTexto(id);
}

/** Cor do selo de status: a do mapa `status_cores` (só chave própria) ou a do hash. */
export function corDoStatus(status: string, mapa: Record<string, string> = {}): string {
  return (Object.hasOwn(mapa, status) ? corValida(mapa[status]) : undefined) ?? corPorTexto(status);
}
