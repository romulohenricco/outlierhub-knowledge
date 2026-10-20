import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Definição de Pronto (DoD) por tipo de card.
 *
 * O board tinha auto-conclusão (checklist 100% → done) mas nenhum critério na
 * mão contrária: `moverCard` levava qualquer card pra "done" com checklist
 * vazio. Como status não volta, fechar sem critério era irreversível e
 * silencioso. Estes testes travam o gate e a única saída dele (override com
 * motivo escrito, que fica no histórico).
 */

let dir: string;
let K: typeof import("./kanban");
let T: typeof import("./types");

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kanban-dod-"));
  process.env.BILHON_KANBAN_DIR = dir;
  vi.resetModules();
  K = await import("./kanban");
  T = await import("./types");
});

afterEach(async () => {
  delete process.env.BILHON_KANBAN_DIR;
  await rm(dir, { recursive: true, force: true });
});

/** Marca todos os itens da DoD do card como feitos. */
async function completarDoD(id: string) {
  const board = await K.getBoard();
  const card = board.cards.find((c) => c.id === id)!;
  const resultado = await K.atualizarCard(id, {
    checklist: card.checklist.map((i) => ({ ...i, feito: true })),
  });
  if (!resultado.ok) throw new Error(resultado.erro);
  return resultado.card;
}

describe("DoD — todo tipo tem definição de pronto", () => {
  it("cobre os 8 tipos, sem nenhum vazio", () => {
    const tipos: (typeof T.DOD_POR_TIPO extends Record<infer K, unknown> ? K : never)[] = [
      "ingest", "clone", "autolearning", "feature", "melhoria", "bug", "infra", "outro",
    ];
    for (const tipo of tipos) {
      expect(T.DOD_POR_TIPO[tipo], `tipo ${tipo} sem DoD`).toBeDefined();
      expect(T.DOD_POR_TIPO[tipo].length, `tipo ${tipo} com DoD vazia`).toBeGreaterThan(0);
    }
  });

  it("mantém o item de merge nos 4 tipos que mexem em código", () => {
    for (const tipo of T.TIPOS_COM_GATE_MERGE) {
      expect(T.DOD_POR_TIPO[tipo]).toContain(T.ITEM_GATE_MERGE);
    }
  });

  it("não exige merge de tipo que não mexe em código", () => {
    expect(T.DOD_POR_TIPO.ingest).not.toContain(T.ITEM_GATE_MERGE);
    expect(T.DOD_POR_TIPO.clone).not.toContain(T.ITEM_GATE_MERGE);
  });
});

describe("criarCard — injeta a DoD do tipo", () => {
  it("card novo nasce com a DoD inteira desmarcada", async () => {
    const card = await K.criarCard({ titulo: "teste", tipo: "bug" });
    expect(card.checklist.map((i) => i.texto)).toEqual(T.DOD_POR_TIPO.bug);
    expect(card.checklist.every((i) => !i.feito)).toBe(true);
  });

  it("preserva checklist informado e acrescenta o que falta da DoD", async () => {
    const card = await K.criarCard({
      titulo: "teste",
      tipo: "ingest",
      checklist: [{ texto: "baixar os 78 vídeos", feito: true }],
    });
    expect(card.checklist[0]).toEqual({ texto: "baixar os 78 vídeos", feito: true });
    for (const item of T.DOD_POR_TIPO.ingest) {
      expect(card.checklist.map((i) => i.texto)).toContain(item);
    }
  });

  it("não injeta DoD em card que já nasce fechado", async () => {
    const card = await K.criarCard({ titulo: "importado", tipo: "bug", coluna: "done" });
    expect(card.checklist).toEqual([]);
  });
});

describe("moverCard — gate de done", () => {
  it("recusa done com DoD incompleta e diz o que falta", async () => {
    const card = await K.criarCard({ titulo: "bug aberto", tipo: "bug" });
    const r = await K.moverCard(card.id, "done", 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("DoD incompleta");
    expect(r.faltando).toEqual(T.DOD_POR_TIPO.bug);
  });

  it("lista só os itens que faltam, não a DoD inteira", async () => {
    const card = await K.criarCard({ titulo: "bug parcial", tipo: "bug" });
    await K.atualizarCard(card.id, {
      checklist: card.checklist.map((i, n) => ({ ...i, feito: n === 0 })),
    });
    const r = await K.moverCard(card.id, "done", 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltando).toEqual(T.DOD_POR_TIPO.bug.slice(1));
  });

  it("deixa passar quando a DoD está completa", async () => {
    const card = await K.criarCard({ titulo: "bug pronto", tipo: "bug" });
    await completarDoD(card.id);
    const r = await K.moverCard(card.id, "done", 0);
    expect(r.ok).toBe(true);
  });

  it("não trava movimento que não é pra done", async () => {
    const card = await K.criarCard({ titulo: "bug em curso", tipo: "bug" });
    const r = await K.moverCard(card.id, "doing", 0);
    expect(r.ok).toBe(true);
  });

  it("cancel continua livre — é a saída do card abandonado", async () => {
    const card = await K.criarCard({ titulo: "bug morto", tipo: "bug" });
    const r = await K.moverCard(card.id, "cancel", 0);
    expect(r.ok).toBe(true);
  });

  it("vale pros tipos sem gate de merge também", async () => {
    const card = await K.criarCard({ titulo: "lote novo", tipo: "ingest" });
    const r = await K.moverCard(card.id, "done", 0);
    expect(r.ok).toBe(false);
  });
});

describe("moverCard — override com motivo", () => {
  it("fecha com DoD incompleta quando há motivo escrito", async () => {
    const card = await K.criarCard({ titulo: "hotfix", tipo: "bug" });
    const r = await K.moverCard(card.id, "done", 0, { override: "hotfix, DoD segue em BUG-99" });
    expect(r.ok).toBe(true);
  });

  it("registra o override no histórico do card", async () => {
    const card = await K.criarCard({ titulo: "hotfix", tipo: "bug" });
    const r = await K.moverCard(card.id, "done", 0, { override: "hotfix, DoD segue em BUG-99" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const entrada = r.card.historico.at(-1)!;
    expect(entrada.para).toBe("done");
    expect(entrada.nota).toContain("SEM DoD");
    expect(entrada.nota).toContain("hotfix, DoD segue em BUG-99");
  });

  it("recusa override vazio ou só espaço — motivo é obrigatório", async () => {
    const card = await K.criarCard({ titulo: "hotfix", tipo: "bug" });
    const r = await K.moverCard(card.id, "done", 0, { override: "   " });
    expect(r.ok).toBe(false);
  });
});

describe("auto-conclusão continua coerente com a DoD", () => {
  it("marcar a DoD inteira leva o card pra done sozinho", async () => {
    const card = await K.criarCard({ titulo: "bug pronto", tipo: "bug", coluna: "doing" });
    const atualizado = await completarDoD(card.id);
    expect(atualizado!.coluna).toBe("done");
  });
});
