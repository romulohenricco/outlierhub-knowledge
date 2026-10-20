import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** A UI só mostra o botão "escalar" quando este endpoint diz que há executor. */

let GET: () => Promise<Response>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("BILHON_EXECUTION_PATH", "");
  ({ GET } = await import("./route"));
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/kanban/execucao", () => {
  it("com executor configurado: escalar = true, sem expor o endereço", async () => {
    vi.stubEnv("BILHON_EXECUTION_URL", "http://127.0.0.1:4411");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ escalar: true });
  });

  it.each([
    ["em branco", ""],
    ["só espaços", "  "],
    ["inválida", "ftp://127.0.0.1"],
  ])("URL %s: escalar = false", async (_nome, valor) => {
    vi.stubEnv("BILHON_EXECUTION_URL", valor);
    expect(await (await GET()).json()).toEqual({ escalar: false });
  });
});
