import { NextRequest, NextResponse } from "next/server";
import { getKnowledgeProvider } from "@/lib/providers";
import type { KgEdge, KgNode, TopoEdgeTipo, TopoNodeTipo } from "@/lib/kg";
import type { GrafoTopologiaResultado } from "@/lib/topologia";
import { bilhonRoot } from "@/lib/bilhon-paths";
import { getEcosystem, PROCEDENCIAS } from "@/lib/ecosystem";
import {
  ECO_EDGE_ID_BASE,
  ECO_KINDS,
  ligarEcossistemaATopologia,
  montarGrafoEcossistema,
} from "@/lib/grafo-ecossistema";
import { datarTopologia, datasDoEcossistema } from "@/lib/datas-disco";
import type { EcoKind, EcoProcedencia } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = (sp.get("status") ?? "confirmed,claimed").split(",");
  const tema = sp.get("tema") ?? undefined;
  const incluirLivros = sp.get("livros") !== "0";
  // conhecimento=0 desliga o grafo dos livros — o /grafo também é o mapa do
  // ecossistema, e ver só skills/squads exige poder tirar os conceitos da frente
  const conhecimento = sp.get("conhecimento") !== "0";
  const foco = sp.get("foco") ?? undefined;
  const refs = sp.get("refs") === "1";
  const videos = sp.get("videos") === "1";
  // camada de topologia — desligada por padrão: é um eixo diferente (o disco),
  // não um filtro do conhecimento.
  const topologia = sp.get("topologia") === "1";
  const topoTipos = (sp.get("topoTipos") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean) as TopoEdgeTipo[];
  const topoMax = Number(sp.get("topoMax"));
  const topoMortas = sp.get("topoMortas") === "1";
  const listaDe = (k: string) =>
    (sp.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const topoPlanos = listaDe("topoPlanos");
  const topoTiposNo = listaDe("topoTiposNo") as TopoNodeTipo[];
  // camada ecossistema — desligada por padrão, como a topologia: é o inventário
  // do /agente (skills, squads, agents…), um eixo diferente do conhecimento
  const ecossistema = sp.get("ecossistema") === "1";
  const ecoKinds = listaDe("kinds").filter((k): k is EcoKind => (ECO_KINDS as string[]).includes(k));
  const ecoProc = listaDe("procedencias").filter((k): k is EcoProcedencia =>
    (PROCEDENCIAS as readonly string[]).includes(k),
  );
  try {
    const provider = getKnowledgeProvider();
    const g = conhecimento
      ? await provider.grafo({ status, tema, incluirLivros, foco })
      : { nodes: [], edges: [] };
    let nodes: KgNode[] = g.nodes;
    let edges: KgEdge[] = g.edges;
    if (refs || videos) {
      const gr = await provider.grafoReferencias({ refs, videos });
      nodes = [...nodes, ...gr.nodes];
      edges = [...edges, ...gr.edges];
    }
    let topo: GrafoTopologiaResultado["meta"] | null = null;
    let topoErro: string | null = null;
    if (topologia) {
      // try PRÓPRIO, separado do grafo de conhecimento: a topologia é camada
      // OPCIONAL (depende do extrato apontado por BILHON_TOPOLOGY_DIR, que só existe
      // se o usuário o gerar). No try compartilhado, extrato ausente derrubava a
      // resposta inteira com 503 e o grafo de conhecimento morria junto — camada
      // opcional não pode levar a obrigatória embora.
      try {
        const gt = await provider.grafoTopologia({
          tipos: topoTipos.length ? topoTipos : undefined,
          maxEdges: Number.isFinite(topoMax) && topoMax > 0 ? topoMax : undefined,
          soMortas: topoMortas,
          planos: topoPlanos.length ? topoPlanos : undefined,
          tiposNo: topoTiposNo.length ? topoTiposNo : undefined,
        });
        nodes = [...nodes, ...(await datarTopologia(gt.nodes))];
        edges = [...edges, ...gt.edges];
        topo = gt.meta; // sempre devolvido: cap silencioso mentiria sobre a cobertura
      } catch (e) {
        // degrada com o motivo VISÍVEL — falhar em silêncio faria o toggle
        // parecer ligado e sem efeito
        topoErro = String(e).slice(0, 150);
      }
    }
    let eco: { total: number; mostrados: number; counts: Record<string, number> } | null = null;
    let ecoErro: string | null = null;
    if (ecossistema) {
      // try próprio pelo mesmo motivo da topologia: camada opcional (depende do
      // inventário configurado em docs/agente-registro.md) não derruba a obrigatória
      try {
        const raiz = bilhonRoot();
        const { entities, counts } = await getEcosystem();
        const ge = montarGrafoEcossistema(entities, {
          kinds: ecoKinds,
          procedencias: ecoProc,
          datas: await datasDoEcossistema(entities, raiz),
          raiz,
        });
        const ponte = topologia
          ? ligarEcossistemaATopologia(
              ge.nodes,
              nodes.filter((n) => n.camada === "topologia"),
              ECO_EDGE_ID_BASE - ge.edges.length - 10_000,
            )
          : [];
        nodes = [...nodes, ...ge.nodes];
        edges = [...edges, ...ge.edges, ...ponte];
        eco = {
          total: entities.length,
          mostrados: ge.nodes.filter((n) => !n.estrutural).length,
          counts,
        };
      } catch (e) {
        ecoErro = String(e).slice(0, 150);
      }
    }
    return NextResponse.json({
      nodes,
      edges,
      stats: await provider.kgStats(),
      topo,
      topoErro,
      eco,
      ecoErro,
    });
  } catch (e) {
    return NextResponse.json(
      { erro: "grafo indisponível", detalhe: String(e).slice(0, 150) },
      { status: 503 },
    );
  }
}
