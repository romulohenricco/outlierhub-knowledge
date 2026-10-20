// @vitest-environment node
import { describe, expect, it } from "vitest";
import { carregarBrain } from "./carregar";

describe("carregarBrain", () => {
  it("sem organização e sem notas: não lança, devolve os dois motivos", async () => {
    const d = await carregarBrain({ organizacao: "/nao/existe.json", memoriaRaiz: "/nao/existe" });
    expect(d.org.ok).toBe(false);
    expect(d.memoria).toBeNull();
    expect(d.memoriaMotivo).toBeTruthy();
    expect(d.memoriaFalha).toBeUndefined(); // ausente é o estado normal de partida, não falha
  });
  it("leitor que lança também degrada em vez de quebrar a página", async () => {
    const d = await carregarBrain({
      organizacao: "x",
      memoriaRaiz: "y",
      lerOrganizacao: async () => {
        throw new Error("boom");
      },
      lerMemoria: async () => {
        throw new Error("boom");
      },
    });
    expect(d.org.ok).toBe(false);
    expect(d.memoria).toBeNull();
    expect(d.memoriaMotivo).toMatch(/boom/);
    expect(d.memoriaFalha).toBe(true);
  });
  it("repassa o que os leitores devolvem", async () => {
    const d = await carregarBrain({
      lerOrganizacao: async () => ({ ok: true, data: { pilares: [], agentes: [], pessoas: [], tarefas: [], ferramentas: [], ultimaExecucao: {} }, avisos: [] }),
      lerMemoria: async () => ({ hubs: [], notas: [], links: [], total: 0, conectadas: 0, naoResolvidos: 0 }),
    });
    expect(d.org.ok).toBe(true);
    expect(d.memoria?.total).toBe(0);
    expect(d.memoriaMotivo).toBeUndefined();
  });
});
