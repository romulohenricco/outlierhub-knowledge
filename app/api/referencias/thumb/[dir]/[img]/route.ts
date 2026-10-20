import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { thumbPathFor } from "@/lib/referencias";

export const runtime = "nodejs";

/** Serve o thumbnail WebP (400px) do grid; fallback ao original se não gerado. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dir: string; img: string }> },
) {
  const { dir, img } = await ctx.params;
  const r = await thumbPathFor(dir, img);
  if (!r) return new NextResponse(null, { status: 400 });
  try {
    const bytes = await readFile(r.path);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": r.mime,
        // material privado — nunca `public` (cache intermediário sob tunnel)
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
