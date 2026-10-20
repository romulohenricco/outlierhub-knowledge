import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/** O registro das páginas (scripts/paginas.json) alimenta as branches, os worktrees e as portas. */

type Registro = { prefixoBranch: string; base: string; paginas: { nome: string; rota: string; porta: number }[] };
const registro = JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "paginas.json"), "utf-8")) as Registro;

describe("registro das páginas", () => {
  it("nomes, rotas e portas não se repetem", () => {
    for (const campo of ["nome", "rota", "porta"] as const) {
      const valores = registro.paginas.map((p) => p[campo]);
      expect(new Set(valores).size, campo).toBe(valores.length);
    }
  });

  it("nome vira branch pagina/<nome>: minúsculas, sem acento nem espaço", () => {
    expect(registro.prefixoBranch).toBe("pagina/");
    for (const p of registro.paginas) expect(p.nome, p.nome).toMatch(/^[a-z0-9-]+$/);
  });

  it("rotas começam com / e as portas não colidem com o servidor principal (3300/3301)", () => {
    for (const p of registro.paginas) {
      expect(p.rota, p.nome).toMatch(/^\/[a-z0-9/-]+$/);
      expect(p.porta, p.nome).toBeGreaterThan(3301);
    }
  });
});
