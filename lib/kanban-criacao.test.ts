import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * Criação de ticket com a mesma disciplina do PATCH. Antes, o POST gravava o corpo
 * cru: `tags` como texto ou `vinculos` como texto eram persistidos e a tela do board
 * quebrava a cada abertura (`tags.slice(...).map`), coluna inexistente criava um card
 * invisível e link com `javascript:` virava `href`.
 */

let dir: string;
let K: typeof import("./kanban");
let POST: (req: NextRequest) => Promise<Response>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kanban-criacao-"));
  vi.stubEnv("BILHON_KANBAN_DIR", dir);
  vi.stubEnv("NEXT_PUBLIC_KANBAN_PROJETOS", "site,api");
  vi.resetModules();
  K = await import("./kanban");
  ({ POST } = await import("../app/api/kanban/route"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const base = { titulo: "um ticket", tipo: "bug" as const };
const post = (corpo: unknown) =>
  POST(new NextRequest("http://127.0.0.1:3300/api/kanban", { method: "POST", body: JSON.stringify(corpo) }));

const INVALIDOS: [string, Record<string, unknown>][] = [
  ["tags como texto", { tags: "abc" }],
  ["tags com item que não é texto", { tags: ["ok", 1] }],
  ["vinculos como texto", { vinculos: "x" }],
  ["vinculo sem titulo", { vinculos: [{ tipo: "livro", id: "x" }] }],
  ["links como texto", { links: "https://exemplo.invalid" }],
  ["link com esquema javascript", { links: [{ tipo: "outro", url: "javascript:alert(1)" }] }],
  ["link que é caminho de arquivo", { links: [{ tipo: "output", url: "C:\\pasta\\arquivo.md" }] }],
  ["link sem url", { links: [{ tipo: "outro" }] }],
  ["checklist como texto", { checklist: "x" }],
  ["item de checklist sem feito", { checklist: [{ texto: "x" }] }],
  ["coluna que não existe no board", { coluna: "nao-existe" }],
  ["coluna que não é texto", { coluna: 1 }],
  ["projeto fora da lista", { projeto: "outro-projeto" }],
  ["prioridade desconhecida", { prioridade: "maxima" }],
  ["execucao com modo desconhecido", { execucao: { modo: "x" } }],
  ["campo que o servidor define", { id: "BUG-99" }],
  ["historico enviado pelo cliente", { historico: [] }],
];

describe("criarCard recusa o corpo inválido, sem gravar nada", () => {
  it.each(INVALIDOS)("%s", async (_nome, extra) => {
    await expect(K.criarCard({ ...base, ...extra } as never)).rejects.toBeInstanceOf(K.CardInvalidoError);
    expect((await K.getBoard()).cards).toEqual([]);
  });

  it.each([
    ["título que não é texto", { titulo: 5, tipo: "bug" }],
    ["título só com espaços", { titulo: "   ", tipo: "bug" }],
    ["tipo herdado do protótipo", { titulo: "x", tipo: "constructor" }],
    ["tipo desconhecido", { titulo: "x", tipo: "nada" }],
    ["corpo que não é objeto", ["x"]],
  ])("%s", async (_nome, corpo) => {
    await expect(K.criarCard(corpo as never)).rejects.toBeInstanceOf(K.CardInvalidoError);
    expect((await K.getBoard()).cards).toEqual([]);
  });

  it("a mensagem diz o que corrigir", async () => {
    await expect(K.criarCard({ ...base, tags: "abc" } as never)).rejects.toThrow(/tags precisa ser array de texto/);
    await expect(K.criarCard({ ...base, coluna: "nao-existe" } as never)).rejects.toThrow(/coluna precisa ser uma de: .*todo/);
  });
});

describe("criarCard aceita o corpo válido e guarda só o que conhece", () => {
  it("campos completos, link http(s), coluna existente", async () => {
    const card = await K.criarCard({
      ...base,
      descricao: "texto",
      prioridade: "alta",
      projeto: "api",
      coluna: "doing",
      tags: ["a", "b"],
      links: [{ tipo: "github", url: "https://exemplo.invalid/c", repo: "r" }],
      vinculos: [{ tipo: "livro", id: "x", titulo: "Livro X", linkLocal: null }],
      checklist: [{ texto: "passo", feito: false }],
      execucao: { modo: "humano" },
    });
    expect(card.coluna).toBe("doing");
    expect(card.tags).toEqual(["a", "b"]);
    expect(card.links).toEqual([{ tipo: "github", url: "https://exemplo.invalid/c", repo: "r" }]);
    expect(card.vinculos).toEqual([{ tipo: "livro", id: "x", titulo: "Livro X", linkLocal: null }]);
    expect(card.execucao).toEqual({ modo: "humano" });
  });

  it("coluna done continua valendo (importação de ticket já fechado)", async () => {
    expect((await K.criarCard({ ...base, coluna: "done" })).coluna).toBe("done");
  });

  it("chave extra dentro de origem é descartada, não gravada", async () => {
    const card = await K.criarCard({ ...base, origem: { canal: "cli", intruso: 1 } as never });
    expect(card.origem).toEqual({ canal: "cli", pedidoOriginal: null, solicitadoPor: null });
  });
});

describe("POST /api/kanban", () => {
  it("corpo inválido: 400 com a mensagem do campo, e o board continua vazio", async () => {
    const res = await post({ ...base, tags: "abc" });
    expect(res.status).toBe(400);
    expect((await res.json()).erro).toContain("tags");
    expect((await K.getBoard()).cards).toEqual([]);
  });

  it.each([
    ["título numérico", { titulo: 5, tipo: "bug" }],
    ["corpo em lista", [1, 2]],
    ["corpo nulo", null],
    ["tipo numérico", { titulo: "x", tipo: 1 }],
  ])("%s: 400, nunca 500", async (_nome, corpo) => {
    expect((await post(corpo)).status).toBe(400);
  });

  it("corpo válido: 201 e o card aparece no board", async () => {
    const res = await post({ ...base, tags: ["a"] });
    expect(res.status).toBe(201);
    const card = await res.json();
    expect((await K.getBoard()).cards.map((c) => c.id)).toEqual([card.id]);
  });
});
