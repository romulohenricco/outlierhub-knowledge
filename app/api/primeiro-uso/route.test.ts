import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * Rota do primeiro uso dentro de um Megabrain. GET só lê; o POST cria o card, aceita,
 * dispensa e reabre. Tudo numa árvore temporária que imita <Megabrain>/apps/<pasta>.
 */

let mb: string;
let app: string;
let GET: () => Promise<Response>;
let POST: (req: NextRequest) => Promise<Response>;

beforeEach(async () => {
  mb = await mkdtemp(path.join(tmpdir(), "primeiro-uso-"));
  app = path.join(mb, "apps", "knowledge");
  await mkdir(path.join(mb, "knowledge", "external"), { recursive: true });
  await mkdir(path.join(mb, "engine"), { recursive: true });
  await mkdir(app, { recursive: true });
  vi.stubEnv("BILHON_KANBAN_DIR", path.join(app, "data", "kanban"));
  vi.stubEnv("BILHON_MEGABRAIN_ROOT", "");
  vi.spyOn(process, "cwd").mockReturnValue(app);
  vi.resetModules();
  ({ GET, POST } = await import("./route"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(mb, { recursive: true, force: true });
});

const post = (corpo: unknown) =>
  POST(
    new NextRequest("http://127.0.0.1:3300/api/primeiro-uso", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );
const json = async (res: Response) => (await res.json()) as Record<string, any>;

describe("GET /api/primeiro-uso", () => {
  it("dentro de um Megabrain e sem resposta anterior: detectado, pendente, sem card ainda", async () => {
    const j = await json(await GET());
    expect(j.megabrain).toMatchObject({ detectado: true, estado: "pendente", cardId: null, pastaApp: "apps/knowledge" });
    expect(j.megabrain.sinais).toEqual(["knowledge", "engine"]);
    expect(j.megabrain.raiz).toBe(path.resolve(mb));
    expect(j.megabrain.inventario).toEqual([{ nome: "external", itens: 0 }]);
  });

  it("não escreve nada: só ler não cria card nem arquivo de estado", async () => {
    await GET();
    await expect(readFile(path.join(app, "data", "primeiro-uso.json"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(app, "data", "kanban", "board.json"), "utf8")).rejects.toThrow();
  });

  it("fora de um Megabrain: detectado=false e nada de caminho na resposta", async () => {
    const solto = await mkdtemp(path.join(tmpdir(), "solto-"));
    try {
      vi.spyOn(process, "cwd").mockReturnValue(solto);
      const j = await json(await GET());
      expect(j.megabrain).toEqual({ detectado: false, motivo: "fora-de-apps" });
    } finally {
      await rm(solto, { recursive: true, force: true });
    }
  });
});

describe("POST /api/primeiro-uso", () => {
  it("corpo inválido ou ação desconhecida: 400", async () => {
    for (const corpo of ["{ nao eh json", "null", { acao: 5 }, { acao: "apagar-tudo" }, {}]) {
      expect((await post(corpo)).status, JSON.stringify(corpo)).toBe(400);
    }
  });

  it("fora de um Megabrain: 409", async () => {
    const solto = await mkdtemp(path.join(tmpdir(), "solto-"));
    try {
      vi.spyOn(process, "cwd").mockReturnValue(solto);
      expect((await post({ acao: "preparar" })).status).toBe(409);
    } finally {
      await rm(solto, { recursive: true, force: true });
    }
  });

  it("preparar cria o primeiro card uma vez e mantém a pergunta pendente", async () => {
    const a = await json(await post({ acao: "preparar" }));
    expect(a).toMatchObject({ ok: true, megabrain: { estado: "pendente" } });
    expect(a.megabrain.cardId).toMatch(/^ING-1$/);
    expect(a.megabrain.coluna).toBe("todo");
    const b = await json(await post({ acao: "preparar" }));
    expect(b.megabrain.cardId).toBe(a.megabrain.cardId);

    const { getBoard } = await import("@/lib/kanban");
    expect((await getBoard()).cards).toHaveLength(1);
    expect((await json(await GET())).megabrain).toMatchObject({ estado: "pendente", cardId: a.megabrain.cardId });
  });

  it("aceitar move o card para DOING, devolve a tarefa e registra o aceite", async () => {
    const r = await json(await post({ acao: "aceitar" }));
    expect(r).toMatchObject({ ok: true, megabrain: { estado: "aceito" } });
    expect(r.megabrain.coluna).toBe("doing");
    expect(r.prompt).toContain("## Objetivo");
    expect(r.prompt).toContain("SOMENTE LEITURA");

    const { getBoard } = await import("@/lib/kanban");
    const card = (await getBoard()).cards.find((c) => c.id === r.megabrain.cardId);
    expect(card?.coluna).toBe("doing");
    const depois = (await json(await GET())).megabrain;
    expect(depois.estado).toBe("aceito");
    // respondida a pergunta, a rota (chamada em toda página) não lista mais o acervo
    expect(depois.inventario).toEqual([]);
  });

  it("aceitar com o card já fora de TO DO diz a coluna REAL, sem prometer DOING", async () => {
    const p = await json(await post({ acao: "preparar" }));
    const { moverCard } = await import("@/lib/kanban");
    await moverCard(p.megabrain.cardId, "cancel", 0);
    const r = await json(await post({ acao: "aceitar" }));
    expect(r.megabrain.coluna).toBe("cancel");
    expect(r.prompt).toContain("## Objetivo");
  });

  it("board corrompido: 503 com o código e o que fazer, igual às rotas do kanban", async () => {
    await mkdir(path.join(app, "data", "kanban"), { recursive: true });
    await writeFile(path.join(app, "data", "kanban", "board.json"), "{ isto nao eh json");
    const res = await post({ acao: "preparar" });
    expect(res.status).toBe(503);
    const j = await json(res);
    expect(j.codigo).toBe("board_corrompido");
    expect(j.erro).toMatch(/backups/);
    expect(JSON.stringify(j)).not.toContain(app);
  });

  it("dispensar guarda o 'agora não' e o card continua em TO DO; reabrir volta a perguntar", async () => {
    const p = await json(await post({ acao: "preparar" }));
    const d = await json(await post({ acao: "dispensar" }));
    expect(d.megabrain).toMatchObject({ estado: "dispensado", cardId: p.megabrain.cardId });

    const { getBoard } = await import("@/lib/kanban");
    expect((await getBoard()).cards.find((c) => c.id === p.megabrain.cardId)?.coluna).toBe("todo");

    expect((await json(await post({ acao: "reabrir" }))).megabrain.estado).toBe("pendente");
    expect((await json(await GET())).megabrain.estado).toBe("pendente");
  });

  it("aceitar duas vezes não cria um segundo card nem desfaz o andamento", async () => {
    const a = await json(await post({ acao: "aceitar" }));
    const b = await json(await post({ acao: "aceitar" }));
    expect(b.megabrain.cardId).toBe(a.megabrain.cardId);
    const { getBoard } = await import("@/lib/kanban");
    const cards = (await getBoard()).cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].coluna).toBe("doing");
  });

  it("se a pessoa apagou o card, aceitar cria a tarefa de novo (nunca fica sem prompt)", async () => {
    const p = await json(await post({ acao: "preparar" }));
    const { excluirCard, getBoard } = await import("@/lib/kanban");
    expect(await excluirCard(p.megabrain.cardId)).toBe(true);
    expect((await getBoard()).cards).toHaveLength(0);

    await post({ acao: "reabrir" });
    const r = await json(await post({ acao: "aceitar" }));
    expect(r.ok).toBe(true);
    expect(r.prompt).toContain("## Objetivo");
    expect(r.megabrain.cardId).not.toBe(p.megabrain.cardId);
    const cards = (await getBoard()).cards;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: r.megabrain.cardId, coluna: "doing" });
  });

  it("erro interno vira 500 genérico, sem caminho nem mensagem do disco", async () => {
    // o arquivo de estado é um DIRETÓRIO: a gravação falha com EISDIR/EEXIST
    await mkdir(path.join(app, "data", "primeiro-uso.json"), { recursive: true });
    const res = await post({ acao: "dispensar" });
    expect(res.status).toBe(500);
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain(app);
    expect(texto).not.toMatch(/EISDIR|EEXIST|ENOENT|EPERM/);
  });
});
