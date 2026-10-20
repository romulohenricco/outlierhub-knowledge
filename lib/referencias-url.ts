/**
 * Filtros da página /referencias ⇄ query string — a URL é compartilhável e
 * reabre exatamente o mesmo recorte (fonte, domínio, coleções, perfil, busca,
 * favoritos, antipatterns e quantas páginas já estavam carregadas).
 *
 *   /referencias?fonte=youtube&col=INFO&col=Takes&pag=2
 */
export type FiltrosRefs = {
  q: string;
  plataforma: string | null;
  dominio: string | null;
  perfil: string | null;
  colecoes: string[];
  favoritos: boolean;
  antipatterns: boolean;
  /** nº de páginas de cards carregadas (1 = só a primeira) */
  paginas: number;
};

export const FILTROS_VAZIOS: FiltrosRefs = {
  q: "",
  plataforma: null,
  dominio: null,
  perfil: null,
  colecoes: [],
  favoritos: false,
  antipatterns: false,
  paginas: 1,
};

type Entrada = URLSearchParams | Record<string, string | string[] | undefined>;

function todos(sp: Entrada, k: string): string[] {
  if (sp instanceof URLSearchParams) return sp.getAll(k);
  const v = sp[k];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function um(sp: Entrada, k: string): string | null {
  const v = todos(sp, k)[0]?.trim();
  return v ? v : null;
}

export function lerFiltros(sp: Entrada): FiltrosRefs {
  const pag = Number.parseInt(um(sp, "pag") ?? "", 10);
  return {
    q: um(sp, "q") ?? "",
    plataforma: um(sp, "fonte"),
    dominio: um(sp, "dominio"),
    perfil: um(sp, "perfil"),
    colecoes: [...new Set(todos(sp, "col").filter(Boolean))],
    favoritos: um(sp, "fav") === "1",
    antipatterns: um(sp, "ap") === "1",
    paginas: Number.isFinite(pag) && pag > 1 ? Math.min(pag, 1000) : 1,
  };
}

/** Só grava o que difere do padrão — URL limpa quando não há filtro. */
export function escreverFiltros(f: FiltrosRefs): string {
  const sp = new URLSearchParams();
  if (f.plataforma) sp.set("fonte", f.plataforma);
  if (f.dominio) sp.set("dominio", f.dominio);
  for (const c of f.colecoes) sp.append("col", c);
  if (f.perfil) sp.set("perfil", f.perfil);
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.favoritos) sp.set("fav", "1");
  if (f.antipatterns) sp.set("ap", "1");
  if (f.paginas > 1) sp.set("pag", String(f.paginas));
  return sp.toString();
}
