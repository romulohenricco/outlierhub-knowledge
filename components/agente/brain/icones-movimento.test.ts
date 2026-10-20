import { describe, expect, it } from "vitest";
import type { TipoNo } from "@/lib/brain/cena";
import { MOVIMENTO_GLIFO } from "./icones-movimento";

const TIPOS_DESENHADOS: TipoNo[] = ["pilar", "agente", "humano", "worker", "squad", "ferramenta", "skill", "tarefa"];

describe("MOVIMENTO_GLIFO (contrato de movimento dos ícones do grafo)", () => {
  it("todo tipo desenhado tem um movimento definido", () => {
    for (const t of TIPOS_DESENHADOS) expect(MOVIMENTO_GLIFO[t], t).toBeDefined();
  });

  it("hubs e agentes respiram, ferramentas e tarefas só reagem ao hover", () => {
    expect(MOVIMENTO_GLIFO.pilar).toBe("respira");
    expect(MOVIMENTO_GLIFO.agente).toBe("respira");
    expect(MOVIMENTO_GLIFO.squad).toBe("respira");
    expect(MOVIMENTO_GLIFO.ferramenta).toBe("firme");
    expect(MOVIMENTO_GLIFO.tarefa).toBe("firme");
  });
});
