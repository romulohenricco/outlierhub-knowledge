import { NextRequest, NextResponse } from "next/server";
import { setAntipattern } from "@/lib/referencias";

export const runtime = "nodejs";

/** POST {code, motivo?} marca antipattern; {code, undo: true} desmarca. */
export async function POST(req: NextRequest) {
  try {
    const { code, motivo, undo } = (await req.json().catch(() => null)) ?? {};
    if (!code || typeof code !== "string") {
      return new NextResponse(null, { status: 400 });
    }
    const antipatterns = await setAntipattern(code, !undo, motivo);
    return NextResponse.json({ ok: true, antipatterns });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
