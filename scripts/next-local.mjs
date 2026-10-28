import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { lerPorta } from "./porta-local.mjs";

const command = process.argv[2];
if (!["build", "start", "dev"].includes(command)) throw new Error("Use build, start ou dev.");
// resolve pelo Node (acha o pacote local ou um hoistado em node_modules acima desta pasta)
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");

// Porta: `PORT` do ambiente do terminal, senão a última linha `PORT=` do .env.local (lida
// como o Next a leria: scripts/porta-local.mjs), senão 3300. O Next só lê o .env.local
// depois de escolher a porta, por isso a leitura aqui.
function porta() {
  let texto = null;
  try {
    texto = readFileSync(".env.local", "utf8");
  } catch {
    // sem .env.local: fica no padrão
  }
  try {
    return lerPorta(texto, process.env);
  } catch (e) {
    // porta inválida: só a mensagem (de onde veio e o que usar), sem pilha
    console.error(`next-local: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// `PORT` (terminal ou .env.local) troca a porta; o host continua 127.0.0.1
const args = command === "build" ? [] : ["--port", porta(), "--hostname", "127.0.0.1"];
const child = spawn(process.execPath, [next, command, ...args, ...process.argv.slice(3)], {
  stdio: "inherit",
  // o template não envia nada a terceiros por padrão: sem isto o Next manda telemetria anônima
  env: { ...process.env, NEXT_DIST_DIR: command === "dev" ? ".next" : ".next-build", NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("error", () => { process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
