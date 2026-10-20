import { describe, it, expect } from "vitest";
import { calcularFanOut, estaBloqueada, estimarTokens, ordenarParaLote, pontuarTicket } from "./kanbanLote";
import type { KanbanCard, KanbanExecucao, KanbanPrioridade } from "./types";

/** Fabrica um KanbanCard mínimo válido — só os campos que os testes variam
 *  precisam ser passados, o resto é preenchido com defaults neutros. */
function card(
  id: string,
  overrides: Partial<{
    tags: string[];
    execucao: KanbanExecucao | null;
    prioridade: KanbanPrioridade;
    coluna: string;
  }> = {},
): KanbanCard {
  return {
    id,
    titulo: `ticket ${id}`,
    descricao: "",
    tipo: "bug",
    prioridade: overrides.prioridade ?? "media",
    projeto: "geral",
    coluna: (overrides.coluna ?? "todo") as KanbanCard["coluna"],
    ordem: 0,
    responsavel: null,
    tags: overrides.tags ?? [],
    origem: { canal: null, pedidoOriginal: null, solicitadoPor: null },
    ingestao: { fonteTipo: [], fonteUrl: [], fontePath: [], bucket: null, pessoaAutor: null },
    links: [],
    vinculos: [],
    audios: [],
    imagens: [],
    checklist: [],
    historico: [],
    execucao: overrides.execucao !== undefined ? overrides.execucao : { modo: "agente" },
    criadoEm: "2026-08-01T00:00:00.000Z",
    atualizadoEm: "2026-08-01T00:00:00.000Z",
    concluidoEm: null,
  };
}

describe("estaBloqueada", () => {
  it("true quando tem tag blocked:*", () => {
    expect(estaBloqueada(card("BUG-1", { tags: ["blocked:human-gate"] }))).toBe(true);
  });

  it("true quando tem tag blocked-by:*", () => {
    expect(estaBloqueada(card("BUG-1", { tags: ["blocked-by:BUG-2"] }))).toBe(true);
  });

  it("true quando tem gate:humano ou gate:human", () => {
    expect(estaBloqueada(card("BUG-1", { tags: ["gate:humano"] }))).toBe(true);
    expect(estaBloqueada(card("BUG-2", { tags: ["gate:human"] }))).toBe(true);
  });

  it("false pra gate:semantics (não é gate humano)", () => {
    expect(estaBloqueada(card("BUG-1", { tags: ["gate:semantics"] }))).toBe(false);
  });

  it("true pra tag solta 'bloqueado' (formato legado, sem prefixo)", () => {
    expect(estaBloqueada(card("BUG-9", { tags: ["bloqueado"] }))).toBe(true);
  });

  it("false pra audit:environment-blocked — contém 'blocked' mas é outro prefixo (audit:, não blocked:)", () => {
    expect(estaBloqueada(card("BUG-1", { tags: ["audit:environment-blocked"] }))).toBe(false);
  });

  it("false sem tags de bloqueio", () => {
    expect(estaBloqueada(card("BUG-1", { tags: ["size:P", "nivel:task"] }))).toBe(false);
  });
});

describe("calcularFanOut", () => {
  it("conta quantos outros tickets têm blocked-by:<id>", () => {
    const cards = [
      card("BUG-1"),
      card("BUG-2", { tags: ["blocked-by:BUG-1"] }),
      card("BUG-3", { tags: ["blocked-by:BUG-1"] }),
      card("BUG-4", { tags: ["blocked-by:BUG-2"] }),
    ];
    const mapa = calcularFanOut(cards);
    expect(mapa.get("BUG-1")).toBe(2);
    expect(mapa.get("BUG-2")).toBe(1);
    expect(mapa.get("BUG-3")).toBeUndefined();
  });

  it("é case-insensitive no id referenciado", () => {
    const cards = [card("BUG-1"), card("BUG-2", { tags: ["blocked-by:bug-1"] })];
    expect(calcularFanOut(cards).get("BUG-1")).toBe(1);
  });
});

describe("pontuarTicket", () => {
  it("ticket agente + pequeno + sem bloqueio pontua melhor (menor) que humano + grande + bloqueado", () => {
    const facil = card("BUG-1", { tags: ["size:P", "nivel:task"], execucao: { modo: "agente" } });
    const dificil = card("BUG-2", {
      tags: ["size:G", "nivel:epic", "blocked:human-decision"],
      execucao: { modo: "humano" },
    });
    const fanOut = new Map<string, number>();
    expect(pontuarTicket(facil, fanOut)).toBeLessThan(pontuarTicket(dificil, fanOut));
  });

  it("bloqueio pesa mais que qualquer diferença de tamanho/execução", () => {
    const bloqueadoMasFacil = card("BUG-1", {
      tags: ["size:P", "nivel:task", "blocked:human-gate"],
      execucao: { modo: "agente" },
    });
    const livreMasGrande = card("BUG-2", { tags: ["size:G", "nivel:epic"], execucao: { modo: "misto" } });
    const fanOut = new Map<string, number>();
    expect(pontuarTicket(bloqueadoMasFacil, fanOut)).toBeGreaterThan(pontuarTicket(livreMasGrande, fanOut));
  });

  it("fan-out alto melhora (reduz) o score mesmo sem mudar tamanho/execução", () => {
    const semFanOut = card("BUG-1", { tags: ["size:M", "nivel:task"] });
    const comFanOut = card("BUG-2", { tags: ["size:M", "nivel:task"] });
    const fanOut = new Map([["BUG-2", 3]]);
    expect(pontuarTicket(comFanOut, fanOut)).toBeLessThan(pontuarTicket(semFanOut, fanOut));
  });
});

describe("ordenarParaLote", () => {
  it("tickets 100% agente e sem bloqueio vêm antes de tickets bloqueados ou humanos", () => {
    const todos = [
      card("BUG-1", { tags: ["size:G", "nivel:epic", "blocked:human-decision"], execucao: { modo: "humano" } }),
      card("BUG-2", { tags: ["size:P", "nivel:task"], execucao: { modo: "agente" } }),
      card("BUG-3", { tags: ["size:M", "nivel:task"], execucao: { modo: "misto" } }),
    ];
    const ordenado = ordenarParaLote(todos, todos);
    expect(ordenado.map((c) => c.id)).toEqual(["BUG-2", "BUG-3", "BUG-1"]);
  });

  it("dá preferência a quem desbloqueia mais tickets, mesmo em filtro com humano incluso", () => {
    const desbloqueador = card("BUG-1", { tags: ["size:G", "nivel:story"], execucao: { modo: "humano" } });
    const outro = card("BUG-2", { tags: ["size:G", "nivel:story"], execucao: { modo: "humano" } });
    const dependente1 = card("BUG-3", { tags: ["blocked-by:BUG-1"] });
    const dependente2 = card("BUG-4", { tags: ["blocked-by:BUG-1"] });
    const dependente3 = card("BUG-5", { tags: ["blocked-by:BUG-1"] });
    const todos = [outro, desbloqueador, dependente1, dependente2, dependente3];
    const ordenado = ordenarParaLote([desbloqueador, outro], todos);
    expect(ordenado[0].id).toBe("BUG-1");
  });

  it("não muta o array recebido", () => {
    const cards = [card("BUG-2"), card("BUG-1")];
    const copia = [...cards];
    ordenarParaLote(cards, cards);
    expect(cards).toEqual(copia);
  });
});

describe("estimarTokens", () => {
  it("estima ~1 token a cada 4 caracteres", () => {
    expect(estimarTokens("a".repeat(400))).toBe(100);
  });

  it("texto vazio estima 0", () => {
    expect(estimarTokens("")).toBe(0);
  });
});
