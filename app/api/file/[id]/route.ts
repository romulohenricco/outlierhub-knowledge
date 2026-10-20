import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getBook, resolveFilePath } from "@/lib/catalog";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

/** Serve o arquivo do livro — só leitura, só loopback, path validado no catalog. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const book = await getBook(id);
  const filePath = await resolveFilePath(id);
  if (!book || !filePath) return new NextResponse(null, { status: 404 });

  // arquivo que sumiu depois da checagem do catálogo: 404, nunca 500 com o caminho
  const data = await readFile(filePath).catch(() => null);
  if (data === null) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": MIME[book.formato] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(book.arquivo)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
