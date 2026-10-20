import { NextResponse } from "next/server";
import { getKnowledgeProvider } from "@/lib/providers";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n)) return new NextResponse(null, { status: 400 });
  return NextResponse.json({ evidencias: await getKnowledgeProvider().evidencias(n) });
}
