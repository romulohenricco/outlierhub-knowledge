/** Adiador de busca: junta as teclas e só emite o texto depois de uma pausa.
 *  Lógica pura (sem React), testável com timers falsos. */

export interface AdiadorBusca {
  /** Novo texto digitado: agenda a emissão após a pausa (vazio emite na hora). */
  mudar(texto: string): void;
  /** Emite já o texto pendente (se houver) e cancela o relógio. */
  descarregar(): void;
  /** Descarta o texto pendente sem emitir. */
  cancelar(): void;
  /** Há texto esperando a pausa? */
  pendente(): boolean;
}

export function criarAdiador(atrasoMs: number, emitir: (texto: string) => void): AdiadorBusca {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let texto: string | null = null;

  const limpar = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const disparar = () => {
    const t = texto;
    texto = null;
    limpar();
    if (t !== null) emitir(t);
  };

  return {
    mudar(novo) {
      limpar();
      texto = novo;
      // limpar o campo não espera: a lista volta ao normal na hora
      if (novo === "") disparar();
      else timer = setTimeout(disparar, atrasoMs);
    },
    descarregar: disparar,
    cancelar() {
      texto = null;
      limpar();
    },
    pendente: () => texto !== null,
  };
}

/** Quantas emissões sem eco o campo lembra (o pai pode nunca devolver algumas). */
const LIMITE_EMITIDOS = 20;

/** Anota um texto recém-emitido na lista de emissões que ainda esperam eco do pai. */
export function registrarEmissao(emitidos: readonly string[], texto: string): string[] {
  if (emitidos[emitidos.length - 1] === texto) return emitidos.slice();
  return [...emitidos, texto].slice(-LIMITE_EMITIDOS);
}

export interface ConferenciaValor {
  /** true: o valor veio de fora (chip, limpar filtros, deep-link) e deve ser adotado. */
  externo: boolean;
  /** Emissões que continuam esperando eco depois desta conferência. */
  emitidos: string[];
}

/** Decide se um novo valor do pai é eco de algo que o campo emitiu ou mudança externa.
 *  O pai pode devolver os valores com atraso (URL, estado assíncrono): um eco antigo
 *  ("ab") chega quando o campo já emitiu "abc" e não pode desfazer a digitação. */
export function conferirValor(emitidos: readonly string[], valor: string): ConferenciaValor {
  // igual à última emissão: o pai alcançou o campo, nada mais pendente
  if (emitidos.length > 0 && emitidos[emitidos.length - 1] === valor) return { externo: false, emitidos: [] };
  const i = emitidos.indexOf(valor);
  // eco de emissão antiga: descarta ela e as anteriores, as mais novas ainda vão ecoar
  if (i >= 0) return { externo: false, emitidos: emitidos.slice(i + 1) };
  return { externo: true, emitidos: [] };
}
