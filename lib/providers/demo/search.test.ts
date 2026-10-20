import { describe, expect, it } from "vitest";
import { DemoSearchProvider } from "./search";

describe("busca do modo demo", () => {
  const provider = new DemoSearchProvider();

  it("acha o livro com e sem acento e com qualquer caixa", async () => {
    const comAcento = await provider.search("conexão");
    const semAcento = await provider.search("CONEXAO");
    expect(comAcento.length).toBeGreaterThan(0);
    expect(comAcento.map((h) => h.livroId)).toContain("perguntas-e-conexoes");
    expect(semAcento.map((h) => h.livroId)).toEqual(comAcento.map((h) => h.livroId));
  });

  it("a busca por um tema da estante devolve os livros desse tema", async () => {
    const ids = (await provider.search("conhecimento")).map((h) => h.livroId);
    expect(ids).toContain("guia-knowledge");
    expect(ids).toContain("organizar-fontes");
  });

  it("o exemplo do campo de busca acha conteúdo pertinente, sem arrastar o acervo inteiro", async () => {
    const hits = await provider.search("como escrever conteudo claro");
    const ids = hits.map((h) => h.livroId);
    expect(ids).toContain("conteudo-com-clareza");
    expect(ids.length).toBeLessThan(5);
  });

  it("só palavras de ligação: ainda assim procura (não devolve tudo nem quebra)", async () => {
    await expect(provider.search("como que para")).resolves.toBeDefined();
  });

  it("consulta vazia ou só com espaços não devolve nada", async () => {
    expect(await provider.search("   ")).toEqual([]);
  });

  it("termo inexistente não devolve nada", async () => {
    expect(await provider.search("zzzxqwy")).toEqual([]);
  });
});
