import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";

export const runtime = "nodejs";

// Mesmo arquivo que o grafo lê (lib/kg.ts): um padrão só, em data/kg, para o painel
// do item e as evidências do grafo nunca divergirem.
const MAPA =
  process.env.BILHON_CLICKUP_MAP ||
  path.join(process.cwd(), "data", "kg", "clickup-map.json");

/** Metadados de um item do ClickUp ingerido (doc do corpus → url/pasta/lista/status/tags). */
export async function GET(req: NextRequest) {
  const doc = req.nextUrl.searchParams.get("doc");
  if (!doc) return new NextResponse(null, { status: 400 });
  try {
    const mapa = JSON.parse(await readFile(MAPA, "utf-8"));
    const item = mapa[doc];
    if (!item) return new NextResponse(null, { status: 404 });
    return NextResponse.json(item);
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
