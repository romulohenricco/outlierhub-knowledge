import { NextRequest, NextResponse } from "next/server";
import { setDecisoesSaves } from "@/lib/instagram-saves";
import { lerCorpoTriagem } from "@/lib/triagem-corpo";

export const runtime = "nodejs";

/**
 * POST {ids: string[], status: "descartado" | "manter" | "referencia" | null}
 * Triagem manual dos saves do Instagram: descarta (some da lista, reversível), marca pra manter,
 * põe na fila de /referencias ("referencia"), ou `null` pra desfazer. Só mexe em decisoes.json
 * (dentro de BILHON_SOCIAL_DIR) — NÃO desfaz o save no Instagram nem toca em /referencias.
 */
export async function POST(req: NextRequest) {
  const corpo = lerCorpoTriagem(await req.json().catch(() => null));
  if (!corpo) return new NextResponse(null, { status: 400 });
  try {
    const { aplicados, ignorados } = await setDecisoesSaves(corpo.ids, corpo.status);
    return NextResponse.json({ ok: true, aplicados: aplicados.length, ignorados });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
