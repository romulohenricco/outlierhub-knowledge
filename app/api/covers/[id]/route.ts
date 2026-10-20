import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getBook, coverPathFor } from "@/lib/catalog";

export const runtime = "nodejs";

/** Capa em cache (PNG em `.covers/`, dentro da pasta de livros). Sem capa → 404 (UI usa placeholder tipográfico). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const book = await getBook(id);
  if (!book) return new NextResponse(null, { status: 404 });
  try {
    const png = await readFile(coverPathFor(book.arquivo));
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        // material privado do acervo — nunca `public`: sob tunnel/proxy viraria
        // elegível a cache intermediário. Mesma política de file/[id].
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
