/**
 * Deep-link `?focus=<conceito>` do grafo: os dados carregam com filtros padrão
 * (sem arestas disputadas, com tema escolhido, etc.), então um conceito que só
 * existe fora deles não é achado. Esta função devolve os filtros AMPLIADOS o
 * bastante pra incluí-lo, ou null quando já está tudo aberto (aí o nó
 * realmente não existe e a tela avisa em vez de falhar calada).
 */
export type FiltrosFoco = { status: string[]; tema: string; comLivros: boolean };

const TODOS_STATUS = ["confirmed", "claimed", "disputed"];

export function ampliarParaFoco(f: FiltrosFoco): FiltrosFoco | null {
  const faltaStatus = TODOS_STATUS.some((s) => !f.status.includes(s));
  if (!faltaStatus && !f.tema && f.comLivros) return null;
  return { status: faltaStatus ? TODOS_STATUS : f.status, tema: "", comLivros: true };
}
