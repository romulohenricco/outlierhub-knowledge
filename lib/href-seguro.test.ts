import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão (achado da revisão independente, 19/10/2026): um link que vem
 * de arquivo de dados do usuário (referencias.json, inventários) só pode virar `href`
 * se for http(s). React 19 não bloqueia `javascript:`. `urlHttp()` (lib/social-url.ts)
 * devolve undefined para o resto.
 *
 * É um teste de código-fonte de propósito: um teste de renderização só cobre o caminho
 * que o fixture exercita; este barra a REINTRODUÇÃO do padrão em qualquer ponto.
 */
const ARQUIVOS: Record<string, string[]> = {
  "components/Referencias.tsx": ["p.preview", "p.igUrl", "g.pagina.preview", "g.pagina.igUrl"],
  "components/Grafo.tsx": ["sel.igUrl", "e.youtube.url"],
};

describe("href vindo de dado do usuário passa por urlHttp()", () => {
  for (const [arquivo, campos] of Object.entries(ARQUIVOS)) {
    const fonte = readFileSync(arquivo, "utf-8");
    it(`${arquivo} importa urlHttp`, () => {
      expect(fonte).toMatch(/import \{[^}]*\burlHttp\b[^}]*\} from "@\/lib\/social-url"/);
    });
    for (const campo of campos) {
      it(`${arquivo}: href={${campo}} nunca cru`, () => {
        const cru = new RegExp(`href=\\{\\s*${campo.replace(/\./g, "\\.")}\\s*\\}`);
        expect(fonte).not.toMatch(cru);
        expect(fonte).toContain(`urlHttp(${campo})`);
      });
    }
  }
});
