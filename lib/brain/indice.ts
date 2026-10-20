/** Índice plano de tudo que o grafo conhece: alimenta diretório, busca e o
 *  "ir para o pilar" ao clicar num item. Puro. */
import type { EcoEntity } from "../types";
import type { PilarCena } from "./cena";
import type { PilarFonte } from "./fontes";
import type { Memoria, OrgData } from "./tipos";

export type TipoItem = "pilar" | "tarefa" | "agente" | "humano" | "ferramenta" | "squad" | "worker" | "skill" | "outros" | "nota";
export type Item = { id: string; tipo: TipoItem; rotulo: string; sub: string; pilarId: string | null; ent?: EcoEntity };
export type GrupoItens = { id: TipoItem; titulo: string; itens: Item[] };
export type Indice = { itens: Item[]; grupos: GrupoItens[] };

const TITULO: Record<TipoItem, string> = {
  agente: "Agentes IA",
  humano: "Humanos",
  tarefa: "Tarefas",
  ferramenta: "Ferramentas",
  pilar: "Pilares",
  squad: "Squads",
  worker: "Workers e agentes",
  skill: "Skills",
  outros: "Outros do ecossistema",
  nota: "Notas",
};
const ORDEM: TipoItem[] = ["agente", "humano", "tarefa", "ferramenta", "pilar", "squad", "worker", "skill", "outros", "nota"];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function montarIndice(pilares: PilarCena[], f: OrgData | null, fontes: PilarFonte[], mem: Memoria | null): Indice {
  const nomePilar = new Map(pilares.map((p) => [p.id, p.nome]));
  const itens: Item[] = pilares.map((p) => ({ id: p.id, tipo: "pilar", rotulo: p.nome, sub: p.origem === "fonte" ? "fonte" : "organização", pilarId: p.id }));
  if (f) {
    for (const a of f.agentes) itens.push({ id: a.id, tipo: "agente", rotulo: a.nome, sub: nomePilar.get(a.pilarId) ?? "", pilarId: a.pilarId });
    for (const h of f.pessoas) itens.push({ id: h.id, tipo: "humano", rotulo: h.nome, sub: nomePilar.get(h.pilarId) ?? "", pilarId: h.pilarId });
    for (const t of f.tarefas) itens.push({ id: t.id, tipo: "tarefa", rotulo: t.titulo, sub: nomePilar.get(t.pilarId) ?? "", pilarId: t.pilarId });
    const donoDaFerramenta = new Map<string, string>();
    for (const a of f.agentes) for (const t of a.ferramentas) if (!donoDaFerramenta.has(t)) donoDaFerramenta.set(t, a.pilarId);
    for (const t of f.ferramentas) {
      const p = donoDaFerramenta.get(t.id) ?? null;
      itens.push({ id: t.id, tipo: "ferramenta", rotulo: t.nome, sub: p ? (nomePilar.get(p) ?? "") : t.categoria, pilarId: p });
    }
  }
  for (const g of fontes) {
    for (const e of g.entidades) {
      const tipo: TipoItem = e.kind === "squad" ? "squad" : e.kind === "skill" ? "skill" : ["worker", "agent", "clone", "shadow"].includes(e.kind) ? "worker" : "outros";
      itens.push({ id: e.id, tipo, rotulo: e.nome, sub: g.nome, pilarId: g.id, ent: e });
    }
  }
  for (const n of mem?.notas ?? []) itens.push({ id: n.id, tipo: "nota", rotulo: n.titulo, sub: n.hub, pilarId: null });

  const grupos = ORDEM.map((id) => ({ id, titulo: TITULO[id], itens: itens.filter((i) => i.tipo === id) })).filter((g) => g.itens.length > 0);
  return { itens, grupos };
}

export function buscar(ind: Indice, q: string, max = 8): Item[] {
  const t = norm(q.trim());
  if (!t) return [];
  const exatos: Item[] = [];
  const resto: Item[] = [];
  for (const i of ind.itens) {
    const r = norm(i.rotulo);
    if (r.startsWith(t)) exatos.push(i);
    else if (r.includes(t)) resto.push(i);
    if (exatos.length >= max) break;
  }
  return [...exatos, ...resto].slice(0, max);
}
