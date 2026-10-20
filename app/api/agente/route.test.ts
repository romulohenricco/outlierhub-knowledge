import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * A rota expõe o inventário que a página /agente já calculava. O contrato que
 * importa: `counts` é sempre o TOTAL do ecossistema, mesmo quando `entities`
 * vem filtrado — senão quem consome não sabe que está vendo um recorte.
 */

const ecoFake = {
  entities: [
    { id: "skill:registro:deploy", legacyId: "deploy", kind: "skill", namespace: "registro", name: "deploy", nome: "deploy-guard", descricao: "porta de deploy", origem: "registro", path: "skills/deploy-guard", procedencia: "propria", tags: ["core"], meta: {} },
    { id: "skill:espelho:docs:ingest", legacyId: "ingest", kind: "skill", namespace: "espelho:docs", name: "ingest", nome: "ingest", descricao: "ingestão", origem: "espelhos.json", path: "squads/ingest", procedencia: "adotada", tags: [], meta: {} },
    { id: "squad:espelho:docs:radar", legacyId: "radar", kind: "squad", namespace: "espelho:docs", name: "radar", nome: "radar", descricao: "tracking", origem: "espelhos.json", path: "squads/radar", procedencia: "terceiro", tags: [], meta: {} },
  ],
  counts: { skill: 2, squad: 1, agent: 0, workflow: 0, clone: 0, shadow: 0, worker: 0, engine: 0 },
  countsPorProcedencia: { propria: 1, adotada: 1, terceiro: 1 },
  geradoEm: "2026-01-01T00:00:00.000Z",
};

vi.mock("@/lib/ecosystem", () => ({
  getEcosystem: vi.fn(async () => ecoFake),
  PROCEDENCIAS: ["propria", "adotada", "terceiro"],
}));

let GET: (req: NextRequest) => Promise<Response>;
beforeEach(async () => {
  ({ GET } = await import("./route"));
});

const chamar = (qs = "") =>
  GET(new NextRequest(`http://127.0.0.1:3300/api/agente${qs}`));

describe("GET /api/agente", () => {
  it("devolve o inventário completo sem filtro", async () => {
    const body = await (await chamar()).json();
    expect(body.ok).toBe(true);
    expect(body.total).toBe(3);
    expect(body.retornados).toBe(3);
    expect(body.entities).toHaveLength(3);
  });

  it("filtra por kind", async () => {
    const body = await (await chamar("?kind=squad")).json();
    expect(body.retornados).toBe(1);
    expect(body.entities[0].kind).toBe("squad");
  });

  it("aceita múltiplos kinds separados por vírgula", async () => {
    const body = await (await chamar("?kind=skill,squad")).json();
    expect(body.retornados).toBe(3);
  });

  it("filtra por namespace", async () => {
    const body = await (await chamar("?namespace=registro")).json();
    expect(body.retornados).toBe(1);
    expect(body.entities[0].namespace).toBe("registro");
  });

  it("busca por texto em nome e descrição", async () => {
    expect((await (await chamar("?q=deploy")).json()).retornados).toBe(1);
    expect((await (await chamar("?q=ingest")).json()).retornados).toBe(1);
  });

  it("mantém counts do TOTAL mesmo com filtro — quem recorta precisa saber o tamanho do todo", async () => {
    const body = await (await chamar("?kind=squad")).json();
    expect(body.retornados).toBe(1);
    expect(body.total).toBe(3);
    expect(body.counts.skill).toBe(2);
  });

  it("filtro sem resultado devolve lista vazia, não erro", async () => {
    const body = await (await chamar("?kind=engine")).json();
    expect(body.ok).toBe(true);
    expect(body.entities).toEqual([]);
  });
});

/**
 * Filtro pelo eixo de admissão. O contrato de `counts` vale igual aqui:
 * `countsPorProcedencia` é sempre o TOTAL, nunca o do recorte.
 */
describe("GET /api/agente?procedencia=", () => {
  it("filtra por uma procedência", async () => {
    const body = await (await chamar("?procedencia=terceiro")).json();
    expect(body.entities.map((e: { name: string }) => e.name)).toEqual(["radar"]);
    expect(body.retornados).toBe(1);
  });

  it("aceita várias separadas por vírgula", async () => {
    const body = await (await chamar("?procedencia=propria,adotada")).json();
    expect(body.entities.map((e: { name: string }) => e.name)).toEqual(["deploy", "ingest"]);
  });

  it("valor inválido é ignorado, não quebra nem devolve vazio silencioso", async () => {
    const body = await (await chamar("?procedencia=inventado")).json();
    expect(body.retornados).toBe(3);
  });

  it("combina com kind — os filtros são conjuntivos", async () => {
    const body = await (await chamar("?kind=skill&procedencia=propria")).json();
    expect(body.entities.map((e: { name: string }) => e.name)).toEqual(["deploy"]);
  });

  it("countsPorProcedencia é o TOTAL mesmo com filtro aplicado", async () => {
    const body = await (await chamar("?procedencia=propria")).json();
    expect(body.retornados).toBe(1);
    expect(body.countsPorProcedencia).toEqual({ propria: 1, adotada: 1, terceiro: 1 });
    expect(body.total).toBe(3);
  });
});
