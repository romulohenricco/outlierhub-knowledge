import { describe, it, expect } from "vitest";
import { ampliarParaFoco } from "./grafo-foco";

const padrao = { status: ["confirmed", "claimed"], tema: "", comLivros: true };

describe("ampliarParaFoco — deep-link ?focus= para nó fora dos filtros", () => {
  it("inclui as arestas disputadas e tira o filtro de tema", () => {
    expect(ampliarParaFoco({ status: ["confirmed"], tema: "Saúde", comLivros: true })).toEqual({
      status: ["confirmed", "claimed", "disputed"],
      tema: "",
      comLivros: true,
    });
  });
  it("religa os livros se estavam ocultos", () => {
    expect(ampliarParaFoco({ ...padrao, comLivros: false })?.comLivros).toBe(true);
  });
  it("filtros padrão: ainda falta 'disputed' (conceito só com aresta disputada)", () => {
    expect(ampliarParaFoco(padrao)?.status).toContain("disputed");
  });
  it("já está tudo aberto → null (não há o que ampliar; vira aviso)", () => {
    expect(ampliarParaFoco({ status: ["disputed", "claimed", "confirmed"], tema: "", comLivros: true })).toBeNull();
  });
});
