import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILTRO_IG_VAZIO, codeValido, filtrarSaves, type SaveIG } from "./instagram-saves-filtro";
import { capaPathFor, getInstagramSaves, setDecisoesSaves } from "./instagram-saves";
import type { DecisoesTriagem } from "./triagem";

const s = (o: Partial<SaveIG> & { code: string }): SaveIG => ({
  pk: "1",
  user: "conta-a",
  legenda: "",
  tipo: "foto",
  slides: 1,
  postadoEm: null,
  url: "",
  thumb: null,
  colecoes: [],
  categorias: ["tema-1"],
  palavras: [],
  coletadoEm: "2026-01-01T00:00:00Z",
  ...o,
});

const SAVES = [
  s({ code: "AAAAAAAAAAA", legenda: "Guia completo de exemplo", user: "conta-a", categorias: ["tema-1", "tema-2"], palavras: ["guia"], colecoes: ["Repositórios"] }),
  s({ code: "BBBBBBBBBBB", legenda: "Identidade visual de exemplo", user: "conta-b", categorias: ["tema-3"], tipo: "carrossel", slides: 5, colecoes: ["Design"] }),
  s({ code: "CCCCCCCCCCC", legenda: "Edição rápida", user: "conta-a", categorias: ["tema-4"], tipo: "reel" }),
];

describe("filtrarSaves", () => {
  it("por padrão esconde os descartados", () => {
    const d: DecisoesTriagem = { BBBBBBBBBBB: { status: "descartado", em: "x" } };
    expect(filtrarSaves(SAVES, d, FILTRO_IG_VAZIO).map((x) => x.code)).toEqual(["AAAAAAAAAAA", "CCCCCCCCCCC"]);
  });

  it("categorias são OU; coleção/conta/tipo/palavra são E", () => {
    const f = { ...FILTRO_IG_VAZIO, categorias: ["tema-1", "tema-3"] };
    expect(filtrarSaves(SAVES, {}, f).map((x) => x.code)).toEqual(["AAAAAAAAAAA", "BBBBBBBBBBB"]);
    expect(filtrarSaves(SAVES, {}, { ...f, colecao: "Design" }).map((x) => x.code)).toEqual(["BBBBBBBBBBB"]);
    expect(filtrarSaves(SAVES, {}, { ...FILTRO_IG_VAZIO, conta: "conta-a", tipo: "reel" }).map((x) => x.code)).toEqual(["CCCCCCCCCCC"]);
    expect(filtrarSaves(SAVES, {}, { ...FILTRO_IG_VAZIO, palavra: "guia" }).map((x) => x.code)).toEqual(["AAAAAAAAAAA"]);
  });

  it("busca ignora acento e caixa, e olha legenda, conta, palavras e coleções", () => {
    expect(filtrarSaves(SAVES, {}, { ...FILTRO_IG_VAZIO, q: "EDICAO" }).map((x) => x.code)).toEqual(["CCCCCCCCCCC"]);
    expect(filtrarSaves(SAVES, {}, { ...FILTRO_IG_VAZIO, q: "conta-b" }).map((x) => x.code)).toEqual(["BBBBBBBBBBB"]);
    expect(filtrarSaves(SAVES, {}, { ...FILTRO_IG_VAZIO, q: "repositorios" }).map((x) => x.code)).toEqual(["AAAAAAAAAAA"]);
  });

  it("fila = pediu referência E ainda não está em /referencias; mantidos inclui os dois", () => {
    const d: DecisoesTriagem = {
      AAAAAAAAAAA: { status: "referencia", em: "x" },
      BBBBBBBBBBB: { status: "referencia", em: "x" },
      CCCCCCCCCCC: { status: "manter", em: "x" },
    };
    const emRef = { BBBBBBBBBBB: { user: "conta-b", comPrompt: true } };
    expect(filtrarSaves(SAVES, d, { ...FILTRO_IG_VAZIO, status: "fila" }, emRef).map((x) => x.code)).toEqual(["AAAAAAAAAAA"]);
    expect(filtrarSaves(SAVES, d, { ...FILTRO_IG_VAZIO, status: "mantidos" }, emRef)).toHaveLength(3);
  });

  it("codeValido aceita só shortcode [A-Za-z0-9_-] de 5 a 20 caracteres", () => {
    expect(codeValido("AbCdEfGhIjK")).toBe(true);
    expect(codeValido("Ab-_cdEfg")).toBe(true);
    for (const x of ["", "abcd", "../etc/passwd", "a/b/c/d/e/f", "x".repeat(21), 12345678901, null]) {
      expect(codeValido(x), String(x)).toBe(false);
    }
  });
});

describe("armazém dos saves (disco)", () => {
  let dir: string;
  let raiz: string;

  beforeEach(async () => {
    raiz = await mkdtemp(path.join(os.tmpdir(), "ig-saves-"));
    dir = path.join(raiz, "instagram-saves");
    vi.stubEnv("BILHON_SOCIAL_DIR", raiz);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(raiz, { recursive: true, force: true });
  });

  async function comInventario() {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "saves.json"), JSON.stringify({ saves: SAVES }));
  }

  it("grava, desfaz e ignora code desconhecido ou malformado", async () => {
    await comInventario();
    const r = await setDecisoesSaves(["AAAAAAAAAAA", "ZZZZZZZZZZZ", "../x", 42], "referencia");
    expect(r.aplicados).toEqual(["AAAAAAAAAAA"]);
    expect(r.ignorados).toBe(3);
    expect(JSON.parse(await readFile(path.join(dir, "decisoes.json"), "utf-8")).AAAAAAAAAAA.status).toBe("referencia");
    await setDecisoesSaves(["AAAAAAAAAAA"], null);
    expect(JSON.parse(await readFile(path.join(dir, "decisoes.json"), "utf-8"))).toEqual({});
  });

  it("mutações concorrentes não perdem escrita", async () => {
    await comInventario();
    await Promise.all([
      setDecisoesSaves(["AAAAAAAAAAA"], "descartado"),
      setDecisoesSaves(["BBBBBBBBBBB"], "manter"),
      setDecisoesSaves(["CCCCCCCCCCC"], "descartado"),
    ]);
    const d = JSON.parse(await readFile(path.join(dir, "decisoes.json"), "utf-8"));
    expect(Object.keys(d).sort()).toEqual(["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"]);
  });

  it("sem inventário a triagem não cria nada em disco", async () => {
    const r = await setDecisoesSaves(["AAAAAAAAAAA"], "descartado");
    expect(r.aplicados).toEqual([]);
    expect(r.ignorados).toBe(1);
    expect(await readdir(raiz)).toEqual([]);
  });

  it("não grava fora da raiz: pasta da rede como symlink para fora é recusada", async () => {
    const fora = await mkdtemp(path.join(os.tmpdir(), "ig-saves-fora-"));
    try {
      await writeFile(path.join(fora, "saves.json"), JSON.stringify({ saves: SAVES }));
      await symlink(fora, dir);
      // o inventário "de fora" nem é lido, então nada é aplicado e nada é escrito lá
      const r = await setDecisoesSaves(["AAAAAAAAAAA"], "descartado");
      expect(r.aplicados).toEqual([]);
      expect(await readdir(fora)).toEqual(["saves.json"]);
    } finally {
      await rm(fora, { recursive: true, force: true });
    }
  });

  it("capaPathFor recusa escape e aceita só shortcode válido", () => {
    expect(capaPathFor("AAAAAAAAAAA")).toBe(path.join(dir, "thumbs", "AAAAAAAAAAA.jpg"));
    expect(capaPathFor("../../etc/passwd")).toBeNull();
    expect(capaPathFor("a/b")).toBeNull();
  });

  it("getInstagramSaves devolve vazio sem quebrar quando não há coleta (a pasta nem existe)", async () => {
    const r = await getInstagramSaves();
    expect(r.saves).toEqual([]);
    expect(r.categorias).toEqual([]);
    expect(r.decisoes).toEqual({});
    expect(r.coletadoEm).toBeNull();
    expect(r.emReferencias).toEqual({});
  });

  it("arquivo malformado vale como vazio e save sem listas ganha listas vazias", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "saves.json"), JSON.stringify({ saves: "não é lista" }));
    expect((await getInstagramSaves()).saves).toEqual([]);
    await writeFile(
      path.join(dir, "saves.json"),
      JSON.stringify({ saves: [{ code: "AAAAAAAAAAA", pk: "1", url: "" }, { code: "../x" }, null] }),
    );
    const { saves } = await getInstagramSaves();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ code: "AAAAAAAAAAA", categorias: [], palavras: [], colecoes: [], tipo: "foto", legenda: "" });
  });
});
