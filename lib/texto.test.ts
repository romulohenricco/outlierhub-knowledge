import { describe, it, expect } from "vitest";
import { cortaTexto } from "./texto";

/**
 * Regressão: cortar texto de fonte externa com `String.slice` corta por CODE UNIT
 * UTF-16. Emoji ocupa 2 code units; corte no meio deixa um high surrogate solto
 * que não é UTF-8 válido — jq recusa o JSON e `encodeURIComponent` LANÇA
 * URIError. O invariante que interessa: a saída é sempre well-formed, venha o
 * que vier na entrada.
 */
describe("cortaTexto — corte seguro de texto externo", () => {
  it("corta por code point, não por code unit (não deixa surrogate solto)", () => {
    // "Inspiration " = 12 code units; o 💡 ocupa 2 → slice(0,13) parte o emoji
    const caption = "Inspiration 💡 e mais texto";
    expect(caption.slice(0, 13).isWellFormed()).toBe(false); // comportamento atual, quebrado
    expect(cortaTexto(caption, 13).isWellFormed()).toBe(true);
  });

  it("não inclui o emoji pela metade — o budget conta code points", () => {
    // 💡 é o code point de índice 12; com budget 12 ele não entra, com 13 entra inteiro
    expect(cortaTexto("Inspiration 💡 e mais", 12)).toBe("Inspiration ");
    expect(cortaTexto("Inspiration 💡 e mais", 13)).toBe("Inspiration 💡");
  });

  it("a saída sobrevive a JSON.stringify sem escape de surrogate órfão", () => {
    const real = "Legenda de exemplo para testar um corte seguro 💡💡💡";
    const cortado = cortaTexto(real, 48);
    expect(JSON.stringify(cortado)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
    expect(() => JSON.parse(JSON.stringify(cortado))).not.toThrow();
  });

  it("a saída nunca faz encodeURIComponent lançar URIError", () => {
    const trecho = "Trecho de exemplo para os testes 🔥";
    // slice(0,34) parte o 🔥 (code unit 34 = high surrogate) → URIError hoje
    expect(() => encodeURIComponent(trecho.slice(0, 34))).toThrow(URIError);
    expect(() => encodeURIComponent(cortaTexto(trecho, 34))).not.toThrow();
  });

  it("limpa surrogate órfão que JÁ vinha quebrado na entrada, sem cortar", () => {
    const jaQuebrado = "legenda \ud83d truncada na origem";
    expect(jaQuebrado.isWellFormed()).toBe(false);
    const saida = cortaTexto(jaQuebrado, 200);
    expect(saida.isWellFormed()).toBe(true);
    expect(saida).toBe("legenda  truncada na origem");
  });

  it("preserva pares de surrogate válidos e texto matemático estilizado do IG", () => {
    // 𝗕𝗢𝗟𝗗 do Instagram usa plano astral (\ud835 + low) — par válido, deve passar
    const bold = "𝗕𝗢𝗟𝗗 headline";
    expect(cortaTexto(bold, 4)).toBe("𝗕𝗢𝗟𝗗");
    expect(cortaTexto(bold, 4).isWellFormed()).toBe(true);
  });

  it("texto curto/ASCII passa intacto e não ganha elipse", () => {
    expect(cortaTexto("curto", 48)).toBe("curto");
    expect(cortaTexto("", 48)).toBe("");
  });

  it("tolera entrada não-string sem explodir (payload externo malformado)", () => {
    expect(cortaTexto(undefined as unknown as string, 10)).toBe("");
    expect(cortaTexto(null as unknown as string, 10)).toBe("");
  });
});
