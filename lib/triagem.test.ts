import { describe, expect, it } from "vitest";
import { contar, contarStatus, passaStatus, semAcento, statusValido, type DecisoesTriagem } from "./triagem";
import { lerCorpoTriagem, MAX_IDS_TRIAGEM } from "./triagem-corpo";

describe("triagem (regras comuns às redes)", () => {
  it("statusValido aceita os 3 status e null", () => {
    for (const x of ["descartado", "manter", "referencia", null]) expect(statusValido(x)).toBe(true);
    for (const x of ["", "fila", undefined, 1]) expect(statusValido(x)).toBe(false);
  });

  it("passaStatus", () => {
    expect(passaStatus("ativos", "descartado", false)).toBe(false);
    expect(passaStatus("ativos", undefined, false)).toBe(true);
    expect(passaStatus("fila", "referencia", true)).toBe(false);
    expect(passaStatus("fila", "referencia", false)).toBe(true);
    expect(passaStatus("todos", "descartado", false)).toBe(true);
  });

  it("pendentes = sem decisão e fora de /referencias; ja = já ingerido", () => {
    expect(passaStatus("pendentes", undefined, false)).toBe(true);
    expect(passaStatus("pendentes", undefined, true)).toBe(false); // já ingerido não espera triagem
    expect(passaStatus("pendentes", "manter", false)).toBe(false); // já decidido
    expect(passaStatus("ja", undefined, true)).toBe(true);
    expect(passaStatus("ja", undefined, false)).toBe(false);
  });

  it("contarStatus e contar", () => {
    const d: DecisoesTriagem = {
      a: { status: "descartado", em: "x" },
      b: { status: "referencia", em: "x" },
      c: { status: "referencia", em: "x" },
      d: { status: "manter", em: "x" },
    };
    // resolvidos = decididos {a,b,c,d} ∪ já ingeridos {c} → 4; sobram 6 pra triar
    expect(contarStatus(10, d, { c: {} })).toEqual({ ativos: 9, pendentes: 6, ja: 1, mantidos: 3, fila: 1, descartados: 1, todos: 10 });
    // ingerido sem decisão também sai de "a triar"
    expect(contarStatus(10, d, { z: {} }).pendentes).toBe(5);
    expect(contar([{ k: ["a", "", "a"] }], (x) => x.k)).toEqual([["a", 2]]);
  });

  it("sem inventário todos os contadores são zero", () => {
    expect(contarStatus(0, {}, {})).toEqual({ ativos: 0, pendentes: 0, ja: 0, mantidos: 0, fila: 0, descartados: 0, todos: 0 });
  });

  it("semAcento ignora acento e caixa", () => {
    expect(semAcento("Gestão de Agência")).toBe("gestao de agencia");
  });
});

describe("lerCorpoTriagem — corpo das rotas de decisão", () => {
  it("aceita ids + status válido (inclusive null)", () => {
    expect(lerCorpoTriagem({ ids: ["a"], status: "manter" })).toEqual({ ids: ["a"], status: "manter" });
    expect(lerCorpoTriagem({ ids: ["a"], status: null })).toEqual({ ids: ["a"], status: null });
  });

  it("recusa o que não é objeto, lista vazia, lista grande demais e status desconhecido", () => {
    for (const c of [null, undefined, "x", 3, [], { ids: [], status: "manter" }, { ids: "a", status: "manter" }, { ids: ["a"] }, { ids: ["a"], status: "fila" }]) {
      expect(lerCorpoTriagem(c), JSON.stringify(c)).toBeNull();
    }
    expect(lerCorpoTriagem({ ids: new Array(MAX_IDS_TRIAGEM + 1).fill("a"), status: "manter" })).toBeNull();
  });
});
