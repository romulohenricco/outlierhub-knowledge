import { statusValido, type StatusTriagem } from "./triagem";

export const MAX_IDS_TRIAGEM = 5000;

/**
 * Corpo aceito pelas rotas de decisão: `{ ids: string[], status: "descartado" | "manter" | "referencia" | null }`.
 * `null` quando o JSON não vem, não é objeto, a lista está vazia/grande demais ou o status é desconhecido
 * (a rota responde 400: o erro é do pedido, não do servidor).
 */
export function lerCorpoTriagem(corpo: unknown): { ids: unknown[]; status: StatusTriagem | null } | null {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return null;
  const { ids, status } = corpo as { ids?: unknown; status?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS_TRIAGEM) return null;
  if (!statusValido(status)) return null;
  return { ids, status };
}
