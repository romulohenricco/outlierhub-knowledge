/**
 * `BILHON_OLLAMA_URL` com barra final (a URL colada do navegador costuma vir assim)
 * gerava `//api/embeddings`, que o Ollama não casa: a busca respondia "Ollama
 * offline" com ele no ar. A URL é normalizada antes de montar o endereço.
 *
 * Hermético como search.test.ts: o cliente do Supabase e o `fetch` são mockados e
 * toda variável `BILHON_*` é limpa antes de cada caso.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: () => ({ abortSignal: () => Promise.resolve({ data: [], error: null }) }),
  }),
}));

let envOriginal: Record<string, string | undefined> = {};

beforeEach(() => {
  envOriginal = {};
  for (const chave of Object.keys(process.env)) {
    if (chave.startsWith("BILHON_")) {
      envOriginal[chave] = process.env[chave];
      delete process.env[chave];
    }
  }
  process.env.BILHON_SUPABASE_URL = "https://projeto-ficticio.example.invalid";
  process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia-de-teste-sem-valor-real";
  process.env.BILHON_KNOWLEDGE_BUCKET_FILTER = "bucket-ficticio";
  vi.resetModules();
});
afterEach(() => {
  for (const chave of Object.keys(process.env)) if (chave.startsWith("BILHON_")) delete process.env[chave];
  for (const [chave, valor] of Object.entries(envOriginal)) if (valor !== undefined) process.env[chave] = valor;
  vi.unstubAllGlobals();
});

async function enderecoDoEmbedding(ollamaUrl: string | undefined) {
  if (ollamaUrl !== undefined) process.env.BILHON_OLLAMA_URL = ollamaUrl;
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ embedding: [0.1, 0.2] }), { status: 200, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { BilhonCorpusSearchProvider } = await import("./search");
  await new BilhonCorpusSearchProvider().search("pergunta");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return (fetchMock.mock.calls[0] as unknown as [string])[0];
}

describe("endereço do embedding", () => {
  it.each([
    ["sem barra final", "http://localhost:11434"],
    ["uma barra final", "http://localhost:11434/"],
    ["várias barras finais", "http://localhost:11434///"],
    ["espaços em volta", "  http://localhost:11434/  "],
  ])("%s: um único /api/embeddings", async (_nome, valor) => {
    expect(await enderecoDoEmbedding(valor)).toBe("http://localhost:11434/api/embeddings");
  });

  it("com caminho de proxy, preserva o caminho e tira só a barra do fim", async () => {
    expect(await enderecoDoEmbedding("http://localhost:8080/ollama/")).toBe("http://localhost:8080/ollama/api/embeddings");
  });

  it.each([
    ["ausente", undefined],
    ["em branco", ""],
    ["só barras", "///"],
  ])("%s: usa o endereço padrão", async (_nome, valor) => {
    expect(await enderecoDoEmbedding(valor)).toBe("http://127.0.0.1:11434/api/embeddings");
  });
});
