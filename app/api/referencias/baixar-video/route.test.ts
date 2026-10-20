import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * Baixar vídeo sem nada para baixar (modo demo, ou referências sem as URLs
 * registradas) responde com mensagem amigável. Erro inesperado devolve texto fixo:
 * a mensagem do erro de sistema carrega o caminho absoluto da máquina.
 */

let dir: string;
let POST: (req: NextRequest) => Promise<Response>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "baixar-video-"));
  vi.stubEnv("BILHON_REFERENCIAS_DIR", dir);
  vi.resetModules();
  ({ POST } = await import("./route"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const chamar = (corpo: unknown) =>
  POST(new NextRequest("http://127.0.0.1:3300/api/referencias/baixar-video", { method: "POST", body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) }));

const comReferencias = () => writeFile(path.join(dir, "referencias.json"), JSON.stringify({ posts: [] }));

describe("POST /api/referencias/baixar-video", () => {
  it("modo demo (sem referencias.json): mensagem amigável, sem 500 e sem caminho", async () => {
    const res = await chamar({ code: "demo001", idx: 1 });
    const texto = await res.text();
    expect(res.status).toBe(502);
    expect(JSON.parse(texto)).toEqual({ ok: false, erro: "vídeo indisponível no modo demo" });
    expect(texto).not.toContain(dir);
  });

  it("referências sem videos-urls.json: diz o que falta, sem caminho", async () => {
    await comReferencias();
    const res = await chamar({ code: "p1", idx: 1 });
    const texto = await res.text();
    expect(res.status).toBe(502);
    expect(JSON.parse(texto).erro).toContain("videos-urls.json");
    expect(texto).not.toContain(dir);
  });

  it("código que existe no protótipo não derruba a rota", async () => {
    await comReferencias();
    await writeFile(path.join(dir, "videos-urls.json"), JSON.stringify({}));
    const res = await chamar({ code: "constructor", idx: 1 });
    expect(res.status).toBe(502);
    expect((await res.json()).erro).toBe("vídeo não registrado");
  });

  it("erro inesperado: 500 com texto fixo, sem eco do conteúdo nem do caminho", async () => {
    await comReferencias();
    await writeFile(
      path.join(dir, "videos-urls.json"),
      JSON.stringify({ p1: { user: "u", vids: [{ idx: 1, url: "isto-nao-e-uma-url" }] } }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await chamar({ code: "p1", idx: 1 });
    const texto = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(texto).ok).toBe(false);
    expect(texto).not.toContain("isto-nao-e-uma-url");
    expect(texto).not.toContain(dir);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["corpo que não é JSON", "{"],
    ["sem code", { idx: 1 }],
    ["idx em texto", { code: "p1", idx: "1" }],
    ["code que não é texto", { code: 5, idx: 1 }],
  ])("%s: 400", async (_nome, corpo) => {
    expect((await chamar(corpo)).status).toBe(400);
  });
});
