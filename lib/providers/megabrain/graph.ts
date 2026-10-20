/**
 * Implementação de referência de `KnowledgeGraphProvider` — camada fina sobre
 * lib/kg.ts (que continua fazendo `execFile('sqlite3', ['-readonly', '-json', ...])`
 * exatamente como antes). Migração 1:1: zero mudança de comportamento, só de
 * camada.
 */
import { access } from "node:fs/promises";
import {
  KG_DB,
  grafo,
  grafoReferencias,
  evidencias,
  fontesDoConceito,
  kgStats,
} from "@/lib/kg";
import { grafoTopologia, impactoDeMover } from "@/lib/topologia";
import type {
  KnowledgeGraphProvider,
  GrafoOpts,
  GrafoReferenciasOpts,
  GrafoResultado,
  GrafoTopologiaOpts,
  GrafoTopologiaResultado,
  ImpactoDeMover,
  EvidenciaEnriquecida,
  FontesDoConceito,
  KgStats,
} from "../types";

export class MegabrainGraphProvider implements KnowledgeGraphProvider {
  grafo(opts: GrafoOpts): Promise<GrafoResultado> {
    return grafo(opts);
  }

  grafoReferencias(opts: GrafoReferenciasOpts): Promise<GrafoResultado> {
    return grafoReferencias(opts);
  }

  grafoTopologia(opts: GrafoTopologiaOpts): Promise<GrafoTopologiaResultado> {
    return grafoTopologia(opts);
  }

  impactoDeMover(alvo: string): Promise<ImpactoDeMover | null> {
    return impactoDeMover(alvo);
  }

  evidencias(edgeId: number): Promise<EvidenciaEnriquecida[]> {
    return evidencias(edgeId);
  }

  fontesDoConceito(conceitoId: string): Promise<FontesDoConceito> {
    return fontesDoConceito(conceitoId);
  }

  kgStats(): Promise<KgStats> {
    return kgStats() as Promise<KgStats>;
  }
}

/** true se o sqlite do grafo existir no filesystem — usado pelo status() do provider combinado. */
export async function kgDbExiste(): Promise<boolean> {
  try {
    await access(KG_DB);
    return true;
  } catch {
    return false;
  }
}

export { KG_DB };
