"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Film, Image as ImagemIcon, ImagePlus, Images, RotateCcw, Search, Star, Trash2, Undo2, X } from "lucide-react";
import { Secao, ListaExpansivel, linhaCls, COR_CAT } from "./Filtros";
import { usePagePanel } from "./PagePanel";
import { SocialVazio } from "./SocialVazio";
import { ChipFiltro, useTriagem } from "./useTriagem";
import {
  FILTRO_IG_VAZIO,
  ROTULO_TIPO,
  filtrarSaves,
  type CategoriaIG,
  type FiltroIG,
  type SaveEmReferencias,
  type SaveIG,
  type TipoSave,
} from "@/lib/instagram-saves-filtro";
import { urlHttp } from "@/lib/social-url";
import { ROTULO_STATUS, contar, contarStatus, type DecisoesTriagem, type FiltroStatus, type StatusTriagem } from "@/lib/triagem";

const PAGINA = 48;
const COR_IG = "#e1306c";
const ICONE_TIPO: Record<TipoSave, typeof Film> = { foto: ImagemIcon, carrossel: Images, reel: Film };

function dataCurta(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : "";
}

export function InstagramSaves({
  coletadoEm,
  saves,
  categorias,
  decisoes: decisoesIniciais,
  emReferencias,
}: {
  coletadoEm: string | null;
  saves: SaveIG[];
  categorias: CategoriaIG[];
  decisoes: DecisoesTriagem;
  emReferencias: SaveEmReferencias;
}) {
  const [f, setF] = useState<FiltroIG>(FILTRO_IG_VAZIO);
  const { decisoes, sel, setSel, alternar, erro, ultima, aplicar, desfazer } = useTriagem(
    "/api/mysocialmedia/instagram/decisao",
    decisoesIniciais,
  );
  const [limite, setLimite] = useState(PAGINA);

  const rotuloCat = useMemo(() => new Map(categorias.map((c) => [c.id, c.rotulo])), [categorias]);

  const set = useCallback((parcial: Partial<FiltroIG>) => {
    setF((a) => ({ ...a, ...parcial }));
    setLimite(PAGINA);
  }, []);

  const base = useMemo(() => filtrarSaves(saves, decisoes, { ...FILTRO_IG_VAZIO, status: f.status }, emReferencias), [saves, decisoes, f.status, emReferencias]);
  const filtrados = useMemo(() => filtrarSaves(saves, decisoes, f, emReferencias), [saves, decisoes, f, emReferencias]);
  const visiveis = filtrados.slice(0, limite);

  const contStatus = useMemo(() => contarStatus(saves.length, decisoes, emReferencias), [saves.length, decisoes, emReferencias]);
  const porCategoria = useMemo(() => contar(base, (s) => s.categorias), [base]);
  const porColecao = useMemo(() => contar(base, (s) => s.colecoes), [base]);
  const porConta = useMemo(() => contar(base, (s) => [s.user]).slice(0, 60), [base]);
  const porTipo = useMemo(() => contar(base, (s) => [s.tipo]), [base]);
  const palavras = useMemo(() => contar(filtrados, (s) => s.palavras).slice(0, 36), [filtrados]);

  const filtrando = f.q || f.categorias.length || f.colecao || f.conta || f.palavra || f.tipo;

  const painel = useMemo(
    () => (
      <>
        <div className="relative mb-4">
          <Search className="absolute left-2 top-2 h-4 w-4 text-white/30" />
          <input
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="legenda, conta, palavra-chave…"
            className="w-full rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-1.5 pl-8 pr-2 text-sm outline-none ring-1 ring-[var(--bl-border)] placeholder:text-white/25 focus:ring-[var(--bl-border-accent)]"
          />
        </div>

        <Secao titulo="triagem" cor={COR_CAT.origem.cor} corRgb={COR_CAT.origem.rgb}>
          {(Object.keys(ROTULO_STATUS) as FiltroStatus[]).map((s) => (
            <button key={s} onClick={() => set({ status: s })} className={linhaCls(f.status === s)}>
              <span className="flex-1">{ROTULO_STATUS[s]}</span>
              <span className="text-white/30">{contStatus[s]}</span>
            </button>
          ))}
        </Secao>

        <Secao titulo="categoria" cor={COR_CAT.tema.cor} corRgb={COR_CAT.tema.rgb}>
          <button
            onClick={() => set({ categorias: [] })}
            className={`block w-full px-2 py-0.5 text-left text-sm ${f.categorias.length === 0 ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
          >
            todas
          </button>
          <ListaExpansivel
            itens={porCategoria}
            topN={22}
            render={([id, n]) => (
              <button
                key={id}
                onClick={() => set({ categorias: f.categorias.includes(id) ? f.categorias.filter((x) => x !== id) : [...f.categorias, id] })}
                className={linhaCls(f.categorias.includes(id))}
              >
                <span className="flex-1 truncate">{rotuloCat.get(id) ?? id}</span>
                <span className="text-white/30">{n}</span>
              </button>
            )}
          />
        </Secao>

        <Secao titulo="coleção" cor={COR_CAT.colecoes.cor} corRgb={COR_CAT.colecoes.rgb} defaultAberto={false}>
          <ListaExpansivel
            itens={porColecao}
            topN={14}
            render={([c, n]) => (
              <button key={c} onClick={() => set({ colecao: f.colecao === c ? null : c })} className={linhaCls(f.colecao === c)}>
                <span className="flex-1 truncate">{c}</span>
                <span className="text-white/30">{n}</span>
              </button>
            )}
          />
        </Secao>

        <Secao titulo="formato" cor={COR_CAT.dominios.cor} corRgb={COR_CAT.dominios.rgb} defaultAberto={false}>
          {porTipo.map(([t, n]) => (
            <button key={t} onClick={() => set({ tipo: f.tipo === t ? null : (t as TipoSave) })} className={linhaCls(f.tipo === t)}>
              <span className="flex-1">{ROTULO_TIPO[t as TipoSave] ?? t}</span>
              <span className="text-white/30">{n}</span>
            </button>
          ))}
        </Secao>

        <Secao titulo="conta" cor={COR_CAT.perfis.cor} corRgb={COR_CAT.perfis.rgb} defaultAberto={false}>
          <ListaExpansivel
            itens={porConta}
            topN={12}
            render={([c, n]) => (
              <button key={c} onClick={() => set({ conta: f.conta === c ? null : c })} className={linhaCls(f.conta === c)}>
                <span className="flex-1 truncate">@{c}</span>
                <span className="text-white/30">{n}</span>
              </button>
            )}
          />
        </Secao>

        <Secao titulo="palavras-chave" sub="(do filtro atual)" cor={COR_CAT.fonte.cor} corRgb={COR_CAT.fonte.rgb}>
          <div className="flex flex-wrap gap-1 px-1">
            {palavras.map(([p, n]) => (
              <button
                key={p}
                onClick={() => set({ palavra: f.palavra === p ? null : p })}
                className={`rounded-full px-1.5 py-0.5 text-[11px] ${f.palavra === p ? "bg-[var(--bl-accent)] text-black" : "bg-white/5 text-white/55 hover:bg-white/10"}`}
                title={`${n} posts`}
              >
                {p}
                <span className="ml-1 opacity-50">{n}</span>
              </button>
            ))}
          </div>
        </Secao>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, porCategoria, porColecao, porConta, porTipo, palavras, contStatus],
  );
  usePagePanel(painel);

  if (saves.length === 0) {
    return (
      <SocialVazio
        titulo="Nenhum save no inventário"
        arquivos={["instagram-saves/saves.json", "instagram-saves/categorias.json", "instagram-saves/thumbs/<code>.jpg (capas, opcional)"]}
      >
        Coloque o inventário dos posts que você salvou e o app mostra cada um com categoria, palavras-chave e a triagem (descartar, manter ou pôr na fila de{" "}
        <a href="/referencias" className="text-white/60 underline">/referencias</a>). As decisões ficam em{" "}
        <code className="text-white/60">instagram-saves/decisoes.json</code>, criado na primeira triagem.
      </SocialVazio>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-xs text-white/40">
          {saves.length} saves · {contStatus.pendentes} a triar · {contStatus.descartados} descartados · {contStatus.mantidos} mantidos · {contStatus.fila} na fila ·{" "}
          {contStatus.ja} já em referências
          {coletadoEm && <span className="text-white/25"> · coletado em {new Date(coletadoEm).toLocaleDateString("pt-BR")}</span>}
        </p>
        {filtrando ? (
          <button
            onClick={() => set({ ...FILTRO_IG_VAZIO, status: f.status })}
            className="ml-auto flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/55 hover:bg-white/5"
          >
            <X className="h-3 w-3" /> limpar filtros
          </button>
        ) : null}
      </div>

      {filtrando ? (
        <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
          {f.q && <ChipFiltro onX={() => set({ q: "" })}>busca: {f.q}</ChipFiltro>}
          {f.categorias.map((c) => (
            <ChipFiltro key={c} onX={() => set({ categorias: f.categorias.filter((x) => x !== c) })}>{rotuloCat.get(c) ?? c}</ChipFiltro>
          ))}
          {f.colecao && <ChipFiltro onX={() => set({ colecao: null })}>coleção: {f.colecao}</ChipFiltro>}
          {f.conta && <ChipFiltro onX={() => set({ conta: null })}>@{f.conta}</ChipFiltro>}
          {f.tipo && <ChipFiltro onX={() => set({ tipo: null })}>{ROTULO_TIPO[f.tipo]}</ChipFiltro>}
          {f.palavra && <ChipFiltro onX={() => set({ palavra: null })}>#{f.palavra}</ChipFiltro>}
        </div>
      ) : null}

      {erro && <p className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{erro}</p>}

      <div className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-2 bg-[var(--bl-bg,#0b0b0f)]/90 px-1 py-2 backdrop-blur">
        <button
          onClick={() => setSel(sel.size === filtrados.length ? new Set() : new Set(filtrados.map((s) => s.code)))}
          className="rounded border border-white/10 px-2 py-0.5 text-xs text-white/60 hover:bg-white/5"
        >
          {sel.size === filtrados.length && sel.size > 0 ? "limpar seleção" : `selecionar os ${filtrados.length} do filtro`}
        </button>
        {sel.size > 0 && (
          <>
            <span className="text-xs text-white/50">{sel.size} selecionados</span>
            <button onClick={() => aplicar([...sel], "descartado", `${sel.size} descartados`)} className="flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/25">
              <Trash2 className="h-3 w-3" /> descartar
            </button>
            <button onClick={() => aplicar([...sel], "referencia", `${sel.size} na fila`)} title="entra em /referencias quando a ingestão com prompt reverso rodar" className="flex items-center gap-1 rounded bg-[rgba(91,140,255,0.15)] px-2 py-0.5 text-xs text-[#5b8cff] hover:bg-[rgba(91,140,255,0.25)]">
              <ImagePlus className="h-3 w-3" /> pra referências
            </button>
            <button onClick={() => aplicar([...sel], "manter", `${sel.size} mantidos`)} className="flex items-center gap-1 rounded bg-[rgba(212,168,83,0.15)] px-2 py-0.5 text-xs text-[var(--bl-gold)] hover:bg-[rgba(212,168,83,0.25)]">
              <Star className="h-3 w-3" /> manter
            </button>
            {f.status !== "ativos" && (
              <button onClick={() => aplicar([...sel], null, `${sel.size} restaurados`)} className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-xs text-white/70 hover:bg-white/15">
                <RotateCcw className="h-3 w-3" /> tirar da triagem
              </button>
            )}
          </>
        )}
        {ultima && (
          <button onClick={desfazer} className="ml-auto flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 text-xs text-white/70 hover:bg-white/5">
            <Undo2 className="h-3 w-3" /> desfazer: {ultima.rotulo}
          </button>
        )}
      </div>

      {filtrados.length === 0 ? (
        <p className="text-sm text-white/40">Nada neste filtro.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visiveis.map((s) => (
            <CardSave
              key={s.code}
              s={s}
              status={decisoes[s.code]?.status}
              emRef={emReferencias[s.code]}
              marcado={sel.has(s.code)}
              rotuloCat={rotuloCat}
              onMarcar={() => alternar(s.code)}
              onDecidir={(st) => aplicar([s.code], st, st === "descartado" ? "1 descartado" : st === "manter" ? "1 mantido" : st === "referencia" ? "1 na fila" : "1 restaurado")}
              onCategoria={(c) => set({ categorias: [c] })}
              onPalavra={(p) => set({ palavra: p })}
              onConta={(c) => set({ conta: c })}
            />
          ))}
        </div>
      )}

      {limite < filtrados.length && (
        <button
          onClick={() => setLimite((l) => l + PAGINA)}
          className="mt-4 w-full rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] py-2 text-sm text-white/50 hover:bg-[var(--bl-bg-card-hover)]"
        >
          mostrar mais ({filtrados.length - limite} restantes)
        </button>
      )}
    </div>
  );
}

function CardSave({
  s,
  status,
  emRef,
  marcado,
  rotuloCat,
  onMarcar,
  onDecidir,
  onCategoria,
  onPalavra,
  onConta,
}: {
  s: SaveIG;
  status: StatusTriagem | undefined;
  emRef: SaveEmReferencias[string] | undefined;
  marcado: boolean;
  rotuloCat: Map<string, string>;
  onMarcar: () => void;
  onDecidir: (st: StatusTriagem | null) => void;
  onCategoria: (c: string) => void;
  onPalavra: (p: string) => void;
  onConta: (c: string) => void;
}) {
  const descartado = status === "descartado";
  const Icone = ICONE_TIPO[s.tipo];
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-[var(--bl-radius-md)] border bg-[var(--bl-bg-card-solid)] shadow-[var(--bl-shadow-md)] transition-colors ${
        marcado ? "border-[var(--bl-accent,#ff4e45)]" : "border-[var(--bl-border)] hover:border-[var(--bl-border-hover)]"
      } ${descartado ? "opacity-50" : ""}`}
    >
      <a href={urlHttp(s.url)} target="_blank" rel="noreferrer" className="relative block aspect-[4/5] bg-black/40">
        {s.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/mysocialmedia/instagram/capa/${encodeURIComponent(s.code)}`} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <Icone className="absolute inset-0 m-auto h-8 w-8 text-white/20" />
        )}
        <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] text-white/85">
          <Icone className="h-3 w-3" />
          {s.tipo === "carrossel" ? s.slides : ROTULO_TIPO[s.tipo].split(" ")[0]}
        </span>
        {status === "manter" && <Star className="absolute right-1 top-1 h-4 w-4 fill-[var(--bl-gold)] text-[var(--bl-gold)]" />}
        {emRef ? (
          <span className="absolute bottom-1 left-1 rounded bg-[#5b8cff]/90 px-1.5 py-0.5 text-[10px] font-medium text-black">em referências{emRef.comPrompt ? " · c/ prompt" : ""}</span>
        ) : status === "referencia" ? (
          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-[#5b8cff] ring-1 ring-[#5b8cff]/50">na fila</span>
        ) : null}
      </a>
      <button
        onClick={onMarcar}
        aria-label={marcado ? "desmarcar" : "marcar"}
        className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded border ${
          marcado ? "border-transparent bg-[var(--bl-accent,#ff4e45)] text-black" : "border-white/40 bg-black/50 text-transparent opacity-0 group-hover:opacity-100"
        }`}
      >
        <Check className="h-3.5 w-3.5" />
      </button>

      <div className="flex flex-1 flex-col p-2.5">
        <button onClick={() => onConta(s.user)} className="mb-1 truncate text-left text-[12px] font-medium hover:underline" style={{ color: COR_IG }}>
          @{s.user}
          {s.postadoEm && <span className="ml-1 font-normal text-white/30">· {dataCurta(s.postadoEm)}</span>}
        </button>
        <p className="mb-1.5 line-clamp-3 text-[12px] leading-snug text-white/75" title={s.legenda}>
          {s.legenda || <span className="text-white/30">sem legenda</span>}
        </p>
        <div className="mb-1 flex flex-wrap gap-1">
          {s.categorias.map((c) => (
            <button key={c} onClick={() => onCategoria(c)} className="rounded-full bg-[rgba(168,85,247,0.15)] px-1.5 py-0.5 text-[10px] text-[#a855f7] hover:bg-[rgba(168,85,247,0.28)]">
              {rotuloCat.get(c) ?? c}
            </button>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap gap-1">
          {s.palavras.slice(0, 5).map((p) => (
            <button key={p} onClick={() => onPalavra(p)} className="text-[10px] text-white/40 hover:text-white/80">
              #{p}
            </button>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-1 border-t border-white/5 pt-2">
          <div className="min-w-0 flex-1 truncate text-[10px] text-white/30" title={s.colecoes.join(" · ")}>
            {s.colecoes.length ? s.colecoes.slice(0, 2).join(" · ") : "sem coleção"}
            {s.colecoes.length > 2 && ` +${s.colecoes.length - 2}`}
          </div>
          {descartado ? (
            <button onClick={() => onDecidir(null)} className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70 hover:bg-white/15">
              <RotateCcw className="h-3 w-3" /> restaurar
            </button>
          ) : (
            <>
              {emRef ? (
                <a href={`/referencias?fonte=instagram&q=${encodeURIComponent(emRef.user)}`} title="ver em /referencias" className="rounded p-1 text-[#5b8cff] hover:bg-white/10">
                  <ImagePlus className="h-3.5 w-3.5" />
                </a>
              ) : (
                <button
                  onClick={() => onDecidir(status === "referencia" ? null : "referencia")}
                  title={status === "referencia" ? "tirar da fila de referências" : "pôr na fila de /referencias (ingestão com prompt reverso)"}
                  className={`rounded p-1 hover:bg-white/10 ${status === "referencia" ? "text-[#5b8cff]" : "text-white/35"}`}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => onDecidir(status === "manter" ? null : "manter")}
                title={status === "manter" ? "tirar de mantidos" : "manter"}
                className={`rounded p-1 hover:bg-white/10 ${status === "manter" ? "text-[var(--bl-gold)]" : "text-white/35"}`}
              >
                <Star className={`h-3.5 w-3.5 ${status === "manter" ? "fill-current" : ""}`} />
              </button>
              <button onClick={() => onDecidir("descartado")} title="descartar (não vale a pena)" className="rounded p-1 text-white/35 hover:bg-red-500/15 hover:text-red-300">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
