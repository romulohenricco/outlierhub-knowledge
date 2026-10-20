/**
 * Ontologia — leitura do arquivo que o USUÁRIO configura (BILHON_ONTOLOGIA_MANIFEST).
 * O arquivo é YAML ou JSON, dentro de BILHON_ROOT. Sem ele (ou ilegível) a página
 * /ontologia mostra um estado vazio explicando o formato; nada é lido por padrão.
 * Contrato do arquivo: docs/ontologia.md.
 *
 * O esquema é genérico e definido por quem usa: uma lista de `camadas`, cada uma com
 * `itens` (hierarquia por `pai`, relações por `ligacoes`). O código não conhece nome
 * de camada, status nem cor: tudo vem do arquivo.
 *
 * Tudo que vem do arquivo passa por `normalizarOntologia`: campo ausente ou com tipo
 * errado é descartado em silêncio, nunca lança, e há tetos de quantidade e de texto.
 */
import path from "node:path";
import { lerFonte } from "./ecosystem";
import { lerEnv } from "./bilhon-paths";
import { cortaTexto } from "./texto";
import { corValida } from "./ontologia-cores";
import type { EcoFonteEstado } from "./types";

export type Ligacao = { camada: string; item: string; rotulo?: string };

export type Item = {
  id: string;
  nome: string;
  descricao?: string;
  /** texto livre; vira selo */
  status?: string;
  /** id de outro item da MESMA camada */
  pai?: string;
  ligacoes: Ligacao[];
  /** pares livres, listados na aba "dados" do Raio-X */
  dados: Record<string, string>;
  fonte?: string;
};

export type Camada = {
  id: string;
  rotulo: string;
  descricao?: string;
  /** "#RGB" ou "#RRGGBB"; sem ela, a cor sai de uma paleta estável pelo id */
  cor?: string;
  itens: Item[];
};

export type Regra = { id: string; titulo: string; descricao?: string };

export type Ontologia = {
  /** Nome do nó raiz do grafo; padrão "Ontologia". */
  titulo?: string;
  camadas: Camada[];
  /** status -> cor; status fora do mapa usa a paleta estável */
  statusCores: Record<string, string>;
  regras: Regra[];
  /** o que foi descartado por estar quebrado ou acima dos tetos */
  descartes: { itens: number; ligacoes: number };
};

/* ── tetos defensivos ─────────────────────────────────────────────────── */

export const MAX_CAMADAS = 50;
export const MAX_ITENS = 2000;
export const MAX_LIGACOES_POR_ITEM = 50;
export const MAX_DADOS_POR_ITEM = 50;
export const MAX_REGRAS = 200;
export const MAX_STATUS_CORES = 100;

const T_ID = 120;
const T_ROTULO = 120;
const T_DESCRICAO = 2000;
const T_STATUS = 40;
const T_FONTE = 300;
const T_DADO_CHAVE = 80;
const T_DADO_VALOR = 1000;

/* ── normalização ─────────────────────────────────────────────────────── */

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Texto aparado e cortado; número e booleano viram texto (YAML lê `1.2` como número). */
function str(v: unknown, max: number): string | undefined {
  const bruto = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "boolean" ? String(v) : v;
  if (typeof bruto !== "string") return undefined;
  const t = cortaTexto(bruto.trim(), max);
  return t ? t : undefined;
}

/** Só inclui a chave quando há valor: o objeto fica enxuto e sem `undefined`. */
function sem<T extends Obj>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function dados(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, val] of Object.entries(obj(v) ?? {})) {
    if (n >= MAX_DADOS_POR_ITEM) break;
    const chave = str(k, T_DADO_CHAVE);
    const valor = str(val, T_DADO_VALOR);
    if (!chave || valor === undefined || chave === "__proto__") continue;
    out[chave] = valor;
    n++;
  }
  return out;
}

/**
 * Converte o documento lido (YAML/JSON) em `Ontologia`, ou `null` se não há ao menos
 * uma camada válida. Arquivo sem `camadas` (inclusive de outros esquemas) é `null`.
 */
export function normalizarOntologia(raw: unknown): Ontologia | null {
  const raiz = obj(raw);
  if (!raiz) return null;

  const descartes = { itens: 0, ligacoes: 0 };
  const camadas: Camada[] = [];
  const idsCamada = new Set<string>();
  let totalItens = 0;
  // ligações cruas, guardadas até conhecer todas as camadas
  const ligacoesCruas = new Map<Item, unknown[]>();

  for (const bruta of arr(raiz.camadas)) {
    const c = obj(bruta);
    const id = c && str(c.id, T_ID);
    if (!c || !id || idsCamada.has(id)) continue;
    if (camadas.length >= MAX_CAMADAS) break;
    idsCamada.add(id);

    const itens: Item[] = [];
    const idsItem = new Set<string>();
    for (const bruto of arr(c.itens)) {
      const it = obj(bruto);
      const iid = it && str(it.id, T_ID);
      if (!it || !iid || idsItem.has(iid) || totalItens >= MAX_ITENS) {
        descartes.itens++;
        continue;
      }
      idsItem.add(iid);
      totalItens++;
      const item: Item = sem({
        id: iid,
        nome: str(it.nome, T_ROTULO) ?? iid,
        descricao: str(it.descricao, T_DESCRICAO),
        status: str(it.status, T_STATUS),
        pai: str(it.pai, T_ID),
        ligacoes: [],
        dados: dados(it.dados),
        fonte: str(it.fonte, T_FONTE),
      });
      ligacoesCruas.set(item, arr(it.ligacoes).slice(0, MAX_LIGACOES_POR_ITEM));
      itens.push(item);
    }
    // pai só vale se for outro item da mesma camada
    for (const it of itens) if (it.pai && (it.pai === it.id || !idsItem.has(it.pai))) delete it.pai;

    camadas.push(
      sem({
        id,
        rotulo: str(c.rotulo, T_ROTULO) ?? id,
        descricao: str(c.descricao, T_DESCRICAO),
        cor: corValida(c.cor),
        itens,
      }),
    );
  }
  if (!camadas.length) return null;

  // ligações: o alvo precisa existir (em qualquer camada); o resto é descartado e contado
  const existe = new Set(camadas.flatMap((c) => c.itens.map((i) => `${c.id}\u0000${i.id}`)));
  for (const c of camadas) {
    for (const it of c.itens) {
      for (const bruta of ligacoesCruas.get(it) ?? []) {
        const l = obj(bruta);
        const camada = (l && str(l.camada, T_ID)) || c.id;
        const alvo = l && str(l.item, T_ID);
        if (!l || !alvo || !existe.has(`${camada}\u0000${alvo}`) || (camada === c.id && alvo === it.id)) {
          descartes.ligacoes++;
          continue;
        }
        it.ligacoes.push(sem({ camada, item: alvo, rotulo: str(l.rotulo, T_ROTULO) }));
      }
    }
  }

  const statusCores: Record<string, string> = {};
  let nCores = 0;
  for (const [k, v] of Object.entries(obj(raiz.status_cores) ?? {})) {
    if (nCores >= MAX_STATUS_CORES) break;
    const chave = str(k, T_STATUS);
    const cor = corValida(v);
    if (!chave || !cor || chave === "__proto__") continue;
    statusCores[chave] = cor;
    nCores++;
  }

  const regras: Regra[] = [];
  const idsRegra = new Set<string>();
  for (const bruta of arr(raiz.regras)) {
    const r = obj(bruta);
    const id = r && str(r.id, T_ID);
    if (!r || !id || idsRegra.has(id)) continue;
    if (regras.length >= MAX_REGRAS) break;
    idsRegra.add(id);
    regras.push(sem({ id, titulo: str(r.titulo, T_ROTULO) ?? id, descricao: str(r.descricao, T_DESCRICAO) }));
  }

  return sem({ titulo: str(raiz.titulo, T_ROTULO), camadas, statusCores, regras, descartes });
}

/** Exemplo mínimo mostrado no estado vazio da página (e conferido por teste). */
export const EXEMPLO_ONTOLOGIA = `titulo: Minha ontologia
camadas:
  - id: camada-a
    rotulo: Camada A
    itens:
      - id: item-1
        nome: Item 1
      - id: item-2
        nome: Item 2
        pai: item-1
  - id: camada-b
    rotulo: Camada B
    itens:
      - id: item-3
        nome: Item 3
        ligacoes:
          - { camada: camada-a, item: item-1, rotulo: usa }`;

/* ── leitura do arquivo configurado ───────────────────────────────────── */

export type EstadoOntologia = EcoFonteEstado | "vazia";

export type LeituraOntologia = {
  ontologia: Ontologia | null;
  /** nao-configurada · ausente · fora-da-raiz · invalida (ilegível) · vazia (lido, mas sem a lista `camadas` ou sem nenhuma camada válida) · ok */
  estado: EstadoOntologia;
  /** Caminho configurado em BILHON_ONTOLOGIA_MANIFEST (só exibição). */
  fonte?: string;
};

export const ENV_ONTOLOGIA = "BILHON_ONTOLOGIA_MANIFEST";

export async function getOntologia(): Promise<LeituraOntologia> {
  const configurada = lerEnv(ENV_ONTOLOGIA);
  const { dado, estado } = await lerFonte(configurada, true);
  // só o NOME do arquivo vai para a tela: o valor configurado pode ser um caminho absoluto do servidor
  const fonte = configurada ? path.basename(configurada) : undefined;
  if (estado !== "ok") return { ontologia: null, estado, fonte };
  const ontologia = normalizarOntologia(dado);
  return ontologia ? { ontologia, estado: "ok", fonte } : { ontologia: null, estado: "vazia", fonte };
}

/* ── cobertura: quanto a ontologia toca os materiais do app ───────────── */

export type CoberturaCorpus = {
  nome: string;
  total: number;
  comDominio: number;
  comChecksum: number;
  comAnotacao?: number;
  comRelacoes: number;
  distDominio: [string, number][];
};

/** Estado APLICADO — quanto de cada acervo (livros, referências) tem domínio, checksum e relações. */
export async function getCobertura(): Promise<CoberturaCorpus[]> {
  const { coberturaLivros } = await import("./catalog");
  const { getReferencias } = await import("./referencias");
  const out: CoberturaCorpus[] = [];

  try {
    const c = await coberturaLivros();
    out.push({
      nome: "livros",
      total: c.total,
      comDominio: c.comDominio,
      comChecksum: c.comChecksum,
      comRelacoes: c.comRelacoes,
      distDominio: c.distDominio,
    });
  } catch {
    /* catálogo indisponível */
  }

  try {
    const { posts } = await getReferencias();
    const dr = new Map<string, number>();
    for (const p of posts) if (p.dominio) dr.set(p.dominio, (dr.get(p.dominio) ?? 0) + 1);
    out.push({
      nome: "referências",
      total: posts.length,
      comDominio: posts.filter((p) => p.dominio).length,
      comChecksum: posts.filter((p) => p.checksum).length,
      comAnotacao: posts.filter((p) => p.anotacao).length,
      comRelacoes: posts.filter((p) => p.colecoes.length > 0).length,
      distDominio: [...dr.entries()].sort((a, b) => b[1] - a[1]),
    });
  } catch {
    /* referências indisponíveis */
  }

  return out;
}
