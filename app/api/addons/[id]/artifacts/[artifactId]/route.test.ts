import { describe, it, expect, vi } from "vitest";

/**
 * O artefato vem de material do usuário (data/addons): a resposta é texto inerte e o
 * cache é privado, como nas demais rotas de arquivo. `public` deixaria um cache
 * intermediário (túnel, proxy) servir o conteúdo sem passar pelo controle de acesso.
 */

vi.mock("@/lib/addons", () => ({
  lerArtefatoAddon: async (addonId: string, artefatoId: string) =>
    addonId === "a" && artefatoId === "b" ? "conteúdo do artefato" : null,
}));

const chamar = async (id: string, artifactId: string) => {
  const { GET } = await import("./route");
  return GET(new Request("http://127.0.0.1:3300/x"), { params: Promise.resolve({ id, artifactId }) });
};

describe("GET /api/addons/[id]/artifacts/[artifactId]", () => {
  it("devolve texto inerte com cache privado", async () => {
    const res = await chamar("a", "b");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("conteúdo do artefato");
  });

  it("artefato inexistente: 404 sem cabeçalho de cache público", async () => {
    const res = await chamar("a", "outro");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control") ?? "").not.toContain("public");
  });
});
