/**
 * Módulo `referencias` — popula `data/referencias-instagram/` (tela /referencias).
 *
 * O mega-brain não tem coletor de posts. O único material visual real do repositório é
 * `.github/assets` (banner.svg, logo-dark.svg, social-preview.png). Este módulo publica UM
 * post "mega-brain-identidade" com as imagens que o app consegue servir (a rota
 * `app/api/referencias/[dir]/[img]/route.ts` só devolve jpg/jpeg/png/webp/heic — no outlierhub pelo
 * `mimeReal` de lib/referencias.ts, que olha os primeiros bytes e cai para `MIME_POR_EXT`; SVG
 * responde 400, então o SVG fica de fora e isso é avisado). Nenhum post é inventado.
 *
 * Sempre grava um `referencias.json` válido — sem ele o app mostra posts FICTÍCIOS de exemplo.
 *
 * Preserva o que não é nosso: posts de outras origens, `videos` baixados pelo app, e os arquivos
 * de estado (`favoritos.json`, `antipatterns.json`, `anotacoes.json`, `prompts-reversos.json`,
 * `videos-urls.json`). `hashes.json` só recebe/perde a chave do nosso post. O que geramos é
 * rastreado em `.populate-managed.json` para uma regeneração só remover o que foi nosso.
 *
 * Idempotente: `extraidoEm` só muda quando o conteúdo muda.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmdirSync, statSync } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ativarExclusoes, caminhoExcluido, log, slugify, writeJson } from "./common.mjs";
import { remoteBase } from "./kanban.mjs";

const COD_POST = "mega-brain-identidade";
const COLECAO = "Identidade visual";
const EXT_SERVIDAS_PADRAO = ["jpg", "jpeg", "png", "webp", "heic"];

const sha256Bytes = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Extensões que a rota de imagem serve — lidas do código do app para não divergir dele. No outlierhub
 * a rota delega a `mimeReal` e o mapa por extensão vive em lib/referencias.ts (`MIME_POR_EXT`); no
 * template antigo ele estava escrito na própria rota. O primeiro arquivo que tiver o mapa vence.
 */
export function extensoesServidas(appRoot) {
  const fontes = [
    path.join(appRoot, "lib", "referencias.ts"),
    path.join(appRoot, "app", "api", "referencias", "[dir]", "[img]", "route.ts"),
  ];
  for (const arq of fontes) {
    let fonte = "";
    try { fonte = readFileSync(arq, "utf8"); } catch { continue; }
    const mapa = fonte.match(/MIME_POR_EXT[^=]*=\s*(\{[^}]*\})/)?.[1] ?? fonte.match(/\{\s*jpg:[^}]*\}/)?.[0];
    const chaves = mapa ? [...mapa.matchAll(/\b([a-z0-9]+)\s*:\s*"image\//g)].map((m) => m[1]) : [];
    if (chaves.length) return chaves;
  }
  return EXT_SERVIDAS_PADRAO;
}

/** Largura e altura de um PNG (IHDR); `null` se não for PNG. */
function dimensoesPng(buf) {
  const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(assinatura)) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Primeiro bloco `> …` do README: a descrição que o projeto escreve sobre si mesmo. */
function legendaDoReadme(readme) {
  if (!readme) return null;
  const linhas = readme.split("\n");
  const ini = linhas.findIndex((l) => /^>\s?/.test(l));
  if (ini < 0) return null;
  const bloco = [];
  for (let i = ini; i < linhas.length && /^>/.test(linhas[i]); i++) bloco.push(linhas[i].replace(/^>\s?/, "").trim());
  // `**` vira texto cru na legenda (o app não renderiza Markdown ali)
  const texto = bloco.join(" ").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return texto || null;
}

async function copiaAtomica(origem, destino) {
  await mkdir(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.${process.pid}.tmp`;
  await copyFile(origem, tmp);
  await rename(tmp, destino);
}

function lerJsonEstrito(arquivo, rotulo) {
  if (!existsSync(arquivo)) return null;
  try {
    return JSON.parse(readFileSync(arquivo, "utf8"));
  } catch {
    throw new Error(`${rotulo} está ilegível (JSON inválido); nada foi gravado. Corrija ou restaure o arquivo antes de popular.`);
  }
}

const estavel = (v) => {
  if (Array.isArray(v)) return v.map(estavel);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, estavel(v[k])]));
  return v;
};
const igual = (a, b) => JSON.stringify(estavel(a)) === JSON.stringify(estavel(b));

function removerPastaSeVazia(dir) {
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    /* já removida ou não vazia */
  }
}

export default async function run(ctx) {
  ativarExclusoes(ctx);
  const avisos = [];
  const refsDir = path.join(ctx.dataDir, "referencias-instagram");
  const arquivoRefs = path.join(refsDir, "referencias.json");
  const arquivoManifesto = path.join(refsDir, ".populate-managed.json");
  const arquivoHashes = path.join(refsDir, "hashes.json");
  const ts = new Date().toISOString();

  // ---- 1. material visual real do repositório
  const assetsRel = ".github/assets";
  const assetsAbs = path.join(ctx.repoRoot, assetsRel);
  const servidas = extensoesServidas(ctx.appRoot);
  let todos = [];
  try {
    todos = readdirSync(assetsAbs, { withFileTypes: true }).filter((e) => e.isFile() && !caminhoExcluido(path.join(assetsAbs, e.name))).map((e) => e.name).sort();
  } catch {
    avisos.push(`${assetsRel} não existe: nenhum post de identidade visual foi gerado`);
  }
  const usaveis = todos.filter((n) => servidas.includes(path.extname(n).slice(1).toLowerCase()));
  const ignoradas = todos.filter((n) => !usaveis.includes(n));
  if (ignoradas.length) {
    avisos.push(`${ignoradas.join(", ")} não entraram: a rota /api/referencias/<dir>/<img> só serve ${servidas.join("/")} (SVG responde 400)`);
  }

  // ---- 2. post gerado (ou nenhum)
  const base = remoteBase(ctx.repoRoot);
  const imagens = usaveis.map((nome) => {
    const buf = readFileSync(path.join(assetsAbs, nome));
    return { nome, abs: path.join(assetsAbs, nome), sha: sha256Bytes(buf), dim: dimensoesPng(buf) };
  });
  let post = null;
  if (imagens.length) {
    const readme = ctx.docs.find((d) => d.rel === "README.md")?.text ?? null;
    const legendaReadme = legendaDoReadme(readme);
    const principal = imagens.find((i) => i.nome === "social-preview.png") ?? imagens[0];
    const dimTxt = principal.dim ? ` (${principal.dim.w}×${principal.dim.h})` : "";
    const repo = base ? base.split("/").slice(-2).join("/") : "mega-brain";
    if (!base) avisos.push("remote origin indisponível: o post foi gerado com igUrl vazio");
    post = {
      code: COD_POST,
      user: repo,
      caption: `Mega Brain — identidade visual do repositório: ${imagens.map((i) => i.nome).join(", ")}${dimTxt}. ${legendaReadme ?? ""}`.trim(),
      igUrl: base ? `${base}/tree/main/${assetsRel}` : "",
      dir: COD_POST,
      images: imagens.map((i) => i.nome),
      videoIdx: [],
      colecoes: [COLECAO],
      plataforma: "sites",
      dominio: "identidade-visual",
    };
  }

  // ---- 3. estado anterior
  const refsAtual = lerJsonEstrito(arquivoRefs, "data/referencias-instagram/referencias.json");
  const manifestoAtual = lerJsonEstrito(arquivoManifesto, "data/referencias-instagram/.populate-managed.json") ?? { versao: 1, posts: {}, colecoes: [] };
  const hashesAtual = lerJsonEstrito(arquivoHashes, "data/referencias-instagram/hashes.json");
  const novoManifesto = { versao: 1, posts: {}, colecoes: [] };

  // ---- 4. mídias: copia o que é nosso; remove o que foi nosso e saiu
  if (post) {
    for (const img of imagens) {
      const destino = path.join(refsDir, post.dir, img.nome);
      const jaIgual = existsSync(destino) && sha256Bytes(readFileSync(destino)) === img.sha;
      if (!jaIgual) await copiaAtomica(img.abs, destino);
    }
    novoManifesto.posts[post.code] = { dir: post.dir, arquivos: Object.fromEntries(imagens.map((i) => [i.nome, i.sha])) };
    novoManifesto.colecoes = [...post.colecoes];
  }
  for (const [codigo, antigo] of Object.entries(manifestoAtual.posts ?? {})) {
    const atual = novoManifesto.posts[codigo];
    for (const nome of Object.keys(antigo.arquivos ?? {})) {
      if (atual?.dir === antigo.dir && atual.arquivos[nome]) continue;
      if (!/^[A-Za-z0-9._-]+$/.test(antigo.dir ?? "") || !/^[A-Za-z0-9._-]+$/.test(nome)) continue;
      const alvo = path.join(refsDir, antigo.dir, nome);
      // só remove se continua sendo o arquivo que geramos (o usuário pode ter trocado)
      if (existsSync(alvo) && statSync(alvo).isFile() && sha256Bytes(readFileSync(alvo)) === antigo.arquivos[nome]) await rm(alvo, { force: true });
    }
    if (!atual) removerPastaSeVazia(path.join(refsDir, antigo.dir ?? ""));
  }

  // ---- 5. referencias.json (mescla)
  const criado = refsAtual === null;
  const alvo = refsAtual && typeof refsAtual === "object" && !Array.isArray(refsAtual) ? refsAtual : {};
  const postsAtuais = Array.isArray(alvo.posts) ? alvo.posts : [];
  const codigosNossos = new Set([...Object.keys(manifestoAtual.posts ?? {}), ...(post ? [post.code] : [])]);
  const posts = [];
  let inserido = false;
  for (const p of postsAtuais) {
    if (post && p.code === post.code) {
      posts.push({ ...p, ...post }); // preserva `videos` etc. gravados pelo app
      inserido = true;
    } else if (codigosNossos.has(p.code)) {
      continue; // nosso e sem fonte hoje: sai
    } else {
      posts.push(p);
    }
  }
  if (post && !inserido) posts.push({ ...post });

  const nomesNossos = new Set([...(manifestoAtual.colecoes ?? []), ...novoManifesto.colecoes]);
  const colecoes = (Array.isArray(alvo.colecoes) ? alvo.colecoes : []).filter((cl) => !nomesNossos.has(cl.nome) || posts.some((p) => p.colecoes?.includes(cl.nome)));
  for (const nome of novoManifesto.colecoes) {
    const n = posts.filter((p) => p.colecoes?.includes(nome)).length;
    const idx = colecoes.findIndex((cl) => cl.nome === nome);
    if (idx >= 0) colecoes[idx] = { ...colecoes[idx], n };
    else colecoes.push({ id: slugify(nome), nome, n });
  }
  const conteudoNovo = { fonte: alvo.fonte ?? "mega-brain", colecoes, posts };
  const conteudoAntigo = refsAtual ? { fonte: alvo.fonte ?? "mega-brain", colecoes: alvo.colecoes ?? [], posts: postsAtuais } : null;
  if (criado || !igual(conteudoNovo, conteudoAntigo)) {
    await writeJson(arquivoRefs, { ...alvo, ...conteudoNovo, extraidoEm: ts });
  }

  // ---- 6. hashes.json (só a chave do nosso post)
  if (post) {
    const checksum = sha256Bytes(Buffer.from(imagens.map((i) => i.sha).join(":"), "utf8"));
    const h = hashesAtual && typeof hashesAtual === "object" ? hashesAtual : {};
    const porPost = { ...(h.porPost ?? {}), [post.code]: { checksum } };
    const novo = { ...h, porPost };
    if (!igual(novo, hashesAtual)) await writeJson(arquivoHashes, novo);
  } else if (hashesAtual?.porPost && codigosNossos.size) {
    const porPost = { ...hashesAtual.porPost };
    let mudou = false;
    for (const c of codigosNossos) if (c in porPost) { delete porPost[c]; mudou = true; }
    if (mudou) await writeJson(arquivoHashes, { ...hashesAtual, porPost });
  }

  // ---- 7. manifesto do que é nosso
  if (!igual(novoManifesto, manifestoAtual) || !existsSync(arquivoManifesto)) await writeJson(arquivoManifesto, novoManifesto);

  log("referencias", post ? `1 post (${imagens.length} imagem(ns)); ${posts.length} no total` : `sem post; ${posts.length} no total`);
  return {
    resumo: { posts: posts.length, gerados: post ? 1 : 0, imagens: imagens.length, ignoradas: ignoradas.length, colecoes: colecoes.length },
    avisos,
  };
}
