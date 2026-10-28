import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Valor de `BILHON_KNOWLEDGE_PROVIDER`: "demo" (padrão), "supabase" ou "local"
 * (índice FTS5 + grafo em sqlite gerados por `npm run populate`). O valor
 * antigo do provider real segue aceito em silêncio, para não quebrar um
 * `.env.local` já existente, mas não aparece em nenhuma mensagem.
 */

// `server-only` é um marcador do Next que lança fora do runtime react-server;
// no vitest ele só atrapalharia o import do provider real.
vi.mock("server-only", () => ({}));

async function fabrica() {
  const { getKnowledgeProvider } = await import("./index");
  return getKnowledgeProvider;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getKnowledgeProvider", () => {
  it.each([
    ["ausente (em branco)", ""],
    ["só espaços", "   "],
    ["demo", "demo"],
  ])("%s: modo demo", async (_nome, valor) => {
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", valor);
    const { DemoProvider } = await import("./demo");
    expect((await fabrica())()).toBeInstanceOf(DemoProvider);
  });

  it("supabase: liga o provider real", async () => {
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "supabase");
    const real = await import("./megabrain");
    expect((await fabrica())()).toBeInstanceOf(real.MegabrainProvider);
  });

  it("o valor antigo do provider real continua aceito e dá no mesmo provider", async () => {
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "megabrain");
    const real = await import("./megabrain");
    expect((await fabrica())()).toBeInstanceOf(real.MegabrainProvider);
  });

  it.each([
    ["local", "local"],
    ["local com espaços em volta", "  local  "],
  ])("%s: liga o provider local (sem Supabase, sem Ollama)", async (_nome, valor) => {
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", valor);
    const { LocalProvider } = await import("./local");
    expect((await fabrica())()).toBeInstanceOf(LocalProvider);
  });

  it("valor inválido: a mensagem cita os valores divulgados e não o antigo nem o recebido", async () => {
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "valor-estranho");
    const get = await fabrica();
    expect(() => get()).toThrowError(/"demo" ou "supabase"/);
    expect(() => get()).toThrowError(/"local"/);
    try {
      get();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("megabrain");
      expect(msg).not.toContain("valor-estranho");
    }
  });
});
