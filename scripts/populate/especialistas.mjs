/**
 * Módulo `especialistas` — cada especialista processado pelo pipeline MCE vira uma
 * coleção própria em /colecao/<slug>; e (via `extrairInsightsMce`, chamado pelo módulo
 * `grafo`) seus insights viram conceitos no grafo, ligados à fala de origem por citação LITERAL.
 *
 * Por que existe: o corpus genérico (common.mjs) espalha o especialista por áreas
 * (knowledge-external-dna, -dossiers, -sources, -processed, agentes) e poda `.data/`,
 * onde o pipeline guarda os insights (INSIGHTS-STATE.json). O grafo genérico só extrai
 * estrutura. Este módulo fecha as duas lacunas para TODO especialista, sem script avulso
 * por pessoa.
 *
 * Descoberta (somente leitura do mega-brain):
 *   knowledge/<bucket>/dna/persons/<slug>/        → existe especialista <slug>
 *   bucket ∈ {external, business}; `personal` só com --include-personal
 *
 * Entrada por especialista (o que faltar é pulado, com aviso):
 *   transcrições  knowledge/<bucket>/processed/<slug>/**\/*.txt (ou inbox/<slug>/, se ainda não processado)
 *   DNA           knowledge/<bucket>/dna/persons/<slug>/*.yaml
 *   insights      knowledge/<bucket>/insights/by-person/<slug>.json  OU  .data/artifacts/insights/<slug>/INSIGHTS-STATE.json
 *   dossiê/temas  knowledge/<bucket>/dossiers/persons/*<slug>*.md, dossiers/persons-by-theme/<slug>--*.md
 *   fontes        knowledge/<bucket>/sources/<SLUG>/*.md
 *   agente        agents/<bucket>/<slug>/*.{md,yaml}
 *   checkpoint    .claude/mission-control/mce/<slug>/checkpoints/identity-checkpoint.json (veredito → proveniência)
 *   Todo arquivo passa por `lerTextoSeguro` (mesmas regras de segurança do corpus).
 *
 * Saída deste módulo (somente em data/):
 *   colecoes-external/sources/<slug>/  _corpus_bge.sqlite (mesmo contrato de colecoes.mjs),
 *                                      .provenance.json, .ontology.json, .populate-managed {modulo:"especialistas"}
 *   kg/youtube-map.json                título/URL/canal por transcrição com id do YouTube CONFIRMADO;
 *                                      `canal` = slug da coleção (contrato de docs/dados.md: o painel do
 *                                      grafo monta /colecao/<canal>/<doc> com ele; nome de exibição dá 404)
 *   kg/populate-especialistas.json     manifesto deste módulo (o que ele escreveu, para limpar depois)
 *
 * Transcrição com o MESMO texto em dois lugares (p.ex. processed/<slug>/ e processed/<slug>/misc/)
 * entra uma vez só, na coleção e na contagem do grafo: a primeira em ordem de caminho fica, a cópia
 * vai para os avisos.
 *
 * Grafo: o módulo `grafo` é o ÚNICO escritor de `kg/livros-kg.sqlite`. Ele chama
 * `extrairInsightsMce(g, corpus, ctx)`, que declara cada insight com citação literal como
 * conceito estrutural (`mce-<slug>-<id>`) com evidência de definição na transcrição — que é
 * um livro da Estante (kind "doc") — e assim passa pela mesma validação, pelo mesmo cálculo
 * de chunk e pelo mesmo manifesto de todas as outras evidências do grafo.
 *
 * Regras (No Invention — Art. IV):
 *   - insight só entra no grafo se a citação for localizada LITERALMENTE numa transcrição
 *     (normalização: marcadores [mm:ss] e espaços); a evidência é o maior prefixo da citação
 *     (<= 300 chars) que cabe num único trecho; sem isso vai para `semEvidencia`, nunca vira aresta;
 *   - link do YouTube só com id confirmado pelo cabeçalho da transcrição (URL:) ou pelo
 *     `source_id`/`source_url` dos insights — o prefixo do nome do arquivo sozinho não basta;
 *   - pasta de coleção que não é deste módulo (sem `.populate-managed` dele) nunca é tocada.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { construirStore, storeConfere } from "./colecoes.mjs";
import { ativarExclusoes, caminhoExcluido, chunkWords, ensureDir, humanize, lerTextoSeguro, log, readJsonSafe, slugify, writeJson } from "./common.mjs";

const MODULO = "especialistas";
const FORMATO = "especialistas-v1:chunks(chunk_id,video,text)+idx_video";
const VERSAO = 2;
const STORE = "_corpus_bge.sqlite";
const GERADOS = [STORE, `${STORE}-wal`, `${STORE}-shm`, `${STORE}-journal`, ".provenance.json", ".ontology.json", ".populate-managed"];
const SLUG_OK = /^[a-z0-9][a-z0-9-]*$/;
const MAX_TRECHO = 300; // mesmo teto de _extracao.mjs

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const norm = (s) => String(s).replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ citações */

const MARCADOR_TEMPO = /\[\d{1,2}:\d{2}(?::\d{2})?\]/g;

/** Texto comparável: sem marcadores [mm:ss], espaços colapsados. */
export function normalizarCitacao(s) {
  return String(s ?? "").replace(MARCADOR_TEMPO, " ").replace(/\s+/g, " ").trim();
}

/**
 * Localiza `citacao` em `texto` ignorando marcadores [mm:ss] e diferenças de espaço.
 * Devolve o trecho LITERAL do texto original (com quebras e marcadores) ou null.
 */
export function localizarCitacao(texto, citacao) {
  const alvo = normalizarCitacao(citacao);
  if (alvo.length < 12) return null; // citação curta demais não é evidência
  // normaliza o texto guardando, para cada caractere normalizado, o índice original
  const semMarcas = texto.replace(MARCADOR_TEMPO, (m) => " ".repeat(m.length));
  let normal = "";
  const origem = [];
  let espaco = false;
  for (let i = 0; i < semMarcas.length; i++) {
    const c = semMarcas[i];
    if (/\s/.test(c)) {
      espaco = normal.length > 0;
      continue;
    }
    if (espaco) {
      normal += " ";
      origem.push(i);
      espaco = false;
    }
    normal += c;
    origem.push(i);
  }
  const at = normal.indexOf(alvo);
  if (at < 0) return null;
  const inicio = origem[at];
  const fim = origem[at + alvo.length - 1] + 1;
  return { inicio, fim, trecho: texto.slice(inicio, fim) };
}

/**
 * Maior prefixo (em palavras, <= MAX_TRECHO chars) de `trechoNorm` contido num único trecho
 * normalizado de `chunksNorm` — a evidência do grafo precisa caber num chunk só.
 */
export function prefixoNoChunk(chunksNorm, trechoNorm) {
  const palavras = trechoNorm.split(" ");
  const cabe = (k) => {
    const p = palavras.slice(0, k).join(" ");
    return p.length <= MAX_TRECHO && chunksNorm.some((c) => c.includes(p)) ? p : null;
  };
  let lo = 1;
  let hi = palavras.length;
  let melhor = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = cabe(mid);
    if (p) {
      melhor = p;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return melhor && melhor.length >= 12 ? melhor : null;
}

/* ------------------------------------------------------------------ YouTube */

const URL_YT = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/;

/** Ids do YouTube citados pelos insights (source_id com 11 chars ou source_url). */
function idsConfirmadosPorInsights(insights) {
  const ids = new Set();
  for (const it of insights) {
    const src = it?.source ?? {};
    const m = String(src.source_url ?? "").match(URL_YT);
    if (m) ids.add(m[1]);
    if (/^[\w-]{11}$/.test(String(src.source_id ?? ""))) ids.add(src.source_id);
  }
  return ids;
}

/** Id do YouTube de uma transcrição: cabeçalho URL: ou prefixo do arquivo confirmado pelos insights. */
export function idYoutube(texto, nomeArquivo, confirmados) {
  const cabecalho = texto.slice(0, 2000).match(URL_YT);
  if (cabecalho) return cabecalho[1];
  const prefixo = nomeArquivo.match(/^([\w-]{11})[-.]/)?.[1];
  return prefixo && confirmados.has(prefixo) ? prefixo : null;
}

function tituloDe(texto, nomeArquivo, id, insights) {
  // "# Transcript of <título>" (extração OpenCLI): o título do vídeo é o que vem depois do prefixo
  const h1 = texto.match(/^#\s+(.+)$/m)?.[1]?.trim().replace(/^Transcript of\s+/i, "");
  if (h1) return h1;
  const doInsight = insights.find((it) => it?.source?.source_id === id && it?.source?.source_title)?.source.source_title;
  return doInsight ?? humanize(nomeArquivo.replace(/\.transcript(\.txt)?$|\.txt$/i, ""));
}

/* ------------------------------------------------------------------ leitura */

async function listar(dir, filtro, recursivo = false) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => cmp(a.name, b.name))) {
    if (e.isSymbolicLink()) continue;
    const abs = path.join(dir, e.name);
    if (caminhoExcluido(abs)) continue; // BILHON_POPULATE_EXCLUIR: nem listado
    if (e.isDirectory() && recursivo) out.push(...(await listar(abs, filtro, true)));
    else if (e.isFile() && filtro(e.name)) out.push(abs);
  }
  return out;
}

/** Especialistas descobertos pelo DNA: [{ slug, bucket }]. */
export async function descobrirEspecialistas(repoRoot, { includePersonal = false } = {}) {
  const buckets = includePersonal ? ["external", "business", "personal"] : ["external", "business"];
  const out = [];
  for (const bucket of buckets) {
    const raiz = path.join(repoRoot, "knowledge", bucket, "dna", "persons");
    let entries = [];
    try {
      entries = await readdir(raiz, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries.sort((a, b) => cmp(a.name, b.name))) {
      if (e.isDirectory() && !e.isSymbolicLink() && SLUG_OK.test(e.name) && !caminhoExcluido(path.join(raiz, e.name))) out.push({ slug: e.name, bucket });
    }
  }
  return out;
}

/** Insights do especialista: arquivo by-person versionável primeiro, artefato MCE em .data depois. */
export async function lerInsights(repoRoot, bucket, slug, avisos) {
  const candidatos = [
    path.join(repoRoot, "knowledge", bucket, "insights", "by-person", `${slug}.json`),
    path.join(repoRoot, ".data", "artifacts", "insights", slug, "INSIGHTS-STATE.json"),
  ];
  for (const abs of candidatos) {
    if (caminhoExcluido(abs) || !existsSync(abs)) continue;
    const r = await lerTextoSeguro(abs);
    if (r.motivo) {
      avisos.push(`${slug}: insights em ${path.relative(repoRoot, abs)} ignorados (${r.motivo})`);
      continue;
    }
    let json;
    try {
      json = JSON.parse(r.text);
    } catch {
      avisos.push(`${slug}: ${path.relative(repoRoot, abs)} não é JSON válido`);
      continue;
    }
    const pessoas = Object.entries(json?.persons ?? {});
    const escolhida =
      pessoas.find(([, v]) => v?.slug === slug) ??
      pessoas.find(([nome]) => slugify(nome) === slug) ??
      (pessoas.length === 1 ? pessoas[0] : null);
    if (!escolhida) {
      avisos.push(`${slug}: ${path.relative(repoRoot, abs)} sem pessoa correspondente`);
      continue;
    }
    const [nome, dados] = escolhida;
    const insights = (dados?.insights ?? []).filter((it) => it && it.id && (it.insight || it.text));
    return { nome, insights, abs };
  }
  return { nome: humanize(slug), insights: [], abs: null };
}

/* ------------------------------------------------------------------ grafo (chamado por grafo.mjs) */

/**
 * Extrator do grafo: para cada especialista, cada insight cuja citação aparece literalmente
 * numa transcrição do corpus vira conceito estrutural `mce-<slug>-<id>` com evidência de
 * definição nessa transcrição. Devolve estatísticas por especialista (inclui `semEvidencia`).
 *
 * @param g      instância de `Grafo` (_extracao.mjs)
 * @param corpus `criarCorpus(ctx.docs)` — as transcrições precisam estar no corpus (kind "doc")
 * @param ctx    contexto do populate (repoRoot, opts)
 */
export async function extrairInsightsMce(g, corpus, ctx) {
  const porEspecialista = {};
  for (const { slug, bucket } of await descobrirEspecialistas(ctx.repoRoot, { includePersonal: ctx.opts?.includePersonal })) {
    const avisos = [];
    const info = await lerInsights(ctx.repoRoot, bucket, slug, avisos);
    for (const a of avisos) g.aviso(a);
    const prefixos = [`knowledge/${bucket}/processed/${slug}/`, `knowledge/${bucket}/inbox/${slug}/`];
    // cópia idêntica (mesmo texto em outro caminho) conta uma vez; a primeira em ordem de caminho fica
    const vistos = new Set();
    const transcricoes = corpus.docs.filter((d) => {
      if (d.kind !== "doc" || d.ext !== ".txt" || !prefixos.some((p) => d.rel.startsWith(p))) return false;
      const h = d.sha256 ?? createHash("sha256").update(d.text).digest("hex");
      if (vistos.has(h)) return false;
      vistos.add(h);
      return true;
    });
    const confirmados = idsConfirmadosPorInsights(info.insights);
    const comId = transcricoes.map((d) => ({ d, id: idYoutube(d.text, path.posix.basename(d.rel), confirmados) }));

    let evidencias = 0;
    const semEvidencia = [];
    for (const it of info.insights) {
      const preferida = comId.find((t) => t.id && t.id === it?.source?.source_id);
      const ordem = preferida ? [preferida, ...comId.filter((t) => t !== preferida)] : comId;
      let ok = false;
      for (const { d } of ordem) {
        const loc = localizarCitacao(d.text, it.quote ?? "");
        if (!loc) continue;
        const doc = corpus.canon(d);
        const trecho = prefixoNoChunk(corpus.chunksNorm(doc), norm(loc.trecho));
        if (!trecho) continue;
        const id = `mce-${slug}-${slugify(it.id)}`;
        g.conceito(id, { label: norm(it.insight ?? it.text).slice(0, 280), origem: `mce-insight:${slug}`, estrutural: true, forcarLabel: true });
        g.definicao(id, doc, trecho, "mce-insight");
        ok = true;
        break;
      }
      if (ok) evidencias++;
      else semEvidencia.push(it.id);
    }
    if (semEvidencia.length) {
      g.aviso(`${slug}: ${semEvidencia.length} insight(s) sem citação literal nas transcrições ficaram fora do grafo (${semEvidencia.slice(0, 6).join(", ")}${semEvidencia.length > 6 ? ", …" : ""})`);
    }
    if (info.insights.length) {
      porEspecialista[slug] = { insights: info.insights.length, evidencias, semEvidencia, transcricoes: transcricoes.length };
    }
  }
  return porEspecialista;
}

/* ------------------------------------------------------------------ montagem da coleção */

/** Documentos da coleção do especialista: Map(doc → { texto, origem }). */
async function montarEspecialista(repoRoot, { slug, bucket }, avisos) {
  const kb = path.join(repoRoot, "knowledge", bucket);
  const insightsInfo = await lerInsights(repoRoot, bucket, slug, avisos);
  const confirmados = idsConfirmadosPorInsights(insightsInfo.insights);
  const docs = new Map();
  const transcricoes = [];
  const rel = (abs) => path.relative(repoRoot, abs).split(path.sep).join("/");

  const adicionar = async (doc, abs, extra = {}, texto = null) => {
    let t = texto;
    if (t === null) {
      const r = await lerTextoSeguro(abs);
      if (r.motivo) {
        avisos.push(`${slug}: ${rel(abs)} fora da coleção (${r.motivo})`);
        return null;
      }
      t = r.text;
    }
    if (docs.has(doc)) doc = `${doc.replace(/(\.[^.]+)?$/, "")}-${createHash("sha256").update(rel(abs)).digest("hex").slice(0, 6)}${path.extname(doc)}`;
    const item = { doc, texto: t, origem: rel(abs), ...extra };
    docs.set(doc, item);
    return item;
  };

  // transcrições (processed primeiro; inbox se o lifecycle ainda não moveu)
  let arquivosTx = await listar(path.join(kb, "processed", slug), (n) => n.endsWith(".txt"), true);
  if (!arquivosTx.length) arquivosTx = await listar(path.join(kb, "inbox", slug), (n) => n.endsWith(".txt"), true);
  const textosVistos = new Map(); // sha256 do texto → origem da primeira cópia
  for (const abs of arquivosTx) {
    const nome = path.basename(abs);
    const r = await lerTextoSeguro(abs);
    if (r.motivo) {
      avisos.push(`${slug}: ${rel(abs)} fora da coleção (${r.motivo})`);
      continue;
    }
    const h = createHash("sha256").update(r.text).digest("hex");
    if (textosVistos.has(h)) {
      avisos.push(`${slug}: ${rel(abs)} é cópia idêntica de ${textosVistos.get(h)}: entra uma vez só na coleção`);
      continue;
    }
    textosVistos.set(h, rel(abs));
    const id = idYoutube(r.text, nome, confirmados);
    const item = await adicionar(
      id ? `${id}.transcript` : nome,
      abs,
      { youtube: id, titulo: tituloDe(r.text, nome, id, insightsInfo.insights) },
      r.text,
    );
    if (item) transcricoes.push(item);
  }

  for (const abs of await listar(path.join(kb, "dna", "persons", slug), (n) => /\.ya?ml$/i.test(n))) {
    await adicionar(`dna-${path.basename(abs)}`, abs);
  }
  if (insightsInfo.abs) await adicionar(`insights-${slug}.json`, insightsInfo.abs);
  for (const abs of await listar(path.join(kb, "dossiers", "persons"), (n) => n.toLowerCase().includes(slug) && n.endsWith(".md"))) {
    await adicionar(`dossier-${slug}.md`, abs);
  }
  for (const abs of await listar(path.join(kb, "dossiers", "persons-by-theme"), (n) => n.startsWith(`${slug}--`) && n.endsWith(".md"))) {
    await adicionar(`tema-${path.basename(abs)}`, abs);
  }
  for (const abs of await listar(path.join(kb, "sources", slug.toUpperCase()), (n) => n.endsWith(".md"))) {
    await adicionar(`fonte-${path.basename(abs)}`, abs);
  }
  for (const abs of await listar(path.join(repoRoot, "agents", bucket, slug), (n) => /\.(md|ya?ml)$/i.test(n))) {
    await adicionar(`agente-${path.basename(abs)}`, abs);
  }

  const arqCheckpoint = path.join(repoRoot, ".claude", "mission-control", "mce", slug, "checkpoints", "identity-checkpoint.json");
  const checkpoint = caminhoExcluido(arqCheckpoint) ? null : await readJsonSafe(arqCheckpoint);
  return { docs, transcricoes, insightsInfo, veredito: checkpoint?.verdict ?? "pendente" };
}

/* ------------------------------------------------------------------ escrita */

async function marcadorDe(pasta) {
  const m = await readJsonSafe(path.join(pasta, ".populate-managed"));
  return m && m.modulo === MODULO ? m : null;
}

async function gravarColecao(raiz, slug, esp, avisos) {
  const pasta = path.join(raiz, slug);
  if (existsSync(pasta)) {
    const meu = await marcadorDe(pasta);
    if (!meu && (await readdir(pasta)).length > 0) {
      avisos.push(`pasta colecoes-external/sources/${slug} existe sem o marcador deste módulo: coleção do especialista preservada como está`);
      return { status: "pasta-alheia" };
    }
  }
  const trechos = [];
  for (const { doc, texto } of [...esp.docs.values()].sort((a, b) => cmp(a.doc, b.doc))) {
    chunkWords(texto).forEach((t, n) => trechos.push([`${doc}#${n}`, doc, t]));
  }
  if (!trechos.length) return { status: "vazia" };
  const esperado = { docs: esp.docs.size, chunks: trechos.length };
  const h = createHash("sha256").update(FORMATO);
  for (const [id, video, text] of trechos) h.update(`\u0000${id}\u0000${video}\u0000${text}`);
  const fingerprint = h.digest("hex");

  await ensureDir(pasta);
  const anterior = await marcadorDe(pasta);
  if (!anterior) await writeJson(path.join(pasta, ".populate-managed"), { modulo: MODULO, formato: FORMATO, fingerprint: null, colecao: slug });
  const store = path.join(pasta, STORE);
  const igual = anterior?.fingerprint === fingerprint && (await storeConfere(store, esperado));
  if (!igual) await construirStore(store, trechos, esperado);

  await writeJson(path.join(pasta, ".provenance.json"), {
    tier: "B",
    fonte: "mega-brain",
    origem: "ingestão MCE (transcrições + extração de DNA por LLM)",
    review: esp.veredito,
    fontes: esp.transcricoes.length,
    insights: esp.insightsInfo.insights.length,
    vetores: false,
    regra: "B = conteúdo derivado por pipeline (DNA/insights gerados por LLM sobre as fontes); conferir evidências antes de citar",
  });
  await writeJson(path.join(pasta, ".ontology.json"), { domain: esp.bucket });
  await writeJson(path.join(pasta, ".populate-managed"), {
    modulo: MODULO,
    formato: FORMATO,
    fingerprint,
    colecao: slug,
    docs: esperado.docs,
    chunks: esperado.chunks,
  });
  return { status: igual ? "inalterada" : "reconstruida", ...esperado };
}

/* ------------------------------------------------------------------ run */

export default async function run(ctx) {
  ativarExclusoes(ctx);
  const avisos = [];
  const raizColecoes = path.join(ctx.dataDir, "colecoes-external", "sources");
  const kgDir = path.join(ctx.dataDir, "kg");
  const manifestoFile = path.join(kgDir, "populate-especialistas.json");
  const ytMapFile = path.join(kgDir, "youtube-map.json");
  const anterior = (await readJsonSafe(manifestoFile)) ?? { especialistas: {} };

  const porEspecialista = {};
  const montados = [];
  for (const alvo of await descobrirEspecialistas(ctx.repoRoot, { includePersonal: ctx.opts?.includePersonal })) {
    const esp = { ...alvo, ...(await montarEspecialista(ctx.repoRoot, alvo, avisos)) };
    if (!esp.docs.size) {
      avisos.push(`${alvo.slug}: nenhum documento legível — especialista pulado`);
      continue;
    }
    const colecao = await gravarColecao(raizColecoes, alvo.slug, esp, avisos);
    montados.push(esp);
    porEspecialista[alvo.slug] = {
      bucket: alvo.bucket,
      nome: esp.insightsInfo.nome,
      veredito: esp.veredito,
      colecao: colecao.status,
      docs: esp.docs.size,
      transcricoes: esp.transcricoes.length,
      insights: esp.insightsInfo.insights.length,
      youtube: esp.transcricoes.filter((t) => t.youtube).map((t) => `yt-${alvo.slug}:${t.doc}`),
    };
  }

  // coleções deste módulo cujo especialista sumiu
  const vivos = new Set(Object.keys(porEspecialista));
  for (const slug of Object.keys(anterior.especialistas ?? {})) {
    if (vivos.has(slug)) continue;
    const pasta = path.join(raizColecoes, slug);
    if (!(await marcadorDe(pasta))) continue;
    for (const f of GERADOS) await rm(path.join(pasta, f), { force: true });
    try {
      await rmdir(pasta);
    } catch {
      avisos.push(`pasta ${slug} sem especialista, mas com arquivos de terceiros: mantida`);
    }
  }

  // youtube-map: remove só as chaves que ESTE módulo gravou antes; regrava as atuais
  const ytMap = (await readJsonSafe(ytMapFile)) ?? {};
  for (const info of Object.values(anterior.especialistas ?? {})) for (const k of info.youtube ?? []) delete ytMap[k];
  for (const esp of montados) {
    for (const t of esp.transcricoes.filter((x) => x.youtube)) {
      ytMap[`yt-${esp.slug}:${t.doc}`] = {
        titulo: t.titulo,
        url: `https://www.youtube.com/watch?v=${t.youtube}`,
        canal: esp.slug, // = slug da coleção (docs/dados.md); o nome de exibição está no manifesto
      };
    }
  }
  await writeJson(ytMapFile, Object.fromEntries(Object.entries(ytMap).sort((a, b) => cmp(a[0], b[0]))));

  await writeJson(manifestoFile, {
    modulo: MODULO,
    versao: VERSAO,
    regras: {
      descoberta: "knowledge/<bucket>/dna/persons/<slug>/",
      grafo: "insights entram pelo módulo grafo (extrairInsightsMce): só com citação literal; ver modulos.grafo.resumo.insightsMce",
      youtube: "id do cabeçalho URL: da transcrição ou confirmado pelos insights; nunca só pelo nome do arquivo",
    },
    especialistas: porEspecialista,
  });

  log(MODULO, `${vivos.size} especialista(s): ${Object.entries(porEspecialista).map(([s, e]) => `${s} (${e.colecao}, ${e.docs} docs)`).join("; ")}`);
  return { resumo: { especialistas: vivos.size, porEspecialista }, avisos };
}
