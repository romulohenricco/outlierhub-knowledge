/**
 * Primeiro uso ("Popular o Knowledge com o seu Megabrain?", `data/primeiro-uso.json`, semântica em
 * lib/primeiro-uso.ts) respondido pela população: só DEPOIS do laço dos módulos (`executar` de
 * populate.mjs), com o resultado de todos, e só quando a execução é completa e todos terminaram ok.
 * O `run` do kanban não responde mais: ele roda antes de referencias, busca e ambiente, e uma falha
 * deles deixava a resposta `aceito` com o populate saindo com 1. `--only`/`--skip` que tiram algum
 * módulo deixam a pergunta como está, com aviso. E o Megabrain que o app detectaria sai só dos `.env*`
 * do app, lidos como o próprio Next os lê (conferido contra o @next/env): o BILHON_MEGABRAIN_ROOT do
 * terminal do populate não é o ambiente do app (`ambienteDivergente`).
 *
 * Roda em `<tmp>/mb/apps/knowledge` (o layout em que o app pergunta), sem Megabrain real e sem tocar o
 * `data/` do app: pela execução (`executar(ctx)`, com o kanban real e dublês no lugar dos outros
 * módulos), pelo módulo kanban (`run(ctx)`) e pela função `responderPrimeiroUso`.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { MODULOS, executar, modulosForaDaExecucao } from "../../populate.mjs";
import runKanban, { ambienteDivergente, raizDetectadaPeloApp, responderPrimeiroUso } from "../kanban.mjs";
import type { KanbanBoard } from "@/lib/types";

// O disco B: sob carga é lento; o módulo kanban roda git e varre o repositório (vazio) de teste.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const APP = process.cwd();
const TS = "2026-10-27T12:00:00.000Z";
const VAR = "BILHON_MEGABRAIN_ROOT";
/** Estado gravado pelo app quando a pessoa respondeu "Agora não". */
const DISPENSADO = JSON.stringify({ versao: 1, megabrain: { estado: "dispensado", cardId: null, atualizadoEm: "2026-10-16T10:10:57.213Z" } }, null, 1);
const PENDENTE = JSON.stringify({ versao: 1, megabrain: { estado: "pendente", cardId: null, atualizadoEm: TS } }, null, 1);
const OUTROS = MODULOS.filter((m) => m !== "kanban");

/** As opções como `parseArgs` de populate.mjs as devolve. */
const opcoes = (o: { only?: string[] | null; skip?: string[] } = {}) => ({
  yes: true, dryRun: false, includePersonal: false, status: false, only: o.only ?? null, skip: o.skip ?? [], repo: null,
});
/** `ctx.resultados` de uma execução completa em que todos os módulos terminaram ok (menos os de `sem`). */
const todosOk = (sem: string[] = []) => Object.fromEntries(MODULOS.filter((m) => !sem.includes(m)).map((m) => [m, { ok: true }]));
const boardVazio = () => ({ cards: [] }) as unknown as KanbanBoard;

type Modulo = { default: (ctx: unknown) => Promise<unknown> };
/**
 * Fonte dos módulos para `executar`: o kanban é o real (era ele que respondia no meio da população); os
 * outros são dublês que só devolvem ok, menos os de `falham` (lançam, como um módulo que quebra) e os de
 * `ausentes` (arquivo que ainda não existe, como o da `ontologia`).
 */
const fonte =
  ({ falham = [], ausentes = [] }: { falham?: string[]; ausentes?: string[] } = {}) =>
  async (nome: string): Promise<Modulo | null> => {
    if (ausentes.includes(nome)) return null;
    if (nome === "kanban") return (await import("../kanban.mjs")) as unknown as Modulo;
    if (falham.includes(nome)) {
      return {
        default: async () => {
          throw new Error(`${nome}: falha de teste`);
        },
      };
    }
    return { default: async () => ({ resumo: { modulo: nome } }) };
  };

const criados: string[] = [];
/** `<tmp>/mb/apps/knowledge` com `data/` (e o primeiro-uso.json, se dado); `outro` = outro Megabrain ao lado. */
async function layout(conteudo?: string) {
  const base = path.join(APP, "node_modules", ".cache", "knowledge-tests");
  await mkdir(base, { recursive: true });
  const d = await mkdtemp(path.join(base, "populate-primeiro-uso-parcial-"));
  criados.push(d);
  const mb = path.join(d, "mb");
  const app = path.join(mb, "apps", "knowledge");
  const data = path.join(app, "data");
  await mkdir(data, { recursive: true });
  const arq = path.join(data, "primeiro-uso.json");
  if (conteudo !== undefined) await writeFile(arq, conteudo);
  return { mb, app, data, arq, outro: path.join(d, "outro") };
}
type Layout = Awaited<ReturnType<typeof layout>>;
/** O ctx que populate.mjs monta e passa a `executar` (e a cada módulo). */
const ctxDe = (x: Layout, opts = opcoes(), resultados: Record<string, unknown> = {}) =>
  ({ repoRoot: x.mb, appRoot: x.app, dataDir: x.data, docs: [], excluded: [], opts, resultados });

afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await Promise.all(criados.map((d) => rm(d, { recursive: true, force: true })));
});

describe("primeiro uso respondido no fim da população (executar de populate.mjs)", () => {
  beforeEach(() => {
    // em branco = automático: o app pergunta sobre o Megabrain acima de apps/ (o `mb` do teste)
    vi.stubEnv(VAR, "");
  });

  it("a seleção de populate.mjs: completa não deixa nada de fora; --only kanban deixa todos os outros; --skip livros, só livros; `ontologia` antes de `ambiente`", () => {
    expect(modulosForaDaExecucao(opcoes())).toEqual([]);
    expect(modulosForaDaExecucao({})).toEqual([]);
    expect(modulosForaDaExecucao(opcoes({ only: [...MODULOS] }))).toEqual([]);
    expect(modulosForaDaExecucao(opcoes({ only: ["kanban"] }))).toEqual(OUTROS);
    expect(modulosForaDaExecucao(opcoes({ skip: ["livros"] }))).toEqual(["livros"]);
    expect(modulosForaDaExecucao(opcoes({ skip: ["livros", "colecoes", "busca", "ambiente"] }))).toEqual(["livros", "colecoes", "busca", "ambiente"]);
    // `ambiente` liga BILHON_ONTOLOGIA_MANIFEST quando o arquivo que `ontologia` grava existe
    expect(MODULOS.indexOf("ontologia")).toBeGreaterThan(MODULOS.indexOf("especialistas"));
    expect(MODULOS.indexOf("ontologia")).toBeLessThan(MODULOS.indexOf("ambiente"));
    expect(MODULOS.at(-1)).toBe("ambiente");
  });

  it("o run do kanban não responde: prepara o board e deixa a pergunta como estava", async () => {
    for (const conteudo of [undefined, PENDENTE]) {
      const x = await layout(conteudo);
      const r = await runKanban(ctxDe(x, opcoes(), todosOk()));
      expect(r.resumo).not.toHaveProperty("primeiroUso");
      expect(r.avisos.some((a: string) => a.startsWith("primeiro uso:"))).toBe(false);
      expect(existsSync(path.join(x.data, "kanban", "board.json"))).toBe(true);
      if (conteudo === undefined) expect(existsSync(x.arq)).toBe(false);
      else expect(await readFile(x.arq, "utf8")).toBe(conteudo);
    }
  });

  it("execução completa com todos ok: 'aceito' (sem card) depois do laço; o 'dispensado' já gravado fica intocado", async () => {
    const x = await layout();
    const ctx = ctxDe(x);
    const { falhas, primeiroUso } = await executar(ctx, { carregar: fonte() });
    expect(falhas).toBe(0);
    expect(Object.keys(ctx.resultados)).toEqual(MODULOS);
    expect(primeiroUso.resumo).toEqual({ acao: "respondido", estado: "aceito", cardId: null });
    const salvo = JSON.parse(await readFile(x.arq, "utf8"));
    expect(salvo).toMatchObject({ versao: 1, megabrain: { estado: "aceito", cardId: null } });
    expect(Number.isNaN(Date.parse(salvo.megabrain.atualizadoEm))).toBe(false);

    const y = await layout(DISPENSADO);
    const ry = await executar(ctxDe(y), { carregar: fonte() });
    expect(ry.primeiroUso.resumo).toEqual({ acao: "mantido", estado: "dispensado", cardId: null });
    expect(await readFile(y.arq, "utf8")).toBe(DISPENSADO);
  });

  it("referencias, busca ou ambiente falhando DEPOIS do kanban: o populate sai com falha e a pergunta continua como estava", async () => {
    for (const falho of ["referencias", "busca", "ambiente"]) {
      expect(MODULOS.indexOf(falho), falho).toBeGreaterThan(MODULOS.indexOf("kanban"));
      const x = await layout(PENDENTE);
      const ctx = ctxDe(x);
      const { falhas, primeiroUso } = await executar(ctx, { carregar: fonte({ falham: [falho] }) });
      expect(falhas, falho).toBe(1);
      expect(ctx.resultados.kanban, falho).toMatchObject({ ok: true });
      expect(ctx.resultados[falho], falho).toMatchObject({ ok: false, erro: `${falho}: falha de teste` });
      expect(primeiroUso.resumo, falho).toEqual({ acao: "populacao-com-falha", modulos: [falho] });
      expect(primeiroUso.avisos.join(" "), falho).toMatch(new RegExp(`${falho}: falhou`));
      expect(await readFile(x.arq, "utf8"), falho).toBe(PENDENTE);
    }
  });

  it("módulo ainda não implementado (ex.: `ontologia` sem arquivo) não conta como ok: não responde, sem ser falha do populate", async () => {
    const x = await layout();
    const ctx = ctxDe(x);
    const { falhas, primeiroUso } = await executar(ctx, { carregar: fonte({ ausentes: ["ontologia"] }) });
    expect(falhas).toBe(0);
    expect(ctx.resultados.ontologia).toEqual({ ok: false, motivo: "nao-implementado" });
    expect(primeiroUso.resumo).toEqual({ acao: "populacao-com-falha", modulos: ["ontologia"] });
    expect(primeiroUso.avisos.join(" ")).toMatch(/ontologia: não implementado/);
    expect(existsSync(x.arq)).toBe(false);

    // direto na função: sem `resultados` (nenhum módulo rodou) também não responde
    const r = await responderPrimeiroUso({ appRoot: x.app, dataDir: x.data, repoRoot: x.mb, board: boardVazio(), ts: TS });
    expect(r.resumo).toEqual({ acao: "populacao-com-falha", modulos: MODULOS });
    expect(r.avisos.join(" ")).toMatch(/livros: sem resultado/);
    expect(existsSync(x.arq)).toBe(false);
  });

  it("--only kanban: o board é populado, mas a pergunta não é respondida (populacao-parcial, com aviso)", async () => {
    const x = await layout();
    const ctx = ctxDe(x, opcoes({ only: ["kanban"] }));
    const { falhas, primeiroUso } = await executar(ctx, { carregar: fonte() });
    expect(falhas).toBe(0);
    expect(Object.keys(ctx.resultados)).toEqual(["kanban"]);
    expect(primeiroUso.resumo).toEqual({ acao: "populacao-parcial", modulos: OUTROS });
    const aviso = primeiroUso.avisos.find((a: string) => a.startsWith("primeiro uso:"));
    expect(aviso).toMatch(/parcial/);
    expect(aviso).toMatch(/livros/);
    expect(aviso).toMatch(/ambiente/);
    expect(existsSync(x.arq)).toBe(false);
    expect(existsSync(path.join(x.data, "kanban", "board.json"))).toBe(true);

    // pendente e dispensado: intocados, byte a byte
    for (const conteudo of [PENDENTE, DISPENSADO]) {
      const y = await layout(conteudo);
      const ry = await responderPrimeiroUso({ appRoot: y.app, dataDir: y.data, repoRoot: y.mb, board: boardVazio(), ts: TS, resultados: { kanban: { ok: true } }, opts: opcoes({ only: ["kanban"] }) });
      expect(ry.resumo).toMatchObject({ acao: "populacao-parcial" });
      expect(await readFile(y.arq, "utf8")).toBe(conteudo);
    }

    // a população completa seguinte responde
    const rc = await executar(ctxDe(x), { carregar: fonte() });
    expect(rc.primeiroUso.resumo).toEqual({ acao: "respondido", estado: "aceito", cardId: null });
  });

  it("--skip livros, busca+ambiente ou o próprio kanban: não responde, mesmo com todos os outros ok; --only com todos é completa", async () => {
    const x = await layout(PENDENTE);
    for (const skip of [["livros"], ["busca", "ambiente"], ["kanban"]]) {
      const r = await responderPrimeiroUso({ appRoot: x.app, dataDir: x.data, repoRoot: x.mb, board: boardVazio(), ts: TS, resultados: todosOk(skip), opts: opcoes({ skip }) });
      expect(r.resumo).toEqual({ acao: "populacao-parcial", modulos: skip });
      expect(r.avisos.some((a: string) => a.startsWith("primeiro uso:") && a.includes(skip[0]))).toBe(true);
    }
    expect(await readFile(x.arq, "utf8")).toBe(PENDENTE);

    const z = await layout(PENDENTE);
    const rz = await responderPrimeiroUso({ appRoot: z.app, dataDir: z.data, repoRoot: z.mb, board: boardVazio(), ts: TS, resultados: todosOk(), opts: opcoes({ only: [...MODULOS] }) });
    expect(rz.resumo).toEqual({ acao: "respondido", estado: "aceito", cardId: null });
  });
});

describe("o Megabrain que o app detectaria sai só dos .env* do app, não do terminal do populate", () => {
  /** Execução completa, todos ok: só a raiz decide. */
  const responder = (x: Layout, repoRoot: string) =>
    responderPrimeiroUso({ appRoot: x.app, dataDir: x.data, repoRoot, board: boardVazio(), ts: TS, resultados: todosOk(), opts: opcoes() });

  it("BILHON_MEGABRAIN_ROOT=/outro só no terminal do populate: o app não vê; não responde e avisa", async () => {
    const x = await layout();
    vi.stubEnv(VAR, x.outro);
    // o app (outro terminal, sem a variável) pergunta pelo Megabrain de cima de apps/
    expect(raizDetectadaPeloApp(x.app)).toEqual({ raiz: x.mb, motivo: "pasta-apps" });
    expect(ambienteDivergente(x.app)).toEqual({ terminal: x.outro, app: x.mb, arquivo: null });
    // o populate leu /outro (resolveRepoRoot pega a variável do terminal); antes comparava /outro com /outro e gravava 'aceito'
    const r = await responder(x, x.outro);
    expect(r.resumo).toEqual({ acao: "ambiente-divergente", variavel: VAR });
    const aviso = r.avisos.join(" ");
    expect(aviso).toMatch(/^primeiro uso: .*BILHON_MEGABRAIN_ROOT/);
    expect(aviso).toMatch(/\.env\.local/);
    expect(existsSync(x.arq)).toBe(false);
    // com --repo no Megabrain do app, a variável do terminal ainda diverge: não se sabe o que o app verá
    expect((await responder(x, x.mb)).resumo.acao).toBe("ambiente-divergente");
    expect(existsSync(x.arq)).toBe(false);

    // em branco no terminal (automático) e o .env.local do app apontando /outro: também diverge
    await writeFile(path.join(x.app, ".env.local"), `BILHON_MEGABRAIN_ROOT=${x.outro}\n`);
    vi.stubEnv(VAR, "");
    expect(ambienteDivergente(x.app)).toEqual({ terminal: x.mb, app: x.outro, arquivo: ".env.local" });
    expect((await responder(x, x.mb)).resumo.acao).toBe("ambiente-divergente");
    expect(existsSync(x.arq)).toBe(false);
  });

  it("a mesma raiz dos dois lados responde; sem a variável no terminal valem só os arquivos do app", async () => {
    // no terminal e no .env.local do app (relativo à pasta do app, como no `next dev`): o app também vê /outro
    const x = await layout();
    await writeFile(path.join(x.app, ".env.local"), "# raiz à mão\r\nBILHON_MEGABRAIN_ROOT=../../../outro\r\n");
    vi.stubEnv(VAR, x.outro);
    expect(ambienteDivergente(x.app)).toBeNull();
    expect(raizDetectadaPeloApp(x.app)).toEqual({ raiz: x.outro, motivo: "informada" });
    expect((await responder(x, x.outro)).resumo).toEqual({ acao: "respondido", estado: "aceito", cardId: null });

    // no terminal, apontando para o Megabrain de cima de apps/ (o que o app detecta sozinho): mesma raiz
    const y = await layout();
    vi.stubEnv(VAR, y.mb);
    expect(ambienteDivergente(y.app)).toBeNull();
    expect((await responder(y, y.mb)).resumo.acao).toBe("respondido");

    // fora do terminal: o 1º arquivo que define vence (.env.development.local antes do .env.local), aspas e comentário à parte
    const z = await layout();
    delete process.env[VAR];
    await writeFile(path.join(z.app, ".env.local"), `BILHON_MEGABRAIN_ROOT=${z.mb}\n`);
    await writeFile(path.join(z.app, ".env.development.local"), 'BILHON_MEGABRAIN_ROOT="../../../outro" # vence o .env.local\n');
    expect(ambienteDivergente(z.app)).toBeNull();
    expect(raizDetectadaPeloApp(z.app)).toEqual({ raiz: z.outro, motivo: "informada" });
    expect((await responder(z, z.mb)).resumo.acao).toBe("outro-megabrain");
    expect(existsSync(z.arq)).toBe(false);
    expect((await responder(z, z.outro)).resumo.acao).toBe("respondido");
  });

  it("lê os .env* do app como o próprio Next (@next/env, o loader do `next dev`): aspas, comentário, `export`, `: `, linha e arquivo que vencem", async () => {
    // o valor que o `next dev` põe em process.env, num processo à parte e sem a variável no ambiente (o terminal do app)
    const nextEnv = createRequire(path.join(APP, "package.json")).resolve("@next/env");
    const script = `require(process.argv[1]).loadEnvConfig(process.argv[2],true,{info(){},error(){}},true);process.stdout.write(JSON.stringify(process.env.${VAR}??null))`;
    const doNext = (app: string) => {
      // sem NODE_ENV: o `test` do vitest faria o @next/env ler os .env.test*, não os do `next dev`
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== VAR && k !== "NODE_ENV")) as NodeJS.ProcessEnv;
      return JSON.parse(execFileSync(process.execPath, ["-e", script, nextEnv, app], { env, encoding: "utf8" })) as string | null;
    };
    const casos: Record<string, string>[] = [
      { ".env.local": "BILHON_MEGABRAIN_ROOT=../../../outro#sem espaço antes\n" },
      { ".env.local": "export BILHON_MEGABRAIN_ROOT=`../../../outro` # crase\r\n" },
      { ".env.local": "BILHON_MEGABRAIN_ROOT: ../../../outro\n" },
      { ".env.local": 'BILHON_MEGABRAIN_ROOT="../../../outro" # "aspas" no comentário\n' },
      { ".env.local": "BILHON_MEGABRAIN_ROOT=\r\n" },
      { ".env.local": "BILHON_MEGABRAIN_ROOT=../../../x\nBILHON_MEGABRAIN_ROOT=../../../outro\n" },
      { ".env": "BILHON_MEGABRAIN_ROOT=../../../x\n", ".env.local": "BILHON_MEGABRAIN_ROOT=../../../outro\n", ".env.development.local": "BILHON_MEGABRAIN_ROOT='../..'\n" },
      { ".env.development": "# BILHON_MEGABRAIN_ROOT=../../../outro\nBILHON_MEGABRAIN_ROOT_ANTIGA=../../../outro\n" },
    ];
    vi.stubEnv(VAR, undefined);
    for (const arquivos of casos) {
      const x = await layout();
      for (const [nome, texto] of Object.entries(arquivos)) await writeFile(path.join(x.app, nome), texto);
      const valor = doNext(x.app);
      const rotulo = JSON.stringify(arquivos);
      expect(raizDetectadaPeloApp(x.app), rotulo).toEqual(valor ? { raiz: path.resolve(x.app, valor), motivo: "informada" } : { raiz: x.mb, motivo: "pasta-apps" });
      // sem a variável no terminal do populate não há divergência: valem os arquivos
      expect(ambienteDivergente(x.app), rotulo).toBeNull();
    }
  });
});
