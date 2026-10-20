import type { PaginaReferencia, ReferenciaPost } from "./referencias";

export type GrupoDeImagens = {
  /** null = post comum, sem cabeçalho de página */
  titulo: string | null;
  pagina?: PaginaReferencia;
  /** idx é 1-based no `images` do post — é o que videoIdx e as chaves de cópia usam */
  imagens: { img: string; idx: number }[];
};

/**
 * Agrupa as imagens do card aberto por página. Post comum vira um grupo só.
 * Imagem que a página cita mas o post não tem é descartada; imagem do post que
 * nenhuma página cita vai para "outras", para nunca sumir em silêncio.
 */
export function paginasDe(p: ReferenciaPost): GrupoDeImagens[] {
  const idx = new Map(p.images.map((img, i) => [img, i + 1]));
  if (!p.paginas?.length) {
    return [
      {
        titulo: null,
        imagens: p.images.map((img, i) => ({ img, idx: i + 1 })),
      },
    ];
  }
  const citadas = new Set<string>();
  const grupos: GrupoDeImagens[] = p.paginas.map((pagina) => ({
    titulo: pagina.titulo,
    pagina,
    imagens: pagina.images.flatMap((img) => {
      const n = idx.get(img);
      if (n === undefined) return [];
      citadas.add(img);
      return [{ img, idx: n }];
    }),
  }));
  const resto = p.images.flatMap((img, i) =>
    citadas.has(img) ? [] : [{ img, idx: i + 1 }],
  );
  if (resto.length) grupos.push({ titulo: "outras", imagens: resto });
  return grupos;
}
