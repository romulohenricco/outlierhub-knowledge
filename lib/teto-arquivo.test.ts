import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TETO_ARQUIVO_BYTES, lerTextoComTeto, tamanhoDentroDoTeto } from "./arquivo-teto";

/** Achado da revisão independente: leitura de arquivo sem teto (JSON/YAML hostil, "bomba" de aliases). */
let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "teto-"));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("arquivo-teto", () => {
  it("o teto é 8 MB", () => expect(TETO_ARQUIVO_BYTES).toBe(8 * 1024 * 1024));

  it("lê arquivo pequeno; recusa o que passa do teto SEM ler o conteúdo", async () => {
    const ok = path.join(tmp, "ok.json");
    writeFileSync(ok, '{"a":1}');
    expect(await lerTextoComTeto(ok)).toBe('{"a":1}');
    const grande = path.join(tmp, "grande.json");
    writeFileSync(grande, "x".repeat(2048));
    await expect(lerTextoComTeto(grande, 1024)).rejects.toThrow(/teto/i);
    expect(await tamanhoDentroDoTeto(grande, 1024)).toBe(false);
    expect(await tamanhoDentroDoTeto(ok, 1024)).toBe(true);
    expect(await tamanhoDentroDoTeto(path.join(tmp, "nao-existe"), 1024)).toBe(false);
  });
});

describe("os leitores reais respeitam o teto", () => {
  it("lerJsonSocial devolve o fallback para JSON acima do teto", async () => {
    mkdirSync(path.join(tmp, "social"), { recursive: true });
    const f = path.join(tmp, "social", "enorme.json");
    writeFileSync(f, JSON.stringify({ dado: "x".repeat(TETO_ARQUIVO_BYTES + 10) }));
    vi.stubEnv("BILHON_SOCIAL_DIR", path.join(tmp, "social"));
    const { lerJsonSocial } = await import("./social-dir");
    expect(await lerJsonSocial(f, { vazio: true })).toEqual({ vazio: true });
    const pequeno = path.join(tmp, "social", "ok.json");
    writeFileSync(pequeno, '{"ok":1}');
    expect(await lerJsonSocial(pequeno, { vazio: true })).toEqual({ ok: 1 });
  });

  it("lerFonte (ontologia/agente) marca como inválida a fonte acima do teto", async () => {
    const f = path.join(tmp, "grande.yaml");
    writeFileSync(f, "a: " + "x".repeat(TETO_ARQUIVO_BYTES + 10) + "\n");
    vi.stubEnv("BILHON_ROOT", tmp);
    const { lerFonte } = await import("./ecosystem");
    const r = await lerFonte(f, true);
    expect(r.estado).toBe("invalida");
    expect(r.dado).toBeNull();
  });
});
