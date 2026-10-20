/**
 * Layout determinístico de árvore, de cima para baixo, sem dependências.
 *
 * Passo 1 (medida): cada subárvore recebe largura e altura. Folha = w × h.
 * Nó normal: filhos lado a lado separados por gapX, com topo em
 * pai.y + pai.h + gapY; largura = máx(pai.w, soma dos filhos + gaps).
 * "Pente": nó com ao menos combMinChildren filhos, todos folhas. Os filhos
 * formam uma grade em colunas de até combMaxRows linhas (preenchida coluna
 * por coluna), recuada por combIndent, e o pai fica alinhado à esquerda.
 *
 * Passo 2 (posição): desce com a origem (x, y) de cada subárvore e centraliza
 * pai e conjunto de filhos dentro da largura medida. Raiz em (0, 0).
 */

export interface LayoutInput {
  id: string;
  w: number;
  h: number;
  children: LayoutInput[];
}

export interface LayoutOptions {
  gapX: number;
  gapY: number;
  combGapX: number;
  combGapY: number;
  combIndent: number;
  combMaxRows: number;
  combMinChildren: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  gapX: 56,
  gapY: 96,
  combGapX: 28,
  combGapY: 20,
  combIndent: 44,
  combMaxRows: 7,
  combMinChildren: 4,
};

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  combParents: Set<string>;
  width: number;
  height: number;
}

interface Medida {
  no: LayoutInput;
  w: number;
  h: number;
  comb: boolean;
  filhos: Medida[];
  // só para pente
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
}

export function layoutTree(
  root: LayoutInput,
  options: Partial<LayoutOptions> = {},
): LayoutResult {
  const o: LayoutOptions = { ...DEFAULT_LAYOUT, ...options };
  const maxRows = Math.max(1, Math.floor(o.combMaxRows));

  const mede = (no: LayoutInput): Medida => {
    const base = { no, cellW: 0, cellH: 0, cols: 0, rows: 0 };
    const n = no.children.length;
    if (n === 0) return { ...base, w: no.w, h: no.h, comb: false, filhos: [] };

    const comb = n >= o.combMinChildren && no.children.every((c) => c.children.length === 0);
    if (comb) {
      const cellW = Math.max(...no.children.map((c) => c.w));
      const cellH = Math.max(...no.children.map((c) => c.h));
      const rows = Math.min(n, maxRows);
      const cols = Math.ceil(n / maxRows);
      return {
        no,
        comb: true,
        filhos: [],
        cellW,
        cellH,
        cols,
        rows,
        w: Math.max(no.w, o.combIndent + cols * cellW + (cols - 1) * o.combGapX),
        h: no.h + o.gapY / 2 + rows * cellH + (rows - 1) * o.combGapY,
      };
    }

    const filhos = no.children.map(mede);
    const soma = filhos.reduce((s, f) => s + f.w, 0) + (n - 1) * o.gapX;
    return {
      ...base,
      comb: false,
      filhos,
      w: Math.max(no.w, soma),
      h: no.h + o.gapY + Math.max(...filhos.map((f) => f.h)),
    };
  };

  const positions = new Map<string, { x: number; y: number }>();
  const combParents = new Set<string>();

  const posiciona = (m: Medida, x: number, y: number): void => {
    const { no } = m;
    if (m.comb) {
      combParents.add(no.id);
      positions.set(no.id, { x, y });
      const y0 = y + no.h + o.gapY / 2;
      no.children.forEach((c, i) => {
        const col = Math.floor(i / maxRows);
        const row = i % maxRows;
        positions.set(c.id, {
          x: x + o.combIndent + col * (m.cellW + o.combGapX),
          y: y0 + row * (m.cellH + o.combGapY),
        });
      });
      return;
    }
    positions.set(no.id, { x: x + (m.w - no.w) / 2, y });
    if (m.filhos.length === 0) return;
    const soma = m.filhos.reduce((s, f) => s + f.w, 0) + (m.filhos.length - 1) * o.gapX;
    let cx = x + (m.w - soma) / 2;
    const cy = y + no.h + o.gapY;
    for (const f of m.filhos) {
      posiciona(f, cx, cy);
      cx += f.w + o.gapX;
    }
  };

  const medida = mede(root);
  posiciona(medida, 0, 0);
  return { positions, combParents, width: medida.w, height: medida.h };
}
