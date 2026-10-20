/** Tipos do grafo de /agente (radial e neural): organização (pilares, tarefas,
 *  agentes, pessoas e ferramentas, lida de um JSON seu) + inventário do
 *  ecossistema + memória (notas .md). Nada aqui é número fixo; formato do
 *  arquivo de organização em docs/agente-registro.md. */
import type { EcoFonteEstado } from "../types";

/** Os ids de toda a organização são prefixados na leitura (`pilar:`, `agente:`,
 *  `pessoa:`, `tarefa:`, `ferramenta:`) para nunca colidirem entre categorias
 *  nem com os ids do inventário. */
export type PilarOrg = {
  id: string;
  nome: string;
  tagline: string;
  ordem: number;
  /** cor "#rrggbb" escolhida no arquivo; ausente = paleta */
  cor: string | null;
  /** nome do ícone (ver ICONES_PILAR em pilar-icones.ts); ausente = padrão */
  icone: string | null;
};

export type AgenteOrg = {
  id: string;
  pilarId: string;
  nome: string;
  papel: string;
  status: string;
  /** função do agente (lente "Função"): ex. "lead", "worker" */
  funcao: string;
  descricao: string;
  modelo: string;
  /** ids de `ferramentas` já resolvidos (só os que existem na lista). */
  ferramentas: string[];
  paiId: string | null;
  /** onde o agente roda */
  ambiente: string;
};

/** DADO PESSOAL: o `nome` só existe na renderização local da página. */
export type PessoaOrg = {
  id: string;
  pilarId: string;
  nome: string;
  papel: string;
  ferramentas: string[];
};

export type TarefaOrg = {
  id: string;
  pilarId: string;
  titulo: string;
  resumo: string;
  passos: string[];
  executorTipo: "agent" | "person";
  executorId: string;
};

export type FerramentaOrg = {
  id: string;
  nome: string;
  categoria: string;
  status: string;
  descricao: string;
};

export type ExecucaoOrg = {
  agenteId: string;
  iniciadoEm: string;
  terminadoEm: string | null;
  ok: boolean | null;
  resumo: string;
  status: string;
};

export type OrgData = {
  pilares: PilarOrg[];
  agentes: AgenteOrg[];
  pessoas: PessoaOrg[];
  tarefas: TarefaOrg[];
  ferramentas: FerramentaOrg[];
  /** Última execução por agente. Ausente = sem registro. */
  ultimaExecucao: Record<string, ExecucaoOrg>;
};

export type OrgLeitura =
  | { ok: true; data: OrgData; /** linhas descartadas por inconsistência (aviso, não erro) */ avisos: string[] }
  | { ok: false; estado: EcoFonteEstado; motivo: string };

export type MemHub = { id: string; nome: string; total: number };
export type MemNota = {
  id: string;
  titulo: string;
  hub: string;
  grau: number;
  /** caminho relativo na pasta de notas (mostrado como SOURCE no painel) */
  caminho: string;
  /** contagem de palavras do corpo (sem o frontmatter) */
  palavras: number;
  /** começo do corpo, sem frontmatter, pro painel de detalhe */
  trecho: string;
};
export type Memoria = {
  hubs: MemHub[];
  /** Notas desenhadas (recorte por regra explícita — ver `montarMemoria`). */
  notas: MemNota[];
  links: [string, string][];
  /** Total de notas .md encontradas / com ao menos 1 link resolvido. */
  total: number;
  conectadas: number;
  /** Links no texto que não apontam pra nenhuma nota existente (ex.: [[MAP]]). */
  naoResolvidos: number;
};

export type BrainDados = {
  org: OrgLeitura;
  memoria: Memoria | null;
  /** por que não há notas (pasta ausente, fora da raiz, sem .md ou erro de leitura) */
  memoriaMotivo?: string;
  /** true só quando a leitura FALHOU (exceção); pasta ausente é o estado normal de partida */
  memoriaFalha?: boolean;
};

/** Estado de partida da página: nada configurado, nada carregado. */
export const BRAIN_VAZIO: BrainDados = {
  org: { ok: false, estado: "ausente", motivo: "não carregado" },
  memoria: null,
};
