/**
 * MegabrainProvider — implementação de referência de `KnowledgeProvider`:
 * grafo (sqlite local, adapter original — ver nota abaixo) + busca semântica
 * (`BilhonCorpusSearchProvider`, RPC no Supabase do próprio usuário).
 * `status()` nunca deixa a UI quebrar com stack trace quando a infra não está
 * configurada.
 *
 * Nota sobre o grafo: ele é lido de um sqlite local (`BILHON_KG_DB`, padrão
 * data/kg/livros-kg.sqlite). Sem esse arquivo o adapter reporta "não
 * configurado" honestamente, em vez de fabricar um grafo a partir de
 * metadados dos chunks.
 */
import type { KnowledgeProvider, ProviderStatus } from "../types";
import { MegabrainGraphProvider, kgDbExiste } from "./graph";
import { BilhonCorpusSearchProvider, bilhonCorpusDiagnostico } from "../bilhon/search";

export class MegabrainProvider implements KnowledgeProvider {
  private graph = new MegabrainGraphProvider();
  private search_ = new BilhonCorpusSearchProvider();

  grafo: MegabrainGraphProvider["grafo"] = (opts) => this.graph.grafo(opts);
  grafoReferencias: MegabrainGraphProvider["grafoReferencias"] = (opts) =>
    this.graph.grafoReferencias(opts);
  evidencias: MegabrainGraphProvider["evidencias"] = (edgeId) => this.graph.evidencias(edgeId);
  fontesDoConceito: MegabrainGraphProvider["fontesDoConceito"] = (conceitoId) =>
    this.graph.fontesDoConceito(conceitoId);
  kgStats: MegabrainGraphProvider["kgStats"] = () => this.graph.kgStats();
  grafoTopologia: MegabrainGraphProvider["grafoTopologia"] = (opts) => this.graph.grafoTopologia(opts);
  impactoDeMover: MegabrainGraphProvider["impactoDeMover"] = (alvo) => this.graph.impactoDeMover(alvo);
  search: BilhonCorpusSearchProvider["search"] = (query, topK) => this.search_.search(query, topK);

  async status(): Promise<ProviderStatus> {
    const kgOk = await kgDbExiste();
    // o diagnóstico do corpus é o MESMO critério da busca: segredo
    // op:// não resolvido ou escopo de bucket não declarado ⇒ configured:false
    // com motivo acionável, em vez de "configurado" e um 503 ilegível depois
    const corpus = bilhonCorpusDiagnostico();
    if (!corpus.ok) {
      return {
        configured: false,
        reason: `Provider "supabase" sem busca configurada — ${corpus.motivo} Alternativa: BILHON_KNOWLEDGE_PROVIDER=demo.`,
      };
    }
    const escopo =
      corpus.escopo === "corpus-inteiro"
        ? "escopo: corpus inteiro (declarado pela sentinela)"
        : "escopo: bucket declarado";
    if (kgOk) return { configured: true, reason: `Busca semântica ativa (${escopo}).` };
    // grafo ausente é um estado normal — configured:true
    // informativo, não aviso permanente
    return {
      configured: true,
      reason: `Busca semântica ativa (${escopo}); grafo local ainda não gerado (sqlite ausente, ver BILHON_KG_DB) — modo somente-busca.`,
    };
  }
}
