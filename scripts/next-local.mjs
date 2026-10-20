import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const command = process.argv[2];
if (!["build", "start", "dev"].includes(command)) throw new Error("Use build, start ou dev.");
// resolve pelo Node (acha o pacote local ou um hoistado em node_modules acima desta pasta)
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const args = command === "build" ? [] : ["--port", "3300", "--hostname", "127.0.0.1"];
const child = spawn(process.execPath, [next, command, ...args, ...process.argv.slice(3)], {
  stdio: "inherit",
  // o template não envia nada a terceiros por padrão: sem isto o Next manda telemetria anônima
  env: { ...process.env, NEXT_DIST_DIR: command === "dev" ? ".next" : ".next-build", NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("error", () => { process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
