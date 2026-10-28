/**
 * Módulo `ambiente`: liga o app ao conteúdo populado, escrevendo um bloco
 * gerenciado em `.env.local` (cria o arquivo se não existir).
 *
 * O bloco fica entre dois marcadores exatos. Tudo o que está fora dele pertence
 * ao usuário e é preservado byte a byte; rodar de novo troca só o miolo do bloco
 * (e não toca no arquivo quando nada mudou). O bloco leva SÓ caminhos e nomes:
 * nenhum segredo, nenhuma chave, nenhum Supabase. O app segue só em localhost.
 *
 * O módulo é puro em relação ao repositório: não lê nada do mega-brain além de
 * resolver o caminho dele, e só grava em `<appRoot>/.env.local`.
 *
 * O bloco só leva o que tem fonte: `BILHON_OWNERS_PROPRIOS` sai do owner que o módulo
 * `agente` gravou (remote `origin` do git, em data/agente/repos.json) e as telas que só
 * existem com uma variável apontando para um arquivo (ontologia, personas) entram quando
 * esse arquivo existe em `data/`. Sem fonte, a variável fica de fora: nada de nome inventado.
 * `PORT` nunca entra no bloco: a porta é do usuário (linha própria, fora do bloco, lida pelo
 * scripts/next-local.mjs).
 *
 * Valor seu fora do bloco vence. O bloco fica no fim do arquivo e, no dotenv do Next, vale a
 * última definição de cada chave: gravar ali uma variável que você já definiu (não vazia, na
 * última linha dela fora do bloco) trocaria o seu valor calado. Por isso essa variável fica
 * de fora do bloco; para o provider, a raiz e o registro o módulo ainda avisa o que isso
 * muda (só nomes e linhas, nunca o valor de um caminho). Em branco, como no .env.example,
 * vale como ausente.
 *
 * Duas regras evitam que o `.env.local` deixe o app pior do que o modo demo:
 *  - `BILHON_KNOWLEDGE_PROVIDER=local` só entra se a busca local é de fato
 *    utilizável (índice presente, legível pela CLI `sqlite3`, da versão certa e
 *    com trechos, e o módulo `busca` não falhou nesta execução). Do contrário a
 *    variável fica fora do bloco e o app abre no modo demo, em vez de a tela
 *    "Provider não configurado" substituir o app inteiro (layout raiz).
 *  - `BILHON_ROOT` só é gravado quando o mega-brain contém o app. Com o repositório
 *    lido fora do app (`--repo`, ou BILHON_MEGABRAIN_ROOT apontando um clone limpo
 *    ao lado dele) não existe uma raiz segura que o módulo possa escolher por você:
 *    a variável fica de fora e o módulo avisa. A saída é você definir, fora do bloco,
 *    uma `BILHON_ROOT` que contenha o app e o clone (por exemplo `..`, com o clone em
 *    `../mega-brain-oss`): o módulo `agente` então grava os caminhos `observed` com o
 *    prefixo da raiz até o repositório, e eles resolvem.
 */
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readJsonSafe, toPosix, writeText } from "./common.mjs";

const executar = promisify(execFile);

export const MARCA_INICIO =
  "# >>> populate-megabrain (gerenciado por scripts/populate/ambiente.mjs; nao edite dentro do bloco)";
export const MARCA_FIM = "# <<< populate-megabrain";

/**
 * Únicas variáveis que o bloco pode conter. É uma lista fechada de propósito:
 * se alguém acrescentar uma variável de segredo ou de Supabase, `montarBloco`
 * recusa em vez de gravá-la.
 */
export const VARIAVEIS_PERMITIDAS = [
  "BILHON_KNOWLEDGE_PROVIDER",
  "BILHON_ROOT",
  "BILHON_REGISTRO_ENTIDADES",
  "BILHON_OWNERS_PROPRIOS",
  "BILHON_ONTOLOGIA_MANIFEST",
  "BILHON_PERSONAS_JSON",
  "NEXT_PUBLIC_KANBAN_PROJETOS",
];

/** Mesma regra de `lerProjetos` em lib/types.ts: nome de projeto aceito pelo kanban. */
const PROJETO_VALIDO = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

/** Mesmo valor de `MARCA_AGENTE` em agente.mjs: marca as linhas de repos.json geradas pelo populate. */
const MARCA_AGENTE = "populate:agente";

/** Owner de repositório (usuário ou organização): sem espaço, vírgula, `#` nem quebra de linha. */
const OWNER_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Telas que só têm conteúdo quando uma variável aponta para um arquivo (o app não tem padrão
 * para elas: em branco, a página abre vazia e explica o formato). Caminhos relativos a `data/`;
 * o primeiro candidato que existir vence. A variável entra no bloco só com o arquivo presente
 * e sem valor seu fora do bloco (o seu manda). Formatos: docs/ontologia.md e docs/personas.md.
 */
export const ARQUIVOS_OPCIONAIS = [
  {
    nome: "BILHON_ONTOLOGIA_MANIFEST",
    candidatos: ["ontologia/ontologia.yaml", "ontologia/ontologia.yml", "ontologia/ontologia.json"],
    comentario: "Ontologia (/ontologia): manifesto encontrado em data/ontologia/.",
  },
  {
    nome: "BILHON_PERSONAS_JSON",
    candidatos: ["personas/personas.json"],
    comentario: "Personas (aba de /ingestoes): lista encontrada em data/personas/.",
  },
];

/** Providers que o app reconhece (lib/providers/index.ts). Outro valor não é repetido em avisos nem no resumo. */
const PROVIDERS_CONHECIDOS = ["demo", "supabase", "megabrain", "local"];

/** Variáveis que o Next só aplica por cima do `.env.local` (precedência de @next/env). */
const ARQUIVOS_QUE_VENCEM = [".env.development.local", ".env.production.local"];

/* ------------------------------------------------------------------ bloco */

/**
 * Renderiza o bloco. `itens`: [{ nome, valor, comentario }] na ordem de saída.
 * Sem data, sem aleatório: a mesma entrada dá sempre o mesmo texto.
 */
export function montarBloco(itens) {
  const linhas = [
    MARCA_INICIO,
    "# Gerado por `npm run populate` a partir do conteúdo do mega-brain. Só caminhos e nomes:",
    "# nenhum segredo, nenhuma chave, nenhum Supabase. O app continua só em localhost.",
    "# Reinicie o `npm run dev` depois de mudar este bloco.",
  ];
  for (const { nome, valor, comentario } of itens) {
    if (!VARIAVEIS_PERMITIDAS.includes(nome)) throw new Error(`ambiente: variável fora da lista permitida: ${nome}`);
    if (/[\r\n#]/.test(valor)) throw new Error(`ambiente: valor inválido para ${nome}`);
    if (comentario) linhas.push(`# ${comentario}`);
    linhas.push(`${nome}=${valor}`);
  }
  linhas.push(MARCA_FIM);
  return linhas.join("\n");
}

function localizarBloco(texto) {
  const linhas = texto.split("\n");
  const ini = [];
  const fim = [];
  linhas.forEach((l, i) => {
    const x = l.replace(/\r$/, "").trimEnd();
    if (x === MARCA_INICIO) ini.push(i);
    else if (x === MARCA_FIM) fim.push(i);
  });
  if (ini.length === 0 && fim.length === 0) return { linhas, ini: -1, fim: -1 };
  if (ini.length !== 1 || fim.length !== 1 || fim[0] < ini[0]) {
    throw new Error(
      "ambiente: o .env.local tem marcadores populate-megabrain incompletos ou repetidos. Corrija à mão (nada foi alterado).",
    );
  }
  return { linhas, ini: ini[0], fim: fim[0] };
}

/**
 * Devolve o texto do `.env.local` com o bloco aplicado. Sem bloco: acrescenta ao
 * fim (o último valor de uma chave vence no Next, então o bloco prevalece sobre
 * linhas em branco herdadas do .env.example). Com bloco: troca só o que está
 * entre os marcadores. O conteúdo anterior é sempre prefixo/sufixo do novo.
 */
export function aplicarBloco(texto, bloco) {
  const crlf = texto.includes("\r\n");
  const eol = crlf ? "\r\n" : "\n";
  const novas = bloco.split("\n");
  const { linhas, ini, fim } = localizarBloco(texto);
  if (ini >= 0) {
    const crFim = linhas[fim].endsWith("\r") ? "\r" : "";
    const meio = novas.map((l, i) => (i === novas.length - 1 ? l + crFim : l + (crlf ? "\r" : "")));
    linhas.splice(ini, fim - ini + 1, ...meio);
    return linhas.join("\n");
  }
  if (texto === "") return novas.join(eol) + eol;
  let base = texto;
  if (!base.endsWith("\n")) base += eol;
  if (!/\n\r?\n$/.test(base)) base += eol; // linha em branco antes do bloco
  return base + novas.join(eol) + eol;
}

/**
 * Só o miolo do bloco (nome → valor), para conferir/testar o que o Next vai ler.
 * @param {string} texto conteúdo do .env.local
 * @returns {Record<string, string>}
 */
export function variaveisDoBloco(texto) {
  const { linhas, ini, fim } = localizarBloco(texto);
  /** @type {Record<string, string>} */
  const out = {};
  if (ini < 0) return out;
  for (const raw of linhas.slice(ini + 1, fim)) {
    const l = raw.replace(/\r$/, "");
    if (/^\s*#/.test(l) || !l.trim()) continue;
    const i = l.indexOf("=");
    if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return out;
}

/* ------------------------------------------------------------------ leitura do .env */

function valorEnv(bruto) {
  const v = bruto.trim();
  const aspas = v.match(/^(['"`])([\s\S]*?)\1/);
  return aspas ? aspas[2] : v.replace(/\s+#.*$/, "").replace(/#.*$/, "").trim();
}

/** Definições `NOME=valor` do texto, fora do bloco gerenciado. Só nomes e linhas saem em avisos. */
function definicoes(linhas, ini, fim) {
  const out = [];
  linhas.forEach((raw, i) => {
    if (ini >= 0 && i >= ini && i <= fim) return;
    const l = raw.replace(/\r$/, "");
    if (/^\s*#/.test(l)) return;
    const m = l.match(/^\s*(?:export\s+)?([\w.-]+)\s*(?:=|:\s)\s*(.*)$/);
    if (m) out.push({ nome: m[1], linha: i + 1, valor: valorEnv(m[2]) });
  });
  return out;
}

/**
 * O valor que é seu: a última definição de `nome` fora do bloco (como no dotenv, a última
 * vence), quando não está em branco. Em branco (cópia do .env.example) vale como ausente.
 */
function valorDeFora(fora, nome) {
  const ultima = fora.filter((d) => d.nome === nome).at(-1);
  return ultima?.valor ? ultima : undefined;
}

/** Os dois caminhos, relativos à pasta do app, levam ao mesmo lugar? (no Windows, sem diferenciar maiúsculas) */
const mesmoLugar = (appRoot, a, b) => path.relative(path.resolve(appRoot, a), path.resolve(appRoot, b)) === "";

async function lerOuVazio(arquivo) {
  try {
    return await readFile(arquivo, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

/* ------------------------------------------------------------------ valores */

const contem = (pai, filho) => {
  const r = path.relative(pai, filho);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
};

/**
 * `BILHON_ROOT` relativo à pasta do app (onde o `npm run dev` inicia), ou `null` quando
 * não há valor seguro para gravar.
 *
 * O valor só existe no caso normal: o repositório lido CONTÉM o app (no mega-brain, o
 * app fica em `<mega-brain>/apps/knowledge`, então é `../..`). Aí a raiz é exatamente o
 * mega-brain: contém `data/agente|addons|topology` (que o app lê e grava) e é contra
 * ela que o leitor resolve os `observed` do registro do Agente (relativos ao repositório).
 * O valor é sempre feito só de `..` (ou `.`), logo nunca carrega `#` nem quebra de linha.
 *
 * Com `--repo` fora do app não existe raiz que sirva aos dois lados: o ancestral comum
 * alarga a raiz permitida (no limite, a raiz do volume) e ainda desalinha os `observed`;
 * o próprio repositório deixaria `data/` do app fora da raiz. Nesse caso não se grava
 * nada (o app usa a própria pasta como raiz) e se avisa.
 */
export function valorRaiz(appRoot, repoRoot) {
  const raiz = path.resolve(repoRoot);
  if (!contem(raiz, path.resolve(appRoot))) {
    return {
      valor: null,
      aviso:
        "o repositório lido fica fora do app (--repo ou BILHON_MEGABRAIN_ROOT): BILHON_ROOT não foi gravado, para não alargar a raiz permitida do app. " +
        "Sem ele a raiz é a pasta do app, e os caminhos `observed` do registro do Agente (relativos ao repositório lido) não resolvem a partir dela. " +
        "Para ler esse repositório, defina BILHON_ROOT à mão fora do bloco, numa pasta que contenha o app e o repositório " +
        "(por exemplo `..` com o clone em ../mega-brain-oss; data/agente, data/addons e data/topology precisam ficar dentro da raiz).",
    };
  }
  const rel = toPosix(path.relative(appRoot, raiz));
  return { valor: rel === "" ? "." : rel, aviso: null };
}

/** Pastas que o app lê e grava sob `BILHON_ROOT` (padrão relativo à pasta do app, ou a variável que a troca) e a tela de cada uma. */
const PASTAS_DA_RAIZ = [
  { variavel: "BILHON_AGENTE_DIR", padrao: "data/agente", tela: "a página Agente" },
  { variavel: "BILHON_ADDONS_DIR", padrao: "data/addons", tela: "os add-ons" },
  { variavel: "BILHON_TOPOLOGY_DIR", padrao: "data/topology", tela: "a topologia" },
];

/** Registro de entidades que o módulo `agente` gera (relativo à pasta do app). */
const REGISTRO_GERADO = "data/agente/registro.yaml";

const juntar = (itens) => (itens.length > 1 ? `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}` : itens.join(""));

/**
 * Aviso sobre a `BILHON_ROOT` que você definiu fora do bloco (ela vence e o bloco não a grava),
 * ou `null` quando não há o que dizer: ela leva ao mesmo lugar que o bloco gravaria, ou (com
 * `--repo` externo, quando o bloco não grava raiz) atende ao que o app exige dela. O que se
 * confere: a raiz contém data/agente, data/addons e data/topology (ou as pastas das variáveis
 * que as trocam, definidas fora do bloco), sem as quais o app recusa essas telas; e, com o
 * registro gerado pelo populate (o do bloco, ou o seu fora dele quando aponta para esse mesmo
 * arquivo), a raiz contém o repositório lido (o módulo `agente` grava os `observed` com o prefixo
 * da raiz até ele; sem o repositório dentro da raiz, nenhum prefixo os faria resolver).
 * Só nomes e linhas: o caminho que você escreveu não sai no aviso.
 */
function avisoDaRaizDoUsuario(appRoot, repoRoot, fora, sua) {
  const doBloco = valorRaiz(appRoot, repoRoot).valor;
  if (doBloco !== null && mesmoLugar(appRoot, sua.valor, doBloco)) return null;
  const raiz = path.resolve(appRoot, sua.valor);
  const faltam = PASTAS_DA_RAIZ.map((p) => ({ ...p, trocada: valorDeFora(fora, p.variavel) })).filter(
    (p) => !contem(raiz, path.resolve(appRoot, p.trocada?.valor ?? p.padrao)),
  );
  // o app lê o registro gerado quando o bloco o grava ou quando o seu (fora do bloco) leva a ele
  const seuRegistro = valorDeFora(fora, "BILHON_REGISTRO_ENTIDADES");
  const usaGerado = !seuRegistro || mesmoLugar(appRoot, seuRegistro.valor, REGISTRO_GERADO);
  const observedQuebram = usaGerado && !contem(raiz, path.resolve(repoRoot));
  if (doBloco === null && faltam.length === 0 && !observedQuebram) return null;

  const partes = [
    doBloco !== null
      ? `BILHON_ROOT (linha ${sua.linha} do .env.local) está definida fora do bloco e vence: o bloco não grava a raiz do Megabrain ("${doBloco}").`
      : `BILHON_ROOT (linha ${sua.linha} do .env.local) é a raiz que o app usa (com --repo externo o bloco não grava raiz).`,
  ];
  if (faltam.length) {
    const pastas = juntar(faltam.map((p) => (p.trocada ? `${p.variavel} (linha ${p.trocada.linha})` : p.padrao)));
    const varias = faltam.length > 1;
    partes.push(`${pastas} ${varias ? "ficam" : "fica"} fora dessa raiz: o app recusa ${juntar(faltam.map((p) => p.tela))} até que ela ${varias ? "as" : "a"} contenha.`);
  }
  if (observedQuebram) {
    partes.push(`Os caminhos \`observed\` do registro gerado pelo populate (${REGISTRO_GERADO}) são relativos ao repositório lido, que não está dentro dela: não resolvem a partir dela.`);
  }
  if (doBloco !== null) partes.push(`Para usar a raiz do Megabrain, apague a linha ${sua.linha} e rode de novo: npm run populate -- --yes --only ambiente.`);
  return partes.join(" ");
}

/* ------------------------------------------------------------------ busca local */

const SQL_DIAGNOSTICO =
  "SELECT (SELECT value FROM meta WHERE key = 'schema_version') AS versao, " +
  "(SELECT count(*) FROM busca) AS trechos, " +
  "(SELECT count(DISTINCT doc_rel) FROM busca) AS arquivos;";

/**
 * A busca local está utilizável? Mesma checagem que o `status()` do provider faz a cada
 * página (lib/providers/local/search.ts, `diagnosticoIndiceLocal`), pela mesma via: o
 * índice existe, a CLI `sqlite3` o lê (o que também exige FTS5), o `schema_version` é o
 * que o módulo `busca` grava e há trechos. Só leitura, sem rede.
 *
 * @param {string} indice caminho absoluto do índice FTS5
 * @param {{ comando?: string, versaoEsperada?: string | number | null }} [opcoes]
 *   `comando` troca o executável (testes); sem `versaoEsperada` a versão do esquema não é comparada.
 * @returns {Promise<{ ok: true, trechos: number, arquivos: number } | { ok: false, motivo: string }>}
 */
export async function diagnosticarBuscaLocal(indice, { comando = "sqlite3", versaoEsperada = null } = {}) {
  let st;
  try {
    st = await stat(indice);
  } catch {
    return { ok: false, motivo: "o índice de busca local não existe" };
  }
  if (!st.isFile()) return { ok: false, motivo: "o caminho do índice de busca local não é um arquivo" };

  let stdout;
  try {
    ({ stdout } = await executar(comando, ["-readonly", "-json", indice, SQL_DIAGNOSTICO], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }));
  } catch (e) {
    if (e?.code === "ENOENT") {
      return { ok: false, motivo: "a CLI sqlite3 não foi encontrada no PATH (o provider local consulta o índice por ela; instale o SQLite 3.35 ou superior, com FTS5)" };
    }
    if (e?.killed || e?.signal === "SIGTERM") return { ok: false, motivo: "a consulta ao índice de busca local excedeu o tempo limite" };
    const linha = String(e?.stderr ?? e?.message ?? "").split("\n").find((l) => l.trim()) ?? "erro desconhecido";
    const limpo = linha.split(indice).join("<índice>").replace(/\s+/g, " ").trim().slice(0, 200);
    return { ok: false, motivo: `o índice de busca local não é legível pela CLI sqlite3 (${limpo})` };
  }

  let linha;
  try {
    linha = JSON.parse(stdout.trim() || "[]")[0];
  } catch {
    return { ok: false, motivo: "a resposta da CLI sqlite3 sobre o índice de busca local é ilegível" };
  }
  const versao = String(linha?.versao ?? "");
  const trechos = Number(linha?.trechos ?? 0);
  const arquivos = Number(linha?.arquivos ?? 0);
  if (versaoEsperada !== null && versao !== String(versaoEsperada)) {
    return { ok: false, motivo: `o índice de busca local tem esquema "${versao || "?"}" (esperado "${versaoEsperada}")` };
  }
  if (!(trechos > 0)) return { ok: false, motivo: "o índice de busca local está vazio (0 trechos)" };
  return { ok: true, trechos, arquivos };
}

/** Versão do esquema que o módulo `busca` grava; `null` se ele não puder ser carregado (aí a versão não é comparada). */
async function versaoDoEsquemaDaBusca() {
  try {
    const mod = await import("./busca.mjs");
    return mod.VERSAO_ESQUEMA ?? null;
  } catch {
    return null;
  }
}

/**
 * Índice que o app vai abrir: `BILHON_LOCAL_SEARCH_DB` definida à mão fora do bloco (vale a
 * última definição, como no Next; relativa à pasta do app) ou o padrão `data/search/index.sqlite`.
 * Última definição em branco (cópia do .env.example) vale o padrão, mesmo com um valor antes dela.
 */
export function indiceDeBusca(appRoot, dataDir, fora) {
  const definida = fora.filter((d) => d.nome === "BILHON_LOCAL_SEARCH_DB").at(-1);
  if (definida?.valor) return { caminho: path.resolve(appRoot, definida.valor), personalizado: true, linha: definida.linha };
  return { caminho: path.join(dataDir, "search", "index.sqlite"), personalizado: false, linha: null };
}

/** Projetos que os cards do board já usam, na forma de `NEXT_PUBLIC_KANBAN_PROJETOS`; `null` quando o padrão basta. */
async function projetosDoKanban(dataDir) {
  const board = await readJsonSafe(path.join(dataDir, "kanban", "board.json"));
  const cards = Array.isArray(board?.cards) ? board.cards : [];
  const usados = new Set();
  for (const c of cards) {
    const p = typeof c?.projeto === "string" ? c.projeto.trim() : "";
    if (p && p !== "outro" && PROJETO_VALIDO.test(p)) usados.add(p);
  }
  const lista = [...usados].sort();
  if (lista.length === 0 || (lista.length === 1 && lista[0] === "geral")) return null;
  return lista.includes("geral") ? ["geral", ...lista.filter((p) => p !== "geral")] : lista;
}

/**
 * Owners "próprios" na forma de `BILHON_OWNERS_PROPRIOS`: o owner que o módulo `agente` gravou
 * para o repositório lido (linhas de data/agente/repos.json com a marca do agente e procedência
 * "propria"; o agente o tira do remote `origin`). `null` sem essa linha: a variável fica de fora.
 */
export async function ownersDoAgente(dataDir) {
  const repos = await readJsonSafe(path.join(dataDir, "agente", "repos.json"));
  const owners = new Set();
  for (const r of Array.isArray(repos) ? repos : []) {
    if (r?.gerado_por !== MARCA_AGENTE || r?.procedencia !== "propria") continue;
    const o = typeof r.owner === "string" ? r.owner.trim() : "";
    if (OWNER_VALIDO.test(o)) owners.add(o);
  }
  return owners.size ? [...owners].sort() : null;
}

/** Primeiro candidato de `ARQUIVOS_OPCIONAIS` que existe como arquivo, relativo à pasta do app (posix); `null` se nenhum. */
async function arquivoOpcional(appRoot, dataDir, candidatos) {
  for (const rel of candidatos) {
    const abs = path.join(dataDir, ...rel.split("/"));
    try {
      if ((await stat(abs)).isFile()) return toPosix(path.relative(appRoot, abs));
    } catch {
      /* ausente: tenta o próximo */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ módulo */

export default async function run(ctx) {
  const { appRoot, repoRoot, dataDir } = ctx;
  const avisos = [];
  const arquivo = path.join(appRoot, ".env.local");
  const existente = await lerOuVazio(arquivo);
  const atual = existente ?? "";
  const { linhas, ini, fim } = localizarBloco(atual);
  const fora = definicoes(linhas, ini, fim);

  // Valor seu fora do bloco (a última definição, não vazia) vence: a variável não entra no bloco.
  const definidaFora = (nome) => valorDeFora(fora, nome);

  // Provider local: só com a busca realmente utilizável. Sem isso o app abriria na tela
  // "Provider não configurado" (layout raiz), no lugar do app inteiro; sem a variável ele
  // abre no modo demo, que funciona. Um provider seu fora do bloco vence e não é trocado.
  const indice = indiceDeBusca(appRoot, dataDir, fora);
  const onde = indice.personalizado ? `BILHON_LOCAL_SEARCH_DB (linha ${indice.linha} do .env.local)` : toPosix(path.relative(appRoot, indice.caminho));
  const busca = ctx.resultados?.busca;
  let diag;
  if (busca && busca.ok === false) {
    diag = { ok: false, motivo: busca.motivo === "nao-implementado" ? "o módulo busca ainda não está implementado" : "o módulo busca falhou nesta execução" };
  } else {
    diag = await diagnosticarBuscaLocal(indice.caminho, { versaoEsperada: await versaoDoEsquemaDaBusca() });
  }
  const seuProvider = definidaFora("BILHON_KNOWLEDGE_PROVIDER");
  const providerLocal = diag.ok && !seuProvider;
  const rerodar = `npm run populate -- --yes --only ${diag.ok ? "ambiente" : "busca,ambiente"}`;
  if (seuProvider?.valor === "local") {
    if (!diag.ok) {
      avisos.push(
        `O .env.local define BILHON_KNOWLEDGE_PROVIDER=local fora do bloco (linha ${seuProvider.linha}); com a busca indisponível (${diag.motivo} [${onde}]) ` +
          `o app abre em "Provider não configurado" até isso mudar. Resolva e rode de novo (${rerodar}) ou apague a linha ${seuProvider.linha} para voltar ao modo demo.`,
      );
    }
  } else if (seuProvider) {
    const qual = PROVIDERS_CONHECIDOS.includes(seuProvider.valor)
      ? `o provider ${seuProvider.valor}`
      : "um provider que o app não reconhece (o valor não é repetido aqui; o app não abre com ele)";
    avisos.push(
      `O .env.local usa ${qual} (BILHON_KNOWLEDGE_PROVIDER, linha ${seuProvider.linha}, fora do bloco) e ele vence: o bloco não grava "local" por cima. ` +
        `Para usar o provider local, apague a linha ${seuProvider.linha} (ou deixe-a em branco) e rode de novo: ${rerodar}.` +
        (diag.ok ? "" : ` Hoje a busca local também não está utilizável: ${diag.motivo} [${onde}].`),
    );
  } else if (!diag.ok) {
    avisos.push(
      `BILHON_KNOWLEDGE_PROVIDER=local NÃO foi gravado: ${diag.motivo} [${onde}]. ` +
        "O app fica no modo demo (provider padrão) em vez de abrir na tela \"Provider não configurado\". " +
        `Resolva e rode de novo: ${rerodar}.`,
    );
  }

  // Raiz: a sua fora do bloco vence (com aviso do que muda); sem ela, a do Megabrain, se houver uma segura.
  const raiz = valorRaiz(appRoot, repoRoot);
  const suaRaiz = definidaFora("BILHON_ROOT");
  if (suaRaiz) {
    const aviso = avisoDaRaizDoUsuario(appRoot, repoRoot, fora, suaRaiz);
    if (aviso) avisos.push(aviso);
  } else if (raiz.aviso) {
    avisos.push(raiz.aviso);
  }

  // Registro de entidades: o gerado pelo populate, a não ser que você aponte outro fora do bloco.
  const seuRegistro = definidaFora("BILHON_REGISTRO_ENTIDADES");
  if (seuRegistro && !mesmoLugar(appRoot, seuRegistro.valor, REGISTRO_GERADO)) {
    avisos.push(
      `BILHON_REGISTRO_ENTIDADES (linha ${seuRegistro.linha} do .env.local) está definida fora do bloco e vence: a página Agente lê esse registro, ` +
        `não o ${REGISTRO_GERADO} gerado pelo populate. Para usar o gerado, apague a linha ${seuRegistro.linha} e rode de novo: npm run populate -- --yes --only ambiente.`,
    );
  }

  const itens = [
    ...(providerLocal
      ? [{
          nome: "BILHON_KNOWLEDGE_PROVIDER",
          valor: "local",
          comentario: "Provider local: busca e grafo vêm de data/ (SQLite local), sem Supabase, sem Ollama e sem rede.",
        }]
      : []),
    ...(raiz.valor !== null && !suaRaiz
      ? [{
          nome: "BILHON_ROOT",
          valor: raiz.valor,
          comentario: "Raiz que Agente, add-ons e topologia podem ler: o mega-brain (relativa à pasta do app). data/agente, data/addons e data/topology ficam dentro dela.",
        }]
      : []),
    ...(!seuRegistro
      ? [{
          nome: "BILHON_REGISTRO_ENTIDADES",
          valor: REGISTRO_GERADO,
          comentario: "Registro de entidades (squads, agentes, skills...) gerado pelo populate.",
        }]
      : []),
  ];

  // Owner próprio: só o que o módulo agente gravou (remote origin); valor seu fora do bloco manda.
  const owners = await ownersDoAgente(dataDir);
  if (owners && !definidaFora("BILHON_OWNERS_PROPRIOS")) {
    itens.push({
      nome: "BILHON_OWNERS_PROPRIOS",
      valor: owners.join(","),
      comentario: "Dono tratado como próprio na procedência dos itens do Agente (owner do remote origin, lido pelo módulo agente).",
    });
  }

  // Ontologia e personas: só com o arquivo em data/ e sem valor seu fora do bloco.
  for (const { nome, candidatos, comentario } of ARQUIVOS_OPCIONAIS) {
    if (definidaFora(nome)) continue;
    const valor = await arquivoOpcional(appRoot, dataDir, candidatos);
    if (valor) itens.push({ nome, valor, comentario });
  }

  // Projetos do kanban: só entram se os cards já populados usam algo além de "geral".
  // Valor definido à mão fora do bloco manda: não é sobrescrito (em branco, cópia do .env.example, vale como ausente).
  const projetos = await projetosDoKanban(dataDir);
  const kanbanFora = definidaFora("NEXT_PUBLIC_KANBAN_PROJETOS");
  if (projetos && !kanbanFora) {
    itens.push({
      nome: "NEXT_PUBLIC_KANBAN_PROJETOS",
      valor: projetos.join(","),
      comentario: "Projetos usados pelos cards do board populado (entra no build do navegador; reinicie o app).",
    });
  } else if (projetos && kanbanFora) {
    const aceitos = kanbanFora.valor.split(",").map((p) => p.trim());
    const faltam = projetos.filter((p) => !aceitos.includes(p));
    if (faltam.length) avisos.push(`NEXT_PUBLIC_KANBAN_PROJETOS (linha ${kanbanFora.linha} do .env.local) não lista os projetos dos cards: ${faltam.join(", ")}.`);
  }

  // Quem vence o conflito: o último valor do arquivo; arquivos *.development|production.local vencem o .env.local.
  for (const item of itens) {
    const depois = fora.filter((d) => d.nome === item.nome && ini >= 0 && d.linha - 1 > fim);
    if (depois.length) avisos.push(`${item.nome} também é definida depois do bloco (linha ${depois.at(-1).linha}); vale a de fora.`);
  }
  for (const nome of ARQUIVOS_QUE_VENCEM) {
    const outro = await lerOuVazio(path.join(appRoot, nome));
    if (outro === null) continue;
    const l = outro.split("\n");
    const nomes = new Set(definicoes(l, -1, -1).map((d) => d.nome));
    const conflito = itens.filter((i) => nomes.has(i.nome)).map((i) => i.nome);
    if (conflito.length) avisos.push(`${nome} define ${conflito.join(", ")} e vence o .env.local.`);
  }

  // O provider "local" vive em lib/providers (outro conjunto de arquivos). Sem ele o app não abre.
  if (providerLocal || seuProvider?.valor === "local") {
    const indiceProviders = await lerOuVazio(path.join(appRoot, "lib", "providers", "index.ts"));
    if (indiceProviders === null || !/case\s+["']local["']/.test(indiceProviders)) {
      avisos.push('lib/providers/index.ts ainda não reconhece BILHON_KNOWLEDGE_PROVIDER=local: o app não abre até o provider local existir.');
    }
  }

  const novo = aplicarBloco(atual, montarBloco(itens));
  let acao = "sem-mudanca";
  if (novo !== atual) {
    await writeText(arquivo, novo);
    acao = existente === null ? "criado" : ini >= 0 ? "atualizado" : "bloco-acrescentado";
  }
  // provider que o app vai usar: o seu (fora do bloco), o local do bloco ou o demo
  const provider = seuProvider
    ? `${PROVIDERS_CONHECIDOS.includes(seuProvider.valor) ? seuProvider.valor : "não reconhecido"} (seu, linha ${seuProvider.linha} do .env.local)`
    : providerLocal
      ? "local"
      : "demo (padrão)";
  return {
    resumo: { arquivo: ".env.local", acao, variaveis: itens.length, provider },
    avisos,
  };
}
