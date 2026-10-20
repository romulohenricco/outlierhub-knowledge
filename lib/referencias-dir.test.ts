import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * REFS_DIR é normalizado (path.resolve) antes de qualquer checagem de contenção por
 * prefixo. Sem isso, "./refs", "refs/" ou um caminho absoluto com barra normal no
 * Windows faziam `startsWith(REFS_DIR + sep)` dar falso: toda imagem, miniatura e
 * vídeo respondia 400 em silêncio, embora o .env.example aceite caminho relativo.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "refs-dir-"));
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const carregar = async (valor: string) => {
  vi.stubEnv("BILHON_REFERENCIAS_DIR", valor);
  vi.resetModules();
  return import("./referencias");
};

describe("REFS_DIR configurado de formas diferentes", () => {
  it.each([
    ["relativo com ponto", () => "./refs-de-teste"],
    ["relativo sem ponto", () => "refs-de-teste"],
    ["absoluto com barra final", () => `${dir}${path.sep}`],
    ["absoluto com barra normal", () => dir.split(path.sep).join("/")],
    ["absoluto com segmentos redundantes", () => `${dir}${path.sep}.${path.sep}sub${path.sep}..`],
  ])("%s: resolve para absoluto e a contenção aceita arquivos de dentro", async (_nome, valor) => {
    const R = await carregar(valor());
    expect(path.isAbsolute(R.REFS_DIR)).toBe(true);
    expect(R.REFS_DIR).toBe(path.resolve(R.REFS_DIR));
    expect(R.imagePathFor("post", "a.jpg")).toBe(path.join(R.REFS_DIR, "post", "a.jpg"));
    const thumb = await R.thumbPathFor("post", "a.jpg");
    expect(thumb).toEqual({ path: path.join(R.REFS_DIR, "post", "a.jpg"), mime: "image/jpeg" });
  });

  it("continua recusando fuga do diretório", async () => {
    const R = await carregar(`${dir}${path.sep}`);
    for (const [d, i] of [["..", "a.jpg"], ["post", "../a.jpg"], ["a/b", "x.jpg"], ["post", "a\\b.jpg"], [".", "a.jpg"]]) {
      expect(R.imagePathFor(d, i), `${d} ${i}`).toBeNull();
    }
  });

  it("variável em branco ou só com espaço cai no padrão", async () => {
    for (const valor of ["", "   "]) {
      const R = await carregar(valor);
      expect(R.REFS_DIR).toBe(path.resolve(process.cwd(), "data", "referencias-instagram"));
    }
  });
});
