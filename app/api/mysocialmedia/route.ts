import { NextResponse } from "next/server";
import { getSocialMedia } from "@/lib/social";

export const runtime = "nodejs";

/** Índice das contas seguidas, por nicho (vazio sem dados em BILHON_SOCIAL_DIR). */
export async function GET() {
  try {
    return NextResponse.json(await getSocialMedia());
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
