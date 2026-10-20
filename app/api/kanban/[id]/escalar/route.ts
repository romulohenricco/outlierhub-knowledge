import { NextRequest, NextResponse } from "next/server";
import { cardIdValido } from "@/lib/kanban";
import { lerExecutor } from "../../_executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 15_000;

/**
 * Cria uma tarefa no executor externo configurado (ver ../../_executor.ts).
 * O envio ocorre no servidor e este board continua sendo a fonte do ticket.
 *
 * Contrato esperado do executor: responde JSON `{ ok: true, task: { id } }`.
 * Sem BILHON_EXECUTION_URL o recurso está desligado: 503.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Next 15: params é Promise. Acesso síncrono ainda passa em runtime, mas está
  // depreciado e o tsc recusa — todas as outras rotas deste app já awaitam.
  const id = (await ctx.params).id?.trim();
  if (!id) return NextResponse.json({ erro: "id obrigatório" }, { status: 400 });
  // o id vai para um serviço externo: só passa o formato do próprio kanban (AAA-123)
  if (!cardIdValido(id)) return NextResponse.json({ erro: "id inválido" }, { status: 400 });

  const executor = lerExecutor();
  if (!executor.ok) return NextResponse.json({ erro: executor.erro }, { status: 503 });

  // corpo ausente, `null` ou de outro tipo vira {} — o agente padrão cobre
  const bruto = await req.json().catch(() => null);
  const body = (bruto && typeof bruto === "object" ? bruto : {}) as { toAgent?: unknown };
  if (body.toAgent !== undefined && typeof body.toAgent !== "string") {
    return NextResponse.json({ erro: "Agente invalido." }, { status: 400 });
  }
  const toAgent = body.toAgent?.trim() || executor.agentePadrao;

  let res: Response;
  try {
    res = await fetch(executor.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: id, ...(toAgent ? { toAgent } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // 503, não 500: este app está bem — o executor é que não atendeu.
    return NextResponse.json({ erro: "Executor externo indisponivel." }, { status: 503 });
  }

  const payload = (await res.json().catch(() => null)) as { ok?: boolean; task?: { id?: string } } | null;

  if (!res.ok || !payload?.ok) {
    // Devolve só o status: o texto de erro do executor pode trazer detalhe interno.
    return NextResponse.json(
      { erro: `Executor externo recusou a solicitacao (${res.status}).` },
      { status: res.status === 404 ? 404 : 502 },
    );
  }

  return NextResponse.json({ ok: true, taskId: payload.task?.id ?? null }, { status: 201 });
}
