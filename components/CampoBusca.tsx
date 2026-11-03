"use client";

import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { conferirValor, criarAdiador, registrarEmissao } from "@/lib/busca-adiada";

/** Campo de busca que nunca trava a digitação: o texto vive no estado local e o
 *  pai só é avisado depois de uma pausa, dentro de uma transição interrompível. */
export type CampoBuscaProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  /** Valor do pai: fonte para ressincronizar quando muda por fora (chip, limpar filtros, deep-link). */
  valor: string;
  /** Chamado com o texto depois da pausa (em transição) ou na hora ao limpar, Enter, blur e desmontagem. */
  aoMudar: (texto: string) => void;
  /** Espera, em ms, depois da última tecla (lido na montagem). Padrão 300. */
  atraso?: number;
  /** Enter: descarrega o pendente e chama com o texto atual. */
  aoEnviar?: (texto: string) => void;
};

type Funcoes = { aoMudar: (texto: string) => void };

/** Adiador ligado ao pai: a pausa emite em transição; descarregar emite de forma síncrona. */
function criarMotor(atraso: number, inicial: Funcoes, registrar: (texto: string) => void) {
  // guarda as funções mais recentes do pai
  let funcoes = inicial;
  const atualizar = (novas: Funcoes) => {
    funcoes = novas;
  };
  let sincrono = false;
  const adiador = criarAdiador(atraso, (texto) => {
    registrar(texto);
    if (sincrono || texto === "") funcoes.aoMudar(texto);
    else startTransition(() => funcoes.aoMudar(texto));
  });
  const descarregarSincrono = () => {
    sincrono = true;
    try {
      adiador.descarregar();
    } finally {
      sincrono = false;
    }
  };
  return { adiador, descarregarSincrono, atualizar };
}

export function CampoBusca({
  valor,
  aoMudar,
  atraso = 300,
  aoEnviar,
  onBlur,
  onKeyDown,
  ...resto
}: CampoBuscaProps) {
  const [texto, setTexto] = useState(valor);
  const [valorAnterior, setValorAnterior] = useState(valor);
  // emissões que o pai ainda não devolveu (o eco pode chegar atrasado e fora do último texto)
  const [emitidos, setEmitidos] = useState<string[]>([]);
  const [ciclo, setCiclo] = useState(0);
  const [motor] = useState(() => criarMotor(atraso, { aoMudar }, (t) => setEmitidos((l) => registrarEmissao(l, t))));
  const { adiador, descarregarSincrono, atualizar } = motor;

  // ressincroniza se o pai mudou por fora; eco de qualquer emissão anterior não mexe no texto
  if (valor !== valorAnterior) {
    setValorAnterior(valor);
    const conferencia = conferirValor(emitidos, valor);
    if (conferencia.externo) {
      setTexto(valor);
      setCiclo((c) => c + 1);
    }
    if (conferencia.emitidos.length !== emitidos.length) setEmitidos(conferencia.emitidos);
  }

  // funções mais recentes sem recriar o adiador
  useLayoutEffect(() => {
    atualizar({ aoMudar });
  });

  // valor adotado de fora descarta o que estava pendente
  useLayoutEffect(() => {
    adiador.cancelar();
  }, [ciclo, adiador]);

  // desmontagem: entrega o pendente e limpa o relógio
  useEffect(
    () => () => {
      descarregarSincrono();
      adiador.cancelar();
    },
    [adiador, descarregarSincrono],
  );

  const aoDigitar = (e: ChangeEvent<HTMLInputElement>) => {
    setTexto(e.target.value);
    adiador.mudar(e.target.value);
  };

  const aoSair = (e: FocusEvent<HTMLInputElement>) => {
    descarregarSincrono();
    onBlur?.(e);
  };

  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    // Enter durante composição (IME) só confirma a palavra
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    descarregarSincrono();
    aoEnviar?.(texto);
  };

  return <input {...resto} value={texto} onChange={aoDigitar} onBlur={aoSair} onKeyDown={aoTeclar} />;
}
