import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Quote, Wand2 } from "lucide-react";
import { getBook } from "@/lib/catalog";
import { conteudoDoLivro, dedupeVizinhos, promptDoLivro } from "@/lib/livro-conteudo";
import { Capa } from "@/components/Capa";
import { Copiar } from "@/components/Copiar";

export const dynamic = "force-dynamic";

function mb(n: number) {
  return `${(n / 1048576).toFixed(1)} MB`;
}

const H2 = "text-xs font-semibold uppercase tracking-wider text-[var(--bl-text-dim)]";

export default async function LivroPage(ctx: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await ctx.params;
  const livro = await getBook(id);
  if (!livro) notFound();
  const c = await conteudoDoLivro(livro);
  const vizinhos = dedupeVizinhos(livro.vizinhos);
  const prompt = promptDoLivro({ ...livro, ...c, conceitos: c.conceitos.slice(0, 8) });
  const lerNa = (pagina: number | null) =>
    livro.formato === "pdf" && pagina ? `/ler/${livro.id}?page=${pagina}` : `/ler/${livro.id}`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-col gap-8 md:flex-row">
        <div className="w-56 shrink-0 space-y-3 md:sticky md:top-6 md:self-start">
          <div className="aspect-[2/3] overflow-hidden rounded-[var(--bl-radius-md)] border border-[var(--bl-border)]">
            <Capa livro={livro} grande />
          </div>

          {/* prompt de estudo — o equivalente do "prompt reverso" das Referências */}
          <div className="rounded-[var(--bl-radius-sm)] border border-[#ff0000]/20 bg-[#ff0000]/[0.04] p-2">
            <div className="flex items-center gap-1.5 text-[11px]">
              <Wand2 className="h-3 w-3 shrink-0 text-[#ff0000]/70" />
              <span className="font-medium text-white/70">prompt de estudo</span>
              <Copiar
                texto={prompt}
                title="copiar contexto do livro pra colar num agente"
                className="ml-auto text-white/40 hover:text-white/80"
                icone="h-3 w-3"
              />
            </div>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[10.5px] leading-snug text-white/50">
              {prompt}
            </p>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h1 className="text-2xl font-semibold leading-tight">{livro.titulo}</h1>
            <Copiar texto={livro.titulo} title="copiar título" className="mt-2 text-white/25 hover:text-white/70" />
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--bl-text-dim)]">
            {livro.dominio && (
              <span className="bl-badge bl-badge-accent">{livro.dominio}</span>
            )}
            {c.nivelNome && <span className="bl-badge bl-badge-ghost">{c.nivelNome}</span>}
            <span>
              {livro.tema}
              {livro.cluster ? ` · cluster ${livro.cluster}` : " · solitário"} ·{" "}
              {livro.formato.toUpperCase()} · {mb(livro.sizeBytes)} · {livro.origem}
            </span>
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href={`/ler/${livro.id}`}
              className="inline-flex items-center gap-2 rounded-[var(--bl-radius-md)] border border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-solid)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--bl-bg-card-hover)]"
            >
              <BookOpen className="h-4 w-4" /> Ler agora
            </Link>
            <Link
              href={`/grafo?focus=${encodeURIComponent(`livro:${livro.arquivo}`)}`}
              className="inline-flex items-center gap-2 rounded-[var(--bl-radius-md)] border border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-solid)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--bl-bg-card-hover)]"
            >
              ⊕ Ver no grafo
            </Link>
            <Copiar
              texto={livro.path}
              rotulo="Copiar caminho"
              title="copiar caminho do arquivo (colar no terminal)"
              className="rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-4 py-2.5 text-sm text-white/70 hover:border-[var(--bl-border-hover)] hover:text-white"
              icone="h-4 w-4"
            />
          </div>

          <p className="mt-3 break-all font-mono text-[11px] text-white/30">
            📁 {livro.path}
            {livro.paginas ? ` · ${livro.paginas} págs.` : ""} · {livro.chunksTotal}{" "}
            chunks indexados
          </p>
          {livro.checksum && (
            <p
              className="mt-1 flex items-center gap-2 break-all font-mono text-[11px] text-white/25"
              title="content_checksum (SHA-256)"
            >
              ⬡ {livro.checksum}
              <Copiar texto={livro.checksum} title="copiar hash" className="text-white/20 hover:text-white/70" icone="h-3 w-3" />
            </p>
          )}

          {c.sinopse && (
            <section className="mt-8">
              <h2 className={H2}>Sobre</h2>
              <p className="mt-3 flex items-start gap-2 rounded-[var(--bl-radius-md)] bg-[var(--bl-accent-soft,rgba(255,255,255,0.04))] p-3 text-sm leading-relaxed text-[var(--bl-accent)]/85">
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {c.sinopse}
                  <span className="mt-1 block text-[10px] text-white/25">
                    {c.sinopseFonte === "llm-local"
                      ? "sinopse gerada por modelo local (livros-sinopses.json)"
                      : "classificação de registro editorial (niveis.json)"}
                  </span>
                </span>
              </p>
            </section>
          )}

          {c.conceitos.length > 0 && (
            <section className="mt-8">
              <h2 className={H2}>Conceitos-chave</h2>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.conceitos.map((k) => (
                  <Link
                    key={k}
                    href={`/grafo?focus=${encodeURIComponent(k)}`}
                    className="rounded-full border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-2.5 py-1 text-xs text-white/65 hover:border-[var(--bl-border-hover)] hover:text-white"
                    title="abrir o conceito no grafo"
                  >
                    {k}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {c.abertura && (
            <section className="mt-8">
              <h2 className={H2}>Abertura</h2>
              <blockquote className="mt-3 whitespace-pre-line border-l-2 border-[var(--bl-border-hover)] pl-4 text-sm leading-relaxed text-white/65">
                {c.abertura}
              </blockquote>
              <Link href={`/ler/${livro.id}`} className="mt-2 inline-block text-xs text-white/40 hover:text-white/80">
                continuar lendo →
              </Link>
            </section>
          )}

          {c.sumario.length > 0 && (
            <section className="mt-8">
              <h2 className={H2}>Sumário</h2>
              <ol className="mt-3 grid gap-x-6 gap-y-1 text-sm text-white/60 sm:grid-cols-2">
                {c.sumario.map((s, i) => (
                  <li key={`${i}-${s}`} className="truncate" title={s}>
                    <span className="mr-2 font-mono text-[10px] text-white/25">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {c.trechos.length > 0 && (
            <section className="mt-8">
              <h2 className={H2}>Trechos em destaque</h2>
              <ul className="mt-3 space-y-2">
                {c.trechos.map((t) => (
                  <li
                    key={t.chunk}
                    className="rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-4 py-3"
                  >
                    <p className="flex gap-2 text-sm leading-relaxed text-white/70">
                      <Quote className="mt-1 h-3 w-3 shrink-0 text-white/25" />
                      <span>{t.texto}</span>
                    </p>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-white/30">
                      <Link
                        href={`/grafo?focus=${encodeURIComponent(t.conceito)}`}
                        className="text-[var(--bl-accent)]/70 hover:text-[var(--bl-accent)]"
                      >
                        {t.conceito}
                      </Link>
                      <Link href={lerNa(t.pagina)} className="hover:text-white/70">
                        {t.pagina ? `pág. ~${t.pagina}` : `chunk ${t.chunk}`} →
                      </Link>
                      <Copiar
                        texto={`"${t.texto}" — ${livro.titulo}${t.pagina ? `, p. ~${t.pagina}` : ""}`}
                        title="copiar trecho com a fonte"
                        className="ml-auto text-white/25 hover:text-white/70"
                        icone="h-3 w-3"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {vizinhos.length > 0 && (
            <section className="mt-9">
              <h2 className={H2}>Quem lê este, conecta com</h2>
              <ul className="mt-3 space-y-2">
                {vizinhos.map((v) => (
                  <li key={v.id}>
                    <Link
                      href={`/livro/${v.id}`}
                      className="group flex items-baseline gap-3 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-4 py-3 hover:border-[var(--bl-border-hover)]"
                    >
                      <span className="text-sm text-white/85 group-hover:text-white">
                        {v.titulo}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-white/30">
                        {(v.score * 100).toFixed(0)}% afinidade
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {livro.proveniencia && (
            <section className="mt-9 text-[12px] text-white/30">
              <h2 className={H2}>Proveniência</h2>
              <p className="mt-2 flex items-center gap-2 break-all font-mono">
                {livro.proveniencia.origemPath}
                <Copiar
                  texto={livro.proveniencia.origemPath}
                  title="copiar caminho de origem"
                  className="text-white/20 hover:text-white/70"
                  icone="h-3 w-3"
                />
              </p>
              <p className="mt-1">classificado como: {livro.proveniencia.motivo}</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
