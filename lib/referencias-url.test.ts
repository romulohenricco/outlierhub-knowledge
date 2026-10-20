import { describe, expect, it } from "vitest";
import { FILTROS_VAZIOS, escreverFiltros, lerFiltros } from "./referencias-url";

describe("filtros de /referencias na URL", () => {
  it("URL vazia → filtros vazios, e filtros vazios → query vazia", () => {
    expect(lerFiltros(new URLSearchParams(""))).toEqual(FILTROS_VAZIOS);
    expect(escreverFiltros(FILTROS_VAZIOS)).toBe("");
  });

  it("fonte youtube vira ?fonte=youtube e volta igual", () => {
    const qs = escreverFiltros({ ...FILTROS_VAZIOS, plataforma: "youtube" });
    expect(qs).toBe("fonte=youtube");
    expect(lerFiltros(new URLSearchParams(qs)).plataforma).toBe("youtube");
  });

  it("ida e volta com todos os filtros, coleções múltiplas e página", () => {
    const f = {
      q: "thumb azul",
      plataforma: "youtube",
      dominio: "CREATIVE",
      perfil: "orenmeetsworld",
      colecoes: ["INFO", "Prompt - imagem-foto-video"],
      favoritos: true,
      antipatterns: true,
      paginas: 3,
    };
    expect(lerFiltros(new URLSearchParams(escreverFiltros(f)))).toEqual(f);
  });

  it("aceita o objeto searchParams do Next (string | string[])", () => {
    expect(
      lerFiltros({ fonte: "youtube", col: ["A", "B"], fav: "1", pag: "2" }),
    ).toMatchObject({ plataforma: "youtube", colecoes: ["A", "B"], favoritos: true, paginas: 2 });
  });

  it("pag inválida ou < 2 cai em 1", () => {
    for (const pag of ["0", "-3", "abc", ""]) {
      expect(lerFiltros(new URLSearchParams({ pag })).paginas).toBe(1);
    }
  });
});
