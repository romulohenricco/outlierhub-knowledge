import { NextRequest, NextResponse } from "next/server";
import { setFavorito } from "@/lib/referencias";

export const runtime = "nodejs";

/** POST {code} marca favorito; {code, undo: true} desmarca. */
export async function POST(req: NextRequest) {
  try {
    const { code, undo } = (await req.json().catch(() => null)) ?? {};
    if (!code || typeof code !== "string") {
      return new NextResponse(null, { status: 400 });
    }
    const favoritos = await setFavorito(code, !undo);
    return NextResponse.json({ ok: true, favoritos });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
