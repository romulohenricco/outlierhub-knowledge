import { NextRequest, NextResponse } from "next/server";
import { atualizarCard, excluirCard, moverCard } from "@/lib/kanban";
import type { KanbanColunaId } from "@/lib/types";
import { respostaBoardCorrompido } from "../_resposta-board";

export const runtime = "nodejs";

type MoverBody = { coluna: KanbanColunaId; index: number; override?: string };

/** Só desvia pra `moverCard` com `{coluna, index}` bem formados — `coluna` sem
 *  `index` (ou com index fracionário) é corpo malformado, e cai na allowlist do
 *  patch, que recusa `coluna` com 400. Adivinhar intenção em corpo ambíguo é
 *  como o mass assignment nasceu. */
function ehMover(body: unknown): body is MoverBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.coluna === "string" && Number.isInteger(b.index);
}

/** PATCH: `{coluna,index}` move/reordena o card (bloqueado se voltar status —
 *  ver moverCard); qualquer outro corpo é um patch parcial dos campos do
 *  ticket (título, descrição, prioridade…), restrito à allowlist da lib. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo inválido" }, { status: 400 });

  try {
    if (ehMover(body)) {
      const r = await moverCard(id, body.coluna, body.index, { override: body.override });
      if (!r.ok) {
        const status = r.erro === "ticket não encontrado" || r.erro === "coluna não encontrada" ? 404 : 409;
        return NextResponse.json({ erro: r.erro, ...(r.faltando ? { faltando: r.faltando } : {}) }, { status });
      }
      return NextResponse.json(r.card);
    }

    const r = await atualizarCard(id, body);
    if (!r.ok) {
      return NextResponse.json({ erro: r.erro }, { status: r.motivo === "nao-encontrado" ? 404 : 400 });
    }
    return NextResponse.json(r.card);
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const ok = await excluirCard(id);
    if (!ok) return NextResponse.json({ erro: "ticket não encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
}
