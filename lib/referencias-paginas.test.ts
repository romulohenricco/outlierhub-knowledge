import { describe, it, expect } from "vitest";
import { paginasDe } from "./referencias-paginas";
import type { ReferenciaPost } from "./referencias";

function post(extra: Partial<ReferenciaPost> = {}): ReferenciaPost {
  return {
    code: "x",
    user: "u",
    caption: "",
    igUrl: "https://x/",
    dir: "d",
    images: ["a.png", "b.png", "c.png"],
    videoIdx: [],
    colecoes: [],
    ...extra,
  };
}

describe("paginasDe", () => {
  it("post sem páginas vira um grupo só, sem título, com todas as imagens", () => {
    expect(paginasDe(post())).toEqual([
      {
        titulo: null,
        imagens: [
          { img: "a.png", idx: 1 },
          { img: "b.png", idx: 2 },
          { img: "c.png", idx: 3 },
        ],
      },
    ]);
  });

  it("cadastro com páginas agrupa as imagens e preserva o índice global", () => {
    const g = paginasDe(
      post({
        paginas: [
          { titulo: "Boards", igUrl: "https://x/boards", images: ["a.png"] },
          {
            titulo: "Chat",
            igUrl: "https://x/chat",
            images: ["b.png", "c.png"],
            preview: "http://127.0.0.1:1/chat",
          },
        ],
      }),
    );
    expect(g.map((p) => p.titulo)).toEqual(["Boards", "Chat"]);
    expect(g[1].imagens).toEqual([
      { img: "b.png", idx: 2 },
      { img: "c.png", idx: 3 },
    ]);
    expect(g[1].pagina?.preview).toBe("http://127.0.0.1:1/chat");
  });

  it("imagem citada na página mas ausente do post é descartada (não vira tile quebrado)", () => {
    const g = paginasDe(
      post({
        paginas: [
          { titulo: "P", igUrl: "", images: ["a.png", "fantasma.png"] },
        ],
      }),
    );
    expect(g[0].imagens.map((i) => i.img)).toEqual(["a.png"]);
  });

  it("imagem do post que nenhuma página cita não some: vai para um grupo final", () => {
    const g = paginasDe(
      post({ paginas: [{ titulo: "P", igUrl: "", images: ["a.png"] }] }),
    );
    expect(g.at(-1)).toEqual({
      titulo: "outras",
      imagens: [
        { img: "b.png", idx: 2 },
        { img: "c.png", idx: 3 },
      ],
    });
  });
});
