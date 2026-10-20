import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "thumbroute-"));
  process.env.BILHON_REFERENCIAS_DIR = root;
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.BILHON_REFERENCIAS_DIR;
});

function ctx(dir: string, img: string) {
  return { params: Promise.resolve({ dir, img }) };
}

describe("rota /api/referencias/thumb", () => {
  it("rota: serve o thumb webp com Content-Type correto", async () => {
    const { GET } = await import("./[dir]/[img]/route");
    const dir = "perfil__A";
    await mkdir(path.join(root, dir, ".thumbs"), { recursive: true });
    await writeFile(path.join(root, dir, "01_x.jpg"), "orig");
    await writeFile(path.join(root, dir, ".thumbs", "01_x.jpg.webp"), "THUMBW");
    const res = await GET(new Request("http://x"), ctx(dir, "01_x.jpg"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    // `toContain("max-age")` passava até com `public` — o assert precisa
    // travar a política, não só a existência do header
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(res.headers.get("Cache-Control")).not.toContain("public");
  });

  it("rota: fallback ao original quando o thumb não existe", async () => {
    const { GET } = await import("./[dir]/[img]/route");
    const dir = "perfil__B";
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, "01_y.png"), "ORIGINAL");
    const res = await GET(new Request("http://x"), ctx(dir, "01_y.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("rota: 400 em path traversal", async () => {
    const { GET } = await import("./[dir]/[img]/route");
    const res = await GET(new Request("http://x"), ctx(".", "videos-urls.json"));
    expect(res.status).toBe(400);
  });
});
