#!/usr/bin/env node
/**
 * Páginas do template: uma branch e um worktree por página, para trabalhar cada uma de
 * forma isolada, sempre na mesma branch. O registro está em scripts/paginas.json e a regra
 * (a branch de página nunca é apagada) em docs/paginas.md.
 *
 *   node scripts/paginas.mjs listar          páginas, branches, rotas, portas e pastas
 *   node scripts/paginas.mjs status          confere branches, worktrees, travas, node_modules e ganchos
 *   node scripts/paginas.mjs criar           cria o que faltar (idempotente; nunca apaga nada)
 *   node scripts/paginas.mjs dev <pagina>    sobe o servidor de desenvolvimento da página, na porta dela
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REGISTRO = JSON.parse(readFileSync(path.join(AQUI, "paginas.json"), "utf8"));

const git = (args, cwd) =>
  execFileSync("git", args, { cwd: cwd || AQUI, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tenta = (args, cwd) => {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
};

// a raiz do repositório principal (o git-common-dir é a pasta .git dele), mesmo rodando de um worktree
const RAIZ = path.resolve(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]), "..");
const PASTA_WORKTREES = path.join(path.dirname(RAIZ), `${path.basename(RAIZ)}-worktrees`);
const HOOKS = path.join(RAIZ, ".githooks");

const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
const branchDe = (p) => `${REGISTRO.prefixoBranch}${p.nome}`;
const pastaDe = (p) => path.join(PASTA_WORKTREES, p.nome);
const rotaDe = (p) => path.join("app", ...p.rota.split("/").filter(Boolean), "page.tsx");

function worktreesRegistrados() {
  const saida = git(["worktree", "list", "--porcelain"], RAIZ);
  return saida.split(/\r?\n\r?\n/).map((bloco) => {
    const linhas = bloco.split(/\r?\n/);
    const pega = (k) => linhas.find((l) => l === k || l.startsWith(`${k} `))?.slice(k.length + 1);
    return { pasta: pega("worktree"), branch: pega("branch"), travado: linhas.some((l) => l === "locked" || l.startsWith("locked ")) };
  });
}

const branchExiste = (nome) => tenta(["show-ref", "--verify", "--quiet", `refs/heads/${nome}`], RAIZ) !== null;
const hooksOk = () => {
  const cfg = tenta(["config", "--get", "core.hooksPath"], RAIZ);
  return !!cfg && norm(cfg) === norm(HOOKS) && existsSync(path.join(HOOKS, "reference-transaction")) && existsSync(path.join(HOOKS, "pre-push"));
};

function criar() {
  if (!hooksOk()) {
    git(["config", "core.hooksPath", HOOKS.replace(/\\/g, "/")], RAIZ);
    console.log(`ganchos: core.hooksPath -> ${HOOKS}`);
  }
  for (const p of REGISTRO.paginas) {
    const branch = branchDe(p);
    const pasta = pastaDe(p);
    if (!branchExiste(branch)) {
      // clone novo: a página pode já ter trabalho publicado em origin/<branch>; a branch local tem de acompanhá-la
      if (tenta(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], RAIZ) !== null) {
        git(["branch", "--track", branch, `origin/${branch}`], RAIZ);
        console.log(`${p.nome}: branch ${branch} criada acompanhando origin/${branch}`);
      } else {
        git(["branch", branch, REGISTRO.base], RAIZ);
        console.log(`${p.nome}: branch ${branch} criada a partir de ${REGISTRO.base}`);
      }
    }
    let wt = worktreesRegistrados().find((w) => w.pasta && norm(w.pasta) === norm(pasta));
    if (!wt) {
      git(["worktree", "add", pasta, branch], RAIZ);
      console.log(`${p.nome}: worktree criado em ${pasta}`);
      wt = worktreesRegistrados().find((w) => w.pasta && norm(w.pasta) === norm(pasta));
    }
    if (wt && !wt.travado) {
      git(["worktree", "lock", "--reason", "pagina do template: nao remover (docs/paginas.md)", pasta], RAIZ);
      console.log(`${p.nome}: worktree travado`);
    }
    const modulos = path.join(pasta, "node_modules");
    if (!existsSync(modulos) && existsSync(path.join(RAIZ, "node_modules"))) {
      symlinkSync(path.join(RAIZ, "node_modules"), modulos, "junction");
      console.log(`${p.nome}: node_modules ligado ao do repositório principal`);
    }
  }
  return status();
}

function status() {
  const wts = worktreesRegistrados();
  let problemas = 0;
  const ruim = (msg) => {
    problemas += 1;
    return msg;
  };
  console.log(`ganchos (core.hooksPath -> .githooks): ${hooksOk() ? "ok" : ruim("FALTA — rode: node scripts/paginas.mjs criar")}`);
  for (const p of REGISTRO.paginas) {
    const pasta = pastaDe(p);
    const wt = wts.find((w) => w.pasta && norm(w.pasta) === norm(pasta));
    const partes = [
      `branch ${branchExiste(branchDe(p)) ? "ok" : ruim("FALTA")}`,
      `worktree ${wt ? (wt.branch === `refs/heads/${branchDe(p)}` ? "ok" : ruim("EM OUTRA BRANCH")) : ruim("FALTA")}`,
      `trava ${wt?.travado ? "ok" : ruim("FALTA")}`,
      `node_modules ${existsSync(path.join(pasta, "node_modules")) ? "ok" : ruim("FALTA")}`,
      `rota ${wt && existsSync(path.join(pasta, rotaDe(p))) ? "existe" : "ainda não existe"}`,
    ];
    console.log(`${p.nome.padEnd(12)} ${branchDe(p).padEnd(20)} ${p.rota.padEnd(16)} :${p.porta}  ${partes.join(" | ")}`);
  }
  if (!existsSync(path.join(RAIZ, "node_modules"))) {
    console.log("\nA pasta principal ainda não tem node_modules: rode 'npm ci' nela e depois 'node scripts/paginas.mjs criar'.");
  }
  console.log(problemas === 0 ? "\ntudo em ordem." : `\n${problemas} problema(s). Rode: node scripts/paginas.mjs criar`);
  return problemas;
}

function listar() {
  for (const p of REGISTRO.paginas) console.log(`${p.nome.padEnd(12)} ${branchDe(p).padEnd(20)} ${p.rota.padEnd(16)} :${p.porta}  ${pastaDe(p)}`);
}

function dev(nome) {
  const p = REGISTRO.paginas.find((x) => x.nome === nome);
  if (!p) {
    console.error(`página desconhecida: ${nome}. Páginas: ${REGISTRO.paginas.map((x) => x.nome).join(", ")}`);
    return 1;
  }
  const pasta = pastaDe(p);
  if (!existsSync(path.join(pasta, "node_modules"))) {
    console.error(`o worktree de '${nome}' não está pronto. Rode: node scripts/paginas.mjs criar`);
    return 1;
  }
  console.log(`${nome}: http://127.0.0.1:${p.porta}${p.rota}  (${pasta})`);
  const filho = spawn(process.execPath, ["scripts/next-local.mjs", "dev", "--port", String(p.porta)], { cwd: pasta, stdio: "inherit" });
  filho.on("exit", (codigo) => {
    process.exitCode = codigo || 0;
  });
  return 0;
}

const [comando, argumento] = process.argv.slice(2);
if (comando === "listar") listar();
else if (comando === "status") process.exitCode = status() === 0 ? 0 : 1;
else if (comando === "criar") process.exitCode = criar() === 0 ? 0 : 1;
else if (comando === "dev") process.exitCode = dev(argumento);
else {
  console.error("uso: node scripts/paginas.mjs <listar|status|criar|dev <pagina>>");
  process.exitCode = 2;
}
