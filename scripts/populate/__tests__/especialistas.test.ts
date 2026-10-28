/**
 * Módulo `especialistas` da população do Knowledge e o seu extrator do grafo (`extrairInsightsMce`).
 *
 * Mini-repositório sintético em tmpdir com um especialista processado pelo MCE
 * (DNA, transcrição com cabeçalho do YouTube, insights em .data, dossiê, agente):
 *  - citação localizada literalmente mesmo com [mm:ss] colado; frase ausente nunca vira evidência;
 *  - id do YouTube só com confirmação (cabeçalho URL: ou insights);
 *  - coleção /colecao/<slug> lida de volta pelo leitor REAL (lib/colecoes.ts) com o texto integral;
 *  - grafo (Grafo + criarCorpus reais): só insights com evidência literal, id em slug, evidência
 *    <= 300 chars dentro do chunk indicado, ligada à transcrição como livro do corpus — os mesmos
 *    invariantes que `grafo-topologia.test.ts` cobra do data/kg real;
 *  - idempotência, pasta alheia preservada e arquivo com segredo excluído;
 *  - youtube-map no contrato de docs/dados.md do outlierhub: `canal` = slug da coleção, então o
 *    link "ler transcript no trecho" do grafo (/colecao/<canal>/<doc>) abre a transcrição;
 *  - transcrição copiada idêntica em outra pasta entra uma vez só; título sem "Transcript of".
 *
 * O leitor das coleções (`lib/colecoes.ts`) consulta o store pela CLI `sqlite3` (com FTS5): sem ela
 * (o padrão no Windows), a parte de cada teste que passa por ele é pulada (`TEM_SQLITE3_FTS5`).
 *
 * Nada é gravado fora do tmpdir: `dataDir` vem de um diretório temporário.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chunkWords, scanRepo } from "../common.mjs";
import { Grafo, criarCorpus } from "../_extracao.mjs";
import runEspecialistas, {
  extrairInsightsMce,
  idYoutube,
  localizarCitacao,
  normalizarCitacao,
  prefixoNoChunk,
} from "../especialistas.mjs";
import { TEM_SQLITE3_FTS5 } from "./_sqlite-cli";

const SEM_CLI = "sem a CLI sqlite3 (com FTS5) o leitor lib/colecoes.ts não lê o store";

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

/** O módulo é JS (o TS infere `{}` para o resumo): aqui ganha o formato que os testes leem. */
type InfoEspecialista = { nome: string; colecao: string; insights: number; transcricoes: number };
const rodar = async (ctx: Record<string, unknown>) =>
  (await runEspecialistas(ctx)) as unknown as { resumo: { porEspecialista: Record<string, InfoEspecialista> }; avisos: string[] };
const estatisticas = async (...args: Parameters<typeof extrairInsightsMce>) =>
  (await extrairInsightsMce(...args)) as Record<string, unknown>;

const TRANSCRICAO = [
  "# A Psicologia de Quem Estuda Muito",
  "Canal: Canal Teste",
  "URL: https://www.youtube.com/watch?v=AbCdEfGhIjK",
  "---",
  "",
  "[00:00] Existe uma diferença importante entre adquirir conhecimento e produzir uma mudança de comportamento. Você pode ficar",
  "",
  "[00:46] muito mais eficiente no que faz.",
  "",
].join("\n");

const palavras = (s: string) => s.split(/\s+/).filter(Boolean);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

async function escrever(raiz: string, rel: string, conteudo: string) {
  const abs = path.join(raiz, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, conteudo, "utf8");
}

describe("citações", () => {
  it("localiza a citação literal mesmo com [mm:ss] colado e quebras de linha", () => {
    const loc = localizarCitacao(TRANSCRICAO, "Você pode ficar[00:46] muito mais eficiente no que faz.");
    expect(loc).not.toBeNull();
    expect(loc!.trecho).toContain("[00:46]");
    expect(normalizarCitacao(loc!.trecho)).toBe("Você pode ficar muito mais eficiente no que faz.");
  });

  it("não inventa evidência para frase que não está no texto", () => {
    expect(localizarCitacao(TRANSCRICAO, "a força de vontade é um músculo que se esgota")).toBeNull();
  });

  it("evidência é o maior prefixo (<= 300 chars) que cabe num único trecho", () => {
    const texto = Array.from({ length: 900 }, (_, i) => `palavra${i}`).join(" ");
    const chunks = chunkWords(texto).map(norm);
    const citacao = Array.from({ length: 120 }, (_, i) => `palavra${340 + i}`).join(" "); // cruza a fronteira 0→1
    const p = prefixoNoChunk(chunks, citacao)!;
    expect(p.length).toBeLessThanOrEqual(300);
    expect(citacao.startsWith(p)).toBe(true);
    expect(chunks.some((c) => c.includes(p))).toBe(true);
  });
});

describe("id do YouTube", () => {
  it("usa o cabeçalho URL: da transcrição", () => {
    expect(idYoutube(TRANSCRICAO, "qualquer.txt", new Set())).toBe("AbCdEfGhIjK");
  });

  it("aceita prefixo do arquivo só quando confirmado pelos insights", () => {
    expect(idYoutube("sem url", "abc-def-ghi-resto.txt", new Set())).toBeNull();
    expect(idYoutube("sem url", "Uc6renlSWx0-titulo.transcript.txt", new Set(["Uc6renlSWx0"]))).toBe("Uc6renlSWx0");
  });
});

describe("módulo especialistas", () => {
  let raiz: string;
  let repo: string;
  let dataDir: string;
  let ctx: Record<string, unknown>;

  beforeEach(async () => {
    raiz = await mkdtemp(path.join(tmpdir(), "populate-especialistas-"));
    repo = path.join(raiz, "repo");
    dataDir = path.join(raiz, "data");
    await mkdir(path.join(repo, "engine"), { recursive: true });
    await mkdir(path.join(repo, ".claude"), { recursive: true });
    await escrever(repo, "knowledge/external/dna/persons/canal-teste/filosofias.yaml", "layer: L1\nentries: []\n");
    await escrever(repo, "knowledge/external/processed/canal-teste/misc/canal-teste-2026-10-19-estudar.txt", TRANSCRICAO);
    await escrever(repo, "knowledge/external/dossiers/persons/dossier-canal-teste.md", "# Dossier\n\nTexto do dossiê.\n");
    await escrever(repo, "agents/external/canal-teste/agent.md", "# Agente\n\nPersona do canal.\n");
    // chave com cara de aleatória: `sk-ant-aaaa…` é marcador de documentação para o detectSecret (common.mjs)
    await escrever(repo, "agents/external/canal-teste/soul.md", `token: "sk-ant-${"Q7vR2mXk9LpT4nWz".repeat(2)}"\n`);
    await escrever(
      repo,
      ".data/artifacts/insights/canal-teste/INSIGHTS-STATE.json",
      JSON.stringify({
        persons: {
          "Canal Teste": {
            slug: "canal-teste",
            insights: [
              {
                id: "INS-CT-B01-001",
                insight: "Aprender não é agir.",
                quote: "Existe uma diferença importante entre adquirir conhecimento e produzir uma mudança de comportamento.",
                confidence: "HIGH",
                source: { source_id: "CANAL-TESTE" },
              },
              {
                id: "INS-CT-B01-002",
                insight: "Prescrição inventada.",
                quote: "use força de vontade todos os dias sem falhar",
                confidence: "MEDIUM",
                source: { source_id: "CANAL-TESTE" },
              },
            ],
          },
        },
      }),
    );
    await mkdir(dataDir, { recursive: true });
    ctx = { repoRoot: repo, appRoot: path.resolve("."), dataDir, docs: [], excluded: [], opts: {}, resultados: {} };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(raiz, { recursive: true, force: true });
  });

  it("cria a coleção do especialista, lida de volta pelo leitor real, com link do YouTube e sem o arquivo com segredo", async ({ skip }) => {
    const r = await rodar(ctx);
    const info = r.resumo.porEspecialista["canal-teste"];
    expect(info.nome).toBe("Canal Teste");
    expect(info.colecao).toBe("reconstruida");
    expect(info.insights).toBe(2);
    expect(r.avisos.some((a: string) => a.includes("soul.md") && a.includes("conteudo-sensivel"))).toBe(true);

    // daqui em diante é o leitor real: sem a CLI o teste para aqui e aparece como pulado
    skip(!TEM_SQLITE3_FTS5, SEM_CLI);
    vi.stubEnv("BILHON_COLECOES_EXT", path.join(dataDir, "colecoes-external"));
    vi.stubEnv("BILHON_YOUTUBE_MAP", path.join(dataDir, "kg", "youtube-map.json"));
    vi.resetModules();
    const { getTranscript, getColecao } = await import("@/lib/colecoes");
    const docs = (await getColecao("canal-teste"))!.itens.map((i) => i.doc);
    expect(docs).toContain("AbCdEfGhIjK.transcript");
    expect(docs).toContain("insights-canal-teste.json");
    expect(docs).not.toContain("agente-soul.md");
    const tx = await getTranscript("canal-teste", "AbCdEfGhIjK.transcript");
    expect(tx!.titulo).toBe("A Psicologia de Quem Estuda Muito");
    expect(tx!.youtubeUrl).toBe("https://www.youtube.com/watch?v=AbCdEfGhIjK");
    expect(palavras(tx!.texto)).toEqual(palavras(TRANSCRICAO));

    // a página da coleção mostra as seções do especialista: transcrição, DNA, insights, dossiê e agente
    expect(docs).toEqual(
      expect.arrayContaining(["dna-filosofias.yaml", "dossier-canal-teste.md", "agente-agent.md"]),
    );
    const itens = (await getColecao("canal-teste"))!.itens;
    expect(itens.find((i) => i.doc === "dna-filosofias.yaml")!.ehDna).toBe(true);

    // youtube-map: `canal` é o slug da coleção e o link que o grafo monta com ele abre a transcrição
    const yt = JSON.parse(await readFile(path.join(dataDir, "kg", "youtube-map.json"), "utf8"));
    for (const [chave, v] of Object.entries(yt) as [string, { canal: string }][]) {
      expect(v.canal).toBe("canal-teste");
      expect(chave.startsWith(`yt-${v.canal}:`)).toBe(true);
      expect(await getTranscript(v.canal, chave.slice(chave.indexOf(":") + 1))).not.toBeNull();
    }
  });

  it("transcrição idêntica em outra pasta entra uma vez; título do vídeo sem o prefixo 'Transcript of'", async ({ skip }) => {
    // mesma transcrição também na raiz de processed/ (o lifecycle deixou as duas cópias)
    await escrever(repo, "knowledge/external/processed/canal-teste/canal-teste-2026-10-19-estudar.txt", TRANSCRICAO);
    const OPENCLI = [
      "# Transcript of Como Escalar Sem Perder o Controle",
      "Source: youtube (https://www.youtube.com/watch?v=ZyXwVuTsRqP)",
      "Author: Canal Teste",
      "",
      "Texto falado do segundo vídeo, com conteúdo próprio e diferente do primeiro.",
      "",
    ].join("\n");
    await escrever(repo, "knowledge/external/processed/canal-teste/misc/ZyXwVuTsRqP-como-escalar.transcript.txt", OPENCLI);

    const r = await rodar(ctx);
    const info = r.resumo.porEspecialista["canal-teste"];
    expect(info.transcricoes).toBe(2);
    expect(r.avisos.some((a: string) => a.includes("cópia idêntica") && a.includes("misc/canal-teste-2026-10-19-estudar.txt"))).toBe(true);
    const yt = JSON.parse(await readFile(path.join(dataDir, "kg", "youtube-map.json"), "utf8"));
    expect(Object.keys(yt).sort()).toEqual([
      "yt-canal-teste:AbCdEfGhIjK.transcript",
      "yt-canal-teste:ZyXwVuTsRqP.transcript",
    ]);
    expect(yt["yt-canal-teste:ZyXwVuTsRqP.transcript"].titulo).toBe("Como Escalar Sem Perder o Controle");

    // o grafo conta a cópia uma vez e cita a primeira em ordem de caminho
    const { docs } = await scanRepo(repo);
    const corpus = criarCorpus(docs);
    const g = new Grafo(corpus);
    const stats = await estatisticas(g, corpus, ctx);
    expect(stats["canal-teste"]).toMatchObject({ transcricoes: 2, evidencias: 1 });
    const primeira = docs.find((d: { rel: string }) => d.rel === "knowledge/external/processed/canal-teste/canal-teste-2026-10-19-estudar.txt")!;
    expect(g.finalizar({ topK: 5 }).evidences[0].livro).toBe(primeira.arquivo);

    // a página da coleção pelo leitor real: sem a CLI o teste para aqui e aparece como pulado
    skip(!TEM_SQLITE3_FTS5, SEM_CLI);
    vi.stubEnv("BILHON_COLECOES_EXT", path.join(dataDir, "colecoes-external"));
    vi.stubEnv("BILHON_YOUTUBE_MAP", path.join(dataDir, "kg", "youtube-map.json"));
    vi.resetModules();
    const { getColecao } = await import("@/lib/colecoes");
    const transcricoes = (await getColecao("canal-teste"))!.itens.filter((i) => i.doc.endsWith(".transcript"));
    expect(transcricoes.map((i) => i.titulo).sort()).toEqual(["A Psicologia de Quem Estuda Muito", "Como Escalar Sem Perder o Controle"]);
  });

  it("extrator do grafo: só o insight com citação literal entra, com os invariantes do data/kg", async () => {
    const { docs } = await scanRepo(repo);
    const corpus = criarCorpus(docs);
    const g = new Grafo(corpus);
    const stats = await estatisticas(g, corpus, ctx);
    expect(stats["canal-teste"]).toMatchObject({ insights: 2, evidencias: 1, semEvidencia: ["INS-CT-B01-002"] });

    const out = g.finalizar({ topK: 5 });
    const conceitos = out.nodes.filter((n: { tipo: string }) => n.tipo === "conceito");
    expect(conceitos.map((n: { id: string }) => n.id)).toEqual(["mce-canal-teste-ins-ct-b01-001"]);
    for (const n of conceitos) expect(n.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);

    const tx = docs.find((d: { rel: string }) => d.rel.endsWith("canal-teste-2026-10-19-estudar.txt"))!;
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ src: `livro:${tx.arquivo}`, rel: "menciona", dst: "mce-canal-teste-ins-ct-b01-001", status: "claimed", n_fontes: 1 });
    const ev = out.evidences[0];
    expect(ev.livro).toBe(tx.arquivo);
    expect(ev.trecho.length).toBeLessThanOrEqual(300);
    expect(norm(tx.text)).toContain(ev.trecho);
    const n = Number(ev.chunk_id.split("#").pop());
    expect(ev.chunk_id.startsWith(`${tx.arquivo}#`)).toBe(true);
    expect(chunkWords(tx.text).map(norm)[n]).toContain(ev.trecho);
  });

  it("é idempotente: a segunda execução não reconstrói a coleção", async () => {
    await rodar(ctx);
    const r2 = await rodar(ctx);
    expect(r2.resumo.porEspecialista["canal-teste"].colecao).toBe("inalterada");
    const yt = JSON.parse(await readFile(path.join(dataDir, "kg", "youtube-map.json"), "utf8"));
    expect(Object.keys(yt)).toEqual(["yt-canal-teste:AbCdEfGhIjK.transcript"]);
  });

  it("preserva pasta de coleção que não é deste módulo", async () => {
    await escrever(dataDir, "colecoes-external/sources/canal-teste/.jarvis-import.json", "{}");
    const r = await rodar(ctx);
    expect(r.resumo.porEspecialista["canal-teste"].colecao).toBe("pasta-alheia");
  });
});
