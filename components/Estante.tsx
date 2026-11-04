"use client";

import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Copy, Network, Search, Wand2 } from "lucide-react";
import type { LivroCard } from "@/lib/livro-conteudo";
import { Capa } from "./Capa";
import { Secao, COR_CAT } from "./Filtros";
import { usePagePanel } from "./PagePanel";
import { CampoBusca } from "./CampoBusca";

type TipoCopia = "path" | "pr" | "hash";

/** Qual botão deste livro acabou de copiar (null se a cópia recente é de outro livro). */
function tipoCopiado(copiado: string | null, id: string): TipoCopia | null {
  if (!copiado) return null;
  const i = copiado.indexOf(":");
  if (copiado.slice(i + 1) !== id) return null;
  const tipo = copiado.slice(0, i);
  return tipo === "path" || tipo === "pr" || tipo === "hash" ? tipo : null;
}

/** Card de um livro; memoizado: filtrar ou copiar em outro card não re-renderiza os demais. */
const CardLivro = memo(function CardLivro({
  b,
  copiadoTipo,
  copiar,
  filtrar,
}: {
  b: LivroCard;
  copiadoTipo: TipoCopia | null;
  copiar: (texto: string, chave: string) => void;
  filtrar: (termo: string) => void;
}) {
  return (
    <article
      className="group flex flex-col overflow-hidden [contain-intrinsic-size:auto_480px] [content-visibility:auto] rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] shadow-[var(--bl-shadow-sm)] transition hover:border-[var(--bl-border-hover)] hover:bg-[var(--bl-bg-card-hover)]"
    >
      <Link href={`/livro/${b.id}`} className="block aspect-[2/3] overflow-hidden">
        <Capa livro={b} />
      </Link>
      <div className="flex flex-1 flex-col p-2.5">
        <div className="flex items-center gap-2 text-[10.5px]">
          <span className="truncate text-white/35">
            {b.formato.toUpperCase()}
            {b.paginas ? ` · ${b.paginas} págs.` : ""}
            {b.chunksTotal ? ` · ${b.chunksTotal} chunks` : ""}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={() => copiar(b.path, `path:${b.id}`)}
              className="text-white/30 hover:text-white/80"
              title="copiar caminho do arquivo (colar no terminal)"
              aria-label="copiar caminho do arquivo"
            >
              {copiadoTipo === "path" ? (
                <Check className="h-3.5 w-3.5 text-green-300" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            <Link
              href={`/ler/${b.id}`}
              className="text-white/30 hover:text-white/80"
              title="ler agora"
              aria-label="ler agora"
            >
              <BookOpen className="h-3.5 w-3.5" />
            </Link>
            <Link
              href={`/grafo?focus=${encodeURIComponent(`livro:${b.arquivo}`)}`}
              className="text-white/30 hover:text-white/80"
              title="ver no grafo"
              aria-label="ver no grafo"
            >
              <Network className="h-3.5 w-3.5" />
            </Link>
          </span>
        </div>
        <Link
          href={`/livro/${b.id}`}
          className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-snug text-white/85 hover:text-white"
        >
          {b.titulo}
        </Link>
        {b.sinopse && (
          <p
            className="mt-1.5 flex items-start gap-1.5 rounded-[var(--bl-radius-sm)] bg-[var(--bl-accent-soft,rgba(255,255,255,0.04))] p-1.5 text-[11px] leading-snug text-[var(--bl-accent)]/80"
            title={b.sinopse}
          >
            <BookOpen className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-3">{b.sinopse}</span>
          </p>
        )}
        {b.conceitos.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {b.conceitos.slice(0, 3).map((c) => (
              <button
                key={c}
                onClick={() => filtrar(c)}
                className="max-w-full truncate rounded-full border border-[var(--bl-border)] px-1.5 py-px text-[10px] text-white/45 hover:border-[var(--bl-border-hover)] hover:text-white/80"
                title={`filtrar a estante por "${c}"`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-1.5 rounded-[var(--bl-radius-sm)] border border-[#ff0000]/20 bg-[#ff0000]/[0.04] p-1.5 text-[11px]">
          <Wand2 className="h-3 w-3 shrink-0 text-[#ff0000]/70" />
          <button
            onClick={() => copiar(b.prompt, `pr:${b.id}`)}
            className="font-medium text-white/60 hover:text-white/90"
            title={b.prompt}
          >
            prompt de estudo
          </button>
          <button
            onClick={() => copiar(b.prompt, `pr:${b.id}`)}
            className="ml-auto text-white/40 hover:text-white/80"
            title="copiar contexto do livro pra colar num agente"
            aria-label="copiar prompt de estudo"
          >
            {copiadoTipo === "pr" ? (
              <Check className="h-3 w-3 text-green-300" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
        <p className="mt-auto truncate pt-1.5 text-[10px] text-white/25">
          {b.dominio && (
            <span className="mr-1.5 text-[var(--bl-accent)]/70">{b.dominio}</span>
          )}
          {b.tema}
          {b.nivelNome ? ` · ${b.nivelNome}` : ""}
        </p>
        {b.checksum && (
          <button
            onClick={() => copiar(b.checksum!, `hash:${b.id}`)}
            className="mt-0.5 self-start font-mono text-[9px] text-white/20 hover:text-[var(--bl-accent)]"
            title="content_checksum (SHA-256) — clicar copia o hash completo"
          >
            {copiadoTipo === "hash" ? "✓ hash copiado" : <>⬡ {b.checksum.slice(0, 12)}</>}
          </button>
        )}
      </div>
    </article>
  );
});

/** Cards montados por vez: a grade cresce em lotes para limpar/trocar o filtro não montar tudo de uma vez. */
const LOTE_CARDS = 48;

/** Botão "mostrar mais" que também se aciona sozinho ao chegar perto da tela (rolagem infinita em transição). */
function MostrarMais({ restantes, aoPedir }: { restantes: number; aoPedir: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  // observador novo a cada lote: se o botão ainda estiver à vista, pede o próximo
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) aoPedir();
      },
      { rootMargin: "600px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [restantes, aoPedir]);
  return (
    <button
      ref={ref}
      onClick={aoPedir}
      className="mx-auto mt-4 block rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-3 py-1.5 text-xs text-white/50 hover:border-[var(--bl-border-hover)] hover:text-white/80"
    >
      mostrar mais ({restantes})
    </button>
  );
}

export function Estante({ books }: { books: LivroCard[] }) {
  const [q, setQ] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  // estável (só usa setState funcional) para o CardLivro memoizado não re-renderizar
  const copiar = useCallback(async (texto: string, chave: string) => {
    await navigator.clipboard.writeText(texto);
    setCopiado(chave);
    setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1500);
  }, []);

  const [tema, setTema] = useState<string | null>(null);
  const [origem, setOrigem] = useState<string | null>(null);
  const [dominio, setDominio] = useState<string | null>(null);

  const temas = useMemo(() => {
    const c = new Map<string, number>();
    for (const b of books) c.set(b.tema, (c.get(b.tema) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [books]);

  const dominios = useMemo(() => {
    const c = new Map<string, number>();
    for (const b of books) if (b.dominio) c.set(b.dominio, (c.get(b.dominio) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [books]);

  const origens = useMemo(() => {
    const c = new Map<string, number>();
    for (const b of books) c.set(b.origem, (c.get(b.origem) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [books]);

  // textos em minúsculas calculados uma vez por acervo (o filtro roda a cada pausa de digitação)
  const indice = useMemo(
    () =>
      books.map((b) => ({
        b,
        titulo: b.titulo.toLowerCase(),
        conceitos: b.conceitos.map((c) => c.toLowerCase()),
        sinopse: b.sinopse?.toLowerCase() ?? null,
      })),
    [books],
  );

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return indice
      .filter(
        ({ b, titulo, conceitos, sinopse }) =>
          (!tema || b.tema === tema) &&
          (!origem || b.origem === origem) &&
          (!dominio || b.dominio === dominio) &&
          (!qn ||
            titulo.includes(qn) ||
            conceitos.some((c) => c.includes(qn)) ||
            (sinopse?.includes(qn) ?? false)),
      )
      .map((x) => x.b);
  }, [indice, q, tema, origem, dominio]);

  const painel = useMemo(
    () => (
    <>
        <div className="relative mb-3">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-white/30" />
          <CampoBusca
            valor={q}
            aoMudar={setQ}
            placeholder="filtrar por título, conceito…"
            className="w-full rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-1.5 pl-8 pr-2 text-sm outline-none ring-1 ring-[var(--bl-border)] placeholder:text-white/25 focus:ring-[var(--bl-border-accent)]"
          />
        </div>
        <Link
          href="/buscar"
          className="mb-4 flex w-full items-center gap-2 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-2 py-1.5 text-sm text-[var(--bl-text-secondary)] hover:border-[var(--bl-border-hover)]"
        >
          <Search className="h-4 w-4" /> busca semântica
        </Link>

        {/* TEMA */}
        <Secao titulo="tema" cor={COR_CAT.tema.cor} corRgb={COR_CAT.tema.rgb}>
          <button
            onClick={() => setTema(null)}
            className={`mb-1 block w-full px-2 py-0.5 text-left text-sm ${!tema ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
          >
            todos os temas
          </button>
          <div className="flex flex-wrap gap-1">
            {temas.map(([t, n]) => (
              <button
                key={t}
                onClick={() => setTema(tema === t ? null : t)}
                className={`bl-badge ${tema === t ? "bl-badge-accent" : "bl-badge-ghost"}`}
              >
                {t} <span className="opacity-50">{n}</span>
              </button>
            ))}
          </div>
        </Secao>

        {/* DOMÍNIO (ontologia) */}
        {dominios.length > 0 && (
          <Secao
            titulo="domínio"
            sub="(ontologia)"
            cor={COR_CAT.dominios.cor}
            corRgb={COR_CAT.dominios.rgb}
          >
            <button
              onClick={() => setDominio(null)}
              className={`mb-1 block w-full px-2 py-0.5 text-left text-sm ${!dominio ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
            >
              todos os domínios
            </button>
            <div className="flex flex-wrap gap-1">
              {dominios.map(([d, n]) => (
                <button
                  key={d}
                  onClick={() => setDominio(dominio === d ? null : d)}
                  className={`bl-badge ${dominio === d ? "bl-badge-accent" : "bl-badge-ghost"}`}
                >
                  {d} <span className="opacity-50">{n}</span>
                </button>
              ))}
            </div>
          </Secao>
        )}

        {/* ORIGEM */}
        <Secao titulo="origem" cor={COR_CAT.origem.cor} corRgb={COR_CAT.origem.rgb}>
          <button
            onClick={() => setOrigem(null)}
            className={`mb-1 block w-full px-2 py-0.5 text-left text-sm ${!origem ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
          >
            todas as origens
          </button>
          <div className="flex flex-wrap gap-1">
            {origens.map(([o, n]) => (
              <button
                key={o}
                onClick={() => setOrigem(origem === o ? null : o)}
                className={`bl-badge ${origem === o ? "bl-badge-accent" : "bl-badge-ghost"}`}
              >
                {o} <span className="opacity-50">{n}</span>
              </button>
            ))}
          </div>
        </Secao>
    </>
    ),
    [q, tema, dominio, origem, temas, dominios, origens],
  );
  usePagePanel(painel);

  // a grade acompanha o filtro em prioridade baixa (interrompível pela próxima tecla)
  const filtradosGrade = useDeferredValue(filtrados);

  // paginação por lotes: reinicia quando a lista filtrada muda (ajuste durante o render)
  const [limite, setLimite] = useState(LOTE_CARDS);
  const [listaAnterior, setListaAnterior] = useState(filtradosGrade);
  if (listaAnterior !== filtradosGrade) {
    setListaAnterior(filtradosGrade);
    setLimite(LOTE_CARDS);
  }
  const maisCards = useCallback(() => startTransition(() => setLimite((l) => l + LOTE_CARDS)), []);
  const visiveis = useMemo(() => filtradosGrade.slice(0, limite), [filtradosGrade, limite]);
  const restantes = filtradosGrade.length - visiveis.length;
  // o contador já mostra o filtro novo; a grade esmaece até alcançar
  const atualizando = filtradosGrade !== filtrados;

  return (
    <section>
      <p className="mb-4 text-xs text-white/40">
        {filtrados.length}/{books.length} livros
      </p>

      <div
        aria-busy={atualizando}
        className={`grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4 transition-opacity ${atualizando ? "opacity-50" : ""}`}
      >
        {visiveis.map((b) => (
          <CardLivro
            key={b.id}
            b={b}
            copiadoTipo={tipoCopiado(copiado, b.id)}
            copiar={copiar}
            filtrar={setQ}
          />
        ))}
      </div>
      {restantes > 0 && <MostrarMais restantes={restantes} aoPedir={maisCards} />}
    </section>
  );
}
