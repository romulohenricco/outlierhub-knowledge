import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { load as loadYaml } from "js-yaml";
import {
  EXEMPLO_ONTOLOGIA,
  MAX_CAMADAS,
  MAX_DADOS_POR_ITEM,
  MAX_ITENS,
  MAX_LIGACOES_POR_ITEM,
  MAX_REGRAS,
  getOntologia,
  normalizarOntologia,
} from "./ontologia";
import { montarGrafoOntologia } from "./ontologia-grafo";
import { layoutTree, type LayoutInput } from "./ontologia-layout";

// Arquivos sintéticos mínimos, criados só aqui dentro: o repositório não traz dado de ontologia.
const YAML_MINIMO = `
titulo: Mapa de teste
camadas:
  - id: c1
    rotulo: Camada 1
    itens:
      - { id: a, nome: Item A, status: ativo }
      - { id: b, nome: Item B, pai: a }
`;

describe("normalizarOntologia", () => {
  it("lê camadas, itens, pai, ligações, dados, cores e regras", () => {
    const o = normalizarOntologia({
      titulo: "Mapa",
      status_cores: { ativo: "#4ade80", ruim: "verde" },
      regras: [{ id: "r1", titulo: "Regra 1", descricao: "texto" }, { titulo: "sem id" }],
      camadas: [
        {
          id: "c1",
          rotulo: "Camada 1",
          descricao: "d",
          cor: "#abc",
          itens: [
            { id: "a", nome: "A", descricao: "da", status: "ativo", fonte: "x.md", dados: { chave: "valor", n: 3, ok: true, vazio: null } },
            { id: "b", pai: "a", ligacoes: [{ camada: "c2", item: "z", rotulo: "usa" }, { item: "a" }] },
          ],
        },
        { id: "c2", itens: [{ id: "z", nome: "Z" }] },
      ],
    });
    expect(o?.titulo).toBe("Mapa");
    expect(o?.statusCores).toEqual({ ativo: "#4ade80" });
    expect(o?.regras).toEqual([{ id: "r1", titulo: "Regra 1", descricao: "texto" }]);
    const [c1, c2] = o!.camadas;
    expect(c1).toMatchObject({ id: "c1", rotulo: "Camada 1", descricao: "d", cor: "#abc" });
    expect(c2).toEqual({ id: "c2", rotulo: "c2", itens: [{ id: "z", nome: "Z", ligacoes: [], dados: {} }] });
    expect(c1.itens[0].dados).toEqual({ chave: "valor", n: "3", ok: "true" });
    expect(c1.itens[0]).toMatchObject({ status: "ativo", fonte: "x.md", descricao: "da" });
    // sem nome, o id serve de nome; ligação sem camada vale na camada do próprio item
    expect(c1.itens[1]).toMatchObject({ nome: "b", pai: "a" });
    expect(c1.itens[1].ligacoes).toEqual([{ camada: "c2", item: "z", rotulo: "usa" }, { camada: "c1", item: "a" }]);
    expect(o?.descartes).toEqual({ itens: 0, ligacoes: 0 });
  });

  it("camada sem itens é mantida; id repetido e item sem id são descartados e contados", () => {
    const o = normalizarOntologia({
      camadas: [
        { id: "vazia" },
        { id: "vazia", itens: [{ id: "x" }] }, // camada repetida: some inteira
        { rotulo: "sem id" },
        { id: "c", itens: [{ id: "a", nome: "primeiro" }, { id: "a", nome: "repetido" }, { nome: "sem id" }, "texto", null] },
      ],
    });
    expect(o?.camadas.map((c) => c.id)).toEqual(["vazia", "c"]);
    expect(o?.camadas[0].itens).toEqual([]);
    expect(o?.camadas[1].itens.map((i) => i.nome)).toEqual(["primeiro"]);
    expect(o?.descartes.itens).toBe(4);
  });

  it("ligação quebrada (alvo ou camada inexistente, para si mesmo) é descartada e contada", () => {
    const o = normalizarOntologia({
      camadas: [
        {
          id: "c",
          itens: [
            { id: "a", ligacoes: [{ camada: "c", item: "b" }, { camada: "nao", item: "b" }, { camada: "c", item: "fantasma" }, { camada: "c", item: "a" }, "x", { rotulo: "sem alvo" }] },
            { id: "b" },
          ],
        },
      ],
    });
    expect(o?.camadas[0].itens[0].ligacoes).toEqual([{ camada: "c", item: "b" }]);
    expect(o?.descartes.ligacoes).toBe(5);
  });

  it("pai inexistente, de outra camada ou o próprio item é ignorado", () => {
    const o = normalizarOntologia({
      camadas: [
        { id: "c1", itens: [{ id: "a", pai: "a" }, { id: "b", pai: "fantasma" }, { id: "c", pai: "de-outra" }] },
        { id: "c2", itens: [{ id: "de-outra" }] },
      ],
    });
    expect(o?.camadas[0].itens.some((i) => i.pai)).toBe(false);
  });

  it("cores inválidas viram ausentes (só #RGB e #RRGGBB)", () => {
    const o = normalizarOntologia({
      status_cores: { a: "#fff", b: "red", c: "#12345", d: "url(javascript:x)", e: "#ABCDEF" },
      camadas: [{ id: "c1", cor: "red" }, { id: "c2", cor: "#fff; x" }, { id: "c3", cor: "#00ff00" }],
    });
    expect(o?.statusCores).toEqual({ a: "#fff", e: "#ABCDEF" });
    expect(o?.camadas.map((c) => c.cor)).toEqual([undefined, undefined, "#00ff00"]);
  });

  it("textos gigantes são cortados nos tetos", () => {
    const grande = "x".repeat(100_000);
    const o = normalizarOntologia({
      titulo: grande,
      camadas: [{ id: grande, rotulo: grande, descricao: grande, itens: [{ id: "a", nome: grande, descricao: grande, status: grande, fonte: grande, dados: { [grande]: grande } }] }],
      regras: [{ id: "r", titulo: grande, descricao: grande }],
    });
    expect(o!.titulo!.length).toBe(120);
    const c = o!.camadas[0];
    expect(c.id.length).toBe(120);
    expect(c.descricao!.length).toBe(2000);
    const it = c.itens[0];
    expect(it.nome.length).toBe(120);
    expect(it.status!.length).toBe(40);
    expect(it.fonte!.length).toBe(300);
    expect(it.descricao!.length).toBe(2000);
    const [chave, valor] = Object.entries(it.dados)[0];
    expect([chave.length, valor.length]).toEqual([80, 1000]);
    expect(o!.regras[0].descricao!.length).toBe(2000);
  });

  it("tetos de quantidade", () => {
    const camadas = Array.from({ length: MAX_CAMADAS + 10 }, (_, i) => ({ id: `c${i}` }));
    expect(normalizarOntologia({ camadas })?.camadas).toHaveLength(MAX_CAMADAS);

    const itens = Array.from({ length: MAX_ITENS + 5 }, (_, i) => ({ id: `i${i}` }));
    const o = normalizarOntologia({ camadas: [{ id: "c", itens }] });
    expect(o?.camadas[0].itens).toHaveLength(MAX_ITENS);
    expect(o?.descartes.itens).toBe(5);

    const dados = Object.fromEntries(Array.from({ length: MAX_DADOS_POR_ITEM + 10 }, (_, i) => [`k${i}`, "v"]));
    const ligacoes = Array.from({ length: MAX_LIGACOES_POR_ITEM + 10 }, () => ({ item: "b" }));
    const o2 = normalizarOntologia({ camadas: [{ id: "c", itens: [{ id: "a", dados, ligacoes }, { id: "b" }] }] });
    expect(Object.keys(o2!.camadas[0].itens[0].dados)).toHaveLength(MAX_DADOS_POR_ITEM);
    expect(o2!.camadas[0].itens[0].ligacoes).toHaveLength(MAX_LIGACOES_POR_ITEM);

    const regras = Array.from({ length: MAX_REGRAS + 10 }, (_, i) => ({ id: `r${i}` }));
    expect(normalizarOntologia({ camadas: [{ id: "c" }], regras })?.regras).toHaveLength(MAX_REGRAS);
  });

  it("chaves do protótipo não contaminam nada", () => {
    const o = normalizarOntologia(JSON.parse('{"camadas":[{"id":"c","itens":[{"id":"a","dados":{"__proto__":"x","constructor":"y"}}]}],"status_cores":{"__proto__":"#fff","constructor":"#000"}}'));
    expect(Object.keys(o!.camadas[0].itens[0].dados)).toEqual(["constructor"]);
    expect(Object.keys(o!.statusCores)).toEqual(["constructor"]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("devolve null quando não há camada válida — inclusive no formato antigo, sem `camadas`", () => {
    const antigo = {
      titulo: "Mapa",
      manifest: { version: "1", domains: ["a"], planes: [{ node: "p", path_real: "p/" }] },
      registry: { entities: [{ entity_id: "e", trust_tier: "T1" }] },
      placementGuard: { deny: [{ id: "z", zona: "z/" }] },
      taxonomies: { t: {} },
    };
    for (const v of [null, undefined, 42, "texto", [], {}, antigo, { camadas: [] }, { camadas: "x" }, { camadas: [{ rotulo: "sem id" }, null] }]) {
      expect(() => normalizarOntologia(v)).not.toThrow();
      expect(normalizarOntologia(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe("montarGrafoOntologia sobre dado ruim", () => {
  it("pai circular não trava o grafo nem o layout", () => {
    const o = normalizarOntologia({
      camadas: [{ id: "c", itens: [{ id: "a", pai: "b" }, { id: "b", pai: "c1" }, { id: "c1", pai: "a" }, { id: "x", pai: "a" }, { id: "ok" }] }],
    })!;
    const g = montarGrafoOntologia(o);
    const porId = new Map(g.nodes.map((n) => [n.id, n]));
    // todos os nós têm pai existente e a árvore tem uma raiz só
    for (const n of g.nodes) if (n.parent !== null) expect(porId.has(n.parent)).toBe(true);
    expect(g.nodes.filter((n) => n.parent === null)).toHaveLength(1);
    // membros do ciclo voltam para a camada; quem desemboca nele continua filho
    expect(porId.get("item:c/a")?.parent).toBe("camada:c");
    expect(porId.get("item:c/x")?.parent).toBe("item:c/a");
    // a árvore é percorrível (sem ciclo) e o layout termina
    const filhos = new Map<string, LayoutInput>();
    for (const n of g.nodes) filhos.set(n.id, { id: n.id, w: 10, h: 10, children: [] });
    for (const n of g.nodes) if (n.parent) filhos.get(n.parent)!.children.push(filhos.get(n.id)!);
    expect(layoutTree(filhos.get("raiz")!).positions.size).toBe(g.nodes.length);
  });

  it("ligação para nó que não existe mais é descartada pelo próprio grafo", () => {
    const o = normalizarOntologia({ camadas: [{ id: "c", itens: [{ id: "a", ligacoes: [{ item: "b" }] }, { id: "b" }] }] })!;
    o.camadas[0].itens.pop(); // simula arquivo incoerente que escapou do normalizador
    expect(montarGrafoOntologia(o).links).toEqual([]);
  });
});

describe("exemplos", () => {
  it("o exemplo do estado vazio é lido por inteiro", () => {
    const o = normalizarOntologia(loadYaml(EXEMPLO_ONTOLOGIA));
    expect(o?.camadas.map((c) => c.id)).toEqual(["camada-a", "camada-b"]);
    expect(o?.camadas[0].itens[1].pai).toBe("item-1");
    expect(o?.camadas[1].itens[0].ligacoes).toEqual([{ camada: "camada-a", item: "item-1", rotulo: "usa" }]);
    expect(o?.descartes).toEqual({ itens: 0, ligacoes: 0 });
  });

  it("o exemplo completo de docs/ontologia.md é lido por inteiro", async () => {
    const md = await readFile(path.join(process.cwd(), "docs", "ontologia.md"), "utf-8");
    const bloco = /```yaml\r?\n([\s\S]*?)```/.exec(md)?.[1];
    expect(bloco).toBeTruthy();
    const o = normalizarOntologia(loadYaml(bloco!));
    expect(o?.titulo).toBe("Minha ontologia");
    expect(o?.camadas.length).toBeGreaterThanOrEqual(2);
    expect(o?.camadas[0].cor).toBe("#5b8cff");
    expect(Object.keys(o!.statusCores)).toContain("ativo");
    expect(o?.regras).toHaveLength(1);
    const itens = o!.camadas.flatMap((c) => c.itens);
    expect(itens.some((i) => i.pai)).toBe(true);
    expect(itens.some((i) => i.ligacoes.length > 0)).toBe(true);
    expect(itens.some((i) => Object.keys(i.dados).length > 0)).toBe(true);
    expect(itens.some((i) => i.fonte)).toBe(true);
    // nada do exemplo é descartado: ele precisa ser válido do começo ao fim
    expect(o?.descartes).toEqual({ itens: 0, ligacoes: 0 });
  });
});

describe("getOntologia", () => {
  let raiz: string;
  beforeEach(async () => {
    raiz = await mkdtemp(path.join(tmpdir(), "onto-"));
    vi.stubEnv("BILHON_ROOT", raiz);
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", "");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(raiz, { recursive: true, force: true });
  });

  it("sem a variável: estado vazio, sem erro", async () => {
    expect(await getOntologia()).toEqual({ ontologia: null, estado: "nao-configurada", fonte: undefined });
  });

  it("variável em branco vale como ausente", async () => {
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", "   ");
    expect((await getOntologia()).estado).toBe("nao-configurada");
  });

  it("arquivo que não existe", async () => {
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", path.join(raiz, "nao-existe.yaml"));
    expect((await getOntologia()).estado).toBe("ausente");
  });

  it("arquivo fora de BILHON_ROOT é recusado", async () => {
    const fora = await mkdtemp(path.join(tmpdir(), "onto-fora-"));
    try {
      const arq = path.join(fora, "m.yaml");
      await writeFile(arq, YAML_MINIMO);
      vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", arq);
      const r = await getOntologia();
      expect(r.estado).toBe("fora-da-raiz");
      expect(r.ontologia).toBeNull();
    } finally {
      await rm(fora, { recursive: true, force: true });
    }
  });

  it("YAML inválido", async () => {
    const arq = path.join(raiz, "m.yaml");
    await writeFile(arq, "a: [fechou\n  b: : :");
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", arq);
    expect((await getOntologia()).estado).toBe("invalida");
  });

  it("arquivo lido mas sem `camadas`: estado vazio explicativo (formato antigo incluído)", async () => {
    const arq = path.join(raiz, "m.yaml");
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", arq);
    for (const conteudo of ["titulo: nada além do título\n", "manifest:\n  domains: [a]\n  planes:\n    - node: p\n"]) {
      await writeFile(arq, conteudo);
      const r = await getOntologia();
      expect(r.estado).toBe("vazia");
      expect(r.ontologia).toBeNull();
    }
  });

  it("lê YAML e JSON sintéticos pequenos", async () => {
    const y = path.join(raiz, "m.yaml");
    await writeFile(y, YAML_MINIMO);
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", y);
    const r = await getOntologia();
    expect(r.estado).toBe("ok");
    expect(r.fonte).toBe("m.yaml");
    expect(r.ontologia?.titulo).toBe("Mapa de teste");
    expect(montarGrafoOntologia(r.ontologia!).nodes.map((n) => n.id)).toEqual(["raiz", "camada:c1", "item:c1/a", "item:c1/b"]);

    const j = path.join(raiz, "m.json");
    await writeFile(j, JSON.stringify({ camadas: [{ id: "x" }] }));
    vi.stubEnv("BILHON_ONTOLOGIA_MANIFEST", j);
    expect((await getOntologia()).ontologia?.camadas[0].id).toBe("x");
  });
});
