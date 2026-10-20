"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  ExternalLink,
  Trash2,
  Undo2,
  Play,
  Download,
  Loader2,
  Copy,
  Check,
  BookOpen,
  Star,
  Ban,
  Instagram,
  Youtube,
  Linkedin,
  Link2,
  Globe,
  MonitorPlay,
  Wand2,
} from "lucide-react";
import { Secao, ListaExpansivel, linhaCls, COR_CAT } from "./Filtros";
import { usePagePanel } from "./PagePanel";

const COR_SECAO = COR_CAT;

// cor de marca por plataforma (redes sociais na cor da mídia)
const BRAND: Record<string, { cor: string; rgb: string; Icon: typeof Instagram }> = {
  instagram: { cor: "#e1306c", rgb: "225,48,108", Icon: Instagram },
  youtube: { cor: "#ff0000", rgb: "255,0,0", Icon: Youtube },
  linkedin: { cor: "#0a66c2", rgb: "10,102,194", Icon: Linkedin },
  pinterest: { cor: "#e60023", rgb: "230,0,35", Icon: Link2 },
  behance: { cor: "#1769ff", rgb: "23,105,255", Icon: Link2 },
  tiktok: { cor: "#25f4ee", rgb: "37,244,238", Icon: Link2 },
  sites: { cor: "#73b490", rgb: "115,180,144", Icon: Globe },
};

import type { Antipattern, ReferenciaPost } from "@/lib/referencias";
import { FILTROS_VAZIOS, escreverFiltros, type FiltrosRefs } from "@/lib/referencias-url";
import { paginasDe } from "@/lib/referencias-paginas";
import { urlHttp } from "@/lib/social-url";

function imgSrc(dir: string, img: string) {
  return `/api/referencias/${encodeURIComponent(dir)}/${encodeURIComponent(img)}`;
}

// thumbnail (WebP 400px) para o grid — ~10× menos bytes; original só no "tamanho real"
function thumbSrc(dir: string, img: string) {
  return `/api/referencias/thumb/${encodeURIComponent(dir)}/${encodeURIComponent(img)}`;
}

/** Segundos → "12:34" / "1:02:03"; null quando não há duração. */
function duracaoHumana(s?: number | null): string | null {
  if (!s || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = Math.floor(s % 60);
  const dd = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${dd(m)}:${dd(seg)}` : `${m}:${dd(seg)}`;
}

function videoSrc(dir: string, file: string) {
  return `/api/referencias/video/${encodeURIComponent(dir)}/${encodeURIComponent(file)}`;
}

export function Referencias({
  posts,
  colecoes,
  antipatterns: apInicial,
  favoritos: favInicial,
  baseDir,
  filtrosIniciais: fi = FILTROS_VAZIOS,
}: {
  posts: ReferenciaPost[];
  colecoes: { nome: string; n: number }[];
  antipatterns: Record<string, Antipattern>;
  favoritos: Record<string, { em: string }>;
  baseDir: string | null;
  /** filtros lidos da URL no servidor — a URL é compartilhável */
  filtrosIniciais?: FiltrosRefs;
}) {
  const [q, setQ] = useState(fi.q);
  const [perfil, setPerfil] = useState<string | null>(fi.perfil);
  const [colSel, setColSel] = useState<string[]>(fi.colecoes); // multi-seleção (checkbox)
  const [dominio, setDominio] = useState<string | null>(fi.dominio);
  const [plataforma, setPlataforma] = useState<string | null>(fi.plataforma);

  const toggleColecao = (nome: string) =>
    setColSel((s) => (s.includes(nome) ? s.filter((x) => x !== nome) : [...s, nome]));

  // coleções ordenadas pelas mais usadas primeiro (nº de posts)
  const colecoesOrd = useMemo(
    () => [...colecoes].sort((a, b) => b.n - a.n),
    [colecoes],
  );

  // fonte/plataforma de cada post; itens legados sem campo continuam como Instagram
  const plataformaDe = (p: ReferenciaPost) => p.plataforma ?? "instagram";
  // proporção nativa da fonte: thumb de YouTube é 16:9 e cortar em 4:5 mata a
  // composição — que é justamente o que se está estudando aqui.
  const aspectoDe = (p: ReferenciaPost) =>
    plataformaDe(p) === "youtube" ? "aspect-video" : "aspect-[4/5]";
  const plataformas = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of posts) {
      const pl = plataformaDe(p);
      c.set(pl, (c.get(pl) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [posts]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [promptAberto, setPromptAberto] = useState<string | null>(null);
  const [verAntipatterns, setVerAntipatterns] = useState(fi.antipatterns);
  const [ap, setAp] = useState(apInicial);
  const [favs, setFavs] = useState(favInicial);
  const [soFavoritos, setSoFavoritos] = useState(fi.favoritos);

  async function toggleFavorito(code: string) {
    const r = await fetch("/api/referencias/favorito", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, undo: code in favs }),
    });
    if (r.ok) setFavs((await r.json()).favoritos);
  }
  const [vidsExtra, setVidsExtra] = useState<
    Record<string, { idx: number; file: string }[]>
  >({});
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(texto: string, chave: string) {
    await navigator.clipboard.writeText(texto);
    setCopiado(chave);
    setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1500);
  }

  function videosDe(p: ReferenciaPost) {
    return [...(p.videos ?? []), ...(vidsExtra[p.code] ?? [])];
  }

  async function baixarVideo(p: ReferenciaPost, idx: number) {
    const key = `${p.code}:${idx}`;
    setBaixando(key);
    setErroDownload(null);
    try {
      const r = await fetch("/api/referencias/baixar-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: p.code, idx }),
      });
      const j = await r.json();
      if (j.ok && j.file) {
        setVidsExtra((v) => ({
          ...v,
          [p.code]: [...(v[p.code] ?? []), { idx, file: j.file }],
        }));
      } else {
        setErroDownload(`${p.code} #${idx}: ${j.erro ?? r.status}`);
      }
    } catch (e) {
      setErroDownload(`${p.code} #${idx}: ${String(e).slice(0, 80)}`);
    } finally {
      setBaixando(null);
    }
  }

  async function toggleAntipattern(code: string, undo: boolean) {
    const r = await fetch("/api/referencias/antipattern", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, undo }),
    });
    if (r.ok) setAp((await r.json()).antipatterns);
  }

  const dominios = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of posts) if (p.dominio) c.set(p.dominio, (c.get(p.dominio) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [posts]);

  const perfis = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of posts) c.set(p.user, (c.get(p.user) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [posts]);

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return posts.filter(
      (p) =>
        (verAntipatterns ? p.code in ap : !(p.code in ap)) &&
        (!soFavoritos || p.code in favs) &&
        (!perfil || p.user === perfil) &&
        (!plataforma || plataformaDe(p) === plataforma) &&
        (!dominio || p.dominio === dominio) &&
        (colSel.length === 0 || colSel.some((c) => p.colecoes.includes(c))) &&
        (!qn ||
          p.caption.toLowerCase().includes(qn) ||
          p.user.toLowerCase().includes(qn)),
    );
  }, [posts, q, perfil, plataforma, colSel, dominio, ap, verAntipatterns, favs, soFavoritos]);

  const totalImgs = filtrados.reduce((a, p) => a + p.images.length, 0);
  const nAp = Object.keys(ap).length;

  // paginação por janela: renderiza só ~60 cards de cada vez (em vez de milhares de <article>
  // e de requests de imagem). Reseta ao trocar de filtro.
  const PAGINA = 60;
  const [limite, setLimite] = useState(PAGINA * fi.paginas);
  // o 1º disparo é a montagem — preserva o ?pag= vindo da URL compartilhada
  const montado = useRef(false);
  useEffect(() => {
    if (!montado.current) {
      montado.current = true;
      return;
    }
    setLimite(PAGINA);
  }, [q, perfil, plataforma, colSel, dominio, verAntipatterns, soFavoritos]);
  const visiveis = filtrados.slice(0, limite);

  // estado → URL (replaceState: compartilhável sem empilhar histórico a cada tecla)
  useEffect(() => {
    const qs = escreverFiltros({
      q,
      plataforma,
      dominio,
      perfil,
      colecoes: colSel,
      favoritos: soFavoritos,
      antipatterns: verAntipatterns,
      paginas: Math.max(1, Math.ceil(limite / PAGINA)),
    });
    const alvo = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (alvo !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", alvo);
    }
  }, [q, plataforma, dominio, perfil, colSel, soFavoritos, verAntipatterns, limite]);

  const painel = useMemo(
    () => (
    <>
          <div className="relative mb-4">
            <Search className="absolute left-2 top-2 h-4 w-4 text-white/30" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filtrar…"
              className="w-full rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] py-1.5 pl-8 pr-2 text-sm outline-none ring-1 ring-[var(--bl-border)] placeholder:text-white/25 focus:ring-[var(--bl-border-accent)]"
            />
          </div>

          {/* curadoria (pinada) — ícones vetoriais */}
          <button
            onClick={() => setSoFavoritos(!soFavoritos)}
            className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${soFavoritos ? "bg-[rgba(212,168,83,0.15)] text-[var(--bl-gold)]" : "text-[var(--bl-text-secondary)] hover:text-white/90"}`}
          >
            <Star
              className="h-4 w-4"
              fill={soFavoritos ? "currentColor" : "none"}
            />
            favoritos
            <span className="text-white/25">({Object.keys(favs).length})</span>
          </button>
          <button
            onClick={() => setVerAntipatterns(!verAntipatterns)}
            className={`mb-4 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${verAntipatterns ? "bg-red-500/20 text-red-200" : "text-[var(--bl-text-secondary)] hover:text-white/90"}`}
          >
            <Ban className="h-4 w-4" />
            antipatterns <span className="text-white/25">({nAp})</span>
          </button>

          {/* FONTE (plataforma) — cada fonte é um formato de acesso; itens na cor da marca */}
          <Secao
            titulo="fonte"
            sub="(plataforma)"
            cor={COR_SECAO.fonte.cor}
            corRgb={COR_SECAO.fonte.rgb}
          >
            <button
              onClick={() => setPlataforma(null)}
              className={`block w-full px-2 py-0.5 text-left text-sm ${!plataforma ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
            >
              todas as fontes
            </button>
            {plataformas.map(([pl, n]) => {
              const b = BRAND[pl];
              const Icon = b?.Icon ?? Link2;
              const on = plataforma === pl;
              return (
                <button
                  key={pl}
                  onClick={() => setPlataforma(on ? null : pl)}
                  className={linhaCls(on)}
                  style={
                    b
                      ? ({
                          "--bl-accent": b.cor,
                          "--bl-accent-dim": `rgba(${b.rgb},0.15)`,
                          borderColor: on ? b.cor : "transparent",
                        } as React.CSSProperties)
                      : { borderColor: on ? "var(--bl-accent)" : "transparent" }
                  }
                >
                  <Icon
                    className="h-4 w-4 shrink-0"
                    style={{ color: b?.cor }}
                  />
                  <span className="capitalize">{pl}</span>
                  <span className="ml-auto shrink-0 text-white/25">{n}</span>
                </button>
              );
            })}
          </Secao>

          {/* DOMÍNIOS (ontologia) */}
          <Secao
            titulo="domínios"
            sub="(ontologia)"
            cor={COR_SECAO.dominios.cor}
            corRgb={COR_SECAO.dominios.rgb}
          >
            <div className="flex flex-wrap gap-1">
              {dominios.map(([d, n]) => (
                <button
                  key={d}
                  onClick={() => setDominio(dominio === d ? null : d)}
                  className={`bl-badge ${dominio === d ? "bl-badge-accent" : "bl-badge-ghost"}`}
                  title={`${n} posts`}
                >
                  {d} <span className="opacity-50">{n}</span>
                </button>
              ))}
            </div>
          </Secao>

          {/* COLEÇÕES (checkbox multi-seleção · união) */}
          <Secao
            titulo="coleções"
            sub={colSel.length > 1 ? `(${colSel.length} · união)` : undefined}
            cor={COR_SECAO.colecoes.cor}
            corRgb={COR_SECAO.colecoes.rgb}
          >
            <button
              onClick={() => setColSel([])}
              className={`block w-full px-2 py-0.5 text-left text-sm ${colSel.length === 0 ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
            >
              todas as coleções
            </button>
            <ListaExpansivel
              itens={colecoesOrd}
              topN={10}
              render={(c) => {
                const on = colSel.includes(c.nome);
                return (
                  <button
                    key={c.nome}
                    onClick={() => toggleColecao(c.nome)}
                    aria-pressed={on}
                    className={linhaCls(on)}
                    style={{ borderColor: on ? "var(--bl-accent)" : "transparent" }}
                  >
                    <span
                      className="grid h-3 w-3 shrink-0 place-items-center rounded-[3px] border text-[8px] leading-none"
                      style={{
                        borderColor: on ? "var(--bl-accent)" : "var(--bl-text-muted)",
                        background: on ? "var(--bl-accent)" : "transparent",
                        color: "var(--bl-bg-primary)",
                      }}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="truncate">{c.nome}</span>
                    <span className="ml-auto shrink-0 text-white/25">{c.n}</span>
                  </button>
                );
              }}
            />
          </Secao>

          {/* PERFIS */}
          <Secao
            titulo="perfis"
            cor={COR_SECAO.perfis.cor}
            corRgb={COR_SECAO.perfis.rgb}
          >
            <button
              onClick={() => setPerfil(null)}
              className={`block w-full px-2 py-0.5 text-left text-sm ${!perfil ? "text-[var(--bl-accent)]" : "text-[var(--bl-text-dim)] hover:text-white/70"}`}
            >
              todos os perfis
            </button>
            <ListaExpansivel
              itens={perfis}
              topN={10}
              render={([u, n]) => {
                const on = perfil === u;
                return (
                  <button
                    key={u}
                    onClick={() => setPerfil(on ? null : u)}
                    className={linhaCls(on)}
                    style={{ borderColor: on ? "var(--bl-accent)" : "transparent" }}
                  >
                    <span className="truncate">{u}</span>
                    <span className="ml-auto shrink-0 text-white/25">{n}</span>
                  </button>
                );
              }}
            />
          </Secao>
    </>
    ),
    [q, soFavoritos, favs, verAntipatterns, nAp, plataforma, plataformas, dominio, dominios, colSel, colecoesOrd, perfil, perfis],
  );
  usePagePanel(painel);

  return (
    <div>
        <section>
          <p className="mb-4 text-xs text-white/40">
            {verAntipatterns && (
              <span className="mr-2 text-red-300">
                antipatterns — “o que não fazer” ·
              </span>
            )}
            {filtrados.length} posts · {totalImgs} imagens
            {erroDownload && (
              <span className="ml-2 text-red-300">
                falha no download — {erroDownload}
              </span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {visiveis.map((p) => (
              <article
                key={p.code}
                className={`overflow-hidden rounded-[var(--bl-radius-md)] border bg-[var(--bl-bg-card-solid)] shadow-[var(--bl-shadow-md)] transition-colors hover:bg-[var(--bl-bg-card-hover)] ${verAntipatterns ? "border-red-500/30 opacity-80" : "border-[var(--bl-border)] hover:border-[var(--bl-border-hover)]"}`}
              >
                <button
                  onClick={() => setAberto(aberto === p.code ? null : p.code)}
                  className="relative block w-full"
                  title={aberto === p.code ? "recolher" : "ver todas as imagens"}
                >
                  {p.images.length > 0 ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbSrc(p.dir, p.images[0])}
                        alt={p.caption || p.code}
                        loading="lazy"
                        decoding="async"
                        className={`${aspectoDe(p)} w-full object-cover object-top`}
                      />
                    </>
                  ) : (
                    // sem imagem (post só de texto ou ainda sem download): bloco de texto, nunca <img> quebrado
                    <div
                      className={`${aspectoDe(p)} flex w-full items-center justify-center bg-white/5 p-3 text-center text-[11px] leading-snug text-white/45`}
                    >
                      {p.caption || p.code}
                    </div>
                  )}
                  {p.videoIdx.includes(1) && (
                    <span className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5">
                      <Play className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
                <div className="p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="truncate font-medium text-white/80">
                      {p.user}
                    </span>
                    <span className="shrink-0 text-white/30">
                      {p.images.length} img
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => toggleFavorito(p.code)}
                        className={
                          p.code in favs
                            ? "text-[var(--bl-gold)]"
                            : "text-white/30 hover:text-[var(--bl-gold)]"
                        }
                        title={
                          p.code in favs ? "remover dos favoritos" : "favoritar"
                        }
                      >
                        <Star
                          className="h-3.5 w-3.5"
                          fill={p.code in favs ? "currentColor" : "none"}
                        />
                      </button>
                      <button
                        disabled={!baseDir && !p.codigo?.length}
                        onClick={() =>
                          copiar(
                            p.codigo?.length
                              ? p.codigo.join("\n")
                              : `${baseDir}/${p.dir}/`,
                            p.code,
                          )
                        }
                        className={
                          p.codigo?.length
                            ? "text-[var(--color-primary,#73b490)]/70 hover:text-[var(--color-primary,#73b490)]"
                            : "text-white/30 hover:text-white/80"
                        }
                        title={
                          p.codigo?.length
                            ? `copiar caminhos do código (${p.codigo.length} arquivos)`
                            : baseDir ? "copiar caminho relativo ao projeto (colar no terminal)" : "pasta externa: copie a URL da mídia ao abrir a referência"
                        }
                      >
                        {copiado === p.code ? (
                          <Check className="h-3.5 w-3.5 text-green-300" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {urlHttp(p.preview) ? (
                        <a
                          href={urlHttp(p.preview)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-green-300/80 hover:text-green-300"
                          title="abrir clone local"
                          aria-label="abrir clone local"
                        >
                          <MonitorPlay className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                      <a
                        href={urlHttp(p.igUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className={
                          p.preview
                            ? "text-white/20 hover:text-white/60"
                            : "text-white/30 hover:text-white/80"
                        }
                        title={
                          {
                            sites: "abrir site original",
                            youtube: "abrir no YouTube",
                          }[plataformaDe(p)] ?? "abrir no Instagram"
                        }
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      {verAntipatterns ? (
                        <button
                          onClick={() => toggleAntipattern(p.code, true)}
                          className="text-white/30 hover:text-green-300"
                          title="restaurar (não é antipattern)"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleAntipattern(p.code, false)}
                          className="text-white/30 hover:text-red-300"
                          title="deletar → vira antipattern (o que não fazer)"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </div>
                  {p.caption && (
                    <p className="mt-1 line-clamp-2 text-xs text-white/40">
                      {p.caption}
                    </p>
                  )}
                  {p.anotacao && (
                    <p
                      className="mt-1.5 flex items-start gap-1.5 rounded-[var(--bl-radius-sm)] bg-[var(--bl-accent-soft,rgba(255,255,255,0.04))] p-1.5 text-[11px] leading-snug text-[var(--bl-accent)]/80"
                      title={p.anotacao.texto ?? p.anotacao.descricao}
                    >
                      <BookOpen className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="line-clamp-3">
                        {p.anotacao.tipo === "estudo" && (
                          <b className="mr-1">[estudo]</b>
                        )}
                        {p.anotacao.descricao}
                      </span>
                    </p>
                  )}
                  {p.youtube && (
                    <p className="mt-1 flex items-center gap-1.5 text-[10px] text-white/30">
                      <Youtube className="h-3 w-3 shrink-0 text-[#ff0000]/70" />
                      {[
                        duracaoHumana(p.youtube.duracao),
                        p.youtube.views
                          ? `${p.youtube.views.toLocaleString("pt-BR")} views`
                          : null,
                        p.youtube.publicadoEm,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {p.promptReverso && (
                    <div className="mt-1.5 rounded-[var(--bl-radius-sm)] border border-[#ff0000]/20 bg-[#ff0000]/[0.04] p-1.5">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <Wand2 className="h-3 w-3 shrink-0 text-[#ff0000]/70" />
                        <button
                          onClick={() =>
                            setPromptAberto((c) => (c === p.code ? null : p.code))
                          }
                          className="font-medium text-white/60 hover:text-white/90"
                          title="receita pra recriar esta referência"
                        >
                          prompt reverso
                        </button>
                        <button
                          onClick={() =>
                            copiar(p.promptReverso!.prompt, `pr:${p.code}`)
                          }
                          className="ml-auto flex items-center gap-1 text-white/40 hover:text-white/80"
                          title="copiar o prompt (colar num gerador de imagem)"
                        >
                          {copiado === `pr:${p.code}` ? (
                            <Check className="h-3 w-3 text-green-300" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                      {promptAberto === p.code && (
                        <div className="mt-1.5 space-y-1.5 text-[11px] leading-snug">
                          <p className="whitespace-pre-wrap text-white/70">
                            {p.promptReverso.prompt}
                          </p>
                          {p.promptReverso.negativo && (
                            <p className="text-white/35">
                              <b className="text-red-300/70">evitar:</b>{" "}
                              {p.promptReverso.negativo}
                            </p>
                          )}
                          {p.promptReverso.analise && (
                            <dl className="space-y-0.5 border-t border-white/5 pt-1.5 text-[10px] text-white/40">
                              {(
                                [
                                  ["composicao", "composição"],
                                  ["zonaSegura", "zona segura"],
                                  ["sujeito", "sujeito"],
                                  ["tipografia", "tipografia"],
                                  ["cor", "cor"],
                                  ["luz", "luz"],
                                  ["textoNaImagem", "texto na imagem"],
                                  ["gancho", "gancho"],
                                ] as const
                              ).map(([chave, rotulo]) =>
                                p.promptReverso!.analise?.[chave] ? (
                                  <div key={chave}>
                                    <dt className="inline text-[var(--bl-accent)]/60">
                                      {rotulo}:{" "}
                                    </dt>
                                    <dd className="inline">
                                      {p.promptReverso!.analise![chave]}
                                    </dd>
                                  </div>
                                ) : null,
                              )}
                            </dl>
                          )}
                          <p className="text-[9px] text-white/20">
                            {p.promptReverso.proporcao ?? ""}
                            {p.promptReverso.por ? ` · ${p.promptReverso.por}` : ""}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {(p.dominio || p.colecoes.length > 0) && (
                    <p className="mt-1 truncate text-[10px] text-white/25">
                      {p.dominio && (
                        <span className="mr-1.5 text-[var(--bl-accent)]/70">
                          {p.dominio}
                        </span>
                      )}
                      {p.colecoes.join(" · ")}
                    </p>
                  )}
                  {p.checksum && (
                    <button
                      onClick={() => copiar(p.checksum!, `hash:${p.code}`)}
                      className="mt-1 font-mono text-[9px] text-white/20 hover:text-[var(--bl-accent)]"
                      title="content_checksum (SHA-256) — clicar copia o hash completo"
                    >
                      {copiado === `hash:${p.code}` ? (
                        "✓ hash copiado"
                      ) : (
                        <>⬡ {p.checksum.slice(0, 12)}</>
                      )}
                    </button>
                  )}
                  {aberto === p.code && (
                    <div className="mt-2 space-y-3">
                    {paginasDe(p).map((g) => (
                    <div key={g.titulo ?? "_"}>
                      {g.titulo && (
                        <div className="mb-1 flex items-center gap-2 border-b border-white/5 pb-1 text-[11px]">
                          <span className="truncate font-medium text-white/70">
                            {g.titulo}
                          </span>
                          <span className="shrink-0 text-white/25">
                            {g.imagens.length} img
                          </span>
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            {g.pagina?.prompt && (
                              <button
                                onClick={() => copiar(g.pagina!.prompt!, `pg-pr:${p.code}:${g.titulo}`)}
                                className="text-white/30 hover:text-white/80"
                                title="copiar o prompt de reuso desta página"
                              >
                                {copiado === `pg-pr:${p.code}:${g.titulo}` ? (
                                  <Check className="h-3 w-3 text-green-300" />
                                ) : (
                                  <Wand2 className="h-3 w-3" />
                                )}
                              </button>
                            )}
                            {g.pagina?.codigo?.length ? (
                              <button
                                onClick={() => copiar(g.pagina!.codigo!.join("\n"), `pg-cod:${p.code}:${g.titulo}`)}
                                className="text-[var(--color-primary,#73b490)]/70 hover:text-[var(--color-primary,#73b490)]"
                                title={`copiar caminhos do código desta página (${g.pagina.codigo.length} arquivos)`}
                              >
                                {copiado === `pg-cod:${p.code}:${g.titulo}` ? (
                                  <Check className="h-3 w-3 text-green-300" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            ) : null}
                            {g.pagina?.preview && urlHttp(g.pagina.preview) && (
                              <a
                                href={urlHttp(g.pagina.preview)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-green-300/80 hover:text-green-300"
                                title="abrir clone local desta página"
                                aria-label={`abrir clone local: ${g.titulo}`}
                              >
                                <MonitorPlay className="h-3 w-3" />
                              </a>
                            )}
                            {g.pagina?.igUrl && (
                              <a
                                href={urlHttp(g.pagina.igUrl)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-white/20 hover:text-white/60"
                                title="abrir página original"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </span>
                        </div>
                      )}
                    <div className="grid grid-cols-3 gap-1.5">
                      {g.imagens.map(({ img, idx }) => {
                        const ehVideo = p.videoIdx.includes(idx);
                        const vid = videosDe(p).find((v) => v.idx === idx);
                        if (ehVideo && vid) {
                          return (
                            <span key={img} className="group relative col-span-3">
                              <video
                                controls
                                preload="none"
                                poster={thumbSrc(p.dir, img)}
                                src={videoSrc(p.dir, vid.file)}
                                className="w-full rounded"
                              />
                              <button
                                onClick={() =>
                                  copiar(
                                    baseDir ? `${baseDir}/${p.dir}/${vid.file}` : new URL(videoSrc(p.dir, vid.file), window.location.origin).href,
                                    `${p.code}:${idx}`,
                                  )
                                }
                                className="absolute right-1 top-1 rounded bg-black/70 p-1 opacity-0 hover:bg-black/90 group-hover:opacity-100"
                                title={baseDir ? "copiar caminho relativo do vídeo" : "copiar URL do vídeo"}
                              >
                                {copiado === `${p.code}:${idx}` ? (
                                  <Check className="h-3 w-3 text-green-300" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </span>
                          );
                        }
                        return (
                          <span
                            key={img}
                            className={`group relative ${plataformaDe(p) === "youtube" ? "col-span-3" : ""}`}
                          >
                            <a
                              href={imgSrc(p.dir, img)}
                              target="_blank"
                              rel="noreferrer"
                              title="abrir em tamanho real"
                            >
                              {/* thumb no grid; o href acima abre o original em tamanho real */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={thumbSrc(p.dir, img)}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                className={`w-full rounded object-cover object-top ${plataformaDe(p) === "youtube" ? "aspect-video" : "aspect-square"}`}
                              />
                            </a>
                            <button
                              onClick={() =>
                                copiar(
                                  baseDir ? `${baseDir}/${p.dir}/${vid ? vid.file : img}` : new URL(vid ? videoSrc(p.dir, vid.file) : imgSrc(p.dir, img), window.location.origin).href,
                                  `${p.code}:${idx}`,
                                )
                              }
                              className="absolute right-1 top-1 rounded bg-black/70 p-1 opacity-0 hover:bg-black/90 group-hover:opacity-100"
                              title={baseDir ? "copiar caminho relativo desta mídia" : "copiar URL desta mídia"}
                            >
                              {copiado === `${p.code}:${idx}` ? (
                                <Check className="h-3 w-3 text-green-300" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                            {ehVideo && (
                              <button
                                onClick={() => baixarVideo(p, idx)}
                                disabled={baixando === `${p.code}:${idx}`}
                                className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded bg-black/70 py-0.5 text-[10px] text-white/80 hover:bg-black/90"
                                title="baixar vídeo para o disco (INBOX + curado)"
                              >
                                {baixando === `${p.code}:${idx}` ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Download className="h-3 w-3" />
                                )}
                                vídeo
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                    </div>
                    ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
          {filtrados.length > limite && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => setLimite((l) => l + PAGINA)}
                className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border-hover)] bg-[var(--bl-bg-card-solid)] px-4 py-2 text-sm text-[var(--bl-text-secondary)] hover:bg-[var(--bl-bg-card-hover)]"
              >
                carregar mais ({filtrados.length - limite} restantes)
              </button>
            </div>
          )}
        </section>
    </div>
  );
}
