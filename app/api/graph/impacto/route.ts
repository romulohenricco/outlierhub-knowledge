import { NextRequest, NextResponse } from "next/server";
import { getKnowledgeProvider } from "@/lib/providers";

export const runtime = "nodejs";

/**
 * "Se eu mover X, o que quebra?" — ego-grafo REVERSO sobre a
 * camada de topologia: tudo que aponta pro alvo (ou pra qualquer nó abaixo dele).
 *
 * `GET /api/graph/impacto?path=/caminho/absoluto`
 *
 * 404 quando nenhum nó do grafo cobre o caminho — diferente de 200 com tudo
 * zerado, que significa "está no grafo e nada aponta pra ele" (seguro de mover).
 * A distinção importa: é a diferença entre "não sei" e "sei que é seguro".
 */
export async function GET(req: NextRequest) {
  const alvo = req.nextUrl.searchParams.get("path");
  if (!alvo) {
    return NextResponse.json({ erro: "informe ?path=<caminho absoluto>" }, { status: 400 });
  }
  try {
    const r = await getKnowledgeProvider().impactoDeMover(alvo);
    if (!r) {
      return NextResponse.json(
        { erro: "nenhum nó do grafo cobre esse caminho", alvo },
        { status: 404 },
      );
    }
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json(
      { erro: "impacto indisponível", detalhe: String(e).slice(0, 150) },
      { status: 503 },
    );
  }
}
