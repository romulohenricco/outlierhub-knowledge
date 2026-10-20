import { NextRequest, NextResponse } from "next/server";
import { PROCEDENCIAS, getEcosystem } from "@/lib/ecosystem";
import type { EcoKind, EcoProcedencia } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET(req: NextRequest) {
  const eco = await getEcosystem();
  const sp = req.nextUrl.searchParams;

  const kinds = (sp.get("kind") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as EcoKind[];
  const namespace = sp.get("namespace")?.trim() ?? "";
  const q = sp.get("q")?.trim().toLowerCase() ?? "";
  // Eixo de admissão — aceita lista: ?procedencia=propria,adotada
  const procedencias = (sp.get("procedencia") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is EcoProcedencia => (PROCEDENCIAS as readonly string[]).includes(s));

  let entities = eco.entities;
  if (kinds.length > 0) entities = entities.filter((e) => kinds.includes(e.kind));
  if (namespace) entities = entities.filter((e) => e.namespace === namespace);
  if (procedencias.length > 0) {
    entities = entities.filter((e) => procedencias.includes(e.procedencia));
  }
  if (q) {
    entities = entities.filter(
      (e) =>
        e.nome.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.descricao.toLowerCase().includes(q),
    );
  }

  return NextResponse.json({
    ok: true,
    // `counts` é sempre o total do ecossistema, não o do recorte — quem filtra
    // precisa saber de quanto está vendo um pedaço.
    counts: eco.counts,
    // Quebra por eixo de admissão — responde "quanto disso é nosso?" sem que o
    // consumidor precise varrer `entities`. Total do ecossistema, não do recorte.
    countsPorProcedencia: eco.countsPorProcedencia,
    total: eco.entities.length,
    retornados: entities.length,
    geradoEm: eco.geradoEm,
    entities,
  });
}
