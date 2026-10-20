/**
 * DemoProvider — implementação de `KnowledgeGraphProvider` sobre fixtures
 * sintéticas (fixtures/demo/{livros,grafo,referencias}.json). Zero subprocess,
 * zero filesystem externo — só JSON estático empacotado no repo.
 * Reimplementa em JS puro a mesma lógica de filtro/agregação de lib/kg.ts,
 * pra se comportar como um KnowledgeGraphProvider de verdade (prova de
 * plugabilidade), não um stub burro.
 */
import { cortaTexto } from "@/lib/texto";
import livrosFixture from "@/fixtures/demo/livros.json";
import grafoFixture from "@/fixtures/demo/grafo.json";
import referenciasFixture from "@/fixtures/demo/referencias.json";
import type {
  KnowledgeGraphProvider,
  GrafoOpts,
  GrafoReferenciasOpts,
  GrafoResultado,
  GrafoTopologiaResultado,
  ImpactoDeMover,
  EvidenciaEnriquecida,
  FontesDoConceito,
  KgStats,
  KgNode,
  KgEdge,
} from "../types";

type DemoLivro = {
  id: string;
  titulo: string;
  tema: string;
  resumo: string;
  arquivo: string;
  formato: "pdf" | "txt" | "md";
};

type DemoReferencia = {
  code: string;
  user: string;
  caption: string;
  igUrl: string;
  videoIdx: number[];
  colecoes: string[];
};

const LIVROS = livrosFixture as DemoLivro[];
const NODES = grafoFixture.nodes as KgNode[];
const EDGES = grafoFixture.edges as KgEdge[];
const REFERENCIAS = referenciasFixture as DemoReferencia[];

const livroPorArquivo = new Map(LIVROS.map((l) => [l.arquivo, l] as const));
const arquivoDoNo = (id: string) => id.replace(/^livro:/, "");

export class DemoGraphProvider implements KnowledgeGraphProvider {
  async grafo(opts: GrafoOpts): Promise<GrafoResultado> {
    const statusPermitido = new Set(
      opts.status.filter((s) => ["claimed", "confirmed", "disputed"].includes(s)),
    );
    if (statusPermitido.size === 0) return { nodes: [], edges: [] };

    let edges = EDGES.filter((e) => statusPermitido.has(e.status));

    if (opts.tema) {
      const arquivosDoTema = new Set(
        LIVROS.filter((l) => l.tema === opts.tema).map((l) => l.arquivo),
      );
      if (arquivosDoTema.size === 0) return { nodes: [], edges: [] };
      // conceitos que tocam algum livro do tema (via qualquer aresta)
      const conceitosDoTema = new Set<string>();
      for (const e of EDGES) {
        const livroSrc = e.src.startsWith("livro:") && arquivosDoTema.has(arquivoDoNo(e.src));
        const livroDst = e.dst.startsWith("livro:") && arquivosDoTema.has(arquivoDoNo(e.dst));
        if (livroSrc) conceitosDoTema.add(e.dst);
        if (livroDst) conceitosDoTema.add(e.src);
      }
      edges = edges.filter((e) => {
        const srcLivroNoTema = e.src.startsWith("livro:") && arquivosDoTema.has(arquivoDoNo(e.src));
        const dstLivroNoTema = e.dst.startsWith("livro:") && arquivosDoTema.has(arquivoDoNo(e.dst));
        return srcLivroNoTema || dstLivroNoTema || conceitosDoTema.has(e.src) || conceitosDoTema.has(e.dst);
      });
    }

    if (opts.incluirLivros === false) {
      edges = edges.filter((e) => !e.src.startsWith("livro:"));
    }

    edges = [...edges]
      .sort((a, b) => b.n_fontes - a.n_fontes || b.peso - a.peso)
      .slice(0, opts.maxEdges ?? 1500);

    const ids = new Set<string>();
    for (const e of edges) {
      ids.add(e.src);
      ids.add(e.dst);
    }

    const grau = new Map<string, number>();
    for (const e of edges) {
      grau.set(e.src, (grau.get(e.src) ?? 0) + 1);
      grau.set(e.dst, (grau.get(e.dst) ?? 0) + 1);
    }

    const nodes = NODES.filter((n) => ids.has(n.id)).map((n) => ({
      ...n,
      grau: grau.get(n.id) ?? 0,
      livroId:
        n.tipo === "livro" ? livroPorArquivo.get(arquivoDoNo(n.id))?.id : undefined,
    }));

    return { nodes, edges };
  }

  /**
   * O demo não tem topologia: as fixtures são um acervo sintético, não um disco
   * real — inventar pastas/repos falsos daria a impressão de que a camada existe
   * sem entregar a "rede de influência" que ela promete. Devolve camada vazia
   * (contrato: nunca lança). A UI mantém o toggle visível — não há como saber que
   * a camada está vazia antes de pedir — mas avisa na tela quando ela volta sem
   * nós, em vez de deixar o botão ligado e aparentemente sem efeito.
   */
  async grafoTopologia(): Promise<GrafoTopologiaResultado> {
    return {
      nodes: [],
      edges: [],
      meta: {
        geradoEm: "",
        versao: "",
        totalNos: 0,
        totalArestas: 0,
        arestasFiltradas: 0,
        arestasMostradas: 0,
        truncado: false,
        planosDisponiveis: [],
        tiposNoDisponiveis: [],
      },
    };
  }

  /** Sem camada de topologia, não há o que quebrar ao mover — null é o mesmo
   *  "nenhum nó cobre esse caminho" que o provider real devolve. */
  async impactoDeMover(): Promise<ImpactoDeMover | null> {
    return null;
  }

  async grafoReferencias(opts: GrafoReferenciasOpts): Promise<GrafoResultado> {
    const ativos = REFERENCIAS.filter((p) => {
      const ehVideo = p.videoIdx.length > 0;
      return ehVideo ? opts.videos : opts.refs;
    });

    const porUser = new Map<string, number>();
    for (const p of ativos) porUser.set(p.user, (porUser.get(p.user) ?? 0) + 1);

    const nodes: KgNode[] = [];
    const edges: KgEdge[] = [];
    const grau = new Map<string, number>();
    const hubs = new Set<string>();
    let eid = -1;
    const liga = (src: string, rel: string, dst: string) => {
      edges.push({ id: eid--, src, rel, dst, status: "confirmed", n_fontes: 1, peso: 1 });
      grau.set(src, (grau.get(src) ?? 0) + 1);
      grau.set(dst, (grau.get(dst) ?? 0) + 1);
    };
    for (const p of ativos) {
      const ehVideo = p.videoIdx.length > 0;
      const id = `ref:${p.code}`;
      nodes.push({
        id,
        label: p.caption ? cortaTexto(p.caption, 48) : `@${p.user}/${p.code}`,
        tipo: ehVideo ? "video" : "referencia",
        igUrl: p.igUrl,
      });
      if ((porUser.get(p.user) ?? 0) >= 2) {
        const perfilId = `perfil:${p.user}`;
        if (!hubs.has(perfilId)) {
          hubs.add(perfilId);
          nodes.push({ id: perfilId, label: `@${p.user}`, tipo: "perfil" });
        }
        liga(id, "por", perfilId);
      }
      for (const c of p.colecoes) {
        const colId = `col-ig:${c}`;
        if (!hubs.has(colId)) {
          hubs.add(colId);
          nodes.push({ id: colId, label: c, tipo: "colecao-ig" });
        }
        liga(id, "salvo em", colId);
      }
    }
    for (const n of nodes) n.grau = grau.get(n.id) ?? 0;
    return { nodes, edges };
  }

  async evidencias(edgeId: number): Promise<EvidenciaEnriquecida[]> {
    const edge = EDGES.find((e) => e.id === edgeId);
    if (!edge) return [];
    const ladoLivro = edge.src.startsWith("livro:") ? edge.src : edge.dst.startsWith("livro:") ? edge.dst : null;
    const livro = ladoLivro ? livroPorArquivo.get(arquivoDoNo(ladoLivro)) : undefined;
    const conceito = ladoLivro === edge.src ? edge.dst : edge.src;
    return [
      {
        livro: livro?.arquivo ?? "demo",
        chunk_id: `${livro?.arquivo ?? "demo"}#0`,
        trecho: livro
          ? `${livro.resumo} Relação com ${conceito.replace(/-/g, " ")} curada para esta demonstração.`
          : "Relação didática curada no grafo de demonstração; consulte as fontes conectadas para conferir o contexto.",
        confianca: 0.8,
        livroId: livro?.id ?? null,
        livroTitulo: livro?.titulo ?? "Fonte demo",
        formato: livro?.formato ?? null,
        chunkIdx: 0,
        paginaEstimada: null,
        clickup: null,
        youtube: null,
      },
    ];
  }

  async fontesDoConceito(conceitoId: string): Promise<FontesDoConceito> {
    const rows = EDGES.filter(
      (e) => (e.src === conceitoId || e.dst === conceitoId) && e.rel !== "menciona",
    );
    const livros = [
      ...new Set(
        rows
          .flatMap((r) => [r.src, r.dst])
          .filter((x) => x.startsWith("livro:"))
          .map(arquivoDoNo),
      ),
    ];
    const relacoes = [...new Set(rows.map((r) => r.rel))];
    const vizinhos = [
      ...new Set(rows.flatMap((r) => [r.src, r.dst]).filter((x) => x !== conceitoId && !x.startsWith("livro:"))),
    ].slice(0, 12);
    return { livros, relacoes, vizinhos };
  }

  async kgStats(): Promise<KgStats> {
    const conceitos = NODES.filter((n) => n.tipo === "conceito").length;
    const livros = NODES.filter((n) => n.tipo === "livro").length;
    const semLivroSrc = (e: KgEdge) => !e.src.startsWith("livro:");
    const confirmed = EDGES.filter((e) => e.status === "confirmed" && semLivroSrc(e)).length;
    const claimed = EDGES.filter((e) => e.status === "claimed" && semLivroSrc(e)).length;
    const disputed = EDGES.filter((e) => e.status === "disputed").length;
    return { conceitos, livros, confirmed, claimed, disputed };
  }
}
