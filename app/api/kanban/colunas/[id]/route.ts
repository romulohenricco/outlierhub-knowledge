import { NextRequest, NextResponse } from "next/server";
import { atualizarColuna, excluirColuna } from "@/lib/kanban";
import { respostaBoardCorrompido } from "../../_resposta-board";

export const runtime = "nodejs";

/** PATCH {rotulo?, wipLimite?} renomeia a coluna e/ou ajusta o limite de WIP. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { rotulo?: string; wipLimite?: number | null } | null;
  if (!body) return NextResponse.json({ erro: "corpo inválido" }, { status: 400 });
  try {
    const board = await atualizarColuna(id, body);
    if (!board) return NextResponse.json({ erro: "coluna não encontrada" }, { status: 404 });
    return NextResponse.json(board);
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
}

/** DELETE só remove a coluna se ela não tiver tickets. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const r = await excluirColuna(id);
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 });
    return NextResponse.json(r.board);
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
}
