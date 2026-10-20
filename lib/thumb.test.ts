import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "thumbpath-"));
  process.env.BILHON_REFERENCIAS_DIR = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.BILHON_REFERENCIAS_DIR;
});

describe("thumbPathFor", () => {
  it("AC3: retorna o thumb webp quando existe", async () => {
    const { thumbPathFor } = await import("./referencias");
    const dir = "perfil__A";
    await mkdir(path.join(root, dir, ".thumbs"), { recursive: true });
    await writeFile(path.join(root, dir, "01_x.jpg"), "orig");
    await writeFile(path.join(root, dir, ".thumbs", "01_x.jpg.webp"), "thumb");
    const r = await thumbPathFor(dir, "01_x.jpg");
    expect(r?.mime).toBe("image/webp");
    expect(r?.path).toBe(path.join(root, dir, ".thumbs", "01_x.jpg.webp"));
  });

  it("AC4: fallback ao original quando o thumb não existe", async () => {
    const { thumbPathFor } = await import("./referencias");
    const dir = "perfil__B";
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, "01_y.png"), "orig");
    const r = await thumbPathFor(dir, "01_y.png");
    expect(r?.mime).toBe("image/png");
    expect(r?.path).toBe(path.join(root, dir, "01_y.png"));
  });

  it("AC5: recusa path traversal", async () => {
    const { thumbPathFor } = await import("./referencias");
    expect(await thumbPathFor(".", "videos-urls.json")).toBeNull();
    expect(await thumbPathFor("..", "x.jpg")).toBeNull();
    expect(await thumbPathFor("a/b", "x.jpg")).toBeNull();
  });
});
