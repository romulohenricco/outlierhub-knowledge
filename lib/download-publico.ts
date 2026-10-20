import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import type { IncomingMessage } from "node:http";

const privados = new BlockList();
for (const [ip, prefixo] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) privados.addSubnet(ip, prefixo, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [ip, prefixo] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16]] as const) {
  privados.addSubnet(ip, prefixo, "ipv6");
}

/** Apenas endereços públicos: inclusive IPv4 mapeado/loopback IPv6 são recusados. */
export function enderecoPublico(ip: string): boolean {
  const familia = isIP(ip);
  if (familia === 4) return !privados.check(ip, "ipv4");
  return familia === 6 && globalV6.check(ip, "ipv6") && !privados.check(ip, "ipv6");
}

export function urlDownloadPublico(bruta: string): URL {
  const url = new URL(bruta);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Vídeo exige uma URL HTTPS pública sem credenciais.");
  }
  return url;
}

async function enderecos(url: URL, signal: AbortSignal) {
  signal.throwIfAborted();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const familia = isIP(host);
  let resolvidos: { address: string; family: number }[];
  if (familia) {
    resolvidos = [{ address: host, family: familia }];
  } else {
    let aoAbortar = () => {};
    const abortado = new Promise<never>((_resolve, reject) => {
      aoAbortar = () => reject(new Error("Tempo do download esgotado."));
      signal.addEventListener("abort", aoAbortar, { once: true });
    });
    try {
      resolvidos = await Promise.race([lookup(host, { all: true, verbatim: true }), abortado]);
    } finally {
      signal.removeEventListener("abort", aoAbortar);
    }
  }
  signal.throwIfAborted();
  if (!resolvidos.length || resolvidos.some((e) => !enderecoPublico(e.address))) {
    throw new Error("Destino de vídeo não permitido.");
  }
  return resolvidos.find((e) => e.family === 4) ?? resolvidos[0];
}

/** O endereço validado é fixado na conexão; não há uma segunda resolução DNS. */
async function abrir(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const fixado = await enderecos(url, signal);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      signal,
      agent: false,
      family: fixado.family,
      lookup: (_hostname, _options, callback) => callback(null, fixado.address, fixado.family),
      headers: { "Accept-Encoding": "identity", "User-Agent": "Knowledge/1.0" },
    }, resolve);
    req.on("error", () => reject(new Error("Não foi possível baixar o vídeo.")));
    req.end();
  });
}

/** Limita o corpo real, mesmo sem Content-Length ou com cabeçalho mentiroso. */
export async function lerDownloadLimitado(resposta: IncomingMessage, limite: number): Promise<Buffer> {
  const declarado = Number(resposta.headers["content-length"]);
  if (Number.isFinite(declarado) && declarado > limite) {
    resposta.destroy();
    throw new Error("Vídeo maior que o limite de download.");
  }
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const parte of resposta) {
    const bytes = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
    tamanho += bytes.length;
    if (tamanho > limite) {
      resposta.destroy();
      throw new Error("Vídeo maior que o limite de download.");
    }
    partes.push(bytes);
  }
  return Buffer.concat(partes, tamanho);
}

/** HTTPS público, DNS fixado, redirects revalidados e 100 MB/30 s no total. */
export async function baixarVideoPublico(bruta: string): Promise<Buffer> {
  const sinal = AbortSignal.timeout(30_000);
  let url = urlDownloadPublico(bruta);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const resposta = await abrir(url, sinal);
    const status = resposta.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      resposta.destroy();
      const destino = resposta.headers.location;
      if (!destino || redirects === 3) throw new Error("Redirecionamento de vídeo não permitido.");
      url = urlDownloadPublico(new URL(destino, url).href);
      continue;
    }
    if (status < 200 || status >= 300) {
      resposta.destroy();
      throw new Error("O provedor não disponibilizou o vídeo.");
    }
    return lerDownloadLimitado(resposta, 100 * 1024 * 1024);
  }
  throw new Error("Redirecionamento de vídeo não permitido.");
}
