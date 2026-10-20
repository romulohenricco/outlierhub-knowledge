import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { imagePathFor, mimeReal } from "@/lib/referencias";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dir: string; img: string }> },
) {
  const { dir, img } = await ctx.params;
  // Next já decodifica os params — segundo decode permitiria %252e → "." (disclosure)
  const abs = imagePathFor(dir, img);
  if (!abs) return new NextResponse(null, { status: 400 });
  // MIME pelos magic bytes: a extensão pode mentir (.heic com bytes de JPEG) e servir
  // `image/heic` para JPEG quebra a imagem no navegador.
  const mime = await mimeReal(abs);
  if (!mime) return new NextResponse(null, { status: 400 });
  try {
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
