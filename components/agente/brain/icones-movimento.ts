/** Como cada glifo se move no grafo. `respira`: pulso lento contínuo (hubs e agentes, que estão
 *  "vivos"); `firme`: parado, só reage ao hover. Some com `prefers-reduced-motion`. */
export const MOVIMENTO_GLIFO: Partial<Record<string, "respira" | "firme">> = {
  pilar: "respira",
  agente: "respira",
  worker: "respira",
  squad: "respira",
  humano: "respira",
  ferramenta: "firme",
  skill: "firme",
  tarefa: "firme",
  nota: "firme",
};
