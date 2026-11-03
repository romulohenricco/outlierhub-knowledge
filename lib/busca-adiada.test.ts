import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conferirValor, criarAdiador, registrarEmissao } from "./busca-adiada";

describe("criarAdiador", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("só emite depois da pausa", () => {
    const emitir = vi.fn();
    const a = criarAdiador(300, emitir);
    a.mudar("ab");
    expect(a.pendente()).toBe(true);
    vi.advanceTimersByTime(299);
    expect(emitir).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emitir).toHaveBeenCalledExactlyOnceWith("ab");
    expect(a.pendente()).toBe(false);
  });

  it("cada tecla reinicia o relógio e só o último texto sai", () => {
    const emitir = vi.fn();
    const a = criarAdiador(300, emitir);
    a.mudar("a");
    vi.advanceTimersByTime(200);
    a.mudar("ab");
    vi.advanceTimersByTime(200);
    a.mudar("abc");
    vi.advanceTimersByTime(299);
    expect(emitir).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emitir).toHaveBeenCalledExactlyOnceWith("abc");
  });

  it("texto vazio emite na hora e descarta o que esperava", () => {
    const emitir = vi.fn();
    const a = criarAdiador(300, emitir);
    a.mudar("abc");
    a.mudar("");
    expect(emitir).toHaveBeenCalledExactlyOnceWith("");
    vi.advanceTimersByTime(1000);
    expect(emitir).toHaveBeenCalledTimes(1);
    expect(a.pendente()).toBe(false);
  });

  it("descarregar emite já o pendente e cancela o relógio", () => {
    const emitir = vi.fn();
    const a = criarAdiador(300, emitir);
    a.mudar("abc");
    a.descarregar();
    expect(emitir).toHaveBeenCalledExactlyOnceWith("abc");
    vi.advanceTimersByTime(1000);
    expect(emitir).toHaveBeenCalledTimes(1);
  });

  it("descarregar sem pendente não emite", () => {
    const emitir = vi.fn();
    const a = criarAdiador(300, emitir);
    a.descarregar();
    a.mudar("x");
    vi.advanceTimersByTime(300);
    a.descarregar();
    expect(emitir).toHaveBeenCalledExactlyOnceWith("x");
  });

  it("cancelar descarta o pendente sem emitir", () => {
    const emitir = vi.fn();
    const a = criarAdiador(300, emitir);
    a.mudar("abc");
    a.cancelar();
    expect(a.pendente()).toBe(false);
    vi.advanceTimersByTime(1000);
    a.descarregar();
    expect(emitir).not.toHaveBeenCalled();
  });

  it("segue funcionando depois de emitir e de cancelar", () => {
    const emitir = vi.fn();
    const a = criarAdiador(100, emitir);
    a.mudar("um");
    vi.advanceTimersByTime(100);
    a.mudar("dois");
    a.cancelar();
    a.mudar("tres");
    vi.advanceTimersByTime(100);
    expect(emitir.mock.calls).toEqual([["um"], ["tres"]]);
  });
});

describe("registrarEmissao", () => {
  it("acumula emissões em ordem e ignora repetição seguida", () => {
    expect(registrarEmissao([], "a")).toEqual(["a"]);
    expect(registrarEmissao(["a"], "ab")).toEqual(["a", "ab"]);
    expect(registrarEmissao(["a", "ab"], "ab")).toEqual(["a", "ab"]);
    expect(registrarEmissao(["ab"], "a")).toEqual(["ab", "a"]);
  });

  it("não cresce sem limite quando o pai nunca ecoa", () => {
    let lista: string[] = [];
    for (let i = 0; i < 100; i++) lista = registrarEmissao(lista, `t${i}`);
    expect(lista.length).toBeLessThanOrEqual(20);
    expect(lista[lista.length - 1]).toBe("t99");
  });
});

describe("conferirValor", () => {
  it("sem emissões, qualquer mudança é externa", () => {
    expect(conferirValor([], "chip")).toEqual({ externo: true, emitidos: [] });
  });

  it("eco da última emissão zera a lista", () => {
    expect(conferirValor(["a", "ab"], "ab")).toEqual({ externo: false, emitidos: [] });
  });

  it("eco atrasado de emissão antiga não é mudança externa e guarda as mais novas", () => {
    expect(conferirValor(["ab", "abc", "abcd"], "ab")).toEqual({ externo: false, emitidos: ["abc", "abcd"] });
    expect(conferirValor(["abc", "abcd"], "abc")).toEqual({ externo: false, emitidos: ["abcd"] });
    expect(conferirValor(["abcd"], "abcd")).toEqual({ externo: false, emitidos: [] });
  });

  it("pai que pula ecos intermediários também é eco", () => {
    expect(conferirValor(["ab", "abc", "abcd"], "abc")).toEqual({ externo: false, emitidos: ["abcd"] });
  });

  it("valor que nunca foi emitido é externo e limpa a lista", () => {
    expect(conferirValor(["ab", "abc"], "outro")).toEqual({ externo: true, emitidos: [] });
  });

  it("eco atrasado de ponta a ponta: a digitação sobrevive à sequência de ecos", () => {
    let emitidos: string[] = [];
    for (const t of ["ab", "abc", "abcd"]) emitidos = registrarEmissao(emitidos, t);
    const externos: boolean[] = [];
    for (const eco of ["ab", "abc", "abcd"]) {
      const r = conferirValor(emitidos, eco);
      externos.push(r.externo);
      emitidos = r.emitidos;
    }
    expect(externos).toEqual([false, false, false]);
    expect(emitidos).toEqual([]);
  });
});
