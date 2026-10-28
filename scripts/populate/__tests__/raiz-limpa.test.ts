/**
 * Populate a partir de um clone limpo do Megabrain público ao lado do app: `BILHON_MEGABRAIN_ROOT=../mega-brain-oss`
 * e `BILHON_ROOT=..` no `.env.local` (área do usuário), sem nada no terminal. Cobre:
 *  - `resolveRepoRoot` lê a raiz do `.env.local` (terminal vence arquivo, `--repo` vence tudo, relativo vale a
 *    partir da pasta do app, o bloco gerenciado não conta para a `BILHON_ROOT`);
 *  - o registro do Agente grava `observed` e o `path` de repos.json com o prefixo da raiz até o clone, e o leitor
 *    do app (`lib/ecosystem.ts`) resolve todos; no caso padrão (raiz = repositório) nada muda;
 *  - o módulo `ambiente` não acusa problema nessa configuração, e acusa quando a raiz não contém o clone;
 *  - o primeiro uso: app e populate enxergam o mesmo clone e a pergunta é respondida.
 *
 * Tudo em pasta temporária (`<tmp>/apps/knowledge` + `<tmp>/apps/mega-brain-oss`): nenhum `.env.local` ou `data/`
 * reais são tocados.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import runAgente from "../agente.mjs";
import runAmbiente from "../ambiente.mjs";
import { descreverFonte, prefixoDoRepositorio, raizEfetivaDoApp, resolveRepoRoot, resolveRepoRootComOrigem, scanRepo } from "../common.mjs";
import { responderPrimeiroUso } from "../kanban.mjs";
import { detectarMegabrain } from "@/lib/primeiro-uso";
import { getEcosystem, limparCacheEcossistema } from "@/lib/ecosystem";
import { MODULOS } from "../../populate.mjs";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const APP = process.cwd();
const TS = "2026-10-28T12:00:00.000Z";
const GIT_AUSENTE = {
  ok: false, motivo: "sem git (teste)", inicial: new Set<string>(), depois: new Set<string>(), modificados: new Set<string>(),
  rastreados: new Set<string>(), head: null, origin: null, upstream: null,
};
type Linha = { rid: string; observed: string[] };

const criados: string[] = [];
afterAll(async () => {
  for (const d of criados) await rm(d, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  limparCacheEcossistema();
});

/** `<tmp>/apps/knowledge` (app) + `<tmp>/apps/mega-brain-oss` (clone limpo, mínimo) + `<tmp>/privado` (Megabrain que NÃO pode ser lido). */
async function cenario(envLocal?: string) {
  const base = path.join(APP, "node_modules", ".cache", "knowledge-tests");
  await mkdir(base, { recursive: true });
  const tmp = await mkdtemp(path.join(base, "populate-raiz-limpa-"));
  criados.push(tmp);
  const app = path.join(tmp, "apps", "knowledge");
  const oss = path.join(tmp, "apps", "mega-brain-oss");
  const privado = path.join(tmp, "privado");
  for (const repo of [oss, privado]) {
    await mkdir(path.join(repo, "knowledge"), { recursive: true });
    await mkdir(path.join(repo, "engine"), { recursive: true });
    await mkdir(path.join(repo, "squads", "s1"), { recursive: true });
    await writeFile(path.join(repo, "README.md"), "# Mega Brain\n\n> Sistema de teste do clone limpo.\n");
    await writeFile(path.join(repo, "squads", "s1", "squad.yaml"), "name: s1\ndescription: Squad de teste para o clone limpo do Megabrain público\n");
  }
  await mkdir(path.join(app, "data"), { recursive: true });
  if (envLocal !== undefined) await writeFile(path.join(app, ".env.local"), envLocal);
  return { tmp, app, oss, privado, data: path.join(app, "data") };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

const ENV_OSS = "# raiz à mão\nBILHON_MEGABRAIN_ROOT=../mega-brain-oss\nBILHON_ROOT=..\n";

async function ctxDe(x: Cenario, repoRoot: string) {
  const { docs, excluded } = await scanRepo(repoRoot);
  return { repoRoot, appRoot: x.app, dataDir: x.data, docs, excluded, opts: {}, resultados: {}, gitInfo: GIT_AUSENTE };
}
const lerLinhas = async (x: Cenario) =>
  (loadYaml(await readFile(path.join(x.data, "agente", "registro.yaml"), "utf8")) as { entities: Linha[] }).entities;

describe("resolveRepoRoot lê a raiz do .env.local", () => {
  it("BILHON_MEGABRAIN_ROOT do .env.local (relativo à pasta do app) vale sem nada no terminal", async () => {
    const x = await cenario(ENV_OSS);
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", "");
    expect(resolveRepoRoot(undefined, x.app)).toBe(x.oss);
  });

  it("terminal vence o arquivo; --repo vence os dois; em branco no arquivo vale como ausente", async () => {
    const x = await cenario(ENV_OSS);
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", x.privado);
    expect(resolveRepoRoot(undefined, x.app)).toBe(x.privado);
    expect(resolveRepoRoot(x.oss, x.app)).toBe(x.oss);
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", "");
    await writeFile(path.join(x.app, ".env.local"), "BILHON_MEGABRAIN_ROOT=\n");
    vi.stubEnv("MEGABRAIN_REPO_ROOT", x.privado);
    expect(resolveRepoRoot(undefined, x.app)).toBe(x.privado);
  });

  it("mesma semântica do dotenv: a última definição vale, aspas, export e comentário saem; .env.local vence .env", async () => {
    const x = await cenario('export BILHON_MEGABRAIN_ROOT="../privado-x" # velho\nBILHON_MEGABRAIN_ROOT=`../mega-brain-oss` # novo\r\n');
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", "");
    await writeFile(path.join(x.app, ".env"), `BILHON_MEGABRAIN_ROOT=${x.privado}\n`);
    expect(resolveRepoRoot(undefined, x.app)).toBe(x.oss);
  });

  it("raiz do arquivo que não parece Megabrain: erro que cita o .env.local", async () => {
    const x = await cenario("BILHON_MEGABRAIN_ROOT=../nao-existe\n");
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", "");
    expect(() => resolveRepoRoot(undefined, x.app)).toThrow(/não parece um Megabrain.*\.env\.local/);
  });
});

describe("origem da raiz lida e registro da fonte (log do populate e .populated.json)", () => {
  it("cada via diz de onde veio: --repo, terminal, .env.local, nome antigo e padrão ../..", async () => {
    const x = await cenario(ENV_OSS);
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", "");
    vi.stubEnv("MEGABRAIN_REPO_ROOT", "");
    expect(resolveRepoRootComOrigem(undefined, x.app)).toEqual({ raiz: x.oss, origem: ".env.local BILHON_MEGABRAIN_ROOT" });
    expect(resolveRepoRootComOrigem(x.privado, x.app)).toEqual({ raiz: x.privado, origem: "--repo" });
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", x.privado);
    expect(resolveRepoRootComOrigem(undefined, x.app)).toEqual({ raiz: x.privado, origem: "terminal BILHON_MEGABRAIN_ROOT" });

    vi.stubEnv("BILHON_MEGABRAIN_ROOT", "");
    await writeFile(path.join(x.app, ".env.local"), "BILHON_MEGABRAIN_ROOT=\n");
    vi.stubEnv("MEGABRAIN_REPO_ROOT", x.privado);
    expect(resolveRepoRootComOrigem(undefined, x.app)).toEqual({ raiz: x.privado, origem: "MEGABRAIN_REPO_ROOT" });

    // sem nada definido: o mega-brain que contém o app (<tmp>/apps/knowledge -> <tmp>), com seus sinais
    vi.stubEnv("MEGABRAIN_REPO_ROOT", "");
    const y = await cenario();
    await mkdir(path.join(y.tmp, "knowledge"), { recursive: true });
    await mkdir(path.join(y.tmp, "engine"), { recursive: true });
    expect(resolveRepoRootComOrigem(undefined, y.app)).toEqual({ raiz: y.tmp, origem: "padrão ../.." });
    // a função antiga devolve a mesma raiz
    expect(resolveRepoRoot(undefined, y.app)).toBe(y.tmp);
  });

  it("descreverFonte: raiz relativa ao app, origem e commit HEAD do clone; sem git, commit null", async () => {
    const x = await cenario(ENV_OSS);
    const semGit = descreverFonte(x.app, x.oss, ".env.local BILHON_MEGABRAIN_ROOT");
    expect(semGit).toEqual({ raiz: "../mega-brain-oss", origem: ".env.local BILHON_MEGABRAIN_ROOT", commit: null });

    const git = (...a: string[]) => execFileSync("git", ["-C", x.oss, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=teste", "-c", "user.email=teste@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "inicial");
    const fonte = descreverFonte(x.app, x.oss, "--repo");
    expect(fonte).toEqual({ raiz: "../mega-brain-oss", origem: "--repo", commit: git("rev-parse", "HEAD") });
    expect(fonte.commit).toMatch(/^[0-9a-f]{40}$/);

    // uma subpasta de outro repositório não herda o commit do repositório de fora
    const sub = path.join(x.oss, "squads");
    expect(descreverFonte(x.app, sub, "--repo").commit).toBeNull();
    // o repositório lido não foi alterado além do que o próprio teste fez (sem arquivo novo no commit)
    expect(git("status", "--porcelain")).toBe("");
  });
});

describe("prefixo do repositório sob a BILHON_ROOT efetiva", () => {
  it("BILHON_ROOT=.. com o clone ao lado: prefixo é a pasta do clone; raiz = repositório: vazio", async () => {
    const x = await cenario(ENV_OSS);
    vi.stubEnv("BILHON_ROOT", "");
    expect(raizEfetivaDoApp(x.app, x.oss)).toBe(path.join(x.tmp, "apps"));
    expect(prefixoDoRepositorio(x.app, x.oss)).toBe("mega-brain-oss");

    // caso padrão: o repositório contém o app (<mb>/apps/knowledge) e nada define a raiz
    const y = await cenario("");
    expect(prefixoDoRepositorio(y.app, y.tmp)).toBe("");
    // raiz sua igual ao repositório
    await writeFile(path.join(y.app, ".env.local"), `BILHON_ROOT=${y.oss}\n`);
    expect(prefixoDoRepositorio(y.app, y.oss)).toBe("");
  });

  it("o bloco gerenciado antigo não vale como raiz sua; o terminal vence o arquivo; raiz que não contém o clone: sem prefixo", async () => {
    const bloco = "# >>> populate-megabrain (gerenciado por scripts/populate/ambiente.mjs; nao edite dentro do bloco)\nBILHON_ROOT=../..\n# <<< populate-megabrain\n";
    const x = await cenario(`BILHON_ROOT=..\n${bloco}`);
    vi.stubEnv("BILHON_ROOT", "");
    expect(prefixoDoRepositorio(x.app, x.oss)).toBe("mega-brain-oss"); // o ../.. do bloco não vence o seu ..

    await writeFile(path.join(x.app, ".env.local"), bloco); // só o bloco: o app lê a pasta dele (repositório fora dela)
    expect(raizEfetivaDoApp(x.app, x.oss)).toBe(x.app);
    expect(prefixoDoRepositorio(x.app, x.oss)).toBe("");

    await writeFile(path.join(x.app, ".env.local"), "BILHON_ROOT=data\n");
    expect(prefixoDoRepositorio(x.app, x.oss)).toBe(""); // data não contém o clone

    vi.stubEnv("BILHON_ROOT", path.join(x.tmp, "apps"));
    expect(prefixoDoRepositorio(x.app, x.oss)).toBe("mega-brain-oss");
  });
});

describe("registro do Agente com o clone fora do app", () => {
  it("observed e repos.json levam o prefixo da raiz, e o leitor do app resolve todos", async () => {
    const x = await cenario(ENV_OSS);
    vi.stubEnv("BILHON_ROOT", "");
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", "");
    const repo = resolveRepoRoot(undefined, x.app);
    expect(repo).toBe(x.oss);
    await runAgente(await ctxDe(x, repo));

    const linhas = await lerLinhas(x);
    expect(linhas.length).toBeGreaterThan(1);
    for (const l of linhas) expect(l.observed[0], l.rid).toMatch(/^mega-brain-oss(\/|$)/);
    expect(linhas.some((l) => l.observed[0] === "mega-brain-oss/squads/s1")).toBe(true);
    const repos = JSON.parse(await readFile(path.join(x.data, "agente", "repos.json"), "utf8")) as Array<{ path: string }>;
    expect(repos[0].path).toBe("mega-brain-oss");

    // o leitor do app (cwd = pasta do app, como no npm run dev), com a BILHON_ROOT do .env.local
    vi.stubEnv("BILHON_ROOT", path.join(x.tmp, "apps"));
    vi.stubEnv("BILHON_REGISTRO_ENTIDADES", path.join(x.data, "agente", "registro.yaml"));
    vi.stubEnv("BILHON_AGENTE_DIR", path.join(x.data, "agente"));
    vi.stubEnv("BILHON_REPOS_JSON", "");
    vi.stubEnv("BILHON_AGENTES_JSON", "");
    limparCacheEcossistema();
    const eco = await getEcosystem();
    const doRegistro = eco.entities.filter((e) => e.origem === "registro");
    expect(doRegistro.length).toBe(linhas.length); // nenhuma linha descartada por caminho fora da raiz
    expect(eco.entities.some((e) => e.kind === "repo" && e.path === "mega-brain-oss")).toBe(true);
  });

  it("caso padrão (repositório contém o app, nada definido): sem prefixo, como sempre", async () => {
    const x = await cenario("");
    const repo = x.tmp; // <tmp>/apps/knowledge: o app fica dentro do repositório
    await mkdir(path.join(repo, "knowledge"), { recursive: true });
    await mkdir(path.join(repo, "engine"), { recursive: true });
    await mkdir(path.join(repo, "squads", "s9"), { recursive: true });
    await writeFile(path.join(repo, "squads", "s9", "squad.yaml"), "name: s9\ndescription: Squad do repositório que contém o app\n");
    await writeFile(path.join(repo, "README.md"), "# Repo\n");
    vi.stubEnv("BILHON_ROOT", "");
    await runAgente(await ctxDe(x, repo));
    const linhas = await lerLinhas(x);
    expect(linhas.some((l) => l.observed[0] === "squads/s9")).toBe(true);
    expect(linhas.some((l) => l.observed[0] === ".")).toBe(true);
    const repos = JSON.parse(await readFile(path.join(x.data, "agente", "repos.json"), "utf8")) as Array<{ path: string }>;
    expect(repos[0].path).toBe(".");
  });
});

describe("módulo ambiente com o clone fora do app", () => {
  it("BILHON_ROOT=.. contém o app e o clone: nenhum aviso de raiz/observed; o bloco não grava raiz e remove a antiga", async () => {
    const bloco = "# >>> populate-megabrain (gerenciado por scripts/populate/ambiente.mjs; nao edite dentro do bloco)\nBILHON_ROOT=../..\n# <<< populate-megabrain\n";
    const x = await cenario(`${ENV_OSS}\n${bloco}`);
    vi.stubEnv("BILHON_ROOT", "");
    const r = await runAmbiente({ repoRoot: x.oss, appRoot: x.app, dataDir: x.data, resultados: {} });
    expect(r.avisos.filter((a: string) => /BILHON_ROOT|observed|fora do app/.test(a))).toEqual([]);
    const texto = await readFile(path.join(x.app, ".env.local"), "utf8");
    expect(texto).toContain("BILHON_ROOT=..\n"); // a sua, intacta
    expect(texto).not.toContain("BILHON_ROOT=../..");
    expect(texto).toContain("BILHON_MEGABRAIN_ROOT=../mega-brain-oss");
  });

  it("BILHON_ROOT que não contém o clone: continua acusando os observed; sem raiz sua e clone fora do app: aviso orienta a definir", async () => {
    const x = await cenario("BILHON_ROOT=data\n");
    vi.stubEnv("BILHON_ROOT", "");
    const r = await runAmbiente({ repoRoot: x.oss, appRoot: x.app, dataDir: x.data, resultados: {} });
    const aviso = r.avisos.find((a: string) => /^BILHON_ROOT \(linha 1/.test(a));
    expect(aviso).toMatch(/observed.*não está dentro dela/);

    const y = await cenario("");
    const r2 = await runAmbiente({ repoRoot: y.oss, appRoot: y.app, dataDir: y.data, resultados: {} });
    expect(r2.avisos.find((a: string) => /fora do app/.test(a))).toMatch(/BILHON_MEGABRAIN_ROOT.*numa pasta que contenha o app e o repositório/);
  });
});

describe("primeiro uso com BILHON_MEGABRAIN_ROOT no .env.local", () => {
  it("app e populate enxergam o clone; a pergunta é respondida (o Megabrain privado ao lado não entra)", async () => {
    const x = await cenario(ENV_OSS);
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", undefined); // um `npm run populate` comum: nada no terminal
    const repo = resolveRepoRoot(undefined, x.app);
    // o app (cwd = pasta do app, variável vinda do .env.local pelo Next) detecta o mesmo clone
    const det = detectarMegabrain({ appDir: x.app, raizExplicita: path.resolve(x.app, "../mega-brain-oss") });
    expect(det.detectado).toBe(true);
    expect(det.raiz).toBe(repo);

    const todosOk = Object.fromEntries(MODULOS.map((m) => [m, { ok: true }]));
    const opts = { yes: true, dryRun: false, includePersonal: false, status: false, only: null, skip: [], repo: null };
    const r = await responderPrimeiroUso({ appRoot: x.app, dataDir: x.data, repoRoot: repo, board: { cards: [] } as never, ts: TS, resultados: todosOk, opts });
    expect(r.resumo).toEqual({ acao: "respondido", estado: "aceito", cardId: null });
    expect(JSON.parse(await readFile(path.join(x.data, "primeiro-uso.json"), "utf8")).megabrain.estado).toBe("aceito");
  });
});
