import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * As quatro rotas de escrita das referências devolvem 400 (sem corpo) para corpo que não
 * é JSON, é `null` ou tem formato errado: quem escreve um script ou um agente enxerga o
 * erro como "meu pedido está errado", nunca como "o servidor falhou" (500). Nada é gravado.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "refs-corpo-"));
  vi.stubEnv("BILHON_REFERENCIAS_DIR", dir);
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const ROTAS = ["favorito", "antipattern", "anotar", "prompt-reverso"] as const;

async function chamar(rota: (typeof ROTAS)[number], corpo: string | undefined) {
  const { POST } = await import(`./${rota}/route`);
  return POST(
    new NextRequest(`http://127.0.0.1:3300/api/referencias/${rota}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: corpo,
    }),
  );
}

describe("rotas de escrita das referências com corpo inválido", () => {
  for (const rota of ROTAS) {
    it(`/${rota}: sem corpo, texto que não é JSON, null e tipos errados voltam 400`, async () => {
      for (const corpo of [undefined, "{ nao eh json", "null", "5", '"texto"', "[]", "{}", '{"code":5}', '{"code":""}']) {
        const res = await chamar(rota, corpo);
        expect(res.status, `${rota} ${String(corpo)}`).toBe(400);
        expect(await res.text()).toBe("");
      }
      expect(await readdir(dir)).toEqual([]); // nada foi gravado
    });
  }

  it("corpo válido continua funcionando (favorito grava e responde 200)", async () => {
    const res = await chamar("favorito", JSON.stringify({ code: "post-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).favoritos["post-1"]).toBeTruthy();
  });
});
