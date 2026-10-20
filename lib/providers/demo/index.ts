/**
 * DemoProvider — segunda implementação de `KnowledgeProvider`, prova viva de
 * plugabilidade: nasce de fixtures estáticas, nunca depende de infra
 * externa, por isso `status()` é sempre `{ configured: true }`.
 */
import type { KnowledgeProvider, ProviderStatus } from "../types";
import { DemoGraphProvider } from "./graph";
import { DemoSearchProvider } from "./search";

export class DemoProvider implements KnowledgeProvider {
  private graph = new DemoGraphProvider();
  private search_ = new DemoSearchProvider();

  grafo: DemoGraphProvider["grafo"] = (opts) => this.graph.grafo(opts);
  grafoReferencias: DemoGraphProvider["grafoReferencias"] = (opts) => this.graph.grafoReferencias(opts);
  grafoTopologia: DemoGraphProvider["grafoTopologia"] = () => this.graph.grafoTopologia();
  impactoDeMover: DemoGraphProvider["impactoDeMover"] = () => this.graph.impactoDeMover();
  evidencias: DemoGraphProvider["evidencias"] = (edgeId) => this.graph.evidencias(edgeId);
  fontesDoConceito: DemoGraphProvider["fontesDoConceito"] = (conceitoId) =>
    this.graph.fontesDoConceito(conceitoId);
  kgStats: DemoGraphProvider["kgStats"] = () => this.graph.kgStats();
  search: DemoSearchProvider["search"] = (query, topK) => this.search_.search(query, topK);

  async status(): Promise<ProviderStatus> {
    return { configured: true };
  }
}
