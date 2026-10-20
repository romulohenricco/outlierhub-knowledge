import { describe, expect, it } from "vitest";
import { LIMITE_ZOOM, limitarPan, passoMola, zoomEm, type Vista } from "./vista";
import { ICONE_PILAR_PADRAO, NOMES_ICONE_PILAR, iconePilar } from "./pilar-icones";

const SEM = { k: 1, x: 0, y: 0 };

describe("zoomEm", () => {
  it("zoom no centro do alvo mantém o ponto sob o cursor no mesmo lugar", () => {
    const ponto = { x: 300, y: 200 };
    const v = zoomEm(SEM, ponto, 2, LIMITE_ZOOM);
    // o ponto do conteúdo que estava sob (300,200) continua sob (300,200)
    const conteudo = { x: (ponto.x - SEM.x) / SEM.k, y: (ponto.y - SEM.y) / SEM.k };
    expect(v.x + conteudo.x * v.k).toBeCloseTo(ponto.x, 6);
    expect(v.y + conteudo.y * v.k).toBeCloseTo(ponto.y, 6);
    expect(v.k).toBeCloseTo(2, 6);
  });

  it("respeita o zoom máximo e o mínimo", () => {
    expect(zoomEm({ k: 3.9, x: 0, y: 0 }, { x: 0, y: 0 }, 10, LIMITE_ZOOM).k).toBe(LIMITE_ZOOM.max);
    expect(zoomEm({ k: 0.7, x: 0, y: 0 }, { x: 0, y: 0 }, 0.01, LIMITE_ZOOM).k).toBe(LIMITE_ZOOM.min);
  });

  it("fator 1 não muda a vista", () => {
    const v: Vista = { k: 1.5, x: -40, y: 12 };
    expect(zoomEm(v, { x: 100, y: 100 }, 1, LIMITE_ZOOM)).toEqual(v);
  });

  it("zoom sucessivo para dentro e para fora volta ao ponto de partida", () => {
    const ponto = { x: 210, y: 90 };
    const ida = zoomEm(SEM, ponto, 1.8, LIMITE_ZOOM);
    const volta = zoomEm(ida, ponto, 1 / 1.8, LIMITE_ZOOM);
    expect(volta.k).toBeCloseTo(1, 6);
    expect(volta.x).toBeCloseTo(0, 6);
    expect(volta.y).toBeCloseTo(0, 6);
  });
});

describe("limitarPan", () => {
  // conteúdo 1000x800 numa área 600x400, margem 48
  const cw = 1000;
  const ch = 800;
  const vw = 600;
  const vh = 400;

  it("não deixa o conteúdo sair inteiro da área (arrasto longe)", () => {
    const v = limitarPan({ k: 1, x: -5000, y: -5000 }, cw, ch, vw, vh, 48);
    expect(v.x).toBeGreaterThanOrEqual(vw - cw - 48);
    expect(v.y).toBeGreaterThanOrEqual(vh - ch - 48);
    const longe = limitarPan({ k: 1, x: 5000, y: 5000 }, cw, ch, vw, vh, 48);
    expect(longe.x).toBeLessThanOrEqual(48);
    expect(longe.y).toBeLessThanOrEqual(48);
  });

  it("mantém a posição quando já está dentro dos limites", () => {
    const v = { k: 1, x: -100, y: -80 };
    expect(limitarPan(v, cw, ch, vw, vh, 48)).toEqual(v);
  });

  it("conteúdo menor que a área fica preso entre a margem esquerda/superior e a direita/inferior", () => {
    // conteúdo 300x200 numa área 600x400: x entre 48 (margem) e 600-300-48 = 252; y entre 48 e 152
    expect(limitarPan({ k: 1, x: 900, y: 900 }, 300, 200, 600, 400, 48)).toEqual({ k: 1, x: 252, y: 152 });
    expect(limitarPan({ k: 1, x: -900, y: -900 }, 300, 200, 600, 400, 48)).toEqual({ k: 1, x: 48, y: 48 });
  });
});


describe("passoMola (zoom com massa)", () => {
  it("converge pro alvo", () => {
    let p = 1, v = 0;
    for (let i = 0; i < 400; i++) ({ pos: p, vel: v } = passoMola(p, v, 2, 0.12, 0.72));
    expect(p).toBeCloseTo(2, 3);
    expect(Math.abs(v)).toBeLessThan(1e-3);
  });

  it("subamortecida: ultrapassa o alvo antes de assentar (sensação de peso)", () => {
    let p = 1, v = 0, passou = false;
    for (let i = 0; i < 200; i++) {
      ({ pos: p, vel: v } = passoMola(p, v, 2, 0.12, 0.72));
      if (p > 2) passou = true;
    }
    expect(passou).toBe(true);
  });
});

describe("iconePilar (ícone por nome)", () => {
  it("cada nome conhecido é aceito; nome desconhecido, nulo ou ausente cai no padrão", () => {
    for (const n of NOMES_ICONE_PILAR) expect(iconePilar(n)).toBe(n);
    expect(iconePilar("nome-desconhecido")).toBe(ICONE_PILAR_PADRAO);
    expect(iconePilar(null)).toBe(ICONE_PILAR_PADRAO);
    expect(iconePilar(undefined)).toBe(ICONE_PILAR_PADRAO);
  });
});
