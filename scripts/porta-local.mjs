/**
 * Porta do `npm run dev` e do `npm start` (scripts/next-local.mjs).
 *
 * O Next só lê o `.env.local` depois de escolher a porta, por isso a linha `PORT=` é lida
 * aqui, com as mesmas regras do dotenv que o Next usa (16.3.1, embutido em @next/env):
 * vale a ÚLTIMA definição do arquivo (em branco inclusive), `export PORT=` é aceito,
 * aspas e comentário no fim da linha (`PORT=3301 # minha porta`) saem, e o BOM do início
 * do arquivo não atrapalha. Como no Next, `PORT` do ambiente do terminal vence o arquivo.
 * Sem nenhuma das duas (ou em branco), a porta é a padrão: 3300. A expansão `$OUTRA` do
 * Next não é feita: na linha `PORT=` vai o número, e outro valor para o início com uma
 * mensagem que diz de onde ele veio.
 */

export const PORTA_PADRAO = "3300";

/**
 * Expressão de linha do dotenv 16.3.1 (`parse`), copiada sem mudança: a mesma que o
 * @next/env aplica ao `.env.local`. `\s` também casa o BOM (U+FEFF) do início do arquivo.
 */
const LINHA_DOTENV =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

/**
 * A definição de `nome` que o dotenv adotaria para este texto: a última. `null` quando o
 * texto não define a variável. `valor` vem sem aspas, sem comentário e sem espaços nas pontas
 * (pode ser ""); `linha` é a linha do arquivo (1 = primeira), para as mensagens. É o leitor
 * único de `.env*` dos scripts: a porta (aqui) e a raiz do Megabrain do populate dependem dele.
 *
 * @param {string | null | undefined} texto conteúdo do arquivo `.env*`
 * @param {string} nome nome da variável
 * @returns {{ valor: string, linha: number } | null}
 */
export function variavelDoEnv(texto, nome) {
  if (typeof texto !== "string" || texto === "") return null;
  const normalizado = texto.replace(/\r\n?/g, "\n"); // como o dotenv
  const re = new RegExp(LINHA_DOTENV.source, LINHA_DOTENV.flags);
  let achada = null;
  let m;
  while ((m = re.exec(normalizado)) !== null) {
    if (m[1] !== nome) continue;
    let valor = (m[2] ?? "").trim();
    valor = valor.replace(/^(['"`])([\s\S]*)\1$/gm, "$2"); // aspas do começo e do fim, como no dotenv
    // a casada pode começar em linhas em branco anteriores (`^\s*`): a linha é a do nome
    const inicioDoNome = m.index + m[0].match(/^\s*(?:export\s+)?/)[0].length;
    const linha = normalizado.slice(0, inicioDoNome).split("\n").length;
    achada = { valor, linha };
  }
  return achada;
}

/**
 * A definição de `PORT` que o dotenv adotaria para este texto (a última), ou `null`.
 *
 * @param {string | null | undefined} texto conteúdo do `.env.local`
 * @returns {{ valor: string, linha: number } | null}
 */
export function portaDoEnvLocal(texto) {
  return variavelDoEnv(texto, "PORT");
}

/** Porta válida: só dígitos, de 1 a 65535. Devolve o número como texto (sem zeros à esquerda). */
function validarPorta(valor, origem) {
  const n = /^\d{1,5}$/.test(valor) ? Number(valor) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    const mostrado = valor.length > 40 ? `${valor.slice(0, 40)}…` : valor;
    throw new Error(
      `${origem} é inválida: "${mostrado}". Use um número inteiro de 1 a 65535, ou deixe em branco para a porta padrão (${PORTA_PADRAO}).`,
    );
  }
  return String(n);
}

/**
 * Porta a usar: `PORT` do ambiente do terminal (não vazia) vence; senão a última `PORT=` do
 * `.env.local` (não vazia); senão 3300. Porta inválida: erro com a origem e o valor.
 *
 * @param {string | null | undefined} textoDoEnvLocal conteúdo do `.env.local` (`null` se ele não existe)
 * @param {Record<string, string | undefined>} [env] ambiente do processo (padrão: `process.env`)
 * @returns {string}
 */
export function lerPorta(textoDoEnvLocal, env = process.env) {
  const doTerminal = typeof env?.PORT === "string" ? env.PORT.trim() : "";
  if (doTerminal) return validarPorta(doTerminal, "PORT do ambiente do terminal");
  const doArquivo = portaDoEnvLocal(textoDoEnvLocal);
  if (doArquivo?.valor) return validarPorta(doArquivo.valor, `PORT do .env.local (linha ${doArquivo.linha})`);
  return PORTA_PADRAO;
}
