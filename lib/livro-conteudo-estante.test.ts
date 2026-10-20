import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Montagem do conteúdo da estante a partir das fontes opcionais: sem nada configurado
 * (clone limpo) tudo degrada para vazio sem erro; com niveis.json e o sidecar de
 * sinopses, o card traz a sinopse certa e diz de onde ela veio.
 */

let dir: string;

const PROSA =
  "Este livro de exemplo explica, com calma, como organizar uma estante de estudo: " +
  "separar o que é referência do que é prática, registrar o que foi lido e voltar " +
  "aos trechos que importam quando surgir uma dúvida de verdade no trabalho.";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "estante-"));
  vi.stubEnv("BILHON_KG_DB", path.join(dir, "nao-existe.sqlite"));
  vi.resetModules();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function catalogoComUmTxt() {
  const livros = path.join(dir, "arquivos");
  await mkdir(livros, { recursive: true });
  await writeFile(path.join(livros, "exemplo.txt"), `Sumário\nPrefácio\nCapítulo um\n\n${PROSA}\n`);
  await writeFile(
    path.join(dir, "catalogo.json"),
    JSON.stringify({
      livros: [
        {
          id: "exemplo",
          titulo: "Exemplo",
          arquivo: "exemplo.txt",
          formato: "txt",
          tema: "Estudo",
          cluster: null,
          origem: "INBOX",
          sizeBytes: 10,
          vizinhos: [],
          proveniencia: { origemPath: "x", motivo: "teste" },
        },
      ],
    }),
  );
  vi.stubEnv("BILHON_CATALOGO", path.join(dir, "catalogo.json"));
  vi.stubEnv("BILHON_LIVROS_DIR", livros);
  vi.stubEnv("BILHON_NIVEIS", path.join(dir, "niveis.json"));
}

describe("livrosDaEstante", () => {
  it("clone limpo: livros de exemplo, sem conceitos nem sinopse e sem caminho absoluto", async () => {
    vi.stubEnv("BILHON_CATALOGO", path.join(dir, "nao-existe.json"));
    vi.stubEnv("BILHON_NIVEIS", path.join(dir, "niveis-nao-existe.json"));
    const { livrosDaEstante } = await import("./livro-conteudo");
    const cards = await livrosDaEstante();
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(c.conceitos).toEqual([]);
      expect(c.sinopse).toBeNull();
      expect(path.isAbsolute(c.path)).toBe(false);
      expect(c.prompt).toContain(c.titulo);
    }
  });

  it("niveis.json sem sidecar: a justificativa do classificador vira a sinopse", async () => {
    await catalogoComUmTxt();
    await writeFile(
      path.join(dir, "niveis.json"),
      JSON.stringify({ "exemplo.txt": { nivel: "pratico-mercado", justificativa: "linguagem de manual" } }),
    );
    const { livrosDaEstante } = await import("./livro-conteudo");
    const [card] = await livrosDaEstante();
    expect(card.sinopse).toBe("linguagem de manual");
    expect(card.sinopseFonte).toBe("classificador");
    expect(card.nivelNome).toBe("prático/mercado");
  });

  it("sidecar de sinopses (ao lado do niveis.json) vence o classificador", async () => {
    await catalogoComUmTxt();
    await writeFile(
      path.join(dir, "niveis.json"),
      JSON.stringify({ "exemplo.txt": { nivel: "profissional", justificativa: "registro" } }),
    );
    await writeFile(
      path.join(dir, "livros-sinopses.json"),
      JSON.stringify({ porLivro: { "exemplo.txt": { sinopse: "Ensina a organizar uma estante." } } }),
    );
    const { livrosDaEstante } = await import("./livro-conteudo");
    const [card] = await livrosDaEstante();
    expect(card.sinopse).toBe("Ensina a organizar uma estante.");
    expect(card.sinopseFonte).toBe("llm-local");
  });

  it("BILHON_LIVROS_SINOPSES aponta o sidecar para outro lugar", async () => {
    await catalogoComUmTxt();
    const outro = path.join(dir, "outro.json");
    await writeFile(outro, JSON.stringify({ porLivro: { "exemplo.txt": { sinopse: "De outro arquivo." } } }));
    vi.stubEnv("BILHON_LIVROS_SINOPSES", outro);
    const { livrosDaEstante } = await import("./livro-conteudo");
    expect((await livrosDaEstante())[0].sinopse).toBe("De outro arquivo.");
  });

  it("JSON inválido nas fontes não derruba a estante", async () => {
    await catalogoComUmTxt();
    await writeFile(path.join(dir, "niveis.json"), "{ não é json");
    await writeFile(path.join(dir, "livros-sinopses.json"), "[");
    const { livrosDaEstante } = await import("./livro-conteudo");
    const [card] = await livrosDaEstante();
    expect(card.sinopse).toBeNull();
  });
});

describe("conteudoDoLivro", () => {
  it("lê abertura e sumário do próprio arquivo; sem grafo, sem conceitos nem trechos", async () => {
    await catalogoComUmTxt();
    const { getBook } = await import("./catalog");
    const { conteudoDoLivro } = await import("./livro-conteudo");
    const livro = await getBook("exemplo");
    const c = await conteudoDoLivro(livro!);
    expect(c.abertura).toContain("organizar uma estante de estudo");
    expect(c.sumario).toEqual(["Prefácio", "Capítulo um"]);
    expect(c.conceitos).toEqual([]);
    expect(c.trechos).toEqual([]);
  });

  it("arquivo ausente do disco: campos vazios, sem erro", async () => {
    await catalogoComUmTxt();
    await rm(path.join(dir, "arquivos", "exemplo.txt"));
    const { getBook } = await import("./catalog");
    const { conteudoDoLivro } = await import("./livro-conteudo");
    const c = await conteudoDoLivro((await getBook("exemplo"))!);
    expect(c.abertura).toBeNull();
    expect(c.sumario).toEqual([]);
  });
});
