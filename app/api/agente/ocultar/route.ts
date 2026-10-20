import { NextRequest, NextResponse } from "next/server";
import { setOcultoAgente } from "@/lib/ecosystem";

export const runtime = "nodejs";


export async function POST(req: NextRequest) {
  try {
    const { id, legacyId, motivo, undo } = await req.json();
    if (!id || typeof id !== "string") {
      return new NextResponse(null, { status: 400 });
    }
    const ocultos = await setOcultoAgente(id, !undo, motivo, typeof legacyId === "string" ? legacyId : undefined);
    return NextResponse.json({ ok: true, ocultos });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
