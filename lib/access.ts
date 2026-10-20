/** Acesso externo exige configuração e JWT válidos; localhost funciona offline. */
// Só loopback, com ou sem porta. 0.0.0.0 é endereço de escuta (não um destino) e
// "::1" sem colchetes não é um Host válido: nenhum dos dois conta como local.
export const HOSTS_LOCAIS: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];

/**
 * Cabeçalhos que só um intermediário (proxy, túnel, CDN) coloca no pedido: a
 * presença de qualquer um já basta. Um navegador falando direto com a porta
 * local não envia nenhum deles. Os X-Forwarded-* ficam de fora porque o Next os
 * preenche em todo pedido — ver `encaminhadoPorOutro`.
 */
export const CABECALHOS_DE_PROXY: readonly string[] = [
  "forwarded", "x-real-ip", "true-client-ip", "cf-connecting-ip", "cf-ray", "cdn-loop", "via",
];
export const EXIGE_ACCESS_QUANDO = ((process.env.BILHON_ACCESS_HOSTS || undefined) ?? "")
  .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
export const ACCESS_TEAM = process.env.BILHON_ACCESS_TEAM?.trim() ?? "";
export const ACCESS_AUD = process.env.BILHON_ACCESS_AUD?.trim() ?? "";
export const ACCESS_EMAIL = process.env.BILHON_ACCESS_EMAIL?.trim() ?? "";
export const ACCESS_CONFIGURADO = /^[a-z0-9-]+$/i.test(ACCESS_TEAM) && !!ACCESS_AUD && !!ACCESS_EMAIL;
export const ACCESS_ISSUER = ACCESS_CONFIGURADO ? `https://${ACCESS_TEAM}.cloudflareaccess.com` : "";
export const ACCESS_JWKS_URL = ACCESS_CONFIGURADO ? `${ACCESS_ISSUER}/cdn-cgi/access/certs` : "";

export function precisaDeAccess(host: string | null | undefined): boolean {
  if (!host) return true;
  const normalized = host.trim().toLowerCase();
  return !HOSTS_LOCAIS.includes(normalized.replace(/:\d+$/, ""));
}

/** Endereço de loopback puro (IPv4, IPv6 ou IPv4 mapeado), sem lista nem porta. */
const RE_LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/i;

/**
 * O Next preenche X-Forwarded-For/-Host/-Proto em TODO pedido — endereço do socket,
 * o Host recebido e "http" (o servidor local não fala TLS) — e só preserva o que já
 * veio no pedido. Então a presença desses cabeçalhos não prova nada: o que denuncia
 * um intermediário é um valor que o Next não teria escrito (origem fora do loopback
 * ou em lista, Host reescrito, protocolo https).
 */
function encaminhadoPorOutro(headers: Headers): boolean {
  if (CABECALHOS_DE_PROXY.some((nome) => headers.has(nome))) return true;
  const de = headers.get("x-forwarded-for");
  if (de !== null && !RE_LOOPBACK.test(de.trim().replace(/^\[|\]$/g, ""))) return true;
  const host = headers.get("x-forwarded-host");
  if (host !== null && host.trim().toLowerCase() !== (headers.get("host") ?? "").trim().toLowerCase()) return true;
  const proto = headers.get("x-forwarded-proto");
  return proto !== null && proto.trim().toLowerCase() !== "http";
}

/**
 * Decide se o pedido precisa passar pelo Access. O Host sozinho não basta: quem
 * alcança a porta escolhe o Host, e proxies e túneis o reescrevem para o endereço
 * do servidor (127.0.0.1) — nesses casos todo o tráfego externo pareceria local.
 * Qualquer sinal de intermediário torna o pedido externo, mesmo com Host de loopback.
 */
export function exigeAccess(headers: Headers): boolean {
  return precisaDeAccess(headers.get("host")) || encaminhadoPorOutro(headers);
}

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);
const SITES_PROPRIOS = new Set(["same-origin", "none"]);

/**
 * Escrita disparada por outra origem (CSRF). Qualquer página aberta no mesmo
 * navegador consegue enviar um POST "simples" para a porta local, e o Host local
 * o deixaria passar. Nega quando o navegador declara Sec-Fetch-Site diferente de
 * same-origin/none, ou quando o Origin não é o próprio Host. Clientes sem esses
 * cabeçalhos (curl, scripts) não são afetados: o risco aqui é o navegador do
 * usuário sendo usado por terceiros.
 */
export function origemCruzada(metodo: string, headers: Headers): boolean {
  if (METODOS_SEGUROS.has(metodo.toUpperCase())) return false;
  const site = headers.get("sec-fetch-site");
  if (site !== null && !SITES_PROPRIOS.has(site.trim().toLowerCase())) return true;
  const origem = headers.get("origin");
  if (origem === null) return false;
  try {
    return new URL(origem).host.toLowerCase() !== (headers.get("host") ?? "").trim().toLowerCase();
  } catch {
    return true; // "null" (iframe isolado, file://) ou lixo: não dá para provar a origem
  }
}

export function extrairToken(headers: Headers): string | null {
  const assertion = headers.get("cf-access-jwt-assertion");
  if (assertion) return assertion;
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "CF_Authorization" && value.length) return value.join("=");
  }
  return null;
}
