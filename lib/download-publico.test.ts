import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const rede = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: rede.lookup }));
vi.mock("node:https", () => ({ request: rede.request }));
import { baixarVideoPublico, enderecoPublico, lerDownloadLimitado, urlDownloadPublico } from "./download-publico";

describe("destinos de download", () => {
  it.each([
    "127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.2", "169.254.169.254",
    "100.100.100.100", "0.0.0.0", "224.0.0.1", "203.0.113.1", "::1", "::",
    "::ffff:127.0.0.1", "fc00::1", "fe80::1", "64:ff9b::7f00:1", "2001:db8::1", "2002:7f00:1::",
  ])("recusa rede privada, especial ou de documentação: %s", (ip) => {
    expect(enderecoPublico(ip)).toBe(false);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])("aceita endereço público: %s", (ip) => {
    expect(enderecoPublico(ip)).toBe(true);
  });
  it.each(["http://cdn.example/video", "https://user:pass@cdn.example/video", "https://cdn.example:8443/video", "file:///etc/passwd"])("recusa protocolo, credenciais ou porta: %s", (url) => {
    expect(() => urlDownloadPublico(url)).toThrow();
  });
  it("normaliza URL HTTPS", () => {
    expect(urlDownloadPublico("https://cdn.example/video.mp4").protocol).toBe("https:");
  });
});

function resposta(partes: string[], tamanho?: string) {
  const fluxo = new PassThrough() as unknown as IncomingMessage;
  fluxo.headers = tamanho === undefined ? {} : { "content-length": tamanho };
  queueMicrotask(() => {
    for (const parte of partes) (fluxo as unknown as PassThrough).write(parte);
    (fluxo as unknown as PassThrough).end();
  });
  return fluxo;
}

describe("limite do corpo de vídeo", () => {
  it("entrega os bytes pequenos sem depender do cabeçalho", async () => {
    expect((await lerDownloadLimitado(resposta(["ab", "cd"]), 4)).toString()).toBe("abcd");
  });
  it("recusa cabeçalho acima do teto antes de ler", async () => {
    const res = new PassThrough() as unknown as IncomingMessage;
    res.headers = { "content-length": "100" };
    const destroy = vi.spyOn(res, "destroy");
    await expect(lerDownloadLimitado(res, 4)).rejects.toThrow("limite");
    expect(destroy).toHaveBeenCalled();
  });
  it.each([undefined, "1"])("limita bytes reais com Content-Length %s", async (cabecalho) => {
    await expect(lerDownloadLimitado(resposta(["abcdef"], cabecalho), 4)).rejects.toThrow("limite");
  });
});

type OpcoesConexao = {
  signal: AbortSignal;
  lookup: (host: string, opts: object, callback: (error: Error | null, ip: string, family: number) => void) => void;
};

describe("download completo sem rede real", () => {
  beforeEach(() => {
    rede.lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    rede.request.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  function servidor(respostas: { status: number; location?: string; texto?: string }[]) {
    rede.request.mockImplementation((_url: URL, opcoes: OpcoesConexao, callback: (res: IncomingMessage) => void) => {
      const req = Object.assign(new EventEmitter(), {
        end() {
          queueMicrotask(() => {
            const dados = respostas.shift();
            if (!dados) return;
            const res = new PassThrough() as unknown as IncomingMessage;
            res.headers = dados.location ? { location: dados.location } : {};
            res.statusCode = dados.status;
            callback(res);
            if (!res.destroyed) (res as unknown as PassThrough).end(dados.texto ?? "video");
          });
        },
      });
      opcoes.signal.addEventListener("abort", () => req.emit("error", new Error("aborted")), { once: true });
      return req;
    });
  }

  it("fixa na conexão o IP aprovado pelo DNS", async () => {
    servidor([{ status: 200, texto: "bytes" }]);
    expect((await baixarVideoPublico("https://cdn.example/video")).toString()).toBe("bytes");
    const opcoes = rede.request.mock.calls[0][1] as OpcoesConexao;
    const callback = vi.fn();
    opcoes.lookup("cdn.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(rede.lookup).toHaveBeenCalledTimes(1);
  });

  it("recusa DNS misto público/privado antes da conexão", async () => {
    rede.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(baixarVideoPublico("https://cdn.example/video")).rejects.toThrow("permitido");
    expect(rede.request).not.toHaveBeenCalled();
  });

  it("revalida redirect para IP privado antes de abrir a segunda conexão", async () => {
    servidor([{ status: 302, location: "https://127.0.0.1/private" }]);
    await expect(baixarVideoPublico("https://cdn.example/video")).rejects.toThrow("permitido");
    expect(rede.request).toHaveBeenCalledTimes(1);
  });

  it("recusa downgrade HTTP em redirect", async () => {
    servidor([{ status: 302, location: "http://cdn.example/video" }]);
    await expect(baixarVideoPublico("https://cdn.example/video")).rejects.toThrow("HTTPS");
    expect(rede.request).toHaveBeenCalledTimes(1);
  });

  it("limita redirects e valida DNS a cada novo destino", async () => {
    servidor(Array.from({ length: 4 }, () => ({ status: 302, location: "/outro" })));
    await expect(baixarVideoPublico("https://cdn.example/video")).rejects.toThrow("Redirecionamento");
    expect(rede.request).toHaveBeenCalledTimes(4);
    expect(rede.lookup).toHaveBeenCalledTimes(4);
  });

  it("aborta a conexão pendente sem devolver dados de infraestrutura", async () => {
    const controle = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controle.signal);
    servidor([]);
    const promessa = baixarVideoPublico("https://cdn.example/video");
    const rejeicao = expect(promessa).rejects.toThrow("Não foi possível");
    await vi.waitFor(() => expect(rede.request).toHaveBeenCalledTimes(1));
    controle.abort();
    await rejeicao;
  });

  it("IP literal recusado não deixa rejeição de timeout solta", async () => {
    const controle = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controle.signal);
    await expect(baixarVideoPublico("https://127.0.0.1/video")).rejects.toThrow("permitido");
    controle.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rede.lookup).not.toHaveBeenCalled();
    expect(rede.request).not.toHaveBeenCalled();
  });
});
