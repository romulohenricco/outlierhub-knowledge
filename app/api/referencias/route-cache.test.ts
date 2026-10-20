/**
 * Política de cache das rotas que servem material privado.
 * O defeito original: `public, max-age=86400` em 4 rotas do acervo, o que sob
 * tunnel/proxy torna capa de livro e binário de vídeo elegíveis a cache
 * intermediário. Estes testes travam a política (`private`), não só o header.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cachepol-"));
  process.env.BILHON_REFERENCIAS_DIR = root;
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.BILHON_REFERENCIAS_DIR;
});

const POLITICA = "private, max-age=3600";

describe("material privado nunca sai como cacheável público", () => {
  it("imagem de referência: private, sem public", async () => {
    const { GET } = await import("./[dir]/[img]/route");
    const dir = "perfil__cache";
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, "01_a.png"), "PNGFAKE");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ dir, img: "01_a.png" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(POLITICA);
  });

  it("vídeo (200 completo e 206 com Range): private nas duas respostas", async () => {
    const { GET } = await import("./video/[dir]/[file]/route");
    const dir = "perfil__video";
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, "clip.mp4"), "0123456789");
    const params = Promise.resolve({ dir, file: "clip.mp4" });

    const { NextRequest } = await import("next/server");
    const full = await GET(new NextRequest("http://x/clip.mp4"), { params });
    expect(full.status).toBe(200);
    expect(full.headers.get("Cache-Control")).toBe(POLITICA);

    // o header vive num objeto compartilhado entre os dois caminhos da rota:
    // se alguém reintroduzir `public` só no ramo do Range, este assert pega
    const parcial = await GET(
      new NextRequest("http://x/clip.mp4", { headers: { range: "bytes=2-5" } }),
      { params: Promise.resolve({ dir, file: "clip.mp4" }) },
    );
    expect(parcial.status).toBe(206);
    expect(parcial.headers.get("Cache-Control")).toBe(POLITICA);
  });
});
