import { readFile, unlink } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { imagemPathFor, removerImagem } from "@/lib/kanban";
import { respostaBoardCorrompido } from "../../../_resposta-board";

export const runtime = "nodejs";

const MIME_POR_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Serve a imagem pra exibição (<img src>). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; arquivo: string }> }) {
  const { id, arquivo } = await ctx.params;
  const abs = imagemPathFor(id, arquivo);
  if (!abs) return new NextResponse(null, { status: 400 });
  try {
    const bytes = await readFile(abs);
    const ext = arquivo.slice(arquivo.lastIndexOf(".") + 1).toLowerCase();
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": MIME_POR_EXT[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; arquivo: string }> }) {
  const { id, arquivo } = await ctx.params;
  const abs = imagemPathFor(id, arquivo);
  if (!abs) return NextResponse.json({ erro: "caminho inválido" }, { status: 400 });
  let card;
  try {
    card = await removerImagem(id, arquivo);
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
  if (!card) return NextResponse.json({ erro: "ticket não encontrado" }, { status: 404 });
  try {
    await unlink(abs);
  } catch {
    /* arquivo já não existe — segue, o registro no card já foi removido */
  }
  return NextResponse.json(card);
}
