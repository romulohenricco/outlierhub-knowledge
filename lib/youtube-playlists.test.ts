import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILTRO_VAZIO,
  contar,
  duracaoHumana,
  faixaDuracao,
  filtrarVideos,
  idVideoValido,
  type Decisoes,
  type VideoYT,
} from "./youtube-playlists-filtro";
import { getYoutubePlaylists, setDecisoes } from "./youtube-playlists";

const v = (o: Partial<VideoYT> & { id: string }): VideoYT => ({
  titulo: "t",
  canal: "c",
  duracaoS: 300,
  views: "",
  publicado: "",
  url: "",
  playlists: ["P1"],
  categorias: ["tema-1"],
  palavras: [],
  ...o,
});

const VIDEOS = [
  v({ id: "aaaaaaaaaaa", titulo: "Guia completo de exemplo", canal: "Canal A", categorias: ["tema-1", "tema-2"], palavras: ["guia"] }),
  v({ id: "bbbbbbbbbbb", titulo: "Vídeo curto de exemplo", canal: "Canal B", categorias: ["tema-3"], playlists: ["P2"], duracaoS: 40 }),
  v({ id: "ccccccccccc", titulo: "Edição rápida", canal: "Canal A", categorias: ["tema-4"], duracaoS: 4000 }),
];

describe("filtrarVideos", () => {
  it("por padrão esconde os descartados e mostra o resto", () => {
    const d: Decisoes = { bbbbbbbbbbb: { status: "descartado", em: "x" } };
    expect(filtrarVideos(VIDEOS, d, FILTRO_VAZIO).map((x) => x.id)).toEqual(["aaaaaaaaaaa", "ccccccccccc"]);
  });

  it("status descartados e mantidos olham só a decisão", () => {
    const d: Decisoes = {
      bbbbbbbbbbb: { status: "descartado", em: "x" },
      ccccccccccc: { status: "manter", em: "x" },
    };
    expect(filtrarVideos(VIDEOS, d, { ...FILTRO_VAZIO, status: "descartados" }).map((x) => x.id)).toEqual(["bbbbbbbbbbb"]);
    expect(filtrarVideos(VIDEOS, d, { ...FILTRO_VAZIO, status: "mantidos" }).map((x) => x.id)).toEqual(["ccccccccccc"]);
    expect(filtrarVideos(VIDEOS, d, { ...FILTRO_VAZIO, status: "todos" })).toHaveLength(3);
  });

  it("categorias são OU; playlist/canal/palavra são E", () => {
    const f = { ...FILTRO_VAZIO, categorias: ["tema-1", "tema-3"] };
    expect(filtrarVideos(VIDEOS, {}, f).map((x) => x.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(filtrarVideos(VIDEOS, {}, { ...f, playlist: "P2" }).map((x) => x.id)).toEqual(["bbbbbbbbbbb"]);
    expect(filtrarVideos(VIDEOS, {}, { ...FILTRO_VAZIO, canal: "Canal A", palavra: "guia" }).map((x) => x.id)).toEqual(["aaaaaaaaaaa"]);
  });

  it("busca ignora acento e caixa, e olha título, canal e palavras-chave", () => {
    expect(filtrarVideos(VIDEOS, {}, { ...FILTRO_VAZIO, q: "EDICAO" }).map((x) => x.id)).toEqual(["ccccccccccc"]);
    expect(filtrarVideos(VIDEOS, {}, { ...FILTRO_VAZIO, q: "canal b" }).map((x) => x.id)).toEqual(["bbbbbbbbbbb"]);
    expect(filtrarVideos(VIDEOS, {}, { ...FILTRO_VAZIO, q: "guia" }).map((x) => x.id)).toEqual(["aaaaaaaaaaa"]);
  });

  it("fila de referências: só o que pediu referência E ainda não está em /referencias; mantidos inclui os dois", () => {
    const d: Decisoes = {
      aaaaaaaaaaa: { status: "referencia", em: "x" },
      bbbbbbbbbbb: { status: "referencia", em: "x" },
      ccccccccccc: { status: "manter", em: "x" },
    };
    const emRef = { bbbbbbbbbbb: { titulo: "t", comPrompt: true } };
    expect(filtrarVideos(VIDEOS, d, { ...FILTRO_VAZIO, status: "fila" }, emRef).map((x) => x.id)).toEqual(["aaaaaaaaaaa"]);
    expect(filtrarVideos(VIDEOS, d, { ...FILTRO_VAZIO, status: "mantidos" }, emRef)).toHaveLength(3);
    expect(filtrarVideos(VIDEOS, d, { ...FILTRO_VAZIO, status: "ativos" }, emRef)).toHaveLength(3);
  });

  it("faixas de duração", () => {
    expect([40, 60, 61, 599, 600, 1799, 1800].map(faixaDuracao)).toEqual(["short", "short", "curto", "curto", "medio", "medio", "longo"]);
    expect(filtrarVideos(VIDEOS, {}, { ...FILTRO_VAZIO, duracao: "longo" }).map((x) => x.id)).toEqual(["ccccccccccc"]);
  });
});

describe("utilitários", () => {
  it("duracaoHumana", () => {
    expect(duracaoHumana(0)).toBe("");
    expect(duracaoHumana(65)).toBe("1:05");
    expect(duracaoHumana(3725)).toBe("1:02:05");
  });

  it("idVideoValido aceita só 11 caracteres [A-Za-z0-9_-]", () => {
    expect(idVideoValido("abcdefghij_")).toBe(true);
    for (const s of ["", "curto", "abcdefghijkl", "abcdefghij/", "../etc/pwd", 12345678901, null]) {
      expect(idVideoValido(s), String(s)).toBe(false);
    }
  });

  it("contar ordena por frequência e ignora vazio", () => {
    expect(contar(VIDEOS, (x) => x.categorias)[0]).toEqual(["tema-1", 1]);
    expect(contar([{ k: ["a", "", "a"] }], (x) => x.k)).toEqual([["a", 2]]);
  });
});

describe("armazém das playlists (disco)", () => {
  let raiz: string;
  let dir: string;

  beforeEach(async () => {
    raiz = await mkdtemp(path.join(os.tmpdir(), "yt-pl-"));
    dir = path.join(raiz, "youtube-playlists");
    vi.stubEnv("BILHON_SOCIAL_DIR", raiz);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(raiz, { recursive: true, force: true });
  });

  async function comInventario() {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "videos.json"), JSON.stringify({ videos: VIDEOS }));
  }

  it("descarta, restaura e ignora id desconhecido ou malformado", async () => {
    await comInventario();
    const r = await setDecisoes(["aaaaaaaaaaa", "zzzzzzzzzzz", "../x", 42], "descartado");
    expect(r.aplicados).toEqual(["aaaaaaaaaaa"]);
    expect(r.ignorados).toBe(3);
    expect(JSON.parse(await readFile(path.join(dir, "decisoes.json"), "utf-8")).aaaaaaaaaaa.status).toBe("descartado");

    await setDecisoes(["aaaaaaaaaaa"], null);
    expect(JSON.parse(await readFile(path.join(dir, "decisoes.json"), "utf-8"))).toEqual({});
  });

  it("aceita o status referencia e o desfaz com null", async () => {
    await comInventario();
    await setDecisoes(["aaaaaaaaaaa"], "referencia");
    expect(JSON.parse(await readFile(path.join(dir, "decisoes.json"), "utf-8")).aaaaaaaaaaa.status).toBe("referencia");
    await setDecisoes(["aaaaaaaaaaa"], null);
    expect(JSON.parse(await readFile(path.join(dir, "decisoes.json"), "utf-8"))).toEqual({});
  });

  it("mutações concorrentes não perdem escrita", async () => {
    await comInventario();
    await Promise.all([
      setDecisoes(["aaaaaaaaaaa"], "descartado"),
      setDecisoes(["bbbbbbbbbbb"], "manter"),
      setDecisoes(["ccccccccccc"], "descartado"),
    ]);
    const d = JSON.parse(await readFile(path.join(dir, "decisoes.json"), "utf-8"));
    expect(Object.keys(d).sort()).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
  });

  it("getYoutubePlaylists devolve vazio sem quebrar quando não há coleta", async () => {
    const r = await getYoutubePlaylists();
    expect(r.videos).toEqual([]);
    expect(r.playlists).toEqual([]);
    expect(r.categorias).toEqual([]);
    expect(r.decisoes).toEqual({});
    expect(r.coletadoEm).toBeNull();
  });

  it("vídeo sem listas ganha listas vazias e id inválido é descartado", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "videos.json"), JSON.stringify({ videos: [{ id: "aaaaaaaaaaa" }, { id: "../x" }] }));
    const { videos } = await getYoutubePlaylists();
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ id: "aaaaaaaaaaa", playlists: [], categorias: [], palavras: [], titulo: "", duracaoS: 0 });
  });
});
