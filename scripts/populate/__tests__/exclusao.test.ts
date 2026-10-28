/**
 * `BILHON_POPULATE_EXCLUIR`: arquivos do Megabrain lido que NÃO podem aparecer em `data/` (cópias de um repositório
 * privado). Cobre:
 *  - a lista (vírgula ou ponto e vírgula, barras `/` ou `\`, glob simples com `*` e `**`, pasta inteira) e a leitura
 *    do terminal ou dos `.env*` do app (terminal vence arquivo);
 *  - `scanRepo` registra o arquivo em `excluded` com o motivo `excluido-pela-configuracao`, resume quantos e quais
 *    e avisa a entrada que não casa nada (erro de digitação) ou que sai da raiz;
 *  - com uma população COMPLETA (`executar`, todos os módulos), nem o conteúdo nem o caminho de um arquivo excluído
 *    chega a qualquer arquivo de `data/` (estante, coleções, busca, grafo, topologia, agente, add-ons, kanban,
 *    referências, especialistas, ontologia);
 *  - sem a variável nada muda: os mesmos arquivos entram.
 *
 * Tudo em pasta temporária (app + Megabrain sintético): nenhum `data/` ou `.env.local` reais são tocados.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ativarExclusoes, avisosDeExclusao, compilarExclusoes, lerExclusoesDoAmbiente, lerTextoSeguro, scanRepo,
} from "../common.mjs";
import { executar } from "../../populate.mjs";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

const APP = process.cwd();
const GIT_AUSENTE = {
  ok: false, motivo: "sem git (teste)", inicial: new Set<string>(), depois: new Set<string>(), modificados: new Set<string>(),
  rastreados: new Set<string>(), head: null, origin: null, upstream: null,
};

const criados: string[] = [];
afterAll(async () => {
  for (const d of criados) await rm(d, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  ativarExclusoes(null);
});

const MARCAS = {
  doc: "PRIVADO-MARCADOR-ALFA",
  squad: "PRIVADO-MARCADOR-BETA",
  codigo: "PRIVADO-MARCADOR-GAMA",
  transcricao: "PRIVADO-MARCADOR-DELTA",
  dna: "PRIVADO-MARCADOR-EPSILON",
};
const LISTA = "docs/privado.md; squads\\secreto\\**, engine/**/modulo_privado.py,knowledge/external/processed/ana/**/privada.txt,knowledge/external/dna/persons/ana/valores.yaml";

async function escrever(raiz: string, rel: string, conteudo: string) {
  const abs = path.join(raiz, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, conteudo, "utf8");
}

const TX_PUBLICA = [
  "# Aula publica",
  "Canal: Ana Teste",
  "---",
  "",
  "[00:00] Texto publico da aula sobre foco e rotina de estudo que continua na estante normalmente.",
  "",
].join("\n");
const TX_PRIVADA = [
  "# Aula privada",
  "Canal: Ana Teste",
  "---",
  "",
  `[00:00] ${MARCAS.transcricao} este trecho vem de um repositorio privado e nunca pode aparecer no app.`,
  "",
].join("\n");

/** `<tmp>/app` (com data/) + `<tmp>/mb` (Megabrain sintético, com o conteúdo que a exclusão precisa barrar). */
async function cenario(envLocal?: string) {
  const base = path.join(APP, "node_modules", ".cache", "knowledge-tests");
  await mkdir(base, { recursive: true });
  const tmp = await mkdtemp(path.join(base, "populate-exclusao-"));
  criados.push(tmp);
  const app = path.join(tmp, "app");
  const repo = path.join(tmp, "mb");
  await mkdir(path.join(app, "data"), { recursive: true });
  if (envLocal !== undefined) await writeFile(path.join(app, ".env.local"), envLocal);

  await escrever(repo, "README.md", "# Mega Brain de teste\n\n> Sistema sintetico para o teste de exclusao.\n");
  await escrever(repo, "docs/publico.md", "# Publico\n\nTexto publico PUBLICO-OK. Veja tambem docs/privado.md e squads/secreto/a.md.\n");
  await escrever(repo, "docs/privado.md", `# Privado\n\n${MARCAS.doc} conteudo copiado de um repositorio privado.\n`);
  await escrever(repo, "squads/secreto/a.md", `# Squad secreto\n\n${MARCAS.squad} agente do repositorio privado.\n`);
  await escrever(repo, "squads/secreto/agent-registry.yaml", `name: secreto\ndescription: ${MARCAS.squad}\n`);
  await escrever(repo, "squads/aberto/squad.yaml", "name: aberto\ndescription: Squad aberto de teste do populate com exclusao\n");
  await escrever(repo, "engine/nucleo/__init__.py", "");
  await escrever(repo, "engine/nucleo/modulo_publico.py", '"""Modulo publico do nucleo."""\n\n\ndef publico():\n    return 1\n');
  await escrever(repo, "engine/nucleo/modulo_privado.py", `"""${MARCAS.codigo}."""\n\n\ndef privado():\n    return 2\n`);
  // especialista ana: DNA, duas transcrições (uma excluída) e insights que citam as duas
  await escrever(repo, "knowledge/external/dna/persons/ana/filosofias.yaml", "layer: L1\nentries: []\n");
  await escrever(repo, "knowledge/external/dna/persons/ana/valores.yaml", `layer: L7\nentries:\n  - texto: ${MARCAS.dna}\n`);
  await escrever(repo, "knowledge/external/processed/ana/misc/publica.txt", TX_PUBLICA);
  await escrever(repo, "knowledge/external/processed/ana/misc/privada.txt", TX_PRIVADA);
  await escrever(
    repo,
    "knowledge/external/insights/by-person/ana.json",
    JSON.stringify({
      persons: {
        "Ana Teste": {
          slug: "ana",
          insights: [
            { id: "INS-ANA-001", insight: "Rotina de estudo.", quote: "Texto publico da aula sobre foco e rotina de estudo", confidence: "HIGH" },
            { id: "INS-ANA-002", insight: "Insight privado.", quote: "este trecho vem de um repositorio privado", confidence: "HIGH" },
          ],
        },
      },
    }),
  );
  return { tmp, app, repo, data: path.join(app, "data") };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/** Contexto do populate completo, como `main` monta: scan + exclusões lidas do ambiente do app. */
async function ctxDe(x: Cenario, exclusoes = lerExclusoesDoAmbiente(x.app)) {
  const { docs, excluded, exclusao } = await scanRepo(x.repo, { exclusoes, appRoot: x.app });
  return { exclusao, ctx: { repoRoot: x.repo, appRoot: x.app, dataDir: x.data, docs, excluded, exclusoes, opts: {}, resultados: {}, gitInfo: GIT_AUSENTE } };
}

/** Todo arquivo sob `dir` (recursivo), como texto latin1 (acha marca também dentro de SQLite). */
async function lerTudo(dir: string): Promise<{ rel: string; texto: string }[]> {
  const out: { rel: string; texto: string }[] = [];
  const andar = async (d: string, rel: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await andar(abs, r);
      else if (e.isFile()) out.push({ rel: r, texto: (await readFile(abs)).toString("latin1") });
    }
  };
  await andar(dir, "");
  return out;
}

describe("compilarExclusoes", () => {
  it("separa por vírgula ou ponto e vírgula, aceita / e \\, tira ./ e / da frente e ignora vazios", () => {
    const l = compilarExclusoes(" a/b.md ;; c\\d\\e.md , ./f/g.md, /h.md ,");
    expect(l.entradas).toEqual(["a/b.md", "c/d/e.md", "f/g.md", "h.md"]);
    expect(l.vazia).toBe(false);
  });

  it("glob: * não passa de uma pasta, ** passa (inclusive zero pastas), ? é um caractere, caixa ignorada", () => {
    const l = compilarExclusoes("a/*.md, b/**/x.md, c/arq?.txt");
    expect(l.exclui("a/z.md")).toBe(true);
    expect(l.exclui("a/sub/z.md")).toBe(false);
    expect(l.exclui("b/x.md")).toBe(true);
    expect(l.exclui("b/p/q/x.md")).toBe(true);
    expect(l.exclui("b/p/y.md")).toBe(false);
    expect(l.exclui("c/arq1.txt")).toBe(true);
    expect(l.exclui("c/arq12.txt")).toBe(false);
    expect(l.exclui("A/Z.MD")).toBe(true);
  });

  it("caminho de pasta exclui tudo dentro dela, mas não uma pasta vizinha de nome parecido", () => {
    const l = compilarExclusoes("squads/privado");
    expect(l.exclui("squads/privado")).toBe(true);
    expect(l.exclui("squads/privado/a/b.md")).toBe(true);
    expect(l.exclui("squads/privado-2/a.md")).toBe(false);
  });

  it("caracteres especiais de regex são literais; .. e caminho absoluto são ignorados e reportados", () => {
    const l = compilarExclusoes("docs/a+b(1).md, ../fora.md, a/../b.md, C:/x.md");
    expect(l.exclui("docs/a+b(1).md")).toBe(true);
    expect(l.exclui("docs/aab(1).md")).toBe(false);
    expect(l.ignoradas).toEqual(["../fora.md", "a/../b.md", "C:/x.md"]);
  });

  it("sem entradas a lista é vazia e não exclui nada", () => {
    const l = compilarExclusoes("  ; , ");
    expect(l.vazia).toBe(true);
    expect(l.exclui("qualquer/coisa.md")).toBe(false);
  });
});

describe("leitura de BILHON_POPULATE_EXCLUIR", () => {
  it("vem do .env.local do app (área do usuário); o terminal vence o arquivo; em branco vale como ausente", async () => {
    const x = await cenario("BILHON_POPULATE_EXCLUIR=docs/privado.md;squads/secreto/**\n");
    vi.stubEnv("BILHON_POPULATE_EXCLUIR", "");
    const doArquivo = lerExclusoesDoAmbiente(x.app);
    expect(doArquivo.entradas).toEqual(["docs/privado.md", "squads/secreto/**"]);
    expect(doArquivo.origem).toBe(".env.local BILHON_POPULATE_EXCLUIR");

    vi.stubEnv("BILHON_POPULATE_EXCLUIR", "docs/outro.md");
    const doTerminal = lerExclusoesDoAmbiente(x.app);
    expect(doTerminal.entradas).toEqual(["docs/outro.md"]);
    expect(doTerminal.origem).toBe("terminal BILHON_POPULATE_EXCLUIR");
  });

  it("sem a variável em lugar nenhum a lista é vazia", async () => {
    const x = await cenario();
    vi.stubEnv("BILHON_POPULATE_EXCLUIR", "");
    const l = lerExclusoesDoAmbiente(x.app);
    expect(l.vazia).toBe(true);
    expect(l.origem).toBeNull();
  });
});

describe("scanRepo", () => {
  it("registra o arquivo excluído com o motivo da configuração, não o lê e resume quantos e quais", async () => {
    const x = await cenario();
    const { docs, excluded, exclusao } = await scanRepo(x.repo, { exclusoes: compilarExclusoes(LISTA, "teste"), appRoot: x.app });
    const rels = docs.map((d) => d.rel);
    expect(rels).toContain("docs/publico.md");
    for (const barrado of ["docs/privado.md", "squads/secreto/a.md", "engine/nucleo/modulo_privado.py", "knowledge/external/processed/ana/misc/privada.txt"]) {
      expect(rels).not.toContain(barrado);
      expect(excluded).toContainEqual({ rel: barrado, motivo: "excluido-pela-configuracao" });
    }
    expect(JSON.stringify(docs)).not.toContain(MARCAS.doc);
    expect(exclusao).not.toBeNull();
    expect(exclusao!.origem).toBe("teste");
    expect(exclusao!.arquivos).toEqual(
      [
        "docs/privado.md",
        "engine/nucleo/modulo_privado.py",
        "knowledge/external/dna/persons/ana/valores.yaml",
        "knowledge/external/processed/ana/misc/privada.txt",
        "squads/secreto/a.md",
        "squads/secreto/agent-registry.yaml",
      ].sort(),
    );
    expect(exclusao!.semCorrespondencia).toEqual([]);
  });

  it("entrada que não casa nada vira aviso (erro de digitação); entrada fora da raiz também", async () => {
    const x = await cenario();
    const lista = compilarExclusoes("docs/privdo.md, docs/privado.md, squads/nao-existe/**, ../fora.md", "teste");
    const { exclusao } = await scanRepo(x.repo, { exclusoes: lista, appRoot: x.app });
    expect(exclusao!.semCorrespondencia).toEqual(["docs/privdo.md", "squads/nao-existe/**"]);
    expect(exclusao!.ignoradas).toEqual(["../fora.md"]);
    const avisos = avisosDeExclusao(exclusao);
    expect(avisos.some((a) => a.includes('"docs/privdo.md"') && a.includes("não casa"))).toBe(true);
    expect(avisos.some((a) => a.includes('"../fora.md"') && a.includes("ignorado"))).toBe(true);
    expect(avisos.some((a) => a.includes('"docs/privado.md"'))).toBe(false);
  });

  it("sem a variável nada muda: todos os arquivos entram e não há resumo", async () => {
    const x = await cenario();
    vi.stubEnv("BILHON_POPULATE_EXCLUIR", "");
    const { docs, excluded, exclusao } = await scanRepo(x.repo, { appRoot: x.app });
    expect(exclusao).toBeNull();
    expect(excluded.some((e) => e.motivo === "excluido-pela-configuracao")).toBe(false);
    const rels = docs.map((d) => d.rel);
    for (const r of ["docs/privado.md", "squads/secreto/a.md", "engine/nucleo/modulo_privado.py", "knowledge/external/processed/ana/misc/privada.txt"]) {
      expect(rels).toContain(r);
    }
  });

  it("lerTextoSeguro não abre o arquivo excluído; fora do Megabrain ativo continua lendo", async () => {
    const x = await cenario();
    await scanRepo(x.repo, { exclusoes: compilarExclusoes("docs/privado.md"), appRoot: x.app });
    expect(await lerTextoSeguro(path.join(x.repo, "docs", "privado.md"))).toEqual({ motivo: "excluido-pela-configuracao" });
    expect(await lerTextoSeguro(path.join(x.repo, "docs", "publico.md"))).toHaveProperty("text");
    expect(await lerTextoSeguro(path.join(x.app, "data", "nao-existe.md"))).toEqual({ motivo: "ausente" });
  });
});

describe("população completa", () => {
  it("arquivo excluído não aparece em NENHUM arquivo de data/ (nem conteúdo, nem caminho lido); o resto continua", async () => {
    const x = await cenario();
    const { ctx } = await ctxDe(x, compilarExclusoes(LISTA, "teste"));
    const { falhas } = await executar(ctx);
    expect(falhas).toBe(0);

    const arquivos = await lerTudo(x.data);
    expect(arquivos.length).toBeGreaterThan(10);
    for (const marca of Object.values(MARCAS)) {
      const achou = arquivos.filter((a) => a.texto.includes(marca)).map((a) => a.rel);
      expect(achou, `marca ${marca}`).toEqual([]);
    }
    // nem o caminho de arquivo que ninguém cita: o único nó permitido é o de um caminho CITADO por documento público
    for (const caminho of ["squads/secreto/agent-registry.yaml", "modulo_privado", "privada.txt", "persons/ana/valores"]) {
      const achou = arquivos.filter((a) => a.texto.includes(caminho)).map((a) => a.rel);
      expect(achou, `caminho ${caminho}`).toEqual([]);
    }
    // o conteúdo público do mesmo especialista e do mesmo repositório entrou
    const todo = arquivos.map((a) => a.texto).join("\n");
    expect(todo).toContain("PUBLICO-OK");
    expect(todo).toContain("Texto publico da aula sobre foco");
    expect(todo).toContain("modulo_publico");

    // topologia: do arquivo excluído, no máximo o nó como referência citada (sem conteúdo)
    const nos = JSON.parse(await readFile(path.join(x.data, "topology", "nodes.json"), "utf8")) as { nodes?: { rel?: string }[] } | { rel?: string }[];
    const lista = Array.isArray(nos) ? nos : (nos.nodes ?? []);
    const naoCitados = lista.filter((n) => /squads\/secreto\/agent-registry|modulo_privado|privada\.txt/.test(n.rel ?? ""));
    expect(naoCitados).toEqual([]);
  });

  it("especialista com DNA, transcrição e insight excluídos: só o que não foi excluído vira coleção e evidência", async () => {
    const x = await cenario();
    const { ctx } = await ctxDe(x, compilarExclusoes(LISTA, "teste"));
    await executar(ctx);
    const manifesto = JSON.parse(await readFile(path.join(x.data, "kg", "populate-especialistas.json"), "utf8")) as { especialistas: Record<string, unknown> };
    expect(Object.keys(manifesto.especialistas)).toContain("ana");
    const fontes = await lerTudo(path.join(x.data, "colecoes-external", "sources", "ana"));
    const texto = fontes.map((f) => f.texto).join("\n");
    expect(texto).toContain("Texto publico da aula");
    expect(texto).not.toContain(MARCAS.transcricao);
  });

  it("excluir a pasta inteira do especialista: ele some das coleções e do grafo", async () => {
    const x = await cenario();
    const { ctx } = await ctxDe(x, compilarExclusoes("knowledge/external/dna/persons/ana", "teste"));
    await executar(ctx);
    const manifesto = JSON.parse(await readFile(path.join(x.data, "kg", "populate-especialistas.json"), "utf8")) as { especialistas: Record<string, unknown> };
    expect(Object.keys(manifesto.especialistas)).not.toContain("ana");
  });

  it("população anterior sem a exclusão: ao ligar a variável, o que já estava em data/ sai na próxima população", async () => {
    const x = await cenario();
    vi.stubEnv("BILHON_POPULATE_EXCLUIR", "");
    await executar((await ctxDe(x)).ctx);
    const antes = await lerTudo(x.data);
    expect(antes.some((a) => a.texto.includes(MARCAS.doc))).toBe(true);
    ativarExclusoes(null);

    const { ctx } = await ctxDe(x, compilarExclusoes(LISTA, "teste"));
    await executar(ctx);
    const depois = await lerTudo(x.data);
    for (const marca of Object.values(MARCAS)) {
      expect(depois.filter((a) => a.texto.includes(marca)).map((a) => a.rel), `marca ${marca}`).toEqual([]);
    }
  });

  it("sem a variável os mesmos arquivos entram (a marca aparece em data/)", async () => {
    const x = await cenario();
    vi.stubEnv("BILHON_POPULATE_EXCLUIR", "");
    const { ctx } = await ctxDe(x);
    const { falhas } = await executar(ctx);
    expect(falhas).toBe(0);
    const arquivos = await lerTudo(x.data);
    for (const marca of [MARCAS.doc, MARCAS.squad]) {
      expect(arquivos.some((a) => a.texto.includes(marca)), `marca ${marca}`).toBe(true);
    }
  });
});
