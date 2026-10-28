import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Referencias } from "./Referencias";
import { LINK_INFO, LINK_TIPOS } from "./kanbanInfo";
import type { ReferenciaPost } from "@/lib/referencias";

/**
 * Renderiza de verdade os ícones das telas de referências e do kanban. Nenhum teste
 * fazia isso, e um ícone que some da biblioteca (o lucide-react 1.x tirou os ícones
 * de marca) só quebrava no navegador: "Element type is invalid … got: undefined".
 */

// O painel lateral é publicado num efeito (usePagePanel), que não roda no SSR:
// o mock guarda o nó publicado para o teste renderizar também.
const painel = vi.hoisted(() => ({ node: null as ReactNode }));
vi.mock("./PagePanel", () => ({
  PagePanelProvider: ({ children }: { children: ReactNode }) => children,
  usePagePanel: (node: ReactNode) => {
    painel.node = node;
  },
}));

const post = (code: string, plataforma: string, extra: Partial<ReferenciaPost> = {}): ReferenciaPost => ({
  code,
  user: `user-${code}`,
  caption: `legenda ${code}`,
  igUrl: `https://example.invalid/${code}`,
  dir: `dir-${code}`,
  images: [],
  videoIdx: [],
  colecoes: ["c1"],
  plataforma,
  ...extra,
});

describe("Referencias renderiza no servidor", () => {
  it("posts de instagram, youtube e linkedin, com o ícone de cada fonte", () => {
    const posts = [
      post("a1", "instagram"),
      post("b2", "youtube", { youtube: { videoId: "aaaaaaaaaaa", canal: "c", duracao: 125, views: 1000, publicadoEm: "2026-01-01" } }),
      post("c3", "linkedin"),
    ];
    const html = renderToStaticMarkup(
      h(Referencias, { posts, colecoes: [{ nome: "c1", n: 3 }], antipatterns: {}, favoritos: {}, baseDir: null }),
    );
    // linha de metadados do card do youtube
    expect(html).toContain("lucide-square-play");
    expect(html).toContain("2:05 · 1.000 views · 2026-01-01");

    // painel lateral: filtro de fontes com o ícone de cada plataforma
    expect(painel.node).not.toBeNull();
    const htmlPainel = renderToStaticMarkup(painel.node);
    expect(htmlPainel).toContain("lucide-camera");
    expect(htmlPainel).toContain("lucide-square-play");
    expect(htmlPainel).toContain("lucide-briefcase");
  });
});

describe("ícones de LINK_INFO (kanban)", () => {
  it("todo tipo de link tem ícone renderizável", () => {
    for (const t of LINK_TIPOS) {
      expect(LINK_INFO[t].Icon, t).toBeDefined();
      const html = renderToStaticMarkup(h(LINK_INFO[t].Icon, { size: 10 }));
      expect(html, t).toMatch(/^<svg/);
    }
  });

  it("as redes usam ícones genéricos no lugar dos de marca", () => {
    const esperado = {
      github: "git-branch",
      youtube: "square-play",
      instagram: "camera",
      x: "at-sign",
      linkedin: "briefcase",
    } as const;
    for (const [t, nome] of Object.entries(esperado)) {
      const html = renderToStaticMarkup(h(LINK_INFO[t as keyof typeof esperado].Icon));
      expect(html, t).toContain(`lucide-${nome}`);
    }
  });

  it("com role e aria-label (histórico do card) o ícone tem nome acessível", () => {
    for (const t of LINK_TIPOS) {
      const { Icon, rotulo } = LINK_INFO[t];
      const html = renderToStaticMarkup(h(Icon, { size: 10, role: "img", "aria-label": rotulo }));
      expect(html, t).toContain('role="img"');
      expect(html, t).toContain(`aria-label="${rotulo}"`);
      expect(html, t).not.toContain("aria-hidden");
    }
  });
});
