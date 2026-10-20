import type { Livro } from "@/lib/types";

/** Paleta de placeholders tipográficos (livros sem capa: TXT/MD). */
const PALETA = ["#3b5bdb", "#7048e8", "#0b7285", "#e8590c", "#c92a2a", "#5f3dc4", "#087f5b", "#862e9c"];
const COR_NEUTRA = "#495057";

/** Cor estável por tema: o mesmo texto cai sempre na mesma cor, sem depender de uma
 *  lista fixa de temas (o catálogo de cada pessoa tem os seus). */
function corDoTema(tema: string): string {
  if (!tema || tema === "Outros") return COR_NEUTRA;
  let h = 0;
  for (const ch of tema) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return PALETA[h % PALETA.length];
}

export function Capa({ livro, grande = false }: { livro: Livro; grande?: boolean }) {
  if (livro.temCapa) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/covers/${livro.id}`}
        alt={`Capa de ${livro.titulo}`}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    );
  }
  const cor = corDoTema(livro.tema);
  return (
    <div
      className="flex h-full w-full flex-col justify-between p-3"
      style={{ background: `linear-gradient(160deg, ${cor} 0%, #16171a 130%)` }}
    >
      <span
        className={`font-semibold leading-snug text-white/95 ${grande ? "text-xl" : "text-[13px]"}`}
        style={{ display: "-webkit-box", WebkitLineClamp: grande ? 8 : 5, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {livro.titulo}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-white/50">
        {livro.formato} · {livro.tema}
      </span>
    </div>
  );
}
