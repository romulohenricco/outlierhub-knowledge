import { readFile } from "node:fs/promises";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBook, resolveFilePath } from "@/lib/catalog";
import { renderTexto } from "@/lib/render-texto";
import { LeitorPdf, LeitorTexto } from "@/components/Leitor";

export const dynamic = "force-dynamic";

export default async function LerPage(ctx: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { id } = await ctx.params;
  const { page, q } = await ctx.searchParams;
  const livro = await getBook(id);
  if (!livro) notFound();

  let html: string | null = null;
  if (livro.formato !== "pdf") {
    const p = await resolveFilePath(id);
    // catálogo à frente da pasta (ou arquivo ilegível): aviso na tela, não 500 com o caminho
    const raw = p ? await readFile(p, "utf-8").catch(() => null) : null;
    if (raw === null) {
      return (
        <main className="mx-auto max-w-2xl px-6 py-16">
          <Link href={`/livro/${livro.id}`} className="text-sm text-white/40 hover:text-white/80">
            ← {livro.titulo}
          </Link>
          <h1 className="mt-6 text-xl font-semibold">Arquivo indisponível</h1>
          <p className="mt-3 text-[14px] text-[var(--bl-text-secondary)]">
            O catálogo lista este livro, mas o arquivo não está na pasta de livros. Confira se ele está em{" "}
            <code>data/livros/arquivos/</code> (ou na pasta definida em <code>BILHON_LIVROS_DIR</code>).
          </p>
        </main>
      );
    }
    html = renderTexto(raw, livro.formato);
  }

  const paginaInicial = page ? Math.max(1, Number(page) || 1) : undefined;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-3 flex items-baseline gap-3">
        <Link href={`/livro/${livro.id}`} className="text-sm text-white/40 hover:text-white/80">
          ← {livro.titulo}
        </Link>
        {paginaInicial && (
          <span className="text-xs text-white/30">
            aberto na pág. ~{paginaInicial} (estimada pela evidência do grafo)
          </span>
        )}
        {q && (
          <span className="text-xs text-emerald-300/70">trecho da evidência destacado ↓</span>
        )}
      </div>
      {livro.formato === "pdf" ? (
        <LeitorPdf livro={livro} paginaInicial={paginaInicial} />
      ) : (
        <LeitorTexto livro={livro} html={html!} destaque={q} />
      )}
    </main>
  );
}
