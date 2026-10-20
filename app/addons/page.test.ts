import { describe, it, expect } from "vitest";
import AddonsPage from "./page";

/** /addons virou /integracoes: o link antigo encaminha e leva a query junto (o ?id= abre o item). */
async function destino(query: Record<string, string | string[] | undefined>): Promise<string> {
  try {
    await AddonsPage({ searchParams: Promise.resolve(query) });
  } catch (erro) {
    return String((erro as { digest?: string }).digest ?? "");
  }
  return "";
}

describe("/addons", () => {
  it("encaminha para /integracoes", async () => {
    const d = await destino({});
    expect(d).toContain("NEXT_REDIRECT");
    expect(d).toContain(";/integracoes;");
  });

  it("preserva a query, inclusive parâmetro repetido", async () => {
    const d = await destino({ id: "design-system:exemplo", tag: ["a", "b"], vazio: undefined });
    expect(d).toContain("/integracoes?id=design-system%3Aexemplo&tag=a&tag=b");
    expect(d).not.toContain("vazio");
  });
});
