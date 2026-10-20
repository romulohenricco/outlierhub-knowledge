/**
 * Triagem manual das redes de /mysocialmedia — tipos e regras PUROS (sem `node:fs`), pra
 * servirem ao servidor, aos componentes de cliente e aos testes. YouTube e Instagram usam
 * o mesmo modelo: cada item do inventário recebe, ou não, uma decisão sua.
 *
 *   descartado → "não vale a pena": some da lista, reversível, só local
 *   manter     → fica no inventário marcado
 *   referencia → pedido de ingestão em /referencias (com prompt reverso, feita por agente)
 */

export type StatusTriagem = "descartado" | "manter" | "referencia";
export type DecisaoTriagem = { status: StatusTriagem; em: string };
export type DecisoesTriagem = Record<string, DecisaoTriagem>;

export type FiltroStatus = "ativos" | "pendentes" | "ja" | "mantidos" | "fila" | "descartados" | "todos";

export const ROTULO_STATUS: Record<FiltroStatus, string> = {
  ativos: "não descartados",
  pendentes: "a triar",
  ja: "já em referências",
  mantidos: "mantidos",
  fila: "na fila de referências",
  descartados: "descartados",
  todos: "todos",
};

/** Corpo aceito pelas rotas de decisão: `null` desfaz. */
export function statusValido(s: unknown): s is StatusTriagem | null {
  return s === null || s === "descartado" || s === "manter" || s === "referencia";
}

export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Um item passa no filtro de status? `jaEmReferencias` = o item já existe em /referencias
 * (a ingestão aconteceu) — só então ele deixa de ser "fila".
 */
export function passaStatus(filtro: FiltroStatus, st: StatusTriagem | undefined, jaEmReferencias: boolean): boolean {
  if (filtro === "ativos") return st !== "descartado";
  if (filtro === "pendentes") return st === undefined && !jaEmReferencias; // nem decidido, nem ingerido
  if (filtro === "ja") return jaEmReferencias;
  if (filtro === "mantidos") return st === "manter" || st === "referencia";
  if (filtro === "fila") return st === "referencia" && !jaEmReferencias;
  if (filtro === "descartados") return st === "descartado";
  return true;
}

/** Contagem [chave, n] decrescente — usada pra categorias, contas e palavras-chave do painel. */
export function contar<T>(itens: T[], chaves: (i: T) => string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const i of itens) for (const k of chaves(i)) if (k) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Contadores do painel "triagem", dado o total do inventário e as decisões. */
export function contarStatus(
  total: number,
  decisoes: DecisoesTriagem,
  emReferencias: Record<string, unknown>,
): Record<FiltroStatus, number> {
  const vals = Object.entries(decisoes);
  const nDescartados = vals.filter(([, d]) => d.status === "descartado").length;
  const resolvidos = new Set([...Object.keys(decisoes), ...Object.keys(emReferencias)]);
  return {
    ativos: total - nDescartados,
    pendentes: Math.max(0, total - resolvidos.size),
    ja: Object.keys(emReferencias).length,
    mantidos: vals.filter(([, d]) => d.status === "manter" || d.status === "referencia").length,
    fila: vals.filter(([id, d]) => d.status === "referencia" && !emReferencias[id]).length,
    descartados: nDescartados,
    todos: total,
  };
}
