/**
 * Recorte por DATA do /grafo — função pura, sem node:fs, roda no cliente.
 *
 * O que é a "data" de um nó (atribuída no servidor, ver lib/datas-disco.ts):
 *  - livro, referência IG, skill, squad, pasta da topologia → última modificação
 *    no disco (mtime do arquivo/pasta), ou o sinal de uso/push mais recente
 *  - conceito → herda a obra MAIS ANTIGA que o sustenta (quando entrou no acervo)
 *  - hub (raiz do ecossistema, hub de kind, perfil/coleção IG, plano) → nenhuma:
 *    é `estrutural` e passa sempre, porque esconder o hub desmontaria o desenho
 *    dos nós que passaram no filtro.
 *
 * Datas são strings `YYYY-MM-DD`: a comparação lexicográfica já é cronológica.
 */

export type FiltroData = {
  de?: string;
  ate?: string;
  /** manter nós sem data conhecida (default: esconder e CONTAR) */
  semData?: boolean;
};

type NoDatado = { id: string; data?: string; estrutural?: boolean };
type ArestaPar = { src: string; dst: string };

export const PRESETS_DATA = ["7d", "30d", "90d", "1a"] as const;
export type PresetData = (typeof PRESETS_DATA)[number];

export function filtroDataAtivo(f: FiltroData): boolean {
  return Boolean(f.de || f.ate);
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Início (inclusivo) do preset relativo a `hoje`, em data local. */
export function inicioDoPreset(p: PresetData, hoje = new Date()): string {
  const d = new Date(hoje);
  if (p === "1a") d.setFullYear(d.getFullYear() - 1);
  else d.setDate(d.getDate() - Number(p.slice(0, -1)));
  return iso(d);
}

export function dataMinima(datas: Array<string | null | undefined>): string | undefined {
  let min: string | undefined;
  for (const d of datas) if (d && (!min || d < min)) min = d;
  return min;
}

export function recortarPorData<N extends NoDatado, L extends ArestaPar>(
  nodes: N[],
  links: L[],
  f: FiltroData,
): { links: L[]; ocultosSemData: number } {
  if (!filtroDataAtivo(f)) return { links, ocultosSemData: 0 };
  const porId = new Map(nodes.map((n) => [n.id, n]));
  let ocultosSemData = 0;
  const passa = new Set<string>();
  const estrutural = new Set<string>();
  for (const n of nodes) {
    if (n.estrutural) {
      estrutural.add(n.id);
      passa.add(n.id);
    } else if (!n.data) {
      if (f.semData) passa.add(n.id);
      else ocultosSemData++;
    } else if ((!f.de || n.data >= f.de) && (!f.ate || n.data <= f.ate)) {
      passa.add(n.id);
    }
  }
  const candidatas = links.filter((l) => passa.has(l.src) && passa.has(l.dst));
  // estrutural só fica se ancorar ALGUM nó de conteúdo que passou — senão a
  // espinha raiz→hub sobraria sozinha no canvas, fingindo que há resultado.
  // Âncora transitiva: hub ← entidade que passou; raiz ← hub ancorado.
  const ancorado = new Set<string>();
  for (const l of candidatas) {
    if (!estrutural.has(l.src) && porId.has(l.src)) ancorado.add(l.dst);
    if (!estrutural.has(l.dst) && porId.has(l.dst)) ancorado.add(l.src);
  }
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const l of candidatas) {
      if (estrutural.has(l.src) && estrutural.has(l.dst)) {
        if (ancorado.has(l.src) && !ancorado.has(l.dst)) {
          ancorado.add(l.dst);
          mudou = true;
        }
        if (ancorado.has(l.dst) && !ancorado.has(l.src)) {
          ancorado.add(l.src);
          mudou = true;
        }
      }
    }
  }
  const ok = (id: string) => !estrutural.has(id) || ancorado.has(id);
  return { links: candidatas.filter((l) => ok(l.src) && ok(l.dst)), ocultosSemData };
}
