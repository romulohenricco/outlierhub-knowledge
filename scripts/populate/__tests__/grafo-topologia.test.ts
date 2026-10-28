/**
 * Valida os dados gerados por `scripts/populate/grafo.mjs` e `topologia.mjs`
 * contra o LEITOR REAL do app (lib/kg.ts, lib/topologia.ts, lib/livro-conteudo.ts,
 * lib/grafo-data.ts, lib/datas-disco.ts) e contra o próprio repositório mega-brain
 * (as evidências precisam ser trechos reais dos documentos).
 *
 * Os blocos que leem data/ só rodam se foi a população que gerou aqueles dados a
 * partir do mega-brain lido aqui: data/.populated.json com o módulo `ok` (o marcador
 * mescla execuções, então sozinho não basta) e a procedência dos próprios arquivos.
 * No grafo, o manifesto data/kg/populate-grafo.json com o sha256 DESTE sqlite e a
 * `raiz` do repositório lido; na topologia, o carimbo `conteudo_sha256` de
 * nodes.json/edges.json batendo com o conteúdo e o nó `repo:mega-brain` com a raiz.
 * Sem população, ou com um grafo/topologia de outra origem (kg-extract.py rodado
 * depois, cópia antiga, outro mega-brain; o app também roda sem Megabrain), cada
 * bloco é pulado em vez de falhar. Os que comparam com o mega-brain vivo só rodam
 * quando `resolveRepoRoot()` (common.mjs) acha um: o template também roda sozinho,
 * num clone avulso.
 * Asserções sobre o CONTEÚDO desta distribuição do mega-brain (conceitos nomeados,
 * volumes, proporções medidas neste corpus) só rodam com POPULATE_E2E=1: outro
 * mega-brain gera outro grafo, igualmente válido.
 * Os blocos "sintéticos" montam um repositório numa pasta temporária e rodam sempre.
 * O leitor do grafo (lib/kg.ts, lib/livro-conteudo.ts) consulta o SQLite pela CLI
 * `sqlite3` (com FTS5): sem ela (o padrão no Windows), os testes que passam por ele
 * são pulados (`TEM_SQLITE3_FTS5`, de `_sqlite-cli.ts`).
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderTexto } from "@/lib/render-texto";
import { valorRaiz } from "../ambiente.mjs";
import { chunkWords, raizEfetivaDoApp, resolveRepoRoot, scanRepo, sha256 } from "../common.mjs";
import {
  alinharAoLeitor, alvoDoLeitor, criarLeitor, janela, normComMapa, nosDeTexto, renderHtmlLeitor, semMarcadorDeBloco,
} from "../_extracao.mjs";
import runGrafo, { copiarPorBackup, limparTmpOrfaos, trocarSqlite } from "../grafo.mjs";
import runTopologia from "../topologia.mjs";
import { TEM_SQLITE3_FTS5 } from "./_sqlite-cli";

// O disco B: sob carga deixa estes testes lentos; o limite padrão de 60 s estourava sem haver defeito.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

/** Módulos que `npm run populate` concluiu (`ok: true`) segundo data/.populated.json; vazio sem o marcador. */
function modulosPopulados(dataDir: string): Set<string> {
  try {
    const marcador = JSON.parse(readFileSync(path.join(dataDir, ".populated.json"), "utf8")) as {
      modulos?: Record<string, { ok?: unknown } | null>;
    };
    return new Set(Object.entries(marcador.modulos ?? {}).filter(([, m]) => m?.ok === true).map(([nome]) => nome));
  } catch {
    return new Set();
  }
}

const APP = process.cwd();
const KG = path.join(APP, "data", "kg", "livros-kg.sqlite");
const MANIFESTO_GRAFO = path.join(APP, "data", "kg", "populate-grafo.json");
const TOPO = path.join(APP, "data", "topology");
/** Conteúdo desta distribuição do mega-brain (padrão de livros-colecoes.test.ts): `POPULATE_E2E=1 npx vitest run <arquivo>`. */
const E2E = process.env.POPULATE_E2E === "1";
/** Raiz do mega-brain vivo, ou null quando o app não está dentro de um (clone avulso do template). */
const REPO_MB: string | null = (() => {
  try {
    return resolveRepoRoot();
  } catch {
    return null;
  }
})();

/** Os dois caminhos levam à mesma pasta? (no Windows, sem diferenciar maiúsculas) */
const mesmaPasta = (a: string, b: string) => path.relative(path.resolve(a), path.resolve(b)) === "";

/**
 * O livros-kg.sqlite de data/kg é o que o módulo `grafo` gerou lendo `repo`? O marcador não diz:
 * ele mescla execuções, e o kg-extract.py (ou uma cópia à mão) pode trocar o sqlite depois do
 * populate. A prova é a mesma com que o grafo.mjs reconhece o que gerou e o lib/kg.ts (`raizDoGrafo`)
 * data as fontes yt-: o manifesto data/kg/populate-grafo.json traz o sha256 DESTE sqlite e a `raiz`
 * do repositório lido (relativa à pasta do manifesto). Manifesto anterior ao campo `raiz` não comprova.
 * `kg`/`manifesto` só mudam no teste da própria guarda (bloco sintético do grafo).
 */
function grafoDestePopulate(repo: string | null, kg = KG, manifesto = MANIFESTO_GRAFO): boolean {
  if (!repo || !existsSync(kg)) return false;
  try {
    const m = JSON.parse(readFileSync(manifesto, "utf8")) as { sqliteSha256?: unknown; raiz?: unknown };
    if (typeof m.sqliteSha256 !== "string" || typeof m.raiz !== "string" || !m.raiz) return false;
    if (createHash("sha256").update(readFileSync(kg)).digest("hex") !== m.sqliteSha256) return false;
    return mesmaPasta(path.resolve(path.dirname(manifesto), m.raiz), repo);
  } catch {
    return false; // sem manifesto (ou ilegível): grafo de outra origem
  }
}

/**
 * O análogo para data/topology, com o que o módulo `topologia` já grava: o carimbo `conteudo_sha256`
 * (sha256 de `{ nodesOut, edgesOut }`) igual nos dois arquivos e igual ao conteúdo deles (um extrato de
 * outra origem não tem o carimbo; um trocado ou editado depois não bate) e o nó `repo:mega-brain`, cujo
 * `path` é a raiz do repositório lido. `topo` só muda no teste da própria guarda (bloco sintético da topologia).
 */
function topologiaDestePopulate(repo: string | null, topo = TOPO): boolean {
  if (!repo) return false;
  try {
    const N = JSON.parse(readFileSync(path.join(topo, "nodes.json"), "utf8")) as { conteudo_sha256?: unknown; nodes?: NoTopo[] };
    const E = JSON.parse(readFileSync(path.join(topo, "edges.json"), "utf8")) as { conteudo_sha256?: unknown; edges?: ArestaTopo[] };
    if (typeof N.conteudo_sha256 !== "string" || E.conteudo_sha256 !== N.conteudo_sha256) return false;
    if (sha256(JSON.stringify({ nodesOut: N.nodes, edgesOut: E.edges })) !== N.conteudo_sha256) return false;
    const raiz = N.nodes?.find((n) => n.id === "repo:mega-brain" && n.type === "repo")?.path;
    return typeof raiz === "string" && mesmaPasta(raiz, repo);
  } catch {
    return false; // ausente ou ilegível
  }
}

// um livros-kg.sqlite ou uma data/topology sem o marcador e sem essa procedência não são deste populate
// (pipeline próprio do usuário, cópia antiga, outro mega-brain): não seguem os invariantes cobrados aqui
const POPULADOS = modulosPopulados(path.join(APP, "data"));
const temKg = POPULADOS.has("grafo") && grafoDestePopulate(REPO_MB);
const temTopo = POPULADOS.has("topologia") && topologiaDestePopulate(REPO_MB);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const marcaDoArquivo = (f: string) => `${readFileSync(f).length}:${statSync(f).mtimeMs}`;
/** Cópia rasa do objeto sem o campo `campo` (manifesto sem `raiz`, extrato sem o carimbo). */
const semCampo = (o: Record<string, unknown>, campo: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== campo));
const escreve = (raiz: string, arquivos: Record<string, string>) => {
  for (const [rel, txt] of Object.entries(arquivos)) {
    const f = path.join(raiz, ...rel.split("/"));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, txt);
  }
};

type Doc = { rel: string; kind: string; arquivo: string; colecao: string; text: string; sha256: string };
type NoTopo = { id: string; type: string; label: string; path?: string };
type ArestaTopo = {
  src: string; dst: string; type: string; n: number; escopo?: string; alvo_morto?: boolean; quebrado?: boolean;
  formas?: Record<string, number>; remote?: string; url?: string; push_desabilitado?: boolean;
};
const nosTopo = () => JSON.parse(readFileSync(path.join(TOPO, "nodes.json"), "utf8")).nodes as NoTopo[];
const arestasTopo = () => JSON.parse(readFileSync(path.join(TOPO, "edges.json"), "utf8")).edges as ArestaTopo[];

describe.skipIf(!temKg || !REPO_MB)("grafo de conhecimento (data/kg/livros-kg.sqlite)", () => {
  let docs: Doc[];
  let porLivro: Map<string, { doc: Doc; chunks: string[]; base: string }>;
  let db: DatabaseSync;
  const TODOS = ["claimed", "confirmed", "disputed"];

  beforeAll(async () => {
    vi.stubEnv("BILHON_KG_DB", KG);
    const { docs: d } = await scanRepo(REPO_MB!);
    docs = d as Doc[];
    porLivro = new Map();
    for (const doc of docs) {
      const livro = doc.kind === "doc" ? doc.arquivo : `yt-${doc.colecao}:${doc.rel}`;
      const base = doc.kind === "doc" ? doc.arquivo : doc.rel;
      porLivro.set(livro, { doc, chunks: chunkWords(doc.text).map(norm), base });
    }
    db = new DatabaseSync(KG, { readOnly: true });
  });

  afterAll(() => {
    db?.close();
    vi.unstubAllEnvs();
  });

  it("esquema exato: nodes/edges/evidences e índices", () => {
    const tabelas = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tabelas).toEqual(["edges", "evidences", "nodes"]);
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(idx).toEqual(["idx_edges_status", "idx_evidences_edge", "idx_evidences_livro"]);
  });

  it("100% das evidências são trechos reais (<= 300 chars) do documento citado, no chunk indicado", () => {
    const evs = db.prepare("SELECT edge_id, livro, chunk_id, trecho, confianca FROM evidences").all() as {
      edge_id: number; livro: string; chunk_id: string; trecho: string; confianca: number;
    }[];
    expect(evs.length).toBeGreaterThan(0); // o volume depende do corpus: o desta distribuição é cobrado com POPULATE_E2E=1
    const falhas: string[] = [];
    for (const v of evs) {
      const ref = porLivro.get(v.livro);
      if (!ref) { falhas.push(`livro desconhecido ${v.livro}`); continue; }
      if (v.trecho.length > 300) falhas.push(`> 300 chars: ${v.livro}`);
      if (!norm(ref.doc.text).includes(v.trecho)) falhas.push(`não é substring: ${v.livro} :: ${v.trecho.slice(0, 40)}`);
      const [base, n] = [v.chunk_id.slice(0, v.chunk_id.lastIndexOf("#")), Number(v.chunk_id.slice(v.chunk_id.lastIndexOf("#") + 1))];
      if (base !== ref.base || !ref.chunks[n]?.includes(v.trecho)) falhas.push(`chunk_id errado: ${v.chunk_id}`);
      if (!(v.confianca >= 0 && v.confianca <= 1)) falhas.push("confianca fora de 0..1");
    }
    expect(falhas).toEqual([]);
  });

  it("status e n_fontes coerentes: confirmed = >= 2 documentos distintos; claimed = 1; sem aresta sem evidência", () => {
    const edges = db.prepare("SELECT id, status, n_fontes, peso FROM edges").all() as { id: number; status: string; n_fontes: number; peso: number }[];
    const evs = db.prepare("SELECT edge_id, livro FROM evidences").all() as { edge_id: number; livro: string }[];
    // documento distinto = conteúdo distinto (cópias byte a byte idênticas contam uma vez)
    const docsPorAresta = new Map<number, Set<string>>();
    for (const e of evs) {
      const h = sha256(porLivro.get(e.livro)!.doc.text);
      docsPorAresta.set(e.edge_id, (docsPorAresta.get(e.edge_id) ?? new Set()).add(h));
    }
    for (const e of edges) {
      const n = docsPorAresta.get(e.id)?.size ?? 0;
      expect(n, `aresta ${e.id} sem evidência`).toBeGreaterThan(0);
      expect(["claimed", "confirmed", "disputed"]).toContain(e.status);
      expect(e.n_fontes).toBe(n);
      expect(e.status === "confirmed").toBe(n >= 2);
      expect(e.peso).toBeGreaterThanOrEqual(0);
      expect(e.peso).toBeLessThanOrEqual(1);
    }
  });

  it("conceitos: slug minúsculo sem acento; sem conceito órfão; livros apontam para documentos reais", () => {
    const nodes = db.prepare("SELECT id, tipo FROM nodes").all() as { id: string; tipo: string }[];
    const tocados = new Set((db.prepare("SELECT src, dst FROM edges").all() as { src: string; dst: string }[]).flatMap((e) => [e.src, e.dst]));
    for (const n of nodes) {
      if (n.tipo === "conceito") {
        expect(n.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
        expect(tocados.has(n.id), `conceito órfão ${n.id}`).toBe(true);
      } else {
        expect(n.tipo).toBe("livro");
        expect(n.id.startsWith("livro:")).toBe(true);
        expect(porLivro.has(n.id.slice("livro:".length)), n.id).toBe(true);
      }
    }
  });

  it.skipIf(!TEM_SQLITE3_FTS5)("lê pelo leitor real (lib/kg.ts): grafo(), kgStats(), evidencias()", async () => {
    const kg = await import("@/lib/kg");
    const g = await kg.grafo({ status: TODOS });
    const total = (db.prepare("SELECT COUNT(*) c FROM edges").get() as { c: number }).c;
    expect(g.edges.length).toBe(Math.min(1500, total));
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.src)).toBe(true);
      expect(ids.has(e.dst)).toBe(true);
    }
    // livro da estante: o nó leva o id do catálogo (é o que liga o grafo a /livro e /ler)
    const daEstante = g.nodes.filter((n) => n.tipo === "livro" && !n.id.startsWith("livro:yt-"));
    expect(daEstante.length).toBeGreaterThan(0);
    expect(daEstante.filter((n) => !n.livroId).map((n) => n.id)).toEqual([]);
    const stats = await kg.kgStats();
    expect(stats.conceitos).toBe((db.prepare("SELECT COUNT(*) c FROM nodes WHERE tipo='conceito'").get() as { c: number }).c);
    expect(stats.livros).toBe((db.prepare("SELECT COUNT(*) c FROM nodes WHERE tipo='livro'").get() as { c: number }).c);
    expect(stats.disputed).toBe(0);
    console.log("[leitor kg]", JSON.stringify({ nos: g.nodes.length, arestas: g.edges.length, ...stats }));

    // evidências: uma aresta confirmada entre conceitos e uma menção
    const conf = db.prepare("SELECT id FROM edges WHERE status='confirmed' AND src NOT LIKE 'livro:%' ORDER BY n_fontes DESC, id LIMIT 1").get() as { id: number };
    const ev = await kg.evidencias(conf.id);
    expect(ev.length).toBeGreaterThanOrEqual(2);
    for (const e of ev) {
      expect(e.trecho.length).toBeGreaterThan(0);
      expect(e.chunkIdx).toBeGreaterThanOrEqual(0);
    }
    const men = db.prepare("SELECT id FROM edges WHERE rel='menciona' ORDER BY id LIMIT 1").get() as { id: number };
    expect((await kg.evidencias(men.id)).length).toBe(1);
  });

  // conceitos nomeados e volume são deste corpus; as mesmas regras (funil BDR → SDS, fontesDoConceito)
  // são provadas em "grafo: repositório sintético lido pelo leitor do app", que roda com qualquer mega-brain
  it.skipIf(!E2E || !TEM_SQLITE3_FTS5)("conteúdo desta distribuição (POPULATE_E2E=1): volume de evidências, glossário de vendas e cadeia do pipeline", async () => {
    expect((db.prepare("SELECT COUNT(*) c FROM evidences").get() as { c: number }).c).toBeGreaterThan(500);
    const kg = await import("@/lib/kg");
    // fontes de um conceito (exclui "menciona"): glossário e cadeia do pipeline
    const f = await kg.fontesDoConceito("bdr");
    expect(f.livros.length).toBeGreaterThan(0);
    expect(f.relacoes.length).toBeGreaterThan(0);
    expect(f.vizinhos).toContain("sds");
    const f2 = await kg.fontesDoConceito("chunk");
    expect(f2.vizinhos).toEqual(expect.arrayContaining(["insight"]));
    console.log("[leitor kg] fontesDoConceito(bdr) =", JSON.stringify(f));
  });

  it.skipIf(!TEM_SQLITE3_FTS5)("deep-link ?focus= (lib/kg.ts `foco`): o conceito pedido vem mesmo fora do corte das arestas mais citadas", async () => {
    const kg = await import("@/lib/kg");
    // o servidor corta nas arestas mais citadas; com um corte de 5, o conceito de nicho fica de fora
    const corte = await kg.grafo({ status: TODOS, maxEdges: 5 });
    const dentro = new Set(corte.nodes.map((n) => n.id));
    const nichos = db.prepare(
      `SELECT n.id, n.label FROM nodes n JOIN edges e ON e.src = n.id OR e.dst = n.id
       WHERE n.tipo = 'conceito' GROUP BY n.id ORDER BY MAX(e.n_fontes), n.id`,
    ).all() as { id: string; label: string }[];
    const alvo = nichos.find((n) => !dentro.has(n.id));
    expect(alvo).toBeDefined();
    // a página do livro manda o id; a busca de nó, o rótulo: os dois acham o nó
    for (const foco of [alvo!.id, alvo!.label]) {
      const g = await kg.grafo({ status: TODOS, maxEdges: 5, foco });
      expect(g.nodes.map((n) => n.id), foco).toContain(alvo!.id);
    }
  });

  it.skipIf(!TEM_SQLITE3_FTS5)("filtro por data (lib/kg.ts + lib/grafo-data.ts): livro da estante e conceito sustentado por ele ganham data", async () => {
    const kg = await import("@/lib/kg");
    const { recortarPorData } = await import("@/lib/grafo-data");
    const { LIVROS_DIR } = await import("@/lib/catalog");
    const DIA = /^\d{4}-\d{2}-\d{2}$/;
    const g = await kg.grafo({ status: TODOS });
    // livro da estante: data = mtime do arquivo que o populate pôs em LIVROS_DIR
    const livros = g.nodes.filter((n) => n.tipo === "livro" && !n.id.startsWith("livro:yt-"));
    expect(livros.filter((n) => !existsSync(path.join(LIVROS_DIR, n.id.slice("livro:".length)))).map((n) => n.id)).toEqual([]);
    expect(livros.filter((n) => !DIA.test(n.data ?? "")).map((n) => n.id)).toEqual([]);
    // conceito: herda a obra mais antiga que o sustenta; só evidência em config/código (yt-*) não dá data
    const conceitos = g.nodes.filter((n) => n.tipo === "conceito");
    const datados = conceitos.filter((n) => DIA.test(n.data ?? ""));
    expect(datados.length).toBeGreaterThan(conceitos.length / 2);
    // recorte amplo: o que tem data passa; o que não tem é contado, não inventado
    const r = recortarPorData(g.nodes, g.edges, { de: "1970-01-01" });
    expect(r.links.length).toBeGreaterThan(0);
    expect(r.ocultosSemData).toBe(g.nodes.filter((n) => !n.data && !n.estrutural).length);
    console.log("[datas]", JSON.stringify({ livros: livros.length, conceitos: conceitos.length, conceitosComData: datados.length, ocultosSemData: r.ocultosSemData }));
  });

  it.skipIf(!TEM_SQLITE3_FTS5)("página do livro e estante (lib/livro-conteudo.ts): conceitos-chave e trechos em destaque vêm deste grafo", async () => {
    const { conteudoDoLivro, resumosDosLivros } = await import("@/lib/livro-conteudo");
    const { getBook, getBookIndex } = await import("@/lib/catalog");
    // o livro com mais trechos longos (> 120 chars) em relações entre conceitos: é o que a página destaca
    const top = db.prepare(
      `SELECT ev.livro, COUNT(*) n FROM evidences ev JOIN edges e ON e.id = ev.edge_id
       WHERE e.src NOT LIKE 'livro:%' AND ev.livro NOT LIKE 'yt-%' AND length(ev.trecho) > 120
       GROUP BY ev.livro ORDER BY n DESC, ev.livro LIMIT 1`,
    ).get() as { livro: string; n: number } | undefined;
    expect(top).toBeDefined();
    const id = (await getBookIndex()).get(top!.livro);
    expect(id, `${top!.livro} fora do catálogo`).toBeDefined();
    const livro = await getBook(id!);
    expect(livro).not.toBeNull();
    const c = await conteudoDoLivro(livro!);
    const conceitos = new Set((db.prepare("SELECT id FROM nodes WHERE tipo='conceito'").all() as { id: string }[]).map((r) => r.id));
    expect(c.conceitos.length).toBeGreaterThan(0);
    expect(c.conceitos.filter((x) => !conceitos.has(x))).toEqual([]);
    expect(c.trechos.length).toBeGreaterThan(0);
    const texto = norm(porLivro.get(top!.livro)!.doc.text);
    for (const t of c.trechos) {
      expect(conceitos.has(t.conceito), t.conceito).toBe(true);
      expect(texto.includes(t.texto), t.texto.slice(0, 60)).toBe(true);
    }
    const card = (await resumosDosLivros([top!.livro])).get(top!.livro);
    expect(card?.conceitos.length ?? 0).toBeGreaterThan(0);
    console.log("[livro-conteudo]", JSON.stringify({ livro: top!.livro, conceitos: c.conceitos.slice(0, 6), trechos: c.trechos.length }));
  });

  it.skipIf(!TEM_SQLITE3_FTS5)("layout pré-calculado cobre os nós (>= 80%)", async () => {
    const kg = await import("@/lib/kg");
    const layout = await kg.carregarLayout();
    const g = await kg.grafo({ status: TODOS });
    const comPos = g.nodes.filter((n) => layout[n.id]).length;
    expect(comPos / g.nodes.length).toBeGreaterThanOrEqual(0.8);
  });
});

/* ------------------------------------------------------------------ grafo: repositório sintético → leitor do app */

describe("grafo: repositório sintético lido pelo leitor do app (lib/kg.ts)", () => {
  let base: string;
  let repo: string;
  let dados: string;
  let kgDb: string;
  const CONFIG_YT = "engine/config/funil.yaml";
  const DIA_CONFIG_YT = "2026-03-04";
  const ctx = async () => {
    const { docs, excluded } = await scanRepo(repo);
    return { repoRoot: repo, appRoot: APP, dataDir: dados, docs, excluded, opts: {}, resultados: {} };
  };

  beforeAll(async () => {
    base = mkdtempSync(path.join(tmpdir(), "kg-sint-"));
    repo = path.join(base, "repo");
    dados = path.join(base, "dados");
    kgDb = path.join(dados, "kg", "livros-kg.sqlite");
    escreve(repo, {
      ".claude/CLAUDE.md": [
        "# Mega Brain",
        "",
        "## Constitution (Supreme Law)",
        "",
        "| Article | Principle | Type |",
        "|---------|-----------|------|",
        "| I | CLI First | NON-NEGOTIABLE |",
        "| II | Agent Authority | NON-NEGOTIABLE |",
        "",
        "## Pipeline MCE",
        "",
        "Mental Cognitive Extraction — 6 sequential, blocking phases:",
        "",
        "| Phase | Name | Output |",
        "|-------|------|--------|",
        "| 0 | Ingestion Guard | Dedup verdict |",
        "| 1 | Download | Raw materials in inbox |",
        "| 2 | Organization | Classified by source/type |",
        "",
      ].join("\n"),
      "engine/glossary/sales.md": [
        "# Glossário de vendas",
        "",
        "### BDR (Business Development Representative)",
        "",
        "Quem prospecta e qualifica o lead antes da conversa de venda.",
        "- **Relacionado**: SDS, Closer",
        "",
        "### SDS (Sales Development Specialist)",
        "",
        "Quem conduz o diagnóstico depois da qualificação.",
        "",
        "### Closer",
        "",
        "Quem conduz a call de fechamento.",
        "",
      ].join("\n"),
      "docs/funil.md": "# Funil comercial\n\nO lead percorre BDR → SDS → Closer, nesta ordem.\n",
      "docs/regras.md": "# Regras\n\nA Constitution define o Art. I (CLI First) como inegociável no Pipeline MCE.\n",
      // configuração (fora da estante): vira a fonte `yt-<coleção>:engine/config/funil.yaml` do grafo
      [CONFIG_YT]: "# Etapas do funil comercial\netapas:\n  - BDR\n  - SDS\n  - Closer\n",
    });
    // data conhecida no disco: é dela que o leitor tira a data da fonte yt- (o mtime não entra no grafo)
    const dia = new Date(`${DIA_CONFIG_YT}T12:00:00`);
    utimesSync(path.join(repo, ...CONFIG_YT.split("/")), dia, dia);
    // grafo que não é deste módulo (kg-extract.py, por exemplo): tem de ficar preservado ao lado
    mkdirSync(path.dirname(kgDb), { recursive: true });
    const alheio = new DatabaseSync(kgDb);
    alheio.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT, tipo TEXT); INSERT INTO nodes VALUES ('x', 'X', 'conceito');");
    alheio.close();
    await runGrafo(await ctx());
    // o leitor lê KG_DB/GRAPH_LAYOUT na importação: módulos novos com o ambiente deste bloco
    vi.stubEnv("BILHON_KG_DB", kgDb);
    vi.stubEnv("BILHON_GRAPH_LAYOUT", path.join(dados, "kg", "graph-layout.json"));
    vi.resetModules();
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    try { rmSync(base, { recursive: true, force: true }); } catch { /* tmpdir descartável */ }
  });

  it.skipIf(!TEM_SQLITE3_FTS5)("o leitor real lê o SQLite gerado: nós, arestas, evidências literais, fontes, foco e layout", async () => {
    const kg = await import("@/lib/kg");
    expect(kg.KG_DB).toBe(kgDb);
    const todos = ["claimed", "confirmed", "disputed"];
    const g = await kg.grafo({ status: todos });
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const id of ["bdr", "sds", "closer", "constituicao-mega-brain", "art-i-cli-first", "pipeline-mce"]) expect(ids.has(id), id).toBe(true);
    const db = new DatabaseSync(kgDb, { readOnly: true });
    try {
      expect(g.edges.length).toBe((db.prepare("SELECT COUNT(*) c FROM edges").get() as { c: number }).c);
      const stats = await kg.kgStats();
      expect(stats.conceitos).toBe((db.prepare("SELECT COUNT(*) c FROM nodes WHERE tipo='conceito'").get() as { c: number }).c);
      expect(stats.confirmed).toBeGreaterThan(0); // Art. I: tabela da Constituição + docs/regras.md
    } finally {
      db.close();
    }
    // BDR → SDS: a evidência é o trecho literal do funil
    const e = g.edges.find((x) => x.src === "bdr" && x.rel === "precede" && x.dst === "sds");
    expect(e).toBeDefined();
    const ev = await kg.evidencias(e!.id);
    expect(ev.map((x) => x.trecho).join(" | ")).toContain("BDR → SDS");
    expect((await kg.fontesDoConceito("bdr")).vizinhos).toEqual(expect.arrayContaining(["sds", "closer"]));
    // foco: com corte de 1 aresta, o conceito pedido continua vindo
    expect((await kg.grafo({ status: todos, maxEdges: 1, foco: "closer" })).nodes.map((n) => n.id)).toContain("closer");
    const layout = await kg.carregarLayout();
    expect(g.nodes.filter((n) => layout[n.id]).length / g.nodes.length).toBeGreaterThanOrEqual(0.8);
  });

  it("grafo alheio preservado ao lado; rodar de novo com o mesmo corpus não mexe no arquivo", async () => {
    const baks = readdirSync(path.join(dados, "kg")).filter((n) => /^livros-kg\.pre-populate-[0-9a-f]{8}\.bak\.sqlite$/.test(n));
    expect(baks.length).toBe(1);
    const velho = new DatabaseSync(path.join(dados, "kg", baks[0]), { readOnly: true });
    try {
      expect(velho.prepare("SELECT id FROM nodes").all()).toEqual([{ id: "x" }]);
    } finally {
      velho.close();
    }
    const antes = marcaDoArquivo(kgDb);
    await runGrafo(await ctx());
    expect(marcaDoArquivo(kgDb)).toBe(antes);
    expect(readdirSync(path.join(dados, "kg")).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("o manifesto declara a raiz do repositório lido (relativa à pasta do manifesto), que o leitor usa para datar fontes yt-", () => {
    const pastaKg = path.join(dados, "kg");
    const m = JSON.parse(readFileSync(path.join(pastaKg, "populate-grafo.json"), "utf8")) as { raiz?: unknown };
    expect(typeof m.raiz).toBe("string");
    expect(m.raiz as string).not.toContain("\\"); // separador POSIX, igual em qualquer máquina
    expect(path.resolve(pastaKg, m.raiz as string)).toBe(path.resolve(repo));
  });

  it.skipIf(!TEM_SQLITE3_FTS5)("o leitor (lib/kg.ts grafo()) data a fonte yt- pelo manifesto gerado: o mtime do arquivo no repositório lido", async () => {
    const doc = (await scanRepo(repo)).docs.find((d: { rel: string }) => d.rel === CONFIG_YT) as Doc | undefined;
    expect(doc?.kind).toBe("config");
    const fonte = `livro:yt-${doc!.colecao}:${CONFIG_YT}`;
    const kg = await import("@/lib/kg");
    const todos = ["claimed", "confirmed", "disputed"];
    // BILHON_ROOT = o repositório lido, como o bloco do populate grava: a raiz do manifesto fica dentro dela
    vi.stubEnv("BILHON_ROOT", repo);
    const g = await kg.grafo({ status: todos });
    expect(g.nodes.find((n) => n.id === fonte)?.data).toBe(DIA_CONFIG_YT);
    // controle negativo: com uma raiz que não contém o repositório do manifesto, a fonte fica sem data
    vi.stubEnv("BILHON_ROOT", dados);
    const sem = await kg.grafo({ status: todos });
    expect(sem.nodes.some((n) => n.id === fonte)).toBe(true);
    expect(sem.nodes.find((n) => n.id === fonte)?.data).toBeUndefined();
  });

  it("guarda dos blocos de dados reais (grafoDestePopulate): só o sqlite que o manifesto descreve, gerado a partir do repositório lido", () => {
    const manifesto = path.join(dados, "kg", "populate-grafo.json");
    expect(grafoDestePopulate(repo, kgDb, manifesto)).toBe(true);
    expect(grafoDestePopulate(base, kgDb, manifesto)).toBe(false); // outro mega-brain
    expect(grafoDestePopulate(null, kgDb, manifesto)).toBe(false); // clone avulso, sem mega-brain
    // cópia numa pasta irmã (mesma profundidade: a `raiz` relativa continua levando ao repositório lido)
    const prova = path.join(dados, "prova");
    mkdirSync(prova, { recursive: true });
    const db = path.join(prova, "livros-kg.sqlite");
    const man = path.join(prova, "populate-grafo.json");
    copyFileSync(kgDb, db);
    copyFileSync(manifesto, man);
    expect(grafoDestePopulate(repo, db, man)).toBe(true);
    // sqlite trocado depois do populate (kg-extract.py, cópia à mão) com o manifesto antigo ao lado: o sha256 não confere
    rmSync(db);
    const alheio = new DatabaseSync(db);
    alheio.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT, tipo TEXT); INSERT INTO nodes VALUES ('x', 'X', 'conceito');");
    alheio.close();
    expect(grafoDestePopulate(repo, db, man)).toBe(false);
    // manifesto anterior ao campo `raiz`: o sqlite confere, mas a origem não está comprovada
    copyFileSync(kgDb, db);
    writeFileSync(man, JSON.stringify(semCampo(JSON.parse(readFileSync(manifesto, "utf8")), "raiz")));
    expect(grafoDestePopulate(repo, db, man)).toBe(false);
    // sem manifesto
    rmSync(man);
    expect(grafoDestePopulate(repo, db, man)).toBe(false);
  });
});

/* ------------------------------------------------------------------ topologia: dados reais lidos pelo app */

describe.skipIf(!temTopo || !REPO_MB)("topologia (data/topology)", () => {
  const repoRoot = REPO_MB ?? "";

  beforeAll(() => {
    vi.stubEnv("BILHON_TOPOLOGY_DIR", TOPO);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("nodes.json e edges.json no formato do extrato: ids únicos, pontas conhecidas, tipos válidos, path no formato do sistema", () => {
    const N = JSON.parse(readFileSync(path.join(TOPO, "nodes.json"), "utf8"));
    const E = JSON.parse(readFileSync(path.join(TOPO, "edges.json"), "utf8"));
    const ids = new Set<string>(N.nodes.map((n: { id: string }) => n.id));
    expect(ids.size).toBe(N.nodes.length);
    const tiposNo = ["pasta-relevante", "arquivo", "skill", "script", "engine", "remote", "hook", "launchagent", "repo", "plano", "dominio", "app", "bridge"];
    const tiposAresta = ["contem", "pertence_a", "referencia", "symlink", "git_remote", "ponte", "executa"];
    for (const n of N.nodes as NoTopo[]) {
      expect(tiposNo).toContain(n.type);
      if (!n.path) continue;
      // absoluto e normalizado no formato do sistema: é com ele que `impactoDeMover` (path.resolve + path.sep)
      // e o filtro por data acham o nó; `p:<rel>` mora em <raiz do mega-brain>/<rel>
      expect(n.path).toBe(path.resolve(n.path));
      if (n.id.startsWith("p:")) expect(n.path).toBe(path.join(repoRoot, ...n.id.slice(2).split("/")));
    }
    for (const e of E.edges) {
      expect(tiposAresta).toContain(e.type);
      expect(ids.has(e.src)).toBe(true);
      expect(ids.has(e.dst)).toBe(true);
      expect(e.n).toBeGreaterThan(0);
    }
    expect(N.nodes.length).toBeLessThan(5000);
    expect(JSON.stringify(E)).not.toMatch(/\/\/[^/@"\s]+:[^/@"\s]+@/); // nenhuma credencial embutida em URL
  });

  it("grafoTopologia(): influência por padrão, hierarquia sob pedido, filtro de plano e de mortas", async () => {
    const { grafoTopologia, limparCacheTopologia, TIPOS_ARESTA_INFLUENCIA } = await import("@/lib/topologia");
    limparCacheTopologia();
    const N = nosTopo();
    const E = arestasTopo();
    const padrao = await grafoTopologia();
    const tiposPadrao = new Set(padrao.edges.map((e) => e.tipoTopo));
    expect([...tiposPadrao].every((t) => ["referencia", "symlink", "git_remote", "ponte", "executa"].includes(t as string))).toBe(true);
    expect(padrao.edges.length).toBeLessThanOrEqual(1500);
    expect(padrao.meta.truncado).toBe(padrao.meta.arestasFiltradas > padrao.meta.arestasMostradas);
    expect(padrao.nodes.every((n) => n.camada === "topologia")).toBe(true);

    const hier = await grafoTopologia({ tipos: ["contem", "pertence_a"], maxEdges: 100000 });
    expect(hier.edges.length).toBe(E.filter((e) => e.type === "contem" || e.type === "pertence_a").length);
    // o módulo só cria `plano:*` quando algum nó pertence a ele: o vocabulário do leitor é exatamente esse
    const planos = N.filter((n) => n.type === "plano").map((n) => n.id.slice("plano:".length)).sort();
    expect(planos.length).toBeGreaterThan(0);
    expect(hier.meta.planosDisponiveis).toEqual(planos);

    // o filtro de plano exige que as DUAS pontas pertençam ao plano: conta à parte e compara
    const planoDe = new Map(E.filter((e) => e.type === "pertence_a").map((e) => [e.src, e.dst.slice("plano:".length)]));
    const internas = new Map<string, number>();
    for (const e of E) {
      const p = planoDe.get(e.src);
      if (e.type === "referencia" && p && planoDe.get(e.dst) === p) internas.set(p, (internas.get(p) ?? 0) + 1);
    }
    const [plano, nInternas] = [...internas].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    const doPlano = await grafoTopologia({ tipos: ["referencia"], planos: [plano], maxEdges: 100000 });
    expect(doPlano.edges.length).toBe(nInternas);
    expect(doPlano.nodes.every((n) => n.plano === plano)).toBe(true);
    const semFiltro = await grafoTopologia({ tipos: ["referencia"], maxEdges: 100000 });
    expect(doPlano.edges.length).toBeLessThan(semFiltro.edges.length);

    // mortas: as arestas de influência com alvo inexistente, todas e só elas, apontando para nós "(inexistente)"
    const mortas = await grafoTopologia({ soMortas: true, maxEdges: 100000 });
    const esperadas = E.filter((e) => e.alvo_morto && (TIPOS_ARESTA_INFLUENCIA as string[]).includes(e.type));
    expect(esperadas.length).toBeGreaterThan(0);
    expect(mortas.edges.length).toBe(esperadas.length);
    expect(mortas.edges.every((e) => e.alvoMorto)).toBe(true);
    const rotuloDe = new Map(mortas.nodes.map((n) => [n.id, n.label]));
    expect(mortas.edges.filter((e) => !e.dst.startsWith("topo:morto:") || !rotuloDe.get(e.dst)?.endsWith("(inexistente)"))).toEqual([]);
    console.log("[leitor topologia]", JSON.stringify({ padrao: padrao.meta, hierarquia: hier.edges.length, plano, mortas: mortas.edges.length }));
  });

  it("impactoDeMover(): pasta real da engine, arquivo executado pelos hooks e o repositório inteiro", async () => {
    const { impactoDeMover } = await import("@/lib/topologia");
    const N = nosTopo();
    const E = arestasTopo();
    const porId = new Map(N.map((n) => [n.id, n]));

    const rag = path.join(repoRoot, "engine", "intelligence", "rag");
    const noEscopo = N.filter((n) => n.path && (n.path === rag || n.path.startsWith(rag + path.sep))).length;
    expect(noEscopo).toBeGreaterThan(1);
    const r = await impactoDeMover(rag);
    expect(r).not.toBeNull();
    expect(r!.nosNoEscopo).toBe(noEscopo);
    expect(r!.ativo.arestas).toBeGreaterThan(0);
    expect(r!.topReferenciadores.length).toBeGreaterThan(0);
    console.log("[impacto engine/intelligence/rag]", JSON.stringify({ nos: r!.nosNoEscopo, ativo: r!.ativo, dado: r!.dado }));

    // o arquivo que `.claude/settings.json` mais cita (o script dos hooks): cada citação é uma quebra ativa
    const doSettings = E.filter((e) => e.type === "referencia" && e.src === "p:.claude/settings.json" && e.escopo === "ativo" && !e.alvo_morto)
      .sort((a, b) => b.n - a.n || (a.dst < b.dst ? -1 : 1))[0];
    if (doSettings) {
      const alvo = porId.get(doSettings.dst)!;
      const arq = await impactoDeMover(alvo.path!);
      expect(arq).not.toBeNull();
      expect(arq!.ativo.ocorrencias).toBeGreaterThanOrEqual(doSettings.n);
    }

    // remotes: os do extrato, com o push desabilitado marcado (nenhum nome fixo: vale para qualquer mega-brain)
    const tudo = await impactoDeMover(repoRoot);
    expect(tudo).not.toBeNull();
    const doExtrato = E.filter((e) => e.type === "git_remote")
      .map((e) => ({ remote: e.remote ?? null, pushDesabilitado: Boolean(e.push_desabilitado) }))
      .sort((a, b) => String(a.remote).localeCompare(String(b.remote)));
    const lidos = tudo!.gitRemotes
      .map((g) => ({ remote: g.remote, pushDesabilitado: g.pushDesabilitado }))
      .sort((a, b) => String(a.remote).localeCompare(String(b.remote)));
    expect(lidos).toEqual(doExtrato);

    expect(await impactoDeMover(path.join(repoRoot, "pasta", "que", "nao", "existe"))).toBeNull();
  });

  it("filtro por data (lib/datas-disco.ts): com o BILHON_ROOT que o populate grava, os nós com path ganham data", async () => {
    const { grafoTopologia, limparCacheTopologia } = await import("@/lib/topologia");
    const { datarTopologia, limparCacheDatas } = await import("@/lib/datas-disco");
    const { caminhoDentroDaRaiz } = await import("@/lib/bilhon-paths");
    limparCacheTopologia();
    limparCacheDatas();
    // a raiz que o app usa: a do terminal/.env.local fora do bloco (ex.: `..` com o clone ao lado) ou, sem ela,
    // a que o ambiente.mjs grava (relativa ao app, ../.. quando o mega-brain contém o app). Em qualquer caso
    // ela contém o repositório lido e data/topology
    const raiz = raizEfetivaDoApp(APP, repoRoot);
    const v = valorRaiz(APP, repoRoot).valor;
    if (v !== null) expect(raiz).toBe(path.resolve(repoRoot));
    expect(caminhoDentroDaRaiz(raiz, path.resolve(repoRoot))).toBe(true);
    expect(caminhoDentroDaRaiz(raiz, TOPO)).toBe(true);

    const gt = await grafoTopologia({ tipos: ["contem", "pertence_a", "referencia", "executa", "git_remote"], maxEdges: 100000 });
    const comPath = gt.nodes.filter((n) => n.path);
    expect(comPath.length).toBeGreaterThan(0);
    const datados = await datarTopologia(gt.nodes, raiz);
    const DIA = /^\d{4}-\d{2}-\d{2}$/;
    const comData = datados.filter((n) => n.path && DIA.test(n.data ?? "")).length;
    // tudo o que ainda existe no disco ganha data (um caminho apagado depois do populate fica sem: não é inventada)
    expect(comData / comPath.length).toBeGreaterThanOrEqual(0.95);
    expect(datados.filter((n) => n.tipoTopo === "plano" || n.tipoTopo === "remote").every((n) => n.estrutural)).toBe(true);
    // sem BILHON_ROOT a raiz é a pasta do app: fora dela nada é lido (por isso o populate grava a variável)
    const soNoApp = await datarTopologia(gt.nodes, APP);
    expect(soNoApp.filter((n) => n.data && n.path && !caminhoDentroDaRaiz(APP, n.path)).map((n) => n.id)).toEqual([]);
    console.log("[datas topologia]", JSON.stringify({ comPath: comPath.length, comData, comDataSoNoApp: soNoApp.filter((n) => n.data).length }));
  });
});

/* ------------------------------------------------------------------ topologia: dados reais (regras de segurança e fidelidade) */

describe.skipIf(!temTopo || !REPO_MB)("topologia (data/topology): bucket pessoal, caixa, nós mortos", () => {
  it("nenhum nó ou aresta do bucket pessoal (fora por padrão) nem do estado de execução", () => {
    const ids = nosTopo().map((n) => n.id);
    expect(ids.filter((id) => /^(p|morto):(knowledge|agents)\/personal(\/|$)/i.test(id))).toEqual([]);
    // dentro das pastas de execução só a própria pasta pode ser nó
    expect(ids.filter((id) => /^p:(logs|inbox|processing|artifacts)\/./.test(id) || /^p:\.claude\/(jarvis|logs|mission-control|sessions)\/./.test(id))).toEqual([]);
  });

  it("a caixa do disco é a do nó: sem nó duplicado por caixa e todo `path` bate com o disco", () => {
    const nos = nosTopo();
    const porMinusc = new Map<string, string[]>();
    for (const n of nos) porMinusc.set(n.id.toLowerCase(), [...(porMinusc.get(n.id.toLowerCase()) ?? []), n.id]);
    expect([...porMinusc.values()].filter((v) => v.length > 1)).toEqual([]);
    const errados = nos
      .filter((n) => n.path && n.type !== "remote" && n.type !== "repo" && n.type !== "app" && existsSync(n.path))
      .filter((n) => path.normalize(realpathSync.native(n.path!)) !== path.normalize(n.path!));
    expect(errados.map((n) => n.id)).toEqual([]);
  });

  it("nó morto: sem `path`, sem `contem`, e só como alvo de referência com alvo_morto", () => {
    const nos = nosTopo();
    const mortos = nos.filter((n) => n.id.startsWith("morto:"));
    expect(mortos.length).toBeGreaterThan(0);
    expect(mortos.filter((n) => n.path)).toEqual([]);
    const edges = arestasTopo();
    expect(edges.filter((e) => e.type === "contem" && e.dst.startsWith("morto:"))).toEqual([]);
    expect(edges.filter((e) => e.dst.startsWith("morto:") && !(e.type === "referencia" || e.type === "executa"))).toEqual([]);
    expect(edges.filter((e) => e.dst.startsWith("morto:") && !e.alvo_morto)).toEqual([]);
    expect(edges.filter((e) => e.alvo_morto && !e.dst.startsWith("morto:"))).toEqual([]);
  });

  it("placeholders, globs e nomes parciais não viram pasta inexistente", () => {
    const mortos = nosTopo().filter((n) => n.id.startsWith("morto:")).map((n) => n.id.slice("morto:".length));
    expect(mortos.filter((m) => /[{}<>*$%]/.test(m))).toEqual([]);
    expect(mortos).not.toContain("workspace/businesses"); // o CLAUDE.md declara workspace/businesses/{bu}/… como criado em execução
    expect(mortos).not.toContain(".claude/agents/kops"); // `.claude/agents/kops-*.md`
    expect(mortos.filter((m) => m.startsWith(".claude/agents/the"))).toEqual([]); // caminho com espaço entre aspas
  });

  it("escopo: instruções executáveis (.claude/skills|rules|commands|agents) são `ativo`; docs são `documentacao`", () => {
    const refs = arestasTopo().filter((e) => e.type === "referencia");
    const instrucoes = refs.filter((e) => /^p:\.claude\/(skills|rules|commands|agents)\/.+\.md$/.test(e.src) && !/\/README\.md$/i.test(e.src));
    expect(instrucoes.length).toBeGreaterThan(0);
    expect(instrucoes.filter((e) => e.escopo !== "ativo").map((e) => e.src)).toEqual([]);
    const docs = refs.filter((e) => /^p:docs\/.+\.md$/.test(e.src));
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.filter((e) => e.escopo !== "documentacao").map((e) => e.src)).toEqual([]);
  });

  it("citação com a caixa errada liga ao nó real e é marcada (nunca cria o nó de caixa errada)", () => {
    // a regra em si é provada no repositório sintético; aqui, que os dados reais a seguem
    const divergentes = arestasTopo().filter((e) => Object.keys(e.formas ?? {}).some((f) => f.endsWith("-caixa-divergente")));
    for (const e of divergentes) {
      expect(e.dst.startsWith("morto:")).toBe(false);
      if (Object.keys(e.formas!).every((f) => f.endsWith("-caixa-divergente"))) expect(e.quebrado).toBe(true);
    }
    console.log("[caixa divergente]", divergentes.length);
  });
});

/* ------------------------------------------------------------------ topologia: repositório sintético */

describe("topologia: repositório sintético", { timeout: 180_000 }, () => {
  let base: string;
  let raiz: string;
  const rodar = async (r: string, dataDir: string, includePersonal = false) =>
    runTopologia({ repoRoot: r, appRoot: path.join(base, "app-fora"), dataDir, docs: [], excluded: [], opts: { includePersonal }, resultados: {} });
  const ler = (dataDir: string) => ({
    nos: JSON.parse(readFileSync(path.join(dataDir, "topology", "nodes.json"), "utf8")).nodes as { id: string; type: string; path?: string }[],
    arestas: JSON.parse(readFileSync(path.join(dataDir, "topology", "edges.json"), "utf8")).edges as ArestaTopo[],
  });

  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), "topo-sint-"));
    raiz = path.join(base, "repo");
    escreve(raiz, {
      "engine/mod.py": "X = 1\n",
      "docs/QUICK-START.md": "# Quick\n",
      "docs/README.md": "Ver `engine/mod.py`.\n",
      "docs/guia.md": "Ver `engine/mod.py` e `docs/QUICK-START.md`.\n",
      "docs/so-errado.md": "Ver `docs/quick-start.md`.\n",
      ".claude/skills/s1/SKILL.md": [
        "# S1",
        "Código: `engine/mod.py`.",
        "Caixa: `docs/quick-start.md` (errada) e `docs/QUICK-START.md` (certa).",
        "Placeholders: `knowledge/negocios/{bu}/L0/x.md` e `docs/{tipo}/y.md`.",
        "Real, criado em execução: `knowledge/negocios/acme/plano.md`.",
        "Globs: `.claude/agents/kops-*.md`, `engine/**/*.py`, `docs/*.md`.",
        'Espaço: ".claude/agents/the knowledge system/agents/".',
        "Morto de verdade: `docs/nao-existe.md` e `engine/legado/velho.py`.",
        "Pessoal: `knowledge/personal/diario.md` e `agents/personal/x/agent.md`.",
        "Execução: `inbox/raw/dump.md`.",
        "",
      ].join("\n"),
      "agents/ag1/agent.md": "Ver `engine/mod.py`.\n",
      "agents/ag1/README.md": "Ver `engine/mod.py`.\n",
      "knowledge/personal/diario.md": "Diário. Ver `docs/guia.md`.\n",
      "agents/personal/x/agent.md": "Agente pessoal. Ver `docs/guia.md`.\n",
      "inbox/raw/dump.md": "Dump. Ver `docs/guia.md`.\n",
      ".credentials/sa-prod.json": '{"nome":"x"}\n',
    });
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("bucket pessoal, estado de execução e pasta sensível ficam fora (nó, aresta e leitura)", async () => {
    const data = path.join(base, "d1");
    await rodar(raiz, data);
    const { nos, arestas } = ler(data);
    const ids = nos.map((n) => n.id);
    expect(ids.filter((i) => /personal/i.test(i))).toEqual([]);
    expect(ids.filter((i) => i.includes("inbox/raw") || i.includes(".credentials"))).toEqual([]);
    expect(arestas.filter((e) => /personal|inbox\/raw/.test(e.src + e.dst))).toEqual([]);
    expect(ids).toContain("p:inbox"); // a pasta de execução aparece; o que há dentro não
  });

  it("com --include-personal o bucket pessoal volta", async () => {
    const data = path.join(base, "d2");
    await rodar(raiz, data, true);
    const ids = ler(data).nos.map((n) => n.id);
    expect(ids).toContain("p:knowledge/personal/diario.md");
    expect(ids).toContain("p:agents/personal/x/agent.md");
  });

  it("caixa: a citação com a caixa errada liga ao nó real, marcada; nunca cria o nó de caixa errada", async () => {
    const data = path.join(base, "d1");
    if (!existsSync(path.join(data, "topology"))) await rodar(raiz, data);
    const { nos, arestas } = ler(data);
    const ids = nos.map((n) => n.id);
    expect(ids).toContain("p:docs/QUICK-START.md");
    expect(ids).not.toContain("p:docs/quick-start.md");
    expect(ids.some((i) => i.toLowerCase() === "morto:docs/quick-start.md")).toBe(false);
    const soErrada = arestas.find((e) => e.src === "p:docs/so-errado.md" && e.dst === "p:docs/QUICK-START.md")!;
    expect(soErrada.formas).toEqual({ "caminho-repo-caixa-divergente": 1 });
    expect(soErrada.quebrado).toBe(true);
    expect(soErrada.alvo_morto).toBeUndefined();
    const skill = arestas.find((e) => e.src === "p:.claude/skills/s1/SKILL.md" && e.dst === "p:docs/QUICK-START.md")!;
    expect(skill.formas).toEqual({ "caminho-repo": 1, "caminho-repo-caixa-divergente": 1 }); // uma certa e uma errada
    expect(skill.quebrado).toBeUndefined();
    // o impacto de mover o arquivo REAL enxerga as três origens (guia, so-errado, skill)
    expect(arestas.filter((e) => e.dst === "p:docs/QUICK-START.md" && e.type === "referencia").length).toBe(3);
  });

  it("nó morto: só existe o que foi citado de verdade; sem path e sem `contem`; placeholder/glob/nome parcial/espaço não viram morto", async () => {
    const data = path.join(base, "d1");
    if (!existsSync(path.join(data, "topology"))) await rodar(raiz, data);
    const { nos, arestas } = ler(data);
    const mortos = nos.filter((n) => n.id.startsWith("morto:")).map((n) => n.id).sort();
    expect(mortos).toEqual(["morto:docs/nao-existe.md", "morto:engine/legado"]);
    expect(nos.filter((n) => n.id.startsWith("morto:") && n.path)).toEqual([]);
    expect(arestas.filter((e) => e.type === "contem" && e.dst.startsWith("morto:"))).toEqual([]);
    for (const e of arestas.filter((x) => x.dst.startsWith("morto:"))) {
      expect(e.type).toBe("referencia");
      expect(e.alvo_morto).toBe(true);
    }
    // `knowledge/negocios/{bu}/…` declara que a raiz nasce em execução: o caminho concreto não é morto
    expect(mortos.some((m) => m.includes("negocios"))).toBe(false);
  });

  it("escopo: instrução executável (skills, agents) é `ativo`; README e docs são `documentacao`", async () => {
    const data = path.join(base, "d1");
    if (!existsSync(path.join(data, "topology"))) await rodar(raiz, data);
    const { arestas } = ler(data);
    const para = (src: string) => arestas.find((e) => e.src === src && e.dst === "p:engine/mod.py")?.escopo;
    expect(para("p:.claude/skills/s1/SKILL.md")).toBe("ativo");
    expect(para("p:agents/ag1/agent.md")).toBe("ativo");
    expect(para("p:agents/ag1/README.md")).toBe("documentacao");
    expect(para("p:docs/README.md")).toBe("documentacao");
    expect(para("p:docs/guia.md")).toBe("documentacao");
  });

  it("o leitor do app (lib/topologia.ts) lê o extrato: hierarquia, impacto de mover e alvo morto", async () => {
    const data = path.join(base, "d1");
    if (!existsSync(path.join(data, "topology"))) await rodar(raiz, data);
    // BILHON_ROOT cobre o extrato (como no populate, onde a raiz é o mega-brain que contém o app)
    vi.stubEnv("BILHON_ROOT", base);
    vi.stubEnv("BILHON_TOPOLOGY_DIR", path.join(data, "topology"));
    try {
      const { grafoTopologia, impactoDeMover, limparCacheTopologia } = await import("@/lib/topologia");
      limparCacheTopologia();
      const hier = await grafoTopologia({ tipos: ["contem"], maxEdges: 100000 });
      expect(hier.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["topo:repo:mega-brain", "topo:p:engine/mod.py"]));
      const imp = await impactoDeMover(path.join(raiz, "engine", "mod.py"));
      expect(imp).not.toBeNull();
      expect(imp!.ativo.arquivos).toBe(2); // a skill e o agent.md; README e docs são menção
      expect(imp!.dado.arquivos).toBe(3);
      const mortas = await grafoTopologia({ soMortas: true, maxEdges: 100000 });
      expect(mortas.nodes.filter((n) => n.id.startsWith("topo:morto:")).map((n) => n.label).sort()).toEqual([
        "docs/nao-existe.md (inexistente)",
        "engine/legado (inexistente)",
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("idempotente: rodar de novo gera os MESMOS bytes (inclusive o carimbo)", async () => {
    const data = path.join(base, "d3");
    await rodar(raiz, data);
    const h = () => ["nodes.json", "edges.json"].map((f) => sha256(readFileSync(path.join(data, "topology", f), "utf8")));
    const a = h();
    await rodar(raiz, data);
    expect(h()).toEqual(a);
  });

  it("guarda dos blocos de dados reais (topologiaDestePopulate): carimbo que confere com o conteúdo e o nó repo:mega-brain com a raiz lida", async () => {
    const data = path.join(base, "d4");
    await rodar(raiz, data);
    const topo = path.join(data, "topology");
    expect(topologiaDestePopulate(raiz, topo)).toBe(true);
    expect(topologiaDestePopulate(base, topo)).toBe(false); // outro mega-brain
    expect(topologiaDestePopulate(null, topo)).toBe(false); // clone avulso, sem mega-brain
    const arqN = path.join(topo, "nodes.json");
    const arqE = path.join(topo, "edges.json");
    const N = JSON.parse(readFileSync(arqN, "utf8")) as Record<string, unknown>;
    const E = JSON.parse(readFileSync(arqE, "utf8")) as Record<string, unknown> & { edges: ArestaTopo[] };
    // edges.json editado depois do populate, com o carimbo antigo: não bate com o conteúdo
    writeFileSync(arqE, `${JSON.stringify({ ...E, edges: E.edges.slice(1) }, null, 2)}\n`);
    expect(topologiaDestePopulate(raiz, topo)).toBe(false);
    // extrato de outra origem (sem o carimbo), mesmo com o conteúdo igual
    writeFileSync(arqN, JSON.stringify(semCampo(N, "conteudo_sha256")));
    writeFileSync(arqE, JSON.stringify(semCampo(E, "conteudo_sha256")));
    expect(topologiaDestePopulate(raiz, topo)).toBe(false);
    // ausente
    rmSync(topo, { recursive: true, force: true });
    expect(topologiaDestePopulate(raiz, topo)).toBe(false);
  });
});

/* ------------------------------------------------------------------ Leitor simulado (destaque do deep-link) */

type DocCorpus = Awaited<ReturnType<typeof scanRepo>>["docs"][number];

describe("Leitor simulado: o trecho da evidência precisa caber num único nó de texto", { timeout: 180_000 }, () => {
  const livro = (text: string, ext = ".md") => ({ kind: "doc", ext, text, sha256: sha256(text), rel: `x${ext}` });
  const leitor = criarLeitor();
  const TEXTO = [
    "# Título do Documento",
    "",
    "- **Pipeline MCE** — seis fases bloqueantes em sequência",
    "- Texto simples com a frase importante sobre ingestão de arquivos novos",
    "",
    "| Art | Princípio |",
    "| --- | --- |",
    "| I | CLI First |",
    "",
  ].join("\n");

  it("normComMapa == norm e o mapa leva a posição bruta à normalizada", () => {
    const bruta = "  a   b\t c  ";
    const { t, map } = normComMapa(bruta);
    expect(t).toBe(norm(bruta));
    expect(t[map[bruta.indexOf("b")]]).toBe("b");
    expect(t[map[bruta.indexOf("c")]]).toBe("c");
    expect(map[bruta.length]).toBe(t.length);
  });

  it("alvo do Leitor: cortaTexto(…, 60) e depois trim().slice(0, 50); nós de texto decodificam as entidades", () => {
    expect(alvoDoLeitor(`  ${"x".repeat(80)}`)).toBe("x".repeat(50));
    expect(nosDeTexto("<p>a &amp; b &lt;c&gt; <strong>d</strong></p>")).toEqual(["a & b <c> ", "d"]);
  });

  it("janela alinhada: mantém a âncora, é substring do documento e o Leitor destaca; linha de tabela fica como está", () => {
    const d = livro(TEXTO);
    const l1 = "- **Pipeline MCE** — seis fases bloqueantes em sequência";
    expect(leitor.acha(d, l1)).toBe(false);
    const a1 = janela(l1, l1.indexOf("Pipeline MCE"), "Pipeline MCE".length, { doc: d, leitor });
    expect(a1).toBe("Pipeline MCE");
    expect(leitor.acha(d, a1)).toBe(true);

    const l2 = "- Texto simples com a frase importante sobre ingestão de arquivos novos";
    const a2 = janela(l2, l2.indexOf("frase importante"), "frase importante".length, { doc: d, leitor });
    expect(a2).toBe(l2.slice(2));
    expect(leitor.acha(d, a2)).toBe(true);
    expect(norm(d.text).includes(a2)).toBe(true);

    const l3 = "| I | CLI First |";
    expect(janela(l3, l3.indexOf("CLI First"), 9, { doc: d, leitor })).toBe(l3); // 9 chars < mínimo: mantém a linha inteira
    expect(alinharAoLeitor(leitor, d, l3, 4, 13)).toBe(l3);
  });

  it("marcador de bloco sai do trecho quando só ele impede o destaque", () => {
    const d = livro(TEXTO);
    expect(semMarcadorDeBloco(leitor, d, "# Título do Documento")).toBe("Título do Documento");
    expect(semMarcadorDeBloco(leitor, d, "- Texto simples com a frase importante sobre ingestão de arquivos novos")).toBe(
      "Texto simples com a frase importante sobre ingestão de arquivos novos",
    );
    expect(semMarcadorDeBloco(leitor, d, "| I | CLI First |")).toBe("| I | CLI First |");
  });

  it("a porta de renderTexto é idêntica à do app (amostra fixa: título, lista, tabela, citação, código)", () => {
    const amostra = [
      TEXTO,
      "> citação com **negrito** e `código` & <tag>\n> segunda linha\n\nParágrafo\ncontinuação\n\n* item\n• outro\n",
      "| a | b |\n| c |\n\ntexto | com barra\n#### H4\n##### H5\n",
    ];
    for (const t of amostra) {
      for (const f of ["md", "txt"] as const) expect(renderHtmlLeitor(t, f), `${f}: ${t.slice(0, 30)}`).toBe(renderTexto(t, f));
    }
  });

  it.skipIf(!REPO_MB)("a porta de renderTexto é idêntica à do app para TODOS os livros do corpus real", async () => {
    const { docs } = await scanRepo(REPO_MB!);
    const diferentes = docs
      .filter((x: DocCorpus) => x.kind === "doc")
      .filter((x: DocCorpus) => {
        const f = x.ext === ".txt" ? "txt" : "md";
        return renderHtmlLeitor(x.text, f) !== renderTexto(x.text, f);
      })
      .map((x: DocCorpus) => x.rel);
    expect(diferentes).toEqual([]);
  });
});

/* ------------------------------------------------------------------ deep-link: o Leitor REAL destaca? */

// grafo, manifesto e os arquivos da estante (data/livros/arquivos, módulo `livros`) gerados pelo populate
describe.skipIf(!temKg || !existsSync(MANIFESTO_GRAFO) || !POPULADOS.has("livros"))("deep-link do grafo (data/kg): destaque medido com o renderTexto e o cortaTexto REAIS", () => {
  /** Medição independente do manifesto: quantas evidências de livro o Leitor real destaca (uma vez para o bloco). */
  let medicao: Promise<{ total: number; comDestaque: number }> | undefined;
  const medir = () =>
    (medicao ??= (async () => {
      const { cortaTexto } = await import("@/lib/texto");
      const db = new DatabaseSync(KG, { readOnly: true });
      const evs = db.prepare("SELECT livro, trecho FROM evidences WHERE livro NOT LIKE 'yt-%'").all() as { livro: string; trecho: string }[];
      db.close();
      const nosDe = new Map<string, string[]>();
      let com = 0;
      for (const v of evs) {
        let nos = nosDe.get(v.livro);
        if (!nos) {
          const raw = readFileSync(path.join(APP, "data", "livros", "arquivos", v.livro), "utf8");
          const html = renderTexto(raw, v.livro.endsWith(".txt") ? "txt" : "md");
          nos = html.split(/<[^>]*>/).map((s) => s.replace(/&(lt|gt|amp);/g, (_, k: string) => ({ lt: "<", gt: ">", amp: "&" })[k]!)).filter(Boolean);
          nosDe.set(v.livro, nos);
        }
        const alvo = cortaTexto(v.trecho, 60).trim().slice(0, 50);
        if (alvo.length >= 8 && nos.some((n) => n.includes(alvo))) com++;
      }
      return { total: evs.length, comDestaque: com };
    })());

  it("o manifesto conta o mesmo que a medição independente do destaque no Leitor real", async () => {
    const { total, comDestaque } = await medir();
    const manifesto = JSON.parse(readFileSync(MANIFESTO_GRAFO, "utf8"));
    const m = manifesto.verificacao.destaqueNoLeitor as { total: number; comDestaque: number };
    console.log("[destaque no Leitor real]", JSON.stringify({ evidenciasDeLivro: total, comDestaque, manifesto: m }));
    expect(total).toBe(m.total);
    expect(Math.abs(comDestaque - m.comDestaque)).toBeLessThanOrEqual(Math.ceil(total * 0.02));
  });

  // a proporção depende do corpus (tabelas, listas, código): o patamar foi medido nesta distribuição do mega-brain
  it.skipIf(!E2E)("conteúdo desta distribuição (POPULATE_E2E=1): a maioria das evidências de livro é destacável", async () => {
    const { total, comDestaque } = await medir();
    expect(total).toBeGreaterThan(0);
    expect(comDestaque / total).toBeGreaterThanOrEqual(0.6); // antes da correção: 21%
  });
});

/* ------------------------------------------------------------------ regeneração com o SQLite aberto */

describe("grafo: troca do SQLite com o app lendo", () => {
  let base: string;
  beforeAll(() => { base = mkdtempSync(path.join(tmpdir(), "kg-troca-")); });
  afterAll(() => { try { rmSync(base, { recursive: true, force: true }); } catch { /* arquivo ainda preso por um teste interrompido: o tmpdir é descartável */ } });

  const criaDb = (arq: string, linhas: number[]) => {
    const db = new DatabaseSync(arq);
    db.exec("PRAGMA synchronous = OFF; PRAGMA journal_mode = MEMORY; BEGIN; CREATE TABLE t (a INTEGER)");
    for (const x of linhas) db.prepare("INSERT INTO t VALUES (?)").run(x);
    db.exec("COMMIT");
    db.close();
  };
  const linhas = (arq: string) => {
    const db = new DatabaseSync(arq, { readOnly: true });
    try { return (db.prepare("SELECT a FROM t ORDER BY a").all() as { a: number }[]).map((r) => r.a); } finally { db.close(); }
  };

  it("leitura rápida do app: o rename espera e conclui", async () => {
    const dest = path.join(base, "a.sqlite");
    const src = path.join(base, "a.novo.sqlite");
    criaDb(dest, [1]);
    criaDb(src, [1, 2, 3]);
    const leitor = new DatabaseSync(dest, { readOnly: true });
    const cursor = leitor.prepare("SELECT a FROM t").iterate();
    cursor.next();
    setTimeout(() => leitor.close(), 400); // o app solta o arquivo logo depois
    expect(await trocarSqlite(src, dest)).toMatch(/^(rename|backup)$/);
    expect(linhas(dest)).toEqual([1, 2, 3]);
  }, 120_000);

  it.skipIf(process.platform !== "win32")("leitura presa: falha com causa clara (Windows) e o arquivo antigo fica intacto", async () => {
    const dest = path.join(base, "b.sqlite");
    const src = path.join(base, "b.novo.sqlite");
    criaDb(dest, [7]);
    criaDb(src, [8, 9]);
    const leitor = new DatabaseSync(dest, { readOnly: true });
    const cursor = leitor.prepare("SELECT a FROM t").iterate();
    cursor.next();
    const r = await trocarSqlite(src, dest, [0, 30]).then((v) => ({ v }), (e: Error) => ({ e }));
    if ("e" in r) {
      expect(r.e.message).toMatch(/em uso/);
      expect(r.e.message).toMatch(/pause o servidor|aguarde/i);
      leitor.close();
      expect(linhas(dest)).toEqual([7]);
    } else {
      leitor.close();
      expect(r.v).toBe("backup"); // o SQLite conseguiu copiar respeitando o lock: também é um desfecho válido
      expect(linhas(dest)).toEqual([8, 9]);
    }
  }, 120_000);

  it("copiarPorBackup copia o conteúdo para dentro de um arquivo existente", async () => {
    const dest = path.join(base, "c.sqlite");
    const src = path.join(base, "c.novo.sqlite");
    criaDb(dest, [9]);
    criaDb(src, [1, 2, 3]);
    await copiarPorBackup(src, dest);
    expect(linhas(dest)).toEqual([1, 2, 3]);
  }, 120_000);

  it("temporários órfãos de processos que não existem mais são removidos; o do processo vivo e o banco ficam", async () => {
    const dir = path.join(base, "kg-orfaos");
    mkdirSync(dir, { recursive: true });
    const morto = 2147480000;
    for (const n of [`livros-kg.sqlite.${morto}.tmp`, `livros-kg.sqlite.${morto}.tmp-journal`, `livros-kg.sqlite.${process.pid}.tmp`, "livros-kg.sqlite", "outro.tmp"]) {
      writeFileSync(path.join(dir, n), "x");
    }
    expect(await limparTmpOrfaos(dir)).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(["livros-kg.sqlite", `livros-kg.sqlite.${process.pid}.tmp`, "outro.tmp"].sort());
  });

  it.skipIf(!REPO_MB)("regeneração: conteúdo igual não toca no arquivo (nem com o app lendo); conteúdo novo com leitura presa falha limpo e sem .tmp", async () => {
    const repo = REPO_MB!;
    const { docs, excluded } = await scanRepo(repo);
    const so = (...rels: string[]) => docs.filter((d: DocCorpus) => rels.includes(d.rel));
    const dataDir = path.join(base, "dados");
    const kg = path.join(dataDir, "kg");
    const ctx = (d: DocCorpus[]) => ({ repoRoot: repo, appRoot: APP, dataDir, docs: d, excluded, opts: {}, resultados: {} });
    const tmps = () => readdirSync(kg).filter((n) => n.includes(".tmp"));
    const manifesto = () => JSON.parse(readFileSync(path.join(kg, "populate-grafo.json"), "utf8"));
    const docsA = so(".claude/CLAUDE.md", ".claude/rules/agent-authority.md");
    expect(docsA.length).toBe(2);

    await runGrafo(ctx(docsA));
    const m1 = manifesto();
    const db = path.join(kg, "livros-kg.sqlite");
    const marca1 = marcaDoArquivo(db);

    const leitor = new DatabaseSync(db, { readOnly: true });
    const cursor = leitor.prepare("SELECT * FROM evidences").iterate();
    cursor.next(); // leitura em andamento, como uma requisição do app
    try {
      await runGrafo(ctx(docsA)); // mesmo conteúdo: não pode falhar nem mexer no arquivo
      expect(marcaDoArquivo(db)).toBe(marca1);
      expect(manifesto().sqliteSha256).toBe(m1.sqliteSha256);
      expect(tmps()).toEqual([]);

      const r = await runGrafo(ctx(so(".claude/CLAUDE.md"))).then(() => "ok", (e: Error) => e.message);
      expect(tmps()).toEqual([]); // nunca sobra temporário
      if (process.platform === "win32") {
        expect(r).toMatch(/em uso/);
        expect(manifesto().sqliteLogicoSha256).toBe(m1.sqliteLogicoSha256); // o grafo anterior foi mantido
      }
    } finally {
      leitor.close();
    }
    await runGrafo(ctx(so(".claude/CLAUDE.md"))); // solto o arquivo: agora troca
    expect(manifesto().sqliteLogicoSha256).not.toBe(m1.sqliteLogicoSha256);
    expect(tmps()).toEqual([]);
  }, 600_000); // 4 regenerações do grafo; em disco disputado (vários processos) cada uma chega a ~1 min
});
