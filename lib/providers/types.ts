/**
 * Contrato de provider. Duas interfaces mínimas — grafo de conhecimento e
 * busca semântica — implementadas por `megabrain/` (grafo em sqlite local +
 * busca no Supabase do próprio usuário) e `demo/` (fixtures sintéticas, zero
 * infra externa). Trocar de provider não deve exigir tocar nada fora de
 * `lib/providers/`.
 *
 * Os tipos de nó/aresta (`KgNode`/`KgEdge`) e de hit de busca (`SearchHit`)
 * são os mesmos que o app usa em outros pontos — aqui só ficam encapsulados
 * atrás de uma interface.
 */
import type { KgNode, KgEdge } from "@/lib/kg";
import type { GrafoTopologiaOpts, GrafoTopologiaResultado, ImpactoDeMover } from "@/lib/topologia";
import type { SearchHit } from "@/lib/types";

export type { KgNode, KgEdge };

export type GrafoOpts = {
  status: string[];
  tema?: string;
  incluirLivros?: boolean;
  maxEdges?: number;
  /** nó que tem que vir mesmo fora do corte das arestas mais citadas (deep-link ?focus=) */
  foco?: string;
};

export type GrafoReferenciasOpts = {
  refs: boolean;
  videos: boolean;
};

export type GrafoResultado = {
  nodes: KgNode[];
  edges: KgEdge[];
};

export type { GrafoTopologiaOpts, GrafoTopologiaResultado, ImpactoDeMover };

export type EvidenciaEnriquecida = {
  livro: string;
  chunk_id: string;
  trecho: string;
  confianca: number;
  livroId: string | null;
  livroTitulo: string;
  formato: string | null;
  chunkIdx: number;
  paginaEstimada: number | null;
  clickup: { url: string; pasta: string; lista: string } | null;
  youtube: { titulo: string; url: string; canal: string } | null;
};

export type FontesDoConceito = {
  livros: string[];
  relacoes: string[];
  vizinhos: string[];
};

export type KgStats = {
  conceitos: number;
  livros: number;
  confirmed: number;
  claimed: number;
  disputed: number;
};

/** Toda leitura de grafo passa por aqui, nunca por sqlite3 direto.
 *  `grafoTopologia` é a 2ª camada do canvas: o disco como
 *  nós/arestas. Provider que não tenha topologia devolve camada vazia com
 *  `meta.totalNos = 0` — nunca lança. */
export interface KnowledgeGraphProvider {
  grafo(opts: GrafoOpts): Promise<GrafoResultado>;
  grafoReferencias(opts: GrafoReferenciasOpts): Promise<GrafoResultado>;
  grafoTopologia(opts: GrafoTopologiaOpts): Promise<GrafoTopologiaResultado>;
  /** "Se eu mover X, o que quebra". null = nenhum nó cobre o caminho. */
  impactoDeMover(alvo: string): Promise<ImpactoDeMover | null>;
  evidencias(edgeId: number): Promise<EvidenciaEnriquecida[]>;
  fontesDoConceito(conceitoId: string): Promise<FontesDoConceito>;
  kgStats(): Promise<KgStats>;
}

/** Toda busca semântica passa por aqui, nunca por execFile direto. */
export interface SemanticSearchProvider {
  search(query: string, topK?: number): Promise<SearchHit[]>;
}

/** Erro tipado de busca — a rota mapeia `code` pro `erro` de `SearchResposta`
 *  (lib/types.ts), preservando os 2 códigos que o app já trata hoje. */
export class ProviderSearchError extends Error {
  code: "ollama-offline" | "backend";
  constructor(code: "ollama-offline" | "backend", message: string) {
    super(message);
    this.name = "ProviderSearchError";
    this.code = code;
  }
}

export type ProviderStatus = {
  configured: boolean;
  /** preenchido quando configured=false — vira a mensagem de onboarding. */
  reason?: string;
};

export interface KnowledgeProvider extends KnowledgeGraphProvider, SemanticSearchProvider {
  status(): Promise<ProviderStatus>;
}
