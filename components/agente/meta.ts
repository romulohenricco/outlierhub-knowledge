import type { EcoKind, EcoProcedencia, EcoUsoStatus } from "@/lib/types";

/** Cores dos grafos (canvas/SVG não leem classes Tailwind). Mesma família da
 *  paleta dos badges do catálogo, saturação média pra funcionar nos temas claro
 *  e escuro. */
export const COR_KIND: Record<EcoKind, string> = {
  squad: "#d4a853",
  agent: "#4ade80",
  skill: "#a78bfa",
  workflow: "#5b8cff",
  clone: "#fb923c",
  shadow: "#94a3b8",
  worker: "#22d3ee",
  engine: "#f87171",
  repo: "#e2c06a",
};

export const COR_PROCEDENCIA: Record<EcoProcedencia, string> = {
  propria: "#34d399",
  adotada: "#fbbf24",
  terceiro: "#38bdf8",
};

export const ROTULO_PROCEDENCIA: Record<EcoProcedencia, string> = {
  propria: "própria",
  adotada: "adotada",
  terceiro: "terceiro",
};

export const COR_USO: Record<EcoUsoStatus | "nao-medido", string> = {
  frequente: "#34d399",
  ocasional: "#38bdf8",
  raro: "#fbbf24",
  "sem-sinal": "#6b7280",
  "nao-medido": "#3b4252",
};

export const ROTULO_USO: Record<EcoUsoStatus | "nao-medido", string> = {
  frequente: "frequente",
  ocasional: "ocasional",
  raro: "raro",
  "sem-sinal": "sem sinal",
  "nao-medido": "não medido",
};

/** O que colore os nós. */
export type Lente = "tipo" | "procedencia" | "uso";

export const LENTES: { id: Lente; rotulo: string }[] = [
  { id: "tipo", rotulo: "Tipo" },
  { id: "procedencia", rotulo: "Procedência" },
  { id: "uso", rotulo: "Uso" },
];

export function corDoNo(
  n: { kind: EcoKind; procedencia: EcoProcedencia; uso: EcoUsoStatus | null },
  lente: Lente,
): string {
  if (lente === "procedencia") return COR_PROCEDENCIA[n.procedencia];
  if (lente === "uso") return COR_USO[n.uso ?? "nao-medido"];
  return COR_KIND[n.kind];
}

/** Itens da legenda de cada lente, na ordem de exibição. */
export function chavesDaLente(lente: Lente): { chave: string; rotulo: string; cor: string }[] {
  if (lente === "procedencia")
    return (Object.keys(COR_PROCEDENCIA) as EcoProcedencia[]).map((p) => ({
      chave: p,
      rotulo: ROTULO_PROCEDENCIA[p],
      cor: COR_PROCEDENCIA[p],
    }));
  if (lente === "uso")
    return (Object.keys(COR_USO) as (EcoUsoStatus | "nao-medido")[]).map((u) => ({
      chave: u,
      rotulo: ROTULO_USO[u],
      cor: COR_USO[u],
    }));
  return (Object.keys(COR_KIND) as EcoKind[]).map((k) => ({ chave: k, rotulo: k, cor: COR_KIND[k] }));
}

export function chaveDoNo(
  n: { kind: EcoKind; procedencia: EcoProcedencia; uso: EcoUsoStatus | null },
  lente: Lente,
): string {
  return lente === "procedencia" ? n.procedencia : lente === "uso" ? (n.uso ?? "nao-medido") : n.kind;
}
