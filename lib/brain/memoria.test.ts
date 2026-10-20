// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_BYTES_ARQUIVO, limparCacheMemoria, lerMemoria, memoriaRaiz, montarMemoria } from "./memoria";

const arq = (rel: string, texto = "") => ({ rel, texto });

describe("montarMemoria", () => {
  const arquivos = [
    arq("memoria/a.md", "vê [[b]] e [[c|apelido]] e [[inexistente]]"),
    arq("memoria/b.md", "volta pra [[a#secao]]"),
    arq("agents/c.md", "link md [a](../memoria/a.md) e [x](https://x.com/y.md)"),
    arq("log-session/solta.md", "sem link nenhum"),
  ];
  const m = montarMemoria(arquivos, 100);

  it("hubs são as pastas de primeiro nível, com contagem real", () => {
    expect(m.hubs.map((h) => [h.nome, h.total]).sort()).toEqual([["agents", 1], ["log-session", 1], ["memoria", 2]]);
  });

  it("links vêm só de wikilinks e links .md relativos que resolvem; dedup e sem direção dupla", () => {
    const chaves = m.links.map(([a, b]) => [a, b].sort().join("|")).sort();
    expect(chaves).toEqual(["agents/c.md|memoria/a.md", "memoria/a.md|memoria/b.md"]);
  });

  it("conta link que não resolve e URL externa não conta como link", () => {
    expect(m.naoResolvidos).toBe(1); // [[inexistente]]
  });

  it("recorte: só notas conectadas, ordenadas por grau; solta fica fora mas entra em `total`", () => {
    expect(m.total).toBe(4);
    expect(m.conectadas).toBe(3);
    expect(m.notas.map((n) => n.id)).not.toContain("log-session/solta.md");
    expect(m.notas[0].id).toBe("memoria/a.md"); // grau 2 (b e c)
  });

  it("limite explícito corta as notas e os links deixam de apontar pra fora", () => {
    const c = montarMemoria(arquivos, 2);
    expect(c.notas).toHaveLength(2);
    const ids = new Set(c.notas.map((n) => n.id));
    for (const [a, b] of c.links) {
      expect(ids.has(a) && ids.has(b)).toBe(true);
    }
    expect(c.conectadas).toBe(3); // o total real não muda com o corte
  });

  it("não inventa: sem links, nenhuma nota desenhada", () => {
    const v = montarMemoria([arq("a/x.md", "nada"), arq("a/y.md", "nada")], 10);
    expect(v.notas).toEqual([]);
    expect(v.links).toEqual([]);
    expect(v.hubs[0]).toMatchObject({ nome: "a", total: 2 });
  });

  it("título vem do front matter `name`, senão do primeiro # , senão do nome do arquivo", () => {
    const t = montarMemoria(
      [
        arq("m/a.md", "---\nname: Nome do FM\n---\n[[b]]"),
        arq("m/b.md", "# Título H1\n[[a]]"),
        arq("m/c.md", "[[a]]"),
      ],
      10,
    );
    const por = Object.fromEntries(t.notas.map((n) => [n.id, n.titulo]));
    expect(por).toEqual({ "m/a.md": "Nome do FM", "m/b.md": "Título H1", "m/c.md": "c" });
  });
});

describe("lerMemoria", () => {
  const dirs: string[] = [];
  const anterior = { raiz: process.env.BILHON_ROOT, store: process.env.BILHON_BRAIN_STORE, agente: process.env.BILHON_AGENTE_DIR };
  let raiz: string;

  beforeAll(() => {
    raiz = mkdtempSync(path.join(tmpdir(), "mem-"));
    dirs.push(raiz);
    process.env.BILHON_ROOT = raiz;
    process.env.BILHON_AGENTE_DIR = path.join(raiz, "agente");
    delete process.env.BILHON_BRAIN_STORE;
  });
  beforeEach(() => limparCacheMemoria());
  afterAll(() => {
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
    for (const [k, v] of [["BILHON_ROOT", anterior.raiz], ["BILHON_BRAIN_STORE", anterior.store], ["BILHON_AGENTE_DIR", anterior.agente]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("padrão: pasta `memoria` dentro da pasta de estado; BILHON_BRAIN_STORE substitui; em branco vale como ausente", () => {
    expect(memoriaRaiz()).toBe(path.join(raiz, "agente", "memoria"));
    process.env.BILHON_BRAIN_STORE = "   ";
    expect(memoriaRaiz()).toBe(path.join(raiz, "agente", "memoria"));
    process.env.BILHON_BRAIN_STORE = path.join(raiz, "notas");
    expect(memoriaRaiz()).toBe(path.join(raiz, "notas"));
    delete process.env.BILHON_BRAIN_STORE;
  });

  it("pasta ausente: devolve null sem lançar", async () => {
    expect(await lerMemoria(path.join(raiz, "nao-existe"))).toBeNull();
    expect(await lerMemoria()).toBeNull();
  });

  it("lê .md das pastas, ignora outros arquivos e pastas ocultas", async () => {
    const d = path.join(raiz, "notas-a");
    mkdirSync(path.join(d, "memoria"), { recursive: true });
    mkdirSync(path.join(d, ".oculta"), { recursive: true });
    writeFileSync(path.join(d, "memoria", "a.md"), "[[b]]");
    writeFileSync(path.join(d, "memoria", "b.md"), "[[a]]");
    writeFileSync(path.join(d, "memoria", "img.png"), "x");
    writeFileSync(path.join(d, ".oculta", "c.md"), "[[a]]");
    const m = await lerMemoria(d);
    expect(m?.total).toBe(2);
    expect(m?.notas).toHaveLength(2);
  });

  it("pasta fora de BILHON_ROOT é recusada (null), mesmo com notas dentro", async () => {
    const fora = mkdtempSync(path.join(tmpdir(), "fora-"));
    dirs.push(fora);
    writeFileSync(path.join(fora, "a.md"), "[[b]]");
    writeFileSync(path.join(fora, "b.md"), "[[a]]");
    expect(await lerMemoria(fora)).toBeNull();
  });

  it("não segue link simbólico: nem de arquivo, nem de pasta", async () => {
    const fora = mkdtempSync(path.join(tmpdir(), "fora-"));
    dirs.push(fora);
    writeFileSync(path.join(fora, "segredo.md"), "[[a]]");
    const d = path.join(raiz, "notas-b");
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "a.md"), "texto");
    symlinkSync(path.join(fora, "segredo.md"), path.join(d, "elo.md"));
    symlinkSync(fora, path.join(d, "pasta-elo"));
    const m = await lerMemoria(d);
    expect(m?.total).toBe(1);
  });

  it("arquivo acima do teto de tamanho entra vazio (conta, mas sem link)", async () => {
    const d = path.join(raiz, "notas-c");
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "grande.md"), "[[a]]" + "x".repeat(MAX_BYTES_ARQUIVO));
    writeFileSync(path.join(d, "a.md"), "[[grande]]");
    const m = await lerMemoria(d);
    expect(m?.total).toBe(2);
    expect(m?.conectadas).toBe(2); // a → grande (o link sai de `a`); `grande` não foi lido
  });
});
