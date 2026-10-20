import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Uma ingestão pode gravar anotacao/promptReverso INLINE no referencias.json, e a API
// grava nos sidecars. Quando os dois existem, vence o mais NOVO — antes o sidecar
// vencia sempre, e uma reingestão depois de uma edição pela API sumia em silêncio.

let root: string;

const INLINE_PR = { prompt: "inline", geradoEm: "2026-10-15T12:00:00+00:00" };
const INLINE_AN = { tipo: "visual", descricao: "inline", verificadoEm: "2026-10-15" };

function post(code: string, extra: Record<string, unknown> = {}) {
  return { code, user: "x", caption: "", igUrl: "", dir: code, images: [], videoIdx: [], colecoes: ["Sites"], plataforma: "sites", ...extra };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "refs-sidecar-"));
  process.env.BILHON_REFERENCIAS_DIR = root;
  await writeFile(
    path.join(root, "referencias.json"),
    JSON.stringify({
      fonte: "t",
      extraidoEm: "2026-10-15",
      colecoes: [],
      posts: [
        post("reingerido", { promptReverso: INLINE_PR, anotacao: INLINE_AN }),
        post("editado-api", { promptReverso: INLINE_PR, anotacao: INLINE_AN }),
        post("sem-data", { promptReverso: { prompt: "inline" }, anotacao: { tipo: "visual", descricao: "inline" } }),
        post("so-inline", { promptReverso: INLINE_PR, anotacao: INLINE_AN }),
      ],
    }),
  );
  await writeFile(
    path.join(root, "prompts-reversos.json"),
    JSON.stringify({
      reingerido: { prompt: "sidecar", geradoEm: "2026-10-01T00:00:00Z" },
      "editado-api": { prompt: "sidecar", geradoEm: "2026-10-16T00:00:00Z" },
      "sem-data": { prompt: "sidecar" },
    }),
  );
  await writeFile(
    path.join(root, "anotacoes.json"),
    JSON.stringify({
      reingerido: { tipo: "visual", descricao: "sidecar", verificadoEm: "2026-10-01" },
      "editado-api": { tipo: "visual", descricao: "sidecar", verificadoEm: "2026-10-16" },
      "sem-data": { tipo: "visual", descricao: "sidecar" },
    }),
  );
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.BILHON_REFERENCIAS_DIR;
});

async function porCode() {
  const { getReferencias } = await import("./referencias");
  const r = await getReferencias();
  return Object.fromEntries(r.posts.map((p) => [p.code, p]));
}

describe("getReferencias — inline x sidecar", () => {
  it("reingestão mais nova que o sidecar: vale o inline", async () => {
    const p = (await porCode())["reingerido"];
    expect(p.promptReverso?.prompt).toBe("inline");
    expect(p.anotacao?.descricao).toBe("inline");
  });

  it("edição pela API mais nova que o inline: vale o sidecar", async () => {
    const p = (await porCode())["editado-api"];
    expect(p.promptReverso?.prompt).toBe("sidecar");
    expect(p.anotacao?.descricao).toBe("sidecar");
  });

  it("sem carimbo para comparar: sidecar continua vencendo", async () => {
    const p = (await porCode())["sem-data"];
    expect(p.promptReverso?.prompt).toBe("sidecar");
    expect(p.anotacao?.descricao).toBe("sidecar");
  });

  it("só inline: preservado", async () => {
    const p = (await porCode())["so-inline"];
    expect(p.promptReverso?.prompt).toBe("inline");
    expect(p.anotacao?.descricao).toBe("inline");
  });
});
