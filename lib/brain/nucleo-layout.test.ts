import { describe, expect, it } from "vitest";
import { layoutNucleo } from "./nucleo-layout";
import type { Memoria } from "./tipos";

const mem: Memoria = {
  hubs: [
    { id: "agents", nome: "agents", total: 10 },
    { id: "memoria", nome: "memoria", total: 5 },
    { id: "log", nome: "log", total: 3 },
  ],
  notas: Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, titulo: `n${i}`, hub: ["agents", "memoria", "log"][i % 3], grau: 1 + (i % 4), caminho: `n${i}`, palavras: 10, trecho: "" })),
  links: Array.from({ length: 59 }, (_, i) => [`n${i}`, `n${i + 1}`] as [string, string]),
  total: 18,
  conectadas: 60,
  naoResolvidos: 0,
};

describe("layoutNucleo", () => {
  const l = layoutNucleo(mem, 150);
  it("posiciona todas as notas e hubs dentro do raio", () => {
    expect(l.notas.size).toBe(60);
    for (const p of [...l.notas.values(), ...l.hubs.values()]) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(150);
  });
  it("é determinístico", () => {
    const b = layoutNucleo(mem, 150);
    expect(b.notas.get("n7")).toEqual(l.notas.get("n7"));
  });
  it("notas ficam mais perto do próprio hub que dos outros (em média)", () => {
    let ok = 0;
    for (const n of mem.notas) {
      const p = l.notas.get(n.id)!;
      const d = (h: string) => Math.hypot(p.x - l.hubs.get(h)!.x, p.y - l.hubs.get(h)!.y);
      const meu = d(n.hub);
      if (["agents", "memoria", "log"].filter((h) => h !== n.hub).every((h) => meu <= d(h))) ok++;
    }
    expect(ok).toBeGreaterThan(30);
  });
  it("memória vazia não quebra", () => {
    expect(layoutNucleo({ ...mem, notas: [], links: [] }, 150).notas.size).toBe(0);
  });
});
