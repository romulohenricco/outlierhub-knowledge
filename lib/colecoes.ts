/**
 * Coleções da estante — cada store local de chunks (canal/pessoa/playlist/clickup)
 * vira uma "pasta" com todos os docs ingeridos dentro. Read-only via sqlite3 CLI.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const EXT =
  (process.env.BILHON_COLECOES_EXT || undefined) ?? path.join(process.cwd(), "data", "colecoes-external");
const YT_MAP =
  (process.env.BILHON_YOUTUBE_MAP || undefined) ?? path.join(process.cwd(), "data", "kg", "youtube-map.json");
// Stores que são a própria estante (não listar de novo como "coleção") —
// configurável via CSV, vazio por padrão.
const NAO_COLECAO = new Set(
  ((process.env.BILHON_COLECOES_EXCLUIR || undefined) ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

export type Colecao = {
  slug: string;
  nome: string;
  tipo: "pessoa" | "playlist" | "clickup" | "cursos";
  docs: number;
  chunks: number;
  tier: string;
  atualizadoEm: number; // epoch ms — mtime do _corpus_bge.sqlite (proxy universal de "última ingestão", vale pra qualquer origem)
  dominio?: string; // domínio da ontologia — lido de inbox/<slug>/.ontology.json (opcional; ausente em coleções sem sidecar)
};
export type ItemColecao = {
  doc: string;
  titulo: string;
  chunks: number;
  youtubeUrl: string | null;
  ehDna: boolean;
  grafoFocus: string; // id do nó no grafo (deep-link)
};

async function q<T>(db: string, sql: string): Promise<T[]> {
  const { stdout } = await exec("sqlite3", ["-json", "-readonly", db, sql], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim() ? (JSON.parse(stdout) as T[]) : [];
}

function nomeBonito(slug: string) {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function descobrirStores(): { slug: string; nomeBase: string; db: string; tipo: Colecao["tipo"] }[] {
  const out: { slug: string; nomeBase: string; db: string; tipo: Colecao["tipo"] }[] = [];
  // prefixo por diretório: sem ele, o mesmo slug em dna/persons e sources colide
  // e a rota /colecao/<slug> resolve sempre pro primeiro, escondendo o outro store
  for (const [dir, tipoBase, prefixo] of [
    [path.join(EXT, "dna/persons"), "pessoa", "dna-"],
    [path.join(EXT, "dna/sources"), "playlist", "dna-src-"],
    [path.join(EXT, "sources"), "playlist", ""],
  ] as const) {
    if (!existsSync(dir)) continue;
    for (const nomeBase of readdirSync(dir)) {
      const db = path.join(dir, nomeBase, "_corpus_bge.sqlite");
      if (!existsSync(db) || NAO_COLECAO.has(nomeBase)) continue;
      const tipo: Colecao["tipo"] =
        nomeBase.startsWith("CLICKUP") ? "clickup"
        : nomeBase.includes("CURSO") ? "cursos"
        : tipoBase;
      out.push({ slug: `${prefixo}${nomeBase}`, nomeBase, db, tipo });
    }
  }
  return out;
}

let cache: { at: number; data: Colecao[] } | null = null;

export async function getColecoes(): Promise<Colecao[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.data;
  const stores = descobrirStores();
  const data = (
    await Promise.all(
      stores.map(async ({ slug, nomeBase, db, tipo }) => {
        try {
          const [r] = await q<{ d: number; c: number }>(
            db, "SELECT COUNT(DISTINCT video) d, COUNT(*) c FROM chunks");
          if (!r || r.d === 0) return null;
          let tier = "?";
          try {
            tier = JSON.parse(
              await readFile(path.join(path.dirname(db), ".provenance.json"), "utf-8"),
            ).tier ?? "?";
          } catch { /* sem sidecar */ }
          const nome = slug.startsWith("dna-")
            ? `${nomeBonito(nomeBase)} (DNA)`
            : nomeBonito(nomeBase);
          let atualizadoEm = 0;
          try {
            atualizadoEm = statSync(db).mtimeMs;
          } catch { /* sem stat -> fica 0, vai pro fim da ordenação por recência */ }
          let dominio: string | undefined;
          // .ontology.json pode estar em dois lugares: inbox/<slug>/ (gravado na
          // hora da ingestão) ou colocado junto do próprio sqlite (gravado
          // retroativamente pra coleções de import em lote que nunca passaram pelo
          // inbox/).
          for (const ontologyPath of [
            path.join(EXT, "inbox", nomeBase, ".ontology.json"),
            path.join(path.dirname(db), ".ontology.json"),
          ]) {
            try {
              const raw = JSON.parse(await readFile(ontologyPath, "utf-8")).domain as string | undefined;
              // "engines(2)" ou "engines(2) + agents(1)" -> pega só o domínio primário
              dominio = raw?.match(/^[a-z]+/)?.[0];
              if (dominio) break;
            } catch { /* sem sidecar nesse caminho, tenta o próximo */ }
          }
          return { slug, nome, tipo, docs: r.d, chunks: r.c, tier, atualizadoEm, dominio };
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean) as Colecao[];
  data.sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  cache = { at: Date.now(), data };
  return data;
}

/** Transcript COMPLETO de um doc, reconstruído dos chunks locais (nada depende
 *  do YouTube — se o vídeo sair do ar, o texto vive aqui). Remove o overlap de
 *  50 palavras entre chunks consecutivos (WORDS=400/OVERLAP=50 do corpus). */
export async function getTranscript(slug: string, doc: string) {
  const store = descobrirStores().find((s) => s.slug === slug);
  if (!store) return null;
  const rows = await q<{ chunk_id: string; text: string }>(
    store.db,
    `SELECT chunk_id, text FROM chunks WHERE video='${doc.replaceAll("'", "''")}'`,
  );
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    const ia = Number(a.chunk_id.split("#").pop() ?? 0);
    const ib = Number(b.chunk_id.split("#").pop() ?? 0);
    return ia - ib;
  });
  const partes = rows.map((r, i) => {
    if (i === 0) return r.text;
    return r.text.split(/\s+/).slice(50).join(" "); // tira o overlap
  });
  let ytMap: Record<string, { titulo: string; url: string }> = {};
  try {
    ytMap = JSON.parse(await readFile(YT_MAP, "utf-8"));
  } catch { /* sem mapa */ }
  const yt = ytMap[`yt-${slug}:${doc}`] ?? ytMap[`yt-${slug}:${doc}.txt`];
  const id = doc.match(/^([\w-]{11})\.transcript/)?.[1];
  return {
    doc,
    titulo:
      yt?.titulo ??
      doc.replace(/\.transcript(\.txt)?$/, "").replace(/^dna-/, "DNA · "),
    youtubeUrl: yt?.url ?? (id ? `https://www.youtube.com/watch?v=${id}` : null),
    texto: partes.join(" "),
    chunks: rows.length,
  };
}

export async function getColecao(slug: string): Promise<{
  colecao: Colecao;
  itens: ItemColecao[];
} | null> {
  const col = (await getColecoes()).find((c) => c.slug === slug);
  if (!col) return null;
  const store = descobrirStores().find((s) => s.slug === slug);
  if (!store) return null;
  let ytMap: Record<string, { titulo: string; url: string }> = {};
  try {
    ytMap = JSON.parse(await readFile(YT_MAP, "utf-8"));
  } catch { /* sem mapa */ }
  const rows = await q<{ video: string; c: number }>(
    store.db, "SELECT video, COUNT(*) c FROM chunks GROUP BY video ORDER BY video");
  const itens = rows.map((r) => {
    // store grava "<nome>.transcript" (sem .txt); o mapa foi gerado com .txt
    const yt =
      ytMap[`yt-${slug}:${r.video}`] ?? ytMap[`yt-${slug}:${r.video}.txt`];
    const id = r.video.match(/^([\w-]{11})\.transcript/)?.[1];
    const ehDna = r.video.startsWith("dna-");
    return {
      doc: r.video,
      titulo:
        yt?.titulo ??
        r.video
          .replace(/\.transcript(\.txt)?$/, "")
          .replace(/^dna-/, "DNA · ")
          .replace(/^cu-\w+-/, ""),
      chunks: r.c,
      youtubeUrl: yt?.url ?? (id ? `https://www.youtube.com/watch?v=${id}` : null),
      ehDna,
      grafoFocus: `livro:yt-${slug}:${r.video}`,
    };
  });
  return { colecao: col, itens };
}
