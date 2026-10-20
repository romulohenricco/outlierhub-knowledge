/**
 * Personas = perfis de operador (um desenho de pilares, agentes, conectores e
 * métricas) que a página /ingestoes mostra na aba "Personas".
 *
 * O app NÃO traz nenhuma persona: elas vêm de um JSON seu, apontado por
 * BILHON_PERSONAS_JSON (dentro de BILHON_ROOT). Sem configuração a aba abre vazia
 * e explica como popular. Item inválido é descartado (e contado), nunca lança.
 * Formato e exemplo: docs/personas.md.
 *
 * Os tipos são seguros para o cliente (só tipos são importados lá); a leitura
 * do arquivo (`carregarPersonas`) é só de servidor.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { caminhoBilhonPermitido, lerEnv } from "./bilhon-paths";
import { lerFonte } from "./ecosystem";
import { cortaTexto } from "./texto";

export type PersonaPilar = {
  nome: string;
  foco: string;
  agentes: string[];
};

export type Persona = {
  id: string;
  /** posição na lista (1-based), na ordem do arquivo */
  ordem: number;
  nome: string;
  arquetipo: string;
  slogan: string;
  resumo: string;
  /** cor de destaque (#rgb ou #rrggbb) */
  cor: string;
  estrelaGuia: string;
  pilares: PersonaPilar[];
  conectores: string[];
  metricas: string[];
  /** como a persona usa a base de conhecimento */
  memoria: string;
  jogadaAssinatura: string;
  /** rótulo livre de procedência, usado como filtro (padrão "personalizada") */
  origem: string;
  /** de onde saiu cada bloco, para o leitor conferir (opcional) */
  evidencias: string[];
};

export type EstadoPersonas = "nao-configurada" | "ausente" | "fora-da-raiz" | "grande-demais" | "invalida" | "ok";

export type PersonasCarregadas = {
  personas: Persona[];
  /** itens do arquivo que não passaram na validação */
  descartadas: number;
  estado: EstadoPersonas;
};

const MAX_BYTES = 1_000_000;
const MAX_PERSONAS = 60;
const MAX_PILARES = 12;
const MAX_AGENTES = 12;
const MAX_CONECTORES = 30;
const MAX_METRICAS = 20;
const MAX_EVIDENCIAS = 20;
const COR_PADRAO = "#5b8cff";

const ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const COR_VALIDA = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const texto = (v: unknown, max: number): string => (typeof v === "string" ? cortaTexto(v.trim(), max) : "");

/** Lista de textos não vazios, sem repetição, limitada. */
function lista(v: unknown, max: number, maxCada: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const t = texto(item, maxCada);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function pilares(v: unknown): PersonaPilar[] {
  if (!Array.isArray(v)) return [];
  const out: PersonaPilar[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const nome = texto(o.nome, 60);
    if (!nome || out.some((p) => p.nome === nome)) continue;
    out.push({ nome, foco: texto(o.foco, 80), agentes: lista(o.agentes, MAX_AGENTES, 60) });
    if (out.length >= MAX_PILARES) break;
  }
  return out;
}

/** Valida o conteúdo já lido (lista, ou `{ "personas": [...] }`). Puro: não lê disco. */
export function validarPersonas(raw: unknown): { personas: Persona[]; descartadas: number } {
  const itens = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { personas?: unknown }).personas)
      ? (raw as { personas: unknown[] }).personas
      : [];
  const personas: Persona[] = [];
  let descartadas = 0;
  for (const item of itens) {
    if (!item || typeof item !== "object") {
      descartadas++;
      continue;
    }
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const nome = texto(o.nome, 80);
    const resumo = texto(o.resumo, 600);
    if (!ID_VALIDO.test(id) || !nome || !resumo || personas.some((p) => p.id === id) || personas.length >= MAX_PERSONAS) {
      descartadas++;
      continue;
    }
    personas.push({
      id,
      ordem: personas.length + 1,
      nome,
      arquetipo: texto(o.arquetipo, 40) || "Persona",
      slogan: texto(o.slogan, 160),
      resumo,
      cor: typeof o.cor === "string" && COR_VALIDA.test(o.cor.trim()) ? o.cor.trim() : COR_PADRAO,
      estrelaGuia: texto(o.estrelaGuia, 160),
      pilares: pilares(o.pilares),
      conectores: lista(o.conectores, MAX_CONECTORES, 40),
      metricas: lista(o.metricas, MAX_METRICAS, 120),
      memoria: texto(o.memoria, 400),
      jogadaAssinatura: texto(o.jogadaAssinatura, 400),
      origem: texto(o.origem, 40) || "personalizada",
      evidencias: lista(o.evidencias, MAX_EVIDENCIAS, 200),
    });
  }
  return { personas, descartadas };
}

/** Lê BILHON_PERSONAS_JSON. Nunca lança: qualquer problema vira lista vazia + `estado`. */
export async function carregarPersonas(): Promise<PersonasCarregadas> {
  const vazio = (estado: EstadoPersonas): PersonasCarregadas => ({ personas: [], descartadas: 0, estado });
  const arquivo = lerEnv("BILHON_PERSONAS_JSON");
  if (!arquivo) return vazio("nao-configurada");
  const abs = path.resolve(arquivo);
  if (!caminhoBilhonPermitido(abs)) return vazio("fora-da-raiz");
  try {
    if ((await stat(abs)).size > MAX_BYTES) return vazio("grande-demais");
  } catch {
    return vazio("ausente");
  }
  const lido = await lerFonte(abs);
  if (lido.estado !== "ok") return vazio(lido.estado === "nao-configurada" ? "ausente" : lido.estado);
  return { ...validarPersonas(lido.dado), estado: "ok" };
}
