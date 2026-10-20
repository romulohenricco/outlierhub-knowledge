/**
 * Configuração do executor externo para onde um ticket pode ser escalado.
 *
 * Tudo vem do ambiente e começa em branco. Variável em branco vale como ausente
 * (um .env copiado do exemplo tem `X=`), e sem BILHON_EXECUTION_URL o recurso
 * está desligado: a rota responde 503 e a UI nem mostra o botão.
 *
 *   BILHON_EXECUTION_URL            endereço do executor (http/https, sem usuário/senha)
 *   BILHON_EXECUTION_PATH           caminho do endpoint de escalonamento; em branco, a
 *                                   própria URL já é o endpoint
 *   BILHON_EXECUTION_DEFAULT_AGENT  agente de destino quando o pedido não informa um;
 *                                   em branco, o corpo enviado não leva `toAgent`
 *
 * Não é um arquivo de rota (Next só roteia `route.ts`).
 */

export type ExecutorConfig =
  | { ok: true; endpoint: URL; agentePadrao: string | null }
  | { ok: false; erro: string };

const env = (nome: string): string => (process.env[nome] || "").trim();

export function lerExecutor(): ExecutorConfig {
  const base = env("BILHON_EXECUTION_URL");
  if (!base) return { ok: false, erro: "Executor externo nao configurado (BILHON_EXECUTION_URL)." };
  try {
    const caminho = env("BILHON_EXECUTION_PATH");
    const endpoint = caminho ? new URL(caminho, base) : new URL(base);
    // credenciais embutidas na URL iriam parar em log e em mensagem de erro
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error();
    return { ok: true, endpoint, agentePadrao: env("BILHON_EXECUTION_DEFAULT_AGENT") || null };
  } catch {
    return { ok: false, erro: "Configuracao do executor externo invalida." };
  }
}
