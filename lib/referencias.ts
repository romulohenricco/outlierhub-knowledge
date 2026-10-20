/**
 * Referências visuais — salvos do Instagram do usuário (todas as coleções).
 * Fonte: referencias.json dentro de REFS_DIR (padrão data/referencias-instagram/).
 * Deleções viram ANTIPATTERNS ("o que não fazer") em
 * antipatterns.json — nunca apagam imagem do disco.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { caminhoDentroDaRaiz } from "./bilhon-paths";
import { segmentoSeguro } from "./caminho-seguro";
import { baixarVideoPublico } from "./download-publico";

/** Sempre absoluto e normalizado: a contenção das rotas de imagem compara prefixo de texto,
 *  e "./refs", "refs/" ou barra normal no Windows nunca casariam com o caminho já resolvido
 *  (toda imagem viraria 400, em silêncio). */
export const REFS_DIR = path.resolve(
  (process.env.BILHON_REFERENCIAS_DIR || "").trim() || path.join(process.cwd(), "data", "referencias-instagram"),
);

const ANTIPATTERNS = path.join(REFS_DIR, "antipatterns.json");
const PROMPTS_REVERSOS = path.join(REFS_DIR, "prompts-reversos.json");

export type ReferenciaPost = {
  code: string;
  user: string;
  caption: string;
  igUrl: string;
  /** URL local da réplica (clone) do site, quando houver; o botão do card abre esta em vez de igUrl */
  preview?: string;
  dir: string;
  images: string[];
  /** índices 1-based das mídias que são vídeo (imagem = capa) */
  videoIdx: number[];
  /** vídeos já baixados no disco */
  videos?: { idx: number; file: string }[];
  colecoes: string[];
  /** fonte/plataforma do material (instagram|youtube|linkedin|…); default instagram */
  plataforma?: string;
  /** domínio temático (eixo função) — vem de uma classificação feita fora do app */
  dominio?: string;
  /** content_checksum — SHA-256 combinado das mídias do post */
  checksum?: string;
  /** caminhos absolutos do código que reconstrói esta referência (rebuild kit) */
  codigo?: string[];
  anotacao?: Anotacao;
  /** metadados do vídeo quando plataforma === "youtube" */
  youtube?: YoutubeMeta;
  /** prompt reverso — receita pra recriar a imagem igual à referência */
  promptReverso?: PromptReverso;
  /** cadastro de produto com várias páginas: o card aberto agrupa as imagens por página */
  paginas?: PaginaReferencia[];
};

/** Uma página dentro de um cadastro de produto; `images` são nomes em `dir` do post. */
export type PaginaReferencia = {
  titulo: string;
  igUrl: string;
  images: string[];
  preview?: string;
  /** prompt de reuso do clone desta página */
  prompt?: string;
  codigo?: string[];
};

/** Ficha do vídeo de origem (só posts com plataforma "youtube"). */
export type YoutubeMeta = {
  videoId: string;
  canal: string;
  canalNome?: string | null;
  canalUrl?: string | null;
  /** segundos */
  duracao?: number | null;
  /** AAAA-MM-DD */
  publicadoEm?: string | null;
  views?: number | null;
  thumbUrl?: string | null;
};

/**
 * Prompt reverso — a leitura da imagem virada em instrução de geração, pra
 * reproduzir a referência. `prompt` é o texto que se cola num gerador de imagem;
 * `analise` é a decomposição legível (o que faz a thumb funcionar).
 */
export type PromptReverso = {
  prompt: string;
  negativo?: string;
  analise?: {
    composicao?: string;
    /** reserva de interface (topo/base/coluna direita) e sobrevivência ao corte
     *  quadrado da grade de perfil — só faz sentido em material de rede social */
    zonaSegura?: string;
    tipografia?: string;
    cor?: string;
    luz?: string;
    sujeito?: string;
    textoNaImagem?: string;
    /** o gancho: por que esse frame para o scroll */
    gancho?: string;
  };
  /** proporção alvo (16:9 no YouTube, 4:5 no feed do IG) */
  proporcao?: string;
  geradoEm?: string;
  /** quem escreveu (modelo/humano) — auditabilidade */
  por?: string;
};

export type Antipattern = { em: string; motivo: string | null };

/** Anotação de conteúdo — descrição do que a mídia É; estudos densos ganham
 *  transcrição exata + verificação com fontes (ETL de inteligência). */
export type Anotacao = {
  tipo: "estudo" | "visual";
  descricao: string;
  /** transcrição fiel do texto da imagem (estudos densos) */
  texto?: string;
  /** fontes da verificação na internet */
  fontes?: string[];
  verificadoEm?: string;
};

export type Referencias = {
  fonte: string;
  extraidoEm: string;
  colecoes: { id: string; nome: string; n: number }[];
  posts: ReferenciaPost[];
  antipatterns: Record<string, Antipattern>;
  favoritos: Record<string, { em: string }>;
};

let fila: Promise<unknown> = Promise.resolve();
/** Serializa mutações de JSON (processo único) — evita read-modify-write concorrente. */
function comLock<T>(fn: () => Promise<T>): Promise<T> {
  const prox = fila.then(fn, fn);
  fila = prox.catch(() => {});
  return prox;
}

/** Escrita atômica: temp + rename (leitores nunca veem JSON truncado). */
async function writeJsonAtomic(p: string, data: unknown): Promise<void> {
  const { rename, mkdir } = await import("node:fs/promises");
  // template limpo: data/referencias-instagram/ ainda não existe na primeira escrita
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(data, null, 1));
  await rename(tmp, p);
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

const DEMO_REFERENCIAS_JSON = path.join(process.cwd(), "fixtures", "demo", "referencias.json");

type PostDemo = {
  code: string;
  user: string;
  caption: string;
  igUrl: string;
  videoIdx: number[];
  colecoes: string[];
};

/** Fallback pra clone limpo sem referências configuradas — dados 100% sintéticos. */
async function carregarReferenciasDemo(): Promise<Omit<Referencias, "antipatterns">> {
  const raw = JSON.parse(await readFile(DEMO_REFERENCIAS_JSON, "utf-8")) as PostDemo[];
  const colecoesMap = new Map<string, number>();
  for (const p of raw) for (const c of p.colecoes) colecoesMap.set(c, (colecoesMap.get(c) ?? 0) + 1);
  return {
    fonte: "demo",
    // data fixa e neutra: os exemplos não vêm de nenhuma extração real
    extraidoEm: "2026-01-01T00:00:00.000Z",
    colecoes: [...colecoesMap.entries()].map(([id, n]) => ({ id, nome: id, n })),
    posts: raw.map((p) => ({
      code: p.code,
      user: p.user,
      caption: p.caption,
      igUrl: p.igUrl,
      dir: p.code,
      images: [],
      videoIdx: p.videoIdx,
      colecoes: p.colecoes,
      plataforma: "instagram",
    })),
    favoritos: {},
  };
}

/**
 * Inline (anotação/prompt gravados no próprio referencias.json por uma ingestão) x sidecar
 * (o que a API grava): vence o carimbo mais novo. O sidecar vencendo sempre escondia, em
 * silêncio, uma reingestão feita depois de uma edição pela API. Sem carimbo comparável
 * (falta em qualquer lado), o sidecar continua vencendo.
 */
function maisNovo<T>(inline: T | undefined, sidecar: T, carimbo: (x: T) => string | undefined): T {
  if (!inline) return sidecar;
  const ti = Date.parse(carimbo(inline) ?? "");
  const ts = Date.parse(carimbo(sidecar) ?? "");
  return ti > ts ? inline : sidecar;
}

export async function getReferencias(): Promise<Referencias> {
  const raw = await readJson<Omit<Referencias, "antipatterns"> | null>(
    path.join(REFS_DIR, "referencias.json"),
    null,
  );
  const antipatterns = await readJson<Record<string, Antipattern>>(
    ANTIPATTERNS,
    {},
  );
  const anotacoes = await readJson<Record<string, Anotacao>>(
    path.join(REFS_DIR, "anotacoes.json"),
    {},
  );
  const favoritos = await readJson<Record<string, { em: string }>>(
    path.join(REFS_DIR, "favoritos.json"),
    {},
  );
  const hashes = await readJson<{
    porPost?: Record<string, { checksum: string }>;
  }>(path.join(REFS_DIR, "hashes.json"), {});
  const prompts = await readJson<Record<string, PromptReverso>>(
    PROMPTS_REVERSOS,
    {},
  );
  const base = raw ?? (await carregarReferenciasDemo());
  for (const p of base.posts) {
    const a = anotacoes[p.code];
    if (a) p.anotacao = maisNovo(p.anotacao, a, (x) => x.verificadoEm);
    const h = hashes.porPost?.[p.code];
    if (h) p.checksum = h.checksum;
    const pr = prompts[p.code];
    if (pr) p.promptReverso = maisNovo(p.promptReverso, pr, (x) => x.geradoEm);
  }
  // sem referencias.json (modo demo) os favoritos que a pessoa marcou também valem: eles são gravados
  // em favoritos.json, e ignorá-los fazia a estrela acender e sumir no refresh
  return { ...base, antipatterns, favoritos: raw ? favoritos : { ...base.favoritos, ...favoritos } };
}

/** Marca/desmarca um post como favorito. */
export async function setFavorito(
  code: string,
  on: boolean,
): Promise<Record<string, { em: string }>> {
  return comLock(async () => {
    const p = path.join(REFS_DIR, "favoritos.json");
    const atual = await readJson<Record<string, { em: string }>>(p, {});
    if (on) atual[code] = { em: new Date().toISOString() };
    else delete atual[code];
    await writeJsonAtomic(p, atual);
    return atual;
  });
}

/** Grava/atualiza a anotação de um post em anotacoes.json. */
export async function setAnotacao(
  code: string,
  anotacao: Anotacao,
): Promise<void> {
  return comLock(async () => {
    const p = path.join(REFS_DIR, "anotacoes.json");
    const atual = await readJson<Record<string, Anotacao>>(p, {});
    atual[code] = anotacao;
    await writeJsonAtomic(p, atual);
  });
}

/** Grava/atualiza o prompt reverso de um post em prompts-reversos.json. */
export async function setPromptReverso(
  code: string,
  prompt: PromptReverso,
): Promise<void> {
  return comLock(async () => {
    const atual = await readJson<Record<string, PromptReverso>>(
      PROMPTS_REVERSOS,
      {},
    );
    atual[code] = { ...prompt, geradoEm: prompt.geradoEm ?? new Date().toISOString() };
    await writeJsonAtomic(PROMPTS_REVERSOS, atual);
  });
}

/** Marca (motivo opcional) ou desmarca um post como antipattern. */
export async function setAntipattern(
  code: string,
  on: boolean,
  motivo?: string,
): Promise<Record<string, Antipattern>> {
  return comLock(async () => {
    const atual = await readJson<Record<string, Antipattern>>(ANTIPATTERNS, {});
    if (on) {
      atual[code] = { em: new Date().toISOString(), motivo: motivo ?? null };
    } else {
      delete atual[code];
    }
    await writeJsonAtomic(ANTIPATTERNS, atual);
    return atual;
  });
}

const INBOX = (process.env.BILHON_INBOX_SAVECLIP || undefined) ?? path.join(process.cwd(), "data", "inbox", "SaveClip");
const INBOX_YT =
  (process.env.BILHON_INBOX_YOUTUBE || undefined) ?? path.join(process.cwd(), "data", "inbox", "YouTube");

/**
 * Download do vídeo de um post do YouTube via yt-dlp → INBOX/YouTube/<canal>/<id>/,
 * hardlink no curado e registro em referencias.json. Mesmo contrato de retorno do
 * caminho do Instagram.
 *
 * O teto de altura é 720p por padrão (`BILHON_YT_FORMAT`): a rota tem maxDuration de
 * 120s e um vídeo longo em 1080p não termina dentro disso.
 */
async function baixarVideoYoutube(
  post: ReferenciaPost,
  idx: number,
): Promise<{ ok: boolean; erro?: string; file?: string }> {
  const videoId = post.youtube?.videoId ?? post.code;
  const canal = post.youtube?.canal ?? post.user;
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !segmentoSeguro(canal) || !imagePathFor(post.dir, `${videoId}.mp4`)) {
    return { ok: false, erro: "identificação de vídeo inválida" };
  }
  const { mkdir, link, readFile: rf } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { existsSync } = await import("node:fs");
  const exec = promisify(execFile);

  const formato = (process.env.BILHON_YT_FORMAT || undefined) ?? "bv*[height<=720]+ba/b[height<=720]";
  const dir = path.join(INBOX_YT, canal, videoId);
  const inboxAbs = path.join(dir, `${videoId}.mp4`);

  const baixouAgora = !existsSync(inboxAbs);
  if (baixouAgora) {
    await mkdir(dir, { recursive: true });
    try {
      await exec(
        "yt-dlp",
        [
          "-f", formato,
          "--merge-output-format", "mp4",
          "--no-warnings",
          "--ignore-config", "--no-playlist", "--max-filesize", "100M",
          "-o", path.join(dir, `${videoId}.%(ext)s`),
          `https://www.youtube.com/watch?v=${videoId}`,
        ],
        { maxBuffer: 32 << 20, timeout: 90_000 },
      );
    } catch (e) {
      void e;
      return { ok: false, erro: "não foi possível baixar o vídeo do YouTube no prazo ou tamanho permitido" };
    }
    if (!existsSync(inboxAbs)) return { ok: false, erro: "yt-dlp não gerou .mp4" };
  }

  // O limite do yt-dlp é orientativo para formatos de tamanho desconhecido.
  // Confira também o arquivo final; nunca remova um arquivo preexistente do usuário.
  const { stat: statVideo, unlink: removerVideo } = await import("node:fs/promises");
  if ((await statVideo(inboxAbs)).size > 100 * 1024 * 1024) {
    if (baixouAgora) await removerVideo(inboxAbs);
    return { ok: false, erro: "vídeo maior que o limite de 100 MB" };
  }

  const file = `${videoId}.mp4`;
  await mkdir(path.join(REFS_DIR, post.dir), { recursive: true });
  try {
    await link(inboxAbs, path.join(REFS_DIR, post.dir, file));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
      return { ok: false, erro: "não foi possível registrar o vídeo baixado" };
    }
  }

  const refPath = path.join(REFS_DIR, "referencias.json");
  await comLock(async () => {
    const atual = JSON.parse(await rf(refPath, "utf-8"));
    const alvo = (atual.posts as ReferenciaPost[]).find((x) => x.code === post.code);
    if (alvo) {
      alvo.videos = [
        ...(alvo.videos ?? []).filter((v) => v.idx !== idx),
        { idx, file },
      ].sort((a, b) => a.idx - b.idx);
      await writeJsonAtomic(refPath, atual);
    }
  });
  return { ok: true, file };
}

/**
 * Download on-demand de um vídeo (fallback quando o bulk falhou): baixa da URL
 * assinada registrada em videos-urls.json → INBOX/SaveClip,
 * hardlink no diretório curado e atualiza referencias.json. URLs expiram — se
 * der 403, é preciso re-extrair.
 */
export async function baixarVideo(
  code: string,
  idx: number,
): Promise<{ ok: boolean; erro?: string; file?: string }> {
  const { readFile: rf } = await import("node:fs/promises");
  const { mkdir, writeFile: wf, link } = await import("node:fs/promises");

  // YouTube não tem URL assinada de CDN — o vídeo vem pelo yt-dlp, a partir do
  // videoId. Despacha antes de tocar em videos-urls.json (que é só do Instagram).
  const refIdx = await readJson<{ posts?: ReferenciaPost[] } | null>(
    path.join(REFS_DIR, "referencias.json"),
    null,
  );
  const postRef = refIdx?.posts?.find((p) => p.code === code);
  if (postRef?.plataforma === "youtube") return baixarVideoYoutube(postRef, idx);

  // sem referencias.json é o modo demo: os posts são exemplos, não há vídeo a baixar
  if (refIdx === null) return { ok: false, erro: "vídeo indisponível no modo demo" };

  const urls = await readJson<Record<string, { user: string; vids: { idx: number; url: string }[] }> | null>(
    path.join(REFS_DIR, "videos-urls.json"),
    null,
  );
  if (!urls) {
    return { ok: false, erro: "nenhuma URL de vídeo registrada (videos-urls.json) — registre as URLs antes de baixar" };
  }
  const post = Object.hasOwn(urls, code) ? urls[code] : undefined;
  const vid = post?.vids.find((v) => v.idx === idx);
  if (!post || !vid) return { ok: false, erro: "vídeo não registrado" };
  if (!segmentoSeguro(code) || !segmentoSeguro(post.user)) return { ok: false, erro: "identificação de vídeo inválida" };

  const base = path.basename(new URL(vid.url).pathname).replace(/[^a-zA-Z0-9._-]/g, "_");
  const file = `${String(idx).padStart(2, "0")}_${base.endsWith(".mp4") ? base : base + ".mp4"}`;
  const inboxDir = path.join(INBOX, post.user, code);
  const inboxAbs = path.join(inboxDir, file);

  const bytes = await baixarVideoPublico(vid.url);
  await mkdir(inboxDir, { recursive: true });
  await wf(inboxAbs, bytes);

  // hardlink no curado + registra em referencias.json
  const refPath = path.join(REFS_DIR, "referencias.json");
  const ref = JSON.parse(await rf(refPath, "utf-8"));
  const p = (ref.posts as ReferenciaPost[]).find((x) => x.code === code);
  const slug = p?.dir ?? `${post.user}__${code}`;
  if (!imagePathFor(slug, file)) return { ok: false, erro: "pasta de referência inválida" };
  await mkdir(path.join(REFS_DIR, slug), { recursive: true });
  try {
    await link(inboxAbs, path.join(REFS_DIR, slug, file));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
      return { ok: false, erro: "não foi possível registrar o vídeo baixado" };
    }
  }
  await comLock(async () => {
    const atual = JSON.parse(await rf(refPath, "utf-8"));
    const alvo = (atual.posts as ReferenciaPost[]).find((x) => x.code === code);
    if (alvo) {
      alvo.videos = [
        ...(alvo.videos ?? []).filter((v) => v.idx !== idx),
        { idx, file },
      ].sort((a, b) => a.idx - b.idx);
      await writeJsonAtomic(refPath, atual);
    }
  });
  return { ok: true, file };
}

/** Caminho absoluto de uma imagem, recusando qualquer escape do diretório. */
export function imagePathFor(dir: string, img: string): string | null {
  if (!segmentoSeguro(dir) || !segmentoSeguro(img)) return null;
  const abs = path.join(REFS_DIR, dir, img);
  if (!abs.startsWith(REFS_DIR + path.sep)) return null;
  // caminho REAL: um link simbólico dentro da pasta que aponte para fora não pode ser servido
  // (raiz que ainda não existe, como num template recém-clonado: não há link simbólico para temer)
  if (existsSync(REFS_DIR) && !caminhoDentroDaRaiz(REFS_DIR, abs)) return null;
  return abs;
}

const MIME_POR_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

/**
 * MIME real do arquivo, olhando os magic bytes e caindo para a extensão só quando não
 * reconhece a assinatura.
 *
 * Existe porque a extensão pode mentir: downloads de redes sociais costumam guardar o
 * nome original da URL (um `.heic?stp=dst-jpg` vira `.heic` com bytes de JPEG). Servir
 * isso como `image/heic` quebra a imagem em navegadores que não decodificam HEIC.
 */
export async function mimeReal(abs: string): Promise<string | null> {
  const ext = abs.slice(abs.lastIndexOf(".") + 1).toLowerCase();
  try {
    const { open } = await import("node:fs/promises");
    const fh = await open(abs, "r");
    try {
      const buf = Buffer.alloc(12);
      const { bytesRead } = await fh.read(buf, 0, 12, 0);
      if (bytesRead >= 12) {
        if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
        if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
          return "image/png";
        if (buf.subarray(0, 4).toString("latin1") === "RIFF" &&
            buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
        if (buf.subarray(4, 8).toString("latin1") === "ftyp") return "image/heic";
      }
    } finally {
      await fh.close();
    }
  } catch {
    // ilegível: cai para a extensão e deixa o chamador tratar o erro de leitura
  }
  return MIME_POR_EXT[ext] ?? null;
}

/**
 * Resolve o caminho do THUMBNAIL de uma imagem (WebP em .thumbs/), com fallback
 * ao original quando o thumb ainda não foi gerado. Retorna { path, mime } ou null
 * (traversal). Usa a mesma guarda do imagePathFor.
 */
export async function thumbPathFor(
  dir: string,
  img: string,
): Promise<{ path: string; mime: string } | null> {
  const orig = imagePathFor(dir, img);
  if (!orig) return null;
  // nome completo com extensão (evita colisão x.jpg/x.png)
  const thumb = path.join(REFS_DIR, dir, ".thumbs", `${img}.webp`);
  // guarda extra (base não pode escapar)
  if (!thumb.startsWith(REFS_DIR + path.sep)) return null;
  try {
    const { stat } = await import("node:fs/promises");
    await stat(thumb);
    return { path: thumb, mime: "image/webp" };
  } catch {
    // fallback: original, com MIME pelos magic bytes (a extensão pode mentir, ver mimeReal)
    const mime = await mimeReal(orig);
    return mime ? { path: orig, mime } : null;
  }
}
