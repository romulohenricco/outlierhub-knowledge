import { NextRequest, NextResponse } from "next/server";
import { setAnotacao } from "@/lib/referencias";

export const runtime = "nodejs";

/** POST {code, anotacao} — grava a anotação de conteúdo de um post. */
export async function POST(req: NextRequest) {
  try {
    const { code, anotacao } = (await req.json().catch(() => null)) ?? {};
    const strOpt = (v: unknown) => v === undefined || typeof v === "string";
    if (
      !code ||
      typeof code !== "string" ||
      typeof anotacao?.descricao !== "string" ||
      anotacao.descricao.length === 0 ||
      anotacao.descricao.length > 4000 ||
      !["estudo", "visual"].includes(anotacao.tipo) ||
      !strOpt(anotacao.texto) ||
      !strOpt(anotacao.verificadoEm) ||
      (anotacao.fontes !== undefined &&
        !(Array.isArray(anotacao.fontes) &&
          anotacao.fontes.every((f: unknown) => typeof f === "string")))
    ) {
      return new NextResponse(null, { status: 400 });
    }
    // objeto limpo — descarta campos desconhecidos
    await setAnotacao(code, {
      tipo: anotacao.tipo,
      descricao: anotacao.descricao,
      texto: anotacao.texto,
      fontes: anotacao.fontes,
      verificadoEm: anotacao.verificadoEm,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
