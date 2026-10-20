"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import type { SearchHit, SearchResposta } from "@/lib/types";

export function Busca({ inicial = "" }: { inicial?: string }) {
  const [q, setQ] = useState(inicial);
  const [carregando, setCarregando] = useState(false);
  const [resposta, setResposta] = useState<SearchResposta | null>(null);
  const router = useRouter();

  const executar = useCallback(async (termo: string) => {
    if (!termo.trim()) return;
    setCarregando(true);
    setResposta(null);
    try {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: termo }),
      });
      setResposta((await r.json()) as SearchResposta);
    } catch {
      setResposta({ ok: false, erro: "backend" });
    } finally {
      setCarregando(false);
    }
  }, []);

  // deep-link `?q=`: o próprio app gera esses links (conceito do grafo, sugestão
  // do autolearn, nome da coleção) e até aqui todos abriam a busca VAZIA. O ref
  // garante disparo único — sem ele, cada re-render refaria a busca.
  const jaDisparou = useRef(false);
  useEffect(() => {
    if (!jaDisparou.current && inicial.trim()) {
      jaDisparou.current = true;
      void executar(inicial);
    }
  }, [inicial, executar]);

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || carregando) return;
    // espelha a query na URL (replace, não push: não polui o histórico) para que
    // refresh e compartilhamento do link levem à mesma busca
    router.replace(`/buscar?q=${encodeURIComponent(q)}`, { scroll: false });
    void executar(q);
  }

  const [filtroTipo, setFiltroTipo] = useState<string | null>(null);

  // agrupa hits por fonte+título, melhor score primeiro
  const grupos: [string, SearchHit[]][] = [];
  if (resposta?.ok) {
    const m = new Map<string, SearchHit[]>();
    for (const h of resposta.hits) {
      if (filtroTipo && h.tipo !== filtroTipo) continue;
      const k = `${h.tipo}|${h.livroTitulo}`;
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    grupos.push(...[...m.entries()].sort((a, b) => b[1][0].score - a[1][0].score));
  }
  const CORES: Record<string, string> = {
    livro: "#c07f28",
    canal: "#35a894",
    clickup: "#9b6dd6",
    cursos: "#c07f28",
    bilhon: "#4f8fd6",
  };
  const ROTULO: Record<string, string> = {
    livro: "📚 livro",
    canal: "▶ canal",
    clickup: "☑ clickup",
    cursos: "📄 curso",
    bilhon: "🏢 corpus",
  };
  const tiposPresentes = resposta?.ok
    ? [...new Set(resposta.hits.map((h) => h.tipo))]
    : [];

  return (
    <div>
      <form onSubmit={buscar} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="pergunte ao acervo — ex.: como escrever conteudo claro"
            className="w-full rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-3 pl-10 pr-3 outline-none ring-1 ring-[var(--bl-border)] placeholder:text-[var(--bl-text-muted)] focus:ring-[var(--bl-border-accent)]"
            autoFocus
          />
        </div>
        <button
          type="submit"
          disabled={carregando}
          className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-accent)] bg-[var(--bl-accent-dim)] px-5 text-sm font-medium text-[var(--bl-accent)] hover:brightness-125 disabled:opacity-40"
        >
          {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "buscar"}
        </button>
      </form>
      <p className="mt-2 text-[11px] text-[var(--bl-text-muted)]">
        modo demo: busca por termos nos livros de exemplo · com o seu Supabase: busca
        semântica híbrida na tabela rag_chunks (o embedding da pergunta vem de um Ollama local)
      </p>
      {tiposPresentes.length > 1 && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setFiltroTipo(null)}
            className={`bl-badge ${!filtroTipo ? "bl-badge-accent" : "bl-badge-ghost"}`}
          >
            tudo
          </button>
          {tiposPresentes.map((t) => (
            <button
              key={t}
              onClick={() => setFiltroTipo(filtroTipo === t ? null : t)}
              className={`bl-badge ${filtroTipo === t ? "bl-badge-accent" : "bl-badge-ghost"}`}
              style={{ color: filtroTipo === t ? CORES[t] : undefined }}
            >
              {ROTULO[t]}
            </button>
          ))}
        </div>
      )}

      {resposta && !resposta.ok && (
        <div className="mt-8 rounded-[var(--bl-radius-md)] border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {resposta.erro === "ollama-offline"
            ? "⚠️ Motor de busca offline (Ollama/bge-m3 não respondeu). Sobe o Ollama e tenta de novo — isso NÃO significa que não há resultados."
            : resposta.erro === "query-vazia"
              ? "Digite uma pergunta."
              : `Erro no backend de busca. ${"detalhe" in resposta ? (resposta.detalhe ?? "") : ""}`}
        </div>
      )}

      {resposta?.ok && (
        <div className="mt-8 space-y-4">
          {grupos.length === 0 && (
            <p className="text-sm text-[var(--bl-text-dim)]">
              nenhum resultado — tente reformular a pergunta.
            </p>
          )}
          {grupos.map(([chave, hits]) => {
            const h0 = hits[0];
            // o provider real não tem leitor de trechos e devolve "#": sem destino, sem link nem botão morto
            const temLeitor = h0.linkLocal !== "#";
            return (
              <section
                key={chave}
                className="rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-4"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ color: CORES[h0.tipo], background: `${CORES[h0.tipo]}1a` }}
                  >
                    {ROTULO[h0.tipo]}
                  </span>
                  {temLeitor ? (
                    <Link
                      href={h0.linkLocal}
                      className="min-w-0 flex-1 truncate font-medium text-white/90 hover:underline"
                    >
                      {h0.livroTitulo}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate font-medium text-white/90">{h0.livroTitulo}</span>
                  )}
                  <span className="font-mono text-[11px] text-[var(--bl-text-muted)]">
                    {(h0.score * 100).toFixed(0)}%
                  </span>
                </div>
                {h0.tipo !== "livro" && (
                  <p className="mt-0.5 text-[10.5px] text-[var(--bl-text-muted)]">
                    fonte: {h0.fonteNome}
                  </p>
                )}
                <ul className="mt-3 space-y-2">
                  {hits.slice(0, 3).map((h) => (
                    <li
                      key={h.chunkId}
                      className="border-l-2 border-[var(--bl-border-accent)] pl-3 text-[13px] leading-relaxed text-white/60"
                    >
                      …{h.snippet}…
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  {temLeitor && (
                    <Link
                      href={h0.linkLocal}
                      className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-solid)] px-2.5 py-1 text-[11px] hover:bg-[var(--bl-bg-card-hover)]"
                    >
                      📖 ler no trecho →
                    </Link>
                  )}
                  {h0.linkExterno && (
                    <a
                      href={h0.linkExterno}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-2.5 py-1 text-[11px] text-white/50 hover:bg-[var(--bl-bg-card-hover)]"
                    >
                      {h0.tipo === "clickup" ? "☑ ClickUp" : "▶ YouTube"} →
                    </a>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
