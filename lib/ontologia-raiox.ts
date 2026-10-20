/**
 * Lógica PURA do painel de detalhe e do modal Raio-X da ontologia: fatos visíveis,
 * relações agrupadas com direção, irmãos (navegação i/n) e campos da aba Dados.
 * Sem React nem I/O — testável isolada.
 */
import type { OntNo, OntRel } from "./ontologia-grafo";

export const MAX_FATOS_PAINEL = 6;

export function fatosDoPainel(facts: OntNo["facts"], max = MAX_FATOS_PAINEL) {
  return { visiveis: facts.slice(0, max), resto: Math.max(0, facts.length - max) };
}

export type RelacoesNo = {
  pai: OntNo | null;
  filhos: OntNo[];
  saindo: { no: OntNo; verbo: string }[];
  entrando: { no: OntNo; verbo: string }[];
};

export function relacoesDoNo(
  no: OntNo,
  porId: Map<string, OntNo>,
  filhosDe: Map<string, OntNo[]>,
  links: OntRel[],
): RelacoesNo {
  const saindo: RelacoesNo["saindo"] = [];
  const entrando: RelacoesNo["entrando"] = [];
  for (const l of links) {
    if (l.source === no.id) {
      const alvo = porId.get(l.target);
      if (alvo) saindo.push({ no: alvo, verbo: l.verbo });
    }
    if (l.target === no.id) {
      const origem = porId.get(l.source);
      if (origem) entrando.push({ no: origem, verbo: l.verbo });
    }
  }
  return {
    pai: no.parent ? (porId.get(no.parent) ?? null) : null,
    filhos: filhosDe.get(no.id) ?? [],
    saindo,
    entrando,
  };
}

export type LinhaRelacao = { chave: string; no: OntNo; rotulo: string; dir: "pai" | "filho" | "saindo" | "entrando" };

/** Lista única para o painel: pai, filhos, saindo, entrando. */
export function linhasRelacao(r: RelacoesNo): LinhaRelacao[] {
  const out: LinhaRelacao[] = [];
  if (r.pai) out.push({ chave: `pai:${r.pai.id}`, no: r.pai, rotulo: "pai", dir: "pai" });
  for (const f of r.filhos) out.push({ chave: `filho:${f.id}`, no: f, rotulo: "filho", dir: "filho" });
  r.saindo.forEach((s, i) => out.push({ chave: `s${i}:${s.no.id}:${s.verbo}`, no: s.no, rotulo: s.verbo, dir: "saindo" }));
  r.entrando.forEach((s, i) => out.push({ chave: `e${i}:${s.no.id}:${s.verbo}`, no: s.no, rotulo: s.verbo, dir: "entrando" }));
  return out;
}

export function irmaos(no: OntNo, porId: Map<string, OntNo>, filhosDe: Map<string, OntNo[]>) {
  const lista = no.parent && porId.has(no.parent) ? (filhosDe.get(no.parent) ?? [no]) : [no];
  const achado = lista.findIndex((n) => n.id === no.id);
  const indice = achado < 0 ? 0 : achado;
  return {
    lista,
    indice,
    total: lista.length,
    anterior: indice > 0 ? lista[indice - 1] : null,
    proximo: indice < lista.length - 1 ? lista[indice + 1] : null,
  };
}

export function camposDados(no: OntNo): { chave: string; valor: string }[] {
  const c: { chave: string; valor: string }[] = [
    { chave: "id", valor: no.id },
    { chave: "kind", valor: no.kind },
  ];
  if (no.camada) c.push({ chave: "camada", valor: no.camada });
  if (no.tag) c.push({ chave: "tag", valor: no.tag });
  if (no.status) c.push({ chave: "status", valor: no.status });
  if (no.path) c.push({ chave: "path", valor: no.path });
  if (no.parent) c.push({ chave: "parent", valor: no.parent });
  if (no.metrica) c.push({ chave: "métrica", valor: `${no.metrica.valor} ${no.metrica.rotulo}` });
  for (const f of no.facts) c.push({ chave: f.label, valor: f.value });
  return c;
}

/** Tipo do nó em texto curto: o item mostra a camada a que pertence. */
export function tipoDoNo(no: Pick<OntNo, "kind" | "tag">): string {
  return no.kind === "item" && no.tag ? `${no.tag} · item` : no.kind;
}
