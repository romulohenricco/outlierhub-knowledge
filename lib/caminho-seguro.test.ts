import { describe, expect, it } from "vitest";
import { segmentoSeguro } from "./caminho-seguro";

describe("segmentoSeguro — UM segmento de caminho, nunca escape", () => {
  it("aceita nome comum e reticências legítimas", () => {
    for (const s of ["nota-01", "post....jpg", "Yes, but....jpg", "a..b", "...", "nota.md"]) {
      expect(segmentoSeguro(s), s).toBe(true);
    }
  });

  it("recusa vazio, . , .., separadores e NUL", () => {
    for (const s of ["", ".", "..", "a/b", "../x", "a\\b", "x\0y"]) {
      expect(segmentoSeguro(s), JSON.stringify(s)).toBe(false);
    }
  });

  it("recusa o que não é texto", () => {
    for (const s of [null, undefined, 12, {}, ["a"]]) {
      expect(segmentoSeguro(s), String(s)).toBe(false);
    }
  });
});
