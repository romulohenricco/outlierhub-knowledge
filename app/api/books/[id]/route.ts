import { NextResponse } from "next/server";
import { getBook } from "@/lib/catalog";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const book = await getBook(id);
  if (!book) {
    return NextResponse.json({ erro: "livro não encontrado" }, { status: 404 });
  }
  return NextResponse.json(book);
}
