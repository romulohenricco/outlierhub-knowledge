/** Fixtures SINTÉTICAS dos testes de lib/brain (nenhum dado real). */
import type { EcoEntity, EcoKind } from "../types";
import type { OrgData } from "./tipos";

export const ORG: OrgData = {
  pilares: [
    { id: "pilar:d1", nome: "Pilar A", tagline: "", ordem: 1, cor: null, icone: "alvo" },
    { id: "pilar:d2", nome: "Pilar B", tagline: "", ordem: 2, cor: "#112233", icone: null },
  ],
  agentes: [
    { id: "agente:a1", pilarId: "pilar:d1", nome: "Agente Um", papel: "", status: "ativo", funcao: "worker", descricao: "", modelo: "", ferramentas: ["ferramenta:t1", "ferramenta:t2"], paiId: "agente:a0", ambiente: "local" },
    { id: "agente:a0", pilarId: "pilar:d1", nome: "Coordenação", papel: "", status: "ativo", funcao: "lead", descricao: "", modelo: "", ferramentas: ["ferramenta:t1"], paiId: null, ambiente: "local" },
    { id: "agente:a2", pilarId: "pilar:d2", nome: "Agente Dois", papel: "", status: "ativo", funcao: "lead", descricao: "", modelo: "", ferramentas: ["ferramenta:t2"], paiId: null, ambiente: "local" },
    { id: "agente:a3", pilarId: "pilar:d1", nome: "Sem tarefa", papel: "", status: "planejado", funcao: "worker", descricao: "", modelo: "", ferramentas: [], paiId: null, ambiente: "local" },
  ],
  pessoas: [{ id: "pessoa:p1", pilarId: "pilar:d1", nome: "Pessoa Exemplo", papel: "Responsável", ferramentas: ["ferramenta:t1"] }],
  tarefas: [
    { id: "tarefa:t1", pilarId: "pilar:d1", titulo: "Tarefa 1", resumo: "", passos: [], executorTipo: "agent", executorId: "agente:a1" },
    { id: "tarefa:t2", pilarId: "pilar:d1", titulo: "Tarefa 2", resumo: "", passos: [], executorTipo: "person", executorId: "pessoa:p1" },
    { id: "tarefa:t3", pilarId: "pilar:d2", titulo: "Tarefa 3", resumo: "", passos: [], executorTipo: "agent", executorId: "agente:a2" },
  ],
  ferramentas: [
    { id: "ferramenta:t1", nome: "Ferramenta Um", categoria: "Cat X", status: "ativa", descricao: "" },
    { id: "ferramenta:t2", nome: "Ferramenta Dois", categoria: "Cat Y", status: "ativa", descricao: "" },
    { id: "ferramenta:t3", nome: "Sem uso", categoria: "Cat Z", status: "ativa", descricao: "" },
  ],
  ultimaExecucao: {},
};

let seq = 0;
export function ent(kind: EcoKind, path: string, squadId?: string, nome = `${kind}${++seq}`): EcoEntity {
  return {
    id: `${kind}:x:${nome}`,
    legacyId: nome,
    kind,
    namespace: "x",
    name: nome,
    nome,
    descricao: "",
    origem: "t",
    path,
    procedencia: "propria",
    squadId,
    tags: [],
    meta: {},
  };
}
