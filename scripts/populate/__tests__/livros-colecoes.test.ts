/**
 * Módulos `livros` e `colecoes` da população do Knowledge.
 *
 * Duas camadas:
 *  1. corpus sintético em tmpdir (rápido): formato do catálogo, vizinhos, clusters, preservação do
 *     que não é gerado, remoção do que sumiu, determinismo byte a byte;
 *  2. corpus REAL do mega-brain (pulado se o repositório não estiver ao lado do app): a leitura é
 *     feita pelos leitores de verdade (`lib/colecoes.ts`, `lib/catalog.ts`, `lib/livro-conteudo.ts`)
 *     e CADA documento de CADA coleção precisa voltar com a mesma sequência de palavras do original.
 *
 * O leitor das coleções (`lib/colecoes.ts`) consulta os stores pela CLI `sqlite3` (com FTS5): sem ela
 * (o padrão no Windows), o que passa por ele é pulado (`TEM_SQLITE3_FTS5`, de `_sqlite-cli.ts`).
 *
 * Leitores do outlierhub que não existiam no app anterior: `lib/livro-conteudo.ts` (cards da estante
 * e página do livro) e a data do livro no /grafo (mtime do arquivo em BILHON_LIVROS_DIR, via
 * `lib/datas-disco.ts`).
 *
 * Nada é gravado fora do tmpdir: `dataDir` vem de um diretório temporário.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chunkWords, resolveRepoRoot, scanRepo } from "../common.mjs";
import runLivros from "../livros.mjs";
import runColecoes from "../colecoes.mjs";
import { TEM_SQLITE3_FTS5 } from "./_sqlite-cli";

// O disco B: sob carga deixa estes testes lentos (cada leitura abre um processo sqlite3); o limite padrão de 60 s estourava sem haver defeito.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

type Doc = Awaited<ReturnType<typeof scanRepo>>["docs"][number];

const palavras = (s: string) => s.split(/\s+/).filter(Boolean);
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** Hash de todos os arquivos sob `dir` (caminho + conteúdo), em ordem estável. */
async function hashArvore(dir: string): Promise<string> {
  const h = createHash("sha256");
  const visitar = async (d: string, rel: string): Promise<void> => {
    const itens = (await readdir(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of itens) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await visitar(path.join(d, e.name), r);
      else h.update(`${r}\u0000`).update(await readFile(path.join(d, e.name))).update("\u0000");
    }
  };
  await visitar(dir, "");
  return h.digest("hex");
}

const ctxDe = (docs: Doc[], dataDir: string) => ({
  repoRoot: "(teste)",
  appRoot: "(teste)",
  dataDir,
  docs,
  excluded: [],
  opts: {},
  resultados: {},
});

/** Lê o tmpdir como se fosse o `data/` do app, pelos leitores reais. */
function apontarLeitores(dataDir: string) {
  vi.stubEnv("BILHON_COLECOES_EXT", path.join(dataDir, "colecoes-external"));
  vi.stubEnv("BILHON_CATALOGO", path.join(dataDir, "livros", "catalogo.json"));
  vi.stubEnv("BILHON_LIVROS_DIR", path.join(dataDir, "livros", "arquivos"));
  vi.stubEnv("BILHON_LIVROS_DOMINIOS", path.join(dataDir, "livros", "livros-dominios.json"));
  vi.stubEnv("BILHON_LIVROS_HASHES", path.join(dataDir, "livros", "livros-hashes.json"));
  vi.stubEnv("BILHON_YOUTUBE_MAP", path.join(dataDir, "kg", "nao-existe.json"));
  // lib/livro-conteudo.ts: sidecars opcionais e grafo do MESMO data/ (o padrão é o data/ real do app)
  vi.stubEnv("BILHON_NIVEIS", path.join(dataDir, "livros", "niveis.json"));
  vi.stubEnv("BILHON_LIVROS_SINOPSES", path.join(dataDir, "livros", "livros-sinopses.json"));
  vi.stubEnv("BILHON_KG_DB", path.join(dataDir, "kg", "livros-kg.sqlite"));
  vi.resetModules();
}

let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), "populate-livros-colecoes-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(raiz, { recursive: true, force: true });
});

/** Cria um mini-repositório e varre com o mesmo `scanRepo` da população. */
async function miniRepo(arquivos: Record<string, string>): Promise<Doc[]> {
  const repo = path.join(raiz, "repo");
  await rm(repo, { recursive: true, force: true });
  for (const [rel, texto] of Object.entries(arquivos)) {
    await mkdir(path.dirname(path.join(repo, rel)), { recursive: true });
    await writeFile(path.join(repo, rel), texto, "utf8");
  }
  return (await scanRepo(repo)).docs;
}

const repetir = (frase: string, n: number) => Array.from({ length: n }, () => frase).join(" ");

/** Seis documentos em dois assuntos bem separados (vendas × pipeline de dados). */
const TOPICOS: Record<string, string> = {
  "docs/vendas-funil.md": `# Funil de vendas\n\n${repetir("funil vendas prospecção cliente fechamento proposta comercial", 12)}`,
  "docs/vendas-proposta.md": `# Proposta comercial\n\n${repetir("proposta vendas cliente fechamento negociação comercial funil", 12)}`,
  "docs/vendas-negociacao.md": `# Negociação\n\n${repetir("negociação cliente fechamento vendas objeção comercial proposta", 12)}`,
  "docs/pipeline-ingestao.md": `# Ingestão\n\n${repetir("pipeline ingestão chunk embedding indexação corpus lote", 12)}`,
  "docs/pipeline-indice.md": `# Índice\n\n${repetir("indexação embedding corpus pipeline vetor chunk busca", 12)}`,
  "docs/pipeline-lote.md": `# Lote\n\n${repetir("lote pipeline corpus chunk ingestão vetor embedding", 12)}`,
};

/** Documentos de tamanhos de fronteira (1, 399, 400, 401, 750, 751, 1099, 1100, 1101 palavras). */
function textoDe(prefixo: string, palavrasN: number): string {
  const itens = Array.from({ length: palavrasN }, (_, k) => `${prefixo}w${k}`);
  // quebras de linha e aspas dentro do trecho: nada disso pode alterar a sequência de palavras
  return itens.map((p, k) => (k % 12 === 11 ? `${p}\n` : k % 17 === 5 ? `${p}'s "x"` : p)).join(" ");
}
const FRONTEIRA = [1, 399, 400, 401, 750, 751, 1099, 1100, 1101];
const DOCS_FRONTEIRA: Record<string, string> = Object.fromEntries(
  FRONTEIRA.map((n) => [`docs/fronteira-${n}.md`, `# Fronteira ${n}\n\n${textoDe(`d${n}`, n)}\n`]),
);

describe("livros (corpus sintético)", () => {
  it("gera o catálogo no formato de docs/dados.md, com arquivo idêntico ao texto", async () => {
    const docs = await miniRepo(TOPICOS);
    const data = path.join(raiz, "data");
    const r = await runLivros(ctxDe(docs, data));
    expect(r.resumo.livros).toBe(6);

    const cat = JSON.parse(await readFile(path.join(data, "livros", "catalogo.json"), "utf8"));
    expect(Object.keys(cat)).toEqual(["livros"]);
    const ids = new Set<string>(cat.livros.map((l: { id: string }) => l.id));
    expect(ids.size).toBe(6);
    for (const l of cat.livros) {
      const d = docs.find((x) => x.id === l.id)!;
      expect(l.titulo).toBe(d.title);
      expect(l.arquivo).toBe(d.arquivo);
      expect(["md", "txt"]).toContain(l.formato);
      expect(l.tema).toBe(d.tema);
      expect(l.cluster === null || (Number.isInteger(l.cluster) && l.cluster >= 1)).toBe(true);
      expect(l.origem).toBe(`mega-brain/${d.area}`);
      expect(l.paginas).toBeNull();
      expect(l.chunksTotal).toBe(chunkWords(d.text).length);
      expect(l.proveniencia.origemPath).toBe(d.rel);
      expect(typeof l.proveniencia.motivo).toBe("string");
      const arq = path.join(data, "livros", "arquivos", l.arquivo);
      expect(await readFile(arq, "utf8")).toBe(d.text);
      expect(l.sizeBytes).toBe((await stat(arq)).size);
      expect(Array.isArray(l.vizinhos)).toBe(true);
      expect(l.vizinhos.length).toBeLessThanOrEqual(5);
      for (const v of l.vizinhos) {
        expect(v.id).not.toBe(l.id);
        expect(ids.has(v.id)).toBe(true);
        expect(v.titulo).toBe(cat.livros.find((x: { id: string }) => x.id === v.id).titulo);
        expect(v.score).toBeGreaterThanOrEqual(0);
        expect(v.score).toBeLessThanOrEqual(1);
        expect(Math.round(v.score * 1000) / 1000).toBe(v.score);
      }
      const scores = l.vizinhos.map((v: { score: number }) => v.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    }
  });

  it("vizinhos e clusters seguem o assunto: vendas com vendas, pipeline com pipeline", async () => {
    const docs = await miniRepo(TOPICOS);
    const data = path.join(raiz, "data");
    await runLivros(ctxDe(docs, data));
    const cat = JSON.parse(await readFile(path.join(data, "livros", "catalogo.json"), "utf8"));
    const por = new Map<string, { vizinhos: { id: string }[]; cluster: number | null }>(
      cat.livros.map((l: { id: string; vizinhos: { id: string }[]; cluster: number | null }) => [l.id, l]),
    );
    const vendas = [...por.keys()].filter((id) => id.includes("vendas"));
    const pipeline = [...por.keys()].filter((id) => id.includes("pipeline"));
    for (const id of vendas) {
      expect(por.get(id)!.vizinhos[0].id).toMatch(/vendas/);
      expect(por.get(id)!.cluster).not.toBeNull();
    }
    for (const id of pipeline) expect(por.get(id)!.vizinhos[0].id).toMatch(/pipeline/);
    expect(new Set(vendas.map((id) => por.get(id)!.cluster)).size).toBe(1);
    expect(new Set(pipeline.map((id) => por.get(id)!.cluster)).size).toBe(1);
    expect(por.get(vendas[0])!.cluster).not.toBe(por.get(pipeline[0])!.cluster);
  });

  it("auxiliares: domínio e SHA-256 do arquivo gravado", async () => {
    const docs = await miniRepo(TOPICOS);
    const data = path.join(raiz, "data");
    await runLivros(ctxDe(docs, data));
    const dom = JSON.parse(await readFile(path.join(data, "livros", "livros-dominios.json"), "utf8"));
    const hs = JSON.parse(await readFile(path.join(data, "livros", "livros-hashes.json"), "utf8"));
    expect(existsSync(path.join(data, "livros", "niveis.json"))).toBe(false);
    for (const d of docs) {
      expect(dom.porLivro[d.id]).toBe(d.dominio);
      expect(hs.porLivro[d.id]).toBe(sha(await readFile(path.join(data, "livros", "arquivos", d.arquivo))));
    }
  });

  it("é determinístico entre pastas novas e idempotente na mesma pasta", async () => {
    const docs = await miniRepo(TOPICOS);
    const a = path.join(raiz, "a");
    const b = path.join(raiz, "b");
    await runLivros(ctxDe(docs, a));
    await runLivros(ctxDe(docs, b));
    expect(await hashArvore(a)).toBe(await hashArvore(b));

    const antes = await hashArvore(a);
    const mtime = (await stat(path.join(a, "livros", "arquivos", docs[0].arquivo))).mtimeMs;
    const r = await runLivros(ctxDe(docs, a));
    expect(r.resumo.arquivosGravados).toBe(0);
    expect(r.resumo.arquivosRemovidos).toBe(0);
    expect(await hashArvore(a)).toBe(antes);
    expect((await stat(path.join(a, "livros", "arquivos", docs[0].arquivo))).mtimeMs).toBe(mtime);
  });

  it("regenerar remove só o que foi gerado e sumiu; preserva entradas e arquivos de terceiros", async () => {
    const docs = await miniRepo(TOPICOS);
    const data = path.join(raiz, "data");
    const arquivos = path.join(data, "livros", "arquivos");
    await runLivros(ctxDe(docs, data));

    // estado do usuário: capa, arquivo solto e uma entrada de catálogo à mão (+ domínio/checksum dela)
    await mkdir(path.join(arquivos, ".covers"), { recursive: true });
    await writeFile(path.join(arquivos, ".covers", "capa.png"), "png");
    await writeFile(path.join(arquivos, "solto.txt"), "meu arquivo");
    await writeFile(path.join(arquivos, "manual.md"), "# Manual\n");
    const catFile = path.join(data, "livros", "catalogo.json");
    const cat = JSON.parse(await readFile(catFile, "utf8"));
    const manual = {
      id: "manual", titulo: "Manual", arquivo: "manual.md", formato: "md", tema: "Meu tema", cluster: null,
      origem: "minha-biblioteca", sizeBytes: 9, vizinhos: [], proveniencia: { origemPath: "x", motivo: "à mão" },
    };
    await writeFile(catFile, JSON.stringify({ livros: [...cat.livros, manual] }));
    const domFile = path.join(data, "livros", "livros-dominios.json");
    const dom = JSON.parse(await readFile(domFile, "utf8"));
    dom.porLivro.manual = "meu-dominio";
    await writeFile(domFile, JSON.stringify(dom));

    // o repositório perde um documento
    const sumido = docs.find((d) => d.rel === "docs/vendas-funil.md")!;
    const r = await runLivros(ctxDe(docs.filter((d) => d !== sumido), data));
    expect(r.resumo.arquivosRemovidos).toBe(1);
    expect(r.resumo.preservadosManuais).toBe(1);
    expect(existsSync(path.join(arquivos, sumido.arquivo))).toBe(false);
    expect(await readFile(path.join(arquivos, "solto.txt"), "utf8")).toBe("meu arquivo");
    expect(await readFile(path.join(arquivos, ".covers", "capa.png"), "utf8")).toBe("png");
    expect(await readFile(path.join(arquivos, "manual.md"), "utf8")).toBe("# Manual\n");

    const novo = JSON.parse(await readFile(catFile, "utf8"));
    const idsNovo = novo.livros.map((l: { id: string }) => l.id);
    expect(idsNovo).not.toContain(sumido.id);
    expect(idsNovo).toContain("manual");
    expect(novo.livros.find((l: { id: string }) => l.id === "manual")).toEqual(manual);
    // nenhum vizinho aponta para o livro removido
    for (const l of novo.livros) for (const v of l.vizinhos) expect(idsNovo).toContain(v.id);
    const dom2 = JSON.parse(await readFile(domFile, "utf8"));
    expect(dom2.porLivro.manual).toBe("meu-dominio");
    expect(dom2.porLivro[sumido.id]).toBeUndefined();
    const hs2 = JSON.parse(await readFile(path.join(data, "livros", "livros-hashes.json"), "utf8"));
    expect(hs2.porLivro[sumido.id]).toBeUndefined();
  });

  it("o leitor real (lib/catalog.ts) enxerga todos os livros, com arquivo e vizinhos", async () => {
    const docs = await miniRepo(TOPICOS);
    const data = path.join(raiz, "data");
    await runLivros(ctxDe(docs, data));
    apontarLeitores(data);
    const { getBooks, getBook, resolveFilePath } = await import("../../../lib/catalog");
    const livros = await getBooks();
    expect(livros).toHaveLength(6);
    for (const l of livros) {
      expect(l.dominio).toBeTruthy();
      expect(l.checksum).toMatch(/^[0-9a-f]{64}$/);
      const det = await getBook(l.id);
      expect(Array.isArray(det!.vizinhos)).toBe(true);
      expect(await resolveFilePath(l.id)).not.toBeNull();
    }
  });

  it("leitor da estante do outlierhub (lib/livro-conteudo.ts): cards e página do livro com o dado gerado, sem demo", async () => {
    const docs = await miniRepo(TOPICOS);
    const data = path.join(raiz, "data");
    await runLivros(ctxDe(docs, data));
    apontarLeitores(data);
    const { livrosDaEstante, conteudoDoLivro } = await import("../../../lib/livro-conteudo");
    const { getBook } = await import("../../../lib/catalog");
    const cards = await livrosDaEstante();
    expect(cards.map((c) => c.id).sort()).toEqual(docs.map((d) => d.id).sort());
    for (const c of cards) {
      const d = docs.find((x) => x.id === c.id)!;
      expect(c.origem).toBe(`mega-brain/${d.area}`); // nenhum card do demo (origem "INBOX")
      expect(c.path.endsWith(d.arquivo)).toBe(true);
      expect(c.chunksTotal).toBe(chunkWords(d.text).length);
      expect(c.paginas).toBeNull();
      expect(c.dominio).toBe(d.dominio);
      // sem niveis.json, livros-sinopses.json e grafo: os campos ficam vazios (o mega-brain não tem fonte para eles)
      expect(c.nivel).toBeNull();
      expect(c.sinopse).toBeNull();
      expect(c.conceitos).toEqual([]);
      expect(c.prompt).toContain(`"${d.title}"`);
      // página do livro: a abertura vem do próprio arquivo gravado
      const conteudo = await conteudoDoLivro((await getBook(c.id))!);
      expect(conteudo.abertura).toBeTruthy();
      expect(palavras(d.text).join(" ")).toContain(palavras(conteudo.abertura!.replace(/…$/, "")).slice(0, 20).join(" "));
      expect(conteudo.trechos).toEqual([]);
    }
  });

  it("o arquivo da estante leva o mtime da origem (data do livro no /grafo); arquivo do usuário não é tocado", async () => {
    const docs = await miniRepo(TOPICOS);
    const repo = path.join(raiz, "repo");
    const antigo = new Date("2025-03-14T12:00:00Z");
    for (const d of docs) await utimes(path.join(repo, d.rel), antigo, antigo);
    const data = path.join(raiz, "data");
    const arquivos = path.join(data, "livros", "arquivos");
    await mkdir(arquivos, { recursive: true });
    await writeFile(path.join(arquivos, "solto.txt"), "meu arquivo");
    const mtimeSolto = (await stat(path.join(arquivos, "solto.txt"))).mtimeMs;
    const ctx = { ...ctxDe(docs, data), repoRoot: repo };

    const r = await runLivros(ctx);
    expect(r.resumo.datasAlinhadas).toBe(docs.length);
    for (const d of docs) {
      expect(Math.abs((await stat(path.join(arquivos, d.arquivo))).mtimeMs - antigo.getTime())).toBeLessThan(1000);
    }
    expect((await stat(path.join(arquivos, "solto.txt"))).mtimeMs).toBe(mtimeSolto);

    // o leitor do /grafo (lib/datas-disco.ts sobre BILHON_LIVROS_DIR) vê o dia da origem, não o da população
    apontarLeitores(data);
    const { LIVROS_DIR } = await import("../../../lib/catalog");
    const { diaDoDisco, diaLocal } = await import("../../../lib/datas-disco");
    expect(await diaDoDisco(path.join(LIVROS_DIR, docs[0].arquivo), LIVROS_DIR)).toBe(diaLocal(antigo));

    // idempotente: nada regravado, nenhuma data reaplicada
    const antes = await hashArvore(data);
    const mtimes = await Promise.all(docs.map(async (d) => (await stat(path.join(arquivos, d.arquivo))).mtimeMs));
    const r2 = await runLivros(ctx);
    expect(r2.resumo.arquivosGravados).toBe(0);
    expect(r2.resumo.datasAlinhadas).toBe(0);
    expect(await hashArvore(data)).toBe(antes);
    expect(await Promise.all(docs.map(async (d) => (await stat(path.join(arquivos, d.arquivo))).mtimeMs))).toEqual(mtimes);

    // origem editada: o arquivo é regravado e assume a nova data da origem
    const editado = docs[1];
    const novo = new Date("2026-01-02T12:00:00Z");
    await writeFile(path.join(repo, editado.rel), `${editado.text}\nlinha nova\n`);
    await utimes(path.join(repo, editado.rel), novo, novo);
    const r3 = await runLivros({ ...ctx, docs: docs.map((d) => (d === editado ? { ...d, text: `${d.text}\nlinha nova\n` } : d)) });
    expect(r3.resumo.arquivosGravados).toBe(1);
    expect(r3.resumo.datasAlinhadas).toBe(1);
    expect(Math.abs((await stat(path.join(arquivos, editado.arquivo))).mtimeMs - novo.getTime())).toBeLessThan(1000);
  });
});

describe("livros: dado do usuário × documento gerado, e estado anterior ilegível", () => {
  const REPO_COLISAO = {
    "README.md": "# Readme do mega-brain\n\ntexto do repo\n",
    "docs/outro.md": "# Outro\n\noutro texto\n",
  };
  const manual = (extra: Record<string, unknown> = {}) => ({
    id: "meu-livro", titulo: "Meu livro", arquivo: "meu-livro.md", formato: "md", tema: "Meu tema", cluster: null,
    origem: "minha-biblioteca", sizeBytes: 20, vizinhos: [], proveniencia: { origemPath: "x", motivo: "à mão" }, ...extra,
  });
  const lerCat = async (data: string) =>
    JSON.parse(await readFile(path.join(data, "livros", "catalogo.json"), "utf8")).livros as Array<Record<string, any>>;
  const rodar = (docs: Doc[], data: string) => runLivros(ctxDe(docs, data));
  const ALT = /^readme-[0-9a-f]{8}\.md$/;

  it("entrada manual com o MESMO arquivo: preserva a entrada e o arquivo; o gerado ganha nome alternativo", async () => {
    const docs = await miniRepo(REPO_COLISAO);
    const data = path.join(raiz, "data");
    const arquivos = path.join(data, "livros", "arquivos");
    await mkdir(arquivos, { recursive: true });
    await writeFile(path.join(arquivos, "readme.md"), "# MEU LIVRO PESSOAL\n");
    const dele = manual({ id: "meu-livro", arquivo: "readme.md" });
    await writeFile(path.join(data, "livros", "catalogo.json"), JSON.stringify({ livros: [dele] }));

    const r = await rodar(docs, data);
    expect(await readFile(path.join(arquivos, "readme.md"), "utf8")).toBe("# MEU LIVRO PESSOAL\n");
    const cat = await lerCat(data);
    expect(cat.find((l) => l.id === "meu-livro")).toEqual(dele);
    const gerado = cat.find((l) => l.proveniencia.origemPath === "README.md")!;
    expect(gerado.id).toBe("readme"); // o id estava livre: só o arquivo muda
    expect(gerado.arquivo).toMatch(ALT);
    expect(await readFile(path.join(arquivos, gerado.arquivo), "utf8")).toBe(docs.find((d) => d.rel === "README.md")!.text);
    expect(r.resumo.colisoesPreservadas).toBe(1);
    expect(r.avisos.join("\n")).toMatch(/preservado/);

    // idempotente: mesmo conteúdo, nada regravado, o arquivo do usuário continua intacto
    const antes = await hashArvore(data);
    const r2 = await rodar(docs, data);
    expect(r2.resumo.arquivosGravados).toBe(0);
    expect(await hashArvore(data)).toBe(antes);

    // os leitores reais enxergam as duas entradas, cada uma com o seu arquivo
    apontarLeitores(data);
    const { getBooks, resolveFilePath } = await import("../../../lib/catalog");
    const livros = await getBooks();
    expect(livros).toHaveLength(3);
    expect(path.basename((await resolveFilePath("meu-livro"))!)).toBe("readme.md");
    expect(path.basename((await resolveFilePath(gerado.id))!)).toBe(gerado.arquivo);
  });

  it("entrada manual com o MESMO id (arquivo diferente): o gerado ganha id alternativo e mantém o arquivo", async () => {
    const docs = await miniRepo(REPO_COLISAO);
    const data = path.join(raiz, "data");
    const arquivos = path.join(data, "livros", "arquivos");
    await mkdir(arquivos, { recursive: true });
    await writeFile(path.join(arquivos, "meu-readme.md"), "# do usuário\n");
    const dele = manual({ id: "readme", arquivo: "meu-readme.md" });
    await writeFile(path.join(data, "livros", "catalogo.json"), JSON.stringify({ livros: [dele] }));
    await writeFile(path.join(data, "livros", "livros-dominios.json"), JSON.stringify({ porLivro: { readme: "meu-dominio" } }));

    await rodar(docs, data);
    const cat = await lerCat(data);
    expect(cat.find((l) => l.arquivo === "meu-readme.md")).toEqual(dele);
    const gerado = cat.find((l) => l.proveniencia.origemPath === "README.md")!;
    expect(gerado.id).toMatch(/^readme-[0-9a-f]{8}$/);
    expect(gerado.arquivo).toBe("readme.md"); // o grafo cita "livro:readme.md"
    expect(new Set(cat.map((l) => l.id)).size).toBe(cat.length);
    const dom = JSON.parse(await readFile(path.join(data, "livros", "livros-dominios.json"), "utf8"));
    expect(dom.porLivro.readme).toBe("meu-dominio"); // o domínio do usuário não foi sobrescrito
    expect(dom.porLivro[gerado.id]).toBe(docs.find((d) => d.rel === "README.md")!.dominio);
    for (const l of cat) for (const v of l.vizinhos) expect(cat.map((x) => x.id)).toContain(v.id);
  });

  it("arquivo SOLTO (sem entrada no catálogo) com o nome de um gerado: não é sobrescrito; some a colisão, volta ao nome natural", async () => {
    const docs = await miniRepo(REPO_COLISAO);
    const data = path.join(raiz, "data");
    const arquivos = path.join(data, "livros", "arquivos");
    await mkdir(arquivos, { recursive: true });
    await writeFile(path.join(arquivos, "readme.md"), "# SOLTO DO USUARIO\n");

    const r = await rodar(docs, data);
    expect(await readFile(path.join(arquivos, "readme.md"), "utf8")).toBe("# SOLTO DO USUARIO\n");
    expect(r.resumo.colisoesPreservadas).toBe(1);
    expect(r.avisos.join("\n")).toMatch(/README\.md/);
    const alt = (await lerCat(data)).find((l) => l.id === "readme")!.arquivo as string;
    expect(alt).toMatch(ALT);

    const estavel = await hashArvore(data);
    await rodar(docs, data);
    expect(await hashArvore(data)).toBe(estavel);

    // o usuário tira o arquivo dele: o documento volta ao nome natural e o alternativo (nosso) é removido
    await rm(path.join(arquivos, "readme.md"));
    const r3 = await rodar(docs, data);
    expect(r3.resumo.colisoesPreservadas).toBe(0);
    expect(r3.resumo.arquivosRemovidos).toBe(1);
    expect((await lerCat(data)).find((l) => l.id === "readme")!.arquivo).toBe("readme.md");
    expect(existsSync(path.join(arquivos, alt))).toBe(false);
  });

  it("sem catálogo, mas com os arquivos gerados antes (idênticos): são adotados, sem colisão", async () => {
    const docs = await miniRepo(REPO_COLISAO);
    const data = path.join(raiz, "data");
    await rodar(docs, data);
    for (const f of ["catalogo.json", "livros-dominios.json", "livros-hashes.json"]) await rm(path.join(data, "livros", f));
    const r = await rodar(docs, data);
    expect(r.resumo.colisoesPreservadas).toBe(0);
    expect(r.resumo.arquivosGravados).toBe(0);
    expect((await lerCat(data)).map((l) => l.arquivo).sort()).toEqual(docs.map((d) => d.arquivo).sort());
  });

  it("arquivo gerado e EDITADO depois pelo usuário: nunca é sobrescrito nem removido", async () => {
    const docs = await miniRepo(REPO_COLISAO);
    const data = path.join(raiz, "data");
    const arquivos = path.join(data, "livros", "arquivos");
    await rodar(docs, data);
    const outro = docs.find((d) => d.rel === "docs/outro.md")!;
    await writeFile(path.join(arquivos, outro.arquivo), "# editei à mão\n");

    // o documento muda no repositório: a cópia editada é do usuário → o gerado vai para o nome alternativo
    const alterado = docs.map((d) => (d === outro ? { ...d, text: `${d.text}\nlinha nova` } : d));
    const r = await rodar(alterado, data);
    expect(await readFile(path.join(arquivos, outro.arquivo), "utf8")).toBe("# editei à mão\n");
    expect(r.resumo.colisoesPreservadas).toBe(1);

    // o documento some do repositório: só o nome alternativo (nosso) é removido; a cópia editada segue intacta
    const r1b = await rodar(alterado.filter((d) => d.rel !== outro.rel), data);
    expect(r1b.resumo.arquivosRemovidos).toBe(1);
    expect(await readFile(path.join(arquivos, outro.arquivo), "utf8")).toBe("# editei à mão\n");
    expect((await lerCat(data)).map((l) => l.arquivo)).not.toContain(outro.arquivo);
  });

  it("gerado, editado depois e documento sumido (sem execução no meio): a cópia editada fica no disco, com aviso", async () => {
    const docs = await miniRepo(REPO_COLISAO);
    const data = path.join(raiz, "data");
    const arquivos = path.join(data, "livros", "arquivos");
    await rodar(docs, data);
    const outro = docs.find((d) => d.rel === "docs/outro.md")!;
    await writeFile(path.join(arquivos, outro.arquivo), "# editei à mão\n");

    const r = await rodar(docs.filter((d) => d !== outro), data);
    expect(await readFile(path.join(arquivos, outro.arquivo), "utf8")).toBe("# editei à mão\n");
    expect(r.resumo.arquivosRemovidos).toBe(0);
    expect(r.resumo.arquivosAlteradosMantidos).toBe(1);
    expect(r.avisos.join("\n")).toMatch(/alterado depois/);
    expect((await lerCat(data)).map((l) => l.arquivo)).not.toContain(outro.arquivo);
  });

  it.each([
    ["catalogo.json", '{ "livros": [ { "id": "manual", '],
    ["livros-dominios.json", '{ "porLivro": { "manual": "meu-dom'],
    ["livros-hashes.json", '{ "porLivro": { "manual": "abc'],
    ["catalogo.json", '{ "livros": 5 }'],
    ["livros-dominios.json", '{ "porLivro": [] }'],
  ])("%s existente e ilegível (%s): aborta com erro claro, sem escrever nada", async (nome, conteudo) => {
    const docs = await miniRepo(REPO_COLISAO);
    const data = path.join(raiz, "data");
    await mkdir(path.join(data, "livros"), { recursive: true });
    await writeFile(path.join(data, "livros", nome), conteudo);
    await expect(rodar(docs, data)).rejects.toThrow(new RegExp(`${nome.replace(".", "\\.")}.*não será sobrescrito`));
    expect(await readFile(path.join(data, "livros", nome), "utf8")).toBe(conteudo);
    expect(existsSync(path.join(data, "livros", "arquivos"))).toBe(false); // nem os livros foram gravados
    expect((await readdir(path.join(data, "livros"))).sort()).toEqual([nome]);
  });

  it("estado ilegível depois de uma execução boa: a segunda aborta e a árvore fica byte a byte igual", async () => {
    const docs = await miniRepo(REPO_COLISAO);
    const data = path.join(raiz, "data");
    await rodar(docs, data);
    const catFile = path.join(data, "livros", "catalogo.json");
    await writeFile(catFile, '{ "livros": [ { "id": "manual", ');
    const antes = await hashArvore(data);
    const mudado = docs.map((d) => ({ ...d, text: `${d.text}\ntexto novo` })); // gravaria tudo de novo se não abortasse
    await expect(rodar(mudado, data)).rejects.toThrow(/não é um JSON válido/);
    expect(await hashArvore(data)).toBe(antes);
  });

  it("catálogo editado à mão com BOM UTF-8 é lido normalmente e a entrada manual é preservada", async () => {
    const docs = await miniRepo(REPO_COLISAO);
    const data = path.join(raiz, "data");
    await mkdir(path.join(data, "livros"), { recursive: true });
    await writeFile(path.join(data, "livros", "catalogo.json"), `﻿${JSON.stringify({ livros: [manual()] })}`);
    await rodar(docs, data);
    expect((await lerCat(data)).find((l) => l.id === "meu-livro")).toEqual(manual());
  });
});

// O módulo grava os stores com node:sqlite (sempre roda); o leitor do app (lib/colecoes.ts) os consulta pela CLI
// `sqlite3`, que no Windows não vem instalada: o que passa pelo leitor é pulado sem ela, o resto do bloco roda.
describe("colecoes (corpus sintético)", () => {
  const codigo =(n: number) => `def f${n}():\n    return "x"  # d${n}\n`;

  it("cria um store por coleção, com sidecars e marcador", async () => {
    const docs = await miniRepo({
      ...DOCS_FRONTEIRA,
      ".claude/rules/regra.md": "# Regra\n\nNunca faça push direto.\n",
      "engine/guia.md": "# Guia\n\nTexto do engine.\n",
      "engine/codigo.py": codigo(1),
    });
    const data = path.join(raiz, "data");
    const r = await runColecoes(ctxDe(docs, data));
    const slugs = [...new Set(docs.map((d) => d.colecao))].sort();
    expect(r.resumo.colecoes).toBe(slugs.length);
    expect(r.resumo.docs).toBe(docs.length);
    expect(r.resumo.chunks).toBe(docs.reduce((a, d) => a + chunkWords(d.text).length, 0));

    const tiers: Record<string, string> = { regras: "A", docs: "A", "engine-docs": "B", codigo: "C" };
    for (const slug of slugs) {
      const pasta = path.join(data, "colecoes-external", "sources", slug);
      expect(existsSync(path.join(pasta, "_corpus_bge.sqlite"))).toBe(true);
      expect(JSON.parse(await readFile(path.join(pasta, ".provenance.json"), "utf8")).tier).toBe(tiers[slug]);
      expect(JSON.parse(await readFile(path.join(pasta, ".ontology.json"), "utf8")).domain).toBe(
        docs.find((d) => d.colecao === slug)!.dominio,
      );
      expect(JSON.parse(await readFile(path.join(pasta, ".populate-managed"), "utf8")).modulo).toBe("colecoes");
      // sem resíduos de SQLite nem temporários
      expect((await readdir(pasta)).filter((f) => /-wal$|-shm$|-journal$|\.tmp$/.test(f))).toEqual([]);
    }
  });

  it.skipIf(!TEM_SQLITE3_FTS5)("ida e volta pelo leitor real: a leitura completa devolve as mesmas palavras (inclusive nas fronteiras de 400/50)", async () => {
    const docs = await miniRepo({
      ...DOCS_FRONTEIRA,
      "docs/aspas.md": "# Aspas\n\nO 'caso' do \"autor\" — acentuação, ç, ã e emojis 😀 passam.\n",
    });
    const data = path.join(raiz, "data");
    await runColecoes(ctxDe(docs, data));
    apontarLeitores(data);
    const { getTranscript, getColecoes, getColecao } = await import("../../../lib/colecoes");
    const cols = await getColecoes();
    expect(cols.map((c) => c.slug)).toEqual(["docs"]);
    expect(cols[0].docs).toBe(docs.length);
    expect(cols[0].tier).toBe("A");
    expect(cols[0].dominio).toBe("documentacao");
    const col = await getColecao("docs");
    expect(col!.itens.map((i) => i.doc).sort()).toEqual(docs.map((d) => d.rel).sort());
    for (const d of docs) {
      const t = await getTranscript("docs", d.rel);
      expect(t, d.rel).not.toBeNull();
      expect(palavras(t!.texto), d.rel).toEqual(palavras(d.text));
      expect(t!.chunks, d.rel).toBe(chunkWords(d.text).length);
    }
  });

  it.skipIf(!TEM_SQLITE3_FTS5)("'⊕ grafo' de /colecao: documento da estante aponta para o nó dele no grafo (livro:<arquivo>), o resto para livro:yt-…", async () => {
    const docs = await miniRepo({ ...TOPICOS, "engine/codigo.py": codigo(3) });
    const data = path.join(raiz, "data");
    await runLivros(ctxDe(docs, data));
    await runColecoes(ctxDe(docs, data));
    apontarLeitores(data);
    const { getColecao } = await import("../../../lib/colecoes");
    let daEstante = 0;
    for (const slug of [...new Set(docs.map((d) => d.colecao))]) {
      for (const item of (await getColecao(slug))!.itens) {
        const d = docs.find((x) => x.rel === item.doc)!;
        // mesma identidade que o módulo `grafo` grava (`ref` em _extracao.mjs)
        expect(item.grafoFocus, d.rel).toBe(d.kind === "doc" ? `livro:${d.arquivo}` : `livro:yt-${slug}:${d.rel}`);
        if (d.kind === "doc") daEstante++;
      }
    }
    expect(daEstante).toBe(Object.keys(TOPICOS).length);
  });

  it("é determinístico byte a byte entre pastas novas; reexecutar não recria o store", async () => {
    const docs = await miniRepo({ ...DOCS_FRONTEIRA, "engine/codigo.py": codigo(2) });
    const a = path.join(raiz, "a");
    const b = path.join(raiz, "b");
    await runColecoes(ctxDe(docs, a));
    await runColecoes(ctxDe(docs, b));
    expect(await hashArvore(a)).toBe(await hashArvore(b));

    const store = path.join(a, "colecoes-external", "sources", "docs", "_corpus_bge.sqlite");
    const mtime = (await stat(store)).mtimeMs;
    const antes = await hashArvore(a);
    const r = await runColecoes(ctxDe(docs, a));
    expect(r.resumo.reconstruidas).toBe(0);
    expect(r.resumo.inalteradas).toBe(r.resumo.colecoes);
    expect((await stat(store)).mtimeMs).toBe(mtime);
    expect(await hashArvore(a)).toBe(antes);
  });

  it("muda o conteúdo → recria; coleção que sumiu → pasta gerenciada removida; pasta alheia nunca é tocada", async ({ skip }) => {
    const base = {
      "docs/um.md": "# Um\n\nprimeiro texto simples\n",
      "engine/guia.md": "# Guia\n\ntexto do engine\n",
    };
    const data = path.join(raiz, "data");
    const fontes = path.join(data, "colecoes-external", "sources");
    await runColecoes(ctxDe(await miniRepo(base), data));
    expect(existsSync(path.join(fontes, "engine-docs"))).toBe(true);

    // pastas de terceiros: uma sem relação, outra com o MESMO nome de uma coleção que seria gerada
    await mkdir(path.join(fontes, "minha-colecao"), { recursive: true });
    await writeFile(path.join(fontes, "minha-colecao", "_corpus_bge.sqlite"), "nao-e-nosso");
    await rm(path.join(fontes, "docs", ".populate-managed"));
    const ocupado = await readFile(path.join(fontes, "docs", "_corpus_bge.sqlite"));

    const depois = await miniRepo({ "docs/um.md": "# Um\n\ntexto MUDADO\n" });
    const r = await runColecoes(ctxDe(depois, data));
    expect(r.resumo.puladasPastaAlheia).toBe(1);
    expect(r.avisos.join("\n")).toMatch(/não é nossa/);
    expect(sha(await readFile(path.join(fontes, "docs", "_corpus_bge.sqlite")))).toBe(sha(ocupado));
    expect(await readFile(path.join(fontes, "minha-colecao", "_corpus_bge.sqlite"), "utf8")).toBe("nao-e-nosso");
    // engine-docs era nossa e sumiu do repositório
    expect(existsSync(path.join(fontes, "engine-docs"))).toBe(false);

    // devolvendo o marcador, a coleção volta a ser regenerada com o novo texto
    await writeFile(path.join(fontes, "docs", ".populate-managed"), JSON.stringify({ modulo: "colecoes", fingerprint: "velho" }));
    const r2 = await runColecoes(ctxDe(depois, data));
    expect(r2.resumo.reconstruidas).toBe(1);
    // só a leitura de volta precisa da CLI sqlite3: sem ela o teste para aqui e aparece como pulado
    skip(!TEM_SQLITE3_FTS5, "sem a CLI sqlite3 (com FTS5) o leitor lib/colecoes.ts não lê o store");
    apontarLeitores(data);
    const { getTranscript } = await import("../../../lib/colecoes");
    expect((await getTranscript("docs", "docs/um.md"))!.texto).toContain("MUDADO");
  });

  it("coleção sem nenhum trecho não é criada e não quebra", async () => {
    const data = path.join(raiz, "data");
    const r = await runColecoes(ctxDe([], data));
    expect(r.resumo.colecoes).toBe(0);
    expect(existsSync(path.join(data, "colecoes-external", "sources"))).toBe(false);
  });
});


/* ----------------------------------------------------------------------------------------------
 * Corpus REAL. Cada leitura do app abre um processo `sqlite3`, então as ~1,5 mil leituras levam
 * minutos: fica atrás de POPULATE_E2E=1 (rode: `POPULATE_E2E=1 npx vitest run <este arquivo>`).
 *   - "gera em tmpdir": varre o mega-brain, gera os dois módulos num diretório temporário e verifica;
 *   - "data/ atual": não gera nada; verifica o que está hoje em apps/knowledge/data contra o repositório.
 * -------------------------------------------------------------------------------------------- */
const REPO = (() => {
  try {
    return resolveRepoRoot();
  } catch {
    return null;
  }
})();
const E2E = process.env.POPULATE_E2E === "1" && REPO !== null;

/** Verifica `data` pelos leitores reais. Devolve as contagens que o app enxerga. */
async function verificarComLeitoresReais(data: string, docs: Doc[]) {
  apontarLeitores(data);
  const colecoes = await import("../../../lib/colecoes");
  const catalogo = await import("../../../lib/catalog");

  // só as coleções do módulo `colecoes` (o data/ atual também tem as dos especialistas e pastas alheias)
  const slugs = [...new Set(docs.map((d) => d.colecao))].sort();
  const cols = (await colecoes.getColecoes()).filter((c) => slugs.includes(c.slug));
  expect(cols.map((c) => c.slug).sort()).toEqual(slugs);
  expect(cols.reduce((a, c) => a + c.docs, 0)).toBe(docs.length);
  expect(cols.reduce((a, c) => a + c.chunks, 0)).toBe(docs.reduce((a, d) => a + chunkWords(d.text).length, 0));
  for (const c of cols) {
    expect(["A", "B", "C"]).toContain(c.tier);
    expect(c.dominio).toBeTruthy();
    const detalhe = await colecoes.getColecao(c.slug);
    expect(detalhe!.itens).toHaveLength(c.docs);
  }

  // ida e volta de cada documento de cada coleção (8 leituras em paralelo)
  let idaEVolta = 0;
  const falhas: string[] = [];
  const fila = [...docs];
  const trabalhador = async () => {
    for (let d = fila.pop(); d; d = fila.pop()) {
      const t = await colecoes.getTranscript(d.colecao, d.rel);
      const igual =
        t !== null &&
        JSON.stringify(palavras(t.texto)) === JSON.stringify(palavras(d.text)) &&
        t.chunks === chunkWords(d.text).length;
      if (igual) idaEVolta++;
      else falhas.push(d.rel);
    }
  };
  await Promise.all(Array.from({ length: 8 }, trabalhador));
  expect(falhas).toEqual([]);
  expect(idaEVolta).toBe(docs.length);

  // estante (o data/ atual também tem entradas manuais do usuário, como os PDFs importados à mão:
  // elas são preservadas pelo populate e ficam fora da comparação com o repositório)
  const livrosDocs = docs.filter((d) => d.kind === "doc");
  const todos = await catalogo.getBooks();
  const livros = todos.filter((l) => String(l.origem).startsWith("mega-brain/"));
  expect(livros).toHaveLength(livrosDocs.length);
  const ids = new Set(todos.map((l) => l.id));
  const cobertura = await catalogo.coberturaLivros();
  expect(cobertura.comDominio).toBeGreaterThanOrEqual(livros.length);
  expect(cobertura.comChecksum).toBeGreaterThanOrEqual(livros.length);
  // estante do outlierhub: um card por entrada do catálogo (nenhuma do demo)
  const cards = await (await import("../../../lib/livro-conteudo")).livrosDaEstante();
  expect(cards).toHaveLength(todos.length);
  expect(cards.filter((c) => c.origem === "INBOX")).toEqual([]);
  let vizinhosTotal = 0;
  for (const l of livros) {
    expect(["md", "txt"]).toContain(l.formato);
    const det = await catalogo.getBook(l.id);
    expect(Array.isArray(det!.vizinhos)).toBe(true);
    expect(det!.vizinhos.length).toBeLessThanOrEqual(5);
    vizinhosTotal += det!.vizinhos.length;
    for (const v of det!.vizinhos) {
      expect(ids.has(v.id)).toBe(true);
      expect(v.id).not.toBe(l.id);
    }
    const abs = await catalogo.resolveFilePath(l.id);
    expect(abs, l.id).not.toBeNull();
    expect((await stat(abs!)).size).toBe(l.sizeBytes);
    const d = livrosDocs.find((x) => x.id === l.id)!;
    expect(det!.chunksTotal).toBe(chunkWords(d.text).length);
    expect(l.checksum).toBe(sha(await readFile(abs!)));
  }
  return {
    colecoes: cols.length,
    docsNasColecoes: cols.reduce((a, c) => a + c.docs, 0),
    chunksNasColecoes: cols.reduce((a, c) => a + c.chunks, 0),
    idaEVoltaOk: idaEVolta,
    docsTotal: docs.length,
    livros: livros.length,
    vizinhosTotal,
  };
}

describe.skipIf(!E2E)("corpus real do mega-brain, lido pelos leitores do app (POPULATE_E2E=1)", () => {
  it(
    "gera em tmpdir: 100% dos documentos de todas as coleções voltam idênticos",
    async () => {
      const { docs } = await scanRepo(REPO!);
      expect(docs.length).toBeGreaterThan(100);
      const data = path.join(raiz, "data");
      const ctx = ctxDe(docs, data);
      await runLivros(ctx);
      await runColecoes(ctx);
      const r = await verificarComLeitoresReais(data, docs);
      console.log("[e2e tmpdir]", JSON.stringify(r));
    },
    600_000,
  );

  it(
    "data/ atual do app: coerente com o repositório e legível pelos leitores",
    async () => {
      const dataAtual = path.resolve(__dirname, "..", "..", "..", "data");
      if (!existsSync(path.join(dataAtual, "livros", "catalogo.json"))) return; // ainda não populado
      const { docs } = await scanRepo(REPO!);
      const r = await verificarComLeitoresReais(dataAtual, docs);
      console.log("[e2e data/]", JSON.stringify(r));
    },
    600_000,
  );
});
