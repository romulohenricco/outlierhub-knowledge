import { NextRequest, NextResponse } from "next/server";
import { setPromptReverso, type PromptReverso } from "@/lib/referencias";

export const runtime = "nodejs";

const CAMPOS_ANALISE = [
  "composicao",
  "zonaSegura",
  "tipografia",
  "cor",
  "luz",
  "sujeito",
  "textoNaImagem",
  "gancho",
] as const;

/**
 * POST {code, promptReverso} — grava a receita de recriação de uma referência.
 *
 * Quem escreve é quem LÊ a imagem (um agente ou uma pessoa que analisa a
 * imagem e monta a receita). O app não chama LLM nenhum: guarda e exibe, no
 * mesmo modelo das anotações.
 */
export async function POST(req: NextRequest) {
  try {
    const { code, promptReverso } = (await req.json().catch(() => null)) ?? {};
    const strOpt = (v: unknown, max = 4000) =>
      v === undefined || (typeof v === "string" && v.length <= max);

    if (
      !code ||
      typeof code !== "string" ||
      typeof promptReverso?.prompt !== "string" ||
      promptReverso.prompt.length === 0 ||
      promptReverso.prompt.length > 8000 ||
      !strOpt(promptReverso.negativo) ||
      !strOpt(promptReverso.proporcao, 40) ||
      !strOpt(promptReverso.por, 120) ||
      !strOpt(promptReverso.geradoEm, 40) ||
      (promptReverso.analise !== undefined &&
        (typeof promptReverso.analise !== "object" ||
          promptReverso.analise === null ||
          Array.isArray(promptReverso.analise) ||
          !CAMPOS_ANALISE.some((c) => c in promptReverso.analise) ||
          !Object.values(promptReverso.analise).every((v) => strOpt(v, 2000))))
    ) {
      return new NextResponse(null, { status: 400 });
    }

    // objeto limpo — descarta campos desconhecidos (mesma guarda do /anotar)
    const analise = promptReverso.analise
      ? Object.fromEntries(
          CAMPOS_ANALISE.filter((c) => typeof promptReverso.analise[c] === "string")
            .map((c) => [c, promptReverso.analise[c]]),
        )
      : undefined;

    const limpo: PromptReverso = {
      prompt: promptReverso.prompt,
      negativo: promptReverso.negativo,
      proporcao: promptReverso.proporcao,
      por: promptReverso.por,
      geradoEm: promptReverso.geradoEm,
      analise,
    };
    await setPromptReverso(code, limpo);
    return NextResponse.json({ ok: true });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
