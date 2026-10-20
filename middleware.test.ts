import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), jwks: vi.fn(() => vi.fn()) }));
vi.mock("jose", () => ({ jwtVerify: mocks.verify, createRemoteJWKSet: mocks.jwks }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("BILHON_ACCESS_TEAM", "test-team");
  vi.stubEnv("BILHON_ACCESS_AUD", "test-audience");
  vi.stubEnv("BILHON_ACCESS_EMAIL", "usuario@example.invalid");
});
afterEach(() => vi.unstubAllEnvs());
const request = (host: string, token?: string) => new NextRequest(`http://${host}/api/graph`, {
  headers: { host, ...(token ? { "cf-access-jwt-assertion": token } : {}) },
});
const JWT = { "cf-access-jwt-assertion": "token" };
const pedido = (host: string, cabecalhos: Record<string, string> = {}, method = "GET") =>
  new NextRequest(`http://${host}/api/kanban`, { method, headers: { host, ...cabecalhos } });

describe("acesso — o Host de loopback sozinho não prova que o pedido é local", () => {
  it("0.0.0.0 não é host local", async () => {
    const { middleware } = await import("./middleware");
    expect((await middleware(pedido("0.0.0.0:3300"))).status).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  // O Next preenche X-Forwarded-For/-Host/-Port/-Proto em TODO pedido, inclusive o direto do
  // navegador; este é o pedido que ele entrega ao middleware numa conversa local normal.
  const injetadosPeloNext = (host: string, de = "127.0.0.1") => ({
    "x-forwarded-for": de,
    "x-forwarded-host": host,
    "x-forwarded-port": host.split(":")[1] ?? "80",
    "x-forwarded-proto": "http",
  });

  it("o que o Next preenche em todo pedido local não o torna externo", async () => {
    const { middleware } = await import("./middleware");
    for (const [host, de] of [["127.0.0.1:3300", "127.0.0.1"], ["localhost:3300", "::1"], ["[::1]:3300", "::ffff:127.0.0.1"], ["LOCALHOST:3300", "127.0.0.2"]]) {
      expect((await middleware(pedido(host, injetadosPeloNext(host, de)))).status, `${host} ${de}`).toBe(200);
    }
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  // sinais que só um intermediário coloca: a presença já basta
  const sinaisDeProxy: Record<string, string> = {
    forwarded: "for=203.0.113.7;proto=https",
    "x-real-ip": "203.0.113.7",
    "true-client-ip": "203.0.113.7",
    "cf-connecting-ip": "203.0.113.7",
    "cf-ray": "0000000000000000-GRU",
    "cdn-loop": "cloudflare",
    via: "1.1 proxy.example.invalid",
  };
  for (const [nome, valor] of Object.entries(sinaisDeProxy)) {
    it(`Host local + ${nome} exige Access`, async () => {
      const { middleware } = await import("./middleware");
      for (const host of ["127.0.0.1:3300", "localhost:3300", "[::1]:3300"]) {
        const res = await middleware(pedido(host, { ...injetadosPeloNext(host), [nome]: valor }));
        expect(res.status, host).toBe(403);
        expect(res.headers.get("x-knowledge-access")).toBe("sem-jwt");
      }
    });
  }

  // X-Forwarded-*: só o valor que o Next não teria escrito denuncia o intermediário
  const forjadosOuDeProxy: Record<string, Record<string, string>> = {
    "X-Forwarded-For de cliente externo": { "x-forwarded-for": "203.0.113.7" },
    "X-Forwarded-For de outra máquina da rede local": { "x-forwarded-for": "192.168.0.20" },
    "X-Forwarded-For em lista": { "x-forwarded-for": "203.0.113.7, 127.0.0.1" },
    "X-Forwarded-For vazio": { "x-forwarded-for": "" },
    "X-Forwarded-Host diferente do Host": { "x-forwarded-host": "knowledge.example.invalid" },
    "X-Forwarded-Proto https": { "x-forwarded-proto": "https" },
  };
  for (const [nome, extra] of Object.entries(forjadosOuDeProxy)) {
    it(`Host local + ${nome} exige Access`, async () => {
      const { middleware } = await import("./middleware");
      const res = await middleware(pedido("127.0.0.1:3300", { ...injetadosPeloNext("127.0.0.1:3300"), ...extra }));
      expect(res.status).toBe(403);
      expect(res.headers.get("x-knowledge-access")).toBe("sem-jwt");
    });
  }

  it("pedido por proxy sem Access configurado é negado, mesmo com Host local", async () => {
    vi.stubEnv("BILHON_ACCESS_TEAM", "");
    const { middleware } = await import("./middleware");
    const res = await middleware(pedido("127.0.0.1:3300", { "x-forwarded-for": "203.0.113.7", "cf-access-jwt-assertion": "token" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-knowledge-access")).toBe("nao-configurado");
  });

  it("pedido por proxy com JWT válido passa", async () => {
    const { middleware } = await import("./middleware");
    mocks.verify.mockResolvedValue({ payload: { email: "usuario@example.invalid" } });
    const res = await middleware(pedido("127.0.0.1:3300", { "x-forwarded-for": "203.0.113.7", ...JWT }));
    expect(res.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });

  it("loopback direto, sem cabeçalho nenhum, segue abrindo sem login", async () => {
    const { middleware } = await import("./middleware");
    for (const host of ["127.0.0.1:3300", "localhost", "[::1]:3300"]) {
      expect((await middleware(pedido(host))).status, host).toBe(200);
    }
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});

describe("escrita vinda de outra origem (CSRF)", () => {
  const escritas = ["POST", "PUT", "PATCH", "DELETE"];
  const origemLocal = "http://localhost:3300";

  it("mesma origem passa (fetch da própria página)", async () => {
    const { middleware } = await import("./middleware");
    for (const method of escritas) {
      const res = await middleware(pedido("localhost:3300", { "sec-fetch-site": "same-origin", origin: origemLocal }, method));
      expect(res.status, method).toBe(200);
    }
  });

  it("navegação direta (Sec-Fetch-Site: none) passa", async () => {
    const { middleware } = await import("./middleware");
    expect((await middleware(pedido("localhost:3300", { "sec-fetch-site": "none" }, "POST"))).status).toBe(200);
  });

  it("cross-site e same-site são negados", async () => {
    const { middleware } = await import("./middleware");
    for (const method of escritas) {
      for (const site of ["cross-site", "same-site"]) {
        const res = await middleware(pedido("localhost:3300", { "sec-fetch-site": site }, method));
        expect(res.status, `${method} ${site}`).toBe(403);
        expect(res.headers.get("x-knowledge-access")).toBe("origem-cruzada");
      }
    }
  });

  it("Sec-Fetch-Site desconhecido é negado (fail-closed)", async () => {
    const { middleware } = await import("./middleware");
    expect((await middleware(pedido("localhost:3300", { "sec-fetch-site": "" }, "POST"))).status).toBe(403);
    expect((await middleware(pedido("localhost:3300", { "sec-fetch-site": "qualquer" }, "POST"))).status).toBe(403);
  });

  it("Origin de outro host é negado, mesmo sem Sec-Fetch-Site", async () => {
    const { middleware } = await import("./middleware");
    const estranhas = [
      "https://pagina.example.invalid",
      "http://localhost:3000", // outra porta é outra origem
      "http://127.0.0.1:3300", // mesmo servidor, nome diferente do Host
      "http://localhost:3300.pagina.example.invalid",
      "null",
      "lixo",
    ];
    for (const origin of estranhas) {
      const res = await middleware(pedido("localhost:3300", { origin }, "POST"));
      expect(res.status, origin).toBe(403);
      expect(res.headers.get("x-knowledge-access")).toBe("origem-cruzada");
    }
  });

  it("Origin igual ao Host passa, sem Sec-Fetch-Site", async () => {
    const { middleware } = await import("./middleware");
    expect((await middleware(pedido("localhost:3300", { origin: origemLocal }, "POST"))).status).toBe(200);
    expect((await middleware(pedido("localhost:3300", { origin: "HTTP://LOCALHOST:3300" }, "POST"))).status).toBe(200);
  });

  it("clientes sem Origin nem Sec-Fetch-Site (curl, scripts) continuam passando", async () => {
    const { middleware } = await import("./middleware");
    for (const method of escritas) expect((await middleware(pedido("127.0.0.1:3300", {}, method))).status, method).toBe(200);
  });

  it("leitura não é barrada por esta checagem", async () => {
    const { middleware } = await import("./middleware");
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const res = await middleware(pedido("localhost:3300", { "sec-fetch-site": "cross-site", origin: "https://pagina.example.invalid" }, method));
      expect(res.status, method).toBe(200);
    }
  });

  it("vale também para acesso externo autenticado", async () => {
    const { middleware } = await import("./middleware");
    mocks.verify.mockResolvedValue({ payload: { email: "usuario@example.invalid" } });
    const host = "knowledge.example.invalid";
    const cruzada = await middleware(pedido(host, { ...JWT, "sec-fetch-site": "cross-site" }, "POST"));
    expect(cruzada.status).toBe(403);
    expect(cruzada.headers.get("x-knowledge-access")).toBe("origem-cruzada");
    const propria = await middleware(pedido(host, { ...JWT, "sec-fetch-site": "same-origin", origin: `https://${host}` }, "POST"));
    expect(propria.status).toBe(200);
  });

  it("recusa a origem antes de consultar o JWT", async () => {
    const { middleware } = await import("./middleware");
    await middleware(pedido("knowledge.example.invalid", { ...JWT, "sec-fetch-site": "cross-site" }, "POST"));
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});

describe("cabeçalhos de segurança (next.config.mjs)", () => {
  const regras = async () => {
    const { default: config } = await import("./next.config.mjs");
    return (await config.headers?.()) ?? [];
  };
  const valor = (headers: { key: string; value: string }[], chave: string) => headers.find((h) => h.key === chave)?.value;

  it("nosniff, sem referrer e permissões restritas em todas as rotas", async () => {
    const todas = (await regras()).find((r) => r.source === "/:path*");
    expect(todas).toBeDefined();
    expect(valor(todas!.headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(valor(todas!.headers, "Referrer-Policy")).toBe("no-referrer");
    const permissoes = valor(todas!.headers, "Permissions-Policy") ?? "";
    expect(permissoes).toContain("camera=()");
    expect(permissoes).toContain("geolocation=()");
    expect(permissoes).toContain("microphone=(self)");
  });

  it("proíbe moldura de outro site, exceto em /api/file/ (o leitor de PDF embute essa rota)", async () => {
    const moldura = (await regras()).find((r) => valor(r.headers, "X-Frame-Options") !== undefined);
    expect(moldura).toBeDefined();
    expect(valor(moldura!.headers, "X-Frame-Options")).toBe("SAMEORIGIN");
    expect(valor(moldura!.headers, "Content-Security-Policy")).toBe("frame-ancestors 'self'");
    expect(moldura!.source).toContain("api/file/");
  });
});

describe("acesso", () => {
  it("permite localhost sem consultar a rede", async () => {
    const { middleware } = await import("./middleware");
    expect((await middleware(request("localhost:3300"))).status).toBe(200);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("nega acesso externo sem configuração ou JWT", async () => {
    vi.stubEnv("BILHON_ACCESS_TEAM", "");
    const { middleware } = await import("./middleware");
    expect((await middleware(request("example.invalid", "token"))).status).toBe(403);
    expect(mocks.jwks).not.toHaveBeenCalled();
  });
  it("confere issuer, audience e identidade antes de permitir", async () => {
    const { middleware } = await import("./middleware");
    expect((await middleware(request("example.invalid"))).status).toBe(403);
    mocks.verify.mockResolvedValue({ payload: { email: "usuario@example.invalid" } });
    expect((await middleware(request("example.invalid", "token"))).status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith("token", expect.any(Function), {
      issuer: "https://test-team.cloudflareaccess.com", audience: "test-audience", algorithms: ["RS256"], requiredClaims: ["exp"],
    });
    mocks.verify.mockResolvedValue({ payload: { email: "outro@example.invalid" } });
    expect((await middleware(request("example.invalid", "token"))).status).toBe(403);
    mocks.verify.mockRejectedValue(new Error("invalid"));
    expect((await middleware(request("example.invalid", "token"))).status).toBe(403);
  });
});
