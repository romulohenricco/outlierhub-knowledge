
import type { KanbanCard, KanbanExecucao } from "./types";

const TAMANHO_PESO: Record<string, number> = { p: 0, s: 0, m: 2, g: 3, l: 3 };
const NIVEL_PESO: Record<string, number> = { subtask: 0, task: 0, bug: 0, incident: 1, story: 2, epic: 3 };
const PRIORIDADE_PESO: Record<string, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 };

function valorDaTag(card: KanbanCard, prefixo: string): string | undefined {
  const tag = card.tags.find((t) => t.toLowerCase().startsWith(prefixo));
  return tag?.slice(prefixo.length).trim().toLowerCase();
}


export function estaBloqueada(card: KanbanCard): boolean {
  return card.tags.some((tag) => {
    const low = tag.toLowerCase();
    return (
      low.startsWith("blocked:") ||
      low.startsWith("blocked-by:") ||
      low === "gate:humano" ||
      low === "gate:human" ||
      low === "bloqueado" // tag solta, sem prefixo (formato legado)
    );
  });
}

function pesoEsforco(card: KanbanCard): number {
  const size = valorDaTag(card, "size:");
  const nivel = valorDaTag(card, "nivel:");
  const pesoSize = size !== undefined && size in TAMANHO_PESO ? TAMANHO_PESO[size] : 1;
  const pesoNivel = nivel !== undefined && nivel in NIVEL_PESO ? NIVEL_PESO[nivel] : 1;
  return pesoSize + pesoNivel;
}

function pesoDependenciaHumana(execucao: KanbanExecucao | null): number {
  if (!execucao) return 1;
  if (execucao.modo === "agente") return 0;
  if (execucao.modo === "misto") return 1;
  return 2; // humano
}

/** Quantos outros tickets destravam assim que este é resolvido — conta quem
 *  tem `blocked-by:<esteId>` nas próprias tags. Sempre calculado sobre TODO
 *  o board recebido (não só a coluna/filtro visível): um ticket em TO DO
 *  pode destravar algo que já está noutra coluna. */
export function calcularFanOut(todosCards: KanbanCard[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const card of todosCards) {
    for (const tag of card.tags) {
      if (tag.toLowerCase().startsWith("blocked-by:")) {
        const alvo = tag.slice("blocked-by:".length).trim().toUpperCase();
        mapa.set(alvo, (mapa.get(alvo) ?? 0) + 1);
      }
    }
  }
  return mapa;
}

function bonusFanOut(fanOut: number): number {
  if (fanOut >= 3) return 3;
  if (fanOut >= 1) return 1.5;
  return 0;
}

/** Score de prioridade pro lote — quanto MENOR, mais cedo entra na cópia.
 *  Bloqueio pesa mais que tudo (é o que trava um loop desacompanhado);
 *  depois quanto de humano o modo de execução exige; depois o esforço
 *  estimado (tamanho+nível); descontado por quantos outros tickets destrava. */
export function pontuarTicket(card: KanbanCard, fanOutPorId: Map<string, number>): number {
  // Peso bem acima da faixa possível de esforço+dependência (até 10) — bloqueio
  // sempre domina o score, nunca é "compensado" por um ticket bloqueado ser
  // pequeno. Testado em kanbanLote.test.ts.
  const bloqueio = estaBloqueada(card) ? 20 : 0;
  const dependeHumano = pesoDependenciaHumana(card.execucao) * 2;
  const esforco = pesoEsforco(card);
  const fanOut = fanOutPorId.get(card.id.toUpperCase()) ?? 0;
  return bloqueio + dependeHumano + esforco - bonusFanOut(fanOut);
}

/** Ordena do ticket mais pronto pra rodar sozinho (rápido, sem depender de
 *  humano — ideal pra loop noturno) pro menos pronto. Em empate: quem
 *  destrava mais coisa primeiro, depois a prioridade do próprio ticket. */
export function ordenarParaLote(cards: KanbanCard[], todosCards: KanbanCard[]): KanbanCard[] {
  const fanOutPorId = calcularFanOut(todosCards);
  return [...cards].sort((a, b) => {
    const diff = pontuarTicket(a, fanOutPorId) - pontuarTicket(b, fanOutPorId);
    if (diff !== 0) return diff;
    const fanA = fanOutPorId.get(a.id.toUpperCase()) ?? 0;
    const fanB = fanOutPorId.get(b.id.toUpperCase()) ?? 0;
    if (fanA !== fanB) return fanB - fanA;
    return (PRIORIDADE_PESO[a.prioridade] ?? 2) - (PRIORIDADE_PESO[b.prioridade] ?? 2);
  });
}

/** Estimativa grosseira de tokens (~4 caracteres/token) — só pra avisar
 *  quando o bloco copiado ficou grande, não pra contagem exata de billing. */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 4);
}
