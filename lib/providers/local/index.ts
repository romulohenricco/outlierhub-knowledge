/**
 * LocalProvider — terceira implementação de `KnowledgeProvider`, 100% local:
 *  - grafo: o mesmo adapter do provider "supabase" (`MegabrainGraphProvider`,
 *    sqlite em BILHON_KG_DB / data/kg/livros-kg.sqlite), reusado por composição;
 *  - busca: índice FTS5 em BILHON_LOCAL_SEARCH_DB / data/search/index.sqlite
 *    (lexical, bm25), sem Supabase, sem Ollama, sem rede.
 * Tudo que o populate gera (`npm run populate`) alimenta este provider.
 * Contrato do índice, limites e segurança: docs/provider-local.md.
 */
import type { KnowledgeProvider, ProviderStatus } from "../types";
import { MegabrainGraphProvider, kgDbExiste } from "../megabrain/graph";
import { LocalSearchProvider, diagnosticoIndiceLocal } from "./search";

export class LocalProvider implements KnowledgeProvider {
  private graph = new MegabrainGraphProvider();
  private search_ = new LocalSearchProvider();

  grafo: MegabrainGraphProvider["grafo"] = (opts) => this.graph.grafo(opts);
  grafoReferencias: MegabrainGraphProvider["grafoReferencias"] = (opts) =>
    this.graph.grafoReferencias(opts);
  evidencias: MegabrainGraphProvider["evidencias"] = (edgeId) => this.graph.evidencias(edgeId);
  fontesDoConceito: MegabrainGraphProvider["fontesDoConceito"] = (conceitoId) =>
    this.graph.fontesDoConceito(conceitoId);
  kgStats: MegabrainGraphProvider["kgStats"] = () => this.graph.kgStats();
  grafoTopologia: MegabrainGraphProvider["grafoTopologia"] = (opts) => this.graph.grafoTopologia(opts);
  impactoDeMover: MegabrainGraphProvider["impactoDeMover"] = (alvo) => this.graph.impactoDeMover(alvo);
  search: LocalSearchProvider["search"] = (query, topK) => this.search_.search(query, topK);

  async status(): Promise<ProviderStatus> {
    const indice = await diagnosticoIndiceLocal();
    if (!indice.ok) {
      return {
        configured: false,
        reason: `Provider "local" sem índice de busca — ${indice.motivo} Alternativa: BILHON_KNOWLEDGE_PROVIDER=demo.`,
      };
    }
    const base = `Busca local ativa (${indice.trechos} trechos de ${indice.arquivos} arquivos; lexical, FTS5).`;
    // grafo ausente é um estado normal (modo somente-busca), não um erro
    if (await kgDbExiste()) return { configured: true, reason: base };
    return {
      configured: true,
      reason: `${base} Grafo local ainda não gerado (sqlite ausente, ver BILHON_KG_DB) — modo somente-busca.`,
    };
  }
}
