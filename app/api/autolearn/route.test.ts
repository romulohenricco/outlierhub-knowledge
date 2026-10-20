import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * Autolearn chama um Ollama local. Host e modelo vêm do ambiente: o host cai no
 * loopback quando está em branco (infra local, não credencial); o modelo não tem
 * padrão — sem ele a rota responde 503 e nada é enviado.
 */

// isola a rota do catálogo e do provider: aqui só interessa a chamada ao Ollama
vi.mock("@/lib/catalog", () => ({ getBooks: vi.fn(async () => []) }));
vi.mock("@/lib/providers", () => ({
  getKnowledgeProvider: () => ({
    fontesDoConceito: async () => ({ livros: [], relacoes: [], vizinhos: [] }),
  }),
}));

const fetchMock = vi.fn();
let POST: (req: Request) => Promise<Response>;
let GET: (req: NextRequest) => Promise<Response>;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "autolearn-"));
  vi.resetModules();
  vi.stubEnv("BILHON_AUTOLEARN_CACHE", path.join(dir, "cache.json"));
  vi.stubEnv("BILHON_OLLAMA_URL", "");
  vi.stubEnv("BILHON_AUTOLEARN_MODEL", "");
  vi.stubEnv("BILHON_AUTOLEARN_SEARCH_URL", "");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  ({ POST, GET } = await import("./route"));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const chamar = (body: unknown) =>
  POST(
    new Request("http://127.0.0.1:3300/api/autolearn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const reabrir = (conceito: string) =>
  GET(new NextRequest(`http://127.0.0.1:3300/api/autolearn?conceito=${encodeURIComponent(conceito)}`));

/** A rota lê o caminho do cache no import: trocar a env exige reimportar. */
async function recarregarRota() {
  vi.resetModules();
  ({ POST, GET } = await import("./route"));
}

const ollamaResponde = () =>
  fetchMock.mockResolvedValue({
    json: async () => ({
      response: JSON.stringify({ sugestoes: [{ assunto: "Obra A", query: "obra a guia", porque: "complementa" }] }),
    }),
  });

describe("POST /api/autolearn", () => {
  it("sem conceito nem livro: 400", async () => {
    const res = await chamar({});
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["em branco", ""],
    ["só espaços", "   "],
  ])("modelo %s: 503 'modelo-nao-configurado' e nada é enviado", async (_nome, valor) => {
    vi.stubEnv("BILHON_AUTOLEARN_MODEL", valor);
    const res = await chamar({ conceito: "vendas" });
    expect(res.status).toBe(503);
    const corpo = await res.json();
    expect(corpo.erro).toBe("modelo-nao-configurado");
    expect(corpo.detalhe).toContain("BILHON_AUTOLEARN_MODEL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("host em branco cai no loopback e usa o modelo configurado", async () => {
    vi.stubEnv("BILHON_AUTOLEARN_MODEL", "modelo-de-teste");
    ollamaResponde();
    const res = await chamar({ conceito: "vendas" });
    expect(res.status).toBe(200);
    expect((await res.json()).sugestoes).toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:11434/api/generate");
    expect(JSON.parse(init.body).model).toBe("modelo-de-teste");
  });

  it("host configurado vale, com ou sem barra no fim", async () => {
    vi.stubEnv("BILHON_AUTOLEARN_MODEL", "modelo-de-teste");
    vi.stubEnv("BILHON_OLLAMA_URL", "http://127.0.0.1:9999/");
    ollamaResponde();
    await chamar({ conceito: "vendas" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:9999/api/generate");
  });

  it("Ollama fora do ar: 503 'ollama-offline'", async () => {
    vi.stubEnv("BILHON_AUTOLEARN_MODEL", "modelo-de-teste");
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await chamar({ conceito: "vendas" });
    expect(res.status).toBe(503);
    expect((await res.json()).erro).toBe("ollama-offline");
  });

  it("o prompt não manda buscar em um serviço específico nem fixa um domínio de exemplo", async () => {
    vi.stubEnv("BILHON_AUTOLEARN_MODEL", "modelo-de-teste");
    ollamaResponde();
    await chamar({ conceito: "vendas" });
    const { prompt } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(prompt).toContain("boa pra achar a obra");
    expect(prompt).not.toMatch(/ntsc|broadcast|cinema/i);
  });
});

describe("cache das sugestões (BILHON_AUTOLEARN_CACHE)", () => {
  it("pasta do cache ainda não existe: é criada e a busca fica salva para reabrir o nó", async () => {
    // template recém-clonado: data/livros não existe. Sem criar a pasta o
    // writeFile falhava com ENOENT e a rota culpava o Ollama.
    const cache = path.join(dir, "data", "livros", "autolearn-cache.json");
    vi.stubEnv("BILHON_AUTOLEARN_CACHE", cache);
    await recarregarRota();
    vi.stubEnv("BILHON_AUTOLEARN_MODEL", "modelo-de-teste");
    ollamaResponde();

    const res = await chamar({ conceito: "vendas" });
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.ok).toBe(true);
    expect(corpo.persistido).toBe(true);
    expect(existsSync(cache)).toBe(true);
    expect(Object.keys(JSON.parse(await readFile(cache, "utf-8")))).toEqual(["c:vendas"]);

    const reaberto = await reabrir("vendas");
    expect(reaberto.status).toBe(200);
    expect((await reaberto.json()).sugestoes).toHaveLength(1);
  });

  it("cache que não dá para gravar: as sugestões chegam, sem 'ollama-offline' e sem caminho", async () => {
    // o "diretório" do cache é um arquivo comum: mkdir/writeFile falham de verdade
    const arquivo = path.join(dir, "arquivo-comum");
    await writeFile(arquivo, "x");
    vi.stubEnv("BILHON_AUTOLEARN_CACHE", path.join(arquivo, "cache.json"));
    await recarregarRota();
    vi.stubEnv("BILHON_AUTOLEARN_MODEL", "modelo-de-teste");
    ollamaResponde();

    const res = await chamar({ conceito: "vendas" });
    expect(res.status).toBe(200);
    const texto = await res.text();
    const corpo = JSON.parse(texto);
    expect(corpo.ok).toBe(true);
    expect(corpo.persistido).toBe(false);
    expect(corpo.sugestoes).toHaveLength(1);
    expect(corpo.erro).toBeUndefined();
    expect(texto).not.toContain("ollama-offline");
    expect(texto).not.toContain(dir);
  });
});

describe("BILHON_AUTOLEARN_SEARCH_URL (botão de busca da obra)", () => {
  const MODELO = "https://busca.example.invalid/?q={query}";

  it("em branco: a resposta não traz endereço de busca (o painel não mostra o botão)", async () => {
    vi.stubEnv("BILHON_AUTOLEARN_MODEL", "modelo-de-teste");
    ollamaResponde();
    const corpo = await (await chamar({ conceito: "vendas" })).json();
    expect(corpo.buscaUrl).toBeNull();
    expect((await (await reabrir("vendas")).json()).buscaUrl).toBeNull();
  });

  it("configurado com {query}: devolve o modelo na geração e ao reabrir o nó", async () => {
    vi.stubEnv("BILHON_AUTOLEARN_MODEL", "modelo-de-teste");
    vi.stubEnv("BILHON_AUTOLEARN_SEARCH_URL", `  ${MODELO}  `);
    ollamaResponde();
    const corpo = await (await chamar({ conceito: "vendas" })).json();
    expect(corpo.buscaUrl).toBe(MODELO);
    expect((await (await reabrir("vendas")).json()).buscaUrl).toBe(MODELO);
  });

  it.each([
    ["sem {query}", "https://busca.example.invalid/?q=fixo"],
    ["esquema que não é http(s)", "javascript:alert({query})"],
    ["com espaço no meio", "https://busca.example.invalid/ ?q={query}"],
  ])("valor inválido (%s) vale como ausente", async (_nome, valor) => {
    vi.stubEnv("BILHON_AUTOLEARN_MODEL", "modelo-de-teste");
    vi.stubEnv("BILHON_AUTOLEARN_SEARCH_URL", valor);
    ollamaResponde();
    const corpo = await (await chamar({ conceito: "vendas" })).json();
    expect(corpo.buscaUrl).toBeNull();
  });
});
