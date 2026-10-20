/**
 * Path traversal de mídia fechado na origem (cardId).
 *
 * Cobre os dois helpers e as 6 rotas de mídia. O lado de ESCRITA é provado aqui,
 * com BILHON_KANBAN_DIR em tmpdir — nunca contra o disco real.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// a raiz do tmpdir fica um nível acima de KANBAN_DIR: se um traversal escapar,
// o arquivo/dir aparece aqui e o teste vê
const sandbox = mkdtempSync(path.join(tmpdir(), "kanban-paths-"));
const raiz = path.join(sandbox, "kanban");
process.env.BILHON_KANBAN_DIR = raiz;

const BOARD = path.join(raiz, "board.json");

type Kanban = typeof import("./kanban");
type RotaImagem = typeof import("../app/api/kanban/[id]/imagem/route");
type RotaImagemArquivo = typeof import("../app/api/kanban/[id]/imagem/[arquivo]/route");
type RotaAudio = typeof import("../app/api/kanban/[id]/audio/route");
type RotaAudioArquivo = typeof import("../app/api/kanban/[id]/audio/[arquivo]/route");

let kanban: Kanban;
let rotaImagem: RotaImagem;
let rotaImagemArquivo: RotaImagemArquivo;
let rotaAudio: RotaAudio;
let rotaAudioArquivo: RotaAudioArquivo;

beforeAll(async () => {
  await mkdir(raiz, { recursive: true });
  kanban = await import("./kanban");
  rotaImagem = await import("../app/api/kanban/[id]/imagem/route");
  rotaImagemArquivo = await import("../app/api/kanban/[id]/imagem/[arquivo]/route");
  rotaAudio = await import("../app/api/kanban/[id]/audio/route");
  rotaAudioArquivo = await import("../app/api/kanban/[id]/audio/[arquivo]/route");
});
afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
  delete process.env.BILHON_KANBAN_DIR;
});

const CRIADO = "2026-07-01T00:00:00.000Z";

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
    contadores: { ingest: 1, clone: 0, autolearning: 0, feature: 0, melhoria: 0, bug: 0, infra: 0, outro: 0 },
    cards: [
      {
        id: "ING-1",
        titulo: "card ING-1",
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
        historico: [{ de: null, para: "todo", em: CRIADO }],
        execucao: { modo: "agente" },
        criadoEm: CRIADO,
        atualizadoEm: CRIADO,
        concluidoEm: null,
      },
    ],
  };
}

// ids maliciosos: `%2f` já decodificado pelo runtime é o caso da barra normal,
// que o `includes(path.sep)` do código antigo deixava passar no Windows
const IDS_MALICIOSOS = [
  "..",
  ".",
  "../..",
  "../../..",
  "..\\..",
  "ING-1/..",
  "ING-1/../..",
  "a/b",
  "a\\b",
  "ing-1",
  "INGE-1",
  "IN-1",
  "ING-",
  "ING-1 ",
  " ING-1",
  "ING-1.png",
  "ING-1\u0000",
  "INGÉ-1",
  "",
];

beforeEach(async () => {
  await rm(path.join(raiz, "imagens"), { recursive: true, force: true });
  await rm(path.join(raiz, "audio"), { recursive: true, force: true });
  await rm(path.join(raiz, "backups"), { recursive: true, force: true });
  await mkdir(raiz, { recursive: true });
  await writeFile(BOARD, JSON.stringify(boardFake()));
});

describe("cardIdValido", () => {
  it("aceita o formato canônico de ticket (os 8 prefixos de PREFIXO_TIPO)", () => {
    for (const prefixo of Object.values(kanban.PREFIXO_TIPO)) {
      expect(kanban.cardIdValido(`${prefixo}-1`)).toBe(true);
      expect(kanban.cardIdValido(`${prefixo}-1234`)).toBe(true);
    }
  });

  it("recusa todo id fora do formato", () => {
    for (const id of IDS_MALICIOSOS) {
      expect(kanban.cardIdValido(id), `id=${JSON.stringify(id)}`).toBe(false);
    }
  });

  it("recusa valor que não é string", () => {
    for (const v of [null, undefined, 42, {}, ["ING-1"]]) {
      expect(kanban.cardIdValido(v)).toBe(false);
    }
  });
});

describe("helpers de caminho", () => {
  it("caminho feliz resolve dentro da pasta de mídia do card", () => {
    const arquivo = "2026-07-29T18-05-00-000Z.png";
    expect(kanban.imagemPathFor("ING-1", arquivo)).toBe(path.join(raiz, "imagens", "ING-1", arquivo));
    expect(kanban.audioPathFor("ING-1", "2026-07-29T18-05-00-000Z.webm")).toBe(
      path.join(raiz, "audio", "ING-1", "2026-07-29T18-05-00-000Z.webm"),
    );
  });

  it("id malicioso devolve null nos dois helpers", () => {
    for (const id of IDS_MALICIOSOS) {
      expect(kanban.imagemPathFor(id, "x.png"), `id=${JSON.stringify(id)}`).toBeNull();
      expect(kanban.audioPathFor(id, "x.webm"), `id=${JSON.stringify(id)}`).toBeNull();
    }
  });

  it("arquivo malicioso devolve null — inclusive com barra normal no Windows", () => {
    for (const arquivo of ["..", ".", "../x.png", "a/b", "a\\b", "../../package.json", "x\u0000.png", ""]) {
      expect(kanban.imagemPathFor("ING-1", arquivo), `arquivo=${JSON.stringify(arquivo)}`).toBeNull();
      expect(kanban.audioPathFor("ING-1", arquivo), `arquivo=${JSON.stringify(arquivo)}`).toBeNull();
    }
  });

  it("nenhum caminho devolvido escapa da raiz FIXA da pasta de mídia", () => {
    const raizImagens = path.resolve(path.join(raiz, "imagens"));
    for (const id of ["ING-1", ...IDS_MALICIOSOS]) {
      for (const arquivo of ["x.png", "..", "a/b", "C:x.png"]) {
        const abs = kanban.imagemPathFor(id, arquivo);
        if (abs) expect(abs.startsWith(raizImagens + path.sep)).toBe(true);
      }
    }
  });

  it("os construtores de diretório também recusam o id na origem", () => {
    expect(kanban.imagemDirDoCard("ING-1")).toBe(path.join(raiz, "imagens", "ING-1"));
    expect(kanban.audioDirDoCard("ING-1")).toBe(path.join(raiz, "audio", "ING-1"));
    for (const id of IDS_MALICIOSOS) {
      expect(kanban.imagemDirDoCard(id), `id=${JSON.stringify(id)}`).toBeNull();
      expect(kanban.audioDirDoCard(id), `id=${JSON.stringify(id)}`).toBeNull();
    }
  });
});

function ctxId(id: string) {
  return { params: Promise.resolve({ id }) };
}
function ctxArquivo(id: string, arquivo: string) {
  return { params: Promise.resolve({ id, arquivo }) };
}
function reqVazio<T>(url: string, metodo: string): T {
  return new Request(url, { method: metodo }) as unknown as T;
}

async function formDeImagem(): Promise<FormData> {
  const form = new FormData();
  form.append("imagem", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "x.png");
  return form;
}

describe("rotas de leitura e remoção (GET/DELETE)", () => {
  it("GET com id malicioso responde 400 e nunca serve conteúdo de fora", async () => {
    for (const id of IDS_MALICIOSOS) {
      const res = await rotaImagemArquivo.GET(
        reqVazio<Parameters<RotaImagemArquivo["GET"]>[0]>("http://x", "GET"),
        ctxArquivo(id, "package.json"),
      );
      expect(res.status, `id=${JSON.stringify(id)}`).toBe(400);
      expect(await res.arrayBuffer()).toHaveProperty("byteLength", 0);
    }
  });

  it("GET com arquivo escapando do card responde 400 (barra normal inclusa)", async () => {
    for (const arquivo of ["../../../package.json", "a/b", "a\\b", ".."]) {
      const res = await rotaAudioArquivo.GET(
        reqVazio<Parameters<RotaAudioArquivo["GET"]>[0]>("http://x", "GET"),
        ctxArquivo("ING-1", arquivo),
      );
      expect(res.status, `arquivo=${arquivo}`).toBe(400);
    }
  });

  it("DELETE com id malicioso responde 400 e não remove nada", async () => {
    const dir = path.join(raiz, "imagens", "ING-1");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "manter.png"), "PNG");
    for (const id of IDS_MALICIOSOS) {
      const res = await rotaImagemArquivo.DELETE(
        reqVazio<Parameters<RotaImagemArquivo["DELETE"]>[0]>("http://x", "DELETE"),
        ctxArquivo(id, "manter.png"),
      );
      expect(res.status, `id=${JSON.stringify(id)}`).toBe(400);
    }
    expect(await readdir(dir)).toContain("manter.png");
  });

  it("caminho feliz: GET serve a mídia do card com Content-Type correto", async () => {
    const dir = path.join(raiz, "imagens", "ING-1");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "print.png"), "PNGBYTES");
    const res = await rotaImagemArquivo.GET(
      reqVazio<Parameters<RotaImagemArquivo["GET"]>[0]>("http://x", "GET"),
      ctxArquivo("ING-1", "print.png"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(await res.text()).toBe("PNGBYTES");
  });
});

describe("rotas de upload (POST): 400 ANTES de qualquer mkdir/writeFile", () => {
  it("POST de imagem com id malicioso responde 400 e não cria diretório nenhum", async () => {
    const antesSandbox = (await readdir(sandbox)).sort();
    const antesRaiz = (await readdir(raiz)).sort();

    for (const id of IDS_MALICIOSOS) {
      const req = new Request(`http://x/api/kanban/${encodeURIComponent(id)}/imagem`, {
        method: "POST",
        body: await formDeImagem(),
      }) as unknown as Parameters<RotaImagem["POST"]>[0];
      const res = await rotaImagem.POST(req, ctxId(id));
      expect(res.status, `id=${JSON.stringify(id)}`).toBe(400);
    }

    // nada criado fora (nem dentro) — o 400 vem antes do mkdir(recursive)
    expect((await readdir(sandbox)).sort()).toEqual(antesSandbox);
    expect((await readdir(raiz)).sort()).toEqual(antesRaiz);
  });

  it("POST de áudio com id malicioso responde 400 e não cria diretório nenhum", async () => {
    const antesSandbox = (await readdir(sandbox)).sort();
    for (const id of ["../..", "../../fuga", "a/b", "ing-1"]) {
      const form = new FormData();
      form.append("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), "x.webm");
      const req = new Request("http://x/api/kanban/id/audio", { method: "POST", body: form }) as unknown as Parameters<
        RotaAudio["POST"]
      >[0];
      const res = await rotaAudio.POST(req, ctxId(id));
      expect(res.status, `id=${id}`).toBe(400);
    }
    expect((await readdir(sandbox)).sort()).toEqual(antesSandbox);
  });

  it("caminho feliz: POST de imagem grava dentro da pasta do card e registra no board", async () => {
    const req = new Request("http://x/api/kanban/ING-1/imagem", {
      method: "POST",
      body: await formDeImagem(),
    }) as unknown as Parameters<RotaImagem["POST"]>[0];
    const res = await rotaImagem.POST(req, ctxId("ING-1"));
    expect(res.status).toBe(201);

    const dir = path.join(raiz, "imagens", "ING-1");
    const arquivos = await readdir(dir);
    expect(arquivos).toHaveLength(1);
    expect(arquivos[0]).toMatch(/\.png$/);

    const board = JSON.parse(await readFile(BOARD, "utf-8")) as { cards: Array<{ imagens: Array<{ arquivo: string }> }> };
    expect(board.cards[0].imagens.map((i) => i.arquivo)).toEqual(arquivos);
  });
});
