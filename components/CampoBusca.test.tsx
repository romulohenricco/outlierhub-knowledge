// @vitest-environment node
/** Fumaça de renderização no servidor: o campo nasce com o valor do pai (mesmo HTML
 *  no servidor e no cliente) e repassa as props de input sem sobrescrever value. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampoBusca } from "./CampoBusca";

// o esbuild do vitest compila JSX no modo clássico (tsconfig usa "preserve"): React precisa estar no escopo
(globalThis as { React?: unknown }).React = React;

describe("CampoBusca (renderização no servidor)", () => {
  it("nasce com o valor do pai", () => {
    const html = renderToStaticMarkup(<CampoBusca valor="mente" aoMudar={() => {}} />);
    expect(html).toContain("<input");
    expect(html).toContain('value="mente"');
  });

  it("valor vazio renderiza campo vazio", () => {
    const html = renderToStaticMarkup(<CampoBusca valor="" aoMudar={() => {}} />);
    expect(html).toContain('value=""');
  });

  it("repassa placeholder, classe, aria, id, name e type", () => {
    const html = renderToStaticMarkup(
      <CampoBusca
        valor="x"
        aoMudar={() => {}}
        placeholder="Buscar"
        className="campo"
        aria-label="Buscar no acervo"
        id="busca"
        name="q"
        type="search"
      />,
    );
    expect(html).toContain('placeholder="Buscar"');
    expect(html).toContain('class="campo"');
    expect(html).toContain('aria-label="Buscar no acervo"');
    expect(html).toContain('id="busca"');
    expect(html).toContain('name="q"');
    expect(html).toContain('type="search"');
  });

  it("props extras não sobrescrevem o valor controlado", () => {
    const extras = { defaultValue: "outro", value: "outro" };
    const html = renderToStaticMarkup(<CampoBusca {...extras} valor="certo" aoMudar={() => {}} />);
    expect(html).toContain('value="certo"');
    expect(html).not.toContain("outro");
  });
});
