/** Gate local/CI: examina apenas arquivos versionados, nunca arquivos privados ignorados. */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const arquivos = execFileSync("git", ["ls-files", "-z"], { cwd: raiz, encoding: "utf8" }).split("\0").filter(Boolean);
if (!arquivos.length) throw new Error("Nenhum arquivo versionado: revise e prepare o índice antes de verificar a publicação.");
const problemas = [];
const catalogo = JSON.parse(readFileSync(path.join(raiz, "fixtures/demo/livros.json"), "utf8"));
const pdfs = new Set(catalogo.map((l) => `fixtures/demo/livros/${l.arquivo}`));
const segredos = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{35,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
];
for (const arquivo of arquivos) {
  if (/^(?:data|node_modules|\.next|\.next-build|tmp|\.tmp)\//.test(arquivo)
      || (/(?:^|\/)\.env(?:\.|$)/.test(arquivo) && arquivo !== ".env.example")
      || /\.(?:pem|p12|key|db|sqlite|sqlite3)$/i.test(arquivo)) problemas.push(`${arquivo}: arquivo local/privado versionado`);
  const abs = path.join(raiz, arquivo);
  if (/\.pdf$/i.test(arquivo)) {
    if (!pdfs.has(arquivo)) problemas.push(`${arquivo}: PDF fora do catálogo original revisado`);
    if (statSync(abs).size > 2 * 1024 * 1024) problemas.push(`${arquivo}: PDF de demonstração inesperadamente grande`);
    continue;
  }
  if (/\.(?:png|jpg|jpeg|webp|gif|woff2?)$/i.test(arquivo)) continue;
  const texto = readFileSync(abs, "utf8");
  if (segredos.some((regra) => regra.test(texto))) problemas.push(`${arquivo}: padrão de segredo reconhecido (valor omitido)`);
}
for (const pdf of pdfs) if (!arquivos.includes(pdf)) problemas.push(`${pdf}: arquivo do catálogo não versionado`);
const manifesto = JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8"));
if (manifesto.license !== "MIT" || !arquivos.includes("LICENSE")) problemas.push("Licença MIT ausente ou incoerente");
if (problemas.length) {
  console.error(problemas.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Publicação: ${arquivos.length} arquivos versionados; ${pdfs.size} PDFs originais; nenhum padrão de segredo reconhecido.`);
  console.log("Este gate não comprova direitos de terceiros nem substitui revisão do histórico e do conteúdo.");
}
