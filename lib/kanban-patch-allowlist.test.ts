/**
 * Allowlist literal de campos no PATCH de card.
 *
 * Um teste por vetor de mass assignment, mais o caminho feliz e o
 * caminho de movimentação. Hermético: BILHON_KANBAN_DIR em tmpdir.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { KanbanBoard } from "./types";

const raiz = mkdtempSync(path.join(tmpdir(), "kanban-allow-"));
process.env.BILHON_KANBAN_DIR = raiz;

const BOARD = path.join(raiz, "board.json");

type Kanban = typeof import("./kanban");
type RotaCard = typeof import("../app/api/kanban/[id]/route");
let kanban: Kanban;
let rota: RotaCard;

beforeAll(async () => {
  kanban = await import("./kanban");
  rota = await import("../app/api/kanban/[id]/route");
});
afterAll(async () => {
  await rm(raiz, { recursive: true, force: true });
  delete process.env.BILHON_KANBAN_DIR;
});

const CRIADO = "2026-07-01T00:00:00.000Z";

function cardFake(id: string, coluna = "todo") {
  return {
    id,
    titulo: `card ${id}`,
    descricao: "descrição original",
    tipo: "ingest",
    prioridade: "media",
    projeto: "geral",
    coluna,
    ordem: 0,
    responsavel: null,
    tags: ["original"],
    origem: { canal: "kanban", pedidoOriginal: "pedido original", solicitadoPor: "quem pediu" },
    ingestao: { fonteTipo: ["livro"], fonteUrl: [], fontePath: [], bucket: "business", pessoaAutor: null },
    links: [],
    vinculos: [],
    audios: [],
    imagens: [],
    checklist: [],
    historico: [{ de: null, para: coluna, em: CRIADO }],
    execucao: { modo: "agente" },
    criadoEm: CRIADO,
    atualizadoEm: CRIADO,
    concluidoEm: null,
  };
}

function boardFake() {
  return {
    atualizadoEm: CRIADO,
    colunas: [
      { id: "todo", rotulo: "TO DO" },
      { id: "doing", rotulo: "DOING" },
      { id: "done", rotulo: "DONE" },
      { id: "cancel", rotulo: "CANCEL" },
    ],
    wipLimites: { doing: 1 },
    contadores: { ingest: 2, clone: 0, autolearning: 0, feature: 0, melhoria: 0, bug: 0, infra: 0, outro: 0 },
    cards: [cardFake("ING-1"), cardFake("ING-2", "doing")],
  };
}

async function lerDoDisco(): Promise<KanbanBoard> {
  return JSON.parse(await readFile(BOARD, "utf-8")) as KanbanBoard;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function patchNaRota(id: string, corpo: unknown) {
  const req = new Request(`http://x/api/kanban/${id}`, {
    method: "PATCH",
    body: JSON.stringify(corpo),
  }) as unknown as Parameters<RotaCard["PATCH"]>[0];
  const res = await rota.PATCH(req, ctx(id));
  return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  await rm(path.join(raiz, "backups"), { recursive: true, force: true });
  await writeFile(BOARD, JSON.stringify(boardFake()));
});

describe("campos fora da allowlist são recusados", () => {
  const vetores: Array<{ nome: string; corpo: Record<string, unknown> }> = [
    { nome: "coluna sem index (contornaria moverCard)", corpo: { coluna: "done" } },
    { nome: "id (duplicaria identificador e sequestraria a mídia)", corpo: { id: "OUTRO-1" } },
    { nome: "criadoEm", corpo: { criadoEm: "1970-01-01T00:00:00.000Z" } },
    { nome: "atualizadoEm", corpo: { atualizadoEm: "1970-01-01T00:00:00.000Z" } },
    { nome: "concluidoEm", corpo: { concluidoEm: null } },
    { nome: "ordem", corpo: { ordem: -1 } },
    { nome: "audios (só as rotas de mídia)", corpo: { audios: [] } },
    { nome: "imagens (só as rotas de mídia)", corpo: { imagens: [] } },
    { nome: "campo inexistente", corpo: { inventado: 1 } },
  ];

  for (const { nome, corpo } of vetores) {
    it(`400 em ${nome}`, async () => {
      const r = await kanban.atualizarCard("ING-1", corpo);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toBe("campos-invalidos");
      expect(r.erro).toContain(Object.keys(corpo)[0]);

      const naRota = await patchNaRota("ING-1", corpo);
      expect(naRota.status).toBe(400);
      expect(naRota.corpo.erro).toContain(Object.keys(corpo)[0]);
    });
  }

  it("coluna sem index responde 400 e a coluna no disco não muda", async () => {
    const naRota = await patchNaRota("ING-1", { coluna: "done" });
    expect(naRota.status).toBe(400);
    expect(String(naRota.corpo.erro)).toContain("mover exige {coluna, index}");
    const board = await lerDoDisco();
    expect(board.cards.find((c) => c.id === "ING-1")?.coluna).toBe("todo");
  });

  it("id não editável — nenhum id duplicado no board", async () => {
    await patchNaRota("ING-1", { id: "ING-2" });
    const board = await lerDoDisco();
    expect(board.cards.map((c) => c.id)).toEqual(["ING-1", "ING-2"]);
  });

  it("criadoEm e ordem seguem intactos no disco depois da tentativa", async () => {
    await patchNaRota("ING-1", { criadoEm: "1970-01-01T00:00:00.000Z" });
    await patchNaRota("ING-1", { ordem: -1 });
    const card = (await lerDoDisco()).cards.find((c) => c.id === "ING-1");
    expect(card?.criadoEm).toBe(CRIADO);
    expect(card?.ordem).toBe(0);
  });

  it("__proto__ é recusado e não polui Object.prototype", async () => {
    const r = await patchNaRota("ING-1", JSON.parse('{"__proto__":{"poluido":true}}'));
    expect(r.status).toBe(400);
    expect((Object.prototype as Record<string, unknown>).poluido).toBeUndefined();
    expect(({} as Record<string, unknown>).poluido).toBeUndefined();
  });

  it("constructor também é chave desconhecida (não é atalho pro prototype)", async () => {
    const r = await kanban.atualizarCard("ING-1", JSON.parse('{"constructor":{"x":1}}'));
    expect(r.ok).toBe(false);
  });

  it("corpo que não é objeto é recusado sem tocar no disco", async () => {
    for (const corpo of [null, 42, "titulo", [1, 2]]) {
      const r = await kanban.atualizarCard("ING-1", corpo);
      expect(r.ok).toBe(false);
    }
    expect((await lerDoDisco()).cards[0].atualizadoEm).toBe(CRIADO);
  });

  it("recusa lista TODAS as chaves não editáveis de uma vez", async () => {
    const r = await kanban.atualizarCard("ING-1", { id: "X", ordem: 3, historico: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("id");
    expect(r.erro).toContain("ordem");
    // historico é ignorável, não entra na lista de recusadas
    expect(r.erro).not.toContain("historico");
  });
});

describe("checagem de forma dos campos editáveis", () => {
  const formasInvalidas: Array<[string, Record<string, unknown>]> = [
    ["titulo vazio", { titulo: "   " }],
    ["titulo não texto", { titulo: 42 }],
    ["descricao não texto", { descricao: { a: 1 } }],
    ["tipo fora do enum", { tipo: "inventado" }],
    ["tipo herdado do prototype", { tipo: "toString" }],
    ["prioridade fora do enum", { prioridade: "altissima" }],
    ["projeto fora do enum", { projeto: "outro-repo" }],
    ["tags não array de texto", { tags: ["ok", 3] }],
    ["tags string", { tags: "a,b" }],
    ["checklist item sem feito", { checklist: [{ texto: "x" }] }],
    ["execucao com modo inválido", { execucao: { modo: "robo" } }],
    ["execucao pctAgente fora de 0-100", { execucao: { modo: "misto", pctAgente: 500 } }],
    ["origem não objeto", { origem: [] }],
    ["origem.canal numérico", { origem: { canal: 7 } }],
    ["ingestao.fonteTipo não array", { ingestao: { fonteTipo: "livro" } }],
    ["links sem url", { links: [{ tipo: "github" }] }],
    ["vinculos sem titulo", { vinculos: [{ tipo: "livro", id: "L1" }] }],
  ];

  for (const [nome, corpo] of formasInvalidas) {
    it(`400 em ${nome}`, async () => {
      const r = await kanban.atualizarCard("ING-1", corpo);
      expect(r.ok).toBe(false);
      expect((await lerDoDisco()).cards[0].atualizadoEm).toBe(CRIADO);
    });
  }
});

describe("caminho feliz e caminhos derivados", () => {
  it("edição completa pela UI continua funcionando", async () => {
    // mesmo corpo que components/Kanban.tsx monta ao salvar (inclui historico)
    const corpo = {
      titulo: "novo título",
      tipo: "melhoria",
      descricao: "nova descrição",
      prioridade: "alta",
      projeto: "outro",
      responsavel: "alguém",
      tags: ["a", "b"],
      origem: { canal: "terminal", pedidoOriginal: "outro pedido", solicitadoPor: "outra pessoa" },
      ingestao: { fonteTipo: ["video"], fonteUrl: ["https://exemplo/x"], fontePath: [], bucket: "external", pessoaAutor: "autor" },
      links: [{ tipo: "github", url: "https://exemplo/commit", repo: "meu-repo" }],
      vinculos: [{ tipo: "livro", id: "L-1", titulo: "um livro", linkLocal: null }],
      checklist: [{ texto: "passo", feito: true }],
      execucao: { modo: "misto", pctAgente: 60 },
      historico: [{ de: null, para: "todo", em: CRIADO }],
    };
    const naRota = await patchNaRota("ING-1", corpo);
    expect(naRota.status).toBe(200);

    const card = (await lerDoDisco()).cards.find((c) => c.id === "ING-1");
    expect(card).toMatchObject({
      titulo: "novo título",
      tipo: "melhoria",
      descricao: "nova descrição",
      prioridade: "alta",
      projeto: "outro",
      responsavel: "alguém",
      tags: ["a", "b"],
      // a DoD do tipo é acrescentada pelo servidor (garantirDoD): o item enviado
      // precisa estar no checklist, mas não é mais o único
      checklist: expect.arrayContaining([{ texto: "passo", feito: true }]),
      execucao: { modo: "misto", pctAgente: 60 },
    });
    expect(card?.links).toEqual([{ tipo: "github", url: "https://exemplo/commit", repo: "meu-repo" }]);
    expect(card?.origem.canal).toBe("terminal");
    expect(card?.ingestao.fonteTipo).toEqual(["video"]);
    // servidor é quem escreve atualizadoEm
    expect(card?.atualizadoEm).not.toBe(CRIADO);
  });

  // A UI tem editor de `nota`/`links` por linha do histórico (Kanban.tsx:1893) e
  // o tipo declara essa evidência como editável: descartar em silêncio apagaria a
  // anotação do operador sem avisar. O que é imutável é a TRANSIÇÃO.
  it("evidência do histórico (nota/links) é aplicada", async () => {
    const atual = (await lerDoDisco()).cards.find((c) => c.id === "ING-1")!.historico;
    const r = await patchNaRota("ING-1", {
      titulo: "só o título",
      historico: [{ ...atual[0], nota: "nota de teste", links: [{ tipo: "log", url: "https://exemplo.invalid/x.md" }] }],
    });
    expect(r.status).toBe(200);
    const card = (await lerDoDisco()).cards.find((c) => c.id === "ING-1");
    expect(card?.titulo).toBe("só o título");
    expect(card?.historico[0].nota).toBe("nota de teste");
    expect(card?.historico[0].links).toEqual([{ tipo: "log", url: "https://exemplo.invalid/x.md" }]);
    // a transição em si segue exatamente como o servidor gravou
    expect(card?.historico[0].de).toBeNull();
    expect(card?.historico[0].para).toBe("todo");
    expect(card?.historico[0].em).toBe(CRIADO);
  });

  it("transição do histórico é imutável — forjar `para` dá 400", async () => {
    const atual = (await lerDoDisco()).cards.find((c) => c.id === "ING-1")!.historico;
    const r = await patchNaRota("ING-1", { historico: [{ ...atual[0], para: "done" }] });
    expect(r.status).toBe(400);
    const card = (await lerDoDisco()).cards.find((c) => c.id === "ING-1");
    expect(card?.historico[0].para).toBe("todo");
  });

  it("PATCH não cria nem remove transição (array de tamanho diferente dá 400)", async () => {
    const vazio = await patchNaRota("ING-1", { historico: [] });
    expect(vazio.status).toBe(400);
    const extra = await patchNaRota("ING-1", {
      historico: [
        { de: null, para: "todo", em: CRIADO },
        { de: "todo", para: "done", em: "1970-01-01T00:00:00.000Z" },
      ],
    });
    expect(extra.status).toBe(400);
    const card = (await lerDoDisco()).cards.find((c) => c.id === "ING-1");
    expect(card?.historico).toHaveLength(1);
  });

  it("origem e ingestao são mesclados campo a campo com o valor atual", async () => {
    await kanban.atualizarCard("ING-1", { origem: { canal: "chat" }, ingestao: { bucket: "personal" } });
    const card = (await lerDoDisco()).cards.find((c) => c.id === "ING-1");
    expect(card?.origem).toEqual({ canal: "chat", pedidoOriginal: "pedido original", solicitadoPor: "quem pediu" });
    expect(card?.ingestao.bucket).toBe("personal");
    expect(card?.ingestao.fonteTipo).toEqual(["livro"]);
  });

  it("patch vazio é aceito e só atualiza atualizadoEm", async () => {
    const r = await kanban.atualizarCard("ING-1", {});
    expect(r.ok).toBe(true);
    const card = (await lerDoDisco()).cards.find((c) => c.id === "ING-1");
    expect(card?.titulo).toBe("card ING-1");
    expect(card?.atualizadoEm).not.toBe(CRIADO);
  });

  it("404 (não 400) para ticket inexistente com patch válido", async () => {
    const r = await patchNaRota("ING-99", { titulo: "x" });
    expect(r.status).toBe(404);
    expect(r.corpo.erro).toBe("ticket não encontrado");
  });

  it("{coluna,index} continua indo por moverCard — historico escrito pelo servidor", async () => {
    const r = await patchNaRota("ING-1", { coluna: "doing", index: 0 });
    expect(r.status).toBe(200);
    const card = (await lerDoDisco()).cards.find((c) => c.id === "ING-1");
    expect(card?.coluna).toBe("doing");
    expect(card?.historico).toHaveLength(2);
    expect(card?.historico[1]).toMatchObject({ de: "todo", para: "doing" });
  });

  it("mover pra coluna anterior continua recusado (status não volta)", async () => {
    const r = await patchNaRota("ING-2", { coluna: "todo", index: 0 });
    expect(r.status).toBe(409);
    expect(r.corpo.erro).toBe("status não volta — só avança ou fica parado");
    expect((await lerDoDisco()).cards.find((c) => c.id === "ING-2")?.coluna).toBe("doing");
  });

  it("index fracionário não é movimentação — cai na allowlist e vira 400", async () => {
    const r = await patchNaRota("ING-1", { coluna: "done", index: 1.5 });
    expect(r.status).toBe(400);
    expect((await lerDoDisco()).cards.find((c) => c.id === "ING-1")?.coluna).toBe("todo");
  });
});
