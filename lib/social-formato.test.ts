import { describe, expect, it } from "vitest";
import { dataHumana, numeroHumano, rotuloNicho } from "./social-formato";

describe("formatação das telas de redes", () => {
  it("rotuloNicho usa o nome do arquivo de nichos e humaniza o id quando falta", () => {
    expect(rotuloNicho("design", { design: "Design gráfico" })).toBe("Design gráfico");
    expect(rotuloNicho("tema_exemplo")).toBe("Tema exemplo");
    expect(rotuloNicho("um-nicho")).toBe("Um nicho");
    expect(rotuloNicho("___")).toBe("___");
  });

  it("numeroHumano", () => {
    expect(numeroHumano(999)).toBe("999");
    expect(numeroHumano(1500)).toBe("1.5k");
    expect(numeroHumano(2_000_000)).toBe("2M");
  });

  it("dataHumana devolve null para vazio ou inválido (nunca 'Invalid Date')", () => {
    expect(dataHumana(null)).toBeNull();
    expect(dataHumana("")).toBeNull();
    expect(dataHumana("não é data")).toBeNull();
    expect(dataHumana("2026-01-15T12:00:00.000Z")).toMatch(/2026/);
  });
});
