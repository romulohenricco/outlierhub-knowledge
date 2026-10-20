"use client";

import { useEffect, useRef, useState } from "react";
import type { Livro } from "@/lib/types";

/**
 * Leitor com posição persistente por livro (localStorage `knowledge-library-pos`).
 * PDF: viewer nativo em iframe + controle de página nosso (#page=N).
 * TXT/MD: texto tipografado com scroll restaurado.
 */

const KEY = "knowledge-library-pos";

function loadPos(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function savePos(id: string, pos: number) {
  const all = loadPos();
  all[id] = pos;
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function LeitorPdf({
  livro,
  paginaInicial,
}: {
  livro: Livro;
  paginaInicial?: number;
}) {
  const [pagina, setPagina] = useState<number | null>(null);

  useEffect(() => {
    // deep-link (?page= vindo do grafo/evidência) vence a posição salva
    setPagina(paginaInicial ?? loadPos()[livro.id] ?? 1);
  }, [livro.id, paginaInicial]);

  useEffect(() => {
    if (pagina !== null) savePos(livro.id, pagina);
  }, [livro.id, pagina]);

  if (pagina === null) return null; // aguarda hidratação do localStorage

  return (
    <div className="flex h-[calc(100vh-140px)] flex-col">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <button
          onClick={() => setPagina((p) => Math.max(1, (p ?? 1) - 1))}
          className="rounded-[var(--bl-radius-xs)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2.5 py-1 hover:bg-[var(--bl-bg-card-hover)]"
        >
          ← pág
        </button>
        <input
          type="number"
          min={1}
          value={pagina}
          onChange={(e) => setPagina(Math.max(1, Number(e.target.value) || 1))}
          className="w-16 rounded-[var(--bl-radius-xs)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2 py-1 text-center outline-none focus:border-[var(--bl-border-accent)]"
        />
        <button
          onClick={() => setPagina((p) => (p ?? 1) + 1)}
          className="rounded-[var(--bl-radius-xs)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] px-2.5 py-1 hover:bg-[var(--bl-bg-card-hover)]"
        >
          pág →
        </button>
        <span className="text-[11px] text-[var(--bl-text-muted)]">
          posição salva automaticamente — voltar ao livro retoma daqui
        </span>
      </div>
      <iframe
        key={pagina}
        src={`/api/file/${livro.id}#page=${pagina}`}
        title={livro.titulo}
        className="w-full flex-1 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-white"
      />
    </div>
  );
}

export function LeitorTexto({
  livro,
  html,
  destaque,
}: {
  livro: Livro;
  html: string;
  destaque?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // deep-link (?q= vindo da evidência do grafo): marca e rola até o trecho
  useEffect(() => {
    const el = ref.current;
    if (!el || !destaque) return;
    const alvo = destaque.trim().slice(0, 50);
    if (alvo.length < 8) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const idx = node.textContent?.indexOf(alvo) ?? -1;
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, Math.min(idx + alvo.length, node.length));
        const mark = document.createElement("mark");
        mark.style.cssText = "background:rgba(var(--bl-accent-rgb,42,169,104),.35);color:inherit;border-radius:3px;padding:1px 2px";
        try {
          range.surroundContents(mark);
          mark.scrollIntoView({ block: "center" });
        } catch {
          /* trecho cruza elementos — sem highlight, sem crash */
        }
        return;
      }
    }
  }, [destaque]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!destaque) el.scrollTop = loadPos()[livro.id] ?? 0;
    let t: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => savePos(livro.id, el.scrollTop), 300);
    };
    el.addEventListener("scroll", onScroll);
    return () => {
      clearTimeout(t);
      el.removeEventListener("scroll", onScroll);
    };
  }, [livro.id, destaque]);

  return (
    <div
      ref={ref}
      className="leitura h-[calc(100vh-140px)] overflow-y-auto rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-surface)] px-8 py-10 md:px-16"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
