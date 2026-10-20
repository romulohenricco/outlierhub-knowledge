import { NextRequest, NextResponse } from "next/server";
import { baixarVideo } from "@/lib/referencias";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST {code, idx} — baixa o vídeo on-demand para o INBOX + curado. */
export async function POST(req: NextRequest) {
  try {
    const corpo = (await req.json().catch(() => null)) as { code?: unknown; idx?: unknown } | null;
    if (!corpo || typeof corpo.code !== "string" || !corpo.code || typeof corpo.idx !== "number" || !Number.isSafeInteger(corpo.idx) || corpo.idx < 0 || corpo.idx > 1000) {
      return new NextResponse(null, { status: 400 });
    }
    const { code, idx } = corpo;
    const res = await baixarVideo(code, idx);
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  } catch (e) {
    // mensagem fixa: o texto do erro de sistema traz o caminho absoluto da máquina
    const detalhe = e as { name?: string; code?: string } | null;
    console.error(
      JSON.stringify({ evento: "baixar_video_falhou", erro: detalhe?.name ?? "Error", codigo: detalhe?.code ?? null }),
    );
    return NextResponse.json({ ok: false, erro: "falha ao baixar o vídeo (detalhes no log do servidor)" }, { status: 500 });
  }
}
