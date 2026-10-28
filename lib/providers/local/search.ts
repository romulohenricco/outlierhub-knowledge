/**
 * Busca LOCAL e lexical sobre o índice FTS5 que `npm run populate` gera em
 * data/search/index.sqlite (módulo scripts/populate/busca.mjs). Sem rede, sem
 * Supabase, sem Ollama, sem embeddings: casa palavras (sem acento, sem
 * diferença de maiúsculas) e ranqueia com bm25. Contrato do índice e limites
 * em docs/provider-local.md.
 *
 * Segurança (o texto do usuário NUNCA vira SQL nem sintaxe FTS5):
 *  1. `extrairTermos` reduz a consulta a tokens de letras/números Unicode —
 *     aspas, operadores (AND/OR/NOT/NEAR), `col:`, `^`, `*`, parênteses, `;`,
 *     `--` e qualquer outra pontuação viram separador e somem;
 *  2. `montarMatch` monta a expressão MATCH só com `"termo"` entre aspas
 *     duplas (e `*` de prefixo), unidos por AND/OR escritos por nós, e confere
 *     o resultado com uma regex estrita antes de usá-lo;
 *  3. a expressão entra no SQL como UM literal entre aspas simples (sem
 *     aspas simples possíveis dentro dela); limites são inteiros fixados aqui;
 *  4. o `sqlite3` roda via `execFile` (sem shell) e com `-readonly`.
 *
 * Score (0..1), documentado porque a UI mostra como porcentagem:
 *   raw   = -bm25(busca, 10, 2, 1)       (>= 0; mais alto = mais relevante;
 *                                         pesos: título 10, caminho 2, texto 1)
 *   score = raw / (raw_max + K)          K = 4; raw_max = melhor candidato
 * O melhor hit tem score = raw_max/(raw_max+K): perto de 1 quando a consulta tem
 * termos raros e fortes, baixo quando só casa palavras comuns — uma confiança
 * absoluta, não "100% sempre". Os demais ficam em proporção ao melhor, e a
 * ordem do bm25 é preservada.
 *
 * O snippet é TEXTO PURO (sem marcação de destaque): `components/Busca.tsx` o
 * renderiza como nó de texto do React (`…{h.snippet}…`), que escapa tudo — mesmo
 * um arquivo indexado cheio de `<script>` aparece como texto. Por isso nenhum
 * HTML é montado aqui e nenhum marcador `<mark>` é inserido.
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { SearchHit } from "@/lib/types";
import type { SemanticSearchProvider } from "../types";
import { ProviderSearchError } from "../types";

const exec = promisify(execFile);

/** Tem que bater com VERSAO_ESQUEMA de scripts/populate/busca.mjs. */
export const VERSAO_ESQUEMA_ESPERADA = "1";

export const TOPK_PADRAO = 18;
export const TOPK_MAX = 50;
/** Os 3 primeiros trechos de cada arquivo são os que a UI mostra por grupo; mais que isso só ocupa vaga. */
export const MAX_TRECHOS_POR_DOC = 3;
export const LIMITE_CONSULTA_CHARS = 512;
export const MAX_TERMOS = 12;
export const MAX_TAMANHO_TERMO = 64;
/** Termo com este tamanho (em caracteres) ou mais casa também por prefixo: "squad" acha "squads", "agent" acha "agentes". */
export const PREFIXO_MIN = 4;
export const PESOS_BM25 = { titulo: 10, caminho: 2, texto: 1 } as const;
export const K_SCORE = 4;
export const SNIPPET_MAX_CHARS = 400;

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 16 * 1024 * 1024;

/** Palavras funcionais PT/EN: só saem da consulta se sobrar ao menos um termo de conteúdo. */
const PALAVRAS_FUNCIONAIS = new Set(
  (
    "a o as os um uma uns umas de do da dos das em no na nos nas e é ou que para por com como se ao aos à às " +
    "ser foi são qual quais sobre entre mais meu minha " +
    "the an of to in on at and or is are was be for with how what which about by from as it this that do does"
  ).split(" "),
);

export type ModoMatch = "e" | "ou";

/* ------------------------------------------------------------------ sanitização */

/**
 * Consulta livre -> lista de termos seguros (letras/números Unicode, NFC).
 * Nunca lança; texto sem nenhum termo devolve [].
 */
export function extrairTermos(consulta: unknown): string[] {
  if (typeof consulta !== "string") return [];
  const bruto = consulta.slice(0, LIMITE_CONSULTA_CHARS).normalize("NFC");
  const tokens = (bruto.match(/[\p{L}\p{N}]+/gu) ?? []).map((t) => [...t].slice(0, MAX_TAMANHO_TERMO).join(""));
  const vistos = new Set<string>();
  const unicos: string[] = [];
  for (const t of tokens) {
    const k = t.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    unicos.push(t);
  }
  const deConteudo = unicos.filter((t) => !PALAVRAS_FUNCIONAIS.has(t.toLowerCase()));
  return (deConteudo.length > 0 ? deConteudo : unicos).slice(0, MAX_TERMOS);
}

const EXPRESSAO_VALIDA = /^"[\p{L}\p{N}]+"\*?(?: (?:AND|OR) "[\p{L}\p{N}]+"\*?)*$/u;

/**
 * Termos já sanitizados -> expressão MATCH do FTS5. `null` quando não há termos.
 * Lança se (por bug) o resultado fugir do formato estrito — nunca chega ao SQL.
 */
export function montarMatch(termos: string[], modo: ModoMatch): string | null {
  if (termos.length === 0) return null;
  const partes = termos.map((t) => {
    const frase = `"${t.replaceAll('"', '""')}"`;
    return [...t].length >= PREFIXO_MIN ? `${frase}*` : frase;
  });
  const expr = partes.join(modo === "e" ? " AND " : " OR ");
  if (!EXPRESSAO_VALIDA.test(expr)) throw new Error("expressão MATCH fora do formato esperado");
  return expr;
}

/* ------------------------------------------------------------------ snippet */

/** Minúsculas e sem acento, caractere a caractere, guardando o deslocamento no texto original. */
function dobrarComMapa(texto: string): { dobrado: string; mapa: number[] } {
  let dobrado = "";
  const mapa: number[] = [];
  let i = 0;
  for (const ch of texto) {
    const f = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < f.length; k++) mapa.push(i);
    dobrado += f;
    i += ch.length;
  }
  return { dobrado, mapa };
}

function dobrar(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Trecho em texto puro: espaços colapsados, sem caracteres de controle, no máximo
 * SNIPPET_MAX_CHARS, centrado na primeira ocorrência de um termo quando há.
 */
export function montarSnippet(bruto: string, termos: string[]): string {
  const limpo = bruto
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[─-▟]+/g, " ") // molduras e ASCII-art (box drawing, blocos)
    .replace(/([-=_*~#.+])\1{3,}/g, " ") // réguas: ----, ====, ____, ****
    .replace(/\s+/g, " ")
    .trim();
  if (limpo.length <= SNIPPET_MAX_CHARS) return limpo;

  const { dobrado, mapa } = dobrarComMapa(limpo);
  let achado = -1;
  for (const t of termos) {
    const pos = dobrado.indexOf(dobrar(t));
    if (pos >= 0 && (achado < 0 || pos < achado)) achado = pos;
  }
  let ini = achado >= 0 ? Math.max(0, (mapa[achado] ?? 0) - 100) : 0;
  if (ini > 0) {
    const espaco = limpo.indexOf(" ", ini);
    if (espaco >= 0 && espaco - ini < 40) ini = espaco + 1;
  }
  let fim = Math.min(limpo.length, ini + SNIPPET_MAX_CHARS);
  if (fim < limpo.length) {
    const espaco = limpo.lastIndexOf(" ", fim);
    if (espaco > ini + SNIPPET_MAX_CHARS / 2) fim = espaco;
  }
  // o corte não pode partir um par substituto (emoji): sairia uma metade solta no JSON
  if (/[\udc00-\udfff]/.test(limpo.charAt(ini)) && ini > 0) ini++;
  if (/[\ud800-\udbff]/.test(limpo.charAt(fim - 1)) && fim < limpo.length) fim--;
  return limpo.slice(ini, fim).trim();
}

/* ------------------------------------------------------------------ sqlite3 */

/** Caminho do índice, lido a cada uso (testes e `.env.local` podem trocá-lo). */
export function caminhoIndiceLocal(): string {
  const env = process.env.BILHON_LOCAL_SEARCH_DB;
  return path.resolve(env && env.trim() !== "" ? env.trim() : path.join(process.cwd(), "data", "search", "index.sqlite"));
}

function traduzirErro(e: unknown, db: string): ProviderSearchError {
  const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean; signal?: string | null };
  if (err?.code === "ENOENT") {
    return new ProviderSearchError(
      "backend",
      "CLI sqlite3 não encontrada no PATH — instale o SQLite (3.35 ou superior, com FTS5) para usar o provider local.",
    );
  }
  if (err?.killed || err?.signal === "SIGTERM") {
    return new ProviderSearchError("backend", "A consulta ao índice local excedeu o tempo limite.");
  }
  const stderr = String(err?.stderr ?? err?.message ?? "").split("\n").find((l) => l.trim()) ?? "erro desconhecido";
  const limpo = stderr.split(db).join("<índice>").replace(/\s+/g, " ").trim().slice(0, 200);
  if (/no such (table|module|column)|file is not a database|malformed/i.test(limpo)) {
    return new ProviderSearchError(
      "backend",
      `Índice local de busca ilegível ou de versão incompatível (${limpo}) — rode \`npm run populate\` para reconstruí-lo.`,
    );
  }
  return new ProviderSearchError("backend", `Falha ao consultar o índice local (sqlite3): ${limpo}`);
}

async function consultar(db: string, sql: string): Promise<Record<string, unknown>[]> {
  try {
    const { stdout } = await exec("sqlite3", ["-readonly", "-json", db, sql], {
      maxBuffer: MAX_BUFFER,
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
    return stdout.trim() ? (JSON.parse(stdout) as Record<string, unknown>[]) : [];
  } catch (e) {
    throw traduzirErro(e, db);
  }
}

/* ------------------------------------------------------------------ diagnóstico (status) */

export type DiagnosticoIndice =
  | { ok: true; trechos: number; arquivos: number }
  | { ok: false; motivo: string };

const ACAO = "Rode `npm run populate` (confirme a população) para gerar o índice.";

let cacheDiagnostico: { chave: string; valor: DiagnosticoIndice } | null = null;

/**
 * O layout chama `status()` a cada página: só consulta o sqlite quando o arquivo
 * muda (mtime + tamanho). Falhas transitórias (sqlite3 ausente) não são cacheadas.
 */
export async function diagnosticoIndiceLocal(): Promise<DiagnosticoIndice> {
  const db = caminhoIndiceLocal();
  let st;
  try {
    st = await stat(db);
  } catch {
    return { ok: false, motivo: `Índice de busca local não encontrado em ${path.relative(process.cwd(), db) || db}. ${ACAO}` };
  }
  if (!st.isFile()) return { ok: false, motivo: `BILHON_LOCAL_SEARCH_DB não aponta para um arquivo. ${ACAO}` };

  const chave = `${db}|${st.mtimeMs}|${st.size}`;
  if (cacheDiagnostico?.chave === chave) return cacheDiagnostico.valor;

  let valor: DiagnosticoIndice;
  try {
    const [r] = await consultar(
      db,
      "SELECT (SELECT value FROM meta WHERE key = 'schema_version') AS versao, " +
        "(SELECT count(*) FROM busca) AS trechos, " +
        "(SELECT count(DISTINCT doc_rel) FROM busca) AS arquivos;",
    );
    const versao = String(r?.versao ?? "");
    const trechos = Number(r?.trechos ?? 0);
    const arquivos = Number(r?.arquivos ?? 0);
    if (versao !== VERSAO_ESQUEMA_ESPERADA) {
      valor = {
        ok: false,
        motivo: `Índice de busca local com esquema "${versao || "?"}" (esperado "${VERSAO_ESQUEMA_ESPERADA}"). ${ACAO}`,
      };
    } else if (!(trechos > 0)) {
      valor = { ok: false, motivo: `Índice de busca local vazio (0 trechos). ${ACAO}` };
    } else {
      valor = { ok: true, trechos, arquivos };
    }
  } catch (e) {
    if (e instanceof ProviderSearchError && /sqlite3 não encontrada|tempo limite/.test(e.message)) {
      return { ok: false, motivo: e.message };
    }
    const detalhe = e instanceof Error ? e.message : String(e);
    valor = { ok: false, motivo: detalhe.includes("npm run populate") ? detalhe : `${detalhe} ${ACAO}` };
  }
  cacheDiagnostico = { chave, valor };
  return valor;
}

/* ------------------------------------------------------------------ busca */

type LinhaBusca = {
  rk: number;
  tipo: string;
  livroId: string | null;
  livroTitulo: string;
  fonteNome: string;
  chunkId: string;
  linkLocal: string;
  docRel: string;
  trecho: string | null;
};

function sqlDeBusca(expr: string, limite: number): string {
  const lit = expr.replaceAll("'", "''");
  const w = PESOS_BM25;
  const bm25 = `bm25(busca, ${w.titulo}, ${w.caminho}, ${w.texto})`;
  return (
    `SELECT ${bm25} AS rk, tipo, livro_id AS livroId, livro_titulo AS livroTitulo, ` +
    `fonte_nome AS fonteNome, chunk_id AS chunkId, link_local AS linkLocal, doc_rel AS docRel, ` +
    `snippet(busca, 2, '', '', '', 64) AS trecho ` +
    `FROM busca WHERE busca MATCH '${lit}' ORDER BY ${bm25}, rowid LIMIT ${limite};`
  );
}

function normalizarTopK(topK: unknown): number {
  const n = typeof topK === "number" && Number.isFinite(topK) ? Math.floor(topK) : TOPK_PADRAO;
  return Math.min(n, TOPK_MAX);
}

const TIPOS_VALIDOS = new Set<SearchHit["tipo"]>(["livro", "canal", "clickup", "cursos", "bilhon"]);

export class LocalSearchProvider implements SemanticSearchProvider {
  async search(query: string, topK: number = TOPK_PADRAO): Promise<SearchHit[]> {
    const k = normalizarTopK(topK);
    if (k < 1) return [];
    const termos = extrairTermos(query);
    if (termos.length === 0) return [];

    const db = caminhoIndiceLocal();
    try {
      await stat(db);
    } catch {
      throw new ProviderSearchError(
        "backend",
        `Índice de busca local não encontrado — rode \`npm run populate\` (ou aponte BILHON_LOCAL_SEARCH_DB para um índice existente).`,
      );
    }

    const candidatos = Math.min(Math.max(k * 8, 60), 400);
    let linhas = (await consultar(db, sqlDeBusca(montarMatch(termos, "e")!, candidatos))) as unknown as LinhaBusca[];
    // AND não achou nada: afrouxa para OR (bm25 ainda põe quem casa mais termos no topo)
    if (linhas.length === 0 && termos.length > 1) {
      linhas = (await consultar(db, sqlDeBusca(montarMatch(termos, "ou")!, candidatos))) as unknown as LinhaBusca[];
    }
    if (linhas.length === 0) return [];

    const bruto = (l: LinhaBusca) => Math.max(0, -Number(l.rk));
    const melhor = bruto(linhas[0]);
    const porDoc = new Map<string, number>();
    const hits: SearchHit[] = [];
    for (const l of linhas) {
      const n = porDoc.get(l.docRel) ?? 0;
      if (n >= MAX_TRECHOS_POR_DOC) continue;
      porDoc.set(l.docRel, n + 1);
      hits.push({
        score: Math.round((bruto(l) / (melhor + K_SCORE)) * 1000) / 1000,
        livroId: l.livroId ?? null,
        livroTitulo: l.livroTitulo,
        snippet: montarSnippet(l.trecho ?? "", termos),
        chunkId: l.chunkId,
        tipo: TIPOS_VALIDOS.has(l.tipo as SearchHit["tipo"]) ? (l.tipo as SearchHit["tipo"]) : "bilhon",
        fonteNome: l.fonteNome,
        linkLocal: l.linkLocal,
        linkExterno: null,
      });
      if (hits.length >= k) break;
    }
    return hits;
  }
}
