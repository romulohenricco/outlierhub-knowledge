// @vitest-environment node
/** Fumaça de renderização no servidor: o grafo abre sem erro com dado, só com
 *  inventário, só com notas e totalmente vazio (estado de partida do template). */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ORG, ent } from "@/lib/brain/fixtures-teste";
import { BRAIN_VAZIO, type BrainDados, type Memoria } from "@/lib/brain/tipos";
import { EcoSaude } from "../EcoSaude";
import { BrainGrafo } from "./BrainGrafo";

// o esbuild do vitest compila JSX no modo clássico (tsconfig usa "preserve"): React precisa estar no escopo
(globalThis as { React?: unknown }).React = React;

const sq = ent("squad", "equipes/a/squad");
const entidades = [sq, ent("worker", "equipes/a/w", sq.id), ent("skill", "equipes/a/s", sq.id), ent("repo", "repos/r")];
const mem: Memoria = {
  hubs: [{ id: "memoria", nome: "memoria", total: 2 }],
  notas: [
    { id: "memoria/a.md", titulo: "A", hub: "memoria", grau: 1, caminho: "memoria/a.md", palavras: 3, trecho: "texto" },
    { id: "memoria/b.md", titulo: "B", hub: "memoria", grau: 1, caminho: "memoria/b.md", palavras: 3, trecho: "texto" },
  ],
  links: [["memoria/a.md", "memoria/b.md"]],
  total: 2,
  conectadas: 2,
  naoResolvidos: 0,
};
const completo: BrainDados = { org: { ok: true, data: ORG, avisos: [] }, memoria: mem };

function grafo(brain: BrainDados, visao: "radial" | "neural", entities = entidades) {
  return renderToStaticMarkup(
    <BrainGrafo entities={entities} totalEntidades={entities.length} brain={brain} visao={visao} onAbrirCard={() => {}} filtroSquad={null} />,
  );
}

describe("BrainGrafo (renderização no servidor)", () => {
  it.each(["radial", "neural"] as const)("%s: com organização, inventário e notas", (v) => {
    const html = grafo(completo, v);
    expect(html).toContain('data-testid="brain-grafo"');
    expect(html).not.toContain("grafo-vazio");
    if (v === "radial") {
      expect(html).toContain("Pilar A");
      expect(html).toContain("Notas");
    } else {
      expect(html).toContain("EXECUTORES");
    }
  });

  it.each(["radial", "neural"] as const)("%s: tudo vazio mostra a explicação de como popular, sem erro", (v) => {
    const html = grafo(BRAIN_VAZIO, v, []);
    expect(html).toContain("grafo-vazio");
    expect(html).toContain("BILHON_BRAIN_ORG_JSON");
    expect(html).toContain("BILHON_BRAIN_STORE");
  });

  it("só inventário (sem organização nem notas): pilares por fonte, sem aviso de erro", () => {
    const html = grafo(BRAIN_VAZIO, "radial");
    expect(html).toContain("equipes");
    expect(html).not.toContain("indisponível");
  });

  it("organização inválida avisa; ausente não", () => {
    const invalida: BrainDados = { org: { ok: false, estado: "invalida", motivo: "JSON inválido ou ilegível" }, memoria: null };
    expect(grafo(invalida, "radial")).toContain("Organização indisponível");
    expect(grafo(BRAIN_VAZIO, "radial")).not.toContain("Organização indisponível");
  });
});

describe("EcoSaude (renderização no servidor)", () => {
  it("abre vazio e com dados", () => {
    expect(renderToStaticMarkup(<EcoSaude entities={[]} />)).toContain("Radar por tipo");
    expect(renderToStaticMarkup(<EcoSaude entities={entidades} />)).toContain("Núcleo");
  });
});
