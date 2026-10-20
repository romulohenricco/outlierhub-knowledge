import { describe, expect, it } from "vitest";
import { trilhaSolta } from "./trilha";

describe("trilhaSolta (ligação curva, não reta)", () => {
  it("é determinística pro mesmo par e seed", () => {
    expect(trilhaSolta({ x: 0, y: 0 }, { x: 100, y: 0 }, "a|b")).toBe(trilhaSolta({ x: 0, y: 0 }, { x: 100, y: 0 }, "a|b"));
  });

  it("usa curva quadrática e não uma reta", () => {
    const d = trilhaSolta({ x: 0, y: 0 }, { x: 100, y: 0 }, "a|b");
    expect(d.startsWith("M0 0 Q")).toBe(true);
    expect(d).not.toMatch(/ L/);
  });

  it("o ponto de controle sai da reta (curva de verdade)", () => {
    const d = trilhaSolta({ x: 0, y: 0 }, { x: 100, y: 0 }, "a|b");
    const m = /Q(-?[\d.]+) (-?[\d.]+) 100 0/.exec(d);
    expect(m).not.toBeNull();
    expect(Math.abs(Number(m![2]))).toBeGreaterThan(5);
  });

  it("seeds diferentes curvam para lados ou magnitudes diferentes", () => {
    const d1 = trilhaSolta({ x: 0, y: 0 }, { x: 100, y: 0 }, "a|b");
    const d2 = trilhaSolta({ x: 0, y: 0 }, { x: 100, y: 0 }, "c|d");
    expect(d1).not.toBe(d2);
  });
});
