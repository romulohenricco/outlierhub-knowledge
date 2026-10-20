/**
 * Factory de provider — a única coisa que decide qual implementação de
 * `KnowledgeProvider` está viva é `BILHON_KNOWLEDGE_PROVIDER`. Default é
 * "demo", não "supabase": um clone limpo sobe funcional sem nenhuma
 * configuração, em vez de quebrar. Variável em branco vale como ausente — é o
 * estado de um `.env.local` copiado do `.env.example` sem preencher.
 */
import type { KnowledgeProvider } from "./types";
import { MegabrainProvider } from "./megabrain";
import { DemoProvider } from "./demo";

export function getKnowledgeProvider(): KnowledgeProvider {
  const kind = process.env.BILHON_KNOWLEDGE_PROVIDER?.trim() || "demo";
  switch (kind) {
    case "supabase":
    // valor antigo do mesmo provider: segue aceito para não quebrar um
    // .env.local já existente, mas deixou de ser o valor divulgado
    case "megabrain":
      return new MegabrainProvider();
    case "demo":
      return new DemoProvider();
    default:
      // A mensagem chega ao cliente no 503 da rota de busca, então NÃO ecoa o
      // valor — nem "só se for curto e alfanumérico": um token curto passaria
      // nesse filtro. O nome da variável basta pra corrigir.
      throw new Error(
        'BILHON_KNOWLEDGE_PROVIDER inválida — use "demo" ou "supabase" (valor atual não é ecoado por segurança).',
      );
  }
}

export type {
  KnowledgeProvider,
  KnowledgeGraphProvider,
  SemanticSearchProvider,
  ProviderStatus,
  GrafoOpts,
  GrafoReferenciasOpts,
  GrafoResultado,
  EvidenciaEnriquecida,
  FontesDoConceito,
  KgStats,
  KgNode,
  KgEdge,
} from "./types";
export { ProviderSearchError } from "./types";
