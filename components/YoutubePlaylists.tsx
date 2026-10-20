"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Check,
  EyeOff,
  Globe,
  ImagePlus,
  ListVideo,
  Lock,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Undo2,
  Users,
  X,
} from "lucide-react";
import { Secao, ListaExpansivel, linhaCls, COR_CAT } from "./Filtros";
import { usePagePanel } from "./PagePanel";
import { SocialVazio } from "./SocialVazio";
import { ChipFiltro, useTriagem } from "./useTriagem";
import { urlHttp } from "@/lib/social-url";
import { ROTULO_STATUS as STATUS_ROTULO, contarStatus, type FiltroStatus } from "@/lib/triagem";
import {
  FILTRO_VAZIO,
  ROTULO_DURACAO,
  contar,
  duracaoHumana,
  filtrarVideos,
  type CategoriaYT,
  type Decisoes,
  type EmReferencias,
  type FiltroDuracao,
  type FiltroYT,
  type PlaylistYT,
  type StatusVideo,
  type VideoYT,
} from "@/lib/youtube-playlists-filtro";

const PAGINA = 48;
const COR_YT = "#ff4e45";

type Aba = "playlists" | "videos";
function thumb(id: string) {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

export function YoutubePlaylists({
  coletadoEm,
  playlists,
  videos,
  categorias,
  decisoes: decisoesIniciais,
  emReferencias,
  miniaturas,
}: {
  coletadoEm: string | null;
  playlists: PlaylistYT[];
  videos: VideoYT[];
  categorias: CategoriaYT[];
  decisoes: Decisoes;
  emReferencias: EmReferencias;
  /** pedir as miniaturas ao servidor de imagens do YouTube (BILHON_SOCIAL_YT_MINIATURAS); desligado, nada sai da máquina */
  miniaturas: boolean;
}) {
  const [aba, setAba] = useState<Aba>("playlists");
  const [f, setF] = useState<FiltroYT>(FILTRO_VAZIO);
  const { decisoes, sel, setSel, alternar, erro, ultima, aplicar, desfazer } = useTriagem(
    "/api/mysocialmedia/youtube/decisao",
    decisoesIniciais,
  );
  const [limite, setLimite] = useState(PAGINA);

  const rotuloCat = useMemo(() => new Map(categorias.map((c) => [c.id, c.rotulo])), [categorias]);
  const playlistPorId = useMemo(() => new Map(playlists.map((p) => [p.id, p])), [playlists]);

  const set = useCallback((parcial: Partial<FiltroYT>) => {
    setF((a) => ({ ...a, ...parcial }));
    setLimite(PAGINA);
  }, []);

  // ---- derivados ------------------------------------------------------------
  const base = useMemo(() => filtrarVideos(videos, decisoes, { ...FILTRO_VAZIO, status: f.status }, emReferencias), [videos, decisoes, f.status, emReferencias]);
  const filtrados = useMemo(() => filtrarVideos(videos, decisoes, f, emReferencias), [videos, decisoes, f, emReferencias]);
  const visiveis = filtrados.slice(0, limite);

  const contStatus = useMemo(() => contarStatus(videos.length, decisoes, emReferencias), [videos.length, decisoes, emReferencias]);
  const nDescartados = contStatus.descartados;
  const nMantidos = contStatus.mantidos;
  const nFila = contStatus.fila;

  const porCategoria = useMemo(() => contar(base, (v) => v.categorias), [base]);
  const porCanal = useMemo(() => contar(base, (v) => [v.canal]).slice(0, 60), [base]);
  const palavras = useMemo(() => contar(filtrados, (v) => v.palavras).slice(0, 36), [filtrados]);
  const porPlaylist = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of base) for (const p of v.playlists) m.set(p, (m.get(p) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [base]);

  const filtrando = f.q || f.categorias.length || f.playlist || f.canal || f.palavra || f.duracao;

  // ---- painel lateral -------------------------------------------------------
  const painel = useMemo(
    () => (
      <>
        <div className="relative mb-4">
          <Search className="absolute left-2 top-2 h-4 w-4 text-white/30" />
          <input
            value={f.q}
            onChange={(e) => {
              set({ q: e.target.value });
              setAba("videos");
            }}
            placeholder="título, canal, palavra-chave…"
            className="w-full rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-1.5 pl-8 pr-2 text-sm outline-none ring-1 ring-[var(--bl-border)] placeholder:text-white/25 focus:ring-[var(--bl-border-accent)]"
          />
        </div>

        <Secao titulo="triagem" cor={COR_CAT.origem.cor} corRgb={COR_CAT.origem.rgb}>
          {(Object.keys(STATUS_ROTULO) as FiltroStatus[]).map((s) => (
            <button key={s} onClick={() => set({ status: s })} className={linhaCls(f.status === s)}>
              <span className="flex-1">{STATUS_ROTULO[s]}</span>
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
                onClick={() => {
                  set({ categorias: f.categorias.includes(id) ? f.categorias.filter((x) => x !== id) : [...f.categorias, id] });
                  setAba("videos");
                }}
                className={linhaCls(f.categorias.includes(id))}
              >
                <span className="flex-1 truncate">{rotuloCat.get(id) ?? id}</span>
                <span className="text-white/30">{n}</span>
              </button>
            )}
          />
        </Secao>

        <Secao titulo="playlist" cor={COR_CAT.colecoes.cor} corRgb={COR_CAT.colecoes.rgb} defaultAberto={false}>
          <ListaExpansivel
            itens={porPlaylist}
            topN={14}
            render={([id, n]) => (
              <button
                key={id}
                onClick={() => {
                  set({ playlist: f.playlist === id ? null : id });
                  setAba("videos");
                }}
                className={linhaCls(f.playlist === id)}
              >
                <span className="flex-1 truncate">{playlistPorId.get(id)?.nome ?? id}</span>
                <span className="text-white/30">{n}</span>
              </button>
            )}
          />
        </Secao>

        <Secao titulo="duração" cor={COR_CAT.dominios.cor} corRgb={COR_CAT.dominios.rgb} defaultAberto={false}>
          {(Object.keys(ROTULO_DURACAO) as FiltroDuracao[]).map((d) => (
            <button key={d} onClick={() => { set({ duracao: f.duracao === d ? null : d }); setAba("videos"); }} className={linhaCls(f.duracao === d)}>
              <span className="flex-1">{ROTULO_DURACAO[d]}</span>
            </button>
          ))}
        </Secao>

        <Secao titulo="canal" cor={COR_CAT.perfis.cor} corRgb={COR_CAT.perfis.rgb} defaultAberto={false}>
          <ListaExpansivel
            itens={porCanal}
            topN={12}
            render={([c, n]) => (
              <button
                key={c}
                onClick={() => { set({ canal: f.canal === c ? null : c }); setAba("videos"); }}
                className={linhaCls(f.canal === c)}
              >
                <span className="flex-1 truncate">{c}</span>
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
                onClick={() => { set({ palavra: f.palavra === p ? null : p }); setAba("videos"); }}
                className={`rounded-full px-1.5 py-0.5 text-[11px] ${f.palavra === p ? "bg-[var(--bl-accent)] text-black" : "bg-white/5 text-white/55 hover:bg-white/10"}`}
                title={`${n} vídeos`}
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
    [f, porCategoria, porCanal, palavras, porPlaylist, contStatus.ativos, contStatus.mantidos, contStatus.fila, contStatus.descartados, contStatus.todos],
  );
  usePagePanel(painel);

  function abrirPlaylist(id: string) {
    set({ ...FILTRO_VAZIO, playlist: id, status: f.status });
    setAba("videos");
  }

  const totalCat = base.length || 1;

  return (
    <div>
      {/* ---- barra de topo: abas + resumo + limpar ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-[var(--bl-radius-sm)] bg-white/5 p-0.5 text-sm">
          {(
            [
              ["playlists", `Playlists · ${playlists.length}`],
              ["videos", `Vídeos · ${filtrados.length}`],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              onClick={() => setAba(id)}
              className={`rounded px-3 py-1 ${aba === id ? "bg-white/10 text-white/90" : "text-white/45 hover:text-white/75"}`}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <p className="text-xs text-white/40">
          {videos.length} vídeos únicos · {nDescartados} descartados · {nMantidos} mantidos · {nFila} na fila · {Object.keys(emReferencias).length} já em referências
          {coletadoEm && <span className="text-white/25"> · coletado em {new Date(coletadoEm).toLocaleDateString("pt-BR")}</span>}
        </p>
        {filtrando ? (
          <button
            onClick={() => set({ ...FILTRO_VAZIO, status: f.status })}
            className="ml-auto flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/55 hover:bg-white/5"
          >
            <X className="h-3 w-3" /> limpar filtros
          </button>
        ) : null}
      </div>

      {/* filtros ativos */}
      {filtrando ? (
        <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
          {f.q && <ChipFiltro onX={() => set({ q: "" })}>busca: {f.q}</ChipFiltro>}
          {f.categorias.map((c) => (
            <ChipFiltro key={c} onX={() => set({ categorias: f.categorias.filter((x) => x !== c) })}>{rotuloCat.get(c) ?? c}</ChipFiltro>
          ))}
          {f.playlist && <ChipFiltro onX={() => set({ playlist: null })}>playlist: {playlistPorId.get(f.playlist)?.nome}</ChipFiltro>}
          {f.canal && <ChipFiltro onX={() => set({ canal: null })}>canal: {f.canal}</ChipFiltro>}
          {f.palavra && <ChipFiltro onX={() => set({ palavra: null })}>#{f.palavra}</ChipFiltro>}
          {f.duracao && <ChipFiltro onX={() => set({ duracao: null })}>{ROTULO_DURACAO[f.duracao]}</ChipFiltro>}
        </div>
      ) : null}

      {erro && <p className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{erro}</p>}

      {videos.length === 0 ? (
        <SocialVazio
          titulo="Nenhuma playlist coletada ainda"
          arquivos={["youtube-playlists/playlists.json", "youtube-playlists/videos.json", "youtube-playlists/categorias.json"]}
        >
          Coloque o inventário das suas playlists e dos vídeos delas e o app mostra cada vídeo com categoria, palavras-chave e a triagem (descartar, manter ou pôr na fila de{" "}
          <a href="/referencias" className="text-white/60 underline">/referencias</a>). As decisões ficam em{" "}
          <code className="text-white/60">youtube-playlists/decisoes.json</code>, criado na primeira triagem.
        </SocialVazio>
      ) : aba === "playlists" ? (
        <>
          {/* panorama por categoria */}
          <section className="mb-8">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.06em]" style={{ color: COR_CAT.tema.cor }}>
              panorama · {STATUS_ROTULO[f.status]}
            </h2>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {porCategoria.map(([id, n]) => (
                <button
                  key={id}
                  onClick={() => { set({ categorias: [id] }); setAba("videos"); }}
                  className="group flex items-center gap-2 py-0.5 text-left text-xs"
                >
                  <span className="w-44 shrink-0 truncate text-white/60 group-hover:text-white/90">{rotuloCat.get(id) ?? id}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (n / totalCat) * 100)}%`, background: COR_YT }} />
                  </span>
                  <span className="w-10 shrink-0 text-right text-white/35">{n}</span>
                </button>
              ))}
            </div>
          </section>

          {(
            [
              ["Minhas playlists", playlists.filter((p) => p.origem === "propria" && !p.sistema)],
              ["Listas do YouTube", playlists.filter((p) => p.sistema)],
              ["Salvas de outros canais", playlists.filter((p) => p.origem === "salva")],
            ] as const
          ).map(([titulo, lista]) =>
            lista.length ? (
              <section key={titulo} className="mb-8">
                <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.06em]" style={{ color: COR_CAT.colecoes.cor }}>
                  {titulo} · {lista.length}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {[...lista]
                    .sort((a, b) => b.coletados - a.coletados)
                    .map((p) => (
                      <CardPlaylist
                        key={p.id}
                        p={p}
                        videos={videos}
                        decisoes={decisoes}
                        rotuloCat={rotuloCat}
                        onAbrir={() => abrirPlaylist(p.id)}
                        miniaturas={miniaturas}
                      />
                    ))}
                </div>
              </section>
            ) : null,
          )}
        </>
      ) : (
        <>
          {/* barra de ações em lote */}
          <div className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-2 bg-[var(--bl-bg,#0b0b0f)]/90 px-1 py-2 backdrop-blur">
            <button
              onClick={() => setSel(sel.size === filtrados.length ? new Set() : new Set(filtrados.map((v) => v.id)))}
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visiveis.map((v) => (
                <CardVideo
                  key={v.id}
                  v={v}
                  status={decisoes[v.id]?.status}
                  emRef={emReferencias[v.id]}
                  marcado={sel.has(v.id)}
                  rotuloCat={rotuloCat}
                  playlistPorId={playlistPorId}
                  onMarcar={() => alternar(v.id)}
                  onDecidir={(st) => aplicar([v.id], st, st === "descartado" ? "1 descartado" : st === "manter" ? "1 mantido" : st === "referencia" ? "1 na fila" : "1 restaurado")}
                  onCategoria={(c) => set({ categorias: [c] })}
                  onPalavra={(p) => set({ palavra: p })}
                  onPlaylist={abrirPlaylist}
                  miniaturas={miniaturas}
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
        </>
      )}
    </div>
  );
}

const ICONE_VIS = { privada: Lock, "nao-listada": EyeOff, publica: Globe } as const;
const ROTULO_VIS = { privada: "privada", "nao-listada": "não listada", publica: "pública" } as const;

function CardPlaylist({
  p,
  videos,
  decisoes,
  rotuloCat,
  onAbrir,
  miniaturas,
}: {
  p: PlaylistYT;
  videos: VideoYT[];
  decisoes: Decisoes;
  rotuloCat: Map<string, string>;
  onAbrir: () => void;
  miniaturas: boolean;
}) {
  const doP = useMemo(() => videos.filter((v) => v.playlists.includes(p.id)), [videos, p.id]);
  const descartados = doP.filter((v) => decisoes[v.id]?.status === "descartado").length;
  const top = useMemo(() => contar(doP, (v) => v.categorias).slice(0, 3), [doP]);
  const Icone = p.origem === "salva" ? Users : ICONE_VIS[p.visibilidade];
  const capa = miniaturas ? doP[0]?.id : undefined;
  return (
    <div className="overflow-hidden rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] shadow-[var(--bl-shadow-md)] transition-colors hover:border-[var(--bl-border-hover)]">
      <button onClick={onAbrir} className="block w-full text-left">
        <div className="relative aspect-video w-full bg-black/40">
          {capa ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb(capa)} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-80" />
          ) : (
            <ListVideo className="absolute inset-0 m-auto h-8 w-8 text-white/20" />
          )}
          <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] text-white/85">
            {doP.length} vídeos
          </span>
        </div>
        <div className="p-3">
          <p className="mb-1 line-clamp-2 text-sm font-medium text-white/90">{p.nome}</p>
          <p className="mb-2 flex items-center gap-1 text-[11px] text-white/40">
            <Icone className="h-3 w-3" />
            {p.origem === "salva" ? `salva de ${p.criador}` : ROTULO_VIS[p.visibilidade]}
            {p.esperados > p.coletados && (
              <span className="text-white/25" title="vídeos apagados, privados ou indisponíveis não aparecem na coleta">
                · {p.esperados - p.coletados} indisponíveis
              </span>
            )}
            {descartados > 0 && <span className="text-red-300/60">· {descartados} descartados</span>}
          </p>
          <div className="flex flex-wrap gap-1">
            {top.map(([c, n]) => (
              <span key={c} className="rounded-full bg-[rgba(168,85,247,0.15)] px-1.5 py-0.5 text-[10px] text-[#a855f7]">
                {rotuloCat.get(c) ?? c} · {n}
              </span>
            ))}
          </div>
        </div>
      </button>
      {urlHttp(p.url) && (
        <a href={urlHttp(p.url)} target="_blank" rel="noreferrer" className="block border-t border-[var(--bl-border)] px-3 py-1.5 text-[11px] text-white/35 hover:text-white/70">
          abrir no YouTube ↗
        </a>
      )}
    </div>
  );
}

function CardVideo({
  v,
  status,
  emRef,
  marcado,
  rotuloCat,
  playlistPorId,
  onMarcar,
  onDecidir,
  onCategoria,
  onPalavra,
  onPlaylist,
  miniaturas,
}: {
  v: VideoYT;
  status: StatusVideo | undefined;
  emRef: EmReferencias[string] | undefined;
  marcado: boolean;
  rotuloCat: Map<string, string>;
  playlistPorId: Map<string, PlaylistYT>;
  onMarcar: () => void;
  onDecidir: (s: StatusVideo | null) => void;
  onCategoria: (c: string) => void;
  onPalavra: (p: string) => void;
  onPlaylist: (id: string) => void;
  miniaturas: boolean;
}) {
  const descartado = status === "descartado";
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-[var(--bl-radius-md)] border bg-[var(--bl-bg-card-solid)] shadow-[var(--bl-shadow-md)] transition-colors ${
        marcado ? "border-[var(--bl-accent,#ff4e45)]" : "border-[var(--bl-border)] hover:border-[var(--bl-border-hover)]"
      } ${descartado ? "opacity-50" : ""}`}
    >
      <a href={urlHttp(v.url)} target="_blank" rel="noreferrer" className="relative block aspect-video bg-black/40">
        {miniaturas ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb(v.id)} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <ListVideo className="absolute inset-0 m-auto h-8 w-8 text-white/20" />
        )}
        {v.duracaoS > 0 && (
          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[11px] text-white/90">{duracaoHumana(v.duracaoS)}</span>
        )}
        {status === "manter" && <Star className="absolute right-1 top-1 h-4 w-4 fill-[var(--bl-gold)] text-[var(--bl-gold)]" />}
        {emRef ? (
          <span className="absolute left-8 top-1.5 rounded bg-[#5b8cff]/90 px-1.5 py-0.5 text-[10px] font-medium text-black">em referências{emRef.comPrompt ? " · c/ prompt" : ""}</span>
        ) : status === "referencia" ? (
          <span className="absolute left-8 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-[#5b8cff] ring-1 ring-[#5b8cff]/50">na fila</span>
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
        <a href={urlHttp(v.url)} target="_blank" rel="noreferrer" className="mb-1 line-clamp-2 text-[13px] font-medium leading-snug text-white/90 hover:underline" title={v.titulo}>
          {v.titulo}
        </a>
        <p className="mb-1.5 truncate text-[11px] text-white/40">
          {v.canal || "canal desconhecido"}
          {v.views && ` · ${v.views}`}
          {v.publicado && ` · ${v.publicado}`}
        </p>
        <div className="mb-1 flex flex-wrap gap-1">
          {v.categorias.map((c) => (
            <button key={c} onClick={() => onCategoria(c)} className="rounded-full bg-[rgba(168,85,247,0.15)] px-1.5 py-0.5 text-[10px] text-[#a855f7] hover:bg-[rgba(168,85,247,0.28)]">
              {rotuloCat.get(c) ?? c}
            </button>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap gap-1">
          {v.palavras.slice(0, 5).map((p) => (
            <button key={p} onClick={() => onPalavra(p)} className="text-[10px] text-white/40 hover:text-white/80">
              #{p}
            </button>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-1 border-t border-white/5 pt-2">
          <div className="min-w-0 flex-1 truncate text-[10px] text-white/30">
            {v.playlists.slice(0, 2).map((id, i) => (
              <span key={id}>
                {i > 0 && " · "}
                <button onClick={() => onPlaylist(id)} className="hover:text-white/70">
                  {playlistPorId.get(id)?.nome ?? id}
                </button>
              </span>
            ))}
            {v.playlists.length > 2 && <span> +{v.playlists.length - 2}</span>}
          </div>
          {descartado ? (
            <button onClick={() => onDecidir(null)} className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70 hover:bg-white/15">
              <RotateCcw className="h-3 w-3" /> restaurar
            </button>
          ) : (
            <>
              {emRef ? (
                <a
                  href={`/referencias?fonte=youtube&q=${encodeURIComponent(emRef.titulo)}`}
                  title="ver em /referencias"
                  className="rounded p-1 text-[#5b8cff] hover:bg-white/10"
                >
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
