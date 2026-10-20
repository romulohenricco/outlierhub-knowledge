import { NextRequest, NextResponse } from "next/server";
import { setDecisoes } from "@/lib/youtube-playlists";
import { lerCorpoTriagem } from "@/lib/triagem-corpo";

export const runtime = "nodejs";

/**
 * POST {ids: string[], status: "descartado" | "manter" | "referencia" | null}
 * Triagem manual das playlists do YouTube: descarta (some da lista, reversível), marca pra manter,
 * põe na fila de /referencias ("referencia"), ou `null` pra desfazer. Só mexe em decisoes.json
 * (dentro de BILHON_SOCIAL_DIR) — NÃO toca no YouTube (o vídeo continua na playlist real) nem em /referencias.
 */
export async function POST(req: NextRequest) {
  const corpo = lerCorpoTriagem(await req.json().catch(() => null));
  if (!corpo) return new NextResponse(null, { status: 400 });
  try {
    const { aplicados, ignorados } = await setDecisoes(corpo.ids, corpo.status);
    return NextResponse.json({ ok: true, aplicados: aplicados.length, ignorados });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
