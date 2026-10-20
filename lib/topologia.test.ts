/**
 * Testes da camada de topologia. Rodam contra um extrato SINTÉTICO escrito em tmp,
 * no formato que o extrator emite (envelope {gerado_em,versao,total,truncado} +
 * array nodes/edges). A pasta do extrato e a raiz permitida são a mesma pasta
 * temporária: nenhum teste depende de volume, de diretório de trabalho ou de dado real.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;

/** Caminho do nó sintético: resolvido pela plataforma, porque impactoDeMover compara com path.resolve
 *  (em Windows "/vol/a" vira "C:\vol\a"). */
const V = (...partes: string[]) => path.resolve(path.sep, "vol", ...partes);
const [A, B, C, LA] = [V("a"), V("b"), V("c"), V("la")];

/** Monta um extrato mínimo cobrindo os 7 tipos de aresta + 1 alvo morto +
 *  1 aresta com ponta órfã (dst que não existe em nodes.json). */
async function escreverExtrato() {
  const nodes = [
    { id: A, type: "repo", label: "a", path: A },
    { id: B, type: "skill", label: "b", path: B },
    { id: C, type: "script", label: "c", path: C },
    { id: "plano:alfa", type: "plano", label: "alfa" },
    { id: "plano:beta", type: "plano", label: "beta" },
    { id: "remote:origin", type: "remote", label: "origin" },
    { id: LA, type: "launchagent", label: "agendador.teste", path: LA },
  ];
  const edges = [
    { src: A, dst: B, type: "referencia", n: 9, escopo: "ativo", formas: { absoluto: 9 } },
    { src: B, dst: C, type: "referencia", n: 3, alvo_morto: true, escopo: "dado", formas: { absoluto: 3 } },
    // cadeia de 2 saltos: o agendador executa /vol/a, que referencia /vol/b
    { src: LA, dst: A, type: "executa", n: 1 },
    { src: A, dst: "remote:origin", type: "git_remote", n: 1 },
    { src: C, dst: A, type: "symlink", n: 1 },
    { src: B, dst: A, type: "executa", n: 2 },
    { src: C, dst: B, type: "ponte", n: 1 },
    { src: A, dst: C, type: "contem", n: 1 },
    // filiação de plano vive em ARESTA, não em campo do nó (é assim no formato do extrator)
    { src: A, dst: "plano:alfa", type: "pertence_a", n: 1 },
    { src: B, dst: "plano:alfa", type: "pertence_a", n: 1 },
    { src: C, dst: "plano:beta", type: "pertence_a", n: 1 },
    // ponta órfã: dst não está em nodes.json — deve sumir antes do cap
    { src: A, dst: V("inexistente"), type: "referencia", n: 99 },
  ];
  const env = { gerado_em: "2026-01-01T00:00:00", versao: "1.1.1", truncado: false };
  await writeFile(path.join(dir, "nodes.json"), JSON.stringify({ ...env, total: nodes.length, nodes }));
  await writeFile(path.join(dir, "edges.json"), JSON.stringify({ ...env, total: edges.length, edges }));
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "topo-test-"));
  // a pasta do extrato precisa estar dentro da raiz permitida
  vi.stubEnv("BILHON_ROOT", dir);
  vi.stubEnv("BILHON_TOPOLOGY_DIR", dir);
  await escreverExtrato();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

// a pasta do extrato é resolvida a cada chamada; o cache do módulo é limpo antes de cada uso
async function carregar() {
  const m = await import("./topologia");
  m.limparCacheTopologia();
  return m;
}

afterEach(async () => {
  const m = await import("./topologia");
  m.limparCacheTopologia();
});

describe("grafoTopologia", () => {
  it("por padrão traz só a rede de influência, sem hierarquia pura", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia();
    const tipos = new Set(g.edges.map((e) => e.tipoTopo));
    expect(tipos.has("referencia")).toBe(true);
    expect(tipos.has("symlink")).toBe(true);
    // contem/pertence_a inflam o canvas sem responder "o que quebra"
    expect(tipos.has("contem")).toBe(false);
    expect(tipos.has("pertence_a")).toBe(false);
  });

  it("descarta aresta com ponta desconhecida antes do cap", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia();
    // a aresta órfã tem n=99 (seria a 1ª na ordenação) — não pode aparecer
    expect(g.edges.some((e) => e.dst.endsWith("inexistente"))).toBe(false);
    expect(g.edges.every((e) => e.n_fontes <= 9)).toBe(true);
  });

  it("prefixa todos os IDs e nunca colide com o grafo de conhecimento", async () => {
    const { grafoTopologia, TOPO_PREFIXO } = await carregar();
    const g = await grafoTopologia();
    expect(g.nodes.length).toBeGreaterThan(0);
    for (const n of g.nodes) expect(n.id.startsWith(TOPO_PREFIXO)).toBe(true);
    for (const e of g.edges) {
      expect(e.src.startsWith(TOPO_PREFIXO)).toBe(true);
      expect(e.dst.startsWith(TOPO_PREFIXO)).toBe(true);
    }
    // prefixos do conhecimento (livro:/ref:/perfil:/col-ig:) não podem aparecer crus
    expect(g.nodes.some((n) => /^(livro|ref|perfil|col-ig):/.test(n.id))).toBe(false);
  });

  it("usa espaço de ID de aresta que não colide com sqlite nem com refs IG", async () => {
    const { grafoTopologia, TOPO_EDGE_ID_BASE } = await carregar();
    const g = await grafoTopologia();
    for (const e of g.edges) {
      expect(e.id).toBeLessThanOrEqual(TOPO_EDGE_ID_BASE);
      expect(e.id).toBeLessThan(-1000); // longe de -1,-2,… das refs IG
    }
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(g.edges.length);
  });

  it("marca camada em todo nó e aresta", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia();
    expect(g.nodes.every((n) => n.camada === "topologia")).toBe(true);
    expect(g.nodes.every((n) => n.tipo === "topologia")).toBe(true);
    expect(g.edges.every((e) => e.camada === "topologia")).toBe(true);
  });

  it("carrega alvo morto sem mentir no status", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia();
    const morta = g.edges.find((e) => e.alvoMorto);
    expect(morta).toBeDefined();
    // alvo quebrado != "disputed" (desacordo entre fontes) — e precisa passar
    // no filtro de status default (confirmed,claimed), senão sumiria do canvas
    expect(morta!.status).toBe("confirmed");
  });

  it("soMortas isola só as referências quebradas", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia({ soMortas: true });
    expect(g.edges.length).toBe(1);
    expect(g.edges[0].alvoMorto).toBe(true);
  });

  it("aceita tipos explícitos, inclusive os de hierarquia", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia({ tipos: ["contem", "pertence_a"] });
    expect(g.edges.length).toBe(4); // 1 contem + 3 pertence_a
    expect(g.edges.every((e) => ["contem", "pertence_a"].includes(e.tipoTopo!))).toBe(true);
  });

  it("reporta truncamento em vez de cortar em silêncio", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia({ maxEdges: 2 });
    expect(g.edges.length).toBe(2);
    expect(g.meta.truncado).toBe(true);
    expect(g.meta.arestasFiltradas).toBeGreaterThan(2);
    expect(g.meta.arestasMostradas).toBe(2);
    // corta pelas MAIS citadas primeiro (n desc = mais influente)
    expect(g.edges[0].n_fontes).toBe(9);

    const inteiro = await grafoTopologia();
    expect(inteiro.meta.truncado).toBe(false);
  });

  it("só inclui nós tocados pelas arestas escolhidas, com grau coerente", async () => {
    const { grafoTopologia, TOPO_PREFIXO } = await carregar();
    const g = await grafoTopologia({ maxEdges: 1 });
    // única aresta: /vol/a -> /vol/b
    expect(g.nodes.map((n) => n.id).sort()).toEqual(
      [`${TOPO_PREFIXO}${A}`, `${TOPO_PREFIXO}${B}`].sort(),
    );
    expect(g.nodes.every((n) => n.grau === 1)).toBe(true);
  });

  it("propaga versão e totais do extrato", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia();
    expect(g.meta.versao).toBe("1.1.1");
    expect(g.meta.geradoEm).toBe("2026-01-01T00:00:00");
    expect(g.meta.totalNos).toBe(7);
    expect(g.meta.totalArestas).toBe(12);
  });
});

/** Filtros. Só os que têm dado no extrato: plano (via `pertence_a`) e tipo de nó. */
describe("grafoTopologia — filtros", () => {
  it("filtra por plano usando a filiação vinda de pertence_a", async () => {
    const { grafoTopologia, TOPO_PREFIXO } = await carregar();
    const g = await grafoTopologia({ planos: ["alfa"] });
    // só /vol/a e /vol/b são do plano alfa → sobram as arestas entre os dois
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.has(`${TOPO_PREFIXO}${C}`)).toBe(false);
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.edges.every((e) => ids.has(e.src) && ids.has(e.dst))).toBe(true);
  });

  it("exige que as DUAS pontas passem no filtro", async () => {
    const { grafoTopologia } = await carregar();
    // /vol/c é o único do plano beta; sem par, nenhuma aresta de influência sobrevive
    const g = await grafoTopologia({ planos: ["beta"] });
    expect(g.edges.length).toBe(0);
    expect(g.nodes.length).toBe(0);
  });

  it("anexa o plano ao nó pra UI poder exibir", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia({ planos: ["alfa"] });
    expect(g.nodes.every((n) => n.plano === "alfa")).toBe(true);
  });

  it("filtra por tipo de nó", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia({ tiposNo: ["repo", "skill"] });
    expect(g.nodes.every((n) => ["repo", "skill"].includes(n.tipoTopo!))).toBe(true);
    expect(g.nodes.length).toBe(2);
    const so = await grafoTopologia({ tiposNo: ["engine"] });
    expect(so.edges.length).toBe(0); // não há engine no extrato sintético
  });

  it("combina filtros de plano e de tipo de nó", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia({ planos: ["alfa"], tiposNo: ["repo"] });
    // só /vol/a passa nos dois → sem par, zero aresta
    expect(g.edges.length).toBe(0);
  });

  it("expõe o vocabulário do extrato INTEIRO, não do recorte", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia({ planos: ["alfa"] });
    // mesmo filtrando por alfa, a UI precisa continuar oferecendo beta
    expect(g.meta.planosDisponiveis).toEqual(["alfa", "beta"]);
    expect(g.meta.tiposNoDisponiveis).toContain("plano");
    expect(g.meta.tiposNoDisponiveis).toContain("remote");
  });

  it("sem filtro, não descarta nó por não ter plano conhecido", async () => {
    const { grafoTopologia } = await carregar();
    const g = await grafoTopologia();
    // remote:origin não tem pertence_a; só pode sumir se houver filtro de plano
    expect(g.nodes.some((n) => n.tipoTopo === "remote")).toBe(true);
  });
});

/** Extrato ausente. Este teste é o que justifica o try/catch SEPARADO da camada
 *  de topologia em `/api/graph`: se ela lançasse dentro do try compartilhado, o
 *  grafo de conhecimento (obrigatório) morreria com 503 junto com a topologia
 *  (opcional) — e o extrato só existe se o usuário o gerar, então instalação nova cai aqui. */
describe("extrato ausente", () => {
  afterEach(() => {
    // volta para a pasta com o extrato sintético
    vi.stubEnv("BILHON_TOPOLOGY_DIR", dir);
  });

  it("lança (e a rota tem que capturar sem derrubar o resto)", async () => {
    vi.stubEnv("BILHON_TOPOLOGY_DIR", path.join(dir, "nao-existe"));
    const { grafoTopologia, limparCacheTopologia } = await import("./topologia");
    limparCacheTopologia();
    await expect(grafoTopologia()).rejects.toThrow();
  });

  it("impactoDeMover também lança, pelo mesmo motivo", async () => {
    vi.stubEnv("BILHON_TOPOLOGY_DIR", path.join(dir, "nao-existe"));
    const { impactoDeMover, limparCacheTopologia } = await import("./topologia");
    limparCacheTopologia();
    await expect(impactoDeMover("/qualquer")).rejects.toThrow();
  });

  it("pasta em branco vale como ausente: cai em data/topology, dentro da raiz", async () => {
    vi.stubEnv("BILHON_TOPOLOGY_DIR", "");
    vi.stubEnv("BILHON_ROOT", process.cwd());
    try {
      const { topologyDir } = await import("./topologia");
      expect(topologyDir()).toBe(path.join(process.cwd(), "data", "topology"));
    } finally {
      vi.stubEnv("BILHON_ROOT", dir);
    }
  });

  it("recusa pasta de extrato fora da raiz permitida", async () => {
    vi.stubEnv("BILHON_TOPOLOGY_DIR", path.join(path.dirname(dir), "extrato-de-fora"));
    const { topologyDir } = await import("./topologia");
    expect(() => topologyDir()).toThrow(/fora da raiz/);
  });
});

/** "Se eu mover X, o que quebra": ego-grafo reverso sobre a camada de topologia.
 *  Estes testes travam o comportamento sobre o extrato sintético. */
describe("impactoDeMover", () => {
  it("devolve null quando nenhum nó cobre o caminho", async () => {
    const { impactoDeMover } = await carregar();
    expect(await impactoDeMover(V("nao", "existe", "em", "lugar", "nenhum"))).toBeNull();
  });

  it("separa referência ATIVA (quebra) de DADO (só menciona)", async () => {
    const { impactoDeMover } = await carregar();
    const r = (await impactoDeMover(B))!;
    expect(r).not.toBeNull();
    // /vol/a -> /vol/b é ativo (n=9); nada de "dado" aponta pra /vol/b
    expect(r.ativo.ocorrencias).toBe(9);
    expect(r.ativo.arquivos).toBe(1);
    expect(r.ativo.formas).toEqual({ absoluto: 9 });
    expect(r.dado.ocorrencias).toBe(0);
  });

  it("ignora aresta interna ao próprio escopo", async () => {
    const { impactoDeMover } = await carregar();
    // /vol/b referencia /vol/c; olhando o impacto de /vol/b, essa é SAÍDA, não
    // entrada — mover /vol/b não quebra /vol/b
    const r = (await impactoDeMover(B))!;
    expect(r.topReferenciadores.every((t) => t.src !== B)).toBe(true);
  });

  it("acha o agendador a 2 saltos na cadeia", async () => {
    const { impactoDeMover } = await carregar();
    // agendador.teste executa /vol/a, e /vol/a referencia /vol/b (ativo)
    const r = (await impactoDeMover(B))!;
    expect(r.launchagents).toEqual(["agendador.teste"]);
  });

  it("não inventa agendador quando a ref é só DADO", async () => {
    const { impactoDeMover } = await carregar();
    // /vol/c só é referenciado por /vol/b com escopo "dado" → sem cadeia ativa
    const r = (await impactoDeMover(C))!;
    expect(r.dado.ocorrencias).toBe(3);
    expect(r.ativo.ocorrencias).toBe(0);
    expect(r.launchagents).toEqual([]);
  });

  it("inclui a subárvore no escopo, não só o path exato", async () => {
    const { impactoDeMover } = await carregar();
    const exato = (await impactoDeMover(B))!;
    const pai = (await impactoDeMover(V()))!;
    // "/vol" cobre a,b,c,la → mais nós no escopo que "/vol/b" sozinho
    expect(pai.nosNoEscopo).toBeGreaterThan(exato.nosNoEscopo);
  });

  it("coleta symlinks, pontes e git remotes que entram/saem", async () => {
    const { impactoDeMover } = await carregar();
    const r = (await impactoDeMover(A))!;
    // /vol/c -> /vol/a symlink (entra) · /vol/a -> remote:origin git_remote (sai)
    expect(r.symlinksEntrando.map((s) => s.src)).toEqual([C]);
    expect(r.gitRemotes.length).toBe(1);
  });
});
