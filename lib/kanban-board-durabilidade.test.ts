/**
 * board.json à prova de perda.
 *
 * Hermético: BILHON_KANBAN_DIR aponta pra tmpdir antes de importar lib/kanban
 * (KANBAN_DIR é const de módulo), então nenhum teste toca o board real.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const raiz = mkdtempSync(path.join(tmpdir(), "kanban-durab-"));
process.env.BILHON_KANBAN_DIR = raiz;

const BOARD = path.join(raiz, "board.json");
const BACKUPS = path.join(raiz, "backups");

type Kanban = typeof import("./kanban");
type RotaCard = typeof import("../app/api/kanban/[id]/route");
type RotaBoard = typeof import("../app/api/kanban/route");
let kanban: Kanban;
let rotaCard: RotaCard;
let rotaBoard: RotaBoard;

beforeAll(async () => {
  kanban = await import("./kanban");
  rotaCard = await import("../app/api/kanban/[id]/route");
  rotaBoard = await import("../app/api/kanban/route");
});
afterAll(async () => {
  await rm(raiz, { recursive: true, force: true });
  delete process.env.BILHON_KANBAN_DIR;
});

function cardFake(id: string) {
  return {
    id,
    titulo: `card ${id}`,
    descricao: "",
    tipo: "ingest",
    prioridade: "media",
    projeto: "geral",
    coluna: "todo",
    ordem: 0,
    responsavel: null,
    tags: [],
    origem: { canal: null, pedidoOriginal: null, solicitadoPor: null },
    ingestao: { fonteTipo: [], fonteUrl: [], fontePath: [], bucket: null, pessoaAutor: null },
    links: [],
    vinculos: [],
    audios: [],
    imagens: [],
    checklist: [],
    historico: [{ de: null, para: "todo", em: "2026-07-01T00:00:00.000Z" }],
    execucao: { modo: "agente" },
    criadoEm: "2026-07-01T00:00:00.000Z",
    atualizadoEm: "2026-07-01T00:00:00.000Z",
    concluidoEm: null,
  };
}

function boardFake(ids: string[]) {
  return {
    atualizadoEm: "2026-07-01T00:00:00.000Z",
    colunas: [
      { id: "todo", rotulo: "TO DO" },
      { id: "doing", rotulo: "DOING" },
      { id: "done", rotulo: "DONE" },
      { id: "cancel", rotulo: "CANCEL" },
    ],
    wipLimites: { doing: 1 },
    contadores: { ingest: ids.length, clone: 0, autolearning: 0, feature: 0, melhoria: 0, bug: 0, infra: 0, outro: 0 },
    cards: ids.map(cardFake),
  };
}

async function sha(p: string): Promise<string> {
  return createHash("sha256").update(await readFile(p)).digest("hex");
}

const hoje = (() => {
  const d = new Date();
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}`;
})();

beforeEach(async () => {
  await rm(BACKUPS, { recursive: true, force: true });
  await rm(BOARD, { force: true });
});

describe("fail-loud na leitura do board", () => {
  it("board ausente (ENOENT) continua sendo board vazio, sem erro", async () => {
    const board = await kanban.getBoard();
    expect(board.cards).toEqual([]);
    expect(board.colunas.map((c) => c.id)).toEqual(["todo", "doing", "done", "cancel"]);
  });

  it("JSON truncado faz getBoard LANÇAR em vez de devolver board vazio", async () => {
    await writeFile(BOARD, JSON.stringify(boardFake(["ING-1", "ING-2"])).slice(0, 120));
    await expect(kanban.getBoard()).rejects.toBeInstanceOf(kanban.BoardCorrompidoError);
    await expect(kanban.getBoard()).rejects.toThrow(/restaure a partir de/);
  });

  it("board com JSON válido mas que não é objeto também é corrupção", async () => {
    await writeFile(BOARD, "[1,2,3]");
    await expect(kanban.getBoard()).rejects.toBeInstanceOf(kanban.BoardCorrompidoError);
  });

  it("com board truncado, atualizarCard lança e o arquivo fica byte-idêntico", async () => {
    await writeFile(BOARD, JSON.stringify(boardFake(["ING-1"])).slice(0, 200));
    const antes = await sha(BOARD);
    await expect(kanban.atualizarCard("ING-1", { titulo: "nao deve gravar" })).rejects.toBeInstanceOf(
      kanban.BoardCorrompidoError,
    );
    expect(await sha(BOARD)).toBe(antes);
    // nenhum resto de escrita atômica no diretório
    expect((await readdir(raiz)).filter((f) => f.startsWith("board.json.tmp-"))).toEqual([]);
  });

  it("com board truncado, moverCard e excluirCard também não sobrescrevem", async () => {
    await writeFile(BOARD, "{ \"cards\": [ {");
    const antes = await sha(BOARD);
    await expect(kanban.moverCard("ING-1", "doing", 0)).rejects.toBeInstanceOf(kanban.BoardCorrompidoError);
    await expect(kanban.excluirCard("ING-1")).rejects.toBeInstanceOf(kanban.BoardCorrompidoError);
    await expect(kanban.criarCard({ titulo: "x", tipo: "ingest" })).rejects.toBeInstanceOf(
      kanban.BoardCorrompidoError,
    );
    expect(await sha(BOARD)).toBe(antes);
  });

  it("log de corrupção sai estruturado, sem conteúdo do arquivo nem caminho completo", async () => {
    const segredoNoArquivo = "TOKEN_FICTICIO_DO_TESTE";
    await writeFile(BOARD, `{ "cards": [ "${segredoNoArquivo}"`);
    const linhas: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => linhas.push(args.map(String).join(" "));
    try {
      await expect(kanban.getBoard()).rejects.toBeInstanceOf(kanban.BoardCorrompidoError);
    } finally {
      console.error = original;
    }
    expect(linhas).toHaveLength(1);
    const log = JSON.parse(linhas[0]) as Record<string, unknown>;
    expect(log.evento).toBe("board_corrompido");
    expect(log.arquivo).toBe("board.json");
    expect(log.erro).toBe("SyntaxError");
    expect(linhas[0]).not.toContain(segredoNoArquivo);
    expect(linhas[0]).not.toContain(raiz);
  });
});

describe("tradução para 503 nas rotas", () => {
  it("PATCH com board truncado responde 503 acionável e o arquivo fica byte-idêntico", async () => {
    await writeFile(BOARD, JSON.stringify(boardFake(["ING-1"])).slice(0, 200));
    const antes = await sha(BOARD);

    const req = new Request("http://x/api/kanban/ING-1", {
      method: "PATCH",
      body: JSON.stringify({ titulo: "nao deve gravar" }),
    }) as unknown as Parameters<RotaCard["PATCH"]>[0];
    const res = await rotaCard.PATCH(req, { params: Promise.resolve({ id: "ING-1" }) });

    expect(res.status).toBe(503); // infra recuperável, não 500 mudo
    const corpo = (await res.json()) as Record<string, unknown>;
    expect(corpo.codigo).toBe("board_corrompido");
    expect(String(corpo.erro)).toContain("data/kanban/backups/");
    expect(await sha(BOARD)).toBe(antes);
  });

  it("503 também em GET do board, DELETE de card e movimentação", async () => {
    await writeFile(BOARD, "{ truncado");
    const antes = await sha(BOARD);
    const ctx = { params: Promise.resolve({ id: "ING-1" }) };

    expect((await rotaBoard.GET()).status).toBe(503);
    expect(
      (
        await rotaCard.DELETE(
          new Request("http://x", { method: "DELETE" }) as unknown as Parameters<RotaCard["DELETE"]>[0],
          ctx,
        )
      ).status,
    ).toBe(503);
    const mover = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ coluna: "doing", index: 0 }),
    }) as unknown as Parameters<RotaCard["PATCH"]>[0];
    expect((await rotaCard.PATCH(mover, { params: Promise.resolve({ id: "ING-1" }) })).status).toBe(503);

    expect(await sha(BOARD)).toBe(antes);
  });
});

describe("snapshot rotativo antes da sobrescrita", () => {
  it("primeira mutação do dia grava o conteúdo ANTERIOR em backups/board-YYYYMMDD.json", async () => {
    const original = JSON.stringify(boardFake(["ING-1"]));
    await writeFile(BOARD, original);

    const r = await kanban.atualizarCard("ING-1", { titulo: "depois da mutação" });
    expect(r.ok).toBe(true);

    const snapshot = path.join(BACKUPS, `board-${hoje}.json`);
    expect(await readFile(snapshot, "utf-8")).toBe(original);
    // e o board novo já é o mutado
    const board = await kanban.getBoard();
    expect(board.cards[0].titulo).toBe("depois da mutação");
  });

  it("segunda mutação no mesmo dia não cria um segundo snapshot", async () => {
    const original = JSON.stringify(boardFake(["ING-1"]));
    await writeFile(BOARD, original);

    await kanban.atualizarCard("ING-1", { titulo: "primeira" });
    await kanban.atualizarCard("ING-1", { titulo: "segunda" });

    expect(await readdir(BACKUPS)).toEqual([`board-${hoje}.json`]);
    // o snapshot continua sendo o estado bom conhecido do início do dia
    expect(await readFile(path.join(BACKUPS, `board-${hoje}.json`), "utf-8")).toBe(original);
  });

  it("retenção de 14 — o 15º snapshot poda os mais antigos", async () => {
    await writeFile(BOARD, JSON.stringify(boardFake(["ING-1"])));
    await mkdir(BACKUPS, { recursive: true });
    const antigos: string[] = [];
    for (let d = 1; d <= 20; d++) {
      const nome = `board-202601${String(d).padStart(2, "0")}.json`;
      antigos.push(nome);
      await writeFile(path.join(BACKUPS, nome), "{}");
    }

    await kanban.atualizarCard("ING-1", { titulo: "dispara o snapshot do dia" });

    const restantes = (await readdir(BACKUPS)).sort();
    expect(restantes).toHaveLength(14);
    expect(restantes).toContain(`board-${hoje}.json`);
    // podou os mais antigos, preservou os mais recentes
    expect(restantes).not.toContain(antigos[0]);
    expect(restantes).toContain(antigos[antigos.length - 1]);
  });

  it("uma mutação posterior também poda excesso se o snapshot do dia já existe", async () => {
    await writeFile(BOARD, JSON.stringify(boardFake(["ING-1"])));
    await mkdir(BACKUPS, { recursive: true });
    await writeFile(path.join(BACKUPS, `board-${hoje}.json`), "estado bom do dia");
    for (let d = 1; d <= 20; d++) {
      const nome = `board-202601${String(d).padStart(2, "0")}.json`;
      await writeFile(path.join(BACKUPS, nome), "{}");
    }

    await kanban.atualizarCard("ING-1", { titulo: "poda mesmo sem novo snapshot" });

    const restantes = (await readdir(BACKUPS)).sort();
    expect(restantes).toHaveLength(14);
    expect(restantes).toContain(`board-${hoje}.json`);
  });

  it("arquivo estranho na pasta de backups não é podado nem confundido com snapshot", async () => {
    await writeFile(BOARD, JSON.stringify(boardFake(["ING-1"])));
    await mkdir(BACKUPS, { recursive: true });
    await writeFile(path.join(BACKUPS, "LEIA-ME.txt"), "restauração manual");

    await kanban.atualizarCard("ING-1", { titulo: "x" });

    expect((await readdir(BACKUPS)).sort()).toEqual(["LEIA-ME.txt", `board-${hoje}.json`]);
  });
});
