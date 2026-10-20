import { NextRequest, NextResponse } from "next/server";
import { CardInvalidoError, criarCard, getBoard, type NovoCardInput } from "@/lib/kanban";
import type { KanbanTipo } from "@/lib/types";
import { respostaBoardCorrompido } from "./_resposta-board";

export const runtime = "nodejs";

const TIPOS_VALIDOS: KanbanTipo[] = ["ingest", "clone", "autolearning", "feature", "melhoria", "bug", "infra", "outro"];

export async function GET() {
  try {
    return NextResponse.json(await getBoard());
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
}

/** POST cria um novo ticket — só título+tipo são obrigatórios; o resto fica
 *  disponível pra completar depois (melhor sobrar campo vazio que adivinhar). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.titulo !== "string" || !body.titulo.trim()) {
    return NextResponse.json({ erro: "título obrigatório" }, { status: 400 });
  }
  if (typeof body.tipo !== "string" || !TIPOS_VALIDOS.includes(body.tipo as KanbanTipo)) {
    return NextResponse.json({ erro: "tipo inválido" }, { status: 400 });
  }
  try {
    const card = await criarCard(body as unknown as NovoCardInput);
    return NextResponse.json(card, { status: 201 });
  } catch (e) {
    if (e instanceof CardInvalidoError) return NextResponse.json({ erro: e.message }, { status: 400 });
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
}
