/**
 * Módulos `agente` e `addons` da população do Knowledge, contra o corpus REAL do mega-brain
 * (pulado se o repositório não estiver ao lado do app) e lidos pelos leitores de verdade:
 * `lib/ecosystem.ts` (inventário de /agente), `lib/brain/*` (organização e notas do grafo Radial/Neural de /agente)
 * e `lib/addons.ts` (catálogo de /integracoes, antes /addons, e entrega de artefatos).
 *
 * Nada é gravado fora de um diretório temporário dentro de `node_modules/.cache/knowledge-tests`
 * (que fica dentro do mega-brain, logo dentro de BILHON_ROOT). O mega-brain é só lido.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { scanRepo, variavelDosArquivosDoApp } from "../common.mjs";
import runAgente, { lerGit } from "../agente.mjs";
import runAddons, { suspeito, textoSeguro } from "../addons.mjs";
import { getEcosystem, limparCacheEcossistema } from "@/lib/ecosystem";
import { getAddonCatalogo, lerArtefatoAddon } from "@/lib/addons";
import { lerOrganizacao } from "@/lib/brain/organizacao";
import { carregarBrain } from "@/lib/brain/carregar";
import { limparCacheMemoria } from "@/lib/brain/memoria";

// O disco B: sob carga (muitos processos node) deixa estes testes lentos: medido, o teste de regeneração levou 239 s e o de git 80 s.
// O limite padrão de 60 s estourava sem haver defeito; o populate real leva segundos.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

const APP = process.cwd();
const REPO = path.resolve(APP, "..", "..");
const temRepo = existsSync(path.join(REPO, "engine")) && existsSync(path.join(REPO, ".claude"));

type Doc = Awaited<ReturnType<typeof scanRepo>>["docs"][number];
type Linha = { api_name: string; tipo: string; rid: string; role?: string; squad?: string; procedencia: string; owner: string; observed: string[] };
type EntradaManifesto = { id: string; title: string; summary: string; artifacts: { id: string; size: number; checksum: string }[]; gerado_por?: string };
type LinhaOrg = Record<string, unknown> & { id: string; gerado_por?: string };
type ArquivoOrg = { _sobre?: string; pilares: LinhaOrg[]; ferramentas: LinhaOrg[]; agentes: LinhaOrg[]; pessoas: LinhaOrg[]; tarefas: LinhaOrg[]; execucoes: LinhaOrg[] };
const lerOrgArquivo = async (dataDir: string) => JSON.parse(await readFile(path.join(dataDir, "agente", "organizacao.json"), "utf8")) as ArquivoOrg;

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** Owner que o módulo tira de um remote (mesma regra de `donoDaUrl` em agente.mjs); null sem remote. */
const donoDaUrl = (u: string | null | undefined) => u?.match(/^https?:\/\/[^/]+\/([^/]+)\//)?.[1] ?? null;
/** Owner do remote `origin` do mega-brain ao lado (o que o módulo marca como "propria"), lido do git. */
function donoDoOrigin(): string | null {
  try {
    return donoDaUrl(execFileSync("git", ["-C", REPO, "remote", "get-url", "origin"], { encoding: "utf8" }).trim());
  } catch {
    return null;
  }
}

async function hashArvore(dir: string): Promise<string> {
  const h = createHash("sha256");
  const visitar = async (d: string, rel: string): Promise<void> => {
    if (!existsSync(d)) return;
    const itens = (await readdir(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of itens) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await visitar(path.join(d, e.name), r);
      else h.update(`${r}\u0000`).update(await readFile(path.join(d, e.name))).update("\u0000");
    }
  };
  await visitar(dir, "");
  return h.digest("hex");
}

describe.skipIf(!temRepo)("população do Agente e dos Add-ons (corpus real, leitores reais)", () => {
  const criados: string[] = [];
  let docs: Doc[];
  let tmp: string;
  let resAgente: Awaited<ReturnType<typeof runAgente>>;
  let resAddons: Awaited<ReturnType<typeof runAddons>>;

  let gitInfo: ReturnType<typeof lerGit>; // git lido uma vez: execuções repetidas veem exatamente o mesmo histórico
  const ctxDe = (dataDir: string) => ({ repoRoot: REPO, appRoot: APP, dataDir, docs, excluded: [], opts: {}, resultados: {}, gitInfo });
  async function novoTmp() {
    const base = path.join(APP, "node_modules", ".cache", "knowledge-tests");
    await mkdir(base, { recursive: true });
    const d = await mkdtemp(path.join(base, "populate-agente-addons-"));
    criados.push(d);
    return d;
  }
  /** Aponta os leitores reais para o tmp, exatamente como o `.env.local` do módulo `ambiente` faz para `data/`. */
  function apontarLeitores(dataDir: string) {
    vi.stubEnv("BILHON_ROOT", REPO);
    vi.stubEnv("BILHON_REGISTRO_ENTIDADES", path.join(dataDir, "agente", "registro.yaml"));
    vi.stubEnv("BILHON_AGENTE_DIR", path.join(dataDir, "agente"));
    vi.stubEnv("BILHON_OWNERS_PROPRIOS", donoDaUrl(gitInfo.origin) ?? "");
    vi.stubEnv("BILHON_REPOS_JSON", "");
    vi.stubEnv("BILHON_AGENTES_JSON", "");
    vi.stubEnv("BILHON_ADDONS_DIR", path.join(dataDir, "addons"));
    vi.stubEnv("BILHON_BRAIN_ORG_JSON", ""); // vazio = padrão <BILHON_AGENTE_DIR>/organizacao.json
    vi.stubEnv("BILHON_BRAIN_STORE", ""); // vazio = padrão <BILHON_AGENTE_DIR>/memoria
    limparCacheEcossistema();
    limparCacheMemoria();
  }
  const lerRegistro = async (dataDir: string) => (loadYaml(await readFile(path.join(dataDir, "agente", "registro.yaml"), "utf8")) as { entities: Linha[] }).entities;
  const lerManifesto = async (dataDir: string) => JSON.parse(await readFile(path.join(dataDir, "addons", "manifest.json"), "utf8")) as { entries: EntradaManifesto[] };

  beforeAll(async () => {
    docs = (await scanRepo(REPO)).docs;
    gitInfo = lerGit({ repoRoot: REPO } as never);
    tmp = await novoTmp();
    resAgente = await runAgente(ctxDe(tmp));
    resAddons = await runAddons(ctxDe(tmp));
  }, 600_000);
  afterEach(() => {
    vi.unstubAllEnvs();
    limparCacheEcossistema();
  });
  afterAll(async () => {
    await Promise.all(criados.map((d) => rm(d, { recursive: true, force: true })));
  });

  describe("agente (lib/ecosystem.ts)", () => {
    it("o app enxerga TODAS as linhas do registro: nenhuma foi descartada por caminho inválido", async () => {
      apontarLeitores(tmp);
      const linhas = await lerRegistro(tmp);
      const eco = await getEcosystem();
      expect(linhas.length).toBeGreaterThan(100);
      expect(eco.entities.length).toBe(linhas.length);
      expect(eco.fontes?.find((f) => f.id === "registro")?.estado).toBe("ok");
      expect(eco.fontes?.find((f) => f.id === "repos")?.estado).toBe("ok");
      expect(eco.fontes?.find((f) => f.id === "espelhos")?.estado).toBe("ok");
      const ids = new Set(eco.entities.map((e) => e.id));
      expect(ids.size).toBe(linhas.length);
      for (const l of linhas) expect(ids.has(l.rid)).toBe(true);
    });

    it("a contagem por tipo que o app vê é a do registro, e resumo.porTipo concorda", async () => {
      apontarLeitores(tmp);
      const linhas = await lerRegistro(tmp);
      const eco = await getEcosystem();
      for (const tipo of ["squad", "agent", "skill", "workflow", "worker", "engine", "repo"] as const) {
        expect(eco.counts[tipo]).toBe(linhas.filter((l) => l.tipo === tipo).length);
      }
      expect(eco.counts.clone + eco.counts.shadow).toBe(0);
      expect(resAgente.resumo.porTipo).toMatchObject(Object.fromEntries(
        (["squad", "agent", "skill", "workflow", "worker", "engine", "repo"] as const).map((t) => [t, eco.counts[t]]),
      ));
      expect(eco.counts.squad).toBeGreaterThanOrEqual(1);
      expect(eco.counts.skill).toBeGreaterThanOrEqual(30);
      expect(eco.counts.workflow).toBeGreaterThanOrEqual(20);
    });

    it("todo caminho observado existe no disco (o do repo é a própria raiz) e o do app é relativo ao mega-brain", async () => {
      apontarLeitores(tmp);
      const eco = await getEcosystem();
      for (const e of eco.entities) {
        if (e.kind === "repo") { expect(e.path).toBe(""); continue; }
        expect(path.isAbsolute(e.path), e.path).toBe(false);
        expect(existsSync(path.join(REPO, e.path)), e.path).toBe(true);
      }
    });

    it("workers, tasks e workflows de squad ficam ligados ao squad do registro", async () => {
      apontarLeitores(tmp);
      const linhas = await lerRegistro(tmp);
      const eco = await getEcosystem();
      const squadIds = new Map(eco.entities.filter((e) => e.kind === "squad").map((e) => [e.name, e.id]));
      const comSquad = linhas.filter((l) => l.squad);
      expect(comSquad.length).toBeGreaterThan(30);
      for (const l of comSquad) {
        const e = eco.entities.find((x) => x.id === l.rid)!;
        expect(e.squadId, l.rid).toBe(squadIds.get(l.squad!));
      }
    });

    it("a procedência que o app deriva é a que o registro declara (git: adotada x própria)", async () => {
      apontarLeitores(tmp);
      const linhas = await lerRegistro(tmp);
      const eco = await getEcosystem();
      for (const l of linhas) expect(eco.entities.find((x) => x.id === l.rid)!.procedencia, l.rid).toBe(l.procedencia);
      expect(eco.countsPorProcedencia.propria + eco.countsPorProcedencia.adotada + eco.countsPorProcedencia.terceiro).toBe(eco.entities.length);
      expect(eco.countsPorProcedencia.terceiro).toBe(0); // owners declarados são sempre o do upstream ou o do origin, e esse é o próprio
      for (const l of linhas) expect([donoDaUrl(gitInfo.upstream), donoDaUrl(gitInfo.origin)]).toContain(l.owner);
    });

    it("repos.json traz o próprio repositório e espelhos.json é vazio; uso/favoritos/ocultos/memoria não são gerados", async () => {
      const repos = JSON.parse(await readFile(path.join(tmp, "agente", "repos.json"), "utf8"));
      expect(repos).toHaveLength(1);
      expect(repos[0]).toMatchObject({ slug: "mega-brain", path: ".", owner: donoDaUrl(gitInfo.origin), procedencia: "propria" });
      expect(JSON.parse(await readFile(path.join(tmp, "agente", "espelhos.json"), "utf8"))).toEqual([]);
      for (const f of ["uso.json", "favoritos.json", "ocultos.json", "memoria"]) expect(existsSync(path.join(tmp, "agente", f)), f).toBe(false);
    });

    it("organizacao.json passa inteiro pelo leitor do grafo (lib/brain/organizacao.ts): nada descartado, referências resolvidas", async () => {
      apontarLeitores(tmp);
      const arquivo = await lerOrgArquivo(tmp);
      const leitura = await lerOrganizacao(path.join(tmp, "agente", "organizacao.json"));
      expect(leitura.ok).toBe(true);
      if (!leitura.ok) return;
      expect(leitura.avisos).toEqual([]); // nenhum agente/tarefa com pilarId inexistente
      const { data } = leitura;
      expect(data.pilares.length).toBe(arquivo.pilares.length);
      expect(data.agentes.length).toBe(arquivo.agentes.length);
      expect(data.tarefas.length).toBe(arquivo.tarefas.length);
      expect(data.ferramentas.length).toBe(arquivo.ferramentas.length);
      expect(data.pilares.length).toBeGreaterThanOrEqual(1);
      expect(data.agentes.length).toBeGreaterThanOrEqual(1);
      expect(data.tarefas.length).toBeGreaterThanOrEqual(1);
      // sem fonte no mega-brain: nada inventado
      expect(arquivo.pessoas).toEqual([]);
      expect(arquivo.execucoes).toEqual([]);
      expect(Object.keys(data.ultimaExecucao)).toHaveLength(0);
      // executor e ferramentas apontam para o que existe (o leitor só omite, não inventa: aqui nada some)
      const agentes = new Set(data.agentes.map((a) => a.id));
      const ferramentas = new Set(data.ferramentas.map((f) => f.id));
      for (const t of data.tarefas) if (t.executorId) expect(agentes.has(t.executorId), t.id).toBe(true);
      for (const a of arquivo.agentes) expect(data.agentes.find((x) => x.id === `agente:${a.id}`)!.ferramentas, a.id).toEqual(((a.ferramentas as string[]) ?? []).map((f) => `ferramenta:${f}`));
      for (const f of arquivo.ferramentas) expect(ferramentas.has(`ferramenta:${f.id}`)).toBe(true);
      expect(arquivo.tarefas.filter((t) => t.executorId).length).toBe(resAgente.resumo.organizacao.tarefasComExecutor);
      // todo id é o rid de uma entidade do registro (pilar de squad, agente, tarefa); categoria e script são os únicos de fora
      const rids = new Set((await lerRegistro(tmp)).map((l) => l.rid));
      for (const l of [...arquivo.agentes, ...arquivo.tarefas]) expect(rids.has(l.id), l.id).toBe(true);
      for (const p of arquivo.pilares) expect(rids.has(p.id) || p.id.startsWith("megabrain.categoria."), p.id).toBe(true);
      for (const l of [...arquivo.pilares, ...arquivo.agentes, ...arquivo.tarefas, ...arquivo.ferramentas]) {
        expect(l.gerado_por).toBe("populate:agente");
        expect(l.id.length).toBeLessThanOrEqual(120);
      }
    });

    it("a página /agente recebe a organização e nenhuma pasta de notas (carregarBrain com o padrão de BILHON_AGENTE_DIR)", async () => {
      apontarLeitores(tmp);
      const brain = await carregarBrain();
      expect(brain.org.ok).toBe(true);
      if (brain.org.ok) expect(brain.org.data.pilares.length).toBe(resAgente.resumo.organizacao.pilares);
      expect(brain.memoria).toBeNull();
      expect(brain.memoriaFalha).toBeUndefined();
    });

    it("papéis (role) têm ≤ 400 caracteres, nenhum segredo e cobrem a maior parte das entidades", async () => {
      const linhas = await lerRegistro(tmp);
      for (const l of linhas) expect([...(l.role ?? "")].length, l.rid).toBeLessThanOrEqual(400);
      const comRole = linhas.filter((l) => l.role).length;
      expect(comRole / linhas.length).toBeGreaterThan(0.9);
    });

    it("nenhum caminho absoluto de máquina nos arquivos gerados (regra de caminhos portáteis)", async () => {
      for (const f of ["registro.yaml", "repos.json", "organizacao.json"]) {
        const txt = await readFile(path.join(tmp, "agente", f), "utf8");
        expect(txt, f).not.toMatch(/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/); // "C:\" ou "C:/", mas não o "s://" de https://
        expect(txt, f).not.toContain("/Users/");
        expect(txt, f).not.toContain(REPO.replace(/\\/g, "/"));
      }
    });
  });

  describe("addons (lib/addons.ts)", () => {
    it("o app conta todos aprovados: 0 em quarentena e 0 inválidos", async () => {
      apontarLeitores(tmp);
      const manifesto = await lerManifesto(tmp);
      const cat = await getAddonCatalogo();
      expect(manifesto.entries.length).toBeGreaterThan(20);
      expect(cat.entries.length).toBe(manifesto.entries.length);
      expect(cat.quarentena).toHaveLength(0);
      expect(cat.invalidos).toBe(0);
      expect(resAddons.resumo.addons).toBe(manifesto.entries.length);
    });

    it("cada artefato é servido pelo leitor com checksum e tamanho do manifesto", async () => {
      apontarLeitores(tmp);
      const cat = await getAddonCatalogo();
      let total = 0;
      for (const e of cat.entries) {
        expect(e.artifacts.length, e.id).toBeGreaterThan(0);
        for (const a of e.artifacts) {
          const txt = await lerArtefatoAddon(e.id, a.id);
          expect(txt, `${e.id}/${a.id}`).not.toBeNull();
          expect(sha(txt!), `${e.id}/${a.id}`).toBe(a.checksum);
          expect(Buffer.byteLength(txt!, "utf8"), `${e.id}/${a.id}`).toBe(a.size);
          total++;
        }
      }
      expect(total).toBe(resAddons.resumo.artefatos);
    }, 600_000);

    it("categorias, licença, bucket e aprovação seguem o contrato; ids e slugs são únicos", async () => {
      const { entries } = await lerManifesto(tmp);
      const ids = new Set<string>();
      const slugs = new Set<string>();
      for (const e of entries as unknown as Array<Record<string, any>>) {
        expect(["design-system", "framework-checklist", "function-utility", "app-recreation"]).toContain(e.category);
        expect(e.id.startsWith(`${e.category}:`)).toBe(true);
        const slug = e.id.slice(e.id.indexOf(":") + 1);
        expect(slug).toMatch(/^[a-z0-9][a-z0-9._-]*$/i);
        expect(ids.has(e.id)).toBe(false);
        expect(slugs.has(slug)).toBe(false);
        ids.add(e.id);
        slugs.add(slug);
        expect(e.source).toMatchObject({ license: "proprietary", bucket: "confirmed_prod" });
        expect(e.source.repository).toMatch(/^https:\/\/github\.com\/[^/@]+\/[^/@]+$/); // sem credencial
        expect(e).toMatchObject({ approval: "aprovado", distribution: "interno", preview_kind: "none", type: "addon" });
        for (const a of e.artifacts as Array<{ id: string; size: number }>) {
          expect(a.id).not.toMatch(/[\\/]/);
          expect(a.size).toBeLessThanOrEqual(262144);
          expect(path.extname(a.id).toLowerCase()).toMatch(/^\.(ts|tsx|md|txt|css|json|yaml|yml)$/);
        }
      }
    });

    it("title e summary nunca parecem e-mail ou chave (o app poria em quarentena)", async () => {
      const { entries } = await lerManifesto(tmp);
      for (const e of entries) expect(suspeito(e.title, e.summary), e.id).toBe(false);
      // "task-" contém "sk-": o texto seguro troca o hífen sem mudar a leitura
      expect(suspeito("task-tmpl")).toBe(true);
      expect(suspeito(textoSeguro("Origem: engine/tasks/_templates/task-tmpl.md. contato@exemplo.com"))).toBe(false);
    });

    it("o catálogo é de verdade do repositório: cada artefato tem o conteúdo do arquivo de origem (LF)", async () => {
      const manifesto = await lerManifesto(tmp);
      const porSha = new Set(docs.map((d) => d.sha256));
      for (const e of manifesto.entries) for (const a of e.artifacts) expect(porSha.has(a.checksum), `${e.id}/${a.id}`).toBe(true);
    });
  });

  describe("idempotência e preservação do que não é gerado", () => {
    it("rodar de novo produz exatamente os mesmos arquivos (hash da árvore)", async () => {
      const antes = await hashArvore(tmp);
      await runAgente(ctxDe(tmp));
      await runAddons(ctxDe(tmp));
      expect(await hashArvore(tmp)).toBe(antes);
    }, 600_000);

    it("regeneração preserva linhas/entradas suas e favoritos, e remove só o que ela gerou e sumiu", async () => {
      const d = await novoTmp();
      await runAgente(ctxDe(d));
      await runAddons(ctxDe(d));

      // estado do usuário
      const fav = `${JSON.stringify({ "megabrain.skill.save": { em: "2026-01-01T00:00:00.000Z" } })}\n`;
      await writeFile(path.join(d, "agente", "favoritos.json"), fav);
      const reg = path.join(d, "agente", "registro.yaml");
      await writeFile(reg, `${await readFile(reg, "utf8")}  - api_name: minha-skill\n    tipo: skill\n    rid: usuario.skill.minha-skill\n    observed:\n      - README.md\n`);
      const repos = path.join(d, "agente", "repos.json");
      await writeFile(repos, JSON.stringify([...JSON.parse(await readFile(repos, "utf8")), { slug: "meu-repo", path: "docs" }], null, 2));
      // organização: um pilar e uma pessoa seus, uma linha sua com o mesmo id de uma nossa, uma nossa que sumiu e uma chave sua
      const orgGerada = await lerOrgArquivo(d);
      const nOrgPilares = orgGerada.pilares.length;
      const nossoAgente = orgGerada.agentes[0];
      const meuAgente = { id: nossoAgente.id, nome: "minha versão", pilarId: "meu-pilar" };
      await writeFile(path.join(d, "agente", "organizacao.json"), JSON.stringify({
        ...orgGerada,
        meu_campo: { nota: "fica" },
        pilares: [{ id: "meu-pilar", nome: "Vendas", cor: "#22c55e" }, ...orgGerada.pilares, { id: "megabrain.squad.sumiu", nome: "sumiu", gerado_por: "populate:agente" }],
        pessoas: [{ id: "ana", nome: "Ana", pilarId: "meu-pilar" }],
        agentes: [meuAgente, ...orgGerada.agentes],
      }, null, 2));
      const man = await lerManifesto(d);
      const nGerados = man.entries.length;
      man.entries.push(
        { id: "function-utility:meu-addon", type: "addon", category: "function-utility", title: "Meu add-on", summary: "", source: { repository: null, revision: null, license: "mit", bucket: "synthetic" }, artifacts: [], preview_kind: "none", approval: "aprovado", distribution: "interno" } as never,
        { id: "function-utility:gerado-que-sumiu", type: "addon", category: "function-utility", title: "Sumiu", summary: "", source: { repository: null, revision: null, license: "proprietary", bucket: "confirmed_prod" }, artifacts: [], preview_kind: "none", approval: "aprovado", distribution: "interno", gerado_por: "populate:addons" } as never,
      );
      await writeFile(path.join(d, "addons", "manifest.json"), JSON.stringify(man, null, 2));
      await mkdir(path.join(d, "addons", "artifacts", "gerado-que-sumiu"), { recursive: true });
      await writeFile(path.join(d, "addons", "artifacts", "gerado-que-sumiu", "x.md"), "obsoleto");
      const primeiro = man.entries.find((e) => e.gerado_por === "populate:addons" && e.artifacts.length)!;
      const pastaPrimeiro = path.join(d, "addons", "artifacts", primeiro.id.slice(primeiro.id.indexOf(":") + 1));
      await writeFile(path.join(pastaPrimeiro, "sobra-antiga.md"), "arquivo que já não faz parte do add-on");

      await runAgente(ctxDe(d));
      await runAddons(ctxDe(d));

      expect(await readFile(path.join(d, "agente", "favoritos.json"), "utf8")).toBe(fav);
      const linhas = await lerRegistro(d);
      expect(linhas.filter((l) => l.rid === "usuario.skill.minha-skill")).toHaveLength(1);
      expect(linhas.filter((l) => l.rid === "megabrain.skill.save")).toHaveLength(1);
      const reposDepois = JSON.parse(await readFile(repos, "utf8")) as Array<{ slug: string }>;
      expect(reposDepois.map((r) => r.slug).sort()).toEqual(["mega-brain", "meu-repo"]);
      const orgDepois = await lerOrgArquivo(d);
      expect(orgDepois.pilares[0]).toEqual({ id: "meu-pilar", nome: "Vendas", cor: "#22c55e" }); // o seu na frente
      expect(orgDepois.pilares).toHaveLength(nOrgPilares + 1); // o que sumiu saiu
      expect(orgDepois.pilares.find((p) => p.id === "megabrain.squad.sumiu")).toBeUndefined();
      expect(orgDepois.pessoas).toEqual([{ id: "ana", nome: "Ana", pilarId: "meu-pilar" }]);
      expect(orgDepois.agentes.filter((a) => a.id === nossoAgente.id)).toEqual([meuAgente]); // id seu igual ao nosso: vale o seu
      expect(orgDepois.agentes).toHaveLength(orgGerada.agentes.length);
      expect((orgDepois as unknown as Record<string, unknown>).meu_campo).toEqual({ nota: "fica" });
      const depois = await lerManifesto(d);
      expect(depois.entries.find((e) => e.id === "function-utility:meu-addon")).toBeTruthy();
      expect(depois.entries.find((e) => e.id === "function-utility:gerado-que-sumiu")).toBeUndefined();
      expect(existsSync(path.join(d, "addons", "artifacts", "gerado-que-sumiu"))).toBe(false);
      expect(existsSync(path.join(pastaPrimeiro, "sobra-antiga.md"))).toBe(false);
      expect(depois.entries.filter((e) => e.gerado_por === "populate:addons")).toHaveLength(nGerados);
      expect(depois.entries).toHaveLength(nGerados + 1); // as geradas + a sua
    }, 600_000);

    it("arquivo existente corrompido não é sobrescrito: o módulo falha e não toca nele", async () => {
      const d = await novoTmp();
      await mkdir(path.join(d, "agente"), { recursive: true });
      await mkdir(path.join(d, "addons"), { recursive: true });
      await writeFile(path.join(d, "agente", "registro.yaml"), "entities: [oops: : :");
      await writeFile(path.join(d, "agente", "repos.json"), "{ nao e json");
      await writeFile(path.join(d, "addons", "manifest.json"), "{ nao e json");
      await expect(runAgente(ctxDe(d))).rejects.toThrow(/ilegível/);
      expect(await readFile(path.join(d, "agente", "registro.yaml"), "utf8")).toBe("entities: [oops: : :");
      await writeFile(path.join(d, "agente", "registro.yaml"), "entities: []\n");
      await expect(runAgente(ctxDe(d))).rejects.toThrow(/ilegível/); // agora é o repos.json
      expect(await readFile(path.join(d, "agente", "repos.json"), "utf8")).toBe("{ nao e json");
      expect(await readFile(path.join(d, "agente", "registro.yaml"), "utf8")).toBe("entities: []\n"); // nada foi gravado antes do erro
      // organizacao.json: ilegível, não-objeto ou com lista em outro formato também abortam antes de gravar qualquer coisa
      await writeFile(path.join(d, "agente", "repos.json"), "[]\n");
      for (const [conteudo, erro] of [["{ nao e json", /ilegível/], ["[1, 2]", /não é um objeto/], ['{ "pilares": { "a": 1 } }', /não é lista/]] as const) {
        await writeFile(path.join(d, "agente", "organizacao.json"), conteudo);
        await expect(runAgente(ctxDe(d))).rejects.toThrow(erro);
        expect(await readFile(path.join(d, "agente", "organizacao.json"), "utf8")).toBe(conteudo);
        expect(await readFile(path.join(d, "agente", "registro.yaml"), "utf8")).toBe("entities: []\n");
        expect(await readFile(path.join(d, "agente", "repos.json"), "utf8")).toBe("[]\n");
      }
      await expect(runAddons(ctxDe(d))).rejects.toThrow(/ilegível/);
      expect(await readFile(path.join(d, "addons", "manifest.json"), "utf8")).toBe("{ nao e json");
    }, 600_000);
  });
});

/**
 * Regressões da revisão (repositórios de mentira, montados em `node_modules/.cache/knowledge-tests`):
 *   1. ler o git nunca regrava `.git/index`;
 *   2. `rid` repetido (foo.md + foo.yaml; /foo-bar + /foo:bar) não derruba o módulo, e o app enxerga todas as entidades;
 *   3. título com vários e-mails não derruba `addons`;
 *   4. a linha do próprio repo em repos.json que você assumiu (sem `gerado_por`) sobrevive à regeneração;
 *   5. o papel do engine conta arquivos de código no DISCO (e não no corpus filtrado), com singular/plural certos.
 */
function temGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
const GIT_AUSENTE = {
  ok: false, motivo: "sem git (teste)", inicial: new Set<string>(), depois: new Set<string>(), modificados: new Set<string>(),
  rastreados: new Set<string>(), head: null, origin: null, upstream: null,
};

describe("regressões da revisão do Agente e dos Add-ons (repositórios de mentira)", () => {
  const criados: string[] = [];
  afterAll(async () => {
    await Promise.all(criados.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    limparCacheEcossistema();
  });

  async function pastaTemp(prefixo: string) {
    const base = path.join(APP, "node_modules", ".cache", "knowledge-tests");
    await mkdir(base, { recursive: true });
    const d = await mkdtemp(path.join(base, prefixo));
    criados.push(d);
    return d;
  }
  /** Cria um "mega-brain" mínimo (engine/ e .claude/ existem) com os arquivos dados. */
  async function repoFalso(arquivos: Record<string, string>) {
    const repo = await pastaTemp("repo-falso-");
    await mkdir(path.join(repo, "engine"), { recursive: true });
    await mkdir(path.join(repo, ".claude"), { recursive: true });
    for (const [rel, txt] of Object.entries(arquivos)) {
      await mkdir(path.dirname(path.join(repo, rel)), { recursive: true });
      await writeFile(path.join(repo, rel), txt);
    }
    return repo;
  }
  async function ctxFalso(repo: string, dataDir: string, gitInfo?: unknown) {
    const { docs, excluded } = await scanRepo(repo);
    return { repoRoot: repo, appRoot: path.join(repo, "apps", "knowledge"), dataDir, docs, excluded, opts: {}, resultados: {}, gitInfo: gitInfo ?? GIT_AUSENTE };
  }
  const squadMinimo = "name: s1\ndescription: Squad de teste para colisão de identidades no inventário\n";

  describe.skipIf(!temGit())("1. git somente leitura", () => {
    it("lerGit não regrava .git/index nem com o stat dos arquivos velho, e ainda enxerga modificação de verdade", async () => {
      const repo = await repoFalso({ "README.md": "# x\n", "engine/a.py": "a = 1\n", ".claude/b.md": "# b\n" });
      const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      g("init", "-q");
      g("config", "user.email", "teste@exemplo.invalid");
      g("config", "user.name", "teste");
      g("config", "core.autocrlf", "false");
      g("add", "-A");
      g("commit", "-qm", "inicial");
      // mesmo conteúdo, mtime diferente: é exatamente o caso em que `git status` quer atualizar o índice
      const futuro = new Date("2030-01-01T00:00:00Z");
      await utimes(path.join(repo, "README.md"), futuro, futuro);
      const indice = path.join(repo, ".git", "index");
      const antes = sha(await readFile(indice));
      const info = lerGit({ repoRoot: repo } as never);
      expect(info.ok).toBe(true);
      expect(sha(await readFile(indice))).toBe(antes);
      expect(existsSync(path.join(repo, ".git", "index.lock"))).toBe(false);

      await writeFile(path.join(repo, "README.md"), "# mudou\n");
      const depois = lerGit({ repoRoot: repo } as never);
      expect([...depois.modificados]).toEqual(["README.md"]);
      expect(sha(await readFile(indice))).toBe(antes);
    });
  });

  describe("2. rid repetido", () => {
    const arquivos = {
      "squads/s1/squad.yaml": squadMinimo,
      "squads/s1/workflows/foo.md": "# Foo\n\nWorkflow em Markdown que divide o nome com o YAML da mesma pasta.\n",
      "squads/s1/workflows/foo.yaml": "name: foo\ndescription: Workflow em YAML que colide com o Markdown de mesmo nome na pasta\n",
      ".claude/commands/foo-bar.md": "# /foo-bar\n\nComando com hífen que colide com o comando aninhado de mesmo slug.\n",
      ".claude/commands/foo/bar.md": "# /foo:bar\n\nComando aninhado com dois pontos que colide com o comando de hífen.\n",
    };

    it("não derruba o módulo: cada arquivo vira uma entidade com rid único, avisa e o app enxerga todas", async () => {
      const repo = await repoFalso(arquivos);
      const dataDir = path.join(repo, "dados-populados"); // dentro da raiz do repo falso: é a contenção (BILHON_ROOT) que o app exige
      const res = await runAgente(await ctxFalso(repo, dataDir));
      const linhas = (loadYaml(await readFile(path.join(dataDir, "agente", "registro.yaml"), "utf8")) as { entities: Linha[] }).entities;
      const rids = linhas.map((l) => l.rid);
      expect(new Set(rids).size).toBe(rids.length);
      const observados = linhas.flatMap((l) => l.observed);
      for (const rel of ["squads/s1/workflows/foo.md", "squads/s1/workflows/foo.yaml", ".claude/commands/foo-bar.md", ".claude/commands/foo/bar.md"]) {
        expect(observados, rel).toContain(rel);
      }
      // quem já existia mantém o rid de sempre; a extensão desempata quando distingue, senão o hash do caminho
      expect(linhas.find((l) => l.observed[0] === "squads/s1/workflows/foo.md")!.rid).toBe("megabrain.workflow.s1.foo");
      expect(linhas.find((l) => l.observed[0] === "squads/s1/workflows/foo.yaml")!.rid).toBe("megabrain.workflow.s1.foo.yaml");
      expect(linhas.find((l) => l.observed[0] === ".claude/commands/foo-bar.md")!.rid).toBe("megabrain.command.foo-bar");
      expect(linhas.find((l) => l.observed[0] === ".claude/commands/foo/bar.md")!.rid).toMatch(/^megabrain\.command\.foo-bar-[0-9a-f]{6}$/);
      expect(res.avisos.filter((a: string) => a.startsWith("rid "))).toHaveLength(2);

      // o app ignora em silêncio a 2ª linha com rid repetido; aqui nenhuma some
      vi.stubEnv("BILHON_ROOT", repo);
      vi.stubEnv("BILHON_REGISTRO_ENTIDADES", path.join(dataDir, "agente", "registro.yaml"));
      vi.stubEnv("BILHON_AGENTE_DIR", path.join(dataDir, "agente"));
      for (const n of ["BILHON_REPOS_JSON", "BILHON_AGENTES_JSON"]) vi.stubEnv(n, "");
      limparCacheEcossistema();
      const eco = await getEcosystem();
      expect(eco.entities.length).toBe(linhas.length);
    });

    it("é determinístico: rodar de novo produz exatamente o mesmo registro", async () => {
      const repo = await repoFalso(arquivos);
      const dataDir = await pastaTemp("dados-rid-2-");
      await runAgente(await ctxFalso(repo, dataDir));
      const antes = await readFile(path.join(dataDir, "agente", "registro.yaml"), "utf8");
      await runAgente(await ctxFalso(repo, dataDir));
      expect(await readFile(path.join(dataDir, "agente", "registro.yaml"), "utf8")).toBe(antes);
    });
  });

  describe("3. e-mails no título", () => {
    it("textoSeguro troca TODOS os e-mails, não só o primeiro", () => {
      const t = textoSeguro("Contatos: ana@exemplo.com, bia@exemplo.com e caio@exemplo.org (task-tmpl)");
      expect(t).toBe("Contatos: [e-mail], [e-mail] e [e-mail] (task‑tmpl)");
      expect(suspeito(t)).toBe(false);
    });

    it("um checklist com dois e-mails no H1 não derruba addons e o app o aceita (0 em quarentena)", async () => {
      const repo = await repoFalso({
        "LICENSE": "Copyright (c) teste. All Rights Reserved.\n",
        "squads/s1/squad.yaml": squadMinimo,
        "squads/s1/checklists/c2.md": "# Contatos: ana@exemplo.com e bia@exemplo.com\n\n- [ ] item um\n- [ ] item dois\n",
      });
      const dataDir = path.join(repo, "dados-populados"); // dentro da raiz do repo falso (contenção BILHON_ROOT do app)
      const origem = { ...GIT_AUSENTE, origin: "https://github.com/exemplo/teste" };
      await runAddons(await ctxFalso(repo, dataDir, origem));
      const man = await lerManifesto(dataDir);
      const e = man.entries.find((x) => x.id.endsWith(":s1-c2"))!;
      expect(e.title).toBe("Contatos: [e-mail] e [e-mail]");
      expect(suspeito(e.title, e.summary)).toBe(false);

      vi.stubEnv("BILHON_ROOT", repo);
      vi.stubEnv("BILHON_ADDONS_DIR", path.join(dataDir, "addons"));
      const cat = await getAddonCatalogo();
      expect(cat.entries.map((x) => x.id)).toContain(e.id);
      expect(cat.quarentena).toHaveLength(0);
      expect(cat.invalidos).toBe(0);
    });

    async function lerManifesto(dataDir: string) {
      return JSON.parse(await readFile(path.join(dataDir, "addons", "manifest.json"), "utf8")) as { entries: EntradaManifesto[] };
    }
  });

  describe("4. repos.json: linha do repo assumida", () => {
    it("sem gerado_por a linha é sua: preservada como está (tier, category…); com a marca, é regenerada", async () => {
      const repo = await repoFalso({ "README.md": "# Meu Repo\n\n> Sistema de teste para provar a preservação da linha do repositório.\n" });
      const dataDir = await pastaTemp("dados-repos-");
      await runAgente(await ctxFalso(repo, dataDir));
      const arq = path.join(dataDir, "agente", "repos.json");
      const geradas = JSON.parse(await readFile(arq, "utf8")) as Array<Record<string, unknown>>;
      expect(geradas).toHaveLength(1);
      expect(geradas[0].gerado_por).toBe("populate:agente");

      // com a marca: uma edição nossa é desfeita na regeneração (a linha é nossa)
      await writeFile(arq, JSON.stringify([{ ...geradas[0], readme_summary: { title: "editado" } }], null, 2));
      await runAgente(await ctxFalso(repo, dataDir));
      expect(JSON.parse(await readFile(arq, "utf8"))).toEqual(geradas);

      // sem a marca: você assumiu a linha e a enriqueceu
      const assumida = { ...geradas[0], tier: "T1", category: "meu-core" } as Record<string, unknown>;
      delete assumida.gerado_por;
      const outra = { slug: "outro-repo", path: "engine" };
      await writeFile(arq, JSON.stringify([assumida, outra], null, 2));
      const res = await runAgente(await ctxFalso(repo, dataDir));
      expect(JSON.parse(await readFile(arq, "utf8"))).toEqual([assumida, outra]);
      expect(res.resumo.repos).toBe(2);
      expect(res.avisos.some((a: string) => /repos\.json/.test(a))).toBe(true);
      // sem squad nem categoria no ecosystem-registry.yaml não há organização a gerar: o arquivo nem é criado
      expect(existsSync(path.join(dataDir, "agente", "organizacao.json"))).toBe(false);
      expect(res.resumo.organizacao.gravada).toBe(false);
    });
  });

  describe("6. organização do grafo", () => {
    const arquivos = {
      "squads/s1/squad.yaml": "name: s1\ndescription: Squad de teste que organiza agentes, tarefas e scripts no grafo\nmetadata:\n  status: active\n",
      "squads/s1/config.yaml": "agents:\n  - id: a1\n    tier: tier_0\n  - id: a2\n    tier: tier_1\n",
      "squads/s1/agent-registry.yaml": "specialists:\n  a1:\n    id: a1\n    tier: orchestrator\n    deterministic_helper: scripts/varre.js\n  a2:\n    id: a2\n    deterministic_helpers: [scripts/varre.js, scripts/nao-existe.js]\n",
      "squads/s1/scripts/varre.js": "#!/usr/bin/env node\n/**\n * varre.js — varredor determinístico de capacidades\n *\n * Story: X\n */\n'use strict';\n",
      "squads/s1/agents/a1.md": "---\nrole: Classificador de pedidos do squad\nstatus: active\n---\n# a1\n\nAgente que classifica os pedidos que chegam ao squad de teste.\n",
      "squads/s1/agents/a2.md": "# a2\n\nAgente que roteia os pedidos já classificados para quem resolve.\n",
      "squads/s1/agents/_cobertura.md": "# cobertura\n\nMarcador de cobertura que não é agente de verdade no squad.\n",
      "squads/s1/tasks/t1.yaml": [
        "task: t1", "title: Classificar pedido", "description: Classifica o pedido recebido e devolve a intenção estruturada",
        "megabrain_frontmatter:", "  responsavel: \"@a2\"", "responsavel_type: Agent", "responsavel: \"@a1\"",
        "steps:", "  - id: 1", "    name: Ler o pedido", "  - id: 2", "    name: Classificar", "",
      ].join("\n"),
      "squads/s1/tasks/t2.md": "---\nresponsavel: '@outro-squad'\nresponsavel_type: Agent\n---\n# t2\n\n## Objetivo\n\nTarefa cujo responsável não é agente deste squad de teste.\n",
      ".claude/agents/s1--a1.md": "---\nname: s1--a1\ndescription: Projeção do a1 no Claude Code para o teste\nmodel: opus\n---\n# a1\n",
      "agents/_registry/ecosystem-registry.yaml": [
        "agents:",
        "  - id: c1", "    category: system/conclave", "    path: agents/system/conclave/c1/agent.md", "    status: active",
        "  - id: fantasma", "    category: system", "    path: agents/system/fantasma/agent.md", "    status: placeholder", "",
      ].join("\n"),
      "agents/system/conclave/README.md": "# Conclave (L1)\n\nAgentes de deliberação com várias perspectivas para o teste.\n\n| ID | Role | Perspective |\n|----|------|-------------|\n| c1 | Guardião analítico | Rigor |\n",
      "agents/system/conclave/c1/agent.md": "---\nid: c1\n---\n# c1\n\nAgente crítico do conclave usado no teste da organização.\n",
    };

    it("pilar por squad e por categoria do registro; tier, modelo, executor, passos e scripts saem dos arquivos; o leitor aceita tudo", async () => {
      const repo = await repoFalso(arquivos);
      const dataDir = path.join(repo, "dados-populados"); // dentro da raiz do repo falso (contenção BILHON_ROOT do leitor)
      const res = await runAgente(await ctxFalso(repo, dataDir));
      const org = await lerOrgArquivo(dataDir);
      const m = { gerado_por: "populate:agente" };
      expect(org.pilares).toEqual([
        { id: "megabrain.squad.s1", nome: "s1", tagline: "Squad de teste que organiza agentes, tarefas e scripts no grafo", ...m },
        { id: "megabrain.categoria.system-conclave", nome: "Conclave (L1)", tagline: "Agentes de deliberação com várias perspectivas para o teste.", ...m },
      ]);
      const script = "megabrain.script.s1.scripts-varre-js";
      expect(org.ferramentas).toEqual([{ id: script, nome: "varre.js", categoria: "script determinístico", descricao: "varredor determinístico de capacidades", ...m }]);
      expect(org.agentes.map((a) => a.id)).toEqual(["megabrain.worker.s1.a1", "megabrain.worker.s1.a2", "megabrain.agent.c1"]); // _cobertura e o fantasma (sem arquivo) ficam de fora
      expect(org.agentes[0]).toMatchObject({ nome: "a1", pilarId: "megabrain.squad.s1", papel: "Classificador de pedidos do squad", status: "active", funcao: "tier_0", modelo: "opus", ambiente: "Claude Code (subagente)", ferramentas: [script] });
      expect(org.agentes[1]).toMatchObject({ funcao: "tier_1", ferramentas: [script] }); // config.yaml vence o agent-registry.yaml; script ausente não entra
      expect(org.agentes[1].modelo).toBeUndefined();
      expect(org.agentes[2]).toMatchObject({ nome: "c1", pilarId: "megabrain.categoria.system-conclave", papel: "Guardião analítico", status: "active" });
      const [t1, t2] = org.tarefas;
      expect(t1).toMatchObject({ id: "megabrain.task.s1.t1", titulo: "Classificar pedido", passos: ["Ler o pedido", "Classificar"], executorTipo: "agent", executorId: "megabrain.worker.s1.a1" });
      expect(t2).toMatchObject({ id: "megabrain.task.s1.t2", titulo: "t2", resumo: "Tarefa cujo responsável não é agente deste squad de teste." });
      expect(t2.executorId).toBeUndefined();
      expect(org.pessoas).toEqual([]);
      expect(org.execucoes).toEqual([]);
      expect(res.avisos.some((a: string) => /t1 \(@a1 x @a2\)/.test(a))).toBe(true); // contradição do responsavel é relatada
      expect(res.avisos.some((a: string) => /t2 \(@outro-squad\)/.test(a))).toBe(true);
      expect(res.avisos.some((a: string) => /nao-existe\.js/.test(a))).toBe(true);

      vi.stubEnv("BILHON_ROOT", repo);
      const leitura = await lerOrganizacao(path.join(dataDir, "agente", "organizacao.json"));
      expect(leitura.ok).toBe(true);
      if (!leitura.ok) return;
      expect(leitura.avisos).toEqual([]);
      expect(leitura.data.tarefas.find((t) => t.id === "tarefa:megabrain.task.s1.t1")!.executorId).toBe("agente:megabrain.worker.s1.a1");
      expect(leitura.data.agentes.find((a) => a.id === "agente:megabrain.worker.s1.a1")!.ferramentas).toEqual([`ferramenta:${script}`]);
    });

    it("é determinístico: rodar de novo não muda o organizacao.json", async () => {
      const repo = await repoFalso(arquivos);
      const dataDir = await pastaTemp("dados-org-2-");
      await runAgente(await ctxFalso(repo, dataDir));
      const antes = await readFile(path.join(dataDir, "agente", "organizacao.json"), "utf8");
      await runAgente(await ctxFalso(repo, dataDir));
      expect(await readFile(path.join(dataDir, "agente", "organizacao.json"), "utf8")).toBe(antes);
    });
  });

  describe("5. papel do engine", () => {
    it("conta os arquivos de código no disco (inclui __init__.py vazio e nome sensível; ignora __pycache__) e acerta o plural", async () => {
      const repo = await repoFalso({
        "engine/alfa/AGENT.md": "---\nrole: Engine de teste alfa\nlayer: L1\n---\n# Alfa\n",
        "engine/alfa/__init__.py": "",
        "engine/alfa/um.py": "x = 1\n",
        "engine/alfa/sub/__init__.py": "",
        "engine/alfa/sub/dois.py": "y = 2\n",
        "engine/alfa/credential_manager.py": "z = 3\n",
        "engine/alfa/__pycache__/lixo.py": "w = 4\n",
        "engine/beta/AGENT.md": "---\nrole: Engine com um único arquivo\n---\n# Beta\n",
        "engine/beta/so.py": "k = 1\n",
      });
      const dataDir = await pastaTemp("dados-engine-");
      await runAgente(await ctxFalso(repo, dataDir));
      const linhas = (loadYaml(await readFile(path.join(dataDir, "agente", "registro.yaml"), "utf8")) as { entities: Linha[] }).entities;
      expect(linhas.find((l) => l.rid === "megabrain.engine.alfa")!.role).toBe("Engine de teste alfa (camada L1) — 5 arquivos de código em 1 subpacote (sub)");
      expect(linhas.find((l) => l.rid === "megabrain.engine.beta")!.role).toBe("Engine com um único arquivo — 1 arquivo de código");
    });

    it.skipIf(!temRepo)("no mega-brain real, o número do engine `intelligence` é o que existe no disco", async () => {
      const contar = async (dir: string): Promise<number> => {
        let n = 0;
        for (const e of await readdir(dir, { withFileTypes: true })) {
          if (e.isSymbolicLink()) continue;
          if (e.isDirectory()) { if (!["__pycache__", "node_modules"].includes(e.name)) n += await contar(path.join(dir, e.name)); }
          else if (/\.(py|js|mjs|cjs|ts|sh)$/i.test(e.name)) n++;
        }
        return n;
      };
      const noDisco = await contar(path.join(REPO, "engine", "intelligence"));
      const dataDir = await pastaTemp("dados-engine-real-");
      const { docs } = await scanRepo(REPO);
      await runAgente({ repoRoot: REPO, appRoot: APP, dataDir, docs, excluded: [], opts: {}, resultados: {}, gitInfo: GIT_AUSENTE });
      const linhas = (loadYaml(await readFile(path.join(dataDir, "agente", "registro.yaml"), "utf8")) as { entities: Linha[] }).entities;
      const role = linhas.find((l) => l.rid === "megabrain.engine.intelligence")!.role!;
      expect(role).toContain(`— ${noDisco} arquivos de código em `);
    }, 600_000);
  });
});

/**
 * O que o app enxerga nos dados JÁ populados em `data/` (as mesmas variáveis que o módulo `ambiente` grava
 * no `.env.local`). Só leitura: pulado se ainda não foi populado.
 */
const dadosReais = path.join(APP, "data");
describe.skipIf(!temRepo || !existsSync(path.join(dadosReais, "agente", "registro.yaml")) || !existsSync(path.join(dadosReais, "addons", "manifest.json")))(
  "dados populados em data/ (leitura pelos leitores reais, com o ambiente do .env.local)",
  () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      limparCacheEcossistema();
    });
    /** BILHON_ROOT que o app usa nos dados populados: a do .env.local (bloco inclusive); sem ela, a raiz padrão ../.. */
    const raizDoEnvLocal = () => variavelDosArquivosDoApp(APP, "BILHON_ROOT")?.valor || "../..";
    function ambienteDoEnvLocal() {
      vi.stubEnv("BILHON_ROOT", raizDoEnvLocal());
      vi.stubEnv("BILHON_REGISTRO_ENTIDADES", "data/agente/registro.yaml");
      vi.stubEnv("BILHON_OWNERS_PROPRIOS", variavelDosArquivosDoApp(APP, "BILHON_OWNERS_PROPRIOS")?.valor || (donoDoOrigin() ?? ""));
      for (const n of ["BILHON_AGENTE_DIR", "BILHON_REPOS_JSON", "BILHON_AGENTES_JSON", "BILHON_ADDONS_DIR", "BILHON_BRAIN_ORG_JSON", "BILHON_BRAIN_STORE"]) vi.stubEnv(n, "");
      limparCacheEcossistema();
      limparCacheMemoria();
    }

    it.skipIf(!existsSync(path.join(dadosReais, "agente", "organizacao.json")))("Agente (grafo): a organização de data/agente é lida inteira, sem linha descartada", async () => {
      ambienteDoEnvLocal();
      const brain = await carregarBrain();
      expect(brain.org.ok).toBe(true);
      if (!brain.org.ok) return;
      expect(brain.org.avisos).toEqual([]);
      const { pilares, agentes, tarefas, ferramentas } = brain.org.data;
      console.info(`[o app enxerga] Agente (grafo): ${pilares.length} pilares, ${agentes.length} agentes, ${tarefas.length} tarefas, ${ferramentas.length} ferramentas; notas: ${brain.memoria ? brain.memoria.total : "nenhuma"}`);
    });

    it("Agente: todas as linhas do registro viram itens, sem descarte por caminho inválido", async () => {
      ambienteDoEnvLocal();
      const linhas = (loadYaml(await readFile(path.join(dadosReais, "agente", "registro.yaml"), "utf8")) as { entities: Linha[] }).entities;
      const eco = await getEcosystem();
      expect(eco.entities.length).toBe(linhas.length);
      expect(eco.fontes?.map((f) => `${f.id}:${f.estado}`)).toEqual(["registro:ok", "repos:ok", "espelhos:ok", "uso:ausente"]);
      const raiz = path.resolve(APP, raizDoEnvLocal());
      for (const e of eco.entities) if (e.kind !== "repo") expect(existsSync(path.join(raiz, e.path)), e.path).toBe(true);
      console.info(`[o app enxerga] Agente: ${eco.entities.length} itens — ${JSON.stringify(Object.fromEntries(Object.entries(eco.counts).filter(([, n]) => n)))}; procedência ${JSON.stringify(eco.countsPorProcedencia)}`);
    });

    it("Add-ons: todos aprovados, 0 em quarentena, 0 inválidos, e todo artefato é servido com checksum igual", async () => {
      ambienteDoEnvLocal();
      const manifesto = JSON.parse(await readFile(path.join(dadosReais, "addons", "manifest.json"), "utf8")) as { entries: EntradaManifesto[] };
      const cat = await getAddonCatalogo();
      expect(cat.entries.length).toBe(manifesto.entries.length);
      expect(cat.quarentena).toHaveLength(0);
      expect(cat.invalidos).toBe(0);
      let artefatos = 0;
      for (const e of cat.entries) {
        for (const a of e.artifacts) {
          const txt = await lerArtefatoAddon(e.id, a.id);
          expect(txt, `${e.id}/${a.id}`).not.toBeNull();
          expect(sha(txt!)).toBe(a.checksum);
          artefatos++;
        }
      }
      const porCategoria: Record<string, number> = {};
      for (const e of cat.entries) porCategoria[e.category] = (porCategoria[e.category] ?? 0) + 1;
      console.info(`[o app enxerga] Add-ons: ${cat.entries.length} aprovados, ${cat.quarentena.length} em quarentena, ${cat.invalidos} inválidos, ${artefatos} artefatos servidos — ${JSON.stringify(porCategoria)}`);
    }, 600_000);
  },
);
