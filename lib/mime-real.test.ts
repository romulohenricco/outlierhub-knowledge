import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "refs-mime-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Escreve um arquivo com a assinatura dada + padding até 12 bytes. */
async function comMagic(nome: string, magic: number[]) {
  const p = path.join(root, nome);
  await writeFile(p, Buffer.concat([Buffer.from(magic), Buffer.alloc(16)]));
  return p;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEIC = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];

describe("mimeReal — a extensão do acervo mente", () => {
  it("serve JPEG como image/jpeg mesmo com extensão .heic (download que guardou o nome original da URL)", async () => {
    const { mimeReal } = await import("./referencias");
    expect(await mimeReal(await comMagic("mentiroso.heic", JPEG))).toBe("image/jpeg");
  });

  it("continua reconhecendo HEIC de verdade", async () => {
    const { mimeReal } = await import("./referencias");
    expect(await mimeReal(await comMagic("real.heic", HEIC))).toBe("image/heic");
  });

  it("reconhece PNG e WebP pelos magic bytes", async () => {
    const { mimeReal } = await import("./referencias");
    expect(await mimeReal(await comMagic("x.png", PNG))).toBe("image/png");
    const webp = path.join(root, "x.webp");
    await writeFile(webp, Buffer.concat([
      Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1"), Buffer.alloc(8),
    ]));
    expect(await mimeReal(webp)).toBe("image/webp");
  });

  it("cai pra extensão quando não reconhece a assinatura, e recusa extensão desconhecida", async () => {
    const { mimeReal } = await import("./referencias");
    expect(await mimeReal(await comMagic("sem-assinatura.jpg", [0x00, 0x01, 0x02, 0x03]))).toBe("image/jpeg");
    expect(await mimeReal(await comMagic("bin.exe", [0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it("não estoura em arquivo inexistente nem em arquivo menor que a assinatura", async () => {
    const { mimeReal } = await import("./referencias");
    expect(await mimeReal(path.join(root, "nao-existe.jpg"))).toBe("image/jpeg");
    const curto = path.join(root, "curto.png");
    await writeFile(curto, Buffer.from([0x89, 0x50]));
    expect(await mimeReal(curto)).toBe("image/png"); // cai pra extensão
  });
});
