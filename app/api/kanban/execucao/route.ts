import { NextResponse } from "next/server";
import { lerExecutor } from "../_executor";

export const runtime = "nodejs";
// lê o ambiente a cada chamada: a UI decide mostrar o botão "escalar" por aqui
export const dynamic = "force-dynamic";

/** GET — diz se há executor externo configurado. Só um booleano: nem o endereço
 *  nem o agente padrão saem do servidor. */
export async function GET() {
  return NextResponse.json({ escalar: lerExecutor().ok });
}
