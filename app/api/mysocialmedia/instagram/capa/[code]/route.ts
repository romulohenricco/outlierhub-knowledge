import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { tamanhoDentroDoTeto } from "@/lib/arquivo-teto";
import { capaPathFor } from "@/lib/instagram-saves";

export const runtime = "nodejs";

/** Capa local de um save do Instagram (a URL do CDN expira, então a coleta guarda o arquivo em thumbs/). */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const abs = capaPathFor(code);
  if (!abs) return new NextResponse(null, { status: 400 });
  try {
    if (!(await tamanhoDentroDoTeto(abs))) return new NextResponse(null, { status: 404 });
    const bytes = await readFile(abs);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        // material privado — nunca `public` (cache intermediário sob tunnel)
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
