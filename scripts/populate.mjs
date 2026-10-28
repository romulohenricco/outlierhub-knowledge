#!/usr/bin/env node
/**
 * Popula o Knowledge com o conteúdo do mega-brain (e SÓ dele) e liga as
 * integrações locais. Idempotente: rodar de novo regenera o que é derivado do
 * repositório e preserva o que é seu (cards do kanban criados à mão, favoritos,
 * anotações).
 *
 *   npm run populate                      pergunta antes de popular
 *   npm run populate -- --yes             sem perguntar (CI / agente)
 *   npm run populate -- --only livros,colecoes
 *   npm run populate -- --skip kanban
 *   npm run populate -- --include-personal   inclui knowledge/personal e agents/personal (fora por padrão)
 *   npm run populate -- --repo <pasta>    outra raiz do mega-brain (ou BILHON_MEGABRAIN_ROOT no terminal ou no .env.local)
 *   npm run populate -- --dry-run         só varre e mostra o que entraria
 *   BILHON_POPULATE_EXCLUIR=caminho,glob  (terminal ou .env.local) arquivos do mega-brain lido que não entram em data/
 *   npm run populate:status               mostra a última população
 *
 * Só grava em `apps/knowledge/data/` e no bloco gerenciado de `.env.local`. O
 * mega-brain é lido, nunca alterado. Não faz rede. Depois de TODOS os módulos (`executar`),
 * a população responde a pergunta de primeiro uso do app (`data/primeiro-uso.json`) quando
 * é completa (nenhum módulo tirado por --only/--skip) e todos terminaram ok. Único escritor
 * desse arquivo: `responderPrimeiroUso` em populate/kanban.mjs, chamada só por `executar`.
 */
import { existsSync } from "node:fs";
import readline from "node:readline/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  APP_ROOT, DATA_DIR, VARIAVEL_EXCLUIR, ativarExclusoes, avisosDeExclusao, descreverFonte, lerExclusoesDoAmbiente, log,
  readJsonSafe, resolveRepoRootComOrigem, scanRepo, writeJson,
} from "./populate/common.mjs";

/**
 * Ordem importa: `busca` lê o catálogo da estante que `livros` grava (livros sempre antes de
 * busca); `ambiente` por último liga o provider local. A pergunta de primeiro uso não depende da
 * ordem: é respondida depois do laço, com o resultado de todos (ver `executar`).
 * `especialistas` grava as coleções por especialista; os insights deles entram no grafo pelo
 * próprio módulo `grafo` (extrator `extrairInsightsMce`), único escritor de data/kg/livros-kg.sqlite.
 * `ontologia` monta data/ontologia/ontologia.yaml com as camadas de DNA dos especialistas; vem
 * antes de `ambiente`, que liga BILHON_ONTOLOGIA_MANIFEST quando o arquivo existe.
 */
export const MODULOS = [
  "livros", "colecoes", "especialistas", "ontologia", "grafo", "topologia", "agente", "addons", "kanban", "referencias", "busca", "ambiente",
];

const MARCADOR = path.join(DATA_DIR, ".populated.json");

/**
 * Módulos que `--only`/`--skip` tiram desta execução, na ordem de MODULOS (vazio = execução completa).
 * Fonte única da seleção: `executar` roda o resto, e `responderPrimeiroUso` (populate/kanban.mjs) só
 * responde o primeiro uso do app quando nada fica de fora.
 */
export function modulosForaDaExecucao(opts = {}) {
  const only = Array.isArray(opts?.only) ? opts.only : null;
  const skip = Array.isArray(opts?.skip) ? opts.skip : [];
  return MODULOS.filter((m) => (only ? !only.includes(m) : false) || skip.includes(m));
}

function parseArgs(argv) {
  const o = { yes: false, dryRun: false, includePersonal: false, status: false, only: null, skip: [], repo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === "--yes" || a === "-y") o.yes = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--include-personal") o.includePersonal = true;
    else if (a === "--status") o.status = true;
    else if (a === "--only") o.only = (val() ?? "").split(",").filter(Boolean);
    else if (a === "--skip") o.skip = (val() ?? "").split(",").filter(Boolean);
    else if (a === "--repo") o.repo = val();
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  for (const n of [...(o.only ?? []), ...o.skip]) {
    if (!MODULOS.includes(n)) throw new Error(`módulo desconhecido: ${n} (válidos: ${MODULOS.join(", ")})`);
  }
  return o;
}

async function confirmar(repoRoot, resumo) {
  console.log(`\nO Knowledge será populado com o conteúdo de:\n  ${repoRoot}`);
  console.log(`  ${resumo.docs} arquivos no corpus (${resumo.excluidos} excluídos por segurança/regra).`);
  console.log("As integrações locais (busca, grafo, agentes, add-ons, kanban) serão ligadas em .env.local,");
  if (resumo.fora.length) {
    console.log(`mas esta execução deixa de fora: ${resumo.fora.join(", ")}. A pergunta de primeiro uso do app`);
    console.log("(data/primeiro-uso.json) não é respondida: só uma população completa a responde.");
  } else {
    console.log("e, se todos os módulos terminarem ok, a pergunta de primeiro uso do app fica respondida");
    console.log("(data/primeiro-uso.json), caso ainda esteja pendente.");
  }
  console.log("Nada sai desta máquina e o mega-brain não é alterado.\n");
  if (!process.stdin.isTTY) {
    throw new Error("sem terminal interativo: confirme com --yes (ou rode `npm run populate` num terminal).");
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = (await rl.question("Popular agora e iniciar as integrações? [s/N] ")).trim().toLowerCase();
  rl.close();
  return r === "s" || r === "sim" || r === "y" || r === "yes";
}

/** Módulo `scripts/populate/<nome>.mjs` por import dinâmico; `null` = arquivo ausente (ainda não implementado). */
async function carregarModulo(nome) {
  const arq = path.join(APP_ROOT, "scripts", "populate", `${nome}.mjs`);
  return existsSync(arq) ? import(pathToFileURL(arq).href) : null;
}

/**
 * Roda os módulos desta execução (MODULOS menos os tirados por --only/--skip), na ordem, acumulando
 * `ctx.resultados`, e SÓ DEPOIS do laço responde a pergunta de primeiro uso do app, com o resultado de
 * todos: `responderPrimeiroUso` (populate/kanban.mjs), chamada só aqui, é o único escritor de
 * data/primeiro-uso.json. Assim uma falha em `referencias`, `busca` ou `ambiente`, que rodam depois do
 * kanban, também segura a resposta (e "nao-implementado" não conta como ok). `carregar` troca a fonte
 * dos módulos (testes em pasta temporária). Devolve `{ falhas, primeiroUso: { resumo, avisos } }`;
 * `falhas` conta só os módulos que lançaram (o código de saída de `main`).
 */
export async function executar(ctx, { carregar = carregarModulo } = {}) {
  ativarExclusoes(ctx); // BILHON_POPULATE_EXCLUIR vale para toda leitura direta do mega-brain pelos módulos
  const fora = modulosForaDaExecucao(ctx.opts);
  let falhas = 0;
  for (const nome of MODULOS.filter((m) => !fora.includes(m))) {
    try {
      const mod = await carregar(nome);
      if (!mod) {
        log(nome, "módulo ainda não implementado — pulando");
        ctx.resultados[nome] = { ok: false, motivo: "nao-implementado" };
        continue;
      }
      const r = (await mod.default(ctx)) ?? {};
      ctx.resultados[nome] = { ok: true, ...r };
      log(nome, `ok ${r.resumo ? JSON.stringify(r.resumo) : ""}`);
      for (const a of r.avisos ?? []) log(nome, `aviso: ${a}`);
    } catch (e) {
      falhas++;
      ctx.resultados[nome] = { ok: false, erro: String(e?.message ?? e).slice(0, 500) };
      log(nome, `FALHOU: ${e?.stack ?? e}`);
    }
  }

  // pergunta de primeiro uso do app: só agora, com o resultado de TODOS os módulos desta execução
  let primeiroUso;
  try {
    const { responderPrimeiroUso } = await import(pathToFileURL(path.join(APP_ROOT, "scripts", "populate", "kanban.mjs")).href);
    primeiroUso = await responderPrimeiroUso({ appRoot: ctx.appRoot, dataDir: ctx.dataDir, repoRoot: ctx.repoRoot, resultados: ctx.resultados, opts: ctx.opts });
  } catch (e) {
    const motivo = String(e?.code ?? e?.message ?? e).slice(0, 300);
    primeiroUso = { resumo: { acao: "falhou" }, avisos: [`primeiro uso: data/primeiro-uso.json não foi respondido (${motivo}); o app ainda pode perguntar se quer popular`] };
  }
  for (const a of primeiroUso.avisos) log("primeiro-uso", `aviso: ${a}`);
  log("primeiro-uso", `${primeiroUso.resumo.acao}${primeiroUso.resumo.estado ? ` (${primeiroUso.resumo.estado})` : ""}`);
  return { falhas, primeiroUso };
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);

  if (opts.status) {
    const m = await readJsonSafe(MARCADOR);
    console.log(m ? JSON.stringify(m, null, 2) : "Ainda não populado. Rode: npm run populate");
    return 0;
  }

  const { raiz: repoRoot, origem } = resolveRepoRootComOrigem(opts.repo);
  log("scan", `lendo ${repoRoot} (origem: ${origem})`);
  const exclusoes = lerExclusoesDoAmbiente(APP_ROOT);
  const { docs, excluded, exclusao } = await scanRepo(repoRoot, { includePersonal: opts.includePersonal, exclusoes });
  const porTipo = Object.fromEntries(["doc", "config", "code"].map((k) => [k, docs.filter((d) => d.kind === k).length]));
  log("scan", `${docs.length} arquivos no corpus (docs ${porTipo.doc}, configs ${porTipo.config}, código ${porTipo.code}); ${excluded.length} excluídos`);
  for (const e of excluded) log("scan", `  excluído: ${e.rel} (${e.motivo})`);
  if (exclusao) {
    log("scan", `${VARIAVEL_EXCLUIR} (${exclusao.origem ?? "sem origem"}): ${exclusao.entradas.length} entrada(s), ${exclusao.arquivos.length} arquivo(s) excluído(s) pela configuração`);
    for (const a of avisosDeExclusao(exclusao)) log("scan", `aviso: ${a}`);
  }

  if (opts.dryRun) return 0;
  const fora = modulosForaDaExecucao(opts);
  if (!opts.yes && !(await confirmar(repoRoot, { docs: docs.length, excluidos: excluded.length, fora }))) {
    console.log("Cancelado. Nada foi alterado.");
    return 0;
  }

  const ctx = { repoRoot, appRoot: APP_ROOT, dataDir: DATA_DIR, docs, excluded, exclusoes, opts, resultados: {} };
  const { falhas, primeiroUso } = await executar(ctx);

  const anterior = (await readJsonSafe(MARCADOR)) ?? {};
  await writeJson(MARCADOR, {
    geradoEm: new Date().toISOString(),
    // onde o populate leu: raiz relativa ao app, de onde veio (--repo, terminal, .env.local, padrão) e o commit lido
    fonte: { nome: "mega-brain", ...descreverFonte(APP_ROOT, repoRoot, origem) },
    corpus: { arquivos: docs.length, ...porTipo, excluidos: excluded.length, excluidosPelaConfiguracao: exclusao?.arquivos.length ?? 0 },
    excluidos: excluded,
    // BILHON_POPULATE_EXCLUIR: o que a configuração barrou (null = variável ausente), e as entradas que não casaram nada
    exclusaoConfigurada: exclusao ? { variavel: VARIAVEL_EXCLUIR, ...exclusao } : null,
    modulos: { ...(anterior.modulos ?? {}), ...ctx.resultados },
    // desta execução: o que a população fez com a pergunta de primeiro uso do app
    primeiroUso,
  });
  log("fim", falhas ? `${falhas} módulo(s) com falha` : "população concluída — reinicie o app (npm run dev) para recarregar os dados");
  return falhas ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().then((c) => process.exit(c), (e) => { console.error(`[populate] ${e?.message ?? e}`); process.exit(1); });
}
