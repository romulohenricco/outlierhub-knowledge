import { NextResponse } from "next/server";
import { lerArtefatoAddon } from "@/lib/addons";

export const runtime = "nodejs";

/**
 * Source on-demand de um artefato de addon: SEMPRE texto inerte —
 * nunca html/js/svg. Content-Type fixo em text/plain, mesmo que o media_type
 * do manifest diga outra coisa, pra nunca virar HTML executável no browser.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; artifactId: string }> },
) {
  const { id, artifactId } = await ctx.params;
  // Next já decodifica os params — segundo decode permitiria %252e → "." (disclosure)
  const texto = await lerArtefatoAddon(id, artifactId);
  if (texto === null) return new NextResponse(null, { status: 404 });
  return new NextResponse(texto, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
