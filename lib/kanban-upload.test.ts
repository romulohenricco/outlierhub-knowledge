import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Upload de imagem e de áudio do ticket: lista de formatos sem herança de protótipo
 * (um Content-Type "constructor" passava como formato válido e gerava nome de
 * arquivo com `function Object() { [native code] }`), teto de tamanho (413) e o
 * ticket conferido ANTES de gravar (id inexistente não deixa arquivo no disco).
 */

let dir: string;
let K: typeof import("./kanban");
let imagem: typeof import("../app/api/kanban/[id]/imagem/route");
let audio: typeof import("../app/api/kanban/[id]/audio/route");

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kanban-upload-"));
  vi.stubEnv("BILHON_KANBAN_DIR", dir);
  vi.resetModules();
  K = await import("./kanban");
  imagem = await import("../app/api/kanban/[id]/imagem/route");
  audio = await import("../app/api/kanban/[id]/audio/route");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const MB = 1024 * 1024;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function enviar(campo: "imagem" | "audio", tipo: string, bytes: number, cabecalhos: Record<string, string> = {}) {
  const form = new FormData();
  form.append(campo, new Blob([new Uint8Array(bytes)], { type: tipo }), "arquivo");
  return new Request(`http://127.0.0.1:3300/api/kanban/BUG-1/${campo}`, {
    method: "POST",
    body: form,
    headers: cabecalhos,
  }) as never;
}

const existe = (...partes: string[]) =>
  readdir(path.join(dir, ...partes)).then(
    () => true,
    () => false,
  );

describe("imagem do ticket", () => {
  it.each(["constructor", "__proto__", "image/svg+xml"])("formato %j: 400, nada gravado", async (tipo) => {
    const card = await K.criarCard({ titulo: "t", tipo: "bug" });
    const res = await imagem.POST(enviar("imagem", tipo, 8), ctx(card.id));
    expect(res.status).toBe(400);
    expect(await existe("imagens")).toBe(false);
  });

  it("acima de 10 MB: 413 e nada gravado", async () => {
    const card = await K.criarCard({ titulo: "t", tipo: "bug" });
    const res = await imagem.POST(enviar("imagem", "image/png", 10 * MB + 1), ctx(card.id));
    expect(res.status).toBe(413);
    expect(await existe("imagens")).toBe(false);
  });

  it("tamanho declarado muito acima do teto: 413 antes de ler o corpo", async () => {
    const card = await K.criarCard({ titulo: "t", tipo: "bug" });
    const res = await imagem.POST(enviar("imagem", "image/png", 8, { "content-length": String(200 * MB) }), ctx(card.id));
    expect(res.status).toBe(413);
  });

  it("ticket inexistente: 404 e nenhum arquivo órfão", async () => {
    const res = await imagem.POST(enviar("imagem", "image/png", 8), ctx("BUG-99"));
    expect(res.status).toBe(404);
    expect(await existe("imagens")).toBe(false);
  });

  it("caminho feliz continua gravando com a extensão certa", async () => {
    const card = await K.criarCard({ titulo: "t", tipo: "bug" });
    const res = await imagem.POST(enviar("imagem", "image/png", 8), ctx(card.id));
    expect(res.status).toBe(201);
    expect((await readdir(path.join(dir, "imagens", card.id))).map((a) => path.extname(a))).toEqual([".png"]);
  });
});

describe("áudio do ticket", () => {
  it("tipo herdado do protótipo vira webm, nunca o texto de uma função", async () => {
    const card = await K.criarCard({ titulo: "t", tipo: "bug" });
    const res = await audio.POST(enviar("audio", "constructor", 8), ctx(card.id));
    expect(res.status).toBe(201);
    const arquivos = await readdir(path.join(dir, "audio", card.id));
    expect(arquivos).toHaveLength(1);
    expect(path.extname(arquivos[0])).toBe(".webm");
    expect(arquivos[0]).not.toContain("function");
  });

  it("acima de 25 MB: 413 e nada gravado", async () => {
    const card = await K.criarCard({ titulo: "t", tipo: "bug" });
    const res = await audio.POST(enviar("audio", "audio/webm", 25 * MB + 1), ctx(card.id));
    expect(res.status).toBe(413);
    expect(await existe("audio")).toBe(false);
  });

  it("ticket inexistente: 404 e nenhum arquivo órfão", async () => {
    const res = await audio.POST(enviar("audio", "audio/webm", 8), ctx("BUG-99"));
    expect(res.status).toBe(404);
    expect(await existe("audio")).toBe(false);
  });

  it("caminho feliz continua gravando com a extensão do formato", async () => {
    const card = await K.criarCard({ titulo: "t", tipo: "bug" });
    const res = await audio.POST(enviar("audio", "audio/mpeg", 8), ctx(card.id));
    expect(res.status).toBe(201);
    expect((await readdir(path.join(dir, "audio", card.id))).map((a) => path.extname(a))).toEqual([".mp3"]);
  });
});
