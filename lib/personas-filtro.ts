import type { Persona } from "./personas";

export type FiltroPersonas = {
  q: string;
  origem: string | null;
  arquetipo: string | null;
  conector: string | null;
  pilar: string | null;
};

export const FILTRO_VAZIO: FiltroPersonas = { q: "", origem: null, arquetipo: null, conector: null, pilar: null };

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Aplica busca (nome, slogan, arquétipo) e facetas; preserva a ordem original. */
export function filtrarPersonas(personas: Persona[], f: FiltroPersonas): Persona[] {
  const qn = norm(f.q.trim());
  return personas.filter(
    (p) =>
      (!f.origem || p.origem === f.origem) &&
      (!f.arquetipo || p.arquetipo === f.arquetipo) &&
      (!f.conector || p.conectores.includes(f.conector)) &&
      (!f.pilar || p.pilares.some((pl) => pl.nome === f.pilar)) &&
      (!qn || norm(`${p.nome} ${p.slogan} ${p.arquetipo}`).includes(qn)),
  );
}

export type Faceta = [valor: string, n: number][];

function contar(valores: string[][]): Faceta {
  const c = new Map<string, number>();
  for (const vs of valores) for (const v of new Set(vs)) c.set(v, (c.get(v) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Facetas derivadas dos dados (contagens por persona, não por ocorrência). */
export function facetasPersonas(personas: Persona[]) {
  return {
    origem: contar(personas.map((p) => [p.origem])),
    arquetipo: contar(personas.map((p) => [p.arquetipo])),
    conector: contar(personas.map((p) => p.conectores)),
    pilar: contar(personas.map((p) => p.pilares.map((pl) => pl.nome))),
  };
}
