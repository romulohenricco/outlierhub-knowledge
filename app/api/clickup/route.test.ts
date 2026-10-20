import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * A rota só LÊ um mapa JSON local (doc do corpus -> link/pasta/lista de uma
 * tarefa externa). Não chama nenhuma API e não usa credencial; sem o mapa a
 * resposta é vazia (503). Variável em branco vale como ausente.
 */

let dir: string;
let GET: (req: NextRequest) => Promise<Response>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "clickup-map-"));
  vi.resetModules();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const carregar = async () => {
  ({ GET } = await import("./route"));
};
const chamar = (doc?: string) =>
  GET(new NextRequest(`http://127.0.0.1:3300/api/clickup${doc === undefined ? "" : `?doc=${encodeURIComponent(doc)}`}`));

const ITEM = { url: "https://exemplo.invalid/t/1", pasta: "Pasta", lista: "Lista", nome: "Tarefa" };

describe("GET /api/clickup", () => {
  it("sem o parâmetro doc: 400", async () => {
    vi.stubEnv("BILHON_CLICKUP_MAP", path.join(dir, "mapa.json"));
    await carregar();
    expect((await chamar()).status).toBe(400);
  });

  it("sem mapa: 503 de corpo vazio", async () => {
    vi.stubEnv("BILHON_CLICKUP_MAP", path.join(dir, "nao-existe.json"));
    await carregar();
    const res = await chamar("cu-1.md");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("");
  });

  it("doc fora do mapa: 404; doc no mapa: 200 com o item", async () => {
    const mapa = path.join(dir, "mapa.json");
    await writeFile(mapa, JSON.stringify({ "cu-1.md": ITEM }));
    vi.stubEnv("BILHON_CLICKUP_MAP", mapa);
    await carregar();
    expect((await chamar("cu-2.md")).status).toBe(404);
    const res = await chamar("cu-1.md");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ITEM);
  });

  it("variável em branco cai no caminho padrão (data/kg, o mesmo do grafo) em vez de tentar ler ''", async () => {
    await mkdir(path.join(dir, "data", "kg"), { recursive: true });
    await writeFile(path.join(dir, "data", "kg", "clickup-map.json"), JSON.stringify({ "cu-1.md": ITEM }));
    vi.stubEnv("BILHON_CLICKUP_MAP", "");
    // o caminho padrão é resolvido no carregamento do módulo, a partir do cwd
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    await carregar();
    cwd.mockRestore();
    expect((await chamar("cu-1.md")).status).toBe(200);
  });
});
