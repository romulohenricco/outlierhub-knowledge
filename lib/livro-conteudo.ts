/**
 * Conteúdo INGERIDO de cada livro, pra estante e pra página do livro — o que o
 * pipeline já extraiu e só não aparecia: registro editorial (niveis.json, com a
 * justificativa do LLM), conceitos e trechos do grafo (livros-kg.sqlite), e o
 * próprio texto do arquivo (abertura + sumário declarado).
 *
 * Read-only, local. Fonte ausente = campo vazio, nunca erro na página.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getBooks, getBooksFisico, resolveFilePath } from "./catalog";
import { KG_DB } from "./kg";
import { cortaTexto } from "./texto";
import type { Livro, LivroDetalhe, Vizinho } from "./types";

const exec = promisify(execFile);

const NIVEIS_JSON =
  process.env.BILHON_NIVEIS || path.join(process.cwd(), "data", "livros", "niveis.json");

// Sinopses geradas por um modelo local (scripts/gerar-sinopses.mjs). Por padrão o sidecar
// fica ao lado do niveis.json já resolvido, então não exige variável nova.
const SINOPSES_JSON =
  process.env.BILHON_LIVROS_SINOPSES || path.join(path.dirname(NIVEIS_JSON), "livros-sinopses.json");

export const NOME_NIVEL: Record<string, string> = {
  "referencia-academica": "referência/acadêmico",
  profissional: "profissional (trade book)",
  "pratico-mercado": "prático/mercado",
};

/** O que o card da estante mostra além do catálogo. */
export type ResumoLivro = {
  nivel: string | null;
  nivelNome: string | null;
  /** sinopse do modelo local; sem ela, a justificativa do classificador */
  sinopse: string | null;
  /** de onde veio a sinopse — a página do livro diz isso na legenda */
  sinopseFonte: "llm-local" | "classificador" | null;
  conceitos: string[];
};

export type Trecho = { texto: string; conceito: string; pagina: number | null; chunk: number };

export type ConteudoLivro = ResumoLivro & {
  trechos: Trecho[];
  abertura: string | null;
  sumario: string[];
};

/* ───────────────────────── funções puras ───────────────────────── */

/** O catálogo indexa PDF e TXT do mesmo livro como 2 docs — na tela é 1 só. */
export function dedupeVizinhos(vizinhos: Vizinho[]): Vizinho[] {
  const vistos = new Set<string>();
  return vizinhos.filter((v) => {
    const k = v.titulo.trim().toLowerCase();
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

// ficha técnica, créditos e avisos legais — não são o conteúdo do livro
const NAO_E_PROSA =
  /copyright|©|isbn|direitos reservados|all rights reserved|www\.|https?:|dados internacionais|catalogação|recurso eletrônico|e-book|ebook|hiperlink|editora|publicad[oa] (em|por)|traduzido|tradução|impresso no|printed in|reprodução proibida|lei 9\.610|\b\d\. ed\.|\b1\. .{3,60}\. 2\. /i;

// abertura do corpo do livro: a ÚLTIMA ocorrência vence, porque a primeira é a
// linha do sumário e a segunda é o capítulo de verdade
const INICIO_DO_CORPO =
  /^(pref[áa]cio|introdu[çc][ãa]o|pr[óo]logo|apresenta[çc][ãa]o|preface|introduction|foreword|prologue)$/i;

/** O modelo local vence o classificador: a sinopse descreve o livro, a justificativa descreve o registro. */
export function escolheSinopse(
  llm: { sinopse?: string } | undefined,
  nivel: { justificativa?: string } | undefined,
): { sinopse: string | null; fonte: ResumoLivro["sinopseFonte"] } {
  const doLlm = llm?.sinopse?.trim();
  if (doLlm) return { sinopse: doLlm, fonte: "llm-local" };
  const doNivel = nivel?.justificativa?.trim();
  if (doNivel) return { sinopse: doNivel, fonte: "classificador" };
  return { sinopse: null, fonte: null };
}

/*
 * Ligadura "fi"/"fl" perdida: nos PDFs de origem o extrator trocou o glifo por um espaço
 * ("arti cial", "signi ca", "o uxo") — o dano já está GRAVADO nos .txt do acervo, então
 * nenhuma opção do pdftotext resolve. O reparo é conservador, em 3 regras:
 *  1. radical que não existe sozinho ("arti", "signi", "especí"…) + resto → cola com "fi";
 *  2. fragmento que não é palavra sozinho ("nal", "nanceiros", "ca", "uxo"…) → prefixa "fi"/"fl";
 *  3. "de"/"in"/"re"/"con" só colam quando o resto é fragmento inequívoco ("de nição", "in uência").
 * "de nada", "no caso", "a ação", "rei cruel" ficam como estão.
 */
const RADICAIS_LONGOS =
  "arti|signi|especí|especi|cientí|identi|modi|ampli|catastró|veri|justi|demográ|infográ|rami|classi|intensi|codi|bené|simpli|noti|certi|exempli|sacri|falsi|quali";
const RADICAIS_CURTOS = "su|grá|uni|di|rei|gami";
// radical que também é palavra/raiz curta: só cola com fragmento específico
const RESTO_RESTRITO: Record<string, RegExp> = {
  gami: /^(cação|cações|cado|cados|cada|cadas|car)$/,
  rei: /^(cação|cações|cado|cada|cados|cadas)$/,
  uni: /^(car|cado|cados|cação|cada|cadas)$/,
  di: /^(cil|ceis|culdade|culdades|cilmente|cultar)$/,
  su: /^(ciente|cientes|cientemente|ciência)$/,
  grá: /^(co|cos|ca|cas)$/,
};
const RESTO_FI = /^[a-zà-ú]/i;
const FRAG_FI_INICIAL =
  /^(nal|nais|nalmente|nalidade|nalizar|nalizado|nalizou|nalistas?|nanc[a-zà-ú]*|ca|cam|cou|cando|car|cará|caram|caria|cado|cados)$/;
const FRAG_FI_DEF = /^(ni[çc][ãõ][a-zà-ú]*|nid[a-zà-ú]*|nir|nit[a-zà-ú]*)$/; // após "de" (definição) / "in" (infinito)
const FRAG_FL = /^(u(?:xo|xos|[êe]ncia|[êe]ncias|enc[a-zà-ú]+|ent[a-zà-ú]+)|ex(?:o|os|ão|ões|ível|íveis|ionar)|et(?:ir|e|em|indo|iu|ido|ida|idos|idas)|ito|itos)$/;

// sinais INEQUÍVOCOS do defeito: radical que não é palavra + resto ("arti cial"), "de nição", "in uência", "o cial"
const SINAL_LIGADURA = new RegExp(
  `(?<![a-zà-ú])(?:[a-zà-ú]*(?:${RADICAIS_LONGOS}) [cn][a-zà-ú]+|de ni[çc][ãõ][a-zà-ú]*|de nid[a-zà-ú]*|in u[êe]nc[a-zà-ú]*|in nit[a-zà-ú]*|o ciais?|e ci[êe]nci[a-zà-ú]*)(?![a-zà-ú])`,
  "gi",
);

/** O texto tem a assinatura da ligadura perdida? Exige ≥ 2 sinais, senão "car"/"can" de um livro em inglês seria "reparado". */
export function temLigaduraPerdida(texto: string): boolean {
  return (texto.match(SINAL_LIGADURA)?.length ?? 0) >= 2;
}

export function repararLigaduras(texto: string): string {
  if (!temLigaduraPerdida(texto)) return texto; // sem a assinatura do defeito, as regras de fragmento solto estragariam texto bom
  // radical longo aceita prefixo colado ("automodi ca"); os curtos (su, di, uni, rei…) só como palavra inteira
  const radicais = new RegExp(`(?<![a-zà-ú])((?:[a-zà-ú]*(?:${RADICAIS_LONGOS}))|(?:${RADICAIS_CURTOS})) ([a-zà-ú]+)(?![a-zà-ú])`, "gi");
  return texto
    .replace(/(?<![a-zà-ú])o (cial|ciais)(?![a-zà-ú])/g, "ofi$1") // "o cial" → "oficial"
    .replace(radicais, (m, rad: string, resto: string) => {
      const restrito = RESTO_RESTRITO[rad.toLowerCase()];
      if (restrito ? !restrito.test(resto.toLowerCase()) : !RESTO_FI.test(resto)) return m;
      return `${rad}fi${resto}`;
    })
    // "de nição" / "in nito" / "in uência" / "con ito" / "re exo": prefixo + fragmento
    .replace(/\b(de|in|re|con) ([a-zà-ú]+)(?![a-zà-ú])/gi, (m, pre: string, resto: string) => {
      if (pre.slice(1) !== pre.slice(1).toLowerCase()) return m; // sigla ("IN") não é prefixo; "In" de início de frase é
      const p = pre.toLowerCase();
      const r = resto.toLowerCase();
      if ((p === "de" || p === "in") && FRAG_FI_DEF.test(resto)) return `${pre}fi${resto}`;
      if (p !== "de" && FRAG_FL.test(r)) return `${pre}fl${resto}`;
      if (p === "in" && /^(ação|ações|acionar)$/.test(r)) return `${pre}fl${resto}`;
      return m;
    })
    // fragmento solto no começo de palavra ("no nal", "que ca", "o uxo")
    // (só depois de espaço/aspas: dentro de URL ou palavra hifenizada "-ca" não é ligadura)
    .replace(/(^|[\s“"(])([a-zà-ú]+)(?![a-zà-ú])/gi, (m, sep: string, w: string) => {
      if (w !== w.toLowerCase()) return m; // "CA" (sigla) não é "fica"
      const l = w;
      if (FRAG_FI_INICIAL.test(l)) return `${sep}fi${w}`;
      if (/^u(?:xo|xos|[êe]ncia|enc[a-zà-ú]+)$/.test(l)) return `${sep}fl${w}`;
      return m;
    });
}

/** Primeiro(s) parágrafo(s) de prosa do texto, ou null se não houver. */
export function aberturaDoTexto(texto: string, max = 900): string | null {
  const linhas = texto
    .replace(/\r\n/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .split("\n");
  let ini = 0;
  linhas.forEach((l, i) => {
    if (INICIO_DO_CORPO.test(l.trim())) ini = i + 1;
  });
  const prosaDesde = (i: number) =>
    linhas
      .slice(i)
      .join("\n")
      .split(/\n\s*\n/)
      .map((p) =>
        p
          .replace(/\*\*|__/g, "") // negrito de markdown
          .replace(/(^|\n)\s*([*#>-]+)\s+/g, "$1") // bullet/heading/quote no começo da linha
          .replace(/\s+/g, " ")
          .trim(),
      )
      // o filtro olha só os 200 primeiros chars: parágrafo longo com um link no meio ainda é prosa
      .filter((p) => p.length >= 160 && !NAO_E_PROSA.test(p.slice(0, 200)) && /[a-zà-ú]{3,}/.test(p));
  // cabeçalho achado mas sem prosa depois (corte das páginas extraídas) → volta pro começo
  const desdeCabecalho = prosaDesde(ini);
  const paragrafos = desdeCabecalho.length ? desdeCabecalho : prosaDesde(0);
  if (!paragrafos.length) return null;
  const junto = paragrafos.slice(0, 2).join("\n\n");
  const corte = cortaTexto(junto, max);
  return corte.length < junto.length ? `${corte.trimEnd()}…` : corte;
}

const CABECALHO_SUMARIO = /^(sumário|sumario|índice|indice|conteúdo|conteudo|contents|table of contents)$/i;

// título de índice que termina nelas (ou continua com elas) está quebrado em 2 linhas
const LIGACAO = "a|o|as|os|e|de|do|da|dos|das|em|no|na|nos|nas|para|com|por|um|uma|of|the|and|to|in|for|on";
const TERMINA_EM_LIGACAO = new RegExp(`(^|\\s)(${LIGACAO})$`);
const COMECA_EM_LIGACAO = new RegExp(`^(${LIGACAO})\\s`);

/** Linhas do índice declarado no livro (até 20). Sem índice → []. */
export function sumarioDoTexto(texto: string, max = 20): string[] {
  const linhas = texto.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());
  const ini = linhas.findIndex((l) => CABECALHO_SUMARIO.test(l));
  if (ini < 0) return [];
  const out: string[] = [];
  let vazias = 0;
  // pedaço de item que continua na próxima linha (o título quebrou no meio)
  let pendente = "";
  for (const l of linhas.slice(ini + 1)) {
    if (!l) {
      // o índice tolera 1 linha em branco entre itens; 2 seguidas = acabou
      if (++vazias >= 2 && out.length) break;
      continue;
    }
    vazias = 0;
    if (l.length > 90) break; // prosa: o corpo do livro começou
    let item = l
      .replace(/[\s.·…_-]*\d+$/, "") // tira o "...... 13" da página
      .replace(/^[^\p{L}\p{N}"“(]+/u, "") // ": Título" — o pdftotext perde o número do capítulo
      .trim();
    // rótulo solto ("CAPÍTULO", "Parte 2") não é item: o título vem na linha seguinte
    if (!item || /^\d+$/.test(item) || /^(cap[íi]tulo|chapter|parte|part)\s*\d*$/i.test(item))
      continue;
    // continuação: "Índice das" + "Escrituras", ou linha que abre com "de/of/the…"
    if (pendente) {
      item = `${pendente} ${item}`;
      pendente = "";
    } else if (out.length && COMECA_EM_LIGACAO.test(item)) {
      item = `${out.pop()} ${item}`;
    }
    // "Escrituras Índice" + "Geral": a linha emendou o fim de um item com o começo do próximo —
    // se a 1ª palavra do item se repete lá dentro, o resto é o começo de um novo item
    const [primeira] = item.split(" ");
    const corte = primeira.length >= 4 ? item.indexOf(` ${primeira} `) : -1;
    if (corte > 0 || (primeira.length >= 4 && item.endsWith(` ${primeira}`) && item.length > primeira.length)) {
      const fim = corte > 0 ? corte : item.length - primeira.length - 1;
      pendente = item.slice(fim + 1);
      item = item.slice(0, fim);
    }
    if (!pendente && TERMINA_EM_LIGACAO.test(item)) {
      pendente = item;
      continue;
    }
    // item repetido ("PREFÁCIO" de novo) = o índice acabou e o corpo começou
    if (out.some((o) => o.toLowerCase() === item.toLowerCase())) break;
    out.push(item);
    if (out.length >= max) break;
  }
  // o índice acabou no meio de um item quebrado: melhor mostrar o que há do que perder
  if (pendente && out.length < max && !out.some((o) => o.toLowerCase() === pendente.toLowerCase()))
    out.push(pendente);
  return out;
}

/** Bloco de contexto pra colar num agente (um agente de IA) e trabalhar em cima do livro. */
export function promptDoLivro(l: {
  titulo: string;
  path: string;
  formato: string;
  paginas: number | null;
  chunksTotal: number;
  tema: string;
  dominio?: string;
  nivelNome?: string | null;
  conceitos: string[];
}): string {
  const linhas = [
    `Use o livro "${l.titulo}" como fonte.`,
    `Arquivo: ${l.path} (${l.formato.toUpperCase()}${l.paginas ? ` · ${l.paginas} págs.` : ""})`,
    l.chunksTotal > 0 ? `Indexado para busca semântica: ${l.chunksTotal} chunks` : null,
    `Tema: ${l.tema}${l.dominio ? ` · domínio: ${l.dominio}` : ""}${l.nivelNome ? ` · registro: ${l.nivelNome}` : ""}`,
    l.conceitos.length ? `Conceitos-chave: ${l.conceitos.join(", ")}` : null,
    "",
    "Tarefa: ",
  ];
  return linhas.filter((x) => x !== null).join("\n");
}

/* ───────────────────────── leitura das fontes ───────────────────────── */

async function sql<T>(query: string): Promise<T[]> {
  try {
    const { stdout } = await exec("sqlite3", ["-json", "-readonly", KG_DB, query], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim() ? (JSON.parse(stdout) as T[]) : [];
  } catch {
    return []; // grafo ainda não gerado neste clone
  }
}

const esc = (s: string) => s.replaceAll("'", "''");

// conceitos que aparecem em evidência DESTE livro, ranqueados pela frequência
// dentro dele (não pelo grau global — senão "ciência" ganha em todo livro)
const CONCEITOS_SQL = (filtroLivro: string, porLivro: number) => `
  WITH m AS (
    SELECT ev.livro, e.src c FROM evidences ev JOIN edges e ON e.id = ev.edge_id
      WHERE e.src NOT LIKE 'livro:%' ${filtroLivro}
    UNION ALL
    SELECT ev.livro, e.dst FROM evidences ev JOIN edges e ON e.id = ev.edge_id
      WHERE e.src NOT LIKE 'livro:%' ${filtroLivro}
  ),
  g AS (SELECT livro, c, COUNT(*) n FROM m GROUP BY livro, c),
  r AS (SELECT livro, c, ROW_NUMBER() OVER (PARTITION BY livro ORDER BY n DESC, c) rk FROM g)
  SELECT livro, c FROM r WHERE rk <= ${porLivro} ORDER BY livro, rk`;

// Curto de propósito: uma sinopse gerada ou um grafo reextraído aparece sem reiniciar o app.
const CACHE_RESUMOS_MS = 60_000;
let cacheResumos: { em: number; mapa: Map<string, ResumoLivro> } | null = null;

type Niveis = Record<string, { nivel: string; justificativa?: string }>;
type Sinopses = Record<string, { sinopse?: string }>;

async function lerNiveis(): Promise<Niveis> {
  try {
    return JSON.parse(await readFile(NIVEIS_JSON, "utf-8"));
  } catch {
    return {};
  }
}

/** Sidecar do gerar-sinopses.mjs: `{ porLivro: { "<arquivo>": { sinopse } } }`. Ausente = sem sinopse do modelo. */
async function lerSinopses(): Promise<Sinopses> {
  try {
    return JSON.parse(await readFile(SINOPSES_JSON, "utf-8")).porLivro ?? {};
  } catch {
    return {};
  }
}

function resumo(niveis: Niveis, sinopses: Sinopses, arquivo: string, conceitos: string[]): ResumoLivro {
  const n = niveis[arquivo];
  const { sinopse, fonte } = escolheSinopse(sinopses[arquivo], n);
  return {
    nivel: n?.nivel ?? null,
    nivelNome: n ? (NOME_NIVEL[n.nivel] ?? n.nivel) : null,
    sinopse,
    sinopseFonte: fonte,
    conceitos,
  };
}

/** Resumo de TODOS os livros numa leitura só (1 query no grafo) — chave = arquivo. */
export async function resumosDosLivros(arquivos: string[]): Promise<Map<string, ResumoLivro>> {
  if (cacheResumos && Date.now() - cacheResumos.em < CACHE_RESUMOS_MS) return cacheResumos.mapa;
  const [niveis, sinopses, rows] = await Promise.all([
    lerNiveis(),
    lerSinopses(),
    sql<{ livro: string; c: string }>(CONCEITOS_SQL("", 4)),
  ]);
  const conceitos = new Map<string, string[]>();
  for (const r of rows) conceitos.set(r.livro, [...(conceitos.get(r.livro) ?? []), r.c]);
  const mapa = new Map(arquivos.map((a) => [a, resumo(niveis, sinopses, a, conceitos.get(a) ?? [])]));
  cacheResumos = { em: Date.now(), mapa };
  return mapa;
}

/** Texto bruto do começo do livro: arquivo direto (TXT/MD) ou pdftotext das 1ªs páginas.
 *  `livro.path` é só para exibir (relativo); o arquivo real vem do catálogo, contido na pasta de livros. */
async function textoInicial(livro: LivroDetalhe): Promise<string> {
  try {
    const arquivo = await resolveFilePath(livro.id);
    if (!arquivo) return "";
    if (livro.formato === "pdf") {
      const { stdout } = await exec(
        "pdftotext",
        ["-f", "1", "-l", "30", "-enc", "UTF-8", arquivo, "-"],
        { maxBuffer: 8 * 1024 * 1024, timeout: 8000 },
      );
      return stdout;
    }
    return (await readFile(arquivo, "utf-8")).slice(0, 120_000);
  } catch {
    return "";
  }
}

export async function conteudoDoLivro(livro: LivroDetalhe): Promise<ConteudoLivro> {
  const a = esc(livro.arquivo);
  const [niveis, sinopses, conceitos, evid, texto] = await Promise.all([
    lerNiveis(),
    lerSinopses(),
    sql<{ c: string }>(CONCEITOS_SQL(`AND ev.livro = '${a}'`, 18)),
    sql<{ trecho: string; chunk_id: string; c: string }>(
      `SELECT ev.trecho, ev.chunk_id, e.src c FROM evidences ev JOIN edges e ON e.id = ev.edge_id
       WHERE ev.livro = '${a}' AND e.src NOT LIKE 'livro:%' AND length(ev.trecho) > 120
       ORDER BY ev.confianca DESC, length(ev.trecho) DESC LIMIT 40`,
    ),
    textoInicial(livro),
  ]);

  const textoLimpo = repararLigaduras(texto);

  // 1 trecho por chunk, espalhados pelo livro (não 4 da mesma página)
  const vistos = new Set<string>();
  const trechos: Trecho[] = [];
  for (const r of evid) {
    if (vistos.has(r.chunk_id) || /^---|\btitle:/.test(r.trecho)) continue; // front-matter não é trecho
    vistos.add(r.chunk_id);
    const chunk = Number(r.chunk_id.split("#").pop() ?? -1);
    const pagina =
      livro.paginas && livro.chunksTotal > 0 && chunk >= 0
        ? Math.max(1, Math.round(((chunk + 0.5) / livro.chunksTotal) * livro.paginas))
        : null;
    trechos.push({ texto: repararLigaduras(r.trecho.replace(/\s+/g, " ").trim()), conceito: r.c, pagina, chunk });
    if (trechos.length >= 5) break;
  }
  trechos.sort((x, y) => x.chunk - y.chunk);

  return {
    ...resumo(niveis, sinopses, livro.arquivo, conceitos.map((r) => r.c)),
    trechos,
    abertura: aberturaDoTexto(textoLimpo),
    sumario: sumarioDoTexto(textoLimpo),
  };
}

/** Livro + o que o card da estante mostra e copia — montado no servidor. */
export type LivroCard = Livro &
  ResumoLivro & {
    path: string;
    paginas: number | null;
    chunksTotal: number;
    /** contexto pronto pra colar num agente (promptDoLivro) */
    prompt: string;
  };

export async function livrosDaEstante(): Promise<LivroCard[]> {
  const books = await getBooks();
  const [fisico, resumos] = await Promise.all([
    getBooksFisico(),
    resumosDosLivros(books.map((b) => b.arquivo)),
  ]);
  return books.map((b) => {
    const f = fisico.get(b.id) ?? { path: b.arquivo, paginas: null, chunksTotal: 0 };
    const r = resumos.get(b.arquivo) ?? { nivel: null, nivelNome: null, sinopse: null, sinopseFonte: null, conceitos: [] };
    return { ...b, ...f, ...r, prompt: promptDoLivro({ ...b, ...f, ...r }) };
  });
}
