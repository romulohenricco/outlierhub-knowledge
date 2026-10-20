"use client";

import { useMemo, useState, useEffect, type ComponentType } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, Lock, Package, Search } from "lucide-react";
import {
  AREAS_BOS,
  CATEGORIAS_ADDON,
  type AddonCatalogo,
  type AddonCategoria,
  type AreaBos,
} from "@/lib/addons-schema";

// Previews React curados por addon.id — nunca renderiza o artefato bruto como
// HTML/JS; cada preview é componente hand-authored, lazy (ssr:false) e só um
// fica montado por vez (troca de aberto → remonta o próximo do zero via key).
const PREVIEWS: Record<string, ComponentType> = {
  "function-utility:exemplo-debounce": dynamic(
    () => import("./addons/previews/DebouncePreview").then((m) => m.DebouncePreview),
    { ssr: false },
  ),
  "framework-checklist:exemplo-checklist-lancamento": dynamic(
    () => import("./addons/previews/ChecklistPreview").then((m) => m.ChecklistPreview),
    { ssr: false },
  ),
  "design-system:exemplo-empty-state": dynamic(
    () => import("./addons/previews/EmptyStatePreview").then((m) => m.EmptyStatePreview),
    { ssr: false },
  ),
};

const ROTULOS_AREA_BOS: Record<AreaBos, string> = {
  dashboards: "Dashboards",
  login: "Login",
  modulos: "Módulos",
  rules: "Regras",
  skills: "Skills",
  antipattern: "Antipattern",
};

function SourceViewer({ addonId, artefatoId }: { addonId: string; artefatoId: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    setTexto(null);
    setErro(false);
    fetch(`/api/addons/${encodeURIComponent(addonId)}/artifacts/${encodeURIComponent(artefatoId)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setTexto)
      .catch(() => setErro(true));
  }, [addonId, artefatoId]);

  async function copiar() {
    if (!texto) return;
    // bytes exatamente como estão — sem prefixo/atribuição embutida no clipboard.
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  if (erro) return <p className="text-sm text-rose-400">Não foi possível carregar o source.</p>;
  if (texto === null) return <p className="text-sm text-white/40">Carregando…</p>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40">{artefatoId}</span>
        <button
          type="button"
          onClick={copiar}
          className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
          aria-label={copiado ? "conteúdo copiado" : "copiar conteúdo"}
          aria-live="polite"
        >
          {copiado ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          {copiado ? "copiado" : "copiar"}
        </button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/80">
        <code>{texto}</code>
      </pre>
    </div>
  );
}

export function Addons({ catalogo }: { catalogo: AddonCatalogo }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState("");
  const [categoria, setCategoria] = useState<AddonCategoria | null>(null);
  const [status, setStatus] = useState<"aprovado" | "quarentena" | null>(null);
  const [area, setArea] = useState<AreaBos | null>(null);
  const [aberto, setAberto] = useState<string | null>(() => searchParams.get("id"));

  function abrir(id: string | null) {
    setAberto(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("id", id);
    else params.delete("id");
    router.push(`/integracoes${params.toString() ? `?${params}` : ""}`, { scroll: false });
  }

  const todos = useMemo(() => [...catalogo.entries, ...catalogo.quarentena], [catalogo]);

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return todos.filter(
      (e) =>
        (!categoria || e.category === categoria) &&
        (!status || e.approval === status) &&
        (!area || e.areaBos === area) &&
        (!qn || e.title.toLowerCase().includes(qn) || e.summary.toLowerCase().includes(qn)),
    );
  }, [todos, q, categoria, status, area]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full flex-1 sm:min-w-[200px] sm:w-auto">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
          <label htmlFor="addons-busca" className="sr-only">
            Buscar add-ons
          </label>
          <input
            id="addons-busca"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="buscar add-ons…"
            className="min-h-11 w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-sm text-white/90 outline-none focus-visible:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
          />
        </div>
        <select
          aria-label="filtrar por categoria"
          value={categoria ?? ""}
          onChange={(e) => setCategoria((e.target.value || null) as AddonCategoria | null)}
          className="min-h-11 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
        >
          <option value="">todas as categorias</option>
          {Object.entries(CATEGORIAS_ADDON).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="filtrar por status"
          value={status ?? ""}
          onChange={(e) => setStatus((e.target.value || null) as "aprovado" | "quarentena" | null)}
          className="min-h-11 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
        >
          <option value="">todos os status</option>
          <option value="aprovado">aprovado</option>
          <option value="quarentena">quarentena</option>
        </select>
        <select
          aria-label="filtrar por área"
          value={area ?? ""}
          onChange={(e) => setArea((e.target.value || null) as AreaBos | null)}
          className="min-h-11 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
        >
          <option value="">todas as áreas</option>
          {AREAS_BOS.map((a) => (
            <option key={a} value={a}>
              {ROTULOS_AREA_BOS[a]}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-white/40">
        {filtrados.length}/{todos.length} add-ons
      </p>

      {filtrados.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-white/40">
          <Package size={24} className="mx-auto mb-2 opacity-40" />
          {todos.length === 0
            ? "Nenhum add-on configurado ainda: o catálogo fica em data/addons (formato em docs/dados.md)."
            : "Nenhum add-on encontrado com esses filtros."}
        </div>
      )}

      <ul className="space-y-2">
        {filtrados.map((e) => {
          const expandido = aberto === e.id;
          const Preview = PREVIEWS[e.id];
          const quarentena = e.approval !== "aprovado";
          return (
            <li key={e.id} className="rounded-lg border border-white/10 bg-white/[0.02]">
              <button
                type="button"
                onClick={() => abrir(expandido ? null : e.id)}
                aria-expanded={expandido}
                aria-controls={`addon-painel-${e.id}`}
                className="flex min-h-11 w-full items-start justify-between gap-3 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50 focus-visible:-outline-offset-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white/90">{e.title}</span>
                    {quarentena && (
                      <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                        <Lock size={10} /> quarentena
                      </span>
                    )}
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50">
                      {CATEGORIAS_ADDON[e.category]}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-white/50">{e.summary}</p>
                </div>
              </button>

              {expandido && (
                <div id={`addon-painel-${e.id}`} role="region" aria-label={`detalhes de ${e.title}`} className="border-t border-white/10 p-3">
                  {quarentena ? (
                    <p className="text-sm text-white/40">
                      Registro em quarentena — source, cópia e preview desabilitados por padrão
                      (licença/proveniência não confirmada).
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-white/40">
                        proveniência: {e.source.bucket} · licença: {e.source.license} · distribuição: {e.distribution}
                      </p>
                      {Preview && e.preview_kind === "react" && (
                        <div key={e.id}>
                          <Preview />
                        </div>
                      )}
                      {e.artifacts.map((a) => (
                        <SourceViewer key={a.id} addonId={e.id} artefatoId={a.id} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
