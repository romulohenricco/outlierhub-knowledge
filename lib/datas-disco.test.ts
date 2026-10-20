/** Data de nó do /grafo a partir do disco: contenção da raiz e degradação sem data. */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { datarTopologia, datasDoEcossistema, diaDoDisco, diaLocal, limparCacheDatas } from "./datas-disco";
import type { KgNode } from "./kg";
import type { EcoEntity } from "./types";

let base: string;
let raiz: string;
let fora: string;

const entidade = (id: string, p: string, extra: Partial<EcoEntity> = {}): EcoEntity =>
  ({ id, path: p, meta: {}, ...extra }) as unknown as EcoEntity;

beforeAll(() => {
  base = mkdtempSync(path.join(os.tmpdir(), "datas-disco-"));
  raiz = path.join(base, "raiz");
  fora = path.join(base, "fora");
  mkdirSync(path.join(raiz, "skills"), { recursive: true });
  mkdirSync(fora, { recursive: true });
  writeFileSync(path.join(raiz, "skills", "a.md"), "x");
  writeFileSync(path.join(fora, "segredo.md"), "x");
  utimesSync(path.join(raiz, "skills", "a.md"), new Date("2026-03-04T12:00:00"), new Date("2026-03-04T12:00:00"));
  utimesSync(path.join(fora, "segredo.md"), new Date("2026-03-04T12:00:00"), new Date("2026-03-04T12:00:00"));
  symlinkSync(fora, path.join(raiz, "atalho"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
beforeEach(() => limparCacheDatas());

describe("diaDoDisco", () => {
  it("devolve o dia local do mtime de um path dentro da raiz", async () => {
    expect(await diaDoDisco(path.join(raiz, "skills", "a.md"), raiz)).toBe("2026-03-04");
  });

  it("path inexistente fica sem data", async () => {
    expect(await diaDoDisco(path.join(raiz, "nao-existe.md"), raiz)).toBeNull();
  });

  it("path fora da raiz fica sem data, mesmo existindo", async () => {
    expect(await diaDoDisco(path.join(fora, "segredo.md"), raiz)).toBeNull();
  });

  it("symlink que escapa da raiz fica sem data", async () => {
    expect(await diaDoDisco(path.join(raiz, "atalho", "segredo.md"), raiz)).toBeNull();
  });
});

describe("datasDoEcossistema", () => {
  it("usa o sinal mais recente entre mtime, uso e push; relativo é resolvido na raiz", async () => {
    const m = await datasDoEcossistema(
      [
        entidade("e1", "skills/a.md"),
        entidade("e2", "skills/a.md", { uso: { ultimo: "2026-09-01" } as EcoEntity["uso"] }),
        entidade("e3", "nao-existe", { meta: { ultimo_push: "2026-05-06T10:00:00Z" } }),
        entidade("e4", "nao-existe"),
        entidade("e5", path.join(fora, "segredo.md")),
      ],
      raiz,
    );
    expect(m.get("e1")).toBe("2026-03-04");
    expect(m.get("e2")).toBe("2026-09-01");
    expect(m.get("e3")).toBe("2026-05-06");
    expect(m.has("e4")).toBe(false);
    expect(m.has("e5")).toBe(false);
  });
});

describe("datarTopologia", () => {
  it("nó sintético vira estrutural; nó com path dentro da raiz ganha data", async () => {
    const nos = [
      { id: "p", label: "p", tipo: "topologia", tipoTopo: "plano" },
      { id: "s", label: "s", tipo: "topologia", tipoTopo: "skill", path: path.join(raiz, "skills", "a.md") },
      { id: "x", label: "x", tipo: "topologia", tipoTopo: "arquivo", path: path.join(fora, "segredo.md") },
    ] as KgNode[];
    const r = await datarTopologia(nos, raiz);
    expect(r[0].estrutural).toBe(true);
    expect(r[1].data).toBe("2026-03-04");
    expect(r[2].data).toBeUndefined();
  });
});

describe("diaLocal", () => {
  it("formata o dia local com zeros", () => {
    expect(diaLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
