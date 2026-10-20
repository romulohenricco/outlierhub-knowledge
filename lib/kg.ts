/**
 * Leitura do grafo de conhecimento (livros-kg.sqlite) — via CLI `sqlite3 -json`
 * do macOS (read-only, zero deps nativas). Escrita é exclusiva do kg-extract.py.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getBooks, getBookIndex, LIVROS_DIR } from "./catalog";
import { getReferencias, REFS_DIR } from "./referencias";
import { diasDoDisco } from "./datas-disco";
import { dataMinima } from "./grafo-data";
import { cortaTexto } from "./texto";
import type { EcoKind, EcoProcedencia } from "./types";

const exec = promisify(execFile);

export const KG_DB =
  process.env.BILHON_KG_DB || path.join(process.cwd(), "data", "kg", "livros-kg.sqlite");

/** Qual das 3 camadas do canvas o nó/aresta habita. Ausente =
 *  "conhecimento" — o campo é opcional pra não exigir reescrita das leituras
 *  do sqlite, que só produzem essa camada. */
export type KgCamada = "conhecimento" | "topologia" | "ecossistema";

/** Tipo de nó da camada de topologia (o disco em si). Vive num campo separado
 *  de `tipo` pra não poluir a união do conhecimento — ver lib/topologia.ts. */
export type TopoNodeTipo =
  | "pasta-relevante"
  | "arquivo"
  | "skill"
  | "script"
  | "engine"
  | "remote"
  | "hook"
  | "launchagent"
  | "repo"
  | "plano"
  | "dominio"
  | "app"
  | "bridge";

export type TopoEdgeTipo =
  | "contem"
  | "pertence_a"
  | "referencia"
  | "symlink"
  | "git_remote"
  | "ponte"
  | "executa";

export type KgNode = {
  id: string;
  label: string;
  tipo:
    | "conceito"
    | "livro"
    | "referencia"
    | "video"
    | "perfil"
    | "colecao-ig"
    | "topologia"
    | "ecossistema";
  livroId?: string; // id do catálogo quando tipo=livro
  grau?: number;
  igUrl?: string; // link do post quando tipo=referencia|video
  x?: number; // posição precomputada (sidecar graph-layout.json)
  y?: number;
  camada?: KgCamada;
  tipoTopo?: TopoNodeTipo; // só quando camada=topologia
  path?: string; // caminho absoluto no disco, só quando camada=topologia
  plano?: string; // plano/categoria do nó, derivado de `pertence_a`
  ecoKind?: EcoKind; // só quando camada=ecossistema
  procedencia?: EcoProcedencia; // só quando camada=ecossistema
  descricao?: string; // só quando camada=ecossistema
  /** YYYY-MM-DD — última modificação/atividade (ver lib/grafo-data.ts). Ausente = desconhecida. */
  data?: string;
  /** hub sem data própria (raiz, hub de kind, perfil/coleção de referências,
   *  plano): passa sempre no filtro de data, senão o desenho do que passou
   *  desmontaria. */
  estrutural?: boolean;
};

export const GRAPH_LAYOUT =
  process.env.BILHON_GRAPH_LAYOUT || path.join(process.cwd(), "data", "kg", "graph-layout.json");

let layoutCache: {
  mtimeMs: number;
  data: Record<string, { x: number; y: number }>;
} | null = null;
/**
 * Carrega o sidecar de layout (x,y precomputados). Cache invalidado por mtime —
 * após `node scripts/graph-layout.mjs` regenerar o arquivo, a próxima carga relê (sem
 * precisar reiniciar o servidor). Ausente → {} (fallback gracioso).
 */
export async function carregarLayout(): Promise<
  Record<string, { x: number; y: number }>
> {
  const { stat } = await import("node:fs/promises");
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(GRAPH_LAYOUT)).mtimeMs;
  } catch {
    layoutCache = { mtimeMs: 0, data: {} }; // ausente
    return layoutCache.data;
  }
  if (layoutCache && layoutCache.mtimeMs === mtimeMs) return layoutCache.data;
  try {
    layoutCache = { mtimeMs, data: JSON.parse(await readFile(GRAPH_LAYOUT, "utf-8")) };
  } catch {
    layoutCache = { mtimeMs, data: {} };
  }
  return layoutCache.data;
}
export type KgEdge = {
  id: number;
  src: string;
  rel: string;
  dst: string;
  status: "claimed" | "confirmed" | "disputed";
  n_fontes: number;
  peso: number;
  camada?: KgCamada;
  tipoTopo?: TopoEdgeTipo; // só quando camada=topologia
  /** referência que aponta pra um path inexistente (do extrator). Não vira
   *  `status:"disputed"` de propósito: "disputed" é desacordo entre fontes do
   *  conhecimento, não alvo quebrado — misturar os dois mentiria no filtro. */
  alvoMorto?: boolean;
};

async function q<T>(sql: string): Promise<T[]> {
  const { stdout } = await exec("sqlite3", ["-json", "-readonly", KG_DB, sql], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim() ? (JSON.parse(stdout) as T[]) : [];
}

function esc(s: string) {
  return s.replaceAll("'", "''");
}

export async function grafo(opts: {
  status: string[];
  tema?: string;
  incluirLivros?: boolean;
  maxEdges?: number;
  /** id ou label de um nó que TEM que vir (deep-link ?focus=), mesmo fora do corte */
  foco?: string;
}) {
  const status = opts.status.filter((s) =>
    ["claimed", "confirmed", "disputed"].includes(s),
  );
  if (status.length === 0) return { nodes: [], edges: [] };
  const st = status.map((s) => `'${s}'`).join(",");

  // filtro por tema: arestas com >=1 evidência vinda de livro daquele tema
  let temaJoin = "";
  if (opts.tema) {
    const books = await getBooks();
    const arquivos = books
      .filter((b) => b.tema === opts.tema)
      .map((b) => `'${esc(b.arquivo)}'`);
    if (arquivos.length === 0) return { nodes: [], edges: [] };
    temaJoin = `AND id IN (SELECT edge_id FROM evidences WHERE livro IN (${arquivos.join(",")}))`;
  }
  const livroFiltro =
    opts.incluirLivros === false ? "AND src NOT LIKE 'livro:%'" : "";

  const edges = await q<KgEdge>(
    `SELECT id,src,rel,dst,status,n_fontes,peso FROM edges
     WHERE status IN (${st}) ${livroFiltro} ${temaJoin}
     ORDER BY n_fontes DESC, peso DESC LIMIT ${opts.maxEdges ?? 1500}`,
  );

  // o corte acima deixa de fora o conceito de nicho (1 livro): sem isto, o link
  // de conceito da página do livro abria o grafo e não achava o nó. O foco ignora
  // o tema de propósito — quem pediu o nó pelo nome quer vê-lo.
  if (opts.foco) {
    const f = esc(opts.foco);
    const doFoco = await q<KgEdge>(
      `SELECT id,src,rel,dst,status,n_fontes,peso FROM edges
       WHERE status IN (${st}) ${livroFiltro}
         AND (src IN (SELECT id FROM nodes WHERE id='${f}' OR label='${f}')
           OR dst IN (SELECT id FROM nodes WHERE id='${f}' OR label='${f}'))
       ORDER BY n_fontes DESC, peso DESC LIMIT 200`,
    );
    const jaVeio = new Set(edges.map((e) => e.id));
    for (const e of doFoco) if (!jaVeio.has(e.id)) edges.push(e);
  }

  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.src);
    ids.add(e.dst);
  }
  const all = await q<KgNode>("SELECT id,label,tipo FROM nodes");
  const grau = new Map<string, number>();
  for (const e of edges) {
    grau.set(e.src, (grau.get(e.src) ?? 0) + 1);
    grau.set(e.dst, (grau.get(e.dst) ?? 0) + 1);
  }
  // índice leve arquivo→id (sem stat de capa — o grafo não usa capas)
  const idPorArquivo = await getBookIndex();
  const layout = await carregarLayout(); // posições precomputadas (sidecar)
  const datas = await datasDoConhecimento(edges, idPorArquivo);
  const nodes = all
    .filter((n) => ids.has(n.id))
    .map((n) => ({
      ...n,
      grau: grau.get(n.id) ?? 0,
      livroId:
        n.tipo === "livro"
          ? idPorArquivo.get(n.id.replace(/^livro:/, ""))
          : undefined,
      ...(datas.get(n.id) ? { data: datas.get(n.id) } : {}),
      ...(layout[n.id] ? { x: layout[n.id].x, y: layout[n.id].y } : {}),
    }));
  return { nodes, edges };
}

/**
 * Data dos nós do conhecimento (o sqlite não tem timestamp nenhum):
 *  - livro → mtime do arquivo em LIVROS_DIR (≈ quando entrou no acervo)
 *  - conceito → a obra MAIS ANTIGA entre as evidências das arestas mostradas,
 *    ou seja, desde quando o acervo sustenta aquele conceito
 * Fonte sem arquivo no catálogo fica sem data — ausente em vez de inventada.
 */
async function datasDoConhecimento(
  edges: KgEdge[],
  idPorArquivo: Map<string, string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (edges.length === 0) return out;
  const arquivos = [...idPorArquivo.keys()];
  const dias = await diasDoDisco(
    arquivos.map((a) => path.join(LIVROS_DIR, a)),
    LIVROS_DIR,
  );
  const diaDoArquivo = (a: string) => dias.get(path.join(LIVROS_DIR, a));
  for (const a of arquivos) {
    const d = diaDoArquivo(a);
    if (d) out.set(`livro:${a}`, d);
  }
  const ev = await q<{ edge_id: number; livro: string }>(
    `SELECT DISTINCT edge_id, livro FROM evidences
     WHERE edge_id IN (${edges.map((e) => Number(e.id)).join(",")})`,
  );
  const livrosDaAresta = new Map<number, string[]>();
  for (const r of ev) {
    const l = livrosDaAresta.get(r.edge_id) ?? [];
    l.push(r.livro);
    livrosDaAresta.set(r.edge_id, l);
  }
  const candidatas = new Map<string, Array<string | undefined>>();
  for (const e of edges) {
    const ds = (livrosDaAresta.get(e.id) ?? []).map(diaDoArquivo);
    for (const no of [e.src, e.dst]) {
      if (no.startsWith("livro:")) continue;
      const l = candidatas.get(no) ?? [];
      l.push(...ds);
      candidatas.set(no, l);
    }
  }
  for (const [no, ds] of candidatas) {
    const d = dataMinima(ds);
    if (d) out.set(no, d);
  }
  return out;
}

/** Frações do texto onde `scripts/kg-extract.py:250` amostra os trechos de livro
 *  (`[0.2, 0.6][:MAX_TRECHOS_LIVRO]`) — o `#n` do `chunk_id` é o índice NESTA
 *  lista, não um chunk de uma divisão uniforme. É contrato compartilhado com o
 *  extrator: se as frações mudarem lá, mudam aqui. */
const FRACOES_TRECHO_LIVRO = [0.2, 0.6];

/** Página aproximada de uma evidência de livro. Só existe para PDF com nº de
 *  páginas conhecido e índice de trecho conhecido — índice fora da lista devolve
 *  `null` (a UI esconde a estimativa), porque um número errado com aparência de
 *  certo é pior que a ausência dele: abriria o leitor no capítulo errado. */
export function paginaDoTrechoDeLivro(
  chunkIdx: number,
  paginas: number | null,
): number | null {
  if (!paginas || paginas <= 0) return null;
  const fracao = FRACOES_TRECHO_LIVRO[chunkIdx];
  if (fracao === undefined) return null;
  return Math.min(paginas, Math.max(1, Math.round(fracao * paginas)));
}

export async function evidencias(edgeId: number) {
  const rows = await q<{
    livro: string;
    chunk_id: string;
    trecho: string;
    confianca: number;
  }>(
    `SELECT livro,chunk_id,trecho,confianca FROM evidences WHERE edge_id=${Number(edgeId)}`,
  );

  // enriquece com o catálogo: id/título do livro + índice do chunk + página estimada
  const books = await getBooks();
  const porArquivo = new Map(books.map((b) => [b.arquivo, b]));
  const { getBook } = await import("./catalog");
  // fonte ClickUp: doc cu-*.md → url/pasta/lista (destaque no grafo)
  let cuMap: Record<string, { url: string; pasta: string; lista: string; nome: string }> = {};
  try {
    cuMap = JSON.parse(
      await readFile(
        process.env.BILHON_CLICKUP_MAP || path.join(process.cwd(), "data", "kg", "clickup-map.json"),
        "utf-8",
      ),
    );
  } catch {
    /* mapa ainda não gerado */
  }
  // fonte canal/YouTube: evidência yt-<slug>:<doc> → título/URL do vídeo
  let ytMap: Record<string, { titulo: string; url: string; canal: string }> = {};
  try {
    ytMap = JSON.parse(
      await readFile(
        process.env.BILHON_YOUTUBE_MAP || path.join(process.cwd(), "data", "kg", "youtube-map.json"),
        "utf-8",
      ),
    );
  } catch {
    /* mapa ainda não gerado */
  }
  const ytDe = (livro: string) => {
    if (!livro.startsWith("yt-")) return null;
    const hit = ytMap[livro] ?? ytMap[`${livro}.txt`]; // store salva sem .txt
    if (hit) return hit;
    const canal = livro.slice(3, livro.indexOf(":"));
    const doc = livro.slice(livro.indexOf(":") + 1);
    const id = doc.match(/^([\w-]{11})\.transcript/)?.[1]; // doc é o ID do vídeo
    return {
      titulo: doc.replace(/\.transcript(\.txt)?$/, ""),
      url: id ? `https://www.youtube.com/watch?v=${id}` : "",
      canal,
    };
  };
  return Promise.all(
    rows.map(async (r) => {
      const book = porArquivo.get(r.livro);
      const det = book ? await getBook(book.id) : null;
      const chunkIdx = Number(r.chunk_id.split("#").pop() ?? -1);
      const paginaEstimada = paginaDoTrechoDeLivro(chunkIdx, det?.paginas ?? null);
      const cu = cuMap[r.livro];
      const yt = ytDe(r.livro);
      return {
        ...r,
        livroId: book?.id ?? null,
        livroTitulo: cu ? cu.nome : yt ? yt.titulo : (book?.titulo ?? r.livro),
        formato: book?.formato ?? null,
        chunkIdx,
        paginaEstimada,
        clickup: cu
          ? { url: cu.url, pasta: cu.pasta, lista: cu.lista }
          : null,
        youtube: yt,
      };
    }),
  );
}

/** Obras-fonte + vizinhança de um conceito (livros com evidência, relações e
 *  conceitos vizinhos — o contexto que ancora o autolearning no domínio certo). */
export async function fontesDoConceito(conceitoId: string) {
  const c = conceitoId.replaceAll("'", "''");
  const rows = await q<{ livro: string; rel: string; src: string; dst: string }>(
    `SELECT DISTINCT ev.livro, e.rel, e.src, e.dst FROM edges e
     JOIN evidences ev ON ev.edge_id = e.id
     WHERE (e.src='${c}' OR e.dst='${c}') AND e.rel != 'menciona'`,
  );
  const livros = [...new Set(rows.map((r) => r.livro))];
  const relacoes = [...new Set(rows.map((r) => r.rel))];
  const vizinhos = [
    ...new Set(
      rows.flatMap((r) => [r.src, r.dst]).filter((x) => x !== conceitoId),
    ),
  ].slice(0, 12);
  return { livros, relacoes, vizinhos };
}

export async function kgStats() {
  const r = await q<Record<string, number>>(`SELECT
    (SELECT COUNT(*) FROM nodes WHERE tipo='conceito') conceitos,
    (SELECT COUNT(*) FROM nodes WHERE tipo='livro') livros,
    (SELECT COUNT(*) FROM edges WHERE status='confirmed' AND src NOT LIKE 'livro:%') confirmed,
    (SELECT COUNT(*) FROM edges WHERE status='claimed' AND src NOT LIKE 'livro:%') claimed,
    (SELECT COUNT(*) FROM edges WHERE status='disputed') disputed`);
  return r[0] ?? { conceitos: 0, livros: 0, confirmed: 0, claimed: 0, disputed: 0 };
}

/**
 * Nós/arestas das referências IG (galeria /referencias): post → perfil e
 * post → coleção IG. IDs de aresta sintéticos NEGATIVOS (não colidem com o
 * sqlite). Antipatterns ficam de fora.
 */
export async function grafoReferencias(opts: {
  refs: boolean;
  videos: boolean;
}): Promise<{ nodes: KgNode[]; edges: KgEdge[] }> {
  const { posts, antipatterns } = await getReferencias();
  const ativos = posts.filter((p) => {
    if (p.code in antipatterns) return false;
    const ehVideo = p.videoIdx.length > 0;
    return ehVideo ? opts.videos : opts.refs;
  });
  // perfil só vira hub com >=2 posts (senão só polui o grafo)
  const porUser = new Map<string, number>();
  for (const p of ativos) porUser.set(p.user, (porUser.get(p.user) ?? 0) + 1);

  const nodes: KgNode[] = [];
  const edges: KgEdge[] = [];
  const grau = new Map<string, number>();
  const hubs = new Set<string>();
  let eid = -1;
  const liga = (src: string, rel: string, dst: string) => {
    edges.push({ id: eid--, src, rel, dst, status: "confirmed", n_fontes: 1, peso: 1 });
    grau.set(src, (grau.get(src) ?? 0) + 1);
    grau.set(dst, (grau.get(dst) ?? 0) + 1);
  };
  for (const p of ativos) {
    const ehVideo = p.videoIdx.length > 0;
    const id = `ref:${p.code}`;
    nodes.push({
      id,
      // corte por code point: legenda de IG tem emoji, e cortar no meio do par
      // de surrogates emitia JSON inválido pra parser estrito
      label: p.caption ? cortaTexto(p.caption, 48) : `@${p.user}/${p.code}`,
      tipo: ehVideo ? "video" : "referencia",
      igUrl: p.igUrl,
    });
    if ((porUser.get(p.user) ?? 0) >= 2) {
      const perfilId = `perfil:${p.user}`;
      if (!hubs.has(perfilId)) {
        hubs.add(perfilId);
        nodes.push({ id: perfilId, label: `@${p.user}`, tipo: "perfil", estrutural: true });
      }
      liga(id, "por", perfilId);
    }
    for (const c of p.colecoes) {
      const colId = `col-ig:${c}`;
      if (!hubs.has(colId)) {
        hubs.add(colId);
        nodes.push({ id: colId, label: c, tipo: "colecao-ig", estrutural: true });
      }
      liga(id, "salvo em", colId);
    }
  }
  // data do post = mtime da pasta dele (≈ quando foi salvo/ingerido)
  const dirDe = new Map(ativos.map((p) => [`ref:${p.code}`, path.join(REFS_DIR, p.dir)]));
  const dias = await diasDoDisco([...dirDe.values()], REFS_DIR);
  for (const n of nodes) {
    n.grau = grau.get(n.id) ?? 0;
    const d = dias.get(dirDe.get(n.id) ?? "");
    if (d) n.data = d;
  }
  return { nodes, edges };
}
