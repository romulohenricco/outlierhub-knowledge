import { NextResponse } from "next/server";
import { getKnowledgeProvider, ProviderSearchError } from "@/lib/providers";
import type { SearchResposta } from "@/lib/types";

export const runtime = "nodejs";

/** Busca semântica — delega pro provider ativo. Provider real: RPC híbrida (vetor +
 *  texto) no Supabase do usuário, com o embedding da pergunta vindo de um Ollama
 *  local. Modo demo: busca léxica sobre fixtures sintéticas. */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof corpo?.query === "string" ? corpo.query : "";
  if (!query.trim()) {
    return NextResponse.json(
      { ok: false, erro: "query-vazia" } satisfies SearchResposta,
      { status: 400 },
    );
  }

  try {
    const hits = await getKnowledgeProvider().search(query.trim(), 18);
    return NextResponse.json({ ok: true, query: query.trim(), hits } satisfies SearchResposta);
  } catch (e) {
    if (e instanceof ProviderSearchError) {
      return NextResponse.json(
        { ok: false, erro: e.code, detalhe: e.message } satisfies SearchResposta,
        { status: 503 },
      );
    }
    const detalhe = e instanceof Error ? e.message.slice(0, 200) : String(e);
    return NextResponse.json(
      { ok: false, erro: "backend", detalhe } satisfies SearchResposta,
      { status: 503 },
    );
  }
}
