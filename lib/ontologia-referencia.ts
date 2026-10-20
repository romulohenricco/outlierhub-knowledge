/**
 * Modelo de referência da ontologia — dados dos cards (um por camada do arquivo).
 * Função PURA: recebe os nós do grafo e devolve o que o card precisa exibir.
 * Nunca lança exceção.
 */

/** Subconjunto mínimo de `OntNo` que esta montagem usa. */
export type NoRef = {
  id: string;
  parent: string | null;
  kind: string;
  label: string;
  resumo: string;
  cor: string;
  codigo: string;
};

export type ItemReferencia = { id: string; label: string; descendentes: number };

export type CardReferencia = {
  id: string;
  codigo: string;
  cor: string;
  titulo: string;
  resumo: string;
  /** Itens dentro da camada (todos os níveis). */
  total: number;
  itens: ItemReferencia[];
  /** Itens que passaram do corte e viram "+N no grafo". */
  resto: number;
};

export const MAX_ITENS_REFERENCIA = 8;

export function montarCardsReferencia(nodes: NoRef[], max = MAX_ITENS_REFERENCIA): CardReferencia[] {
  const filhos = new Map<string, NoRef[]>();
  for (const n of nodes) if (n.parent) filhos.set(n.parent, [...(filhos.get(n.parent) ?? []), n]);

  // Total de descendentes (memoizado; `visitando` protege contra ciclo em dado ruim).
  const memo = new Map<string, number>();
  const visitando = new Set<string>();
  const descendentes = (id: string): number => {
    const feito = memo.get(id);
    if (feito !== undefined) return feito;
    if (visitando.has(id)) return 0;
    visitando.add(id);
    let t = 0;
    for (const f of filhos.get(id) ?? []) t += 1 + descendentes(f.id);
    visitando.delete(id);
    memo.set(id, t);
    return t;
  };

  const cards: CardReferencia[] = [];
  for (const no of nodes) {
    if (no.kind !== "camada") continue;
    let base = filhos.get(no.id) ?? [];
    // Filho único com filhos próprios: abre um nível pra lista ter conteúdo útil.
    if (base.length === 1 && (filhos.get(base[0].id)?.length ?? 0) > 0) {
      base = filhos.get(base[0].id) ?? [];
    }
    const itens = base.slice(0, max).map((n) => ({
      id: n.id,
      label: n.label,
      descendentes: descendentes(n.id),
    }));
    cards.push({
      id: no.id,
      codigo: no.codigo,
      cor: no.cor,
      titulo: no.label,
      resumo: no.resumo,
      total: descendentes(no.id),
      itens,
      resto: Math.max(0, base.length - itens.length),
    });
  }
  return cards;
}
