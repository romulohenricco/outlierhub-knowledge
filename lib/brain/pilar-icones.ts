/** Glifo de cada pilar do grafo, escolhido pelo NOME no arquivo de organização
 *  (campo `icone` do pilar). Nome ausente ou desconhecido cai em "camadas", o ícone
 *  de pilar padrão. Os desenhos vivem em components/agente/brain/icones-pilar.ts. */
export const NOMES_ICONE_PILAR = [
  "alvo",
  "carteira",
  "pessoas",
  "crescimento",
  "chip",
  "mensagem",
  "camadas",
  "paleta",
  "rota",
  "grade",
  "codigo",
] as const;

export type IconePilar = (typeof NOMES_ICONE_PILAR)[number];

export const ICONE_PILAR_PADRAO: IconePilar = "camadas";

export function ehIconePilar(v: unknown): v is IconePilar {
  return typeof v === "string" && (NOMES_ICONE_PILAR as readonly string[]).includes(v);
}

export function iconePilar(nome: string | null | undefined): IconePilar {
  return ehIconePilar(nome) ? nome : ICONE_PILAR_PADRAO;
}
