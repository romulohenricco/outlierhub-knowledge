import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validarAddonEntry } from "./addons-schema";

const source = "export const exemplo = true;";
const sample = {
  id: "function-utility:exemplo", type: "addon", category: "function-utility", title: "Exemplo", summary: "Teste sintético",
  source: { repository: null, revision: null, license: "mit", bucket: "synthetic" },
  artifacts: [{ id: "index.ts", media_type: "text/typescript", size: Buffer.byteLength(source), checksum: createHash("sha256").update(source).digest("hex") }],
  preview_kind: "none", approval: "aprovado", distribution: "interno",
};
let dir: string;
beforeEach(async () => {
  vi.resetModules();
  dir = await mkdtemp(path.join(tmpdir(), "addons-"));
  // a raiz permitida e a pasta do catálogo são a mesma pasta temporária
  vi.stubEnv("BILHON_ROOT", dir);
  vi.stubEnv("BILHON_ADDONS_DIR", dir);
  await mkdir(path.join(dir, "artifacts", "exemplo"), { recursive: true });
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ entries: [sample] }));
  await writeFile(path.join(dir, "artifacts", "exemplo", "index.ts"), source);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
describe("catálogo local sem fixtures upstream", () => {
  it("serve apenas artefato aprovado com checksum correto", async () => {
    const { lerArtefatoAddon } = await import("./addons");
    expect(await lerArtefatoAddon(sample.id, "index.ts")).toBe(source);
    expect(await lerArtefatoAddon(sample.id, "../index.ts")).toBeNull();
    await writeFile(path.join(dir, "artifacts", "exemplo", "index.ts"), "alterado");
    expect(await lerArtefatoAddon(sample.id, "index.ts")).toBeNull();
  });
  it("isola licenças desconhecidas e dados suspeitos", () => {
    expect(validarAddonEntry({ ...sample, source: { ...sample.source, license: "unknown" } })?.approval).toBe("quarentena");
    expect(validarAddonEntry({ ...sample, summary: "usuario@example.invalid" })?.approval).toBe("quarentena");
  });
  it("não oferece conteúdo em quarentena", async () => {
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ entries: [{ ...sample, approval: "quarentena" }] }));
    const { getAddonCatalogo, lerArtefatoAddon } = await import("./addons");
    expect((await getAddonCatalogo()).quarentena).toHaveLength(1);
    expect(await lerArtefatoAddon(sample.id, "index.ts")).toBeNull();
  });
});

describe("pasta do catálogo", () => {
  it("em branco vale como ausente: lê data/addons do diretório do app e nasce vazio", async () => {
    vi.stubEnv("BILHON_ROOT", "");
    vi.stubEnv("BILHON_ADDONS_DIR", "");
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const { getAddonCatalogo } = await import("./addons");
    expect(await getAddonCatalogo()).toEqual({ entries: [], quarentena: [], invalidos: 0 });
  });

  it("pasta fora da raiz permitida é recusada: catálogo vazio, sem erro (a página abre)", async () => {
    vi.stubEnv("BILHON_ADDONS_DIR", path.join(path.dirname(dir), "catalogo-de-fora"));
    const { getAddonCatalogo } = await import("./addons");
    expect(await getAddonCatalogo()).toEqual({ entries: [], quarentena: [], invalidos: 0 });
  });

  it("o leitor de artefato também recusa a pasta fora da raiz: devolve null (a rota responde 404), não lança", async () => {
    vi.stubEnv("BILHON_ADDONS_DIR", path.join(path.dirname(dir), "catalogo-de-fora"));
    const { lerArtefatoAddon } = await import("./addons");
    await expect(lerArtefatoAddon("qualquer-id", "arquivo.ts")).resolves.toBeNull();
  });
});
