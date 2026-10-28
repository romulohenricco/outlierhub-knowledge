/**
 * Contrato compartilhado da população do Knowledge com o conteúdo do mega-brain.
 *
 * Tudo que os módulos de `scripts/populate/` precisam saber sobre o repositório
 * (o que entra, o que é excluído, como cada arquivo é classificado, como se
 * calcula o id de um documento) vive AQUI, para que livros, coleções, grafo,
 * busca etc. concordem entre si sem ler a saída uns dos outros.
 *
 * Regras:
 *  - o repositório mega-brain é SOMENTE LEITURA; só se grava em `apps/knowledge/data/`
 *    (e no bloco gerenciado do `.env.local`);
 *  - material sensível (credenciais, .env, chaves) nunca entra no corpus;
 *  - nada aqui faz rede.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { variavelDoEnv } from "../porta-local.mjs";

/** Raiz do app Knowledge (`apps/knowledge`). scripts/populate/common.mjs → ../.. */
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = path.join(APP_ROOT, "data");

/* ------------------------------------------------------------------ utilitários */

export const toPosix = (p) => p.split(path.sep).join("/");

export const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export function slugify(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function humanize(s) {
  return String(s)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function rmrf(target) {
  await rm(target, { recursive: true, force: true });
}

/** Grava via arquivo temporário + rename: o app nunca lê um JSON pela metade. */
export async function writeText(file, content) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

export const writeJson = (file, obj) => writeText(file, `${JSON.stringify(obj, null, 2)}\n`);

export async function readJsonSafe(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** node:sqlite (Node >= 22.13). Os módulos que criam SQLite usam isto; o app lê pela CLI `sqlite3`. */
export async function openSqlite(file) {
  await ensureDir(path.dirname(file));
  let mod;
  try {
    mod = await import("node:sqlite");
  } catch {
    throw new Error("populate: node:sqlite indisponível — use Node.js 22.13 ou superior.");
  }
  return new mod.DatabaseSync(file);
}

export const log = (modulo, msg) => console.log(`[populate:${modulo}] ${msg}`);

/**
 * Trechos de 400 palavras com 50 repetidas do trecho anterior — é o contrato de
 * `lib/colecoes.ts` (remonta o texto descartando as 50 primeiras palavras de todo
 * trecho depois do primeiro). Preserva as quebras de linha DENTRO de cada trecho;
 * as pontas são aparadas para a contagem de palavras do app bater.
 */
export function chunkWords(text, size = 400, overlap = 50) {
  const tokens = text.match(/\S+\s*/g) ?? [];
  if (tokens.length === 0) return [];
  const step = size - overlap;
  const out = [];
  for (let i = 0; ; i += step) {
    out.push(tokens.slice(i, i + size).join("").trim());
    if (i + size >= tokens.length) break;
  }
  return out;
}

/* ------------------------------------------------------------------ áreas */

/**
 * Cada arquivo do corpus pertence a UMA área. A área decide a coleção (pasta em
 * `data/colecoes-external/sources/<colecao>`), o tema da estante (a capa sem imagem
 * ganha uma cor estável calculada do texto do tema em `components/Capa.tsx`) e o
 * domínio (filtro "domínio").
 */
export const AREAS = {
  regras: { colecao: "regras", tema: "Governança & Regras", dominio: "governanca", titulo: "Regras e governança" },
  skills: { colecao: "skills", tema: "Skills & Comandos", dominio: "skills", titulo: "Skills e comandos" },
  agentes: { colecao: "agentes", tema: "Agentes & Squads", dominio: "agentes", titulo: "Agentes" },
  squads: { colecao: "squads", tema: "Agentes & Squads", dominio: "squads", titulo: "Squads" },
  workspace: { colecao: "workspace", tema: "Workspace & Templates", dominio: "workspace", titulo: "Workspace e templates" },
  docs: { colecao: "docs", tema: "Documentação", dominio: "documentacao", titulo: "Documentação" },
  engine: { colecao: "engine-docs", tema: "Engine & Pipeline", dominio: "engine", titulo: "Engine (docs e configs)" },
  codigo: { colecao: "codigo", tema: "Engine & Pipeline", dominio: "engine", titulo: "Código (engine, hooks, scripts)" },
};

/**
 * Cores de referência dos temas que o populate atribui. Só documentam a intenção: nenhum
 * módulo as aplica, e o `components/Capa.tsx` do app não tem lista fixa de temas (a cor
 * sai de um hash do texto do tema, a mesma para o mesmo tema em qualquer catálogo).
 */
export const TEMAS_EXTRAS = {
  "Governança & Regras": "#c2255c",
  "Skills & Comandos": "#1098ad",
  "Agentes & Squads": "#3b5bdb",
  "Workspace & Templates": "#0b7285",
  "Documentação": "#087f5b",
  "Engine & Pipeline": "#5f3dc4",
  "Conhecimento": "#e8590c",
};

/**
 * Classifica por caminho relativo (posix) + tipo. Primeira regra que casar vence.
 * `knowledge/<bucket>/<sub>/…` vira uma coleção por bucket+subpasta (isolamento
 * dos buckets — Art. XIII da Constituição — preservado: coleções nunca misturam buckets).
 */
export function classify(rel, kind) {
  const k = rel.match(/^knowledge\/(external|business|personal)\/([^/]+)\//);
  if (rel.startsWith("knowledge/")) {
    const bucket = rel.split("/")[1] ?? "raiz";
    const sub = k ? slugify(k[2]) : "raiz";
    return {
      area: `knowledge-${bucket}`,
      colecao: `knowledge-${slugify(bucket)}-${sub}`,
      tema: "Conhecimento",
      dominio: slugify(bucket),
      bucket,
    };
  }
  let key;
  if (kind === "code") key = "codigo";
  else if (rel.startsWith(".claude/rules/") || rel === ".claude/CLAUDE.md" || rel.startsWith(".claude/templates/")) key = "regras";
  else if (rel.startsWith(".claude/skills/") || rel.startsWith(".claude/commands/")) key = "skills";
  else if (rel.startsWith(".claude/agents/") || rel === ".claude/agents.yaml" || rel.startsWith("agents/")) key = "agentes";
  else if (rel.startsWith("squads/")) key = "squads";
  else if (rel.startsWith("workspace/")) key = "workspace";
  else if (rel.startsWith("engine/")) key = "engine";
  else key = "docs";
  const a = AREAS[key];
  return { area: key, colecao: a.colecao, tema: a.tema, dominio: a.dominio, bucket: null };
}

/* ------------------------------------------------------------------ varredura */

const ROOT_FILES = new Set(["README.md", "QUICK-START.md"]);
const ROOT_DIRS = ["docs", "agents", "squads", "workspace", "engine", "knowledge", "bin", "scripts", "infrastructure", "tests"];
const CLAUDE_FILES = new Set(["CLAUDE.md", "agents.yaml"]);
const CLAUDE_DIRS = ["rules", "skills", "commands", "agents", "templates", "hooks", "scripts"];

const PRUNE_DIRS = new Set([
  "node_modules", ".git", "__pycache__", ".pytest_cache", ".venv", "venv", "dist", "build",
  ".next", ".data", "coverage", ".mypy_cache", ".ruff_cache",
]);
const SKIP_BASENAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".gitkeep", ".DS_Store"]);

const DOC_EXT = new Set([".md", ".txt"]);
const CONFIG_EXT = new Set([".yaml", ".yml", ".json", ".mmd"]);
const CODE_EXT = new Set([".py", ".js", ".mjs", ".cjs", ".ts", ".sh"]);
const MAX_BYTES = 1024 * 1024;

/** Nome de arquivo que denuncia segredo: nunca lido nem indexado. */
const SENSITIVE_NAME = /(^\.env|credential|secret|id_rsa|\.(pem|key|pfx|p12)$)/i;

/**
 * Nome do campo de uma atribuição (grupo `campo`), com ou sem aspas (JSON/YAML, inclusive as
 * escapadas `\"…\"` de um JSON guardado dentro de string), em qualquer caixa e com `_`, `-` ou
 * camelCase: `my_api_key`, `OPENAI_API_KEY`, `"apiKey"`, `access_token`, `x-api-key`,
 * `--api-key`. Só começa onde começa um identificador, nunca no meio de um nome (assim uma
 * cadeia `a-b-c-…` tem um ponto de partida só, sem custo quadrático). Se o nome é de segredo
 * quem decide é `atribuiSegredo`.
 */
const CAMPO = String.raw`(?<![A-Za-z0-9_-])(?:--?)?(?<aspasCampo>(?:\\?["'])?)(?<campo>[A-Za-z][A-Za-z0-9_-]*)\k<aspasCampo>`;
/** `=`, `:` ou `:=`; `==` e `===` são comparação, não atribuição. */
const ATRIBUI = String.raw`(?::=|[:=])(?!=)`;
/**
 * Valor de 24 ou mais caracteres de base64/base64url, com até dois `=` de preenchimento só no
 * FIM: um `=` no meio já é outra atribuição (`CMD=token=…`), que precisa ser examinada sozinha.
 */
const VALOR = String.raw`[A-Za-z0-9_\-/+]{24,}={0,2}`;

/**
 * Padrões de segredo no CONTEÚDO. O valor casado jamais é registrado — só o nome do padrão.
 *
 * O grupo `corpo` (quando existe) é a parte variável do segredo. Se ele for um marcador
 * óbvio de documentação (`xxxxxxxx`, `sua-chave-aqui`, `your-api-key-here`, `abcdef123456…`,
 * `${VAR}`), a ocorrência não conta: exemplo de documentação não tira arquivo bom do
 * corpus. O grupo `campo` (quando existe) é o nome do campo de uma atribuição: a ocorrência
 * só conta se ele for nome de segredo e o valor não for referência (`atribuiSegredo`); o
 * grupo `aspas` diz que o valor veio entre aspas. Opções:
 *  - `{ humano: true }`: o valor pode ter sido escolhido por uma pessoa (senha de URL,
 *    atribuição), então só vale o marcador forte (máscara, interpolação, frase ou palavra de
 *    exemplo): `SenhaDoBanco2024` continua sendo segredo, mesmo com "senha" dentro;
 *  - `{ aleatorio: true }`: exige dígito ou maiúsculas e minúsculas no corpo, o que separa
 *    valor de verdade de nome de função/constante numa atribuição sem aspas.
 * Todos usam a flag `g` (o `detectSecret` percorre as ocorrências com `matchAll`).
 */
const SECRET_PATTERNS = [
  ["aws-access-key", /AKIA(?<corpo>[0-9A-Z]{16})/g],
  ["github-token", /\bgh[pousr]_(?<corpo>[A-Za-z0-9]{30,})/g],
  ["github-pat", /github_pat_(?<corpo>[A-Za-z0-9_]{30,})/g],
  // antes da OpenAI: o nome do padrão casado é o que vai para o motivo da exclusão
  ["anthropic-key", /\bsk-ant-(?<corpo>[A-Za-z0-9_-]{20,})/g],
  // formatos atuais (base64url, com _ e -) e o antigo sk-<alfanumérico>
  ["openai-key", /\bsk-(?:proj|svcacct|admin)-(?<corpo>[A-Za-z0-9_-]{32,})/g],
  ["openai-key", /\bsk-(?<corpo>[A-Za-z0-9]{32,})/g],
  ["slack-token", /\bxox[abprs]-(?<corpo>[A-Za-z0-9-]{10,})/g],
  ["google-api-key", /AIza(?<corpo>[0-9A-Za-z_-]{35})/g],
  ["supabase-token", /\bsbp_(?<corpo>[0-9a-fA-F]{40,})/g],
  ["supabase-secret", /\bsb_secret_(?<corpo>[A-Za-z0-9_-]{20,})/g],
  ["clickup-token", /\bpk_\d+_(?<corpo>[A-Z0-9]{25,})/g],
  ["voyage-key", /\bpa-(?<corpo>[A-Za-z0-9_-]{40,})/g, { aleatorio: true }],
  ["private-key-block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  // o jwt só começa no início de um trecho (nunca depois de um `-` dele) e o esquema da URL tem
  // no máximo 31 caracteres: sem isso, cada `-` de 1 MB de `a-a-a-…` relia o resto da linha
  // (custo quadrático, minutos por arquivo)
  ["jwt", /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g],
  ["url-com-senha", /\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s:@/]+:(?<corpo>[^\s:@/]{3,})@[^\s/]+/gi, { humano: true }],
  // `nome = "valor"`, `"nome": "valor"`, `\"nome\": \"valor\"` (código, JSON, YAML): valor entre aspas
  [
    "atribuicao-de-segredo",
    new RegExp(String.raw`${CAMPO}\s*${ATRIBUI}\s*(?<aspas>\\?["'])(?<corpo>${VALOR})\k<aspas>`, "g"),
    { humano: true },
  ],
  // `NOME=valor`, `nome: valor` sem aspas (.env, compose, shell, YAML, URL); o valor não pode
  // continuar em `.` ou `(` (atributo ou chamada de função, não segredo)
  [
    "atribuicao-de-segredo",
    new RegExp(String.raw`${CAMPO}[ \t]*${ATRIBUI}[ \t]*(?<corpo>${VALOR})(?![A-Za-z0-9_\-/+=.(])`, "g"),
    { humano: true, aleatorio: true },
  ],
];

/** Palavras que, como PARTE de um nome de campo, dizem que ele guarda segredo. */
const PALAVRAS_DE_SEGREDO = new Set(["apikey", "key", "token", "secret", "password", "passwd", "pwd"]);
/** As de senha: o valor pode ter sido escolhido por uma pessoa. */
const PALAVRAS_DE_SENHA = new Set(["password", "passwd", "pwd"]);

/**
 * Partes minúsculas de um nome composto, quebrado em `_`, `-`, camelCase e dígitos, em
 * qualquer caixa: `OPENAI_API_KEY`, `my_api_key`, `db-password`, `apiKey`, `APIKey`,
 * `accessToken`, `KEY2`. Assim uma palavra dentro de outra não vira parte: `MONKEY_BUSINESS`,
 * `tokenizer`, `MAX_TOKENS`.
 */
function partesDoNome(nome) {
  return nome
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // accessToken → access Token
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2") // APIKey → API Key
    .replace(/([A-Za-z])(\d)/g, "$1 $2") // KEY2 → KEY 2
    .split(/[\s_-]+/)
    .map((parte) => parte.toLowerCase());
}

/** Constante em CAIXA_ALTA (`OPENAI_API_KEY_V2`): o NOME de uma variável, não o valor dela. */
const CONSTANTE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
/**
 * camelCase/PascalCase só de letras, toda maiúscula (ou sigla) seguida de 2 ou mais minúsculas
 * (`AuthenticationTokenService`, `apiKeyConfigurationOptions`, `HTTPTokenProvider`): tipo,
 * classe ou variável. A parte aleatória de uma chave praticamente nunca tem essa forma.
 */
const CAMELCASE = /^[a-z]*(?:[A-Z]+[a-z]{2,})+$/;
/** Palavras minúsculas ligadas por `_` ou `-` (`get_secret_from_vault_v2`, `app-credentials-2024`): nome ou slug. */
const PALAVRAS_MINUSCULAS = /^[a-z]+\d*(?:[_-](?:[a-z]+\d*|\d+))+$/;
/** Trecho de caminho com cara de nome: `var`, `app2`, `Users`, `node_modules`, `ENV`, `2024` (ou vazio). */
const TRECHO_DE_CAMINHO = /^(?:[A-Za-z][a-z0-9_-]*|[A-Z0-9_-]+|[0-9_-]*)$/;
/** Caminho (`/var/lib/app2/dados`, `config/secrets/prod2`): tem `/` e todo trecho tem cara de nome, não de base64. */
const ehCaminho = (corpo) => corpo.includes("/") && corpo.split("/").every((t) => TRECHO_DE_CAMINHO.test(t));

/**
 * A atribuição `campo = corpo` pode guardar segredo? Uma parte do nome precisa ser palavra de
 * segredo, e o valor não pode ser referência: constante, caminho, camelCase (tipo ou classe,
 * como em `apiKey: ApiKeyConfigurationOptions`) ou palavras minúsculas (nome de função, chave
 * de dicionário, slug). Num campo de senha a pessoa pode ter escolhido uma frase: camelCase
 * vale (`CorrectHorseBatteryStaple`), e palavras minúsculas também, entre aspas ou ligadas por
 * `-` (que, sem aspas, não é nome de variável em código, como `hashed_password_v1`).
 */
function atribuiSegredo(campo, corpo, entreAspas) {
  const partes = partesDoNome(campo);
  if (!partes.some((p) => PALAVRAS_DE_SEGREDO.has(p))) return false;
  if (CONSTANTE.test(corpo) || ehCaminho(corpo)) return false;
  const senha = partes.some((p) => PALAVRAS_DE_SENHA.has(p));
  if (CAMELCASE.test(corpo)) return senha;
  if (!PALAVRAS_MINUSCULAS.test(corpo)) return true;
  return senha && (entreAspas || !corpo.includes("_"));
}

/** Valor inteiro que é só marcador (`user:pass@host`, `****`, `xxxx`). */
const MARCADOR_EXATO = /^(?:pass|pwd|x+|\*+)$/i;
/** Interpolação, reticências, `<…>` e máscara: o valor não está ali. */
const MARCADOR_SIMBOLO = /^\$|\$\{|[<>{}…]|\*{3,}|\.{3}/;
/** Frase de exemplo (até 60 caracteres no meio): `your-…-key`, `your_password_here`, `SUA_CHAVE_AQUI`. */
const MARCADOR_FRASE = /(?:^|[-_.])(?:your|sua|seu)[-_.](?:.{0,60}[-_.])?(?:here|aqui|key|chave|token|secret|segredo|senha|password)(?=$|[-_.])/i;
/**
 * Palavra que só documentação põe num valor (`…EXAMPLEKEY`, `changeme`, `REDACTED`): ninguém a
 * escolhe para senha, e com 7 ou mais letras não aparece por acaso numa chave aleatória.
 */
const MARCADOR_DOC = /example|exemplo|placeholder|change[-_]?me|replace[-_]?me|redacted/i;
/** Palavras de exemplo; longas o bastante para não aparecerem por acaso num valor aleatório. */
const MARCADOR_PALAVRA = /example|exemplo|placeholder|changeme|change_me|redacted|replace|dummy|sample|insira|coloque|chave|senha|segredo|secret|token|password|passwd/i;
/** Palavras curtas só contam isoladas por `-`, `_` ou `.` (`your-api-key-here`, `SUA_CHAVE_AQUI`). */
const MARCADOR_SEPARADO = /(?:^|[-_.])(?:your|sua|seu|minha|my|key|here|aqui|fake|test|teste|demo|foo|bar|abc|xxx)(?=$|[-_.])/i;

/**
 * Marcador que nem um valor escolhido por pessoa teria: máscara, interpolação, frase ou palavra
 * de exemplo, 6 caracteres iguais seguidos (`xxxxxx`) ou só meia dúzia de distintos em 16 ou mais.
 */
function marcadorForte(corpo) {
  if (MARCADOR_EXATO.test(corpo) || MARCADOR_SIMBOLO.test(corpo) || MARCADOR_FRASE.test(corpo) || MARCADOR_DOC.test(corpo)) return true;
  const s = corpo.toLowerCase();
  return (s.length >= 16 && new Set(s).size <= 6) || /(.)\1{5}/.test(s);
}

/** 6 caracteres em sequência (`abcdef`, `123456`, `987654`): um valor aleatório de verdade praticamente não tem. */
function emSequencia(corpo) {
  const s = corpo.toLowerCase();
  let sobe = 1;
  let desce = 1;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    sobe = d === 1 ? sobe + 1 : 1;
    desce = d === -1 ? desce + 1 : 1;
    if (sobe >= 6 || desce >= 6) return true;
  }
  return false;
}

/**
 * Corpo longo e variado: 40 ou mais caracteres, 20 ou mais distintos, com minúscula, maiúscula
 * e dígito. É a cara da parte aleatória de uma chave gerada; frase de exemplo não chega lá.
 */
const longoEVariado = (corpo) =>
  corpo.length >= 40 && new Set(corpo).size >= 20 && /[a-z]/.test(corpo) && /[A-Z]/.test(corpo) && /\d/.test(corpo);

/**
 * Corpo de chave gerada por máquina (prefixo fixo + parte aleatória) que é marcador de
 * documentação? Além do marcador forte: 6 caracteres em sequência ou palavra de exemplo. A
 * palavra só conta em corpo curto ou pouco variado: numa chave longa e variada, um trecho
 * como `_key-`, `-test_` ou `my-` no começo aparece por acaso, e ali só valem o marcador
 * forte e a sequência.
 */
function pareceMarcador(corpo) {
  if (marcadorForte(corpo) || emSequencia(corpo)) return true;
  if (longoEVariado(corpo)) return false;
  return MARCADOR_PALAVRA.test(corpo) || MARCADOR_SEPARADO.test(corpo);
}

const pareceAleatorio = (corpo) => /\d/.test(corpo) || (/[a-z]/.test(corpo) && /[A-Z]/.test(corpo));

export function detectSecret(text) {
  for (const [nome, re, { humano = false, aleatorio = false } = {}] of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const { campo, corpo, aspas } = m.groups ?? {};
      if (corpo === undefined) return nome;
      if (campo !== undefined && !atribuiSegredo(campo, corpo, aspas !== undefined)) continue;
      if (humano ? marcadorForte(corpo) : pareceMarcador(corpo)) continue;
      if (aleatorio && !pareceAleatorio(corpo)) continue;
      return nome;
    }
  }
  return null;
}

async function* walk(absDir, relDir) {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isSymbolicLink()) continue; // nunca atravessa link/junction
    if (e.isDirectory()) {
      if (PRUNE_DIRS.has(e.name)) continue;
      yield* walk(abs, rel);
    } else if (e.isFile()) {
      yield { abs, rel, name: e.name };
    }
  }
}

function kindOf(ext) {
  if (DOC_EXT.has(ext)) return "doc";
  if (CONFIG_EXT.has(ext)) return "config";
  if (CODE_EXT.has(ext)) return "code";
  return null;
}

/**
 * Sinais de um Megabrain: os MESMOS de `sinaisDe` em `lib/primeiro-uso.ts`, para o app e o
 * populate concordarem sobre o que é um Megabrain. `knowledge/` e `engine/`; ou `knowledge/`
 * e duas destas: `agents/`, `core/`, `.aiox-core/` (uma só é comum demais em qualquer
 * monorepo). Devolve as pastas que o identificaram, ou `null`.
 */
export function sinaisDeMegabrain(raiz) {
  const ehPasta = (nome) => {
    try {
      return statSync(path.join(raiz, nome)).isDirectory();
    } catch {
      return false;
    }
  };
  if (!ehPasta("knowledge")) return null;
  const outros = ["agents", "core", ".aiox-core"].filter(ehPasta);
  if (ehPasta("engine")) return ["knowledge", "engine", ...outros];
  return outros.length >= 2 ? ["knowledge", ...outros] : null;
}

/** Variável do ambiente do terminal; em branco vale como ausente (como `lerEnv` do app). */
const doAmbiente = (nome) => process.env[nome]?.trim() || undefined;

/** Ordem em que o `next dev` carrega os arquivos de ambiente: o primeiro que define a variável vence. */
export const ARQUIVOS_ENV_DEV = [".env.development.local", ".env.local", ".env.development", ".env"];

/** Bloco que o módulo `ambiente` mantém no `.env.local` (marcas de ambiente.mjs). */
const BLOCO_GERENCIADO = /^# >>> populate-megabrain[^\n]*\n[\s\S]*?^# <<< populate-megabrain[^\n]*$/gm;

/**
 * Valor de uma variável nos arquivos `.env*` do app (o 1º arquivo que a define vence; dentro dele,
 * a última linha, pelas regras do dotenv do Next: `variavelDoEnv`). `null` se nenhum a define. Só
 * os arquivos: o `process.env` do terminal fica com quem chama. Com `semBloco` as linhas do bloco
 * gerenciado do `.env.local` são ignoradas: o que o populate leu antes de regravar o bloco não
 * pode valer mais que o que você escreveu fora dele.
 *
 * @returns {{ valor: string, arquivo: string, linha: number } | null}
 */
export function variavelDosArquivosDoApp(appRoot, nome, { semBloco = false } = {}) {
  for (const arquivo of ARQUIVOS_ENV_DEV) {
    let texto;
    try { texto = readFileSync(path.join(appRoot, arquivo), "utf8"); } catch { continue; }
    if (semBloco) texto = texto.replace(/\r\n?/g, "\n").replace(BLOCO_GERENCIADO, "");
    const v = variavelDoEnv(texto, nome);
    if (v) return { ...v, arquivo };
  }
  return null;
}

/* ------------------------------------------------------------------ exclusão por configuração */

/** Variável (terminal ou `.env*` do app) com os caminhos do mega-brain lido que NUNCA entram em `data/`. */
export const VARIAVEL_EXCLUIR = "BILHON_POPULATE_EXCLUIR";
/** Motivo registrado em `excluded` para o arquivo barrado por `BILHON_POPULATE_EXCLUIR`. */
export const MOTIVO_EXCLUSAO = "excluido-pela-configuracao";

/** Entrada da lista → caminho posix relativo à raiz do mega-brain (barras `/` ou `\`, sem `./` nem `/` na frente). */
const normalizarEntrada = (s) =>
  s.trim().replace(/^["']|["']$/g, "").trim().replace(/\\+/g, "/").replace(/\/+/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");

/**
 * Glob simples → RegExp (caixa ignorada: na dúvida, exclui a mais). `**` atravessa pastas (`a/**\/x` casa
 * `a/x` também), `*` não passa de uma `/`, `?` é um caractere. O padrão casa o caminho inteiro ou qualquer
 * pasta que o contenha (`squads/privado` exclui tudo dentro de `squads/privado/`).
 */
function globParaRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}(?:/.*)?$`, "i");
}

/**
 * Lista de exclusão: `{ entradas, origem, ignoradas, vazia, exclui(rel) }`. `entradas` são as normalizadas
 * (separadas por vírgula ou ponto e vírgula); `ignoradas` as que saem da raiz (`..`) ou são absolutas — erro de
 * digitação ou tentativa de apontar para fora, nunca vale. `exclui(rel)` aceita caminho posix relativo à raiz do
 * mega-brain e registra quais entradas casaram (`casadas`), para o aviso de entrada sem correspondência.
 *
 * @param {string | null | undefined} bruto
 * @param {string | null} [origem]
 * @returns {{ entradas: string[], origem: string | null, ignoradas: string[], vazia: boolean, exclui: (rel: string) => boolean, casadas: Set<string> }}
 */
export function compilarExclusoes(bruto, origem = null) {
  const entradas = [];
  const ignoradas = [];
  for (const parte of String(bruto ?? "").split(/[;,]/)) {
    const e = normalizarEntrada(parte);
    if (!e) continue;
    if (/^[A-Za-z]:/.test(e) || e.split("/").includes("..")) { ignoradas.push(e); continue; }
    if (!entradas.includes(e)) entradas.push(e);
  }
  const regras = entradas.map((entrada) => ({ entrada, re: globParaRegExp(entrada) }));
  const casadas = new Set();
  const exclui = (rel) => {
    if (!regras.length) return false;
    const r = normalizarEntrada(String(rel));
    let achou = false;
    for (const g of regras) if (g.re.test(r)) { casadas.add(g.entrada); achou = true; }
    return achou;
  };
  return { entradas, origem, ignoradas, vazia: regras.length === 0, exclui, casadas };
}

/**
 * Lê `BILHON_POPULATE_EXCLUIR`: o terminal vence o arquivo; nos `.env*` do app vale a ordem do `next dev`
 * (`variavelDosArquivosDoApp`); em branco vale como ausente. Sem a variável a lista é vazia e nada muda.
 */
export function lerExclusoesDoAmbiente(appRoot = APP_ROOT) {
  const terminal = doAmbiente(VARIAVEL_EXCLUIR);
  if (terminal) return compilarExclusoes(terminal, `terminal ${VARIAVEL_EXCLUIR}`);
  const arq = variavelDosArquivosDoApp(appRoot, VARIAVEL_EXCLUIR);
  if (arq?.valor) return compilarExclusoes(arq.valor, `${arq.arquivo} ${VARIAVEL_EXCLUIR}`);
  return compilarExclusoes("", null);
}

/** Exclusão ativa nesta execução: `{ repoRoot, lista }`. Fica aqui para os módulos concordarem sem passar o filtro de mão em mão. */
let exclusaoAtiva = null;

/**
 * Ativa a lista de exclusão para o mega-brain `ctx.repoRoot`. Usa `ctx.exclusoes` (lista já compilada, como a que
 * `main` põe no contexto); sem ela mantém a que o `scanRepo` deixou ativa para a mesma raiz ou, não havendo,
 * lê a variável. Todo módulo que lê o mega-brain diretamente a chama no começo. `ativarExclusoes(null)` desliga.
 * Devolve a lista ativa.
 */
export function ativarExclusoes(ctx) {
  if (!ctx) { exclusaoAtiva = null; return null; }
  if (!ctx.exclusoes && exclusaoAtiva && exclusaoAtiva.repoRoot === path.resolve(ctx.repoRoot)) return exclusaoAtiva.lista;
  const lista = ctx.exclusoes ?? lerExclusoesDoAmbiente(ctx.appRoot ?? APP_ROOT);
  exclusaoAtiva = lista.vazia ? null : { repoRoot: path.resolve(ctx.repoRoot), lista };
  return lista;
}

/** `rel` (posix, relativo à raiz do mega-brain ativo) está excluído pela configuração? */
export const relExcluido = (rel) => (exclusaoAtiva ? exclusaoAtiva.lista.exclui(rel) : false);

/** Caminho absoluto dentro do mega-brain ativo que a configuração exclui? Fora dele (ou sem exclusão ativa): nunca. */
export function caminhoExcluido(abs) {
  if (!exclusaoAtiva) return false;
  const r = path.relative(exclusaoAtiva.repoRoot, path.resolve(abs));
  if (!r || r.startsWith("..") || path.isAbsolute(r)) return false;
  return exclusaoAtiva.lista.exclui(toPosix(r));
}

/**
 * Raiz do mega-brain: `--repo`, `BILHON_MEGABRAIN_ROOT` (a mesma variável do primeiro uso do
 * app) no ambiente do terminal e, se o terminal não a define, nos `.env*` do app (`.env.local`
 * inclusive; o terminal vence o arquivo, como no Next; em branco vale como ausente),
 * `MEGABRAIN_REPO_ROOT` (nome antigo, ainda aceito) ou dois níveis acima do app
 * (`<raiz>/apps/knowledge`). `--repo` e o terminal valem a partir da pasta atual; o valor do
 * arquivo, a partir da pasta do app (onde o `npm run dev` roda).
 */
export function resolveRepoRoot(override, appRoot = APP_ROOT) {
  return resolveRepoRootComOrigem(override, appRoot).raiz;
}

/**
 * Como `resolveRepoRoot`, mas devolve também de onde veio a raiz: `{ raiz, origem }`, com `origem` em
 * `--repo`, `terminal BILHON_MEGABRAIN_ROOT`, `<arquivo> BILHON_MEGABRAIN_ROOT` (o `.env*` do app que a define,
 * ex.: `.env.local BILHON_MEGABRAIN_ROOT`), `MEGABRAIN_REPO_ROOT` ou `padrão ../..`. Mesmas regras e mesmos erros.
 */
export function resolveRepoRootComOrigem(override, appRoot = APP_ROOT) {
  const doArquivo = override ? null : variavelDosArquivosDoApp(appRoot, "BILHON_MEGABRAIN_ROOT");
  const doTerminal = override ? undefined : doAmbiente("BILHON_MEGABRAIN_ROOT");
  const antigo = doAmbiente("MEGABRAIN_REPO_ROOT");
  let root;
  let origem;
  if (override) { root = path.resolve(override); origem = "--repo"; }
  else if (doTerminal) { root = path.resolve(doTerminal); origem = "terminal BILHON_MEGABRAIN_ROOT"; }
  else if (doArquivo?.valor) { root = path.resolve(appRoot, doArquivo.valor); origem = `${doArquivo.arquivo} BILHON_MEGABRAIN_ROOT`; }
  else if (antigo) { root = path.resolve(antigo); origem = "MEGABRAIN_REPO_ROOT"; }
  else { root = path.resolve(path.join(appRoot, "..", "..")); origem = "padrão ../.."; }
  if (root === path.resolve(appRoot)) throw new Error("populate: a raiz do repositório não pode ser o próprio app.");
  if (!sinaisDeMegabrain(root)) {
    throw new Error(
      `populate: "${root}" não parece um Megabrain (precisa de knowledge/ e engine/, ou knowledge/ e duas destas: agents/, core/, .aiox-core/). ` +
        "Use --repo <pasta> ou BILHON_MEGABRAIN_ROOT (terminal ou .env.local).",
    );
  }
  return { raiz: root, origem };
}

/**
 * Registro da fonte lida, para o `data/.populated.json`: `{ raiz, origem, commit }`. `raiz` é relativa à pasta do
 * app (posix; só vira absoluta se estiver em outro volume), `origem` é a de `resolveRepoRootComOrigem` e `commit`
 * é o HEAD completo quando a própria raiz é a de um repositório git (`null` sem git, ou numa pasta dentro de
 * outro repositório). Só leitura: nada é gravado no repositório lido.
 */
export function descreverFonte(appRoot, repoRoot, origem) {
  const raiz = path.resolve(repoRoot);
  const rel = toPosix(path.relative(path.resolve(appRoot), raiz)) || ".";
  let commit = null;
  try {
    const git = (...args) => execFileSync("git", ["-C", raiz, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }).trim();
    const topo = git("rev-parse", "--show-toplevel");
    if (path.relative(path.resolve(topo), raiz) === "") commit = git("rev-parse", "HEAD") || null;
  } catch {
    commit = null;
  }
  return { raiz: rel, origem, commit };
}

const contemCaminho = (pai, filho) => {
  const r = path.relative(pai, filho);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
};

/**
 * `BILHON_ROOT` com que o app vai ler os dados populados (contenção e base dos caminhos
 * relativos do registro): a do terminal, senão a dos `.env*` FORA do bloco gerenciado (relativa
 * à pasta do app), senão a que o módulo `ambiente` grava (o repositório, quando contém o app),
 * senão a pasta do app (o padrão do app).
 */
export function raizEfetivaDoApp(appRoot, repoRoot) {
  const sua = doAmbiente("BILHON_ROOT") ?? (variavelDosArquivosDoApp(appRoot, "BILHON_ROOT", { semBloco: true })?.valor || undefined);
  if (sua) return path.resolve(appRoot, sua);
  return contemCaminho(path.resolve(repoRoot), path.resolve(appRoot)) ? path.resolve(repoRoot) : path.resolve(appRoot);
}

/**
 * Prefixo (posix) que leva da `BILHON_ROOT` efetiva ao repositório lido: "" quando a raiz é o
 * próprio repositório (caso padrão, repositório = ../..) ou quando ele não está dentro dela (então
 * nenhum prefixo faria o caminho resolver e o `ambiente` avisa). É o que o registro do Agente
 * põe na frente dos caminhos `observed` e do `path` de repos.json para eles resolverem contra a raiz.
 */
export function prefixoDoRepositorio(appRoot, repoRoot) {
  const raiz = raizEfetivaDoApp(appRoot, repoRoot);
  const repo = path.resolve(repoRoot);
  if (!contemCaminho(raiz, repo)) return "";
  return toPosix(path.relative(raiz, repo));
}

function titleOf(rec) {
  const t = rec.text;
  if (rec.ext === ".md") {
    const fm = t.match(/^---\n([\s\S]*?)\n---/);
    const campo = fm?.[1].match(/^(?:title|name):\s*["']?(.+?)["']?\s*$/m);
    if (campo) return campo[1].trim();
    const h1 = t.match(/^#\s+(.+?)\s*$/m);
    if (h1) return h1[1].replace(/[*_`]/g, "").trim();
  } else if (rec.ext === ".yaml" || rec.ext === ".yml") {
    const campo = t.match(/^(?:title|name):\s*["']?(.+?)["']?\s*$/m);
    if (campo) return campo[1].trim();
  }
  const base = path.posix.basename(rec.rel);
  const generico = /^(readme|skill|agent|soul|squad|index|config|memory|activation|dna-config)\./i.test(base);
  const pai = path.posix.basename(path.posix.dirname(rec.rel));
  return generico && pai && pai !== "." ? `${humanize(pai)} — ${humanize(base)}` : humanize(base);
}

/**
 * Varre o mega-brain (SOMENTE LEITURA) e devolve `{ docs, excluded }`.
 *
 * Cada item de `docs`:
 *   rel, ext, bytes, kind ('doc'|'config'|'code'), area, colecao, tema, dominio, bucket,
 *   id        — slug único e estável (letras, números, hífen) — vai na URL /livro/<id>
 *   arquivo   — `<id><ext>`: nome do arquivo na estante (só kind 'doc')
 *   title     — título legível (único no corpus)
 *   text      — conteúdo (UTF-8, LF)
 *   words     — contagem de palavras
 *   sha256    — hash do texto
 * `excluded`: { rel, motivo } — nunca inclui o valor do segredo.
 */
/**
 * Lê UM arquivo do mega-brain com as mesmas regras de segurança da varredura
 * (nome sensível, > 1 MB, binário, vazio, segredo no conteúdo; BOM/CRLF
 * normalizados). Devolve `{ text }` ou `{ motivo }` — o valor de um segredo
 * nunca é devolvido. Para módulos que leem arquivos fora de ROOT_DIRS (p.ex.
 * artefatos MCE em `.data/`), sem afrouxar o contrato do corpus.
 */
export async function lerTextoSeguro(abs) {
  const name = path.basename(abs);
  if (SENSITIVE_NAME.test(name)) return { motivo: "nome-sensivel" };
  if (caminhoExcluido(abs)) return { motivo: MOTIVO_EXCLUSAO };
  let st;
  try {
    st = await lstat(abs);
  } catch {
    return { motivo: "ausente" };
  }
  if (!st.isFile()) return { motivo: "nao-e-arquivo" };
  if (st.size > MAX_BYTES) return { motivo: "maior-que-1mb" };
  let text;
  try {
    text = (await readFile(abs, "utf8")).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  } catch {
    return { motivo: "ilegivel" };
  }
  if (text.includes("\u0000")) return { motivo: "binario" };
  if (!text.trim()) return { motivo: "vazio" };
  const segredo = detectSecret(text);
  if (segredo) return { motivo: `conteudo-sensivel:${segredo}` };
  return { text };
}

/**
 * @param {string} repoRoot
 * @param {{ includePersonal?: boolean, exclusoes?: ReturnType<typeof compilarExclusoes>, appRoot?: string }} [opcoes]
 *   `exclusoes`: lista de BILHON_POPULATE_EXCLUIR já compilada; sem ela lê a do ambiente do app (`appRoot`).
 */
export async function scanRepo(repoRoot, { includePersonal = false, exclusoes = undefined, appRoot = APP_ROOT } = {}) {
  const found = [];
  const excluded = [];
  // BILHON_POPULATE_EXCLUIR: lista do chamador (`exclusoes`) ou a do ambiente do app; fica ativa para os módulos
  const lista = exclusoes ?? lerExclusoesDoAmbiente(appRoot);
  ativarExclusoes({ repoRoot, appRoot, exclusoes: lista });
  const pelaConfiguracao = [];

  const consider = async ({ abs, rel, name }) => {
    // antes de qualquer outra regra e de qualquer leitura: o arquivo excluído nem é aberto
    if (lista.exclui(rel)) {
      const ext0 = path.posix.extname(name).toLowerCase();
      if (!SKIP_BASENAMES.has(name) && kindOf(ext0)) { excluded.push({ rel, motivo: MOTIVO_EXCLUSAO }); pelaConfiguracao.push(rel); }
      return;
    }
    if (SKIP_BASENAMES.has(name) || /\.min\.(js|css)$/.test(name)) return;
    const ext = path.posix.extname(name).toLowerCase();
    const kind = kindOf(ext);
    if (!kind) return;
    if (SENSITIVE_NAME.test(name)) return void excluded.push({ rel, motivo: "nome-sensivel" });
    if (!includePersonal && /^(knowledge|agents)\/personal\//.test(rel)) {
      return void excluded.push({ rel, motivo: "bucket-pessoal" });
    }
    const st = await lstat(abs);
    if (st.size > MAX_BYTES) return void excluded.push({ rel, motivo: "maior-que-1mb" });
    let text;
    try {
      text = (await readFile(abs, "utf8")).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    } catch {
      return void excluded.push({ rel, motivo: "ilegivel" });
    }
    if (text.includes("\u0000")) return void excluded.push({ rel, motivo: "binario" });
    if (!text.trim()) return void excluded.push({ rel, motivo: "vazio" });
    const segredo = detectSecret(text);
    if (segredo) return void excluded.push({ rel, motivo: `conteudo-sensivel:${segredo}` });
    const c = classify(rel, kind);
    found.push({
      rel, ext, bytes: st.size, kind, ...c, text,
      words: (text.match(/\S+/g) ?? []).length,
      sha256: sha256(text),
    });
  };

  // Entrada de primeiro nível: o mesmo crivo de walk() para os filhos. lstat não segue
  // link/junction (existsSync seguiria, para fora do repositório): o link é registrado e
  // pulado. Devolve o stat da entrada real, ou null (ausente ou link).
  const entrada = async (abs, rel) => {
    let st;
    try {
      st = await lstat(abs);
    } catch {
      return null;
    }
    if (st.isSymbolicLink()) {
      excluded.push({ rel, motivo: "link-ou-junction" });
      return null;
    }
    return st;
  };

  for (const name of ROOT_FILES) {
    const abs = path.join(repoRoot, name);
    if ((await entrada(abs, name))?.isFile()) await consider({ abs, rel: name, name });
  }
  for (const d of ROOT_DIRS) {
    const abs = path.join(repoRoot, d);
    if ((await entrada(abs, d))?.isDirectory()) for await (const f of walk(abs, d)) await consider(f);
  }
  if ((await entrada(path.join(repoRoot, ".claude"), ".claude"))?.isDirectory()) {
    for (const name of CLAUDE_FILES) {
      const abs = path.join(repoRoot, ".claude", name);
      if ((await entrada(abs, `.claude/${name}`))?.isFile()) await consider({ abs, rel: `.claude/${name}`, name });
    }
    for (const d of CLAUDE_DIRS) {
      const abs = path.join(repoRoot, ".claude", d);
      if ((await entrada(abs, `.claude/${d}`))?.isDirectory()) for await (const f of walk(abs, `.claude/${d}`)) await consider(f);
    }
  }
  const gh = path.join(repoRoot, ".github");
  if ((await entrada(gh, ".github"))?.isDirectory()) for await (const f of walk(gh, ".github")) if (f.name.endsWith(".md")) await consider(f);

  found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  // ids únicos e estáveis (ordem por caminho); título único (desempata pelo diretório)
  const ids = new Set();
  const titulos = new Map();
  for (const rec of found) {
    const semExt = rec.rel.slice(0, rec.rel.length - rec.ext.length);
    let id = slugify(semExt).slice(0, 80).replace(/-+$/, "") || "doc";
    if (ids.has(id)) id = `${id.slice(0, 72).replace(/-+$/, "")}-${sha256(rec.rel).slice(0, 6)}`;
    ids.add(id);
    rec.id = id;
    rec.arquivo = `${id}${rec.ext}`;
    rec.title = titleOf(rec);
    titulos.set(rec.title, [...(titulos.get(rec.title) ?? []), rec]);
  }
  // desempate em degraus: diretório → extensão → id (o id é único, então termina sempre)
  for (const grupo of titulos.values()) {
    if (grupo.length < 2) continue;
    for (const rec of grupo) {
      const dir = path.posix.dirname(rec.rel);
      rec.title = `${rec.title} (${dir === "." ? "raiz" : dir})`;
    }
  }
  for (const degrau of [(r) => `${r.title} [${r.ext.slice(1)}]`, (r) => `${r.title} [${r.id}]`]) {
    const vistos = new Map();
    for (const rec of found) vistos.set(rec.title, [...(vistos.get(rec.title) ?? []), rec]);
    for (const grupo of vistos.values()) if (grupo.length > 1) for (const rec of grupo) rec.title = degrau(rec);
  }
  const exclusao = await resumoDeExclusao(repoRoot, lista, pelaConfiguracao);
  return { docs: found, excluded, exclusao };
}

/**
 * Resumo da exclusão por configuração para o scan e o `.populated.json`:
 * `{ origem, entradas, arquivos, semCorrespondencia, ignoradas }`. Entrada sem correspondência = nenhum arquivo
 * varrido casou e, se for caminho literal, também não existe no disco (erro de digitação); `ignoradas` saem da
 * raiz (`..`) ou são absolutas. Sem a variável: `null`.
 */
async function resumoDeExclusao(repoRoot, lista, arquivos) {
  if (lista.vazia && !lista.ignoradas.length) return null;
  const semCorrespondencia = [];
  for (const entrada of lista.entradas) {
    if (lista.casadas.has(entrada)) continue;
    if (!/[*?]/.test(entrada)) {
      try { await lstat(path.join(repoRoot, ...entrada.split("/"))); continue; } catch { /* não existe */ }
    }
    semCorrespondencia.push(entrada);
  }
  return {
    origem: lista.origem,
    entradas: lista.entradas,
    arquivos: [...arquivos].sort(),
    semCorrespondencia,
    ignoradas: lista.ignoradas,
  };
}

/** Avisos legíveis do resumo de exclusão (para o log do scan). */
export function avisosDeExclusao(exclusao) {
  if (!exclusao) return [];
  const out = [];
  for (const e of exclusao.semCorrespondencia) out.push(`${VARIAVEL_EXCLUIR}: "${e}" não casa nenhum arquivo do mega-brain lido — confira a digitação`);
  for (const e of exclusao.ignoradas) out.push(`${VARIAVEL_EXCLUIR}: "${e}" ignorado (precisa ser caminho relativo à raiz do mega-brain, sem ..)`);
  return out;
}
