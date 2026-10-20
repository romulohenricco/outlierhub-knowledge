/** Ligação do grafo como curva solta (quadrática), não reta. O desvio é perpendicular à
 *  ligação e determinístico pelo `seed` (id do par), então o mesmo link sempre curva igual
 *  e a cena não treme entre renders. */
export function trilhaSolta(a: { x: number; y: number }, b: { x: number; y: number }, seed: string): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // hash simples do seed → sinal e fração do desvio (entre 8% e 16% do comprimento)
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const sinal = h & 1 ? 1 : -1;
  const frac = 0.08 + (((h >>> 1) % 1000) / 1000) * 0.08;
  const off = sinal * frac * len;
  const mx = (a.x + b.x) / 2 + (-dy / len) * off;
  const my = (a.y + b.y) / 2 + (dx / len) * off;
  return `M${a.x} ${a.y} Q${mx.toFixed(2)} ${my.toFixed(2)} ${b.x} ${b.y}`;
}
