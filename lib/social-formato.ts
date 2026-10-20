/** Formatação pura das telas de /mysocialmedia — sem `node:fs`, serve ao servidor, ao navegador e aos testes. */

/** "tema_exemplo" → "Tema exemplo": nome de reserva para nicho sem entrada em nichos.json. */
export function rotuloNicho(id: string, rotulos: Record<string, string> = {}): string {
  if (rotulos[id]) return rotulos[id];
  const t = id.replace(/[_-]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : id;
}

export function numeroHumano(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** Data local (pt-BR) de um ISO; `null` para vazio ou inválido (nunca "Invalid Date" na tela). */
export function dataHumana(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}
