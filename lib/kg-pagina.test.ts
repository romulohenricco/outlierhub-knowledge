/**
 * Página estimada da evidência de livro.
 *
 * Não existe índice de chunks por livro, então a fórmula
 * `(chunkIdx + 0.5) / chunksTotal` — que modela uma divisão uniforme — não
 * serve: scripts/kg-extract.py amostra o livro em FRAÇÕES fixas (20% e 60%).
 * Com chunksTotal=2 ela devolveria 25% e 75%: ~15 pontos percentuais de erro,
 * ou dezenas de páginas num livro grande.
 */
import { describe, it, expect } from "vitest";
import { paginaDoTrechoDeLivro } from "./kg";

describe("paginaDoTrechoDeLivro", () => {
  it("usa a fração real da amostragem (20% / 60%), não chunkIdx/chunksTotal", () => {
    // 300 páginas: trecho #0 a 20% → 60; #1 a 60% → 180.
    // A fórmula antiga daria 75 e 225 — o leitor abriria no capítulo errado.
    expect(paginaDoTrechoDeLivro(0, 300)).toBe(60);
    expect(paginaDoTrechoDeLivro(1, 300)).toBe(180);
  });

  it("índice de trecho desconhecido devolve null em vez de chutar", () => {
    expect(paginaDoTrechoDeLivro(2, 300)).toBeNull();
    expect(paginaDoTrechoDeLivro(-1, 300)).toBeNull();
    expect(paginaDoTrechoDeLivro(NaN, 300)).toBeNull();
  });

  it("sem número de páginas (TXT/MD, ou PDF sem pdfinfo) devolve null", () => {
    expect(paginaDoTrechoDeLivro(0, null)).toBeNull();
    expect(paginaDoTrechoDeLivro(0, 0)).toBeNull();
  });

  it("nunca devolve página fora do livro (1 <= p <= paginas)", () => {
    expect(paginaDoTrechoDeLivro(0, 1)).toBe(1); // round(0.2) = 0 → piso 1
    expect(paginaDoTrechoDeLivro(1, 1)).toBe(1);
    for (const paginas of [1, 2, 3, 7, 59, 1200]) {
      for (const idx of [0, 1]) {
        const p = paginaDoTrechoDeLivro(idx, paginas)!;
        expect(p).toBeGreaterThanOrEqual(1);
        expect(p).toBeLessThanOrEqual(paginas);
      }
    }
  });
});
