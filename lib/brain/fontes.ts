/** Pilares ADICIONAIS por fonte: agrupa as entidades do inventário em famílias
 *  derivadas do `path` real (relativo a BILHON_ROOT). A família é a pasta de
 *  primeiro nível do caminho; entidade sem pasta cai em "raiz". Mecanismo puro: os
 *  nomes das famílias vêm do SEU registro, nenhuma lista fixa.
 *
 *  Regras:
 *   - as `MAX_FONTES - 1` maiores famílias viram pilares; as demais se juntam
 *     em "outras" (a soma dos pilares é sempre o total recebido: nada se perde);
 *   - cor por posição na paleta (estável para o mesmo conjunto de dados);
 *   - fonte sem entidade no recorte não gera pilar. */
import type { EcoEntity, EcoKind } from "../types";

/** Teto de pilares de fonte (o anel da visão geral não comporta dezenas). */
export const MAX_FONTES = 8;

export const PALETA_FONTES = ["#ec4899", "#84cc16", "#38bdf8", "#e879f9", "#fde047", "#fb923c", "#2dd4bf", "#a78bfa"];
const COR_OUTRAS = "#94a3b8";

export const FAMILIA_RAIZ = "raiz";
export const FAMILIA_OUTRAS = "outras";

/** Pasta de primeiro nível do caminho da entidade (sem `./` nem barra inicial). */
export function familiaDaFonte(e: EcoEntity): string {
  const p = e.path.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
  const i = p.indexOf("/");
  return i > 0 ? p.slice(0, i) : FAMILIA_RAIZ;
}

export type PilarFonte = {
  id: string;
  /** família (pasta de primeiro nível), ou "outras" */
  slug: string;
  nome: string;
  cor: string;
  total: number;
  porKind: Partial<Record<EcoKind, number>>;
  entidades: EcoEntity[];
  /** Não-squads sem pai resolvido DENTRO do pilar: contadas, nunca ligadas por palpite. */
  avulsos: EcoEntity[];
};

function pilar(slug: string, nome: string, cor: string, entidades: EcoEntity[]): PilarFonte {
  const ids = new Set(entidades.map((e) => e.id));
  const porKind: Partial<Record<EcoKind, number>> = {};
  for (const e of entidades) porKind[e.kind] = (porKind[e.kind] ?? 0) + 1;
  const avulsos = entidades.filter((e) => e.kind !== "squad" && !(e.squadId && ids.has(e.squadId)));
  return { id: `fonte:${slug}`, slug, nome, cor, total: entidades.length, porKind, entidades, avulsos };
}

export function agruparPorFonte(entities: EcoEntity[], max = MAX_FONTES): PilarFonte[] {
  const por = new Map<string, EcoEntity[]>();
  for (const e of entities) {
    const f = familiaDaFonte(e);
    (por.get(f) ?? por.set(f, []).get(f)!).push(e);
  }
  const ord = [...por.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const teto = Math.max(1, max);
  const ficam = ord.length > teto ? ord.slice(0, teto - 1) : ord;
  const resto = ord.length > teto ? ord.slice(teto - 1) : [];
  const saida = ficam.map(([slug, ents], i) => pilar(slug, slug, PALETA_FONTES[i % PALETA_FONTES.length], ents));
  if (resto.length > 0) saida.push(pilar(FAMILIA_OUTRAS, `outras (${resto.length})`, COR_OUTRAS, resto.flatMap(([, ents]) => ents)));
  return saida;
}
