import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Achado da revisão independente: a página mostrava o valor cru de BILHON_ONTOLOGIA_MANIFEST
 *  (caminho absoluto do servidor) no HTML. Só o nome do arquivo pode sair para a tela. */
let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "onto-fonte-"));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("getOntologia — o que sai para a tela não carrega caminho absoluto", () => {
  it("fonte vazia ou ausente: só o nome do arquivo", async () => {
    const f = path.join(tmp, "minha-ontologia.yaml");
    vi.stubEnv("BILHON_ROOT", tmp);
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", f); // arquivo ausente
    const { getOntologia } = await import("./ontologia");
    const r = await getOntologia();
    expect(r.estado).toBe("ausente");
    expect(r.fonte).toBe("minha-ontologia.yaml");
    expect(r.fonte).not.toContain(tmp);
  });

  it("com arquivo válido também", async () => {
    const f = path.join(tmp, "o.yaml");
    writeFileSync(f, "camadas:\n  - id: c1\n");
    vi.stubEnv("BILHON_ROOT", tmp);
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", f);
    const { getOntologia } = await import("./ontologia");
    const r = await getOntologia();
    expect(r.fonte).toBe("o.yaml");
  });
});
