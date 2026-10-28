/**
 * Módulo `ontologia` da população do Knowledge: o manifesto da página /ontologia a partir das camadas de
 * DNA dos especialistas do mega-brain.
 *
 * Mega-brain sintético em tmpdir (external, business e personal; lista com âncora YAML; voice-dna com
 * immune_system → behavioral_pattern_id; o mesmo id em dois especialistas, id ausente e id repetido) e o
 * leitor REAL do app (`normalizarOntologia` e `getOntologia` de lib/ontologia.ts):
 *  - o leitor lê o manifesto inteiro: nenhum item, ligação ou dado descartado, nenhum texto recortado;
 *  - cada item tem fonte no mega-brain (arquivo#id) e o texto vem desse arquivo, sem nada inventado;
 *  - personal nunca entra (nem com --include-personal); ligação só para alvo que existe;
 *  - ids `<especialista>/<id>`; sem id ou repetido, `<especialista>/<lista>-<posição>`, contado e avisado;
 *  - tetos do leitor: o excedente sai de forma determinística e CONTADA (itens, ligações, dados, textos);
 *  - idempotência (mesmos bytes, "sem-mudanca"), arquivo seu preservado, manifesto removido sem DNA.
 * Último bloco: o Megabrain real (dois níveis acima do app), quando existe, só lido; a saída vai para tmpdir.
 *
 * Nada é gravado fora do tmpdir: `dataDir` vem de um diretório temporário.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dump, load } from "js-yaml";
import {
  MAX_CAMADAS,
  MAX_DADOS_POR_ITEM,
  MAX_ITENS,
  MAX_LIGACOES_POR_ITEM,
  MAX_REGRAS,
  normalizarOntologia,
  type Item,
  type Ontologia,
} from "@/lib/ontologia";
import { sinaisDeMegabrain } from "../common.mjs";
import runOntologia, { ARQUIVO, LIMITES, MARCA } from "../ontologia.mjs";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

type ItemCru = {
  id: string;
  nome?: string;
  descricao?: string;
  status?: string;
  fonte?: string;
  dados?: Record<string, string>;
  ligacoes?: { camada: string; item: string; rotulo?: string }[];
};
type CamadaCru = { id: string; rotulo: string; descricao?: string; itens: ItemCru[] };
type ManifestoCru = { gerado_por: string; titulo: string; camadas: CamadaCru[]; regras?: { id: string; titulo: string; descricao?: string }[] };
type Resumo = {
  arquivo: string;
  acao: string;
  especialistas: number;
  camadas: number;
  itens: number;
  ligacoes: number;
  porCamada: Record<string, number>;
  porEspecialista: Record<string, { id: string; nome: string; bucket: string; itens: Record<string, number>; total: number; cortados?: number }>;
  regras: number;
  idsDerivados: number;
  cortes: { itens: number; ligacoes: number; dados: number; textos: Record<string, number> };
};

/** O módulo é JS (o TS infere pouco do resumo): aqui ganha o formato que os testes leem. */
const rodar = async (ctx: Record<string, unknown>) => (await runOntologia(ctx)) as unknown as { resumo: Resumo; avisos: string[] };

async function escrever(raiz: string, rel: string, conteudo: string) {
  const abs = path.join(raiz, ...rel.split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, conteudo, "utf8");
}

const yaml = (o: unknown) => dump(o, { lineWidth: -1 });

const TABELA_DNA = [
  "# Mega Brain",
  "",
  "DNA Schema (10 Layers):",
  "",
  "| Layer | Name | Description |",
  "|-------|------|-------------|",
  "| L1 | PHILOSOPHIES | Core beliefs and worldview |",
  "| L2 | MENTAL-MODELS | Thinking and decision frameworks |",
  "| L3 | HEURISTICS | Practical rules and decision shortcuts |",
  "| L4 | FRAMEWORKS | Structured methodologies and processes |",
  "| L5 | METHODOLOGIES | Step-by-step implementations |",
  "| L6 | BEHAVIORAL-PATTERNS | Behavioral patterns and triggers |",
  "| L7 | VALUES-HIERARCHY | Values hierarchy and priorities |",
  "| L8 | VOICE-DNA | Voice DNA, signature phrases, states |",
  "| L9 | OBSESSIONS | Recurring obsessions and cognitive priorities |",
  "| L10 | PARADOXES | Internal paradoxes and productive contradictions |",
  "",
].join("\n");

const ONTOLOGY_LAYER = [
  "#!/usr/bin/env python3",
  '"""',
  "ONTOLOGY LAYER (OG-RAG) - Phase 4.3",
  "======================================",
  "Anchors retrieval in the DNA 5-layer ontology.",
  "Provides ontology-aware retrieval that respects the hierarchy:",
  "",
  "  FILOSOFIA → MODELO_MENTAL → HEURISTICA → FRAMEWORK → METODOLOGIA",
  "",
  '"""',
  "",
].join("\n");

const NOME_LONGO =
  "Para competir contra concorrentes que gastam milhões em mídia, construa uma marca maior que a pessoa, apoiada em mentores e clientes, aceitando o custo";

/** Lista com âncora YAML: o MCE grava `patterns` e `behavioral_patterns` como a MESMA lista. */
const PADROES_A = [
  "pessoa: Pessoa A",
  "slug: pessoa-a",
  "layer: L6",
  "patterns: &id001",
  "- id: BP-A-001",
  "  pattern_name: Padrão um",
  "  trigger: Quando surge preocupação com o futuro",
  "  action: Organiza o presente para liberar tempo",
  "  priority: HIGH",
  "  insight_ids:",
  "  - INS-A-001",
  "  chunk_ids:",
  "  - ch_1",
  "  - ch_2",
  "  quote: quanto mais você arrumar o presente",
  "- id: BP-A-002",
  "  pattern_name: Padrão dois",
  "  trigger: Quando é preciso decidir",
  "  action: Mantém o que dá resultado",
  "  priority: MEDIUM",
  "  chunk_ids:",
  "  - ch_3",
  "behavioral_patterns: *id001",
  "",
].join("\n");

describe("módulo ontologia", () => {
  let raiz: string;
  let repo: string;
  let dataDir: string;
  let ctx: Record<string, unknown>;
  const manifestoAbs = () => path.join(dataDir, "ontologia", ARQUIVO);
  const lerManifesto = async () => load(await readFile(manifestoAbs(), "utf8")) as ManifestoCru;

  beforeEach(async () => {
    raiz = await mkdtemp(path.join(tmpdir(), "populate-ontologia-"));
    repo = path.join(raiz, "repo");
    dataDir = path.join(raiz, "data");
    await mkdir(path.join(repo, "engine"), { recursive: true });
    await escrever(repo, ".claude/CLAUDE.md", TABELA_DNA);
    await escrever(repo, "engine/intelligence/rag/ontology_layer.py", ONTOLOGY_LAYER);

    const a = "knowledge/external/dna/persons/pessoa-a";
    await escrever(repo, `${a}/DNA-CONFIG.yaml`, yaml({
      version: "1.0.0", pessoa: "pessoa-a", extracted_at: "2026-10-27T23:04:15Z", review_status: "approved",
      composition: { FILOSOFIAS: 2, HEURISTICAS: 1, BEHAVIORAL_PATTERNS: 2 },
    }));
    await escrever(repo, `${a}/filosofias.yaml`, yaml({
      version: "3.0", person: "pessoa-a", layer: "L1_FILOSOFIAS",
      entries: [
        { id: "fil_001", name: NOME_LONGO, description: `${NOME_LONGO} de desacelerar o perfil pessoal.`, source_insight_ids: ["INS-A-002"], chunk_refs: ["ch_4"], confidence: 0.8 },
        { id: "fil_002", name: "Marketing é o core do negócio", description: "Trate marketing como o core do negócio.", confidence: 0.9, source_caveats: ["Recomendação do autor."] },
      ],
    }));
    await escrever(repo, `${a}/behavioral-patterns.yaml`, PADROES_A);
    await escrever(repo, `${a}/voice-dna.yaml`, yaml({
      pessoa: "Pessoa A", layer: "L8",
      tone_profile: { certainty: { score: 8.5, justificativa: "Afirma sem hedge.", chunk_ids: ["ch_1"] } },
      signature_phrases: [{ id: "VP-A-001", phrase: "Dá resultado, mantém.", context: "Regra de decisão", chunk_ids: ["ch_2"], poder: 9 }],
      immune_system: [
        { id: "IM-A-001", trigger: "Medo do futuro", response: "Reenquadra", intensidade: 8, behavioral_pattern_id: "BP-A-001" },
        { id: "IM-A-002", trigger: "Outro gatilho", response: "Outra resposta", behavioral_pattern_id: "BP-A-999" },
      ],
      behavioral_states: [{ nome: "Teaching Mode", trigger: "Explicar", tom: "Metódico", sinais: ["um", "dois"], chunk_ids: ["ch_1"] }],
      communication_patterns: { opening_hooks: { padrao: "Abre com tese" } },
    }));
    await escrever(repo, `${a}/paradoxes.yaml`, yaml({
      pessoa: "Pessoa A", layer: "L10",
      paradoxes: [{ id: "PAR-A-001", tension_a: "Marca forte sem depender de uma pessoa", tension_b: "Marca tem preço pessoal", resolution: "Aceita o custo", lado_a: "Marca forte sem depender de uma pessoa", chunk_ids: ["ch_5"] }],
    }));
    await escrever(repo, `${a}/extra.yaml`, "qualquer: coisa\n");

    const b = "knowledge/external/dna/persons/pessoa-b";
    await escrever(repo, `${b}/filosofias.yaml`, yaml({
      person: "pessoa-b",
      entries: [
        { id: "fil_001", name: "Filosofia de B", description: "Descrição de B" },
        { name: "Entrada sem id", description: "Sem id no YAML" },
        { id: "fil_001", name: "Id repetido", description: "Mesmo id da primeira" },
      ],
    }));

    await escrever(repo, "knowledge/business/dna/persons/pessoa-c/values-hierarchy.yaml", yaml({
      pessoa: "Pessoa C", layer: "L7",
      values: [{ id: "VAL-C-001", value: "Relevância para o cliente", evidence: "Parte do que interessa ao público", rank: 1, tier: 1 }],
    }));
    await escrever(repo, "knowledge/personal/dna/persons/segredo/filosofias.yaml", yaml({
      entries: [{ id: "fil_001", name: "Nota pessoal", description: "Não pode sair do bucket pessoal" }],
    }));

    await mkdir(dataDir, { recursive: true });
    ctx = { repoRoot: repo, appRoot: path.resolve("."), dataDir, docs: [], excluded: [], opts: {}, resultados: {} };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(raiz, { recursive: true, force: true });
  });

  /** Como o leitor devolve um item cru que ele aceitou sem corte: os padrões dele preenchidos. */
  const comoOLeitorVe = (it: ItemCru): Item => {
    const out: Record<string, unknown> = {
      id: it.id, nome: it.nome ?? it.id, descricao: it.descricao, status: it.status,
      ligacoes: it.ligacoes ?? [], dados: it.dados ?? {}, fonte: it.fonte,
    };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out as Item;
  };

  function confereLeitor(cru: ManifestoCru): Ontologia {
    const o = normalizarOntologia(cru)!;
    expect(o).not.toBeNull();
    expect(o.descartes).toEqual({ itens: 0, ligacoes: 0 });
    expect(o.camadas.map((c) => c.id)).toEqual(cru.camadas.map((c) => c.id));
    cru.camadas.forEach((c, i) => {
      expect(o.camadas[i].rotulo).toBe(c.rotulo);
      expect(o.camadas[i].descricao).toBe(c.descricao);
      // item por item, igual ao que foi gravado: nada descartado nem recortado pelo leitor
      expect(o.camadas[i].itens).toEqual(c.itens.map(comoOLeitorVe));
    });
    expect(o.regras).toEqual(cru.regras ?? []);
    return o;
  }

  it("os tetos do módulo são os do leitor", () => {
    expect(LIMITES).toMatchObject({
      camadas: MAX_CAMADAS, itens: MAX_ITENS, ligacoesPorItem: MAX_LIGACOES_POR_ITEM, dadosPorItem: MAX_DADOS_POR_ITEM, regras: MAX_REGRAS,
    });
  });

  it("gera o manifesto que o leitor do app lê inteiro, também pelo BILHON_ONTOLOGIA_MANIFEST", async () => {
    const r = await rodar(ctx);
    expect(r.resumo.acao).toBe("criado");
    const cru = await lerManifesto();
    expect(cru.gerado_por).toBe(MARCA);
    expect(cru.camadas.map((c) => c.id)).toEqual(["especialistas", "filosofias", "behavioral-patterns", "values-hierarchy", "voice-dna", "paradoxes"]);
    const o = confereLeitor(cru);

    const itens = o.camadas.reduce((t, c) => t + c.itens.length, 0);
    const ligacoes = o.camadas.reduce((t, c) => t + c.itens.reduce((u, i) => u + i.ligacoes.length, 0), 0);
    expect(r.resumo).toMatchObject({ especialistas: 3, camadas: 6, itens, ligacoes, regras: 1 });
    expect(r.resumo.porCamada).toEqual({ especialistas: 3, filosofias: 5, "behavioral-patterns": 2, "values-hierarchy": 1, "voice-dna": 4, paradoxes: 1 });
    expect(r.resumo.porEspecialista["pessoa-a"].itens).toEqual({ filosofias: 2, "behavioral-patterns": 2, "voice-dna": 4, paradoxes: 1 });
    expect(r.resumo.porEspecialista["pessoa-c"]).toMatchObject({ bucket: "business", total: 1 });
    expect(r.resumo.cortes).toEqual({ itens: 0, ligacoes: 0, dados: 0, textos: { nome: 1 } });

    // a tela lê pelo caminho configurado, dentro de BILHON_ROOT
    vi.stubEnv("BILHON_ROOT", raiz);
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", manifestoAbs());
    vi.resetModules();
    const { getOntologia } = await import("@/lib/ontologia");
    const tela = await getOntologia();
    expect(tela.estado).toBe("ok");
    expect(tela.ontologia!.descartes).toEqual({ itens: 0, ligacoes: 0 });
    expect(tela.ontologia!.camadas.reduce((t, c) => t + c.itens.length, 0)).toBe(itens);
  });

  it("cada item tem fonte no mega-brain e o texto vem dela; camadas e regra citam de onde vieram", async () => {
    await rodar(ctx);
    const cru = await lerManifesto();
    const strings = (v: unknown): string[] =>
      typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

    for (const c of cru.camadas) {
      for (const it of c.itens) {
        if (c.id === "especialistas") {
          expect(it.fonte).toMatch(/^knowledge\/(external|business)\/dna\/persons\/[a-z0-9-]+\/$/);
          expect(existsSync(path.join(repo, it.fonte!))).toBe(true);
          continue;
        }
        const m = it.fonte!.match(/^(knowledge\/(?:external|business)\/dna\/persons\/[a-z0-9-]+\/[^#/]+\.yaml)#(.+)$/);
        expect(m, it.fonte).not.toBeNull();
        const fonteTexto = await readFile(path.join(repo, m![1]), "utf8");
        const valores = strings(load(fonteTexto)).map((s) => s.trim());
        // descrição: texto literal do arquivo; nome: literal, cortado com "…" ou os dois lados do paradoxo
        if (it.descricao) expect(valores).toContain(it.descricao);
        const nome = it.nome!;
        const partes = nome.endsWith("…") ? [nome.slice(0, -1)] : nome.split(" × ");
        for (const p of partes) expect(valores.some((v) => v.startsWith(p))).toBe(true);
        for (const [k, v] of Object.entries(it.dados ?? {})) {
          if (k === "lista") continue;
          for (const parte of v.split(" | ")) expect(fonteTexto).toContain(parte);
        }
      }
    }

    const filosofias = cru.camadas.find((c) => c.id === "filosofias")!;
    expect(filosofias.rotulo).toBe("L1 · Filosofias");
    expect(filosofias.descricao).toBe('Core beliefs and worldview (fonte: .claude/CLAUDE.md, linha 7, tabela "DNA Schema (10 Layers)")');
    expect(cru.camadas.find((c) => c.id === "paradoxes")!.descricao).toContain("Internal paradoxes and productive contradictions (fonte: .claude/CLAUDE.md, linha 16");
    expect(cru.regras).toEqual([{
      id: "hierarquia-dna",
      titulo: "FILOSOFIA → MODELO_MENTAL → HEURISTICA → FRAMEWORK → METODOLOGIA",
      descricao: "Anchors retrieval in the DNA 5-layer ontology. Provides ontology-aware retrieval that respects the hierarchy: (fonte: engine/intelligence/rag/ontology_layer.py, linha 8)",
    }]);
  });

  it("sem a tabela do CLAUDE.md nem o ontology_layer.py: camadas sem descrição e nenhuma regra", async () => {
    await rm(path.join(repo, ".claude"), { recursive: true, force: true });
    await rm(path.join(repo, "engine", "intelligence"), { recursive: true, force: true });
    const r = await rodar(ctx);
    const cru = await lerManifesto();
    for (const c of cru.camadas.filter((x) => x.id !== "especialistas")) expect(c.descricao).toBeUndefined();
    expect(cru.regras).toBeUndefined();
    expect(r.resumo.regras).toBe(0);
    confereLeitor(cru);
  });

  it("personal nunca entra, nem com --include-personal", async () => {
    const r = await rodar({ ...ctx, opts: { includePersonal: true } });
    const texto = await readFile(manifestoAbs(), "utf8");
    expect(texto).not.toContain("segredo");
    expect(texto).not.toContain("knowledge/personal");
    expect(texto).not.toContain("Nota pessoal");
    expect(Object.keys(r.resumo.porEspecialista)).toEqual(["pessoa-a", "pessoa-b", "pessoa-c"]);
    expect(r.avisos.some((a) => a.includes("--include-personal"))).toBe(true);
  });

  it("todo item de DNA liga ao seu especialista; entre itens de DNA, só por *_id explícito com alvo existente", async () => {
    await rodar(ctx);
    const cru = await lerManifesto();
    const existe = new Set(cru.camadas.flatMap((c) => c.itens.map((i) => `${c.id}\u0000${i.id}`)));
    let dna = 0;
    let entreDna = 0;
    for (const c of cru.camadas.filter((x) => x.id !== "especialistas")) {
      for (const it of c.itens) {
        dna++;
        const esp = it.id.split("/")[0];
        expect(it.ligacoes![0]).toEqual({ camada: "especialistas", item: esp, rotulo: "de" });
        for (const l of it.ligacoes!) expect(existe.has(`${l.camada}\u0000${l.item}`)).toBe(true);
        entreDna += it.ligacoes!.length - 1;
      }
    }
    expect(entreDna).toBe(1);
    const voz = cru.camadas.find((c) => c.id === "voice-dna")!.itens;
    expect(voz.find((i) => i.id === "pessoa-a/IM-A-001")!.ligacoes).toEqual([
      { camada: "especialistas", item: "pessoa-a", rotulo: "de" },
      { camada: "behavioral-patterns", item: "pessoa-a/BP-A-001", rotulo: "behavioral_pattern_id" },
    ]);
    // BP-A-999 não existe: nenhuma ligação inventada para ele
    expect(voz.find((i) => i.id === "pessoa-a/IM-A-002")!.ligacoes).toHaveLength(1);
    expect(dna).toBe(13);
    // o especialista não liga a nada: os itens de DNA é que ligam a ele
    for (const it of cru.camadas[0].itens) expect(it.ligacoes).toBeUndefined();
  });

  it("ids: <especialista>/<id do YAML>; sem id ou repetido, derivado da posição, contado e avisado", async () => {
    const r = await rodar(ctx);
    const cru = await lerManifesto();
    const fil = cru.camadas.find((c) => c.id === "filosofias")!.itens;
    expect(fil.map((i) => i.id)).toEqual(["pessoa-a/fil_001", "pessoa-a/fil_002", "pessoa-b/fil_001", "pessoa-b/entries-2", "pessoa-b/entries-3"]);
    expect(fil.find((i) => i.id === "pessoa-b/entries-2")!.fonte).toBe("knowledge/external/dna/persons/pessoa-b/filosofias.yaml#entries-2");
    expect(fil.find((i) => i.id === "pessoa-b/entries-3")!.nome).toBe("Id repetido");
    expect(fil.find((i) => i.id === "pessoa-a/fil_001")!.fonte).toBe("knowledge/external/dna/persons/pessoa-a/filosofias.yaml#fil_001");
    const voz = cru.camadas.find((c) => c.id === "voice-dna")!.itens;
    expect(voz.map((i) => i.id)).toEqual(["pessoa-a/VP-A-001", "pessoa-a/IM-A-001", "pessoa-a/IM-A-002", "pessoa-a/behavioral_states-1"]);
    expect(r.resumo.idsDerivados).toBe(3);
    expect(r.avisos.some((a) => a.includes("pessoa-b") && a.includes("sem id") && a.includes("1 id(s) derivado(s)"))).toBe(true);
    expect(r.avisos.some((a) => a.includes("pessoa-b") && a.includes("id repetido"))).toBe(true);
    // âncora YAML (patterns / behavioral_patterns): a lista entra uma vez só
    expect(cru.camadas.find((c) => c.id === "behavioral-patterns")!.itens.map((i) => i.id)).toEqual(["pessoa-a/BP-A-001", "pessoa-a/BP-A-002"]);
  });

  it("nome, descrição, status e dados saem dos campos do YAML, com o nome original", async () => {
    const r = await rodar(ctx);
    const cru = await lerManifesto();
    const item = (camada: string, id: string) => cru.camadas.find((c) => c.id === camada)!.itens.find((i) => i.id === id)!;

    expect(item("especialistas", "pessoa-a")).toEqual({
      id: "pessoa-a",
      nome: "Pessoa A",
      status: "approved",
      fonte: "knowledge/external/dna/persons/pessoa-a/",
      dados: {
        bucket: "external",
        nome_de: "knowledge/external/dna/persons/pessoa-a/behavioral-patterns.yaml",
        version: "1.0.0",
        extracted_at: "2026-10-27T23:04:15Z",
        "composition.FILOSOFIAS": "2",
        "composition.HEURISTICAS": "1",
        "composition.BEHAVIORAL_PATTERNS": "2",
        "tone_profile.certainty": "8.5",
      },
    });
    // sem `pessoa` diferente do slug em nenhum YAML: o nome é o slug
    expect(item("especialistas", "pessoa-b").nome).toBe("pessoa-b");

    const f1 = item("filosofias", "pessoa-a/fil_001");
    expect([...f1.nome!]).toHaveLength(LIMITES.rotulo);
    expect(f1.nome!.endsWith("…")).toBe(true);
    expect(f1.descricao).toBe(`${NOME_LONGO} de desacelerar o perfil pessoal.`);
    expect(f1.status).toBe("confiança 0.8");
    // o nome cortado está inteiro na descrição: não se repete nos dados
    expect(f1.dados).toEqual({ source_insight_ids: "INS-A-002", chunk_refs: "ch_4" });
    expect(item("filosofias", "pessoa-a/fil_002").dados).toEqual({ source_caveats: "Recomendação do autor." });

    expect(item("behavioral-patterns", "pessoa-a/BP-A-001")).toMatchObject({
      nome: "Padrão um",
      descricao: "Organiza o presente para liberar tempo",
      status: "HIGH",
      dados: { trigger: "Quando surge preocupação com o futuro", insight_ids: "INS-A-001", chunk_ids: "ch_1 | ch_2", quote: "quanto mais você arrumar o presente" },
    });
    expect(item("voice-dna", "pessoa-a/VP-A-001")).toMatchObject({
      nome: "Dá resultado, mantém.", descricao: "Regra de decisão", status: "poder 9", dados: { lista: "signature_phrases", chunk_ids: "ch_2" },
    });
    expect(item("voice-dna", "pessoa-a/behavioral_states-1")).toMatchObject({
      nome: "Teaching Mode", descricao: "Metódico", dados: { lista: "behavioral_states", trigger: "Explicar", sinais: "um | dois", chunk_ids: "ch_1" },
    });
    expect(item("values-hierarchy", "pessoa-c/VAL-C-001")).toMatchObject({ status: "tier 1", dados: { rank: "1" } });
    // paradoxo sem campo de nome: os dois lados; a frase repetida em lado_a entra uma vez
    const par = item("paradoxes", "pessoa-a/PAR-A-001");
    expect(par.nome).toBe("Marca forte sem depender de uma pessoa × Marca tem preço pessoal");
    expect(par.descricao).toBe("Aceita o custo");
    expect(par.status).toBeUndefined();
    expect(par.dados).toEqual({ tension_a: "Marca forte sem depender de uma pessoa", tension_b: "Marca tem preço pessoal", chunk_ids: "ch_5" });

    expect(r.avisos.some((a) => a.includes("DNA-CONFIG declara HEURISTICAS=1, mas não há heuristicas.yaml"))).toBe(true);
    expect(r.avisos.some((a) => a.includes("extra.yaml") && a.includes("sem camada"))).toBe(true);
    expect(r.avisos.some((a) => a.includes('textos acima do limite do leitor cortados com "…": nome 1'))).toBe(true);
  });

  it("idempotente: os mesmos bytes não são regravados; mudança no DNA regrava", async () => {
    expect((await rodar(ctx)).resumo.acao).toBe("criado");
    const antes = await readFile(manifestoAbs(), "utf8");
    const mtime = (await stat(manifestoAbs())).mtimeMs;
    expect((await rodar(ctx)).resumo.acao).toBe("sem-mudanca");
    expect(await readFile(manifestoAbs(), "utf8")).toBe(antes);
    expect((await stat(manifestoAbs())).mtimeMs).toBe(mtime);

    await escrever(repo, "knowledge/business/dna/persons/pessoa-c/values-hierarchy.yaml", yaml({
      pessoa: "Pessoa C", values: [{ id: "VAL-C-001", value: "Relevância para o cliente (revisto)", evidence: "Parte do que interessa", tier: 1 }],
    }));
    expect((await rodar(ctx)).resumo.acao).toBe("atualizado");
    expect(await readFile(manifestoAbs(), "utf8")).toContain("Relevância para o cliente (revisto)");
  });

  it("arquivo seu em data/ontologia/ manda: não é sobrescrito, e o gerado antes sai para não escondê-lo", async () => {
    const seu = "titulo: Minha\ncamadas:\n  - id: casa\n    itens:\n      - id: sala\n";
    await escrever(dataDir, `ontologia/${ARQUIVO}`, seu);
    const r = await rodar(ctx);
    expect(r.resumo.acao).toBe("preservado-arquivo-seu");
    expect(await readFile(manifestoAbs(), "utf8")).toBe(seu);
    expect(r.avisos.some((a) => a.includes("é seu") && a.includes(ARQUIVO))).toBe(true);

    // o gerado existia e você criou um .json: o `ambiente` escolheria o .yaml (o nosso) antes do seu
    await rm(manifestoAbs());
    await rodar(ctx);
    expect(existsSync(manifestoAbs())).toBe(true);
    await escrever(dataDir, "ontologia/ontologia.json", JSON.stringify({ camadas: [{ id: "x" }] }));
    const r2 = await rodar(ctx);
    expect(r2.resumo.acao).toBe("preservado-arquivo-seu");
    expect(existsSync(manifestoAbs())).toBe(false);
    expect(await readFile(path.join(dataDir, "ontologia", "ontologia.json"), "utf8")).toBe(JSON.stringify({ camadas: [{ id: "x" }] }));
  });

  it("cópia sua do gerado (.yml/.json, herdando gerado_por) é sua: nunca é apagada, nem sem DNA", async () => {
    await rodar(ctx);
    const copia = path.join(dataDir, "ontologia", "ontologia.json");
    const texto = JSON.stringify({ gerado_por: "populate:ontologia", camadas: [{ id: "minha" }] });
    await escrever(dataDir, "ontologia/ontologia.json", texto);
    const r = await rodar(ctx);
    expect(r.resumo.acao).toBe("preservado-arquivo-seu");
    expect(await readFile(copia, "utf8")).toBe(texto);

    await rm(path.join(repo, "knowledge"), { recursive: true, force: true });
    await rodar(ctx);
    expect(await readFile(copia, "utf8")).toBe(texto);
  });

  it("sem nenhum especialista com DNA: o manifesto gerado antes é removido e nada é inventado", async () => {
    await rodar(ctx);
    expect(existsSync(manifestoAbs())).toBe(true);
    await rm(path.join(repo, "knowledge"), { recursive: true, force: true });
    const r = await rodar(ctx);
    expect(r.resumo.acao).toBe("removido");
    expect(r.resumo.itens).toBe(0);
    expect(existsSync(manifestoAbs())).toBe(false);
    expect((await rodar(ctx)).resumo.acao).toBe("sem-dna");
  });

  it("voice-dna: vocabulary_transforms vira item; insight/chunk/source ids não ligam; lista sem mapeamento é avisada", async () => {
    await escrever(repo, "knowledge/external/dna/persons/pessoa-b/voice-dna.yaml", yaml({
      pessoa: "Pessoa B",
      signature_phrases: [{
        id: "VP-B-001", phrase: "Frase de B", context: "Contexto de B",
        // ids de trecho, fonte e insight que coincidem com um item existente (fil_001): continuam sem ligar
        chunk_ids: ["fil_001"], source_ids: ["fil_001"], insight_ids: ["fil_001"],
      }],
      vocabulary_transforms: [{ conceito_comum: "Revenda e upsell", transformacao: "second money", chunk_ids: ["ch_9"] }],
      outra_lista: [{ id: "X-1", texto: "algo" }],
      extraction_gaps: ["Lacuna em texto"],
    }));
    const r = await rodar(ctx);
    const cru = await lerManifesto();
    confereLeitor(cru);
    const voz = cru.camadas.find((c) => c.id === "voice-dna")!.itens.filter((i) => i.id.startsWith("pessoa-b/"));
    expect(voz.map((i) => i.id)).toEqual(["pessoa-b/VP-B-001", "pessoa-b/vocabulary_transforms-1"]);
    expect(voz[0].ligacoes).toEqual([{ camada: "especialistas", item: "pessoa-b", rotulo: "de" }]);
    expect(voz[0].dados).toEqual({ lista: "signature_phrases", chunk_ids: "fil_001", source_ids: "fil_001", insight_ids: "fil_001" });
    expect(voz[1]).toEqual({
      id: "pessoa-b/vocabulary_transforms-1",
      nome: "second money",
      descricao: "Revenda e upsell",
      fonte: "knowledge/external/dna/persons/pessoa-b/voice-dna.yaml#vocabulary_transforms-1",
      dados: { lista: "vocabulary_transforms", chunk_ids: "ch_9" },
      ligacoes: [{ camada: "especialistas", item: "pessoa-b", rotulo: "de" }],
    });
    expect(r.resumo.porEspecialista["pessoa-b"].itens["voice-dna"]).toBe(2);
    // a lista de mapas sem mapeamento fica fora e é avisada; a de textos (extraction_gaps) não é entrada
    expect(r.avisos.filter((a) => a.includes("não tem mapeamento"))).toEqual([
      "knowledge/external/dna/persons/pessoa-b/voice-dna.yaml: a lista outra_lista (1 entrada(s)) não tem mapeamento para a camada voice-dna: fora da ontologia",
    ]);
    expect(await readFile(manifestoAbs(), "utf8")).not.toContain("X-1");
  });

  it("tetos do leitor: itens, ligações, dados e textos acima do limite saem de forma determinística e contada", async () => {
    const g = "knowledge/external/dna/persons/grande";
    const extras = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`campo_${String(i + 1).padStart(2, "0")}`, `valor ${i + 1}`]));
    await escrever(repo, `${g}/filosofias.yaml`, yaml({
      entries: [{
        id: "fil_001",
        name: "😀".repeat(130),
        description: "a".repeat(2500),
        behavioral_pattern_id: "BP-G-001",
        ...extras,
      }],
    }));
    await escrever(repo, `${g}/heuristicas.yaml`, yaml({
      entries: Array.from({ length: 2100 }, (_, i) => ({ id: `heu_${i + 1}`, name: `Heurística ${i + 1}`, description: `Regra ${i + 1}` })),
    }));
    await escrever(repo, `${g}/behavioral-patterns.yaml`, yaml({ patterns: [{ id: "BP-G-001", pattern_name: "Padrão G", action: "Age" }] }));

    const r = await rodar(ctx);
    const cru = await lerManifesto();
    const o = confereLeitor(cru);
    const total = o.camadas.reduce((t, c) => t + c.itens.length, 0);
    expect(total).toBe(MAX_ITENS);
    expect(r.resumo.itens).toBe(MAX_ITENS);
    // 4 especialistas + 6 filosofias + 2100 heurísticas + 3 padrões + 1 valor + 4 de voz + 1 paradoxo
    expect(r.resumo.cortes.itens).toBe(4 + 6 + 2100 + 3 + 1 + 4 + 1 - MAX_ITENS);
    expect(r.resumo.porEspecialista.grande.cortados).toBe(2100 + 1 - (MAX_ITENS - 4 - 6));
    expect(cru.camadas.map((c) => c.id)).toEqual(["especialistas", "filosofias", "heuristicas"]);
    expect(r.avisos.some((a) => a.includes(`acima do teto de ${MAX_ITENS}`))).toBe(true);

    const f = cru.camadas.find((c) => c.id === "filosofias")!.itens.find((i) => i.id === "grande/fil_001")!;
    // a ligação para BP-G-001 existia, mas o alvo ficou fora: sai e é contada
    expect(f.ligacoes).toEqual([{ camada: "especialistas", item: "grande", rotulo: "de" }]);
    expect(r.resumo.cortes.ligacoes).toBe(1);
    expect(Object.keys(f.dados!)).toHaveLength(MAX_DADOS_POR_ITEM);
    // name (cortado no nome e fora da descrição: fica nos dados), behavioral_pattern_id e 60 campos
    expect(r.resumo.cortes.dados).toBe(62 - MAX_DADOS_POR_ITEM);
    expect([...f.descricao!]).toHaveLength(LIMITES.descricao);
    expect(f.descricao!.endsWith("…")).toBe(true);
    // corte por code point: o emoji não é partido ao meio
    expect(f.nome).toBe(`${"😀".repeat(LIMITES.rotulo - 1)}…`);
    expect(r.resumo.cortes.textos).toMatchObject({ descricao: 1 });
    expect(r.resumo.cortes.textos.nome).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------------------------------ Megabrain real */

const RAIZ_REAL = path.resolve(process.cwd(), "..", "..");
const TEM_MEGABRAIN_REAL =
  Boolean(sinaisDeMegabrain(RAIZ_REAL)) && existsSync(path.join(RAIZ_REAL, "knowledge", "external", "dna", "persons"));

describe.skipIf(!TEM_MEGABRAIN_REAL)("módulo ontologia — Megabrain real (somente leitura, saída em tmpdir)", () => {
  it("o leitor do app aceita o manifesto inteiro, com fonte existente em cada item e sem personal", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "populate-ontologia-real-"));
    try {
      const r = await rodar({ repoRoot: RAIZ_REAL, appRoot: path.resolve("."), dataDir, docs: [], excluded: [], opts: {}, resultados: {} });
      if (!r.resumo.itens) return; // Megabrain sem DNA: nada a conferir
      const cru = load(await readFile(path.join(dataDir, "ontologia", ARQUIVO), "utf8")) as ManifestoCru;
      const o = normalizarOntologia(cru)!;
      expect(o.descartes).toEqual({ itens: 0, ligacoes: 0 });
      expect(o.camadas.reduce((t, c) => t + c.itens.length, 0)).toBe(r.resumo.itens);
      expect(o.camadas.reduce((t, c) => t + c.itens.reduce((u, i) => u + i.ligacoes.length, 0), 0)).toBe(r.resumo.ligacoes);
      for (const c of cru.camadas) {
        for (const it of c.itens) {
          const arquivo = it.fonte!.split("#")[0];
          expect(arquivo).toMatch(/^knowledge\/(external|business)\//);
          expect(existsSync(path.join(RAIZ_REAL, arquivo)), it.fonte).toBe(true);
        }
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
