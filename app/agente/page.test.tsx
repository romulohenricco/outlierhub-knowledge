// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { limparCacheEcossistema } from "@/lib/ecosystem";
import { limparCacheMemoria } from "@/lib/brain/memoria";
import { Ecossistema } from "@/components/Ecossistema";
import AgentePage from "./page";

// o esbuild do vitest compila JSX no modo clássico (tsconfig usa "preserve")
(globalThis as { React?: unknown }).React = React;

const VARS = ["BILHON_ROOT", "BILHON_AGENTE_DIR", "BILHON_REGISTRO_ENTIDADES", "BILHON_BRAIN_ORG_JSON", "BILHON_BRAIN_STORE"] as const;
const antes: Record<string, string | undefined> = {};
let raiz: string;

/** Acha o elemento do tipo `tipo` na árvore devolvida pela page (server component). */
function acha(no: unknown, tipo: unknown): boolean {
  if (!no || typeof no !== "object") return false;
  const el = no as { type?: unknown; props?: { children?: unknown } };
  if (el.type === tipo) return true;
  const filhos = el.props?.children;
  return (Array.isArray(filhos) ? filhos : [filhos]).some((f) => acha(f, tipo));
}

beforeAll(() => {
  for (const v of VARS) antes[v] = process.env[v];
  raiz = mkdtempSync(path.join(tmpdir(), "agente-page-"));
});
beforeEach(() => {
  for (const v of VARS) delete process.env[v];
  process.env.BILHON_ROOT = raiz;
  process.env.BILHON_AGENTE_DIR = path.join(raiz, "agente");
  rmSync(path.join(raiz, "agente"), { recursive: true, force: true });
  limparCacheEcossistema();
  limparCacheMemoria();
});
afterAll(() => {
  rmSync(raiz, { recursive: true, force: true });
  for (const v of VARS) {
    if (antes[v] === undefined) delete process.env[v];
    else process.env[v] = antes[v];
  }
});

describe("/agente", () => {
  it("sem nenhuma configuração: abre com a explicação de como popular, sem erro", async () => {
    const html = renderToStaticMarkup(await AgentePage());
    expect(html).toContain("Nenhuma entidade carregada");
    expect(html).toContain("BILHON_BRAIN_ORG_JSON");
    expect(html).toContain("BILHON_BRAIN_STORE");
    expect(html).toContain("docs/agente-registro.md");
  });

  it("só com a organização (sem inventário): mostra o catálogo com as abas de visão", async () => {
    mkdirSync(path.join(raiz, "agente"), { recursive: true });
    writeFileSync(path.join(raiz, "agente", "organizacao.json"), JSON.stringify({ pilares: [{ id: "p", nome: "Pilar" }] }));
    expect(acha(await AgentePage(), Ecossistema)).toBe(true);
  });

  it("só com notas .md: também abre o catálogo", async () => {
    mkdirSync(path.join(raiz, "agente", "memoria"), { recursive: true });
    writeFileSync(path.join(raiz, "agente", "memoria", "a.md"), "um texto");
    expect(acha(await AgentePage(), Ecossistema)).toBe(true);
  });

  it("organização com JSON inválido não derruba a página", async () => {
    mkdirSync(path.join(raiz, "agente"), { recursive: true });
    writeFileSync(path.join(raiz, "agente", "organizacao.json"), "{ quebrado");
    const html = renderToStaticMarkup(await AgentePage());
    expect(html).toContain("Nenhuma entidade carregada");
    expect(html).toContain("ilegível ou inválida");
  });
});
