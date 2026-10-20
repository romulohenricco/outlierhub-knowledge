import { NextRequest, NextResponse } from "next/server";
import { setFavoritoAgente } from "@/lib/ecosystem";

export const runtime = "nodejs";

/** POST {id} marca favorito; {id, legacyId?, undo: true} desmarca (id + legacyId). */
export async function POST(req: NextRequest) {
  try {
    const { id, legacyId, undo } = await req.json();
    if (!id || typeof id !== "string") {
      return new NextResponse(null, { status: 400 });
    }
    const favoritos = await setFavoritoAgente(id, !undo, typeof legacyId === "string" ? legacyId : undefined);
    return NextResponse.json({ ok: true, favoritos });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
