import { NextResponse } from "next/server";
import { BoardCorrompidoError } from "@/lib/kanban";

/** Traduz `board.json` ilegível em **503** com mensagem acionável, não em 500
 *  mudo: é estado de infraestrutura recuperável (restaurar snapshot), não bug de
 *  request. Devolve `null` quando o erro é outro — aí o chamador re-lança e o
 *  Next trata como 500 mesmo.
 *
 *  Não é um arquivo de rota (Next só roteia `route.ts`). */
export function respostaBoardCorrompido(e: unknown): NextResponse | null {
  if (!(e instanceof BoardCorrompidoError)) return null;
  return NextResponse.json({ erro: e.message, codigo: "board_corrompido" }, { status: 503 });
}
