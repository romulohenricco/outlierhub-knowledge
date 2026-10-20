/** Recorte por data do /grafo — função pura, roda no cliente. */
import { describe, expect, it } from "vitest";
import { dataMinima, recortarPorData, inicioDoPreset } from "./grafo-data";

type N = { id: string; data?: string; estrutural?: boolean };
type L = { src: string; dst: string };

const NOS: N[] = [
  { id: "hub", estrutural: true },
  { id: "raiz", estrutural: true },
  { id: "velho", data: "2025-01-10" },
  { id: "novo", data: "2026-10-10" },
  { id: "meio", data: "2026-06-01" },
  { id: "semdata" },
];
const ARESTAS: L[] = [
  { src: "raiz", dst: "hub" },
  { src: "velho", dst: "hub" },
  { src: "novo", dst: "hub" },
  { src: "meio", dst: "novo" },
  { src: "semdata", dst: "novo" },
];

describe("recortarPorData", () => {
  it("sem intervalo não recorta nada", () => {
    const r = recortarPorData(NOS, ARESTAS, {});
    expect(r.links).toHaveLength(ARESTAS.length);
    expect(r.ocultosSemData).toBe(0);
  });

  it("mantém só aresta com as duas pontas no intervalo (bordas inclusivas)", () => {
    const r = recortarPorData(NOS, ARESTAS, { de: "2026-06-01", ate: "2026-10-10" });
    const pares = r.links.map((l) => `${l.src}>${l.dst}`);
    expect(pares).toContain("meio>novo");
    expect(pares).toContain("novo>hub");
    expect(pares).not.toContain("velho>hub");
  });

  it("nó sem data some por padrão e é contado; com semData ele fica", () => {
    const r = recortarPorData(NOS, ARESTAS, { de: "2026-01-01" });
    expect(r.links.some((l) => l.src === "semdata")).toBe(false);
    expect(r.ocultosSemData).toBe(1);
    const r2 = recortarPorData(NOS, ARESTAS, { de: "2026-01-01", semData: true });
    expect(r2.links.some((l) => l.src === "semdata")).toBe(true);
  });

  it("estrutural passa sempre, mas não sobra pendurado só em outro estrutural", () => {
    const r = recortarPorData(NOS, ARESTAS, { de: "2030-01-01" });
    expect(r.links).toHaveLength(0); // raiz>hub sozinho não sobrevive
  });

  it("estrutural ligado a algo que passou mantém a própria espinha", () => {
    const r = recortarPorData(NOS, ARESTAS, { de: "2026-10-01" });
    const pares = r.links.map((l) => `${l.src}>${l.dst}`);
    expect(pares).toEqual(expect.arrayContaining(["novo>hub", "raiz>hub"]));
  });
});

describe("inicioDoPreset", () => {
  it("calcula o início relativo a hoje", () => {
    const hoje = new Date("2026-10-16T12:00:00");
    expect(inicioDoPreset("7d", hoje)).toBe("2026-10-09");
    expect(inicioDoPreset("30d", hoje)).toBe("2026-09-16");
    expect(inicioDoPreset("1a", hoje)).toBe("2025-10-16");
  });
});

describe("dataMinima", () => {
  it("devolve a menor data ISO ignorando ausentes", () => {
    expect(dataMinima(["2026-02-01", undefined, "2025-12-31", null])).toBe("2025-12-31");
    expect(dataMinima([undefined])).toBeUndefined();
  });
});
