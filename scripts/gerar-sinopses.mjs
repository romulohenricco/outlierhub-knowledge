/**
 * gerar-sinopses.mjs — gera uma sinopse curta de cada livro do catálogo com um
 * modelo LOCAL do Ollama e grava o sidecar livros-sinopses.json (ao lado do
 * niveis.json), lido por lib/livro-conteudo.ts na estante e na página do livro.
 *
 * Sem modelo configurado (BILHON_SINOPSES_MODEL em branco) o script não gera
 * nada e termina sem erro. Só gera o que ainda não tem sinopse; já gerada,
 * não é refeita (use --refazer). Os scripts leem o ambiente do terminal, não o
 * .env.local: exporte as variáveis antes.
 *
 * Uso: BILHON_SINOPSES_MODEL=<modelo do seu Ollama> node scripts/gerar-sinopses.mjs [--limite N] [--refazer]
 * Variáveis: BILHON_SINOPSES_MODEL, BILHON_OLLAMA_URL, BILHON_CATALOGO,
 * BILHON_LIVROS_DIR, BILHON_NIVEIS, BILHON_LIVROS_SINOPSES. Texto dos PDFs: pdftotext (opcional).
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = (nome) => (process.env[nome] ?? "").trim() || undefined;

const MODELO = env("BILHON_SINOPSES_MODEL");
const OLLAMA = (env("BILHON_OLLAMA_URL") ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const CATALOGO = env("BILHON_CATALOGO") ?? path.join(RAIZ, "data", "livros", "catalogo.json");
const LIVROS_DIR = path.resolve(env("BILHON_LIVROS_DIR") ?? path.join(RAIZ, "data", "livros", "arquivos"));
const NIVEIS = env("BILHON_NIVEIS") ?? path.join(RAIZ, "data", "livros", "niveis.json");
const SAIDA = env("BILHON_LIVROS_SINOPSES") ?? path.join(path.dirname(NIVEIS), "livros-sinopses.json");

const refazer = process.argv.includes("--refazer");
const iLimite = process.argv.indexOf("--limite");
const limite = iLimite > 0 ? Number(process.argv[iLimite + 1]) : Infinity;

if (!MODELO) {
  console.log("BILHON_SINOPSES_MODEL em branco: nada a gerar (defina um modelo do seu Ollama para ligar as sinopses).");
  process.exit(0);
}

async function lerJson(arquivo, padrao) {
  try {
    return JSON.parse(await readFile(arquivo, "utf-8"));
  } catch {
    return padrao;
  }
}

/** Começo do livro: arquivo texto direto ou as primeiras páginas do PDF. Fora da pasta de livros = vazio. */
async function textoDoLivro(livro) {
  const arquivo = path.resolve(LIVROS_DIR, livro.arquivo);
  if (!arquivo.startsWith(LIVROS_DIR + path.sep)) return "";
  try {
    if (livro.formato === "pdf") {
      const { stdout } = await exec("pdftotext", ["-f", "1", "-l", "12", "-enc", "UTF-8", arquivo, "-"], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 20_000,
      });
      return stdout;
    }
    return (await readFile(arquivo, "utf-8")).slice(0, 40_000);
  } catch {
    return "";
  }
}

async function sinopseDe(titulo, texto) {
  const prompt =
    `Escreva, em português, uma sinopse de 2 a 3 frases do livro "${titulo}", dizendo do que ele trata e a quem serve. ` +
    `Use só o que está no trecho abaixo; se o trecho não bastar, responda apenas "SEM_SINOPSE".\n\nTrecho:\n${texto.slice(0, 6000)}`;
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO, prompt, stream: false, options: { temperature: 0.2 } }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`Ollama respondeu ${r.status}`);
  const resposta = String((await r.json()).response ?? "").replace(/\s+/g, " ").trim();
  return resposta && !resposta.includes("SEM_SINOPSE") ? resposta : null;
}

async function gravar(porLivro) {
  await mkdir(path.dirname(SAIDA), { recursive: true });
  const tmp = `${SAIDA}.tmp`;
  await writeFile(tmp, JSON.stringify({ modelo: MODELO, porLivro }, null, 2));
  await rename(tmp, SAIDA); // gravação atômica: o app nunca lê um arquivo pela metade
}

const catalogo = await lerJson(CATALOGO, null);
if (!catalogo?.livros?.length) {
  console.log(`Sem catálogo em ${CATALOGO}: nada a gerar.`);
  process.exit(0);
}

const porLivro = (await lerJson(SAIDA, {})).porLivro ?? {};
let feitos = 0;
for (const livro of catalogo.livros) {
  if (feitos >= limite) break;
  if (porLivro[livro.arquivo]?.sinopse && !refazer) continue;
  const texto = await textoDoLivro(livro);
  if (texto.trim().length < 400) {
    console.log(`pulado (sem texto utilizável): ${livro.titulo}`);
    continue;
  }
  try {
    const sinopse = await sinopseDe(livro.titulo, texto);
    if (!sinopse) {
      console.log(`pulado (o modelo não achou base): ${livro.titulo}`);
      continue;
    }
    porLivro[livro.arquivo] = { sinopse };
    await gravar(porLivro);
    feitos++;
    console.log(`ok: ${livro.titulo}`);
  } catch (e) {
    console.error(`falhou (${livro.titulo}): ${e instanceof Error ? e.message : e}`);
    if (e instanceof TypeError) break; // Ollama fora do ar: não adianta insistir em cada livro
  }
}
console.log(`${feitos} sinopse(s) gerada(s) em ${SAIDA}`);
