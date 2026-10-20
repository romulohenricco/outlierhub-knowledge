import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  layoutTree,
  type LayoutInput,
} from "./ontologia-layout";

const no = (id: string, w: number, h: number, children: LayoutInput[] = []): LayoutInput => ({
  id,
  w,
  h,
  children,
});

describe("layoutTree", () => {
  it("folha única ocupa w × h na origem", () => {
    const r = layoutTree(no("a", 100, 40));
    expect(r.positions.get("a")).toEqual({ x: 0, y: 0 });
    expect(r.width).toBe(100);
    expect(r.height).toBe(40);
    expect(r.combParents.size).toBe(0);
  });

  it("pai com 2 filhos: filhos lado a lado e pai centralizado", () => {
    const r = layoutTree(no("p", 100, 40, [no("a", 80, 30), no("b", 120, 30)]));
    expect(r.width).toBe(256);
    expect(r.height).toBe(166);
    expect(r.positions.get("p")).toEqual({ x: 78, y: 0 });
    expect(r.positions.get("a")).toEqual({ x: 0, y: 136 });
    expect(r.positions.get("b")).toEqual({ x: 136, y: 136 });
    expect(r.combParents.size).toBe(0);
  });

  it("pai com 3 filhos folha NÃO vira pente (abaixo de combMinChildren)", () => {
    const r = layoutTree(
      no("p", 40, 20, [no("a", 60, 20), no("b", 60, 20), no("c", 60, 20)]),
    );
    expect(r.combParents.has("p")).toBe(false);
    expect(r.width).toBe(292);
    expect(r.height).toBe(136);
    expect(r.positions.get("p")).toEqual({ x: 126, y: 0 });
    expect(r.positions.get("a")).toEqual({ x: 0, y: 116 });
    expect(r.positions.get("b")).toEqual({ x: 116, y: 116 });
    expect(r.positions.get("c")).toEqual({ x: 232, y: 116 });
  });

  it("pente com 9 filhos e combMaxRows=4: 3 colunas, pai à esquerda", () => {
    const kids = Array.from({ length: 9 }, (_, i) =>
      i === 2 ? no(`k${i}`, 80, 30) : no(`k${i}`, 60, 20),
    );
    const r = layoutTree(no("p", 100, 40, kids), { combMaxRows: 4 });
    expect(r.combParents.has("p")).toBe(true);
    expect(r.positions.get("p")).toEqual({ x: 0, y: 0 });
    // célula 80x30; colunas em 44, 152, 260; linhas em 88, 138, 188, 238
    const xs = [44, 152, 260];
    const ys = [88, 138, 188, 238];
    for (let i = 0; i < 9; i++) {
      expect(r.positions.get(`k${i}`)).toEqual({
        x: xs[Math.floor(i / 4)],
        y: ys[i % 4],
      });
    }
    expect(r.width).toBe(340);
    expect(r.height).toBe(268);
  });

  it("pente estreito: largura mínima é a do pai", () => {
    const kids = Array.from({ length: 4 }, (_, i) => no(`k${i}`, 10, 10));
    const r = layoutTree(no("p", 300, 40, kids));
    expect(r.width).toBe(300);
    // 1 coluna, 4 linhas: 40 + 48 + 4*10 + 3*20
    expect(r.height).toBe(188);
  });

  it("pai com filhos não-folha não vira pente", () => {
    const kids = [
      no("a", 60, 20, [no("a1", 30, 10)]),
      no("b", 60, 20),
      no("c", 60, 20),
      no("d", 60, 20),
    ];
    const r = layoutTree(no("p", 60, 20, kids));
    expect(r.combParents.has("p")).toBe(false);
    expect(r.positions.get("a")!.y).toBe(116);
    expect(r.positions.get("a1")!.y).toBe(116 + 20 + 96);
  });

  it("override parcial de options é mesclado sobre o padrão", () => {
    const r = layoutTree(no("p", 40, 20, [no("a", 60, 20), no("b", 60, 20)]), {
      gapX: 10,
      gapY: 30,
    });
    expect(r.width).toBe(130);
    expect(r.height).toBe(70);
    expect(r.positions.get("a")).toEqual({ x: 0, y: 50 });
    expect(r.positions.get("b")).toEqual({ x: 70, y: 50 });
    expect(DEFAULT_LAYOUT.gapX).toBe(56);
  });

  it("combMinChildren customizado faz 3 folhas virarem pente", () => {
    const r = layoutTree(
      no("p", 40, 20, [no("a", 60, 20), no("b", 60, 20), no("c", 60, 20)]),
      { combMinChildren: 3 },
    );
    expect(r.combParents.has("p")).toBe(true);
  });

  describe("invariantes", () => {
    const arvore = (): LayoutInput =>
      no("r", 120, 50, [
        no("g1", 90, 30, Array.from({ length: 10 }, (_, i) => no(`g1_${i}`, 70 + i, 24))),
        no("g2", 200, 30, [no("x", 300, 80), no("y", 20, 10, [no("y1", 50, 50)])]),
        no("g3", 60, 60),
      ]);

    it("sem posições negativas e tudo dentro de width × height", () => {
      const r = layoutTree(arvore());
      const todos = new Map<string, LayoutInput>();
      const coleta = (n: LayoutInput) => {
        todos.set(n.id, n);
        n.children.forEach(coleta);
      };
      coleta(arvore());
      expect(r.positions.size).toBe(todos.size);
      for (const [id, p] of r.positions) {
        const n = todos.get(id)!;
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + n.w).toBeLessThanOrEqual(r.width);
        expect(p.y + n.h).toBeLessThanOrEqual(r.height);
      }
      expect(r.combParents.has("g1")).toBe(true);
    });

    it("é determinístico", () => {
      const a = layoutTree(arvore());
      const b = layoutTree(arvore());
      expect([...a.positions]).toEqual([...b.positions]);
      expect([...a.combParents]).toEqual([...b.combParents]);
      expect(a.width).toBe(b.width);
      expect(a.height).toBe(b.height);
    });
  });
});
