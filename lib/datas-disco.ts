/**
 * Data de nó do /grafo a partir do DISCO — par servidor de lib/grafo-data.ts.
 *
 * Só lê (stat), nunca escreve. Todo caminho passa pela contenção da raiz
 * (`caminhoDentroDaRaiz`): um `path` do inventário que aponte para fora dela, ou
 * que escape por symlink, fica SEM data em vez de ser lido. Sem data é o estado
 * normal de quem não configurou nada — o filtro conta esses nós, não os inventa.
 *
 * Cache por path com TTL curto: o /grafo recarrega a cada troca de filtro e a
 * topologia sozinha pode passar de mil paths — sem cache seriam milhares de stat
 * a cada clique.
 */
import { stat } from "node:fs/promises";
import { bilhonRoot, caminhoDentroDaRaiz } from "./bilhon-paths";
import { pathAbsoluto } from "./grafo-ecossistema";
import type { KgNode } from "./kg";
import type { EcoEntity } from "./types";

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; dia: string | null }>();

/** Esvazia o cache (testes; e quem precisar de leitura fresca). */
export function limparCacheDatas(): void {
  cache.clear();
}

/** Dia local (YYYY-MM-DD) — mesmo formato dos <input type="date"> da UI. */
export function diaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Dia do mtime de `abs`, ou null se o path não existe ou está fora de `raiz`. */
export async function diaDoDisco(abs: string, raiz: string = bilhonRoot()): Promise<string | null> {
  const chave = `${raiz}\0${abs}`;
  const hit = cache.get(chave);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.dia;
  let dia: string | null = null;
  if (abs && caminhoDentroDaRaiz(raiz, abs)) {
    try {
      dia = diaLocal((await stat(abs)).mtime);
    } catch {
      /* path sumiu ou nunca existiu — data desconhecida, não "hoje" */
    }
  }
  cache.set(chave, { at: Date.now(), dia });
  return dia;
}

/** stat em lote com concorrência limitada (3k stats em paralelo irrestrito
 *  estouram descritores à toa). */
export async function diasDoDisco(
  paths: string[],
  raiz: string = bilhonRoot(),
  concorrencia = 64,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unicos = [...new Set(paths.filter(Boolean))];
  let i = 0;
  const worker = async () => {
    while (i < unicos.length) {
      const p = unicos[i++];
      const d = await diaDoDisco(p, raiz);
      if (d) out.set(p, d);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrencia, unicos.length) }, worker));
  return out;
}

const maior = (...ds: Array<string | null | undefined>) =>
  ds.reduce<string | undefined>((m, d) => (d && (!m || d > m) ? d : m), undefined);

/**
 * Data de cada entidade do ecossistema = o sinal MAIS RECENTE entre: mtime do
 * path (dentro da raiz), último dia de uso observado (`uso.ultimo`) e último
 * push do repo (`meta.ultimo_push`). "Mais recente" porque a pergunta do filtro
 * é "o que se mexeu no período".
 */
export async function datasDoEcossistema(
  entidades: EcoEntity[],
  raiz: string = bilhonRoot(),
): Promise<Map<string, string>> {
  const abs = (e: EcoEntity) => pathAbsoluto(e.path, raiz);
  const doDisco = await diasDoDisco(entidades.map(abs), raiz);
  const out = new Map<string, string>();
  for (const e of entidades) {
    const push = typeof e.meta.ultimo_push === "string" ? e.meta.ultimo_push.slice(0, 10) : null;
    const d = maior(doDisco.get(abs(e)), e.uso?.ultimo, push);
    if (d) out.set(e.id, d);
  }
  return out;
}

/** Tipos de nó da topologia que são sintéticos (sem pasta) — hubs estruturais. */
const TOPO_ESTRUTURAL = new Set(["plano", "dominio", "remote"]);

/**
 * Data dos nós da camada de topologia (o extrato não traz mtime): stat do
 * próprio path, dentro da raiz. Nó sintético (plano/domínio/remote) vira
 * estrutural.
 */
export async function datarTopologia(nodes: KgNode[], raiz: string = bilhonRoot()): Promise<KgNode[]> {
  const dias = await diasDoDisco(
    nodes.filter((n) => n.path).map((n) => n.path!),
    raiz,
  );
  return nodes.map((n) => {
    if (n.tipoTopo && TOPO_ESTRUTURAL.has(n.tipoTopo)) return { ...n, estrutural: true };
    const d = n.path ? dias.get(n.path) : undefined;
    return d ? { ...n, data: d } : n;
  });
}
