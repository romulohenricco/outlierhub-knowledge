import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rota de busca só aceita uma consulta em texto: corpo ausente, `null`, de outro tipo ou
 * com `query` que não é string é erro do CLIENTE (400), nunca um 500 do servidor.
 */

// o provider importa "server-only", que só vale dentro do Next (os outros testes do provider fazem o mesmo)
vi.mock("server-only", () => ({}));

let POST: (req: Request) => Promise<Response>;

beforeEach(async () => {
  vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", ""); // em branco = modo demo, sem rede
  vi.resetModules();
  ({ POST } = await import("./route"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const chamar = (corpo: string | undefined) =>
  POST(new Request("http://127.0.0.1:3300/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: corpo }));

describe("POST /api/search", () => {
  it("corpo ausente, inválido, null ou de tipo errado: 400 query-vazia", async () => {
    for (const corpo of [undefined, "{ nao eh json", "null", "5", "[]", '{"query":5}', '{"query":null}', '{"query":"   "}', "{}"]) {
      const res = await chamar(corpo);
      expect(res.status, String(corpo)).toBe(400);
      expect((await res.json()).erro).toBe("query-vazia");
    }
  });

  it("consulta em texto devolve resultados do modo demo", async () => {
    const res = await chamar(JSON.stringify({ query: "conhecimento" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.hits.map((h: { livroId: string }) => h.livroId)).toContain("guia-knowledge");
  });
});
