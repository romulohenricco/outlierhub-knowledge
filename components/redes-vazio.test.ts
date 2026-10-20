import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PagePanelProvider } from "./PagePanel";
import { InstagramHub } from "./InstagramHub";
import { InstagramSaves } from "./InstagramSaves";
import { MySocialMedia } from "./MySocialMedia";
import { PerfilSocial } from "./PerfilSocial";
import { YoutubePlaylists } from "./YoutubePlaylists";
import type { ContaSocial } from "@/lib/social";
import type { VideoYT } from "@/lib/youtube-playlists-filtro";

/**
 * Sem nenhum dado as telas de redes renderizam sem erro e explicam o que colocar
 * (nada de caminho absoluto, nome de pessoa ou comando de um pipeline específico).
 */

const comPainel = (el: ReturnType<typeof h>) => renderToStaticMarkup(h(PagePanelProvider, null, el));
const PROGRESSO = { atualizadoEm: null, total: 0, comBio: 0, semBio: 0, porNicho: {} };

describe("estados vazios de /mysocialmedia", () => {
  it("saves: explica o arquivo esperado e a pasta de dados", () => {
    const html = comPainel(h(InstagramSaves, { coletadoEm: null, saves: [], categorias: [], decisoes: {}, emReferencias: {} }));
    expect(html).toContain("Nenhum save no inventário");
    expect(html).toContain("instagram-saves/saves.json");
    expect(html).toContain("BILHON_SOCIAL_DIR");
  });

  it("playlists: explica os arquivos esperados", () => {
    const html = comPainel(
      h(YoutubePlaylists, { coletadoEm: null, playlists: [], videos: [], categorias: [], decisoes: {}, emReferencias: {}, miniaturas: false }),
    );
    expect(html).toContain("Nenhuma playlist coletada ainda");
    expect(html).toContain("youtube-playlists/videos.json");
  });

  it("contas: explica o arquivo esperado", () => {
    const html = comPainel(h(MySocialMedia, { contas: [], progresso: PROGRESSO, rotulosNichos: {} }));
    expect(html).toContain("Nenhuma conta mapeada ainda");
    expect(html).toContain("instagram-contas/contas.json");
  });

  it("hub do Instagram abre vazio nas duas abas, sem data inventada", () => {
    for (const abaInicial of ["saves", "contas"] as const) {
      const html = comPainel(
        h(InstagramHub, {
          abaInicial,
          coletadoEm: null,
          saves: [],
          categorias: [],
          decisoes: {},
          emReferencias: {},
          contas: [],
          progresso: PROGRESSO,
          rotulosNichos: {},
        }),
      );
      expect(html).toContain("Saves · 0");
      expect(html).not.toContain("1970");
      expect(html).not.toContain("1969");
    }
  });

  it("perfil sem dossiê explica onde colocar", () => {
    const conta: ContaSocial = {
      username: "conta-a", nome: "", bio: "", seguidores: 1500, seguindo: null, posts: 0,
      negocio: false, categoria: null, privada: false, nichos: ["tema_um"], rede: "instagram",
    };
    const html = renderToStaticMarkup(h(PerfilSocial, { conta, dossie: null, rotulosNichos: { tema_um: "Tema um" } }));
    expect(html).toContain("Este perfil ainda não tem dossiê");
    expect(html).toContain("instagram-contas/perfis/conta-a/dossie.json");
    expect(html).toContain("Tema um");
    expect(html).toContain("1.5k");
  });

  it("link de dado com esquema perigoso não vira href", () => {
    const html = comPainel(
      h(InstagramSaves, {
        coletadoEm: null,
        categorias: [],
        decisoes: {},
        emReferencias: {},
        saves: [
          {
            code: "AAAAAAAAAAA", pk: "1", user: "conta-a", legenda: "x", tipo: "foto", slides: 1, postadoEm: null,
            url: "javascript:alert(1)", thumb: null, colecoes: [], categorias: [], palavras: [], coletadoEm: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    expect(html).not.toContain("javascript:");
  });
});

describe("miniaturas do YouTube só com a opção ligada", () => {
  const video: VideoYT = {
    id: "aaaaaaaaaaa", titulo: "t", canal: "c", duracaoS: 60, views: "", publicado: "", url: "https://example.invalid/v",
    playlists: ["P1"], categorias: [], palavras: [],
  };
  const playlist = {
    id: "P1", nome: "Lista", url: "https://example.invalid/l", visibilidade: "privada" as const, origem: "propria" as const,
    criador: null, sistema: null, esperados: 1, coletados: 1,
  };
  const render = (miniaturas: boolean) =>
    comPainel(
      h(YoutubePlaylists, { coletadoEm: null, playlists: [playlist], videos: [video], categorias: [], decisoes: {}, emReferencias: {}, miniaturas }),
    );

  it("desligado (padrão), nenhuma imagem é pedida a servidor de terceiros", () => {
    expect(render(false)).not.toContain("ytimg.com");
  });

  it("ligado, o cartão pede a miniatura", () => {
    expect(render(true)).toContain("ytimg.com/vi/aaaaaaaaaaa");
  });
});

describe("páginas do servidor sem configuração", () => {
  let raiz: string;
  beforeEach(async () => {
    raiz = await mkdtemp(path.join(os.tmpdir(), "social-paginas-"));
    vi.stubEnv("BILHON_SOCIAL_DIR", raiz);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(raiz, { recursive: true, force: true });
  });

  it("a página inicial abre vazia e diz o que colocar", async () => {
    const { default: Pagina } = await import("@/app/mysocialmedia/page");
    const html = renderToStaticMarkup(await Pagina());
    expect(html).toContain("Nada nas redes ainda");
    expect(html).toContain("instagram-saves/saves.json");
    // a tela não mostra caminho absoluto da máquina
    expect(html).not.toContain(raiz);
    expect(html).not.toContain(process.cwd());
  });

  it("instagram e youtube abrem vazios", async () => {
    const ig = await import("@/app/mysocialmedia/instagram/page");
    const yt = await import("@/app/mysocialmedia/youtube/page");
    const htmlIg = comPainel(await ig.default({ searchParams: Promise.resolve({}) }));
    const htmlYt = comPainel(await yt.default());
    expect(htmlIg).toContain("Nenhum save no inventário");
    expect(htmlYt).toContain("Nenhuma playlist coletada ainda");
  });
});
