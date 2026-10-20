import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranscript } from "@/lib/colecoes";
import { renderTexto } from "@/lib/render-texto";
import { LeitorTexto } from "@/components/Leitor";
import type { Livro } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TranscriptPage(ctx: {
  params: Promise<{ slug: string; doc: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug, doc } = await ctx.params;
  const { q } = await ctx.searchParams;
  const t = await getTranscript(decodeURIComponent(slug), decodeURIComponent(doc));
  if (!t) notFound();

  const html = renderTexto(t.texto, "txt");
  // objeto mínimo pro leitor (posição de leitura própria por transcript)
  const pseudoLivro = {
    id: `col:${slug}:${t.doc}`,
    titulo: t.titulo,
  } as unknown as Livro;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <Link
          href={`/colecao/${encodeURIComponent(slug)}`}
          className="text-sm text-white/40 hover:text-white/80"
        >
          ← {decodeURIComponent(slug)}
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm text-white/70">{t.titulo}</span>
        {t.youtubeUrl && (
          <a
            href={t.youtubeUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-2.5 py-1 text-[11px] text-white/60 hover:bg-[var(--bl-bg-card-hover)]"
          >
            ▶ ver no YouTube (se ainda existir)
          </a>
        )}
        {q && <span className="text-xs text-emerald-300/70">trecho destacado ↓</span>}
      </div>
      <p className="mb-3 text-[11px] text-[var(--bl-text-muted)]">
        💾 Transcript completo preservado LOCALMENTE ({t.chunks} chunks do corpus) —
        independe do vídeo continuar no ar.
      </p>
      <LeitorTexto livro={pseudoLivro} html={html} destaque={q} />
    </main>
  );
}
