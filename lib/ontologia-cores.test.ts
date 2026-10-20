import { describe, expect, it } from "vitest";
import { corDaCamada, corDoStatus, corPorTexto, corValida } from "./ontologia-cores";

describe("cores da ontologia", () => {
  it("corPorTexto é estável e aceita texto vazio", () => {
    expect(corPorTexto("alfa")).toBe(corPorTexto("alfa"));
    expect(corPorTexto("alfa")).toMatch(/^#[0-9a-f]{6}$/);
    expect(corPorTexto("")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("corValida só aceita #RGB e #RRGGBB", () => {
    expect(corValida("#abc")).toBe("#abc");
    expect(corValida(" #5b8cff ")).toBe("#5b8cff");
    for (const ruim of ["red", "#abcd", "#12345", "#gggggg", "rgb(1,2,3)", "url(x)", "#fff; background:red", "", 7, null, undefined]) {
      expect(corValida(ruim), String(ruim)).toBeUndefined();
    }
  });

  it("camada: a cor declarada vence; inválida cai no hash do id", () => {
    expect(corDaCamada("x", "#123456")).toBe("#123456");
    expect(corDaCamada("x", "vermelho")).toBe(corPorTexto("x"));
    expect(corDaCamada("x")).toBe(corPorTexto("x"));
  });

  it("status: mapa vence, o resto vem do hash, e chave herdada do protótipo não vaza", () => {
    expect(corDoStatus("ativo", { ativo: "#4ade80" })).toBe("#4ade80");
    expect(corDoStatus("novo", { ativo: "#4ade80" })).toBe(corPorTexto("novo"));
    expect(corDoStatus("constructor", {})).toBe(corPorTexto("constructor"));
    expect(corDoStatus("x", { x: "inválida" })).toBe(corPorTexto("x"));
  });
});
