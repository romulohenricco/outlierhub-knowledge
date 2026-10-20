/**
 * Kanban — board de tickets de ingest/clones/autolearning/melhoria. Fonte: JSON
 * local em KANBAN_DIR/board.json (padrão data/kanban) — sem banco, mesmo padrão de
 * lib/referencias.ts (lock em memória + escrita atômica temp+rename).
 */
import { readFile, writeFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  KanbanAudio,
  KanbanBoard,
  KanbanBucket,
  KanbanCanalPedido,
  KanbanCard,
  KanbanChecklistItem,
  KanbanColuna,
  KanbanColunaId,
  KanbanExecucao,
  KanbanFonteTipo,
  KanbanHistoricoEntry,
  KanbanImagem,
  KanbanIngestao,
  KanbanLink,
  KanbanLinkTipo,
  KanbanOrigem,
  KanbanPrioridade,
  KanbanProjeto,
  KanbanTipo,
  KanbanVinculo,
} from "./types";
import { DOD_POR_TIPO, ITEM_GATE_MERGE, KANBAN_PROJETO_PADRAO, KANBAN_PROJETOS, TIPOS_COM_GATE_MERGE } from "./types";

export const KANBAN_DIR =
  process.env.BILHON_KANBAN_DIR || path.join(process.cwd(), "data", "kanban");

const BOARD_JSON = path.join(KANBAN_DIR, "board.json");
export const AUDIO_DIR = path.join(KANBAN_DIR, "audio");
export const IMAGEM_DIR = path.join(KANBAN_DIR, "imagens");
/** Snapshots rotativos do board (1 por dia). NÃO é backup: vive no mesmo volume
 *  gitignored, serve pra desfazer erro de operação — falha de disco não sobrevive. */
export const BACKUP_DIR = path.join(KANBAN_DIR, "backups");
const RETENCAO_SNAPSHOTS = 14;
export const APRENDIZADOS_DIR = path.join(KANBAN_DIR, "aprendizados");

/** Formato canônico do id de ticket: prefixo de PREFIXO_TIPO + contador. */
const RE_CARD_ID = /^[A-Z]{3}-\d+$/;

/** Valida o id ANTES de qualquer `path.join` — é o único ponto que impede um id
 *  com `../..` de virar diretório de mídia (traversal de leitura e de escrita:
 *  as rotas de upload fazem `mkdir(recursive)` + `writeFile` com o id cru).
 *  Nota de manutenção: prefixo custom novo exige atualizar a regex junto — o
 *  teste do caminho feliz falha ruidosamente se isso for esquecido. */
export function cardIdValido(cardId: unknown): cardId is string {
  return typeof cardId === "string" && RE_CARD_ID.test(cardId);
}

/** Pasta das notas de áudio de um card — uma por ticket, nunca compartilhada.
 *  `null` quando o id não é canônico (chamador tem de responder 400). */
export function audioDirDoCard(cardId: string): string | null {
  if (!cardIdValido(cardId)) return null;
  return path.join(AUDIO_DIR, cardId);
}

/** Pasta das imagens de um card — uma por ticket, nunca compartilhada.
 *  `null` quando o id não é canônico (chamador tem de responder 400). */
export function imagemDirDoCard(cardId: string): string | null {
  if (!cardIdValido(cardId)) return null;
  return path.join(IMAGEM_DIR, cardId);
}

/** Caminho absoluto de um arquivo de mídia do card, ancorado na raiz FIXA da
 *  pasta de mídia — nunca no diretório derivado do input, que seria raiz de
 *  confinamento escolhida pelo atacante. `/[/\\]/` no lugar de
 *  `includes(path.sep)`: no Windows `path.sep` é só `\`, e `/` também separa. */
function midiaPathFor(raizBase: string, cardId: string, arquivo: string): string | null {
  if (!cardIdValido(cardId)) return null;
  if (!arquivo || arquivo === "." || arquivo.includes("..")) return null;
  if (/[/\\\0]/.test(arquivo)) return null;
  const raiz = path.resolve(raizBase);
  const abs = path.resolve(raiz, cardId, arquivo);
  if (!abs.startsWith(raiz + path.sep)) return null;
  return abs;
}

/** Caminho absoluto de um áudio, recusando qualquer escape do diretório do card. */
export function audioPathFor(cardId: string, arquivo: string): string | null {
  return midiaPathFor(AUDIO_DIR, cardId, arquivo);
}

/** Caminho absoluto de uma imagem, recusando qualquer escape do diretório do card. */
export function imagemPathFor(cardId: string, arquivo: string): string | null {
  return midiaPathFor(IMAGEM_DIR, cardId, arquivo);
}

/** Prefixo do ID do ticket por tipo — visível de cara no board (ING-3, MEL-1…). */
export const PREFIXO_TIPO: Record<KanbanTipo, string> = {
  ingest: "ING",
  clone: "CLN",
  autolearning: "LRN",
  feature: "FEA",
  melhoria: "MEL",
  bug: "BUG",
  infra: "INF",
  outro: "TSK",
};

const COLUNAS_PADRAO: KanbanColuna[] = [
  { id: "todo", rotulo: "TO DO" },
  { id: "doing", rotulo: "DOING" },
  { id: "done", rotulo: "DONE" },
  { id: "cancel", rotulo: "CANCEL" },
];

function boardVazio(): KanbanBoard {
  return {
    atualizadoEm: new Date().toISOString(),
    colunas: COLUNAS_PADRAO.map((c) => ({ ...c })),
    wipLimites: { doing: 1 },
    contadores: { ingest: 0, clone: 0, autolearning: 0, feature: 0, melhoria: 0, bug: 0, infra: 0, outro: 0 },
    cards: [],
  };
}

/** Slug estável a partir do rótulo — id interno da coluna (nunca exibido). */
function slugColuna(rotulo: string): string {
  const base = rotulo
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return base || "coluna";
}

let fila: Promise<unknown> = Promise.resolve();
/** Serializa mutações do board.json (processo único) — evita read-modify-write concorrente. */
function comLock<T>(fn: () => Promise<T>): Promise<T> {
  const prox = fila.then(fn, fn);
  fila = prox.catch(() => {});
  return prox;
}

/** Escrita atômica: temp + rename (leitores nunca veem JSON truncado). */
async function writeJsonAtomic(p: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(data, null, 1));
  await rename(tmp, p);
}

/** `board.json` ilegível — JSON inválido, permissão, arquivo truncado. É estado
 *  de infra recuperável (503), NUNCA motivo pra sobrescrever: toda mutação é
 *  read-modify-write, então engolir o erro e devolver board vazio faz a próxima
 *  ação do operador apagar o board inteiro. Quem lança já garantiu que nada foi
 *  escrito. */
export class BoardCorrompidoError extends Error {
  constructor(public readonly causa: unknown) {
    super(
      "board.json ilegível — recuse a escrita e restaure a partir de " +
        "data/kanban/backups/ (o board-AAAAMMDD.json mais recente) ou da sua própria cópia antes de continuar",
    );
    this.name = "BoardCorrompidoError";
  }
}

/** Log estruturado em stderr (nunca arquivo dentro do repo).
 *  Só nome e código do erro: a mensagem de SyntaxError do `JSON.parse` cita
 *  trecho do arquivo, e o caminho completo derivaria de env var
 *  (BILHON_KANBAN_DIR) — nem conteúdo nem valor de env vão pra log. */
function logBoard(evento: string, etapa: string, erro: unknown): void {
  const e = erro as { name?: string; code?: string } | null;
  console.error(
    JSON.stringify({
      evento,
      etapa,
      arquivo: path.basename(BOARD_JSON),
      erro: e?.name ?? "Error",
      codigo: e?.code ?? null,
    }),
  );
}

// EBUSY/EPERM no Windows são transitórios (antivírus, rename em curso) — não
// são corrupção, então valem uma retentativa curta antes de virar 503.
const CODIGOS_TRANSITORIOS = new Set(["EBUSY", "EPERM"]);

/** Conteúdo cru do board, ou `null` em ENOENT (primeira execução legítima). */
async function lerTextoBoard(): Promise<string | null> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await readFile(BOARD_JSON, "utf-8");
    } catch (e) {
      const codigo = (e as NodeJS.ErrnoException).code ?? "";
      if (codigo === "ENOENT") return null;
      if (CODIGOS_TRANSITORIOS.has(codigo) && tentativa < 3) {
        await new Promise((resolver) => setTimeout(resolver, 30 * tentativa));
        continue;
      }
      logBoard("board_corrompido", "leitura", e);
      throw new BoardCorrompidoError(e);
    }
  }
}

async function existe(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Dia local em YYYYMMDD — o snapshot acompanha o dia de operação da máquina,
 *  não UTC (senão um turno da noite geraria dois snapshots). */
function diaLocal(d = new Date()): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}`;
}

async function podarSnapshots(): Promise<void> {
  const arquivos = (await readdir(BACKUP_DIR))
    .filter((f) => /^board-\d{8}\.json$/.test(f))
    .sort(); // YYYYMMDD no nome ⇒ ordem alfabética é ordem cronológica
  for (const antigo of arquivos.slice(0, Math.max(0, arquivos.length - RETENCAO_SNAPSHOTS))) {
    await unlink(path.join(BACKUP_DIR, antigo));
  }
}

/** Copia o `board.json` ANTERIOR à mutação para `backups/board-YYYYMMDD.json`,
 *  uma vez por dia, e poda além de RETENCAO_SNAPSHOTS. Falha aqui não bloqueia
 *  a mutação — um problema de permissão na pasta de snapshot travaria o board
 *  inteiro, o que é pior que ficar sem o snapshot do dia. */
async function snapshotDiario(): Promise<void> {
  try {
    const destino = path.join(BACKUP_DIR, `board-${diaLocal()}.json`);
    // A poda não pode depender da criação do snapshot do dia: se a primeira
    // mutação já ocorreu, ainda pode haver snapshots antigos excedentes.
    if (await existe(destino)) {
      await podarSnapshots();
      return;
    }
    const texto = await readFile(BOARD_JSON, "utf-8").catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null; // nada pra preservar ainda
      throw e;
    });
    if (texto === null) return;
    await mkdir(BACKUP_DIR, { recursive: true });
    const tmp = `${destino}.tmp-${process.pid}`;
    await writeFile(tmp, texto);
    await rename(tmp, destino);
    await podarSnapshots();
  } catch (e) {
    logBoard("board_snapshot_falhou", "snapshot", e);
  }
}

/** Único caminho de escrita do board: snapshot do último estado bom conhecido
 *  antes do rename atômico. */
async function salvarBoard(board: KanbanBoard): Promise<void> {
  await snapshotDiario();
  await writeJsonAtomic(BOARD_JSON, board);
}

/** Migra card de versões antigas do schema:
 *  - `ingestao.fonteTipo/fonteUrl/fontePath` eram valor único, viraram array
 *    (permitir marcar/anexar mais de um).
 *  - `links` era objeto de 4 campos fixos, virou array tipado por plataforma.
 *  - `vinculos`/`audios` são campos novos — default `[]` se ausentes. */
function migrarCard(card: KanbanCard): KanbanCard {
  const paraArray = <T,>(v: T | T[] | null | undefined): T[] =>
    Array.isArray(v) ? v : v ? [v] : [];

  const ingestao: KanbanIngestao = {
    ...card.ingestao,
    fonteTipo: paraArray(card.ingestao?.fonteTipo),
    fonteUrl: paraArray(card.ingestao?.fonteUrl),
    fontePath: paraArray(card.ingestao?.fontePath),
  };

  let links = card.links as unknown;
  if (!Array.isArray(links)) {
    const antigo = (links ?? {}) as {
      clickupTask?: string | null;
      githubCommit?: string | null;
      outputFile?: string | null;
      docRelacionado?: string | null;
    };
    const novo: KanbanLink[] = [];
    if (antigo.clickupTask) novo.push({ tipo: "clickup", url: antigo.clickupTask });
    if (antigo.githubCommit) novo.push({ tipo: "github", url: antigo.githubCommit });
    if (antigo.outputFile) novo.push({ tipo: "output", url: antigo.outputFile });
    if (antigo.docRelacionado) novo.push({ tipo: "doc", url: antigo.docRelacionado });
    links = novo;
  }

  return {
    ...card,
    ingestao,
    links: links as KanbanLink[],
    vinculos: card.vinculos ?? [],
    audios: card.audios ?? [],
    imagens: card.imagens ?? [],
    execucao: card.execucao ?? null,
  };
}

/** Lê o board. ENOENT é board vazio legítimo; qualquer outro erro LANÇA
 *  (BoardCorrompidoError) — ver a classe pra saber por que o fallback silencioso
 *  era perda total. */
async function lerBoardBruto(): Promise<KanbanBoard> {
  const texto = await lerTextoBoard();
  if (texto === null) return boardVazio();
  try {
    const raw = JSON.parse(texto) as KanbanBoard;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError("board.json não é um objeto");
    }
    // preenche campos que uma versão anterior do board.json possa não ter
    return {
      ...boardVazio(),
      ...raw,
      wipLimites: { ...boardVazio().wipLimites, ...raw.wipLimites },
      contadores: { ...boardVazio().contadores, ...raw.contadores },
      cards: (raw.cards ?? []).map(migrarCard),
    };
  } catch (e) {
    logBoard("board_corrompido", "parse", e);
    throw new BoardCorrompidoError(e);
  }
}

/** Leitura pura do board. Propaga `BoardCorrompidoError` de propósito: board
 *  vazio silencioso na tela é justamente a armadilha que faz o operador mexer e
 *  disparar a sobrescrita. */
export async function getBoard(): Promise<KanbanBoard> {
  return lerBoardBruto();
}

function cardVazio(): Omit<KanbanCard, "id" | "titulo" | "tipo" | "coluna" | "ordem" | "criadoEm" | "atualizadoEm"> {
  return {
    descricao: "",
    prioridade: "media",
    projeto: KANBAN_PROJETO_PADRAO,
    responsavel: null,
    tags: [],
    origem: { canal: null, pedidoOriginal: null, solicitadoPor: null },
    ingestao: { fonteTipo: [], fonteUrl: [], fontePath: [], bucket: null, pessoaAutor: null },
    links: [],
    vinculos: [],
    audios: [],
    imagens: [],
    checklist: [],
    historico: [],
    execucao: null,
    concluidoEm: null,
  };
}

// Sinais textuais de que o ticket só avança com o responsável humano no meio
// (dashboard de provedor externo, autorização, decisão reservada por ele mesmo).
// Frases extras (ex.: apelido do responsável) são configuráveis via
// BILHON_KANBAN_SINAIS_HUMANO (CSV), sem nenhum default pessoal.
const SINAIS_EXECUCAO_HUMANO_BASE = [
  "ação do responsável", "acao do responsavel", "go do responsável", "go dele", "aval do responsável",
  "requer login", "precisa de login", "requer autorização", "requer autorizacao",
  "aprovação humana", "aprovacao humana", "dashboards dos provedores",
  "só o responsável", "so o responsavel", "precisa do responsável", "ele decide",
];
const SINAIS_EXECUCAO_HUMANO_EXTRA = (process.env.BILHON_KANBAN_SINAIS_HUMANO || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const SINAIS_EXECUCAO_HUMANO = [...SINAIS_EXECUCAO_HUMANO_BASE, ...SINAIS_EXECUCAO_HUMANO_EXTRA];

/** Nome do responsável default quando o board classifica um ticket como
 *  modo "humano" — configurável, sem default pessoal. */
const EXECUTOR_HUMANO_DEFAULT = process.env.BILHON_KANBAN_EXECUTOR_HUMANO || undefined;

/** Classifica `execucao` de um ticket novo a partir de título/descrição/tags.
 *  Objetivo: nenhum card nasce "sem definição".
 *  Só roda quando `input.execucao` não foi passado explicitamente — nunca
 *  sobrescreve uma classificação manual. */
export function classificarExecucao(titulo: string, descricao: string, tags: string[]): KanbanExecucao {
  const t = titulo.trim();
  const texto = `${t} ${descricao}`.toLowerCase();
  const isDecisao = tags.includes("decisão") || t.startsWith("[DECISÃO]") || t.startsWith("[DECISAO]");
  const isUrgente = t.startsWith("[URGENTE]") || tags.includes("urgente");
  const temSinalHumano = SINAIS_EXECUCAO_HUMANO.some((s) => texto.includes(s));
  const humano: KanbanExecucao = EXECUTOR_HUMANO_DEFAULT
    ? { modo: "humano", executor: EXECUTOR_HUMANO_DEFAULT }
    : { modo: "humano" };

  if (isDecisao) return humano;
  if (isUrgente && temSinalHumano) return humano;
  if (isUrgente) return { modo: "misto", pctAgente: 60 };
  if (temSinalHumano) return { modo: "misto", pctAgente: 50 };
  return { modo: "agente" };
}

export type NovoCardInput = {
  titulo: string;
  tipo: KanbanTipo;
  descricao?: string;
  prioridade?: KanbanPrioridade;
  projeto?: KanbanProjeto;
  coluna?: KanbanColunaId;
  responsavel?: string | null;
  tags?: string[];
  origem?: Partial<KanbanOrigem>;
  ingestao?: Partial<KanbanIngestao>;
  links?: KanbanLink[];
  vinculos?: KanbanVinculo[];
  checklist?: KanbanChecklistItem[];
  /** Se omitido, classificado automaticamente (ver `classificarExecucao`). */
  execucao?: KanbanExecucao | null;
};

export async function criarCard(entrada: NovoCardInput): Promise<KanbanCard> {
  // o tipo TS some no build: o que chega pela rota é conferido em runtime
  const input = validarNovoCard(entrada);
  return comLock(async () => {
    const board = await lerBoardBruto();
    if (input.coluna !== undefined && !board.colunas.some((c) => c.id === input.coluna)) {
      throw new CardInvalidoError("coluna precisa ser uma de: " + board.colunas.map((c) => c.id).join("|"));
    }
    const prefixo = PREFIXO_TIPO[input.tipo];
    const n = (board.contadores[input.tipo] ?? 0) + 1;
    board.contadores[input.tipo] = n;
    const coluna = input.coluna ?? board.colunas[0]?.id ?? "todo";
    const agora = new Date().toISOString();
    const ordemMax = Math.max(
      -1,
      ...board.cards.filter((c) => c.coluna === coluna).map((c) => c.ordem),
    );
    const base = cardVazio();
    const card: KanbanCard = {
      ...base,
      id: `${prefixo}-${n}`,
      titulo: input.titulo,
      descricao: input.descricao ?? "",
      tipo: input.tipo,
      prioridade: input.prioridade ?? "media",
      projeto: input.projeto ?? KANBAN_PROJETO_PADRAO,
      coluna,
      ordem: ordemMax + 1,
      responsavel: input.responsavel ?? null,
      tags: input.tags ?? [],
      execucao:
        input.execucao !== undefined
          ? input.execucao
          : classificarExecucao(input.titulo, input.descricao ?? "", input.tags ?? []),
      origem: { ...base.origem, ...input.origem },
      ingestao: { ...base.ingestao, ...input.ingestao },
      links: input.links ?? base.links,
      vinculos: input.vinculos ?? base.vinculos,
      checklist: input.checklist ?? [],
      historico: [{ de: null, para: coluna, em: agora }],
      criadoEm: agora,
      atualizadoEm: agora,
      concluidoEm: coluna === "done" ? agora : null,
    };
    garantirDoD(card);
    board.cards.push(card);
    board.atualizadoEm = agora;
    await salvarBoard(board);
    return card;
  });
}

/** Corpo de criação recusado: a rota responde 400 com a mensagem. */
export class CardInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardInvalidoError";
  }
}

/** Mesma disciplina do PATCH aplicada à criação: o corpo cru do POST nunca vira card.
 *  Tipo e forma de cada campo editável são conferidos por `validarPatchCard` (allowlist;
 *  chave desconhecida é recusada). Aqui entra o que o PATCH não cobre: título e tipo
 *  obrigatórios, coluna como texto, histórico fora (nasce no servidor) e link só
 *  http(s), porque vira `href` na tela. */
function validarNovoCard(corpo: unknown): NovoCardInput {
  if (!ehObjeto(corpo)) throw new CardInvalidoError("corpo precisa ser um objeto");
  const { coluna, ...resto } = corpo;
  if (typeof resto.titulo !== "string" || !resto.titulo.trim()) {
    throw new CardInvalidoError("titulo precisa ser texto não vazio");
  }
  if (typeof resto.tipo !== "string" || !tem(PREFIXO_TIPO as Record<string, unknown>, resto.tipo)) {
    throw new CardInvalidoError("tipo precisa ser um de: " + Object.keys(PREFIXO_TIPO).join("|"));
  }
  if (coluna !== undefined && typeof coluna !== "string") throw new CardInvalidoError("coluna precisa ser texto");
  if (tem(resto, "historico")) throw new CardInvalidoError("campos não editáveis: historico");
  const validado = validarPatchCard(resto);
  if (!validado.ok) throw new CardInvalidoError(validado.erro);
  const { campos } = validado;
  if (campos.links?.some((l) => !/^https?:\/\//i.test(l.url.trim()))) {
    throw new CardInvalidoError("cada link precisa ter url http:// ou https://");
  }
  return {
    ...campos,
    titulo: campos.titulo as string,
    tipo: campos.tipo as KanbanTipo,
    ...(coluna !== undefined ? { coluna } : {}),
  };
}

/** Contrato tipado do patch para chamadores internos. A validação que vale é a
 *  de runtime (`validarPatchCard`) — tipo TS não existe depois do build. */
export type PatchCardInput = Partial<
  Pick<
    KanbanCard,
    "titulo" | "descricao" | "tipo" | "prioridade" | "projeto" | "responsavel" | "tags" | "checklist" | "execucao"
  >
> & {
  origem?: Partial<KanbanOrigem>;
  ingestao?: Partial<KanbanIngestao>;
  links?: KanbanLink[];
  vinculos?: KanbanVinculo[];
  /** Evidência por linha do histórico (`nota`/`links`). Não é o histórico: a
   *  transição em si é imutável pelo PATCH — ver validarEvidenciasHistorico. */
  historicoEvidencias?: EvidenciaHistorico[];
};

/** Campos que o PATCH de card pode escrever — allowlist LITERAL, e não denylist:
 *  campo novo no `KanbanCard` nasce NÃO-editável (denylist esqueceria de bloquear).
 *
 *  Deliberadamente fora: `id` (chave das rotas de mídia), `coluna`/`ordem`/
 *  `concluidoEm` (só `moverCard`, que aplica "status não volta" e os
 *  wipLimites), `audios`/`imagens` (só as rotas de mídia, que sabem gravar o
 *  arquivo), `criadoEm` e `atualizadoEm` (só o servidor). */
const CAMPOS_EDITAVEIS = [
  "titulo",
  "descricao",
  "tipo",
  "prioridade",
  "projeto",
  "responsavel",
  "tags",
  "checklist",
  "execucao",
  "origem",
  "ingestao",
  "links",
  "vinculos",
  "historico", // só a evidência (nota/links); ver validarEvidencias
] as const;


const CAMPOS_IGNORAVEIS = [] as const;

const PRIORIDADES: readonly string[] = ["baixa", "media", "alta", "urgente"];
const PROJETOS: readonly string[] = KANBAN_PROJETOS;
const MODOS_EXECUCAO: readonly string[] = ["agente", "humano", "misto"];

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const ehTextoOuNulo = (v: unknown): v is string | null => v === null || typeof v === "string";
const ehArrayDeTexto = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const tem = (o: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

export type AtualizarCardResultado =
  | { ok: true; card: KanbanCard }
  | { ok: false; motivo: "campos-invalidos" | "nao-encontrado"; erro: string };

type PatchRecusado = { ok: false; motivo: "campos-invalidos"; erro: string };
const recusa = (erro: string): PatchRecusado => ({ ok: false, motivo: "campos-invalidos", erro });

/** Traduz o corpo cru do PATCH em campos aplicáveis, ou recusa.
 *
 *  Falha fechada e ruidosa: chave fora da allowlist devolve erro com a lista das
 *  chaves recusadas (descarte silencioso esconderia bug do front e tentativa de
 *  abuso no mesmo silêncio). Nada de `Object.assign` com objeto vindo de
 *  `JSON.parse`: é por spread que `__proto__` seria copiado via setter. */
function validarPatchCard(patch: unknown): { ok: true; campos: PatchCardInput } | PatchRecusado {
  if (!ehObjeto(patch)) return recusa("corpo do patch precisa ser um objeto");

  const editaveis: readonly string[] = CAMPOS_EDITAVEIS;
  const ignoraveis: readonly string[] = CAMPOS_IGNORAVEIS;
  const desconhecidas = Object.keys(patch).filter(
    (k) => !editaveis.includes(k) && !ignoraveis.includes(k),
  );
  if (desconhecidas.length) {
    const dica = desconhecidas.includes("coluna") ? " — mover exige {coluna, index}" : "";
    return recusa(`campos não editáveis: ${desconhecidas.join(", ")}${dica}`);
  }

  const campos: PatchCardInput = {};

  if (tem(patch, "titulo")) {
    if (typeof patch.titulo !== "string" || !patch.titulo.trim()) {
      return recusa("titulo precisa ser texto não vazio");
    }
    campos.titulo = patch.titulo;
  }
  if (tem(patch, "descricao")) {
    if (typeof patch.descricao !== "string") return recusa("descricao precisa ser texto");
    campos.descricao = patch.descricao;
  }
  if (tem(patch, "tipo")) {
    // hasOwnProperty e não `in`: `in` casaria herdados ("toString" in PREFIXO_TIPO)
    if (typeof patch.tipo !== "string" || !tem(PREFIXO_TIPO as Record<string, unknown>, patch.tipo)) {
      return recusa(`tipo precisa ser um de: ${Object.keys(PREFIXO_TIPO).join("|")}`);
    }
    campos.tipo = patch.tipo as KanbanTipo;
  }
  if (tem(patch, "prioridade")) {
    if (typeof patch.prioridade !== "string" || !PRIORIDADES.includes(patch.prioridade)) {
      return recusa(`prioridade precisa ser um de: ${PRIORIDADES.join("|")}`);
    }
    campos.prioridade = patch.prioridade as KanbanPrioridade;
  }
  if (tem(patch, "projeto")) {
    if (typeof patch.projeto !== "string" || !PROJETOS.includes(patch.projeto)) {
      return recusa(`projeto precisa ser um de: ${PROJETOS.join("|")}`);
    }
    campos.projeto = patch.projeto as KanbanProjeto;
  }
  if (tem(patch, "responsavel")) {
    if (!ehTextoOuNulo(patch.responsavel)) return recusa("responsavel precisa ser texto ou nulo");
    campos.responsavel = patch.responsavel;
  }
  if (tem(patch, "tags")) {
    if (!ehArrayDeTexto(patch.tags)) return recusa("tags precisa ser array de texto");
    campos.tags = [...patch.tags];
  }
  if (tem(patch, "checklist")) {
    if (!Array.isArray(patch.checklist)) return recusa("checklist precisa ser array");
    const checklist: KanbanChecklistItem[] = [];
    for (const item of patch.checklist) {
      if (!ehObjeto(item) || typeof item.texto !== "string" || typeof item.feito !== "boolean") {
        return recusa("cada item de checklist precisa ter texto (string) e feito (boolean)");
      }
      checklist.push({ texto: item.texto, feito: item.feito });
    }
    campos.checklist = checklist;
  }
  if (tem(patch, "execucao")) {
    const v = patch.execucao;
    if (v === null) {
      campos.execucao = null;
    } else {
      if (!ehObjeto(v) || typeof v.modo !== "string" || !MODOS_EXECUCAO.includes(v.modo)) {
        return recusa(`execucao.modo precisa ser um de: ${MODOS_EXECUCAO.join("|")}`);
      }
      const execucao: KanbanExecucao = { modo: v.modo as KanbanExecucao["modo"] };
      if (v.pctAgente !== undefined && v.pctAgente !== null) {
        if (typeof v.pctAgente !== "number" || !Number.isFinite(v.pctAgente) || v.pctAgente < 0 || v.pctAgente > 100) {
          return recusa("execucao.pctAgente precisa ser número de 0 a 100");
        }
        execucao.pctAgente = v.pctAgente;
      }
      if (v.executor !== undefined && v.executor !== null) {
        if (typeof v.executor !== "string") return recusa("execucao.executor precisa ser texto");
        execucao.executor = v.executor;
      }
      campos.execucao = execucao;
    }
  }
  // origem/ingestao: sub-allowlist campo a campo, mesclados com o valor atual na
  // aplicação — nunca por spread do que veio no corpo.
  if (tem(patch, "origem")) {
    const v = patch.origem;
    if (!ehObjeto(v)) return recusa("origem precisa ser um objeto");
    const origem: Partial<KanbanOrigem> = {};
    if (tem(v, "canal")) {
      if (!ehTextoOuNulo(v.canal)) return recusa("origem.canal precisa ser texto ou nulo");
      origem.canal = v.canal as KanbanCanalPedido | null;
    }
    if (tem(v, "pedidoOriginal")) {
      if (!ehTextoOuNulo(v.pedidoOriginal)) return recusa("origem.pedidoOriginal precisa ser texto ou nulo");
      origem.pedidoOriginal = v.pedidoOriginal;
    }
    if (tem(v, "solicitadoPor")) {
      if (!ehTextoOuNulo(v.solicitadoPor)) return recusa("origem.solicitadoPor precisa ser texto ou nulo");
      origem.solicitadoPor = v.solicitadoPor;
    }
    campos.origem = origem;
  }
  if (tem(patch, "ingestao")) {
    const v = patch.ingestao;
    if (!ehObjeto(v)) return recusa("ingestao precisa ser um objeto");
    const ingestao: Partial<KanbanIngestao> = {};
    if (tem(v, "fonteTipo")) {
      if (!ehArrayDeTexto(v.fonteTipo)) return recusa("ingestao.fonteTipo precisa ser array de texto");
      ingestao.fonteTipo = [...v.fonteTipo] as KanbanFonteTipo[];
    }
    if (tem(v, "fonteUrl")) {
      if (!ehArrayDeTexto(v.fonteUrl)) return recusa("ingestao.fonteUrl precisa ser array de texto");
      ingestao.fonteUrl = [...v.fonteUrl];
    }
    if (tem(v, "fontePath")) {
      if (!ehArrayDeTexto(v.fontePath)) return recusa("ingestao.fontePath precisa ser array de texto");
      ingestao.fontePath = [...v.fontePath];
    }
    if (tem(v, "bucket")) {
      if (!ehTextoOuNulo(v.bucket)) return recusa("ingestao.bucket precisa ser texto ou nulo");
      ingestao.bucket = v.bucket as KanbanBucket | null;
    }
    if (tem(v, "pessoaAutor")) {
      if (!ehTextoOuNulo(v.pessoaAutor)) return recusa("ingestao.pessoaAutor precisa ser texto ou nulo");
      ingestao.pessoaAutor = v.pessoaAutor;
    }
    campos.ingestao = ingestao;
  }
  if (tem(patch, "links")) {
    if (!Array.isArray(patch.links)) return recusa("links precisa ser array");
    const links: KanbanLink[] = [];
    for (const item of patch.links) {
      if (!ehObjeto(item) || typeof item.tipo !== "string" || typeof item.url !== "string") {
        return recusa("cada link precisa ter tipo e url em texto");
      }
      if (tem(item, "repo") && !ehTextoOuNulo(item.repo)) {
        return recusa("link.repo precisa ser texto ou nulo");
      }
      links.push({
        tipo: item.tipo as KanbanLinkTipo,
        url: item.url,
        ...(tem(item, "repo") ? { repo: item.repo as string | null } : {}),
      });
    }
    campos.links = links;
  }
  if (tem(patch, "vinculos")) {
    if (!Array.isArray(patch.vinculos)) return recusa("vinculos precisa ser array");
    const vinculos: KanbanVinculo[] = [];
    for (const item of patch.vinculos) {
      if (
        !ehObjeto(item) ||
        typeof item.tipo !== "string" ||
        typeof item.id !== "string" ||
        typeof item.titulo !== "string"
      ) {
        return recusa("cada vínculo precisa ter tipo, id e titulo em texto");
      }
      if (tem(item, "linkLocal") && !ehTextoOuNulo(item.linkLocal)) {
        return recusa("vinculo.linkLocal precisa ser texto ou nulo");
      }
      vinculos.push({
        tipo: item.tipo as KanbanVinculo["tipo"],
        id: item.id,
        titulo: item.titulo,
        linkLocal: (item.linkLocal as string | null | undefined) ?? null,
      });
    }
    campos.vinculos = vinculos;
  }
  if (tem(patch, "historico")) {
    const ev = validarEvidenciasHistorico(patch.historico);
    if (!ev.ok) return ev;
    campos.historicoEvidencias = ev.evidencias;
  }

  return { ok: true, campos };
}

/** Extrai APENAS a evidência editável de cada linha do histórico. O corpo que a
 *  UI manda é o histórico inteiro (ela reenvia o card que recebeu), então
 *  `de`/`para`/`em` chegam aqui — e são conferidos, não aplicados: divergir
 *  deles é tentativa de reescrever auditoria e leva 400. Índice fora do array
 *  atual também é recusado (o PATCH não cria nem remove transição). */
function validarEvidenciasHistorico(
  bruto: unknown,
): { ok: true; evidencias: EvidenciaHistorico[] } | PatchRecusado {
  if (!Array.isArray(bruto)) return recusa("historico precisa ser array");
  const evidencias: EvidenciaHistorico[] = [];
  for (const [i, item] of bruto.entries()) {
    if (!ehObjeto(item)) return recusa(`historico[${i}] precisa ser objeto`);
    const e: EvidenciaHistorico = { indice: i, transicao: {} };
    if (tem(item, "nota")) {
      if (typeof item.nota !== "string") return recusa(`historico[${i}].nota precisa ser texto`);
      e.nota = item.nota;
    }
    if (tem(item, "links")) {
      if (!Array.isArray(item.links)) return recusa(`historico[${i}].links precisa ser array`);
      const links: KanbanLink[] = [];
      for (const l of item.links) {
        if (!ehObjeto(l) || typeof l.tipo !== "string" || typeof l.url !== "string") {
          return recusa(`historico[${i}].links: cada link precisa ter tipo e url em texto`);
        }
        if (tem(l, "repo") && !ehTextoOuNulo(l.repo)) {
          return recusa(`historico[${i}].links: repo precisa ser texto ou nulo`);
        }
        links.push({
          tipo: l.tipo as KanbanLinkTipo,
          url: l.url,
          ...(tem(l, "repo") ? { repo: l.repo as string | null } : {}),
        });
      }
      e.links = links;
    }
    for (const k of ["de", "para", "em"] as const) {
      if (tem(item, k)) e.transicao[k] = item[k];
    }
    const extras = Object.keys(item).filter(
      (k) => !["nota", "links", "de", "para", "em"].includes(k),
    );
    if (extras.length) return recusa(`historico[${i}]: campos não editáveis: ${extras.join(", ")}`);
    evidencias.push(e);
  }
  return { ok: true, evidencias };
}

type EvidenciaHistorico = {
  indice: number;
  nota?: string;
  links?: KanbanLink[];
  transicao: { de?: unknown; para?: unknown; em?: unknown };
};


function diffChecklistHistorico(
  antigo: KanbanChecklistItem[],
  novo: KanbanChecklistItem[],
  coluna: KanbanColunaId,
  em: string,
): KanbanHistoricoEntry[] {
  const feitoAntes = new Map(antigo.map((i) => [i.texto, i.feito]));
  const eventos: KanbanHistoricoEntry[] = [];
  for (const item of novo) {
    const antes = feitoAntes.get(item.texto);
    if (antes !== undefined && antes !== item.feito) {
      eventos.push({
        tipo: "checklist",
        de: coluna,
        para: coluna,
        em,
        nota: item.feito ? `✓ concluído: ${item.texto}` : `↺ reaberto: ${item.texto}`,
      });
    }
  }
  return eventos;
}

/** Garante a DoD do tipo presente no checklist e não deixa apagar de fato: se
 *  um item da definição de pronto sumiu (apagado no editor, ou o tipo mudou
 *  pra um que exige mais), ele volta desmarcado. É isso que impede checklist
 *  bater 100% (e autoconcluir) sem os critérios terem sido confirmados —
 *  incluindo o commit/push/PR/merge dos tipos que mexem em código.
 *
 *  Card já fechado (done/cancel) não é tocado: injetar critério em card
 *  encerrado só sujaria o histórico, e nenhum dos dois pode autoconcluir. */
function garantirDoD(card: KanbanCard): void {
  if (card.coluna === "done" || card.coluna === "cancel") return;
  for (const texto of DOD_POR_TIPO[card.tipo] ?? []) {
    if (card.checklist.some((i) => i.texto === texto)) continue;
    card.checklist.push({ texto, feito: false });
  }
}

/** Itens da DoD do tipo que ainda não estão marcados no card. Avalia contra o
 *  template (DOD_POR_TIPO), não contra o checklist gravado — card antigo que
 *  nunca recebeu os itens é medido pelo mesmo critério. */
export function dodPendente(card: KanbanCard): string[] {
  const feitos = new Set(card.checklist.filter((i) => i.feito).map((i) => i.texto));
  return (DOD_POR_TIPO[card.tipo] ?? []).filter((texto) => !feitos.has(texto));
}


function autoConcluirSeChecklistCompleto(board: KanbanBoard, card: KanbanCard, em: string): void {
  if (card.checklist.length === 0 || !card.checklist.every((i) => i.feito) || card.coluna === "done") return;
  const idxAtual = board.colunas.findIndex((c) => c.id === card.coluna);
  const idxDone = board.colunas.findIndex((c) => c.id === "done");
  if (idxDone === -1 || idxDone < idxAtual) return;
  const colunaAntes = card.coluna;
  const ordemMax = Math.max(-1, ...board.cards.filter((c) => c.coluna === "done" && c.id !== card.id).map((c) => c.ordem));
  card.coluna = "done";
  card.ordem = ordemMax + 1;
  card.concluidoEm = em;
  card.historico.push({
    tipo: "coluna",
    de: colunaAntes,
    para: "done",
    em,
    nota: "checklist 100% concluído — movido automaticamente",
  });
}

/** Aplica a evidência sobre o histórico REAL do card. Recusa se a transição
 *  enviada não for a que está gravada — inclusive tamanho diferente. */
function aplicarEvidenciasHistorico(
  card: KanbanCard,
  evidencias: EvidenciaHistorico[],
): PatchRecusado | null {
  if (evidencias.length !== card.historico.length) {
    return recusa(
      `historico tem ${card.historico.length} transição(ões); o patch enviou ${evidencias.length} — o PATCH não cria nem remove transição`,
    );
  }
  for (const e of evidencias) {
    const atual = card.historico[e.indice];
    for (const k of ["de", "para", "em"] as const) {
      if (e.transicao[k] !== undefined && e.transicao[k] !== atual[k]) {
        return recusa(`historico[${e.indice}].${k} é imutável (trilha de auditoria)`);
      }
    }
  }
  for (const e of evidencias) {
    const atual = card.historico[e.indice];
    if (e.nota !== undefined) atual.nota = e.nota;
    if (e.links !== undefined) atual.links = e.links;
  }
  return null;
}

/** Aplica só o que `validarPatchCard` construiu — atribuição explícita por
 *  campo, sem `Object.assign` de objeto externo. */
function aplicarPatchCard(card: KanbanCard, campos: PatchCardInput): void {
  if (campos.titulo !== undefined) card.titulo = campos.titulo;
  if (campos.descricao !== undefined) card.descricao = campos.descricao;
  if (campos.tipo !== undefined) card.tipo = campos.tipo;
  if (campos.prioridade !== undefined) card.prioridade = campos.prioridade;
  if (campos.projeto !== undefined) card.projeto = campos.projeto;
  if (campos.responsavel !== undefined) card.responsavel = campos.responsavel;
  if (campos.tags !== undefined) card.tags = campos.tags;
  if (campos.checklist !== undefined) card.checklist = campos.checklist;
  if (campos.execucao !== undefined) card.execucao = campos.execucao;
  if (campos.origem !== undefined) card.origem = { ...card.origem, ...campos.origem };
  if (campos.ingestao !== undefined) card.ingestao = { ...card.ingestao, ...campos.ingestao };
  if (campos.links !== undefined) card.links = campos.links;
  if (campos.vinculos !== undefined) card.vinculos = campos.vinculos;
}

export async function atualizarCard(id: string, patch: unknown): Promise<AtualizarCardResultado> {
  const validado = validarPatchCard(patch);
  // valida antes de tocar no disco: corpo adulterado nunca chega a abrir o board
  if (!validado.ok) return validado;
  return comLock(async () => {
    const board = await lerBoardBruto();
    const card = board.cards.find((c) => c.id === id);
    if (!card) {
      return { ok: false, motivo: "nao-encontrado", erro: "ticket não encontrado" } as AtualizarCardResultado;
    }
    if (validado.campos.historicoEvidencias) {
      // depende do card, então só valida aqui (o board já está aberto sob lock)
      const erro = aplicarEvidenciasHistorico(card, validado.campos.historicoEvidencias);
      if (erro) return erro as AtualizarCardResultado;
    }
    const agora = new Date().toISOString();
    const eventosChecklist = validado.campos.checklist
      ? diffChecklistHistorico(card.checklist, validado.campos.checklist, card.coluna, agora) : [];
    aplicarPatchCard(card, validado.campos);
    card.historico.push(...eventosChecklist);
    garantirDoD(card);
    autoConcluirSeChecklistCompleto(board, card, agora);
    card.atualizadoEm = new Date().toISOString();
    board.atualizadoEm = card.atualizadoEm;
    await salvarBoard(board);
    return { ok: true, card } as AtualizarCardResultado;
  });
}

export type MoverCardResultado =
  | { ok: true; card: KanbanCard }
  | { ok: false; erro: string; faltando?: string[] };

export type MoverCardOpts = {
  /** Motivo pra fechar com a DoD incompleta. Fica no histórico do card — é a
   *  única saída do gate, e por isso não aceita string vazia. */
  override?: string;
};

/** Move um card pra outra coluna (ou reordena na mesma), inserindo na posição
 *  `index` (0-based) — renumera `ordem` das colunas afetadas.
 *
 *  Regra do board: status não volta — só avança (índice da coluna destino >=
 *  índice da origem na ordem atual de `board.colunas`) ou fica parado
 *  (reordenar dentro da mesma coluna, sempre permitido).
 *
 *  Gate de "done": a DoD do tipo (DOD_POR_TIPO) precisa estar inteira marcada.
 *  Sem isso o destino é recusado com a lista do que falta — fechar assim mesmo
 *  exige `override` com motivo, que fica registrado. "cancel" segue livre: é a
 *  saída de card abandonado, e não afirma que o trabalho ficou pronto. */
export async function moverCard(
  id: string,
  coluna: KanbanColunaId,
  index: number,
  opts: MoverCardOpts = {},
): Promise<MoverCardResultado> {
  return comLock(async () => {
    const board = await lerBoardBruto();
    const card = board.cards.find((c) => c.id === id);
    if (!card) return { ok: false, erro: "ticket não encontrado" };
    if (!board.colunas.some((c) => c.id === coluna)) return { ok: false, erro: "coluna não encontrada" };
    const colunaOrigem = card.coluna;
    const agora = new Date().toISOString();
    const motivo = (opts.override ?? "").trim();

    if (colunaOrigem !== coluna) {
      const idxOrigem = board.colunas.findIndex((c) => c.id === colunaOrigem);
      const idxDestino = board.colunas.findIndex((c) => c.id === coluna);
      if (idxDestino < idxOrigem) {
        return { ok: false, erro: "status não volta — só avança ou fica parado" };
      }

      const faltando = coluna === "done" ? dodPendente(card) : [];
      if (faltando.length > 0 && !motivo) {
        const total = DOD_POR_TIPO[card.tipo]?.length ?? 0;
        return {
          ok: false,
          erro: `DoD incompleta: ${total - faltando.length} de ${total} itens`,
          faltando,
        };
      }

      card.historico.push({
        de: colunaOrigem,
        para: coluna,
        em: agora,
        ...(faltando.length > 0 ? { nota: `done SEM DoD — ${motivo}` } : {}),
      });
      card.concluidoEm = coluna === "done" ? agora : null;
      card.coluna = coluna;
    }

    // reconstrói a ordem da coluna alvo com o card na posição pedida
    const destino = board.cards
      .filter((c) => c.coluna === coluna && c.id !== id)
      .sort((a, b) => a.ordem - b.ordem);
    destino.splice(Math.max(0, Math.min(index, destino.length)), 0, card);
    destino.forEach((c, i) => (c.ordem = i));

    // se saiu de coluna, renumera a coluna de origem pra fechar o buraco
    if (colunaOrigem !== coluna) {
      board.cards
        .filter((c) => c.coluna === colunaOrigem)
        .sort((a, b) => a.ordem - b.ordem)
        .forEach((c, i) => (c.ordem = i));
    }

    card.atualizadoEm = agora;
    board.atualizadoEm = agora;
    await salvarBoard(board);
    return { ok: true, card };
  });
}

export async function excluirCard(id: string): Promise<boolean> {
  return comLock(async () => {
    const board = await lerBoardBruto();
    const antes = board.cards.length;
    board.cards = board.cards.filter((c) => c.id !== id);
    if (board.cards.length === antes) return false;
    board.atualizadoEm = new Date().toISOString();
    await salvarBoard(board);
    return true;
  });
}

// ── Colunas — o board não fica preso a TO DO/DOING/DONE/CANCEL: dá pra criar,
// renomear, reordenar e excluir coluna (só se ela estiver vazia). ──

export async function criarColuna(rotulo: string): Promise<KanbanBoard> {
  return comLock(async () => {
    const board = await lerBoardBruto();
    const base = slugColuna(rotulo);
    let id = base;
    let n = 2;
    while (board.colunas.some((c) => c.id === id)) id = `${base}-${n++}`;
    board.colunas.push({ id, rotulo: rotulo.trim() });
    board.atualizadoEm = new Date().toISOString();
    await salvarBoard(board);
    return board;
  });
}

export async function atualizarColuna(
  id: string,
  patch: { rotulo?: string; wipLimite?: number | null },
): Promise<KanbanBoard | null> {
  return comLock(async () => {
    const board = await lerBoardBruto();
    const col = board.colunas.find((c) => c.id === id);
    if (!col) return null;
    if (patch.rotulo?.trim()) col.rotulo = patch.rotulo.trim();
    if (patch.wipLimite !== undefined) {
      if (patch.wipLimite == null) delete board.wipLimites[id];
      else board.wipLimites[id] = patch.wipLimite;
    }
    board.atualizadoEm = new Date().toISOString();
    await salvarBoard(board);
    return board;
  });
}

export async function reordenarColunas(ordem: string[]): Promise<KanbanBoard> {
  return comLock(async () => {
    const board = await lerBoardBruto();
    const porId = new Map(board.colunas.map((c) => [c.id, c]));
    const novo = ordem.map((id) => porId.get(id)).filter((c): c is KanbanColuna => !!c);
    const faltando = board.colunas.filter((c) => !ordem.includes(c.id));
    board.colunas = [...novo, ...faltando];
    board.atualizadoEm = new Date().toISOString();
    await salvarBoard(board);
    return board;
  });
}

export type ExcluirColunaResultado = { ok: true; board: KanbanBoard } | { ok: false; erro: string };

export async function excluirColuna(id: string): Promise<ExcluirColunaResultado> {
  return comLock(async () => {
    const board = await lerBoardBruto();
    if (!board.colunas.some((c) => c.id === id)) return { ok: false, erro: "coluna não encontrada" };
    const emUso = board.cards.filter((c) => c.coluna === id).length;
    if (emUso > 0) {
      return { ok: false, erro: `coluna tem ${emUso} ticket${emUso > 1 ? "s" : ""} — mova ou exclua antes` };
    }
    board.colunas = board.colunas.filter((c) => c.id !== id);
    delete board.wipLimites[id];
    board.atualizadoEm = new Date().toISOString();
    await salvarBoard(board);
    return { ok: true, board };
  });
}

// ── Áudio — nota de voz anexada ao ticket (o arquivo em si é gravado pela
// rota de API; aqui só registra/remove a referência no card). ──

export async function adicionarAudio(cardId: string, arquivo: string): Promise<KanbanCard | null> {
  return comLock(async () => {
    const board = await lerBoardBruto();
    const card = board.cards.find((c) => c.id === cardId);
    if (!card) return null;
    card.audios.push({ arquivo, criadoEm: new Date().toISOString() });
    card.atualizadoEm = new Date().toISOString();
    board.atualizadoEm = card.atualizadoEm;
    await salvarBoard(board);
    return card;
  });
}

export async function removerAudio(cardId: string, arquivo: string): Promise<KanbanCard | null> {
  return comLock(async () => {
    const board = await lerBoardBruto();
    const card = board.cards.find((c) => c.id === cardId);
    if (!card) return null;
    card.audios = card.audios.filter((a) => a.arquivo !== arquivo);
    card.atualizadoEm = new Date().toISOString();
    board.atualizadoEm = card.atualizadoEm;
    await salvarBoard(board);
    return card;
  });
}

// ── Imagens — print/referência visual anexada ao ticket (o arquivo em si é
// gravado pela rota de API; aqui só registra/remove a referência no card). ──

export async function adicionarImagem(cardId: string, arquivo: string, legenda?: string): Promise<KanbanCard | null> {
  return comLock(async () => {
    const board = await lerBoardBruto();
    const card = board.cards.find((c) => c.id === cardId);
    if (!card) return null;
    card.imagens.push({ arquivo, criadoEm: new Date().toISOString(), ...(legenda ? { legenda } : {}) });
    card.atualizadoEm = new Date().toISOString();
    board.atualizadoEm = card.atualizadoEm;
    await salvarBoard(board);
    return card;
  });
}

export async function removerImagem(cardId: string, arquivo: string): Promise<KanbanCard | null> {
  return comLock(async () => {
    const board = await lerBoardBruto();
    const card = board.cards.find((c) => c.id === cardId);
    if (!card) return null;
    card.imagens = card.imagens.filter((i) => i.arquivo !== arquivo);
    card.atualizadoEm = new Date().toISOString();
    board.atualizadoEm = card.atualizadoEm;
    await salvarBoard(board);
    return card;
  });
}

/** Resumo de aprendizado opt-in ao concluir um ticket — vira markdown avulso,
 *  buscável por arquivo (fora do board.json e do grafo). Nunca escreve fora
 *  de APRENDIZADOS_DIR (cardId vem de rota, mas sanitiza mesmo assim). */
function aprendizadoPathFor(cardId: string): string | null {
  if (!cardIdValido(cardId)) return null;
  return path.join(APRENDIZADOS_DIR, `${cardId}.md`);
}

export async function getAprendizado(cardId: string): Promise<string> {
  const p = aprendizadoPathFor(cardId);
  if (!p) return "";
  try {
    const raw = await readFile(p, "utf-8");
    return raw.replace(/^---[\s\S]*?---\n\n?/, ""); // tira o frontmatter, devolve só o texto
  } catch {
    return "";
  }
}

export async function salvarAprendizado(cardId: string, titulo: string, texto: string): Promise<boolean> {
  const p = aprendizadoPathFor(cardId);
  if (!p) return false;
  await mkdir(APRENDIZADOS_DIR, { recursive: true });
  const md = `---\ncardId: ${cardId}\ntitulo: ${JSON.stringify(titulo)}\nsalvoEm: ${new Date().toISOString()}\n---\n\n${texto.trim()}\n`;
  await writeFile(p, md);
  return true;
}
