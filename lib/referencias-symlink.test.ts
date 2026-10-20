import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Achado da revisão independente: a rota de imagens só checava prefixo de texto; um symlink
 *  dentro de REFS_DIR apontando para FORA era servido. Agora a contenção olha o caminho real. */
let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "refs-symlink-"));
  vi.resetModules();
  vi.stubEnv("BILHON_REFERENCIAS_DIR", path.join(tmp, "refs"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("imagePathFor — contenção por caminho real", () => {
  it("arquivo normal dentro da raiz passa", async () => {
    mkdirSync(path.join(tmp, "refs", "perfil"), { recursive: true });
    writeFileSync(path.join(tmp, "refs", "perfil", "a.jpg"), "x");
    const { imagePathFor, REFS_DIR } = await import("./referencias");
    expect(imagePathFor("perfil", "a.jpg")).toBe(path.join(REFS_DIR, "perfil", "a.jpg"));
  });

  it("symlink de arquivo apontando para FORA da raiz é recusado", async () => {
    mkdirSync(path.join(tmp, "refs", "perfil"), { recursive: true });
    writeFileSync(path.join(tmp, "segredo.png"), "nao-e-imagem");
    symlinkSync(path.join(tmp, "segredo.png"), path.join(tmp, "refs", "perfil", "x.png"));
    const { imagePathFor } = await import("./referencias");
    expect(imagePathFor("perfil", "x.png")).toBeNull();
  });

  it("symlink de PASTA apontando para fora também é recusado", async () => {
    mkdirSync(path.join(tmp, "refs"), { recursive: true });
    mkdirSync(path.join(tmp, "fora"), { recursive: true });
    writeFileSync(path.join(tmp, "fora", "a.jpg"), "x");
    symlinkSync(path.join(tmp, "fora"), path.join(tmp, "refs", "perfil"));
    const { imagePathFor } = await import("./referencias");
    expect(imagePathFor("perfil", "a.jpg")).toBeNull();
  });

  it("arquivo que ainda não existe, dentro da raiz, continua aceito (404 fica a cargo da rota)", async () => {
    mkdirSync(path.join(tmp, "refs", "perfil"), { recursive: true });
    const { imagePathFor } = await import("./referencias");
    expect(imagePathFor("perfil", "ainda-nao.jpg")).not.toBeNull();
  });
});
