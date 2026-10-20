import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { bilhonRoot, caminhoBilhonPermitido, exigirCaminhoBilhon, lerEnv } from "./bilhon-paths";
import {
  aplicarMarcacaoDual,
  derivarProcedencia,
  getEcosystem,
  getFavoritosAgente,
  getOcultosAgente,
  limparCacheEcossistema,
  mapearRegistro,
  parseUso,
  setFavoritoAgente,
  setOcultoAgente,
} from "./ecosystem";

// Tudo roda numa raiz temporária própria: nenhum teste depende do volume, do
// diretório de trabalho nem de arquivos de configuração reais.
let raiz: string;
const criados: string[] = [];

/** Pasta temporária que o afterEach remove (inclusive junctions, sem seguir o destino). */
async function pastaTemp(prefixo: string) {
  const d = await mkdtemp(path.join(tmpdir(), prefixo));
  criados.push(d);
  return d;
}

beforeEach(async () => {
  raiz = await pastaTemp("eco-");
  vi.stubEnv("BILHON_ROOT", raiz);
  vi.stubEnv("BILHON_AGENTE_DIR", path.join(raiz, "estado"));
  // em branco = ausente: é assim que um .env copiado do exemplo chega ao processo
  for (const nome of ["BILHON_REGISTRO_ENTIDADES", "BILHON_REPOS_JSON", "BILHON_AGENTES_JSON", "BILHON_OWNERS_PROPRIOS"]) {
    vi.stubEnv(nome, "");
  }
  limparCacheEcossistema();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(criados.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const dentroDaRaiz = (...partes: string[]) => path.join(raiz, ...partes);

async function escrever(relativo: string, conteudo: unknown) {
  const arquivo = dentroDaRaiz(relativo);
  await mkdir(path.dirname(arquivo), { recursive: true });
  await writeFile(arquivo, typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo));
  return arquivo;
}

describe("contenção de caminhos", () => {
  it("variável em branco vale como ausente: a raiz padrão é o diretório do app", () => {
    vi.stubEnv("BILHON_ROOT", "");
    expect(lerEnv("BILHON_ROOT")).toBeUndefined();
    expect(bilhonRoot()).toBe(path.resolve(process.cwd()));
    vi.stubEnv("BILHON_ROOT", "   ");
    expect(bilhonRoot()).toBe(path.resolve(process.cwd()));
  });

  it("recusa junction que sai da raiz permitida, inclusive para destino novo", async () => {
    const externo = await pastaTemp("eco-externo-");
    await symlink(externo, dentroDaRaiz("ponte"), process.platform === "win32" ? "junction" : "dir");
    expect(caminhoBilhonPermitido(raiz)).toBe(true);
    expect(caminhoBilhonPermitido(externo)).toBe(false);
    expect(caminhoBilhonPermitido(path.join(raiz, "..", path.basename(externo)))).toBe(false);
    expect(caminhoBilhonPermitido(dentroDaRaiz("ponte"))).toBe(false);
    expect(caminhoBilhonPermitido(dentroDaRaiz("ponte", "novo.json"))).toBe(false);
  });

  it("aceita destino que ainda não existe, desde que o ancestral esteja na raiz", () => {
    expect(caminhoBilhonPermitido(dentroDaRaiz("pasta", "ainda", "nao", "existe.json"))).toBe(true);
    expect(exigirCaminhoBilhon(dentroDaRaiz("a", "b.json"))).toBe(dentroDaRaiz("a", "b.json"));
  });

  it("recusa vazio, UNC e qualquer caminho fora da raiz", () => {
    expect(caminhoBilhonPermitido("")).toBe(false);
    expect(caminhoBilhonPermitido("\\\\servidor\\dados")).toBe(false);
    expect(caminhoBilhonPermitido("//servidor/dados")).toBe(false);
    expect(caminhoBilhonPermitido(path.join(tmpdir(), "fora-da-raiz.json"))).toBe(false);
    expect(() => exigirCaminhoBilhon(path.join(tmpdir(), "fora-da-raiz.json"))).toThrow(/fora da raiz/);
  });
});

describe("registro de entidades", () => {
  it("sem registro configurado o inventário é vazio e não dá erro", async () => {
    const eco = await getEcosystem();
    expect(eco.entities).toEqual([]);
    expect(Object.values(eco.counts).every((n) => n === 0)).toBe(true);
    expect(eco.countsPorProcedencia).toEqual({ propria: 0, adotada: 0, terceiro: 0 });
    expect(eco.fontes?.find((f) => f.id === "registro")?.estado).toBe("nao-configurada");
  });

  it("preserva o rid como identidade e as relações; descarta o que não é entidade", () => {
    const entities = mapearRegistro([
      { api_name: "equipe", tipo: "squad", rid: "ext.squad.equipe", observed: ["agentes/equipe"] },
      { api_name: "dev", tipo: "agent", rid: "ext.agent.dev", squad: "equipe", observed: ["agentes/dev#perfil"] },
      { api_name: "sem-rid", tipo: "skill", observed: ["skills/sem-rid"] },
      { api_name: "pessoa", tipo: "pessoa", observed: ["agentes/pessoa"] },
      { api_name: "  ", tipo: "skill", observed: ["skills/vazio"] },
      { api_name: "fora", tipo: "skill", observed: [path.join(tmpdir(), "fora", "SKILL.md")] },
      { api_name: "sem-fonte", tipo: "skill" },
      "texto solto",
      null,
    ]);
    expect(entities.map((e) => e.id)).toEqual(["ext.squad.equipe", "ext.agent.dev", "skill:registro:sem-rid"]);
    expect(entities[1].squadId).toBe("ext.squad.equipe");
    expect(entities[1].path).toBe("agentes/dev");
    expect(entities[0].meta.rid).toBe("ext.squad.equipe");
    expect(entities[2].meta.rid).toBeNull();
    expect(entities.every((e) => e.procedencia === "propria")).toBe(true);
  });

  it("resolve caminho relativo pela raiz e aceita absoluto dentro dela", () => {
    const [relativo, absoluto] = mapearRegistro([
      { api_name: "a", tipo: "skill", observed: ["skills/a"] },
      { api_name: "b", tipo: "skill", observed: [dentroDaRaiz("skills", "b")] },
    ]);
    expect(relativo.path).toBe("skills/a");
    expect(absoluto.path).toBe("skills/b");
  });

  it("usa a primeira observação que está dentro da raiz", () => {
    const [e] = mapearRegistro([
      { api_name: "a", tipo: "skill", observed: [path.join(tmpdir(), "fora"), "skills/a"] },
    ]);
    expect(e.path).toBe("skills/a");
  });

  it("rid repetido não duplica a entidade: vale a primeira linha", () => {
    const entities = mapearRegistro([
      { api_name: "a", tipo: "skill", rid: "ext.1", observed: ["skills/a"] },
      { api_name: "b", tipo: "skill", rid: "ext.1", observed: ["skills/b"] },
    ]);
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("a");
  });

  it("lê YAML da variável de ambiente e conta por tipo e procedência", async () => {
    const registro = await escrever(
      "registro.yaml",
      [
        "entities:",
        "  - api_name: equipe",
        "    tipo: squad",
        "    rid: ext.squad.equipe",
        "    role: Time de exemplo",
        "    status: ativo",
        "    observed: [agentes/equipe]",
        "  - api_name: ferramenta",
        "    tipo: skill",
        "    procedencia: adotada",
        "    observed: [skills/ferramenta]",
      ].join("\n"),
    );
    vi.stubEnv("BILHON_REGISTRO_ENTIDADES", registro);
    const eco = await getEcosystem();
    expect(eco.entities.map((e) => e.nome)).toEqual(["equipe", "ferramenta"]);
    expect(eco.entities[0].descricao).toBe("Time de exemplo");
    expect(eco.entities[0].tags).toEqual(["ativo"]);
    expect(eco.counts.squad).toBe(1);
    expect(eco.counts.skill).toBe(1);
    expect(eco.countsPorProcedencia).toEqual({ propria: 1, adotada: 1, terceiro: 0 });
    // a quebra por procedência sempre soma o total do inventário
    expect(Object.values(eco.countsPorProcedencia).reduce((a, b) => a + b, 0)).toBe(eco.entities.length);
    expect(eco.fontes?.find((f) => f.id === "registro")?.estado).toBe("ok");
  });

  it("aceita JSON, inclusive a lista direto na raiz do arquivo", async () => {
    vi.stubEnv("BILHON_REGISTRO_ENTIDADES", await escrever("registro.json", [{ api_name: "a", tipo: "agent", observed: ["agentes/a"] }]));
    expect((await getEcosystem()).entities.map((e) => e.nome)).toEqual(["a"]);
  });

  it("diz por que uma fonte veio vazia: fora da raiz, inexistente, inválida", async () => {
    vi.stubEnv("BILHON_REGISTRO_ENTIDADES", path.join(tmpdir(), "registro-de-outro-lugar.yaml"));
    expect((await getEcosystem()).fontes?.find((f) => f.id === "registro")?.estado).toBe("fora-da-raiz");

    limparCacheEcossistema();
    vi.stubEnv("BILHON_REGISTRO_ENTIDADES", dentroDaRaiz("nao-existe.yaml"));
    expect((await getEcosystem()).fontes?.find((f) => f.id === "registro")?.estado).toBe("ausente");

    limparCacheEcossistema();
    vi.stubEnv("BILHON_REGISTRO_ENTIDADES", await escrever("quebrado.yaml", "entities: [\n  - {"));
    const eco = await getEcosystem();
    expect(eco.fontes?.find((f) => f.id === "registro")?.estado).toBe("invalida");
    expect(eco.entities).toEqual([]);
  });
});

describe("repos, itens espelhados e deduplicação", () => {
  it("lê repos.json e espelhos.json do estado local e liga workers ao squad", async () => {
    await escrever("estado/repos.json", [
      { slug: "app-a", path: "repos/app-a", owner: "acme", repo: "app-a", github: { description: "App A", html_url: "https://example.invalid/acme/app-a", stars: 3, language: "TypeScript" } },
      { slug: "fora", path: path.join(tmpdir(), "fora") },
      { path: "repos/sem-slug" },
    ]);
    await escrever("estado/espelhos.json", [
      { id: "sq1", type: "squad", name: "time", category: "ops", source_path: "espelho/time/squad.md", source_label: "docs" },
      { id: "w1", type: "agent", name: "trabalhador", owner_squad: "time", source_path: "espelho/time/w1.md", source_label: "docs" },
      { id: "ref1", type: "reference", name: "guia", source_path: "espelho/guia/SKILL.md", source_label: "docs" },
      { id: "x", type: "tipo-novo", name: "x", source_path: "espelho/x.md" },
    ]);
    const eco = await getEcosystem();
    const porNome = Object.fromEntries(eco.entities.map((e) => [e.name, e]));
    expect(Object.keys(porNome).sort()).toEqual(["app-a", "ref1", "sq1", "w1"]);
    expect(porNome["app-a"].nome).toBe("acme/app-a");
    expect(porNome["app-a"].origem).toBe("repos.json");
    expect(porNome["app-a"].meta.stars).toBe(3);
    expect(porNome.w1.kind).toBe("worker");
    expect(porNome.w1.squadId).toBe(porNome.sq1.id);
    expect(porNome.sq1.path).toBe("espelho/time");
    expect(porNome.ref1.procedencia).toBe("terceiro");
    expect(porNome.sq1.procedencia).toBe("propria");
  });

  it("espelho da mesma fonte de uma entidade do registro não aparece duas vezes", async () => {
    vi.stubEnv("BILHON_REGISTRO_ENTIDADES", await escrever("registro.json", { entities: [{ api_name: "ferramenta", tipo: "skill", rid: "ext.skill.ferramenta", observed: ["skills/ferramenta"] }] }));
    await escrever("estado/espelhos.json", [
      { id: "duplicada", type: "skill", name: "ferramenta", source_path: "skills/ferramenta/SKILL.md", source_label: "docs" },
      { id: "outra", type: "skill", name: "outra", source_path: "skills/outra/SKILL.md", source_label: "docs" },
    ]);
    const eco = await getEcosystem();
    expect(eco.entities.map((e) => e.name)).toEqual(["ferramenta", "outra"]);
    expect(eco.entities[0].id).toBe("ext.skill.ferramenta");
  });

  it("BILHON_REPOS_JSON e BILHON_AGENTES_JSON redirecionam as fontes, ainda dentro da raiz", async () => {
    vi.stubEnv("BILHON_REPOS_JSON", await escrever("outros/meus-repos.json", [{ slug: "r", path: "repos/r" }]));
    vi.stubEnv("BILHON_AGENTES_JSON", path.join(tmpdir(), "espelhos-de-fora.json"));
    const eco = await getEcosystem();
    expect(eco.entities.map((e) => e.name)).toEqual(["r"]);
    expect(eco.fontes?.find((f) => f.id === "espelhos")?.estado).toBe("fora-da-raiz");
  });

  it("sobrepõe a evidência de uso lida de uso.json pela identidade da entidade", async () => {
    vi.stubEnv("BILHON_REGISTRO_ENTIDADES", await escrever("registro.json", { entities: [{ api_name: "a", tipo: "skill", rid: "ext.a", observed: ["skills/a"] }] }));
    await escrever("estado/uso.json", { uso: { "ext.a": { status: "raro", eventos: 2, sinais: 1, fontes: ["log: 2"] }, "ext.b": { status: "frequente" } } });
    const eco = await getEcosystem();
    expect(eco.entities).toHaveLength(1);
    expect(eco.entities[0].uso?.status).toBe("raro");
    expect(eco.entities[0].uso?.fontes).toEqual(["log: 2"]);
  });

  it("parseUso exige status válido e completa o resto com zeros", () => {
    expect(parseUso(null)).toBeNull();
    expect(parseUso({ status: "inventado" })).toBeNull();
    expect(parseUso({ status: "sem-sinal" })).toMatchObject({ eventos: 0, sinais: 0, dias: 0, ultimo: null, ambiguo: false, tocada_por_teste: false, proveniencia: "atribuida", fontes: [] });
    expect(parseUso({ status: "raro", proveniencia: "incerta", tocada_por_teste: true })).toMatchObject({ proveniencia: "incerta", tocada_por_teste: true });
  });
});

describe("procedência", () => {
  it("sem informação contrária o item é próprio", () => {
    expect(derivarProcedencia()).toBe("propria");
    expect(derivarProcedencia({ owner: "qualquer" })).toBe("propria");
  });

  it("terceiro declarado vence qualquer outra regra", () => {
    expect(derivarProcedencia({ terceiroDeclarado: true, declarada: "propria", owner: "acme", owners: ["acme"] })).toBe("terceiro");
  });

  it("aceita só os três valores declarados na fonte", () => {
    expect(derivarProcedencia({ declarada: "adotada" })).toBe("adotada");
    expect(derivarProcedencia({ declarada: "terceiro" })).toBe("terceiro");
    expect(derivarProcedencia({ declarada: "inventada" })).toBe("propria");
    expect(derivarProcedencia({ declarada: 42 })).toBe("propria");
  });

  it("com owners próprios configurados, owner de fora é terceiro", () => {
    const owners = ["acme", "beta"];
    expect(derivarProcedencia({ owner: "Acme", owners })).toBe("propria");
    expect(derivarProcedencia({ owner: "outra-org", owners })).toBe("terceiro");
    expect(derivarProcedencia({ owner: null, owners })).toBe("propria");
    expect(derivarProcedencia({ owner: "outra-org", owners: [] })).toBe("propria");
  });

  it("a lista de owners vem de BILHON_OWNERS_PROPRIOS (CSV) quando não é passada", () => {
    vi.stubEnv("BILHON_OWNERS_PROPRIOS", " Acme , beta ,,");
    expect(derivarProcedencia({ owner: "beta" })).toBe("propria");
    expect(derivarProcedencia({ owner: "gama" })).toBe("terceiro");
    vi.stubEnv("BILHON_OWNERS_PROPRIOS", "");
    expect(derivarProcedencia({ owner: "gama" })).toBe("propria");
  });

  it("repo de owner fora da lista entra como terceiro no inventário", async () => {
    vi.stubEnv("BILHON_OWNERS_PROPRIOS", "acme");
    await escrever("estado/repos.json", [
      { slug: "meu", path: "repos/meu", owner: "acme" },
      { slug: "alheio", path: "repos/alheio", owner: "outra-org" },
    ]);
    const eco = await getEcosystem();
    expect(Object.fromEntries(eco.entities.map((e) => [e.name, e.procedencia]))).toEqual({ meu: "propria", alheio: "terceiro" });
    expect(eco.countsPorProcedencia).toEqual({ propria: 1, adotada: 0, terceiro: 1 });
  });
});

describe("favoritos e ocultos", () => {
  it("grava e desfaz favorito, apagando também a chave legada", async () => {
    await setFavoritoAgente("skill:registro:a", true, "skill:a");
    await setFavoritoAgente("skill:registro:b", true);
    expect(Object.keys(await getFavoritosAgente()).sort()).toEqual(["skill:registro:a", "skill:registro:b"]);
    const depois = await setFavoritoAgente("skill:registro:a", false, "skill:a");
    expect(Object.keys(depois)).toEqual(["skill:registro:b"]);
    expect(await getFavoritosAgente()).toEqual(depois);
  });

  it("oculto guarda o motivo e é independente dos favoritos", async () => {
    await setOcultoAgente("skill:registro:a", true, "duplicada");
    expect((await getOcultosAgente())["skill:registro:a"].motivo).toBe("duplicada");
    expect(await getFavoritosAgente()).toEqual({});
    await setOcultoAgente("skill:registro:a", false);
    expect(await getOcultosAgente()).toEqual({});
  });

  it("escritas concorrentes não perdem marcação (fila + troca atômica do arquivo)", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `skill:registro:s${i}`);
    await Promise.all(ids.map((id) => setFavoritoAgente(id, true)));
    expect(Object.keys(await getFavoritosAgente()).sort()).toEqual([...ids].sort());
    const bruto = await readFile(dentroDaRaiz("estado", "favoritos.json"), "utf8");
    expect(Object.keys(JSON.parse(bruto))).toHaveLength(25);
  });

  it("id que se chama __proto__ vira chave comum e não mexe no protótipo", () => {
    const next = aplicarMarcacaoDual<{ em: string }>({}, "__proto__", true, { em: "agora" });
    expect(Object.keys(next)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).em).toBeUndefined();
  });

  it("recusa identidade vazia ou grande demais", async () => {
    await expect(setFavoritoAgente("", true)).rejects.toThrow(/Identidade/);
    await expect(setFavoritoAgente("x".repeat(501), true)).rejects.toThrow(/Identidade/);
  });

  it("não sobrescreve estado corrompido", async () => {
    await escrever("estado/favoritos.json", "{invalido");
    await expect(setFavoritoAgente("skill:registro:a", true)).rejects.toThrow();
    await expect(getFavoritosAgente()).rejects.toThrow();
    expect(await readFile(dentroDaRaiz("estado", "favoritos.json"), "utf8")).toBe("{invalido");
  });

  it("recusa gravar estado fora da raiz", async () => {
    vi.stubEnv("BILHON_AGENTE_DIR", path.join(tmpdir(), "estado-de-fora"));
    await expect(setFavoritoAgente("skill:registro:a", true)).rejects.toThrow(/fora da raiz/);
  });
});
