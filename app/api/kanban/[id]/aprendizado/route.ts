import { NextRequest, NextResponse } from "next/server";
import { getAprendizado, salvarAprendizado } from "@/lib/kanban";

export const runtime = "nodejs";

/** GET — devolve o texto do aprendizado já salvo (vazio se ainda não existe). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const texto = await getAprendizado(id);
  return NextResponse.json({ texto });
}

/** POST {titulo, texto} — grava/atualiza o aprendizado opt-in do ticket
 *  como markdown avulso em KANBAN_DIR/aprendizados/<id>.md. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const texto = body?.texto;
  if (!texto || typeof texto !== "string" || !texto.trim()) {
    return NextResponse.json({ erro: "texto obrigatório" }, { status: 400 });
  }
  const titulo = typeof body?.titulo === "string" ? body.titulo : id;
  const ok = await salvarAprendizado(id, titulo, texto);
  if (!ok) return NextResponse.json({ erro: "id inválido" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
