/** Aba Neural: FERRAMENTAS → EXECUTORES → TAREFAS → PILARES → MEMÓRIA.
 *  Cada feixe é uma relação REAL (uso de ferramenta, tarefa atribuída, pertencimento
 *  a pilar, filho de squad). Pilares de fonte entram por squad (os maiores). */
import type { PilarCena } from "./cena";
import type { PilarFonte } from "./fontes";
import type { OrgData } from "./tipos";

export type NoNeural = { id: string; rotulo: string; cor: string };
export type ColunaNeural = { id: "ferramentas" | "executores" | "tarefas" | "pilares" | "memoria"; titulo: string; nos: NoNeural[] };
export type Feixe = { de: string; para: string; cor: string };
export type Neural = { colunas: ColunaNeural[]; feixes: Feixe[] };

export const SQUADS_POR_FONTE_NEURAL = 6;

export function montarNeural(
  pilares: PilarCena[],
  org: OrgData | null,
  fontes: PilarFonte[],
  totalNotas: number | null,
): Neural {
  const corPilar = new Map(pilares.map((p) => [p.id, p.cor]));
  const ferramentas: NoNeural[] = [];
  const executores: NoNeural[] = [];
  const tarefas: NoNeural[] = [];
  const feixes: Feixe[] = [];

  if (org) {
    // EXECUTORES = agentes (pessoas não são worker); FERRAMENTAS = uma linha por ferramenta do catálogo
    const execs = org.agentes
      .map((a) => ({ id: a.id, nome: a.nome, pilarId: a.pilarId, ferr: a.ferramentas }))
      .sort((a, b) => a.ferr[0]?.localeCompare(b.ferr[0] ?? "") || a.nome.localeCompare(b.nome));
    for (const e of execs) executores.push({ id: e.id, rotulo: e.nome, cor: corPilar.get(e.pilarId) ?? "#888" });
    const porFerramenta = new Map<string, { id: string; cor: string }[]>();
    for (const e of execs) {
      for (const t of e.ferr) (porFerramenta.get(t) ?? porFerramenta.set(t, []).get(t)!).push({ id: e.id, cor: corPilar.get(e.pilarId) ?? "#888" });
    }
    for (const t of [...org.ferramentas].sort((a, b) => a.nome.localeCompare(b.nome))) {
      const usos = porFerramenta.get(t.id) ?? [];
      const id = `in:${t.id}`;
      ferramentas.push({ id, rotulo: t.nome.toUpperCase(), cor: usos[0]?.cor ?? "#888" });
      for (const u of usos) feixes.push({ de: id, para: u.id, cor: u.cor });
    }
    const executorExiste = new Set(execs.map((e) => e.id));
    for (const t of org.tarefas) {
      const cor = corPilar.get(t.pilarId) ?? "#888";
      tarefas.push({ id: t.id, rotulo: t.titulo, cor });
      if (executorExiste.has(t.executorId)) feixes.push({ de: t.executorId, para: t.id, cor });
    }
  }

  for (const f of fontes) {
    const ids = new Set(f.entidades.map((e) => e.id));
    const filhos = new Map<string, { w: number; s: number }>();
    for (const e of f.entidades) {
      if (!e.squadId || !ids.has(e.squadId)) continue;
      const c = filhos.get(e.squadId) ?? filhos.set(e.squadId, { w: 0, s: 0 }).get(e.squadId)!;
      if (e.kind === "skill") c.s++;
      else if (e.kind !== "squad") c.w++;
    }
    const top = f.entidades
      .filter((e) => e.kind === "squad")
      .sort((a, b) => (filhos.get(b.id)?.w ?? 0) + (filhos.get(b.id)?.s ?? 0) - ((filhos.get(a.id)?.w ?? 0) + (filhos.get(a.id)?.s ?? 0)) || a.nome.localeCompare(b.nome))
      .slice(0, SQUADS_POR_FONTE_NEURAL);
    for (const s of top) {
      const c = filhos.get(s.id) ?? { w: 0, s: 0 };
      tarefas.push({ id: s.id, rotulo: s.nome, cor: f.cor });
      if (c.w > 0) {
        executores.push({ id: `w:${s.id}`, rotulo: `workers ×${c.w}`, cor: f.cor });
        feixes.push({ de: `w:${s.id}`, para: s.id, cor: f.cor });
        if (c.s > 0) {
          ferramentas.push({ id: `in:${s.id}`, rotulo: `skills ×${c.s}`, cor: f.cor });
          feixes.push({ de: `in:${s.id}`, para: `w:${s.id}`, cor: f.cor });
        }
      } else if (c.s > 0) {
        // squad só com skills: o feixe das ferramentas precisa de um nó em EXECUTORES pra manter a regra coluna→coluna+1
        executores.push({ id: `w:${s.id}`, rotulo: "sem workers", cor: f.cor });
        feixes.push({ de: `w:${s.id}`, para: s.id, cor: f.cor });
        ferramentas.push({ id: `in:${s.id}`, rotulo: `skills ×${c.s}`, cor: f.cor });
        feixes.push({ de: `in:${s.id}`, para: `w:${s.id}`, cor: f.cor });
      }
    }
  }

  // TAREFAS → PILARES: tarefa e squad pertencem ao pilar de origem
  const pilarDe = new Map<string, string>();
  for (const t of org?.tarefas ?? []) pilarDe.set(t.id, t.pilarId);
  for (const f of fontes) for (const e of f.entidades) if (e.kind === "squad") pilarDe.set(e.id, f.id);
  // mesma ordem de `listarPilares` (organização, depois fontes)
  const pilaresNeurais: NoNeural[] = pilares.map((p) => ({ id: p.id, rotulo: p.nome, cor: p.cor }));
  for (const h of tarefas) {
    const p = pilarDe.get(h.id);
    if (p && corPilar.has(p)) feixes.push({ de: h.id, para: p, cor: h.cor });
  }
  const memoria: NoNeural[] = totalNotas === null ? [] : [{ id: "memoria", rotulo: `${totalNotas} notas`, cor: "#fb923c" }];
  if (memoria.length) for (const p of pilares) feixes.push({ de: p.id, para: "memoria", cor: p.cor });

  const ids = new Set([...ferramentas, ...executores, ...tarefas, ...pilaresNeurais, ...memoria].map((n) => n.id));
  return {
    colunas: [
      { id: "ferramentas", titulo: "FERRAMENTAS", nos: ferramentas },
      { id: "executores", titulo: "EXECUTORES", nos: executores },
      { id: "tarefas", titulo: "TAREFAS", nos: tarefas },
      { id: "pilares", titulo: "PILARES", nos: pilaresNeurais },
      { id: "memoria", titulo: "MEMÓRIA", nos: memoria },
    ],
    feixes: feixes.filter((f) => ids.has(f.de) && ids.has(f.para)),
  };
}
