import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { tamanhoDentroDoTeto } from "@/lib/arquivo-teto";
import { perfilThumbPathFor } from "@/lib/social";

export const runtime = "nodejs";

/** Miniatura de um post do dossiê de uma conta (perfis/<username>/<arquivo>). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ username: string; arquivo: string }> },
) {
  const { username, arquivo } = await ctx.params;
  const abs = perfilThumbPathFor(username, arquivo);
  if (!abs) return new NextResponse(null, { status: 400 });
  const ext = abs.slice(abs.lastIndexOf(".") + 1).toLowerCase();
  const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext];
  if (!mime) return new NextResponse(null, { status: 400 });
  try {
    if (!(await tamanhoDentroDoTeto(abs))) return new NextResponse(null, { status: 404 });
    const bytes = await readFile(abs);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        // material privado — nunca `public` (cache intermediário sob tunnel)
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
