/**
 * Camada de dados da biblioteca — filesystem local, read-only.
 *
 * Fonte única: data/livros/catalogo.json (caminho configurável por BILHON_CATALOGO).
 * Os arquivos dos livros ficam em data/livros/arquivos (BILHON_LIVROS_DIR).
 * Sem banco, sem rede — regra "zero dados externos".
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Livro, LivroDetalhe } from "./types";

const CATALOGO_JSON =
  (process.env.BILHON_CATALOGO || undefined) ?? path.join(process.cwd(), "data", "livros", "catalogo.json");

export const LIVROS_DIR =
  (process.env.BILHON_LIVROS_DIR || undefined) ?? path.join(process.cwd(), "data", "livros", "arquivos");

export const COVERS_DIR = path.join(LIVROS_DIR, ".covers");

type Bruto = {
  id: string;
  titulo: string;
  arquivo: string;
  formato: string;
  tema: string;
  cluster: number | null;
  origem: string;
  sizeBytes: number;
  paginas?: number | null;
  chunksTotal?: number;
  vizinhos: { id: string; titulo: string; score: number }[];
  proveniencia: { origemPath: string; motivo: string };
};

const DOMINIOS_JSON =
  (process.env.BILHON_LIVROS_DOMINIOS || undefined) ??
  path.join(process.cwd(), "data", "livros", "livros-dominios.json");

const HASHES_JSON =
  (process.env.BILHON_LIVROS_HASHES || undefined) ??
  path.join(process.cwd(), "data", "livros", "livros-hashes.json");

let cache: {
  livros: Bruto[];
  porId: Map<string, Bruto>;
  dominios: Record<string, string>;
  hashes: Record<string, string>;
  /** true quando o catálogo veio das fixtures (nenhum catálogo configurado). */
  demo: boolean;
} | null = null;

const DEMO_LIVROS_JSON = path.join(process.cwd(), "fixtures", "demo", "livros.json");
/** Conteúdo original do catálogo demo; o fallback aponta para ele, e não para LIVROS_DIR. */
const DEMO_LIVROS_DIR = path.join(process.cwd(), "fixtures", "demo", "livros");
/** Capas (PNG da 1ª página) dos PDFs de exemplo do catálogo demo. */
const DEMO_COVERS_DIR = path.join(DEMO_LIVROS_DIR, ".covers");

type LivroDemo = { id: string; titulo: string; tema: string; dominio?: string; resumo?: string; arquivo: string; formato: string; paginas?: number };

/** Fallback para clone limpo: cadernos originais Knowledge, licenciados sob MIT. */
async function carregarLivrosDemo(): Promise<{ livros: Bruto[]; dominios: Record<string, string> }> {
  const raw = JSON.parse(await readFile(DEMO_LIVROS_JSON, "utf-8")) as LivroDemo[];
  const tamanhos = await Promise.all(
    raw.map((l) => stat(path.join(DEMO_LIVROS_DIR, l.arquivo)).then((s) => s.size, () => 0)),
  );
  const livros = raw.map((l, i) => ({
    id: l.id,
    titulo: l.titulo,
    arquivo: l.arquivo,
    formato: l.formato,
    tema: l.tema,
    cluster: null,
    origem: "INBOX",
    sizeBytes: tamanhos[i],
    paginas: l.paginas ?? null,
    vizinhos: [],
    proveniencia: {
      origemPath: "fixtures/demo/livros.json",
      motivo: l.formato === "pdf"
        ? "conteúdo original Knowledge, licença MIT (demonstração sem catálogo configurado)"
        : "dado sintético de demonstração (sem catálogo configurado)",
    },
  }));
  const dominios: Record<string, string> = {};
  for (const l of raw) if (l.dominio) dominios[l.id] = l.dominio;
  return { livros, dominios };
}

async function load() {
  if (cache) return cache;
  let livros: Bruto[];
  let demo = false;
  let dominiosDemo: Record<string, string> = {};
  try {
    const raw = JSON.parse(await readFile(CATALOGO_JSON, "utf-8"));
    livros = raw.livros;
  } catch {
    const exemplo = await carregarLivrosDemo();
    livros = exemplo.livros;
    dominiosDemo = exemplo.dominios;
    demo = true;
  }
  // sidecars de ontologia — anotam sem mutar o catálogo (só-mapa)
  const sidecar = async (p: string, campo: string) => {
    try {
      return JSON.parse(await readFile(p, "utf-8"))[campo] ?? {};
    } catch {
      return {};
    }
  };
  const [dominios, hashes] = await Promise.all([
    sidecar(DOMINIOS_JSON, "porLivro"),
    sidecar(HASHES_JSON, "porLivro"),
  ]);
  cache = { livros, porId: new Map(livros.map((l) => [l.id, l])), dominios: { ...dominiosDemo, ...dominios }, hashes, demo };
  return cache;
}

/** Pasta das capas: no catálogo demo, a dos PDFs de exemplo; configurado, a da pasta de livros.
 *  Depende do cache: só vale depois de load() (getBook/getBooks), como a rota /api/covers faz. */
const capasDir = () => (cache?.demo ? DEMO_COVERS_DIR : COVERS_DIR);

async function temCapa(arquivo: string): Promise<boolean> {
  const png = path.join(capasDir(), `${path.parse(arquivo).name}.png`);
  try {
    await stat(png);
    return true;
  } catch {
    return false;
  }
}

/** Índice leve arquivo→id (sem stat de capa) — para consumidores como o grafo. */
export async function getBookIndex(): Promise<Map<string, string>> {
  const { livros } = await load();
  return new Map(livros.map((l) => [l.arquivo, l.id]));
}

/**
 * Cobertura de ontologia dos livros SEM stat de capa (usa o cache do catálogo).
 * comRelacoes conta só livros com vizinhos kNN não-vazios.
 */
export async function coberturaLivros(): Promise<{
  total: number;
  comDominio: number;
  comChecksum: number;
  comRelacoes: number;
  distDominio: [string, number][];
}> {
  const { livros, dominios, hashes } = await load();
  const dist = new Map<string, number>();
  let comDominio = 0;
  let comChecksum = 0;
  let comRelacoes = 0;
  for (const l of livros) {
    const dom = dominios[l.id];
    if (dom) {
      comDominio++;
      dist.set(dom, (dist.get(dom) ?? 0) + 1);
    }
    if (hashes[l.id]) comChecksum++;
    if ((l.vizinhos?.length ?? 0) > 0) comRelacoes++;
  }
  return {
    total: livros.length,
    comDominio,
    comChecksum,
    comRelacoes,
    distDominio: [...dist.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function pub(l: Bruto, capa: boolean, dominio?: string, checksum?: string): Livro {
  return {
    id: l.id,
    titulo: l.titulo,
    arquivo: l.arquivo,
    formato: l.formato as Livro["formato"],
    tema: l.tema,
    dominio,
    checksum,
    cluster: l.cluster,
    origem: l.origem as Livro["origem"],
    sizeBytes: l.sizeBytes,
    temCapa: capa,
  };
}

export async function getBooks(): Promise<Livro[]> {
  const { livros, dominios, hashes } = await load();
  return Promise.all(
    livros.map(async (l) =>
      pub(l, await temCapa(l.arquivo), dominios[l.id], hashes[l.id]),
    ),
  );
}

/** Campos físicos que o card da estante usa (caminho para exibir, págs., chunks) — chave = id. */
export async function getBooksFisico(): Promise<
  Map<string, { path: string; paginas: number | null; chunksTotal: number }>
> {
  const { livros, demo } = await load();
  return new Map(
    livros.map((l) => [
      l.id,
      {
        path: caminhoParaExibir(path.join(demo ? DEMO_LIVROS_DIR : LIVROS_DIR, l.arquivo), l.arquivo),
        paginas: l.paginas ?? null,
        chunksTotal: l.chunksTotal ?? 0,
      },
    ]),
  );
}

export async function getBook(id: string): Promise<LivroDetalhe | null> {
  const { porId, dominios, hashes, demo } = await load();
  const l = porId.get(id);
  if (!l) return null;
  return {
    ...pub(l, await temCapa(l.arquivo), dominios[l.id], hashes[l.id]),
    vizinhos: l.vizinhos,
    proveniencia: l.proveniencia ?? null,
    path: caminhoParaExibir(path.join(demo ? DEMO_LIVROS_DIR : LIVROS_DIR, l.arquivo), l.arquivo),
    paginas: l.paginas ?? null,
    chunksTotal: l.chunksTotal ?? 0,
  };
}

/** Caminho para mostrar na tela e na API: relativo ao projeto quando está dentro dele;
 *  fora disso, só o nome do arquivo — o diretório absoluto da máquina não sai do servidor. */
function caminhoParaExibir(abs: string, arquivo: string): string {
  const rel = path.relative(process.cwd(), abs);
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return arquivo;
  return rel.split(path.sep).join("/");
}

/** Path absoluto do arquivo do livro — SEMPRE dentro da pasta de livros (anti-traversal)
 *  e só se o arquivo existe: um catálogo à frente da pasta vira null (404), não erro de leitura. */
export async function resolveFilePath(id: string): Promise<string | null> {
  const { porId, demo } = await load();
  const l = porId.get(id);
  if (!l) return null;
  const base = path.resolve(demo ? DEMO_LIVROS_DIR : LIVROS_DIR);
  const p = path.resolve(base, l.arquivo);
  if (!p.startsWith(base + path.sep)) return null;
  try {
    if (!(await stat(p)).isFile()) return null;
  } catch {
    return null;
  }
  return p;
}

/** Path da capa em cache (pode não existir — checar com temCapa antes). */
export function coverPathFor(arquivo: string): string {
  return path.join(capasDir(), `${path.parse(arquivo).name}.png`);
}
