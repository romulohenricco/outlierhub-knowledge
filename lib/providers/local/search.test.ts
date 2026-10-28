import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ProviderSearchError } from "../types";
import {
  K_SCORE,
  LocalSearchProvider,
  MAX_TERMOS,
  MAX_TRECHOS_POR_DOC,
  SNIPPET_MAX_CHARS,
  diagnosticoIndiceLocal,
  extrairTermos,
  montarMatch,
  montarSnippet,
} from "./search";

/**
 * Sanitização, expressão MATCH, snippet, ranking e diagnóstico do provider
 * "local". Os testes de índice criam um FTS5 temporário com a CLI `sqlite3` (a
 * mesma que o app usa em produção) e o descartam no fim — nenhum dado real.
 */

function sqliteComFts5(): boolean {
  try {
    execFileSync("sqlite3", [":memory:", "CREATE VIRTUAL TABLE t USING fts5(x);"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
const TEM_FTS5 = sqliteComFts5();

type Doc = {
  titulo: string;
  docRel: string;
  chunks: string[];
  tipo?: "livro" | "bilhon";
  livroId?: string | null;
};

const q = (s: string | null) => (s === null ? "NULL" : `'${s.replaceAll("'", "''")}'`);

/** Mesmo esquema de scripts/populate/busca.mjs (colunas na mesma ordem). */
function criarIndice(arquivo: string, docs: Doc[], versao = "1") {
  const linhas = [
    "CREATE VIRTUAL TABLE busca USING fts5(titulo, caminho, texto, tipo UNINDEXED, livro_id UNINDEXED, livro_titulo UNINDEXED, fonte_nome UNINDEXED, chunk_id UNINDEXED, link_local UNINDEXED, doc_rel UNINDEXED, chunk_idx UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');",
    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;",
    `INSERT INTO meta VALUES ('schema_version', ${q(versao)});`,
    "BEGIN;",
  ];
  for (const d of docs) {
    const tipo = d.tipo ?? "livro";
    const id = d.livroId === undefined ? d.docRel.replace(/\W+/g, "-") : d.livroId;
    d.chunks.forEach((texto, n) => {
      const link = tipo === "livro" ? `/livro/${id}` : `/colecao/codigo/${encodeURIComponent(d.docRel)}`;
      linhas.push(
        `INSERT INTO busca VALUES (${[
          q(d.titulo), q(d.docRel), q(texto), q(tipo), q(tipo === "livro" ? id : null), q(d.titulo),
          q("fonte-teste"), q(`${d.docRel}#${n}`), q(link), q(d.docRel), String(n),
        ].join(", ")});`,
      );
    });
  }
  linhas.push("COMMIT;");
  execFileSync("sqlite3", [arquivo], { input: linhas.join("\n"), stdio: ["pipe", "pipe", "pipe"] });
}

const ENCH = Array.from({ length: 50 }, (_, i) => `palavra${i % 7}`).join(" ");
const ench = (n: number) => Array.from({ length: n }, (_, i) => `miolo${i % 5}`).join(" ");

const CORPUS: Doc[] = [
  { titulo: "Alpha Guia", docRel: "docs/alpha-guia.md", chunks: [`Guia curto: alpha uma vez. ${ENCH}`] },
  { titulo: "Relatório geral", docRel: "docs/relatorio.md", chunks: [`alpha alpha alpha no corpo. ${ENCH}`] },
  { titulo: "Alpha e Beta juntos", docRel: "docs/alpha-beta.md", chunks: [`alpha beta no mesmo trecho. ${ENCH}`] },
  { titulo: "Governança de agentes", docRel: "docs/governanca.md", chunks: ["A governança define as regras do sistema de agentes."] },
  { titulo: "Constituição", docRel: "docs/constituicao.md", chunks: ["Todos os agentes obedecem à Constituição do sistema."] },
  {
    titulo: "Operadores",
    docRel: "docs/operadores.md",
    chunks: ["near and or not são palavras comuns aqui, junto de gamma e delta."],
  },
  {
    titulo: "HTML cru",
    docRel: "docs/html.md",
    chunks: ["Veja <script>alert('x')</script> e <img src=x onerror=alert(1)> sobre xssmarker."],
  },
  { titulo: "Squad base", docRel: "squads/base/SQUAD.md", chunks: Array.from({ length: 6 }, (_, i) => `squad trecho ${i} ${ench(30)}`) },
  ...Array.from({ length: 9 }, (_, i): Doc => ({
    titulo: `Squad extra ${i}`,
    docRel: `squads/extra-${i}/SQUAD.md`,
    chunks: [`o squad extra número ${i} ${ench(40)}`],
  })),
  { titulo: "Pluralização", docRel: "docs/plural.md", chunks: ["os squads trabalham juntos"] },
  {
    titulo: "Código de pipeline",
    docRel: "engine/pipeline/runner.py",
    tipo: "bilhon",
    livroId: null,
    chunks: ["def rodar_pipeline(mce): return 'ok'"],
  },
];

let tmp: string;
let indice: string;
const envOriginal = process.env.BILHON_LOCAL_SEARCH_DB;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "busca-local-"));
  indice = path.join(tmp, "index.sqlite");
  if (TEM_FTS5) criarIndice(indice, CORPUS);
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (envOriginal === undefined) delete process.env.BILHON_LOCAL_SEARCH_DB;
  else process.env.BILHON_LOCAL_SEARCH_DB = envOriginal;
});

const buscar = (query: string, topK?: number) => {
  vi.stubEnv("BILHON_LOCAL_SEARCH_DB", indice);
  return new LocalSearchProvider().search(query, topK);
};
const titulos = (hits: { livroTitulo: string }[]) => hits.map((h) => h.livroTitulo);

/* ------------------------------------------------------------------ sanitização */

describe("extrairTermos", () => {
  it.each([
    ["", []],
    ["   ", []],
    ["!!! ??? --- ;;; ''' \"\"\"", []],
    ["pipeline MCE", ["pipeline", "MCE"]],
    ["  DNA   schema ", ["DNA", "schema"]],
    ["governança", ["governança"]],
    ["constituição, governança!", ["constituição", "governança"]],
    ["workspace L0-identity", ["workspace", "L0", "identity"]],
    ["snake_case.py", ["snake", "case", "py"]],
  ])("%j -> %j", (entrada, esperado) => {
    expect(extrairTermos(entrada)).toEqual(esperado);
  });

  it("normaliza acento decomposto (NFD) para a mesma forma da indexação (NFC)", () => {
    const nfd = "governança"; // c + cedilha combinante
    expect(extrairTermos(nfd)).toEqual(["governança"]);
  });

  it("remove aspas, operadores FTS e sintaxe SQL, deixando só palavras", () => {
    expect(extrairTermos(`alpha" OR "beta`)).toEqual(["alpha", "beta"]);
    expect(extrairTermos("'; DROP TABLE busca; --")).toEqual(["DROP", "TABLE", "busca"]);
    expect(extrairTermos("titulo:alpha")).toEqual(["titulo", "alpha"]);
    expect(extrairTermos("NEAR(alpha beta, 3)")).toEqual(["NEAR", "alpha", "beta", "3"]);
    expect(extrairTermos("^alpha* -beta (gamma) {delta}")).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  it("descarta palavras funcionais, mas só se sobrar termo de conteúdo", () => {
    expect(extrairTermos("o que é RAG")).toEqual(["RAG"]);
    expect(extrairTermos("how to use the squad")).toEqual(["use", "squad"]);
    expect(extrairTermos("o que é")).toEqual(["o", "que", "é"]);
    expect(extrairTermos("and or")).toEqual(["and", "or"]);
  });

  it("não repete termo (sem diferenciar maiúscula) e limita a quantidade", () => {
    expect(extrairTermos("Squad squad SQUAD")).toEqual(["Squad"]);
    const muitos = Array.from({ length: 40 }, (_, i) => `termo${i}`).join(" ");
    expect(extrairTermos(muitos)).toHaveLength(MAX_TERMOS);
  });

  it("limita o tamanho da consulta e de cada termo", () => {
    expect(extrairTermos(`${"a".repeat(512)} fim`)).toHaveLength(1); // 'fim' passa dos 512 chars e é cortado
    const gigante = extrairTermos("x".repeat(5000));
    expect(gigante).toHaveLength(1);
    expect([...gigante[0]].length).toBeLessThanOrEqual(64);
    expect(extrairTermos("palavra ".repeat(5000)).length).toBe(1);
  });

  it("ignora emoji e símbolos; aceita outros alfabetos e números", () => {
    expect(extrairTermos("😀 squad ✨")).toEqual(["squad"]);
    expect(extrairTermos("日本語 Москва 2026")).toEqual(["日本語", "Москва", "2026"]);
  });

  it("entrada que não é string vira lista vazia", () => {
    expect(extrairTermos(undefined)).toEqual([]);
    expect(extrairTermos(null)).toEqual([]);
    expect(extrairTermos(42)).toEqual([]);
    expect(extrairTermos({ toString: () => "x" })).toEqual([]);
  });
});

describe("montarMatch", () => {
  it("monta termos entre aspas, AND/OR nossos e prefixo só a partir de 4 caracteres", () => {
    expect(montarMatch(["pipeline", "MCE"], "e")).toBe('"pipeline"* AND "MCE"');
    expect(montarMatch(["squad", "RAG"], "ou")).toBe('"squad"* OR "RAG"');
    expect(montarMatch(["L0"], "e")).toBe('"L0"');
    expect(montarMatch(["governança"], "e")).toBe('"governança"*');
  });

  it("sem termos não há expressão", () => {
    expect(montarMatch([], "e")).toBeNull();
    expect(montarMatch([], "ou")).toBeNull();
  });

  it("recusa (lança) qualquer termo fora de letras/números — defesa em profundidade", () => {
    expect(() => montarMatch(['a"b'], "e")).toThrow(/fora do formato/);
    expect(() => montarMatch(["a OR b"], "e")).toThrow(/fora do formato/);
    expect(() => montarMatch(["a'b"], "e")).toThrow(/fora do formato/);
    expect(() => montarMatch(["a*"], "e")).toThrow(/fora do formato/);
  });

  it("toda saída de extrairTermos produz uma expressão válida, para entradas hostis", () => {
    const hostis = [
      `"`, `""`, `" OR 1=1 --`, `'); DROP TABLE busca; --`, "NEAR/2", "a AND NOT b", "col:val", "*", "^", "((((",
      "\u0000\u0001", "\\", "%", "texto:\"x\" OR titulo:\"y\"", "\ud800", "x".repeat(10_000),
    ];
    for (const h of hostis) {
      const termos = extrairTermos(h);
      for (const modo of ["e", "ou"] as const) {
        const expr = montarMatch(termos, modo);
        if (expr !== null) expect(expr).toMatch(/^"[^"'\s]+"\*?( (AND|OR) "[^"'\s]+"\*?)*$/u);
      }
    }
  });
});

describe("montarSnippet", () => {
  it("texto curto: só colapsa espaços e controles", () => {
    expect(montarSnippet("  a\n\n  b\tc\u0000d  ", [])).toBe("a b c d");
  });

  it("tira molduras (box drawing) e réguas, que só poluem o resumo", () => {
    expect(montarSnippet("┌──────┐ │ A Constituição │ └──────┘ ======= fim -----", [])).toBe("A Constituição fim");
  });

  it("texto longo: respeita o limite e centra no termo (sem acento, sem diferenciar maiúscula)", () => {
    const longo = `${"palavra ".repeat(200)}A Constituição manda aqui ${"outra ".repeat(200)}`;
    const s = montarSnippet(longo, ["constituicao"]);
    expect(s.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
    expect(s).toContain("Constituição");
  });

  it("o corte nunca parte um emoji ao meio (sem substituto solto)", () => {
    const solto = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    for (let folga = 0; folga < 6; folga++) {
      const longo = `${"a".repeat(SNIPPET_MAX_CHARS - 3 + folga)}😀😀😀${"b ".repeat(300)}`;
      expect(montarSnippet(longo, [])).not.toMatch(solto);
      expect(montarSnippet(`${"c ".repeat(150)}${"x".repeat(folga)}😀 alvo ${"d ".repeat(300)}`, ["alvo"])).not.toMatch(solto);
    }
  });

  it("sem termo achado: devolve o começo", () => {
    const longo = "inicio " + "xis ".repeat(400);
    expect(montarSnippet(longo, ["inexistente"]).startsWith("inicio")).toBe(true);
  });

  it("é texto puro: HTML do arquivo indexado passa intacto, sem marcador de destaque", () => {
    const s = montarSnippet("<script>alert(1)</script> squad <b>x</b>", ["squad"]);
    expect(s).toBe("<script>alert(1)</script> squad <b>x</b>");
    expect(s).not.toContain("<mark");
  });
});

/* ------------------------------------------------------------------ busca no índice */

describe.skipIf(!TEM_FTS5)("LocalSearchProvider (índice FTS5 temporário)", () => {
  it("devolve SearchHit completo, com tipo e link de livro", async () => {
    const hits = await buscar("governança");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      score: expect.any(Number),
      livroId: "docs-governanca-md",
      livroTitulo: "Governança de agentes",
      snippet: "A governança define as regras do sistema de agentes.",
      chunkId: "docs/governanca.md#0",
      tipo: "livro",
      fonteNome: "fonte-teste",
      linkLocal: "/livro/docs-governanca-md",
      linkExterno: null,
    });
  });

  it("arquivo de código/config: tipo bilhon, sem livroId, link de coleção", async () => {
    const hits = await buscar("pipeline");
    const cod = hits.find((h) => h.chunkId === "engine/pipeline/runner.py#0");
    expect(cod).toBeDefined();
    expect(cod).toMatchObject({
      tipo: "bilhon",
      livroId: null,
      linkLocal: "/colecao/codigo/engine%2Fpipeline%2Frunner.py",
      linkExterno: null,
    });
  });

  it("ignora acento e maiúscula nos dois sentidos", async () => {
    for (const consulta of ["governanca", "GOVERNANÇA", "Governança", "governança"]) {
      expect(titulos(await buscar(consulta))).toEqual(["Governança de agentes"]);
    }
    expect(titulos(await buscar("constituicao"))).toEqual(["Constituição"]);
    expect(titulos(await buscar("CONSTITUIÇÃO"))).toEqual(["Constituição"]);
  });

  it("prefixo: 'squad' acha 'squads'", async () => {
    const hits = await buscar("squad", 50);
    expect(titulos(hits)).toContain("Pluralização");
  });

  it("palavra curta (<4) é exata: 'alp' não casa 'alpha', mas 'alpha' casa", async () => {
    expect(await buscar("alp")).toEqual([]);
    expect((await buscar("alpha")).length).toBeGreaterThan(0);
  });

  it("título pesa mais que repetição no corpo", async () => {
    const hits = await buscar("alpha");
    const ordem = titulos(hits);
    expect(ordem.indexOf("Alpha Guia")).toBeGreaterThanOrEqual(0);
    expect(ordem.indexOf("Relatório geral")).toBeGreaterThanOrEqual(0);
    expect(ordem.indexOf("Alpha Guia")).toBeLessThan(ordem.indexOf("Relatório geral"));
  });

  it("AND: com todos os termos presentes em algum trecho, só vêm os que têm todos", async () => {
    expect(titulos(await buscar("alpha beta"))).toEqual(["Alpha e Beta juntos"]);
  });

  it("AND sem resultado cai para OR (e quem casa mais termos fica à frente)", async () => {
    const hits = await buscar("alpha zzzinexistente");
    expect(hits.length).toBeGreaterThan(0);
    expect(titulos(hits)).toContain("Alpha Guia");
    // nenhum termo casa: nada
    expect(await buscar("zzzinexistente yyyinexistente")).toEqual([]);
  });

  it("topK é respeitado e cada arquivo contribui com no máximo 3 trechos", async () => {
    const todos = await buscar("squad", 50);
    const porDoc = new Map<string, number>();
    for (const h of todos) porDoc.set(h.livroTitulo, (porDoc.get(h.livroTitulo) ?? 0) + 1);
    expect(Math.max(...porDoc.values())).toBeLessThanOrEqual(MAX_TRECHOS_POR_DOC);
    expect(porDoc.get("Squad base")).toBe(MAX_TRECHOS_POR_DOC);

    for (const k of [1, 3, 5]) expect((await buscar("squad", k)).length).toBeLessThanOrEqual(k);
    expect(await buscar("squad", 0)).toEqual([]);
    expect(await buscar("squad", -3)).toEqual([]);
    expect((await buscar("squad", 5000)).length).toBeLessThanOrEqual(50);
    expect((await buscar("squad", Number.NaN)).length).toBeGreaterThan(0);
  });

  it("score entre 0 e 1, sem passar de raw/(raw+K), em ordem não crescente e sem repetir trecho", async () => {
    const hits = await buscar("squad", 50);
    expect(hits.length).toBeGreaterThan(3);
    for (const h of hits) {
      expect(h.score).toBeGreaterThanOrEqual(0);
      expect(h.score).toBeLessThan(1);
    }
    for (let i = 1; i < hits.length; i++) expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
    expect(new Set(hits.map((h) => h.chunkId)).size).toBe(hits.length);
    expect(K_SCORE).toBeGreaterThan(0);
  });

  it("ordenação estável: a mesma consulta devolve exatamente a mesma lista", async () => {
    const a = await buscar("squad agentes sistema", 50);
    const b = await buscar("squad agentes sistema", 50);
    expect(b).toEqual(a);
  });

  it("consulta vazia, só pontuação ou só emoji: lista vazia, sem tocar no índice", async () => {
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", path.join(tmp, "nao-existe.sqlite"));
    const p = new LocalSearchProvider();
    for (const consulta of ["", "   ", "!!!", "\"\"", "--", "😀", "***"]) {
      expect(await p.search(consulta)).toEqual([]);
    }
  });

  it("operadores FTS5 viram palavras comuns, não operadores", async () => {
    // 'near' e 'not' existem no texto como palavras
    expect(titulos(await buscar("near"))).toEqual(["Operadores"]);
    expect(titulos(await buscar("NEAR"))).toEqual(["Operadores"]);
    expect(titulos(await buscar("not"))).toEqual(["Operadores"]);
    // "gamma OR delta": 'or' é palavra funcional e sai; sobra gamma AND delta, ambos no mesmo trecho
    expect(titulos(await buscar("gamma OR delta"))).toEqual(["Operadores"]);
    // NOT não exclui nada: 'gamma NOT delta' vira gamma AND not AND delta
    expect(titulos(await buscar("gamma NOT delta"))).toEqual(["Operadores"]);
    // NEAR(...) não vira consulta de proximidade
    expect(titulos(await buscar("NEAR(gamma delta)"))).toEqual(["Operadores"]);
  });

  it("filtro de coluna e curinga do FTS5 não funcionam: viram palavras", async () => {
    // 'titulo:gamma' seria um filtro de coluna; aqui vira "titulo" AND "gamma" (zero) -> OR -> gamma
    expect(titulos(await buscar("titulo:gamma"))).toEqual(["Operadores"]);
    // "*" sozinho não é "casa tudo"
    expect(await buscar("*")).toEqual([]);
    // "^gamma" (início de coluna) é só gamma
    expect(titulos(await buscar("^gamma"))).toEqual(["Operadores"]);
  });

  it("tentativas de injeção não alteram o índice, não lançam e não vazam linhas fora da consulta", async () => {
    const antes = createHash("sha256").update(readFileSync(indice)).digest("hex");
    const ataques = [
      `'; DROP TABLE busca; --`,
      `x' OR '1'='1`,
      `" OR 1=1 --`,
      `alpha" OR "beta`,
      `alpha'); DELETE FROM busca; --`,
      `\\' ; ATTACH DATABASE 'x' AS y; --`,
      `%' UNION SELECT * FROM meta --`,
      `"; .shell calc`,
      `.open /etc/passwd`,
      `.system whoami`,
      `\u0000'; --`,
      "alpha`whoami`",
      "$(whoami)",
      "alpha\nSELECT 1;",
    ];
    for (const a of ataques) {
      const hits = await buscar(a);
      expect(Array.isArray(hits)).toBe(true);
      // só pode devolver linhas do próprio índice de teste
      for (const h of hits) expect(CORPUS.map((d) => d.titulo)).toContain(h.livroTitulo);
    }
    // o arquivo continua byte a byte igual (e ainda busca normalmente)
    expect(createHash("sha256").update(readFileSync(indice)).digest("hex")).toBe(antes);
    expect(titulos(await buscar("governança"))).toEqual(["Governança de agentes"]);
    // nenhuma "linha de meta" saiu como hit
    expect((await buscar("%' UNION SELECT * FROM meta --")).every((h) => h.chunkId.includes("#"))).toBe(true);
  });

  it("'x' OR '1'='1 não devolve o corpus inteiro", async () => {
    // vira "x" AND "1": só o trecho HTML (src=x ... alert(1)) tem as duas palavras
    const hits = await buscar("x' OR '1'='1", 50);
    expect(titulos(hits)).toEqual(["HTML cru"]);
  });

  it("consulta enorme não quebra", async () => {
    const hits = await buscar(`governança ${"lixo ".repeat(20_000)}`);
    expect(Array.isArray(hits)).toBe(true);
  });

  it("snippet é texto puro: HTML do arquivo indexado sai como texto, sem marcador", async () => {
    const hits = await buscar("xssmarker");
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain("<script>alert('x')</script>");
    expect(hits[0].snippet).not.toMatch(/<mark|<\/mark/i);
    expect(hits[0].snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
  });

  it("acentos do índice sobrevivem ao JSON da CLI (UTF-8 íntegro)", async () => {
    const [h] = await buscar("constituicao");
    expect(h.snippet).toBe("Todos os agentes obedecem à Constituição do sistema.");
  });
});

/* ------------------------------------------------------------------ erros */

describe.skipIf(!TEM_FTS5)("erros do backend", () => {
  it("índice ausente: ProviderSearchError(backend) com ação em PT-BR", async () => {
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", path.join(tmp, "nunca-existiu.sqlite"));
    const erro = await new LocalSearchProvider().search("squad").catch((e) => e);
    expect(erro).toBeInstanceOf(ProviderSearchError);
    expect((erro as ProviderSearchError).code).toBe("backend");
    expect((erro as Error).message).toMatch(/npm run populate/);
  });

  it("arquivo que não é sqlite: ProviderSearchError(backend), sem vazar o caminho", async () => {
    const lixo = path.join(tmp, "lixo.sqlite");
    writeFileSync(lixo, "isto nao e um banco de dados sqlite, e sim texto qualquer".repeat(40));
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", lixo);
    const erro = await new LocalSearchProvider().search("squad").catch((e) => e);
    expect(erro).toBeInstanceOf(ProviderSearchError);
    expect((erro as ProviderSearchError).code).toBe("backend");
    expect((erro as Error).message).not.toContain(tmp);
  });

  it("sqlite3 fora do PATH: ProviderSearchError(backend) acionável", async () => {
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", indice);
    // no Windows a variável é "Path", mas process.env é case-insensitive: um único stub basta
    // (stubar "PATH" e "Path" juntos faria o unstub restaurar o segundo valor, já vazio)
    vi.stubEnv("PATH", "");
    const erro = await new LocalSearchProvider().search("squad").catch((e) => e);
    expect(erro).toBeInstanceOf(ProviderSearchError);
    expect((erro as ProviderSearchError).code).toBe("backend");
    expect((erro as Error).message).toMatch(/sqlite3/);
  });
});

/* ------------------------------------------------------------------ status */

describe.skipIf(!TEM_FTS5)("diagnosticoIndiceLocal", () => {
  it("índice ausente: não configurado, com a ação 'npm run populate'", async () => {
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", path.join(tmp, "ainda-nao.sqlite"));
    const d = await diagnosticoIndiceLocal();
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toMatch(/npm run populate/);
  });

  it("índice vazio (0 trechos): não configurado", async () => {
    const vazio = path.join(tmp, "vazio.sqlite");
    criarIndice(vazio, []);
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", vazio);
    const d = await diagnosticoIndiceLocal();
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toMatch(/vazio/);
  });

  it("esquema de outra versão: não configurado, mandando repopular", async () => {
    const velho = path.join(tmp, "velho.sqlite");
    criarIndice(velho, CORPUS, "0");
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", velho);
    const d = await diagnosticoIndiceLocal();
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toMatch(/esquema "0".*npm run populate/);
  });

  it("arquivo ilegível: não configurado, sem lançar", async () => {
    const lixo = path.join(tmp, "lixo2.sqlite");
    writeFileSync(lixo, "nao sou sqlite ".repeat(100));
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", lixo);
    const d = await diagnosticoIndiceLocal();
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toMatch(/npm run populate/);
  });

  it("índice válido: configurado, com contagens; acompanha a troca do arquivo", async () => {
    const vivo = path.join(tmp, "vivo.sqlite");
    criarIndice(vivo, CORPUS.slice(0, 2));
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", vivo);
    const a = await diagnosticoIndiceLocal();
    expect(a).toEqual({ ok: true, trechos: 2, arquivos: 2 });

    rmSync(vivo);
    criarIndice(vivo, CORPUS);
    const b = await diagnosticoIndiceLocal();
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.arquivos).toBe(CORPUS.length);
      expect(b.trechos).toBeGreaterThan(2);
    }
  });

  it("BILHON_LOCAL_SEARCH_DB em branco vale como ausente (cai no padrão data/search)", async () => {
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", "   ");
    const { caminhoIndiceLocal } = await import("./search");
    expect(caminhoIndiceLocal()).toBe(path.resolve(process.cwd(), "data", "search", "index.sqlite"));
  });
});
