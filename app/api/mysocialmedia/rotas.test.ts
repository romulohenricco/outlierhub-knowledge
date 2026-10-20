import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Rotas de /mysocialmedia: a triagem só grava em decisoes.json dentro de BILHON_SOCIAL_DIR,
 * corpo inválido é 400 (erro do pedido, nunca 500), e as imagens só saem de dentro da raiz.
 */

let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(path.join(os.tmpdir(), "social-rotas-"));
  vi.stubEnv("BILHON_SOCIAL_DIR", raiz);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(raiz, { recursive: true, force: true });
});

const SAVE = { code: "AAAAAAAAAAA", pk: "1", user: "conta-a", url: "" };
const VIDEO = { id: "aaaaaaaaaaa", titulo: "t" };

async function inventario() {
  await mkdir(path.join(raiz, "instagram-saves", "thumbs"), { recursive: true });
  await mkdir(path.join(raiz, "youtube-playlists"), { recursive: true });
  await writeFile(path.join(raiz, "instagram-saves", "saves.json"), JSON.stringify({ saves: [SAVE] }));
  await writeFile(path.join(raiz, "youtube-playlists", "videos.json"), JSON.stringify({ videos: [VIDEO] }));
}

const post = (rede: "instagram" | "youtube", corpo: string | undefined) =>
  new NextRequest(`http://127.0.0.1:3300/api/mysocialmedia/${rede}/decisao`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: corpo,
  });

const ROTAS = {
  instagram: () => import("./instagram/decisao/route"),
  youtube: () => import("./youtube/decisao/route"),
} as const;

describe("POST /api/mysocialmedia/{instagram,youtube}/decisao", () => {
  for (const rede of ["instagram", "youtube"] as const) {
    it(`${rede}: corpo inválido volta 400 sem corpo e nada é gravado`, async () => {
      await inventario();
      const { POST } = await ROTAS[rede]();
      const ruins = [
        undefined,
        "não é json",
        "null",
        "[]",
        JSON.stringify({}),
        JSON.stringify({ ids: [], status: "manter" }),
        JSON.stringify({ ids: ["x"], status: "fila" }),
        JSON.stringify({ ids: "x", status: "manter" }),
      ];
      for (const corpo of ruins) {
        const res = await POST(post(rede, corpo));
        expect(res.status, String(corpo)).toBe(400);
        expect(await res.text()).toBe("");
      }
      await expect(readFile(path.join(raiz, rede === "instagram" ? "instagram-saves" : "youtube-playlists", "decisoes.json"))).rejects.toThrow();
    });

    it(`${rede}: grava a decisão em decisoes.json e conta aplicados e ignorados`, async () => {
      await inventario();
      const { POST } = await ROTAS[rede]();
      const id = rede === "instagram" ? SAVE.code : VIDEO.id;
      const res = await POST(post(rede, JSON.stringify({ ids: [id, "../x"], status: "manter" })));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, aplicados: 1, ignorados: 1 });
      const pasta = rede === "instagram" ? "instagram-saves" : "youtube-playlists";
      expect(JSON.parse(await readFile(path.join(raiz, pasta, "decisoes.json"), "utf-8"))[id].status).toBe("manter");
    });

    it(`${rede}: sem dados configurados responde 200 com 0 aplicados e não cria arquivo`, async () => {
      const { POST } = await ROTAS[rede]();
      const res = await POST(post(rede, JSON.stringify({ ids: ["AAAAAAAAAAA"], status: "descartado" })));
      expect(res.status).toBe(200);
      expect((await res.json()).aplicados).toBe(0);
    });
  }
});

describe("GET /api/mysocialmedia/instagram/capa/[code]", () => {
  const chamar = async (code: string) => {
    const { GET } = await import("./instagram/capa/[code]/route");
    return GET(new Request("http://127.0.0.1:3300/x"), { params: Promise.resolve({ code }) });
  };

  it("serve a capa de dentro da raiz como imagem privada", async () => {
    await inventario();
    await writeFile(path.join(raiz, "instagram-saves", "thumbs", "AAAAAAAAAAA.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
    const res = await chamar("AAAAAAAAAAA");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toMatch(/^private/);
  });

  it("shortcode malformado é 400 e capa ausente é 404", async () => {
    expect((await chamar("../../etc/passwd")).status).toBe(400);
    expect((await chamar("AAAAAAAAAAA")).status).toBe(404);
  });
});

describe("GET /api/mysocialmedia/thumb/[username]/[arquivo]", () => {
  const chamar = async (username: string, arquivo: string) => {
    const { GET } = await import("./thumb/[username]/[arquivo]/route");
    return GET(new Request("http://127.0.0.1:3300/x"), { params: Promise.resolve({ username, arquivo }) });
  };

  it("serve miniatura de perfil de dentro da raiz; escape e extensão estranha são 400; ausente é 404", async () => {
    const pasta = path.join(raiz, "instagram-contas", "perfis", "conta-a");
    await mkdir(pasta, { recursive: true });
    await writeFile(path.join(pasta, "p1.webp"), Buffer.from("RIFF"));
    await writeFile(path.join(pasta, "p2.html"), "<b>x</b>");
    const ok = await chamar("conta-a", "p1.webp");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("cache-control")).toMatch(/^private/);
    expect((await chamar("conta-a", "p2.html")).status).toBe(400);
    expect((await chamar("..", "p1.webp")).status).toBe(400);
    expect((await chamar("conta-a", "../p1.webp")).status).toBe(400);
    expect((await chamar("conta-a", "nao-existe.jpg")).status).toBe(404);
  });
});

describe("GET /api/mysocialmedia", () => {
  it("sem dados devolve a estrutura vazia com 200", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).contas).toEqual([]);
  });
});

describe("anti-CSRF do middleware cobre as rotas de escrita de /mysocialmedia", () => {
  it("POST vindo de outro site (Sec-Fetch-Site ou Origin) é 403 origem-cruzada, antes de qualquer gravação", async () => {
    const { middleware } = await import("../../../middleware");
    for (const rede of ["instagram", "youtube"]) {
      const url = `http://127.0.0.1:3300/api/mysocialmedia/${rede}/decisao`;
      const base = { host: "127.0.0.1:3300", "content-type": "application/json" };
      const cruzados: Record<string, string>[] = [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: "http://example.invalid" }, { origin: "null" }];
      for (const extra of cruzados) {
        const res = await middleware(new NextRequest(url, { method: "POST", headers: { ...base, ...extra }, body: "{}" }));
        expect(res.status, `${rede} ${JSON.stringify(extra)}`).toBe(403);
        expect(res.headers.get("x-knowledge-access")).toBe("origem-cruzada");
      }
    }
  });

  it("o mesmo POST feito pela própria página (same-origin) passa", async () => {
    const { middleware } = await import("../../../middleware");
    const res = await middleware(
      new NextRequest("http://127.0.0.1:3300/api/mysocialmedia/youtube/decisao", {
        method: "POST",
        headers: { host: "127.0.0.1:3300", "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3300" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("o matcher do middleware inclui /api/mysocialmedia", async () => {
    const { config } = await import("../../../middleware");
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/api/mysocialmedia/instagram/decisao")).toBe(true);
    expect(re.test("/mysocialmedia")).toBe(true);
  });
});
