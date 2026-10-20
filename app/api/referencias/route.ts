import { NextResponse } from "next/server";
import { getReferencias } from "@/lib/referencias";

export const runtime = "nodejs";

/** Índice das referências de design system (posts + imagens). */
export async function GET() {
  try {
    return NextResponse.json(await getReferencias());
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
