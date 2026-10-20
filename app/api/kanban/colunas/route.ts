import { NextRequest, NextResponse } from "next/server";
import { criarColuna, reordenarColunas } from "@/lib/kanban";
import { respostaBoardCorrompido } from "../_resposta-board";

export const runtime = "nodejs";

/** POST {rotulo} cria uma nova coluna no fim do board. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { rotulo?: string } | null;
  if (!body?.rotulo?.trim()) {
    return NextResponse.json({ erro: "rótulo obrigatório" }, { status: 400 });
  }
  try {
    const board = await criarColuna(body.rotulo);
    return NextResponse.json(board, { status: 201 });
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
}

/** PATCH {ordem: string[]} reordena as colunas (ids na nova ordem). */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { ordem?: string[] } | null;
  if (!Array.isArray(body?.ordem)) {
    return NextResponse.json({ erro: "ordem inválida" }, { status: 400 });
  }
  try {
    const board = await reordenarColunas(body.ordem);
    return NextResponse.json(board);
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
}
