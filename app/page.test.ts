import { describe, it, expect } from "vitest";
import HomePage from "./page";

/** A raiz não tem conteúdo próprio: encaminha para /estante, onde a estante mora. */
describe("/", () => {
  it("encaminha para /estante", () => {
    let digest = "";
    try {
      HomePage();
    } catch (erro) {
      digest = String((erro as { digest?: string }).digest ?? "");
    }
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain("/estante");
  });
});
