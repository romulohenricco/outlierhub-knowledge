import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { imagePathFor } from "@/lib/referencias";

export const runtime = "nodejs";

/** Serve .mp4 local com suporte a Range (seek no player). */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dir: string; file: string }> },
) {
  const { dir, file } = await ctx.params;
  // Next já decodifica os params — sem segundo decode
  const abs = imagePathFor(dir, file);
  if (!abs || !abs.endsWith(".mp4")) return new NextResponse(null, { status: 400 });

  let size: number;
  try {
    size = (await stat(abs)).size;
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const range = req.headers.get("range");
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    // binário privado — nunca `public` (cache intermediário sob tunnel)
    "Cache-Control": "private, max-age=3600",
  };

  // range único e ancorado (RFC 9110 §14); malformado → resposta 200 completa
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start: number;
    let end: number;
    if (!m[1]) {
      // suffix range: últimos N bytes
      const n = parseInt(m[2], 10);
      if (n === 0) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      start = Math.max(size - n, 0);
      end = size - 1;
    } else {
      start = parseInt(m[1], 10);
      end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    }
    if (start >= size || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Content-Length"] = String(end - start + 1);
    const stream = Readable.toWeb(
      createReadStream(abs, { start, end }),
    ) as ReadableStream;
    return new NextResponse(stream, { status: 206, headers });
  }

  headers["Content-Length"] = String(size);
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new NextResponse(stream, { status: 200, headers });
}
