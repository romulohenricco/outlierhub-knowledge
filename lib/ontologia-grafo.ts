/**
 * Ontologia → grafo (árvore + relações semânticas). Função PURA: recebe a ontologia
 * já lida e normalizada (`getOntologia()`) e devolve nós/relações serializáveis.
 * Raiz → camadas → itens; a hierarquia vem de `pai`, as relações de `ligacoes`.
 * Robusta a dado ruim: `pai` circular é desfeito, ligação para nó inexistente é
 * descartada, nunca exceção.
 */
import type { Ontologia } from "./ontologia";
import { COR_RAIZ, corDaCamada, corDoStatus } from "./ontologia-cores";

export type OntKind = "raiz" | "camada" | "item";

export type OntNo = {
  id: string;
  parent: string | null;
  /** id da camada do usuário ("" na raiz) */
  camada: string;
  kind: OntKind;
  label: string;
  /** item: rótulo da camada; camada: "camada"; raiz: "ontologia" */
  tag: string;
  /** texto livre do arquivo; "" quando o item não tem */
  status: string;
  resumo: string;
  metrica?: { valor: number; rotulo: string };
  facts: { label: string; value: string }[];
  /** `fonte` do item, só exibida */
  path?: string;
  /** cor do nó: a da camada (a raiz tem a sua) */
  cor: string;
  /** cor do selo de status (vale só se `status` não é vazio) */
  corStatus: string;
  /** posição da camada na ordem de exibição: "01", "02"… (a raiz é "00") */
  codigo: string;
};

export type OntRel = { source: string; target: string; verbo: string };

const VERBO_PADRAO = "liga a";

const idCamada = (c: string) => `camada:${c}`;
const idItem = (c: string, i: string) => `item:${c}/${i}`;

export function montarGrafoOntologia(o: Ontologia): { nodes: OntNo[]; links: OntRel[] } {
  const nodes: OntNo[] = [];
  const ids = new Set<string>();
  const links: OntRel[] = [];

  /** Adiciona um nó garantindo id único (sufixo -2, -3… em colisão). Devolve o id final. */
  const add = (n: Omit<OntNo, "facts" | "resumo" | "tag" | "status" | "corStatus"> & Partial<OntNo>): string => {
    let id = n.id;
    for (let i = 2; ids.has(id); i++) id = `${n.id}-${i}`;
    ids.add(id);
    nodes.push({ facts: [], resumo: "", tag: "", status: "", corStatus: "", ...n, id });
    return id;
  };

  const camadas = o?.camadas ?? [];
  const statusCores = o?.statusCores ?? {};
  const totalItens = camadas.reduce((t, c) => t + (c.itens?.length ?? 0), 0);

  add({
    id: "raiz",
    parent: null,
    camada: "",
    kind: "raiz",
    label: o?.titulo || "Ontologia",
    tag: "ontologia",
    facts: [
      { label: "camadas", value: String(camadas.length) },
      { label: "itens", value: String(totalItens) },
      ...(o?.descartes?.ligacoes ? [{ label: "ligações descartadas", value: String(o.descartes.ligacoes) }] : []),
      ...(o?.descartes?.itens ? [{ label: "itens descartados", value: String(o.descartes.itens) }] : []),
    ],
    cor: COR_RAIZ,
    codigo: "00",
  });

  // ids finais dos nós (a colisão pode renomear): chave "camada\0item"
  const noDoItem = new Map<string, string>();

  camadas.forEach((c, ci) => {
    const codigo = String(ci + 1).padStart(2, "0");
    const cor = corDaCamada(c.id, c.cor);
    const itens = c.itens ?? [];
    const idCam = add({
      id: idCamada(c.id),
      parent: "raiz",
      camada: c.id,
      kind: "camada",
      label: c.rotulo,
      tag: "camada",
      resumo: c.descricao ?? "",
      metrica: { valor: itens.length, rotulo: "itens" },
      facts: [{ label: "id", value: c.id }],
      cor,
      codigo,
    });

    // pai efetivo: existe na camada e não fecha ciclo (membros de ciclo voltam para a camada)
    const porId = new Map(itens.map((i) => [i.id, i]));
    const paiDe = (id: string) => {
      const p = porId.get(id)?.pai;
      return p && p !== id && porId.has(p) ? p : undefined;
    };
    const fechaCiclo = (id: string) => {
      const visto = new Set<string>([id]);
      for (let p = paiDe(id); p; p = paiDe(p)) {
        if (p === id) return true;
        if (visto.has(p)) return false; // o ciclo é de outro; este só desemboca nele
        visto.add(p);
      }
      return false;
    };
    const paiEfetivo = new Map<string, string | undefined>();
    for (const it of itens) paiEfetivo.set(it.id, fechaCiclo(it.id) ? undefined : paiDe(it.id));

    // pai antes de filho, para o `parent` já existir em `ids`
    const prof = (id: string): number => {
      let n = 0;
      for (let p = paiEfetivo.get(id); p && n <= itens.length; p = paiEfetivo.get(p)) n++;
      return n;
    };
    const ordenados = [...itens].sort((a, b) => prof(a.id) - prof(b.id));

    for (const it of ordenados) {
      const pai = paiEfetivo.get(it.id);
      const status = it.status ?? "";
      const id = add({
        id: idItem(c.id, it.id),
        parent: (pai && noDoItem.get(`${c.id}\0${pai}`)) || idCam,
        camada: c.id,
        kind: "item",
        label: it.nome,
        tag: c.rotulo,
        status,
        resumo: it.descricao ?? "",
        path: it.fonte,
        facts: Object.entries(it.dados ?? {}).map(([label, value]) => ({ label, value })),
        cor,
        corStatus: status ? corDoStatus(status, statusCores) : "",
        codigo,
      });
      noDoItem.set(`${c.id}\0${it.id}`, id);
    }
  });

  for (const c of camadas) {
    for (const it of c.itens ?? []) {
      const origem = noDoItem.get(`${c.id}\0${it.id}`);
      if (!origem) continue;
      for (const l of it.ligacoes ?? []) {
        const alvo = noDoItem.get(`${l.camada}\0${l.item}`);
        if (alvo && alvo !== origem) links.push({ source: origem, target: alvo, verbo: l.rotulo || VERBO_PADRAO });
      }
    }
  }

  return { nodes, links };
}
