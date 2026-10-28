import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEM_SQLITE3_FTS5 } from "./_sqlite-cli";
import { PORTA_PADRAO, lerPorta, portaDoEnvLocal } from "../../porta-local.mjs";
import run, {
  ARQUIVOS_OPCIONAIS,
  MARCA_FIM,
  MARCA_INICIO,
  VARIAVEIS_PERMITIDAS,
  aplicarBloco,
  diagnosticarBuscaLocal,
  indiceDeBusca,
  montarBloco,
  ownersDoAgente,
  valorRaiz,
  variaveisDoBloco,
} from "../ambiente.mjs";
import { VERSAO_ESQUEMA } from "../busca.mjs";
import { detectSecret, resolveRepoRoot, sinaisDeMegabrain } from "../common.mjs";
import { bilhonRoot, caminhoBilhonPermitido } from "@/lib/bilhon-paths";
import { getEcosystem, limparCacheEcossistema, mapearRegistro } from "@/lib/ecosystem";
import { getKnowledgeProvider } from "@/lib/providers";
import { topologyDir } from "@/lib/topologia";
import { getAddonCatalogo } from "@/lib/addons";
import { getOntologia } from "@/lib/ontologia";
import { carregarPersonas } from "@/lib/personas";
import { detectarMegabrain } from "@/lib/primeiro-uso";

// os providers importam "server-only", que só existe no servidor do Next
vi.mock("server-only", () => ({}));

// Tudo roda numa árvore temporária (<base>/apps/knowledge, como no mega-brain): o
// .env.local real e o data/ real do app nunca são tocados.
let base: string;
let app: string;
let ctx: { repoRoot: string; appRoot: string; dataDir: string; resultados?: Record<string, { ok: boolean; [k: string]: unknown }> };
const envLocal = () => path.join(app, ".env.local");
const ler = () => readFile(envLocal(), "utf8");
const indiceDoApp = () => path.join(app, "data", "search", "index.sqlite");

/**
 * Índice FTS5 mínimo com o contrato que o provider local confere (tabela `busca` com
 * `doc_rel`, `meta.schema_version` e ao menos um trecho), criado com node:sqlite.
 */
async function criarIndice(arquivo: string, { versao = String(VERSAO_ESQUEMA), trechos = 1 } = {}) {
  await mkdir(path.dirname(arquivo), { recursive: true });
  await rm(arquivo, { recursive: true, force: true }); // recriar substitui o índice anterior
  const db = new DatabaseSync(arquivo);
  db.exec(`
    CREATE VIRTUAL TABLE busca USING fts5(titulo, caminho, texto, doc_rel UNINDEXED);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  `);
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(versao);
  const ins = db.prepare("INSERT INTO busca (titulo, caminho, texto, doc_rel) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < trechos; i++) ins.run(`Doc ${i}`, `docs/doc-${i}.md`, "conteudo do mega-brain", `docs/doc-${i}.md`);
  db.close();
}

/** data/agente/repos.json como o módulo agente grava (owner do remote origin), mais linhas que não contam. */
async function gravarRepos(owner: string, extras: unknown[] = []) {
  const arq = path.join(ctx.dataDir, "agente", "repos.json");
  await mkdir(path.dirname(arq), { recursive: true });
  const linha = { slug: "meu-megabrain", path: ".", owner, procedencia: "propria", gerado_por: "populate:agente" };
  await writeFile(arq, JSON.stringify([linha, ...extras], null, 2));
}

/** Grava um arquivo dentro de data/ do app temporário (caminho posix relativo a data/). */
async function gravarEmData(rel: string, conteudo: string) {
  const arq = path.join(ctx.dataDir, ...rel.split("/"));
  await mkdir(path.dirname(arq), { recursive: true });
  await writeFile(arq, conteudo);
  return arq;
}

const ONTOLOGIA_MINIMA = "titulo: Teste\ncamadas:\n  - id: squads\n    rotulo: Squads\n    itens:\n      - id: equipe\n        nome: Equipe\n";
const PERSONAS_MINIMAS = JSON.stringify({ personas: [{ id: "operador", nome: "Operador", resumo: "Quem opera o acervo." }] });

/**
 * O módulo confere o índice pela CLI `sqlite3`, como o provider. Com ela (e FTS5) o índice de
 * teste é utilizável e o bloco liga o provider local; sem ela (o Windows não a traz), o bloco
 * sai sem a variável e o resto vale igual. Os testes que só fazem sentido com a CLI são pulados.
 */
const PROVIDER_DO_BLOCO = TEM_SQLITE3_FTS5 ? "local" : undefined;
const COM_LOCAL: Record<string, string> = PROVIDER_DO_BLOCO ? { BILHON_KNOWLEDGE_PROVIDER: PROVIDER_DO_BLOCO } : {};

/**
 * O que o Next leria de cada `.env.local`: o @next/env de verdade (dotenv + precedência), num
 * processo à parte para não mexer no process.env dos testes. Devolve o valor final das chaves
 * pedidas (ausente = não definida). Fora do modo "test", em que o Next nem lê o `.env.local`.
 */
function lidoPeloNext(textos: string[], chaves: string[]): Array<Record<string, string | undefined>> {
  const dirs = textos.map((texto, i) => {
    const dir = path.join(base, "next-env", String(i));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, ".env.local"), texto);
    return dir;
  });
  const script = [
    'const { loadEnvConfig } = require("@next/env");',
    "const [dirs, chaves] = JSON.parse(process.argv[1]);",
    "const quieto = { info() {}, error() {} };",
    "const lidos = dirs.map((d) => { const { combinedEnv } = loadEnvConfig(d, true, quieto, true); return Object.fromEntries(chaves.map((c) => [c, combinedEnv[c]])); });",
    "process.stdout.write(JSON.stringify(lidos));",
  ].join("\n");
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development" };
  for (const c of ["__NEXT_PROCESSED_ENV", ...chaves]) delete env[c];
  const saida = execFileSync(process.execPath, ["-e", script, JSON.stringify([dirs, chaves])], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  return JSON.parse(saida);
}

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "amb-"));
  app = path.join(base, "apps", "knowledge");
  await mkdir(path.join(app, "data"), { recursive: true });
  ctx = { repoRoot: base, appRoot: app, dataDir: path.join(app, "data") };
  await criarIndice(indiceDoApp()); // o caso normal: a busca já foi gerada
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(base, { recursive: true, force: true });
});

const ITENS = [
  { nome: "BILHON_KNOWLEDGE_PROVIDER", valor: "local", comentario: "x" },
  { nome: "BILHON_ROOT", valor: "../..", comentario: "y" },
];

describe("bloco gerenciado do .env.local", () => {
  it("cria o arquivo com os marcadores exatos e as variáveis esperadas", async () => {
    await gravarRepos("minha-org");
    const r = await run(ctx);
    expect(r.resumo.acao).toBe("criado");
    const texto = await ler();
    const linhas = texto.split("\n");
    expect(linhas[0]).toBe(
      "# >>> populate-megabrain (gerenciado por scripts/populate/ambiente.mjs; nao edite dentro do bloco)",
    );
    expect(linhas.at(-2)).toBe("# <<< populate-megabrain");
    expect(linhas.at(-1)).toBe("");
    expect(variaveisDoBloco(texto)).toEqual({
      ...COM_LOCAL,
      BILHON_ROOT: "../..",
      BILHON_REGISTRO_ENTIDADES: "data/agente/registro.yaml",
      BILHON_OWNERS_PROPRIOS: "minha-org",
    });
  });

  it("é idempotente: a segunda execução não reescreve o arquivo", async () => {
    await run(ctx);
    const antes = { texto: await ler(), mtime: (await stat(envLocal())).mtimeMs };
    const r2 = await run(ctx);
    expect(r2.resumo.acao).toBe("sem-mudanca");
    expect(await ler()).toBe(antes.texto);
    expect((await stat(envLocal())).mtimeMs).toBe(antes.mtime);
  });

  const ORIGINAIS: Record<string, string> = {
    "LF com valores em branco do exemplo": "# meu\nFOO=bar\nBILHON_KNOWLEDGE_PROVIDER=\nBILHON_ROOT=\n",
    "sem quebra de linha no fim": "FOO=bar\nOUTRA=2",
    "CRLF": "# meu\r\nFOO=bar\r\nOUTRA=2\r\n",
    "só uma linha em branco": "\n",
  };
  for (const [nome, original] of Object.entries(ORIGINAIS)) {
    it(`preserva byte a byte o conteúdo existente (${nome}) e depois não muda mais`, async () => {
      await writeFile(envLocal(), original);
      const r1 = await run(ctx);
      expect(r1.resumo.acao).toBe("bloco-acrescentado");
      const texto = await ler();
      expect(texto.startsWith(original)).toBe(true); // o conteúdo do usuário é prefixo do novo
      expect(variaveisDoBloco(texto).BILHON_KNOWLEDGE_PROVIDER).toBe(PROVIDER_DO_BLOCO);
      expect(variaveisDoBloco(texto).BILHON_ROOT).toBe("../..");
      if (original.includes("\r\n")) expect(texto.replace(/\r\n/g, "")).not.toContain("\n"); // EOL único
      const r2 = await run(ctx);
      expect(r2.resumo.acao).toBe("sem-mudanca");
      expect(await ler()).toBe(texto);
    });
  }

  it("troca só o miolo de um bloco antigo e preserva o que vem antes e depois", async () => {
    const antes = "ANTES=1\n\n";
    const depois = "DEPOIS=2\n# comentário meu\n";
    const velho = montarBloco([{ nome: "BILHON_ROOT", valor: "/valor/velho", comentario: "velho" }]);
    await writeFile(envLocal(), `${antes}${velho}\n${depois}`);
    const r = await run(ctx);
    expect(r.resumo.acao).toBe("atualizado");
    const texto = await ler();
    expect(texto.startsWith(antes + MARCA_INICIO)).toBe(true);
    expect(texto.endsWith(`${MARCA_FIM}\n${depois}`)).toBe(true);
    expect(texto).not.toContain("/valor/velho");
    expect(variaveisDoBloco(texto).BILHON_ROOT).toBe("../..");
    // quem define a chave DEPOIS do bloco vence no Next. Em branco ali, o bloco continua
    // gravando (em branco vale como ausente) e o módulo avisa que a linha de fora vence
    await writeFile(envLocal(), `${texto}BILHON_ROOT=\n`);
    const r2 = await run(ctx);
    expect(r2.avisos.some((a: string) => /BILHON_ROOT.*depois do bloco/.test(a))).toBe(true);
    expect((await ler()).endsWith("BILHON_ROOT=\n")).toBe(true);
    // com valor ali, a raiz é sua: sai do bloco (sem linha morta) e o aviso diz que ela vence
    await writeFile(envLocal(), `${texto}BILHON_ROOT=../outra\n`);
    const r3 = await run(ctx);
    const texto3 = await ler();
    expect(texto3.endsWith("BILHON_ROOT=../outra\n")).toBe(true);
    expect(variaveisDoBloco(texto3)).not.toHaveProperty("BILHON_ROOT");
    expect(r3.avisos.some((a: string) => /^BILHON_ROOT \(linha \d+ do \.env\.local\) está definida fora do bloco e vence/.test(a))).toBe(true);
    expect(r3.avisos.some((a: string) => /depois do bloco/.test(a))).toBe(false);
  });

  it("marcadores incompletos ou repetidos: recusa e não altera o arquivo", async () => {
    const quebrado = `A=1\n${MARCA_INICIO}\nBILHON_ROOT=x\n`;
    await writeFile(envLocal(), quebrado);
    await expect(run(ctx)).rejects.toThrow(/marcadores/);
    expect(await ler()).toBe(quebrado);
    expect(() => aplicarBloco(`${MARCA_INICIO}\n${MARCA_FIM}\n${MARCA_INICIO}\n${MARCA_FIM}\n`, montarBloco(ITENS))).toThrow(/marcadores/);
    expect(() => aplicarBloco(`${MARCA_FIM}\n${MARCA_INICIO}\n`, montarBloco(ITENS))).toThrow(/marcadores/);
  });

  it("não carrega segredo, chave nem Supabase", async () => {
    await gravarRepos("minha-org");
    await run(ctx);
    const texto = await ler();
    expect(detectSecret(texto)).toBeNull();
    // os comentários explicam a intenção ("sem Supabase"); só as linhas de variável contam
    const variaveis = texto.split("\n").filter((l) => l && !l.startsWith("#")).join("\n");
    expect(variaveis).not.toMatch(/supabase|service_role|secret|token|password|api_?key|ollama/i);
    for (const nome of Object.keys(variaveisDoBloco(texto))) expect(VARIAVEIS_PERMITIDAS).toContain(nome);
    for (const proibida of ["BILHON_SUPABASE_URL", "BILHON_SUPABASE_SERVICE_ROLE_KEY", "BILHON_ACCESS_TEAM", "BILHON_KNOWLEDGE_BUCKET_FILTER", "PORT"]) {
      expect(() => montarBloco([{ nome: proibida, valor: "x", comentario: "" }])).toThrow(/lista permitida/);
    }
    expect(() => montarBloco([{ nome: "BILHON_ROOT", valor: "a\nB=1", comentario: "" }])).toThrow(/inválido/);
  });

  it("PORT é do usuário: nunca entra no bloco e a linha dele continua sendo a que o next-local lê", async () => {
    // a mesma função do scripts/next-local.mjs, sem PORT no terminal
    await run(ctx);
    expect(portaDoEnvLocal(await ler())).toBeNull(); // arquivo criado pelo populate: sem porta
    expect(lerPorta(await ler(), {})).toBe(PORTA_PADRAO);

    for (const original of [
      "PORT=3301\n",
      "# meu\r\nPORT=3301\r\nFOO=1\r\n",
      "BILHON_KNOWLEDGE_PROVIDER=\nPORT=\nPORT=3301\n",
      "export PORT=3301 # minha porta\n",
    ]) {
      await writeFile(envLocal(), original);
      await run(ctx);
      const texto = await ler();
      expect(texto.startsWith(original)).toBe(true);
      expect(variaveisDoBloco(texto)).not.toHaveProperty("PORT");
      expect(lerPorta(texto, {}), JSON.stringify(original)).toBe("3301");
    }
  });

  it("projetos do kanban só entram quando os cards usam algo além de geral", async () => {
    const board = (...projetos: string[]) =>
      writeFile(path.join(ctx.dataDir, "kanban", "board.json"), JSON.stringify({ cards: projetos.map((projeto) => ({ projeto })) }));
    await mkdir(path.join(ctx.dataDir, "kanban"), { recursive: true });

    await board("geral", "outro");
    await run(ctx);
    expect(variaveisDoBloco(await ler())).not.toHaveProperty("NEXT_PUBLIC_KANBAN_PROJETOS");

    await board("mega-brain", "geral", "projeto inválido #", "mega-brain");
    await run(ctx);
    expect(variaveisDoBloco(await ler()).NEXT_PUBLIC_KANBAN_PROJETOS).toBe("geral,mega-brain");

    // valor definido à mão fora do bloco manda: não é sobrescrito, e o descompasso é avisado
    await writeFile(envLocal(), "NEXT_PUBLIC_KANBAN_PROJETOS=site\n");
    const r = await run(ctx);
    expect(variaveisDoBloco(await ler())).not.toHaveProperty("NEXT_PUBLIC_KANBAN_PROJETOS");
    expect(r.avisos.some((a: string) => /NEXT_PUBLIC_KANBAN_PROJETOS.*geral, mega-brain/.test(a))).toBe(true);

    // em branco (cópia do .env.example) vale como ausente: o bloco grava os projetos e não avisa
    await writeFile(envLocal(), "NEXT_PUBLIC_KANBAN_PROJETOS=\n");
    const r2 = await run(ctx);
    expect(variaveisDoBloco(await ler()).NEXT_PUBLIC_KANBAN_PROJETOS).toBe("geral,mega-brain");
    expect(r2.avisos.some((a: string) => /NEXT_PUBLIC_KANBAN_PROJETOS/.test(a))).toBe(false);
  });

  it("BILHON_OWNERS_PROPRIOS vem só do owner que o módulo agente gravou; sem ele, fica de fora", async () => {
    await run(ctx);
    expect(variaveisDoBloco(await ler())).not.toHaveProperty("BILHON_OWNERS_PROPRIOS"); // sem repos.json: nada inventado

    await gravarRepos("Minha-Org", [
      { slug: "outro", owner: "quem-escreveu-a-mao", procedencia: "propria" }, // sem a marca do agente
      { slug: "upstream", owner: "autor-upstream", procedencia: "adotada", gerado_por: "populate:agente" },
      { slug: "x", owner: "a,b", procedencia: "propria", gerado_por: "populate:agente" }, // quebraria o CSV
      { slug: "y", owner: "dono # comentário", procedencia: "propria", gerado_por: "populate:agente" },
    ]);
    await expect(ownersDoAgente(ctx.dataDir)).resolves.toEqual(["Minha-Org"]);
    expect((await run(ctx)).resumo.acao).toBe("atualizado");
    expect(variaveisDoBloco(await ler()).BILHON_OWNERS_PROPRIOS).toBe("Minha-Org");

    // valor seu fora do bloco manda; em branco (cópia do .env.example) vale como ausente
    await writeFile(envLocal(), "BILHON_OWNERS_PROPRIOS=eu,minha-org\n");
    await run(ctx);
    expect(variaveisDoBloco(await ler())).not.toHaveProperty("BILHON_OWNERS_PROPRIOS");
    await writeFile(envLocal(), "BILHON_OWNERS_PROPRIOS=\n");
    await run(ctx);
    expect(variaveisDoBloco(await ler()).BILHON_OWNERS_PROPRIOS).toBe("Minha-Org");

    // repos.json ilegível ou de outro formato: fica de fora, sem erro
    await gravarEmData("agente/repos.json", "{ isto não é json");
    await run(ctx);
    expect(variaveisDoBloco(await ler())).not.toHaveProperty("BILHON_OWNERS_PROPRIOS");
  });

  it("ontologia e personas entram só quando o arquivo existe em data/ e você não definiu a variável", async () => {
    const nomes = ARQUIVOS_OPCIONAIS.map((a) => a.nome);
    expect(nomes).toEqual(["BILHON_ONTOLOGIA_MANIFEST", "BILHON_PERSONAS_JSON"]);
    for (const nome of nomes) expect(VARIAVEIS_PERMITIDAS).toContain(nome);

    await run(ctx);
    for (const nome of nomes) expect(variaveisDoBloco(await ler())).not.toHaveProperty(nome);

    await gravarEmData("ontologia/ontologia.json", "{}");
    await gravarEmData("ontologia/ontologia.yaml", ONTOLOGIA_MINIMA); // o primeiro candidato vence
    await gravarEmData("personas/personas.json", PERSONAS_MINIMAS);
    expect((await run(ctx)).resumo.acao).toBe("atualizado");
    expect(variaveisDoBloco(await ler())).toMatchObject({
      BILHON_ONTOLOGIA_MANIFEST: "data/ontologia/ontologia.yaml",
      BILHON_PERSONAS_JSON: "data/personas/personas.json",
    });
    expect((await run(ctx)).resumo.acao).toBe("sem-mudanca");

    await rm(path.join(ctx.dataDir, "ontologia", "ontologia.yaml"));
    await run(ctx);
    expect(variaveisDoBloco(await ler()).BILHON_ONTOLOGIA_MANIFEST).toBe("data/ontologia/ontologia.json");

    // uma pasta com o nome do arquivo não conta
    await rm(path.join(ctx.dataDir, "personas"), { recursive: true });
    await mkdir(path.join(ctx.dataDir, "personas", "personas.json"), { recursive: true });
    await run(ctx);
    expect(variaveisDoBloco(await ler())).not.toHaveProperty("BILHON_PERSONAS_JSON");

    // valor seu fora do bloco manda (em branco vale como ausente)
    await writeFile(envLocal(), "BILHON_ONTOLOGIA_MANIFEST=minha/ontologia.yaml\nBILHON_PERSONAS_JSON=\n");
    await rm(path.join(ctx.dataDir, "personas"), { recursive: true });
    await gravarEmData("personas/personas.json", PERSONAS_MINIMAS);
    await run(ctx);
    const vars = variaveisDoBloco(await ler());
    expect(vars).not.toHaveProperty("BILHON_ONTOLOGIA_MANIFEST");
    expect(vars.BILHON_PERSONAS_JSON).toBe("data/personas/personas.json");
  });

  it("BILHON_ROOT é relativo ao app: ../.. no mega-brain; nunca um ancestral comum se o repositório é externo", () => {
    expect(valorRaiz(app, base)).toEqual({ valor: "../..", aviso: null });
    expect(valorRaiz(app, app)).toEqual({ valor: ".", aviso: null });
    // fora do app (--repo): nem o ancestral comum, nem a raiz do volume, nem o próprio repositório
    const raizDoVolume = path.parse(base).root;
    for (const externo of [
      path.join(base, "outro", "mega-brain"), // irmão: o ancestral comum seria <base>
      path.join(raizDoVolume, "outro-repo"), // o ancestral comum seria a raiz do volume
      path.join(app, "data", "repo-dentro-do-app"), // dentro do app: o app não está dentro dele
    ]) {
      const r = valorRaiz(app, externo);
      expect(r.valor, externo).toBeNull();
      expect(r.aviso, externo).toMatch(/fora do app.*BILHON_ROOT não foi gravado/);
    }
  });

  it("--repo externo: o bloco sai sem BILHON_ROOT (e sem o valor antigo), com aviso; o resto do bloco fica", async () => {
    const repoExterno = path.join(path.parse(base).root, "outro-repo-externo");
    // bloco de uma versão anterior, que gravava o ancestral comum
    const velho = montarBloco([{ nome: "BILHON_ROOT", valor: "../../../..", comentario: "velho" }]);
    await writeFile(envLocal(), `${velho}\n`);

    const r = await run({ ...ctx, repoRoot: repoExterno });
    expect(r.resumo.acao).toBe("atualizado");
    expect(r.avisos.filter((a: string) => /fora do app.*BILHON_ROOT não foi gravado/.test(a))).toHaveLength(1);
    const texto = await ler();
    expect(texto).not.toContain("../../../..");
    expect(variaveisDoBloco(texto)).toEqual({
      ...COM_LOCAL,
      BILHON_REGISTRO_ENTIDADES: "data/agente/registro.yaml",
    });
    // idempotente também nesse caso
    expect((await run({ ...ctx, repoRoot: repoExterno })).resumo.acao).toBe("sem-mudanca");
    // e voltar ao caso normal reintroduz a variável
    await run(ctx);
    expect(variaveisDoBloco(await ler()).BILHON_ROOT).toBe("../..");
  });
});

describe("BILHON_KNOWLEDGE_PROVIDER=local só com a busca local utilizável", () => {
  const provider = async () => variaveisDoBloco(await ler()).BILHON_KNOWLEDGE_PROVIDER;
  const aviso = (avisos: string[]) => avisos.find((a) => /BILHON_KNOWLEDGE_PROVIDER=local NÃO foi gravado/.test(a)) ?? "";

  // sem índice (ou com o módulo busca falhando) a CLI nem é chamada: valem com ou sem ela
  it("sem índice (busca pulada ou nunca rodada): fica fora do bloco, com aviso; o resto do bloco permanece", async () => {
    await rm(path.join(app, "data", "search"), { recursive: true });
    const r = await run(ctx);
    expect(await provider()).toBeUndefined();
    expect(r.resumo.provider).toBe("demo (padrão)");
    expect(aviso(r.avisos)).toMatch(/não existe.*data\/search\/index\.sqlite.*modo demo.*--only busca,ambiente/);
    expect(variaveisDoBloco(await ler())).toEqual({
      BILHON_ROOT: "../..",
      BILHON_REGISTRO_ENTIDADES: "data/agente/registro.yaml",
    });
  });

  it("módulo busca falhou (ou não existe) nesta execução: não liga, mesmo com um índice válido", async () => {
    const falhou = await run({ ...ctx, resultados: { busca: { ok: false, erro: "boom" } } });
    expect(await provider()).toBeUndefined();
    expect(aviso(falhou.avisos)).toMatch(/módulo busca falhou nesta execução/);

    const faltando = await run({ ...ctx, resultados: { busca: { ok: false, motivo: "nao-implementado" } } });
    expect(aviso(faltando.avisos)).toMatch(/módulo busca ainda não está implementado/);
  });

  it("provider local definido à mão fora do bloco com a busca indisponível: um aviso só, com o motivo", async () => {
    await rm(path.join(app, "data", "search"), { recursive: true });
    await writeFile(envLocal(), "BILHON_KNOWLEDGE_PROVIDER=local\n");
    const r = await run(ctx);
    expect(
      r.avisos.some((a: string) =>
        /define BILHON_KNOWLEDGE_PROVIDER=local fora do bloco \(linha 1\); com a busca indisponível \(o índice de busca local não existe/.test(a),
      ),
    ).toBe(true);
    expect(aviso(r.avisos)).toBe(""); // o "local" é seu: o bloco não diz que deixou de gravá-lo
    expect(r.resumo.provider).toBe("local (seu, linha 1 do .env.local)");
    const texto = await ler();
    expect(texto.startsWith("BILHON_KNOWLEDGE_PROVIDER=local\n")).toBe(true); // o que é do usuário não é tocado
    expect(variaveisDoBloco(texto)).not.toHaveProperty("BILHON_KNOWLEDGE_PROVIDER");
  });

  describe.skipIf(!TEM_SQLITE3_FTS5)("com a CLI sqlite3 (a mesma via do provider)", () => {
    it("índice presente e legível: grava local e não avisa", async () => {
      const r = await run(ctx);
      expect(await provider()).toBe("local");
      expect(r.resumo.provider).toBe("local");
      expect(aviso(r.avisos)).toBe("");
    });

    it("índice vazio, de outro esquema ou ilegível: não liga o provider", async () => {
      const casos: Array<[string, () => Promise<void>, RegExp]> = [
        ["vazio", () => criarIndice(indiceDoApp(), { trechos: 0 }), /vazio \(0 trechos\)/],
        ["esquema diferente", () => criarIndice(indiceDoApp(), { versao: "99" }), /esquema "99" \(esperado "1"\)/],
        ["não é um banco", () => writeFile(indiceDoApp(), "isto não é um sqlite, é só texto ".repeat(20)), /não é legível pela CLI sqlite3/],
        ["é uma pasta", async () => { await mkdir(indiceDoApp()); }, /não é um arquivo/],
      ];
      for (const [nome, preparar, esperado] of casos) {
        await rm(indiceDoApp(), { recursive: true, force: true });
        await preparar();
        const r = await run(ctx);
        expect(await provider(), nome).toBeUndefined();
        expect(aviso(r.avisos), nome).toMatch(esperado);
        // a mensagem não vaza o caminho absoluto do índice
        expect(aviso(r.avisos), nome).not.toContain(base);
      }
    });

    it("busca concluída (ou não incluída na execução): vale o que o índice mostra", async () => {
      await run({ ...ctx, resultados: { busca: { ok: true } } });
      expect(await provider()).toBe("local");
      await rm(path.join(app, "data", "search"), { recursive: true });
      await run({ ...ctx, resultados: { livros: { ok: true } } });
      expect(await provider()).toBeUndefined();
    });

    it("acompanha o índice: aparece quando ele passa a existir e sai quando some", async () => {
      await rm(path.join(app, "data", "search"), { recursive: true });
      expect((await run(ctx)).resumo.acao).toBe("criado");
      expect(await provider()).toBeUndefined();

      await criarIndice(indiceDoApp());
      expect((await run(ctx)).resumo.acao).toBe("atualizado");
      expect(await provider()).toBe("local");
      expect((await run(ctx)).resumo.acao).toBe("sem-mudanca");

      await rm(path.join(app, "data", "search"), { recursive: true });
      expect((await run(ctx)).resumo.acao).toBe("atualizado");
      expect(await provider()).toBeUndefined();
    });

    it("BILHON_LOCAL_SEARCH_DB definida à mão fora do bloco é o índice conferido", async () => {
      // aponta para um arquivo que não existe, embora o índice padrão esteja ok: o app abriria esse
      await writeFile(envLocal(), "OUTRA=1\nBILHON_LOCAL_SEARCH_DB=data/outro/nao-existe.sqlite\n");
      const quebrado = await run(ctx);
      expect(await provider()).toBeUndefined();
      expect(aviso(quebrado.avisos)).toMatch(/BILHON_LOCAL_SEARCH_DB \(linha 2 do \.env\.local\)/);

      // aponta para um índice bom, embora o padrão não exista
      await rm(path.join(app, "data", "search"), { recursive: true });
      await criarIndice(path.join(app, "data", "outro", "indice.sqlite"));
      await writeFile(envLocal(), "BILHON_LOCAL_SEARCH_DB=data/outro/indice.sqlite\n");
      const bom = await run(ctx);
      expect(await provider()).toBe("local");
      expect(aviso(bom.avisos)).toBe("");

      // valor em branco (cópia do .env.example) vale como ausente: volta ao padrão
      await writeFile(envLocal(), "BILHON_LOCAL_SEARCH_DB=\n");
      await run(ctx);
      expect(await provider()).toBeUndefined();
    });

    it("provider local seu fora do bloco, com a busca utilizável: não se repete no bloco e não avisa", async () => {
      await writeFile(envLocal(), "BILHON_KNOWLEDGE_PROVIDER=local\n");
      const r = await run(ctx);
      expect(await provider()).toBeUndefined();
      // nada sobre a sua linha; só a conferência de lib/providers, que vale também para o "local"
      // seu (o app temporário dos testes não tem lib/providers/index.ts)
      expect(r.avisos.filter((a: string) => /BILHON_KNOWLEDGE_PROVIDER/.test(a))).toEqual([
        expect.stringMatching(/^lib\/providers\/index\.ts ainda não reconhece BILHON_KNOWLEDGE_PROVIDER=local/),
      ]);
      expect(r.resumo.provider).toBe("local (seu, linha 1 do .env.local)");
    });
  });

  describe("diagnosticarBuscaLocal", () => {
    it.skipIf(!TEM_SQLITE3_FTS5)("lê o índice pela CLI sqlite3, como o provider", async () => {
      await criarIndice(indiceDoApp(), { trechos: 3 });
      await expect(diagnosticarBuscaLocal(indiceDoApp(), { versaoEsperada: VERSAO_ESQUEMA })).resolves.toEqual({ ok: true, trechos: 3, arquivos: 3 });
      // sem versão esperada a comparação de esquema é dispensada
      await criarIndice(path.join(app, "data", "v9.sqlite"), { versao: "9" });
      await expect(diagnosticarBuscaLocal(path.join(app, "data", "v9.sqlite"))).resolves.toMatchObject({ ok: true });
    });

    it("sem a CLI sqlite3 no PATH: motivo claro (o provider local não consegue consultar o índice)", async () => {
      const r = await diagnosticarBuscaLocal(indiceDoApp(), { comando: "sqlite3-que-nao-existe-xyz" });
      expect(r).toMatchObject({ ok: false });
      expect((r as { motivo: string }).motivo).toMatch(/CLI sqlite3 não foi encontrada no PATH/);
    });
  });
});

describe("valor seu fora do bloco vence: provider, raiz e registro", () => {
  const PROVIDER_RAIZ_REGISTRO = ["BILHON_KNOWLEDGE_PROVIDER", "BILHON_ROOT", "BILHON_REGISTRO_ENTIDADES"];
  const avisoQueComeca = (avisos: string[], inicio: RegExp) => avisos.find((a) => inicio.test(a)) ?? "";

  it("provider supabase, BILHON_ROOT=data e registro próprio: nada disso entra no bloco, o Next lê os seus e cada um é avisado", async () => {
    const original =
      "# meu\nBILHON_KNOWLEDGE_PROVIDER=supabase\nBILHON_ROOT=data\nBILHON_REGISTRO_ENTIDADES=data/meu-registro.yaml\n";
    await gravarRepos("minha-org");
    await writeFile(envLocal(), original);
    const r = await run(ctx);
    const texto = await ler();
    expect(texto.startsWith(original)).toBe(true);
    // o bloco leva só o que não é seu
    expect(variaveisDoBloco(texto)).toEqual({ BILHON_OWNERS_PROPRIOS: "minha-org" });
    // e o Next (a última definição vence) continua lendo os seus valores, não "local" nem "../.."
    expect(lidoPeloNext([texto], PROVIDER_RAIZ_REGISTRO)[0]).toEqual({
      BILHON_KNOWLEDGE_PROVIDER: "supabase",
      BILHON_ROOT: "data",
      BILHON_REGISTRO_ENTIDADES: "data/meu-registro.yaml",
    });
    expect(r.resumo.provider).toBe("supabase (seu, linha 2 do .env.local)");

    const doProvider = avisoQueComeca(r.avisos, /^O \.env\.local usa o provider supabase \(BILHON_KNOWLEDGE_PROVIDER, linha 2, fora do bloco\) e ele vence/);
    expect(doProvider).toMatch(
      TEM_SQLITE3_FTS5
        ? /apague a linha 2 \(ou deixe-a em branco\) e rode de novo: npm run populate -- --yes --only ambiente\.$/
        : /apague a linha 2 \(ou deixe-a em branco\) e rode de novo: npm run populate -- --yes --only busca,ambiente\. Hoje a busca local também não está utilizável/,
    );
    expect(r.avisos.some((a: string) => /NÃO foi gravado/.test(a))).toBe(false);

    // data contém data/agente, data/addons e data/topology, e o registro é seu: só o aviso de que a raiz vence
    const daRaiz = avisoQueComeca(r.avisos, /^BILHON_ROOT \(linha 3 do \.env\.local\) está definida fora do bloco e vence: o bloco não grava a raiz do Megabrain \("\.\.\/\.\."\)\./);
    expect(daRaiz).toMatch(/Para usar a raiz do Megabrain, apague a linha 3/);
    expect(daRaiz).not.toMatch(/fora dessa raiz|observed/);

    const doRegistro = avisoQueComeca(r.avisos, /^BILHON_REGISTRO_ENTIDADES \(linha 4 do \.env\.local\) está definida fora do bloco e vence/);
    expect(doRegistro).toMatch(/não o data\/agente\/registro\.yaml gerado pelo populate\. Para usar o gerado, apague a linha 4/);

    // os avisos levam nomes e linhas, não os caminhos que você escreveu
    for (const a of r.avisos) expect(a).not.toMatch(/meu-registro|BILHON_ROOT=data/);
    expect((await run(ctx)).resumo.acao).toBe("sem-mudanca");
  });

  it("valor seu entrou depois de uma população: a variável sai do bloco na próxima execução", async () => {
    await run(ctx);
    expect(variaveisDoBloco(await ler())).toMatchObject({ BILHON_ROOT: "../..", BILHON_REGISTRO_ENTIDADES: "data/agente/registro.yaml" });
    await writeFile(envLocal(), `BILHON_KNOWLEDGE_PROVIDER=supabase\n${await ler()}BILHON_REGISTRO_ENTIDADES=meu.yaml\n`);
    expect((await run(ctx)).resumo.acao).toBe("atualizado");
    const texto = await ler();
    expect(variaveisDoBloco(texto)).toEqual({ BILHON_ROOT: "../.." });
    expect(lidoPeloNext([texto], PROVIDER_RAIZ_REGISTRO)[0]).toEqual({
      BILHON_KNOWLEDGE_PROVIDER: "supabase",
      BILHON_ROOT: "../..",
      BILHON_REGISTRO_ENTIDADES: "meu.yaml",
    });
  });

  it("raiz sua que não contém as pastas do app: o aviso diz o que fica de fora e quais telas o app recusa", async () => {
    await writeFile(envLocal(), "BILHON_ROOT=data/agente\n");
    const r = await run(ctx);
    expect(variaveisDoBloco(await ler())).not.toHaveProperty("BILHON_ROOT");
    const daRaiz = avisoQueComeca(r.avisos, /^BILHON_ROOT \(linha 1 do \.env\.local\)/);
    expect(daRaiz).toMatch(/data\/addons e data\/topology ficam fora dessa raiz: o app recusa os add-ons e a topologia até que ela as contenha\./);
    expect(daRaiz).not.toMatch(/página Agente/);
    // com o registro gerado pelo populate, a raiz precisa ser o repositório lido
    expect(daRaiz).toMatch(/caminhos `observed` do registro gerado pelo populate .* não resolvem a partir dela/);

    // a pasta trocada por uma variável sua (fora do bloco) é a que conta
    await writeFile(envLocal(), "BILHON_ROOT=data\nBILHON_TOPOLOGY_DIR=../topologia-fora\n");
    const r2 = await run(ctx);
    expect(avisoQueComeca(r2.avisos, /^BILHON_ROOT \(linha 1 do \.env\.local\)/)).toMatch(
      /BILHON_TOPOLOGY_DIR \(linha 2\) fica fora dessa raiz: o app recusa a topologia até que ela a contenha\./,
    );
  });

  it("raiz e registro seus que levam ao mesmo lugar do bloco: ficam fora dele, sem aviso", async () => {
    await writeFile(envLocal(), "BILHON_ROOT=../../\nBILHON_REGISTRO_ENTIDADES=./data/agente/registro.yaml\n");
    const r = await run(ctx);
    const vars = variaveisDoBloco(await ler());
    expect(vars).not.toHaveProperty("BILHON_ROOT");
    expect(vars).not.toHaveProperty("BILHON_REGISTRO_ENTIDADES");
    expect(r.avisos.filter((a: string) => /BILHON_ROOT|BILHON_REGISTRO_ENTIDADES/.test(a))).toEqual([]);
  });

  it("a última definição é a que conta: em branco depois de um valor vale como ausente", async () => {
    await writeFile(envLocal(), "BILHON_REGISTRO_ENTIDADES=meu.yaml\nBILHON_ROOT=data\nBILHON_REGISTRO_ENTIDADES=\nBILHON_ROOT=\n");
    const r = await run(ctx);
    expect(variaveisDoBloco(await ler())).toMatchObject({ BILHON_ROOT: "../..", BILHON_REGISTRO_ENTIDADES: "data/agente/registro.yaml" });
    expect(r.avisos.filter((a: string) => /^BILHON_(ROOT|REGISTRO_ENTIDADES) \(linha/.test(a))).toEqual([]);
  });

  it("provider que o app não reconhece: não é repetido no aviso nem no resumo", async () => {
    await writeFile(envLocal(), "BILHON_KNOWLEDGE_PROVIDER=valor-xyz-qualquer\n");
    const r = await run(ctx);
    expect(variaveisDoBloco(await ler())).not.toHaveProperty("BILHON_KNOWLEDGE_PROVIDER");
    expect(avisoQueComeca(r.avisos, /^O \.env\.local usa um provider que o app não reconhece/)).toMatch(/linha 1, fora do bloco\) e ele vence/);
    expect(r.resumo.provider).toBe("não reconhecido (seu, linha 1 do .env.local)");
    expect(JSON.stringify(r)).not.toContain("valor-xyz-qualquer");
  });

  it("--repo externo com a sua BILHON_ROOT: sem o aviso de --repo; avisa só o que a raiz não atende", async () => {
    const repoExterno = path.join(path.parse(base).root, "outro-repo-externo");
    // raiz que contém o app (e data/agente|addons|topology) e registro seu: nada a dizer
    await writeFile(envLocal(), `BILHON_ROOT=${base}\nBILHON_REGISTRO_ENTIDADES=data/meu.yaml\n`);
    const r = await run({ ...ctx, repoRoot: repoExterno });
    expect(variaveisDoBloco(await ler())).not.toHaveProperty("BILHON_ROOT");
    expect(r.avisos.filter((a: string) => /BILHON_ROOT/.test(a))).toEqual([]);

    // com o registro gerado, os `observed` (relativos ao repositório lido) não resolvem a partir dela
    await writeFile(envLocal(), `BILHON_ROOT=${base}\n`);
    const r2 = await run({ ...ctx, repoRoot: repoExterno });
    const daRaiz = avisoQueComeca(r2.avisos, /^BILHON_ROOT \(linha 1 do \.env\.local\) é a raiz que o app usa \(com --repo externo/);
    expect(daRaiz).toMatch(/observed/);
    expect(daRaiz).not.toMatch(/apague a linha/);
    expect(r2.avisos.some((a: string) => /BILHON_ROOT não foi gravado/.test(a))).toBe(false);
    expect(daRaiz).not.toContain(base);
  });

  it("registro seu fora do bloco que é o próprio registro gerado: com uma raiz sua que não é o repositório lido, o aviso dos `observed` continua", async () => {
    const observed = /caminhos `observed` do registro gerado pelo populate .* não resolvem a partir dela/;
    // mesmo arquivo que o bloco gravaria, escrito de outro jeito: os `observed` dele são relativos ao repositório lido
    await writeFile(envLocal(), "BILHON_ROOT=data\nBILHON_REGISTRO_ENTIDADES=./data/agente/registro.yaml\n");
    const r = await run(ctx);
    expect(variaveisDoBloco(await ler())).not.toHaveProperty("BILHON_REGISTRO_ENTIDADES");
    const daRaiz = avisoQueComeca(r.avisos, /^BILHON_ROOT \(linha 1 do \.env\.local\) está definida fora do bloco e vence/);
    expect(daRaiz).toMatch(observed);
    expect(daRaiz).not.toMatch(/fora dessa raiz/); // data contém data/agente, data/addons e data/topology
    expect(r.avisos.some((a: string) => /^BILHON_REGISTRO_ENTIDADES \(linha/.test(a))).toBe(false); // é o gerado: nada a dizer dele

    // --repo externo e uma raiz sua que contém o app: o único problema é o registro gerado (antes, nenhum aviso)
    const repoExterno = path.join(path.parse(base).root, "outro-repo-externo");
    await writeFile(envLocal(), `BILHON_ROOT=${base}\nBILHON_REGISTRO_ENTIDADES=${path.join(app, "data", "agente", "registro.yaml")}\n`);
    const r2 = await run({ ...ctx, repoRoot: repoExterno });
    const daRaiz2 = avisoQueComeca(r2.avisos, /^BILHON_ROOT \(linha 1 do \.env\.local\) é a raiz que o app usa \(com --repo externo/);
    expect(daRaiz2).toMatch(observed);
    expect(daRaiz2).not.toContain(base);

    // controle: registro seu em outro arquivo, mesma raiz: os `observed` do gerado não importam
    await writeFile(envLocal(), "BILHON_ROOT=data\nBILHON_REGISTRO_ENTIDADES=data/meu-registro.yaml\n");
    const r3 = await run(ctx);
    expect(avisoQueComeca(r3.avisos, /^BILHON_ROOT \(linha 1 do \.env\.local\)/)).not.toMatch(/observed/);
  });

  it("indiceDeBusca: vale a última definição de BILHON_LOCAL_SEARCH_DB fora do bloco, como no Next; em branco, o padrão", () => {
    const padrao = { caminho: path.join(ctx.dataDir, "search", "index.sqlite"), personalizado: false, linha: null };
    const casos: Array<[string, Array<{ linha: number; valor: string }>, object]> = [
      ["BILHON_LOCAL_SEARCH_DB=data/a.sqlite\n", [{ linha: 1, valor: "data/a.sqlite" }], { caminho: path.resolve(app, "data/a.sqlite"), personalizado: true, linha: 1 }],
      ["BILHON_LOCAL_SEARCH_DB=data/a.sqlite\nBILHON_LOCAL_SEARCH_DB=data/b.sqlite\n", [{ linha: 1, valor: "data/a.sqlite" }, { linha: 2, valor: "data/b.sqlite" }], { caminho: path.resolve(app, "data/b.sqlite"), personalizado: true, linha: 2 }],
      // a última em branco vence o valor de antes: o app abre o padrão, não data/a.sqlite
      ["BILHON_LOCAL_SEARCH_DB=data/a.sqlite\nBILHON_LOCAL_SEARCH_DB=\n", [{ linha: 1, valor: "data/a.sqlite" }, { linha: 2, valor: "" }], padrao],
    ];
    const lidos = lidoPeloNext(casos.map(([texto]) => texto), ["BILHON_LOCAL_SEARCH_DB"]);
    casos.forEach(([texto, defs, esperado], i) => {
      const fora = defs.map((d) => ({ nome: "BILHON_LOCAL_SEARCH_DB", ...d }));
      expect(indiceDeBusca(app, ctx.dataDir, fora), JSON.stringify(texto)).toEqual(esperado);
      // o que o Next entrega ao app (lib/providers/local/search.ts: em branco = padrão)
      const lido = lidos[i].BILHON_LOCAL_SEARCH_DB?.trim();
      expect(lido ? path.resolve(app, lido) : padrao.caminho, JSON.stringify(texto)).toBe((esperado as { caminho: string }).caminho);
    });
  });
});

describe("PORT (scripts/porta-local.mjs, lida pelo scripts/next-local.mjs)", () => {
  const CASOS: Array<[string, string]> = [
    ["PORT=3301\n", "3301"],
    ["PORT=3301 # minha porta\n", "3301"],
    ["export PORT=3301\n", "3301"],
    ["﻿PORT=3301\n", "3301"],
    ["PORT=3301\nFOO=1\nPORT=3302\n", "3302"],
    ['PORT="3301"\n', "3301"],
    ["PORT='3301' # aspas simples\n", "3301"],
    ["  PORT = 3301\r\nFOO=1\r\n", "3301"],
    ["PORT: 3301\n", "3301"],
    ["# PORT=3301\n", PORTA_PADRAO],
    ["PORT=3301\nPORT=\n", PORTA_PADRAO], // a última está em branco: vale o padrão, como no Next
    ["XPORT=1\nPORT_X=2\n", PORTA_PADRAO],
    ["", PORTA_PADRAO],
  ];

  it("lê o .env.local como o dotenv: a última vence, export, comentário, aspas e BOM", () => {
    for (const [texto, porta] of CASOS) expect(lerPorta(texto, {}), JSON.stringify(texto)).toBe(porta);
    expect(lerPorta(null, {})).toBe(PORTA_PADRAO); // sem .env.local
    expect(portaDoEnvLocal("A=1\n\n# c\nexport PORT=3301 # x\n")).toEqual({ valor: "3301", linha: 4 });
    expect(portaDoEnvLocal("A=1\r\nPORT=3301\r\nPORT=\r\n")).toEqual({ valor: "", linha: 3 });
  });

  it("concorda com o @next/env de verdade sobre o valor de PORT", () => {
    const textos = CASOS.map(([texto]) => texto);
    const lidos = lidoPeloNext(textos, ["PORT"]);
    textos.forEach((texto, i) => expect(portaDoEnvLocal(texto)?.valor, JSON.stringify(texto)).toBe(lidos[i].PORT));
  });

  it("PORT do ambiente do terminal vence o .env.local; em branco vale como ausente", () => {
    expect(lerPorta("PORT=3301\n", { PORT: "3305" })).toBe("3305");
    expect(lerPorta("PORT=3301\n", { PORT: "  " })).toBe("3301");
    expect(lerPorta(null, { PORT: " 3305 " })).toBe("3305");
    expect(lerPorta("PORT=03301\n", {})).toBe("3301");
  });

  it("PORT inválida: mensagem clara, com a origem", () => {
    expect(() => lerPorta("A=1\nPORT=abc\n", {})).toThrow(
      'PORT do .env.local (linha 2) é inválida: "abc". Use um número inteiro de 1 a 65535, ou deixe em branco para a porta padrão (3300).',
    );
    expect(() => lerPorta("PORT=3301\n", { PORT: "70000" })).toThrow(/^PORT do ambiente do terminal é inválida: "70000"/);
    for (const ruim of ["0", "65536", "3301.5", "0x10", "1e3", "-1", "33 01", "$OUTRA"]) {
      expect(() => lerPorta(`PORT=${ruim}\n`, {}), ruim).toThrow(/é inválida/);
    }
  });
});

describe("contra os leitores reais do app (BILHON_ROOT relativo ao diretório de trabalho)", () => {
  /** Aplica no ambiente exatamente o que o módulo grava no bloco, como o Next faria. */
  async function aplicarBlocoNoAmbiente() {
    await run(ctx);
    const vars = variaveisDoBloco(await ler());
    for (const nome of ["BILHON_AGENTE_DIR", "BILHON_ADDONS_DIR", "BILHON_TOPOLOGY_DIR", "BILHON_REPOS_JSON", "BILHON_AGENTES_JSON"]) {
      vi.stubEnv(nome, ""); // em branco = padrão (data/...), como num ambiente que só tem o bloco
    }
    for (const [nome, valor] of Object.entries(vars)) vi.stubEnv(nome, valor);
    limparCacheEcossistema();
    return vars;
  }
  const doApp = (...partes: string[]) => path.resolve(process.cwd(), ...partes);

  it("aceita registro, data/agente, data/addons e data/topology e rejeita o que está fora da raiz", async () => {
    await aplicarBlocoNoAmbiente();
    expect(bilhonRoot()).toBe(doApp("..", ".."));

    for (const dentro of [
      doApp("data", "agente"),
      doApp("data", "agente", "registro.yaml"),
      doApp("data", "addons"),
      doApp("data", "addons", "manifest.json"),
      doApp("data", "topology"),
      doApp("data", "topology", "nodes.json"),
      doApp("data", "ontologia", "ontologia.yaml"),
      doApp("data", "personas", "personas.json"),
      doApp("..", "..", "squads"),
      doApp("..", "..", ".claude", "skills"),
    ]) {
      expect(caminhoBilhonPermitido(dentro), dentro).toBe(true);
    }

    for (const fora of [
      doApp("..", "..", ".."),
      doApp("..", "..", "..", "outro-projeto"),
      path.join(path.parse(process.cwd()).root, "fora-da-raiz.json"), // o tmpdir do vitest fica dentro do app
      "\\\\servidor\\compartilhamento",
      "//servidor/compartilhamento",
      "",
    ]) {
      expect(caminhoBilhonPermitido(fora), fora).toBe(false);
    }
  });

  it("os leitores de topologia e add-ons aceitam as pastas padrão sob essa raiz", async () => {
    await aplicarBlocoNoAmbiente();
    expect(topologyDir()).toBe(doApp("data", "topology"));
    await expect(getAddonCatalogo()).resolves.toBeDefined();
  });

  it("controle negativo: com outra raiz, as mesmas pastas passam a ser recusadas", async () => {
    await aplicarBlocoNoAmbiente();
    vi.stubEnv("BILHON_ROOT", base);
    expect(caminhoBilhonPermitido(doApp("data", "topology"))).toBe(false);
    expect(() => topologyDir()).toThrow(/fora da raiz/);
  });

  it("o registro de entidades e os owners próprios chegam ao inventário do Agente", async () => {
    await gravarRepos("minha-org");
    const vars = await aplicarBlocoNoAmbiente();
    expect(vars.BILHON_OWNERS_PROPRIOS).toBe("minha-org");
    const entidades = mapearRegistro([
      { api_name: "equipe", tipo: "squad", observed: ["squads/equipe"], owner: "minha-org" },
      { api_name: "de-fora", tipo: "agent", observed: ["agents/de-fora/agent.md"], owner: "alguem-de-fora" },
      { api_name: "escapa", tipo: "agent", observed: ["../../../fora/agent.md"] },
    ]);
    expect(entidades.map((e) => [e.name, e.path, e.procedencia])).toEqual([
      ["equipe", "squads/equipe", "propria"],
      ["de-fora", "agents/de-fora/agent.md", "terceiro"],
    ]);

    const eco = await getEcosystem();
    const registro = eco.fontes?.find((f) => f.id === "registro");
    // o caminho do bloco está configurado e dentro da raiz (ausente ou lido, nunca recusado)
    expect(registro?.estado).not.toBe("nao-configurada");
    expect(registro?.estado).not.toBe("fora-da-raiz");
  });

  it("ontologia e personas do bloco abrem nas telas (/ontologia e a aba Personas) com a raiz do bloco", async () => {
    await gravarEmData("ontologia/ontologia.yaml", ONTOLOGIA_MINIMA);
    await gravarEmData("personas/personas.json", PERSONAS_MINIMAS);
    await run(ctx);
    const vars = variaveisDoBloco(await ler());
    // o Next inicia na pasta do app: caminhos relativos do bloco resolvem a partir dela
    vi.stubEnv("BILHON_ROOT", path.resolve(app, vars.BILHON_ROOT));
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", path.resolve(app, vars.BILHON_ONTOLOGIA_MANIFEST));
    vi.stubEnv("BILHON_PERSONAS_JSON", path.resolve(app, vars.BILHON_PERSONAS_JSON));

    const onto = await getOntologia();
    expect(onto.estado).toBe("ok");
    expect(onto.fonte).toBe("ontologia.yaml"); // só o nome vai para a tela
    const personas = await carregarPersonas();
    expect(personas.estado).toBe("ok");
    expect(personas.personas.map((p) => p.id)).toEqual(["operador"]);

    // controle negativo: sem a variável a tela fica no estado vazio
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", "");
    expect((await getOntologia()).estado).toBe("nao-configurada");
  });

  // o status() do provider local consulta o índice pela CLI sqlite3: sem ela, não há o que comparar
  it.skipIf(!TEM_SQLITE3_FTS5)("o provider que o app escolhe a partir do bloco: configurado com o índice; demo (nunca 'não configurado') sem ele", async () => {
    // o ambiente da máquina não pode decidir por nós
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "");
    vi.stubEnv("BILHON_LOCAL_SEARCH_DB", indiceDoApp());

    await aplicarBlocoNoAmbiente();
    expect(process.env.BILHON_KNOWLEDGE_PROVIDER).toBe("local");
    const comIndice = await getKnowledgeProvider().status();
    expect(comIndice.configured).toBe(true);
    expect(comIndice.reason).toMatch(/Busca local ativa \(1 trechos de 1 arquivos/);

    // sem índice o bloco deixa a variável de fora e o app cai no demo, que abre normalmente
    await rm(path.join(app, "data", "search"), { recursive: true });
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "");
    await aplicarBlocoNoAmbiente();
    expect(process.env.BILHON_KNOWLEDGE_PROVIDER).toBe("");
    await expect(getKnowledgeProvider().status()).resolves.toEqual({ configured: true });

    // controle negativo: é isto que o app mostraria se o bloco tivesse gravado `local` mesmo assim
    vi.stubEnv("BILHON_KNOWLEDGE_PROVIDER", "local");
    const semIndice = await getKnowledgeProvider().status();
    expect(semIndice.configured).toBe(false);
    expect(semIndice.reason).toMatch(/sem índice de busca/);
  });
});

describe("orquestrador: raiz do Megabrain e primeiro uso", () => {
  /** Cria `<base>/<nome>` com as pastas pedidas. */
  async function arvore(nome: string, pastas: string[]) {
    const raiz = path.join(base, nome);
    for (const p of pastas) await mkdir(path.join(raiz, p), { recursive: true });
    return raiz;
  }

  it("populate e app concordam sobre o que é um Megabrain (mesmos sinais de lib/primeiro-uso.ts)", async () => {
    const casos: Array<[string, string[], boolean]> = [
      ["knowledge-engine", ["knowledge", "engine", ".claude", "agents"], true],
      ["sem-engine", ["knowledge", "agents", "core"], true],
      ["sem-knowledge", ["engine", ".claude"], false], // o populate antigo aceitava; o app nunca detectou
      ["uma-pasta-generica", ["knowledge", "agents"], false],
    ];
    for (const [nome, pastas, megabrain] of casos) {
      const raiz = await arvore(nome, pastas);
      const det = detectarMegabrain({ appDir: path.join(raiz, "apps", "knowledge"), raizExplicita: raiz });
      expect(det.detectado, nome).toBe(megabrain);
      expect(sinaisDeMegabrain(raiz), nome).toEqual(megabrain ? det.sinais : null);
      if (megabrain) expect(resolveRepoRoot(raiz), nome).toBe(path.resolve(raiz));
      else expect(() => resolveRepoRoot(raiz), nome).toThrow(/não parece um Megabrain.*BILHON_MEGABRAIN_ROOT/);
    }
  });

  it("raiz: --repo vence BILHON_MEGABRAIN_ROOT, que vence o nome antigo; em branco vale como ausente", async () => {
    const a = await arvore("mb-a", ["knowledge", "engine"]);
    const b = await arvore("mb-b", ["knowledge", "engine"]);
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", a);
    vi.stubEnv("MEGABRAIN_REPO_ROOT", b);
    // app temporário e sem .env*: o .env.local real não entra na conta
    const app = await arvore("mb-app", []);
    expect(resolveRepoRoot(undefined, app)).toBe(a);
    expect(resolveRepoRoot(b, app)).toBe(b);
    vi.stubEnv("BILHON_MEGABRAIN_ROOT", "  ");
    expect(resolveRepoRoot(undefined, app)).toBe(b);
  });
});
