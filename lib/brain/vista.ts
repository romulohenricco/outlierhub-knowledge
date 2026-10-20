/** Vista do canvas do grafo (zoom + pan): `translate(x, y) scale(k)` com origem no canto
 *  do conteúdo. Funções puras — o hook de interação (components/agente/brain/usePanZoom.ts)
 *  só anima e aplica o resultado. */

export type Vista = { k: number; x: number; y: number };
export type LimiteZoom = { min: number; max: number };

export const LIMITE_ZOOM: LimiteZoom = { min: 0.6, max: 4 };

const prende = (v: number, a: number, b: number) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));

/** Zoom por `fator` mantendo fixo o ponto `ponto` (coordenadas da área, não do conteúdo):
 *  o que estava sob o cursor continua sob o cursor. */
export function zoomEm(v: Vista, ponto: { x: number; y: number }, fator: number, lim: LimiteZoom): Vista {
  const k = prende(v.k * fator, lim.min, lim.max);
  const r = k / v.k;
  return { k, x: ponto.x - (ponto.x - v.x) * r, y: ponto.y - (ponto.y - v.y) * r };
}

/** Mantém pelo menos parte do conteúdo visível: a borda do conteúdo escalado nunca
 *  para além de `margem` da área. Conteúdo menor que a área fica preso dentro dela. */
export function limitarPan(v: Vista, cw: number, ch: number, vw: number, vh: number, margem: number): Vista {
  const x = prende(v.x, vw - v.k * cw - margem, margem);
  const y = prende(v.y, vh - v.k * ch - margem, margem);
  return { k: v.k, x, y };
}


/** Um passo de mola amortecida (integração semi-implícita). Com amortecimento baixo a vista
 *  ultrapassa o alvo e assenta — o zoom ganha peso em vez de deslizar linear. */
export function passoMola(pos: number, vel: number, alvo: number, rigidez: number, amortecimento: number): { pos: number; vel: number } {
  const v = (vel + (alvo - pos) * rigidez) * amortecimento;
  return { pos: pos + v, vel: v };
}
