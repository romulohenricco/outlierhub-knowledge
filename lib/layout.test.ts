import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "layout-load-"));
  vi.resetModules(); // limpa o cache de módulo (layoutCache) entre casos
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.BILHON_GRAPH_LAYOUT;
});

describe("carregarLayout", () => {
  it("AC7: retorna o mapa x,y quando o sidecar existe", async () => {
    const f = path.join(dir, "layout.json");
    await writeFile(f, JSON.stringify({ a: { x: 1.5, y: -2.5 } }));
    process.env.BILHON_GRAPH_LAYOUT = f;
    const { carregarLayout } = await import("./kg");
    expect((await carregarLayout()).a).toEqual({ x: 1.5, y: -2.5 });
  });

  it("AC9: sidecar ausente → {} (fallback gracioso, sem erro)", async () => {
    process.env.BILHON_GRAPH_LAYOUT = path.join(dir, "nao-existe.json");
    const { carregarLayout } = await import("./kg");
    expect(await carregarLayout()).toEqual({});
  });
});
