import path from "node:path";
import { describe, expect, it } from "vitest";
import { REFS_DIR, imagePathFor } from "./referencias";

describe("imagePathFor — trava de caminho das imagens de referência", () => {
  it("aceita nome com reticências (legenda real termina em '....jpg')", () => {
    const img = "Existe volta? Sim, mas....jpg";
    expect(imagePathFor("perfil__abc123", img)).toBe(path.join(REFS_DIR, "perfil__abc123", img));
  });

  it("recusa segmento .. e . (escape do diretório)", () => {
    expect(imagePathFor("..", "x.jpg")).toBeNull();
    expect(imagePathFor("dir", "..")).toBeNull();
    expect(imagePathFor(".", "x.jpg")).toBeNull();
  });

  it("recusa separador de caminho em qualquer lado", () => {
    expect(imagePathFor("dir", "../segredo.jpg")).toBeNull();
    expect(imagePathFor("a/b", "x.jpg")).toBeNull();
    expect(imagePathFor("a\\b", "x.jpg")).toBeNull();
    expect(imagePathFor("dir", "")).toBeNull();
  });
});
