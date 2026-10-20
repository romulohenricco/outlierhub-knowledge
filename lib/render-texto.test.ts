import { describe, it, expect } from "vitest";
import { renderTexto } from "./render-texto";

describe("renderTexto — tabelas e fallback", () => {
  it("renderiza tabela markdown válida", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |";
    const html = renderTexto(md, "md");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("fix: linha |...| sem separador NÃO gruda no parágrafo seguinte", () => {
    const md = "a | b | c\n\nparágrafo seguinte";
    const html = renderTexto(md, "md");
    // as duas partes devem ser <p> distintos, não uma frase só
    expect(html).toContain("<p>a | b | c</p>");
    expect(html).toContain("<p>parágrafo seguinte</p>");
    expect(html).not.toContain("a | b | c parágrafo");
  });
});
