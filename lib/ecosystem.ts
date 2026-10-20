/**
 * Inventário read-only do ecossistema de agentes (squads, agents, skills, repos…).
 * Só mostra o que o usuário configurar: um registro de entidades, uma lista de
 * repositórios e uma lista de itens espelhados. Sem configuração, o inventário
 * é simplesmente vazio. Contrato dos arquivos: docs/agente-registro.md.
 */
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { lerTextoComTeto } from "./arquivo-teto";
import { bilhonRoot, caminhoBilhonPermitido, exigirCaminhoBilhon, lerEnv } from "./bilhon-paths";
import { cortaTexto } from "./texto";
import { ehEcoUsoStatus } from "./types";
import type { EcoEntity, EcoFonte, EcoFonteEstado, EcoKind, EcoProcedencia, EcoUso, Ecosystem } from "./types";

const KINDS: EcoKind[] = ["squad", "agent", "skill", "workflow", "clone", "shadow", "worker", "engine", "repo"];
export const PROCEDENCIAS: readonly EcoProcedencia[] = ["propria", "adotada", "terceiro"];

// O estado local (favoritos, ocultos, uso, repos, espelhos) fica ao lado do app por
// padrão. Cada acesso passa pela contenção da raiz (lib/bilhon-paths).
const stateDir = () => path.resolve(lerEnv("BILHON_AGENTE_DIR") ?? path.join(process.cwd(), "data", "agente"));
const statePath = (name: string) => path.join(stateDir(), name);

/** Pasta de estado local da página Agente (BILHON_AGENTE_DIR; padrão data/agente). */
export const agenteDir = stateDir;

export function identidadeTipada(kind: EcoKind, namespace: string, name: string): string {
  return `${kind}:${namespace}:${name}`;
}

function relPath(value: string): string {
  const withoutFragment = value.split("#")[0];
  const absolute = path.isAbsolute(withoutFragment) ? withoutFragment : path.join(bilhonRoot(), withoutFragment);
  return path.relative(bilhonRoot(), absolute).replace(/\\/g, "/");
}

/** Owners (usuário ou organização do repositório) tratados como próprios: CSV em BILHON_OWNERS_PROPRIOS. */
export function ownersProprios(): string[] {
  return (lerEnv("BILHON_OWNERS_PROPRIOS") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export type OpcoesProcedencia = {
  /** procedência escrita na própria fonte; só vale se for um dos três valores */
  declarada?: unknown;
  owner?: string | null;
  /** a fonte marca o item como conteúdo de terceiro (ex.: material de referência) */
  terceiroDeclarado?: boolean;
  /** lista de owners próprios; padrão: BILHON_OWNERS_PROPRIOS */
  owners?: readonly string[];
};

/**
 * Eixo de admissão do item. A primeira regra que casa decide:
 *  1. a fonte declara que é de terceiro → terceiro
 *  2. a fonte declara uma procedência válida → ela
 *  3. há owners próprios configurados e o owner do item não está entre eles → terceiro
 *  4. nos demais casos → própria (sem informação contrária, o item é de quem configurou)
 */
export function derivarProcedencia(opts: OpcoesProcedencia = {}): EcoProcedencia {
  if (opts.terceiroDeclarado) return "terceiro";
  if (typeof opts.declarada === "string" && (PROCEDENCIAS as readonly string[]).includes(opts.declarada)) {
    return opts.declarada as EcoProcedencia;
  }
  const owners = (opts.owners ?? ownersProprios()).map((o) => o.toLowerCase());
  const owner = opts.owner?.trim().toLowerCase();
  if (owners.length > 0 && owner && !owners.includes(owner)) return "terceiro";
  return "propria";
}

/** Caminho (sem fragmento) de uma observação do registro, resolvido a partir da raiz. */
function fonteObservada(value: string): string | null {
  const semFragmento = value.split("#")[0].trim();
  return semFragmento ? path.resolve(bilhonRoot(), semFragmento) : null;
}

/**
 * Mapeia as linhas do registro de entidades. O `rid` do registro é a identidade e é
 * preservado como veio; sem `rid`, a identidade é derivada de tipo+nome. Linhas com
 * tipo desconhecido, sem nome ou sem nenhum caminho dentro da raiz são descartadas.
 */
export function mapearRegistro(rows: unknown[]): EcoEntity[] {
  const out: EcoEntity[] = [];
  const seen = new Set<string>();
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if (typeof row.api_name !== "string" || !row.api_name.trim() || !KINDS.includes(row.tipo as EcoKind)) continue;
    const kind = row.tipo as EcoKind;
    const name = row.api_name.trim();
    const observed = Array.isArray(row.observed) ? row.observed.filter((v): v is string => typeof v === "string") : [];
    const source = observed.find((v) => {
      const abs = fonteObservada(v);
      return abs !== null && caminhoBilhonPermitido(abs);
    });
    if (!source) continue;
    const rid = typeof row.rid === "string" ? row.rid.trim() : "";
    const id = rid || identidadeTipada(kind, "registro", name);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id, legacyId: `${kind}:${name}`, kind, namespace: "registro", name, nome: name,
      descricao: cortaTexto(typeof row.role === "string" ? row.role : "", 400),
      origem: "registro", path: relPath(source),
      procedencia: derivarProcedencia({ declarada: row.procedencia, owner: typeof row.owner === "string" ? row.owner : null }),
      tags: typeof row.status === "string" ? [row.status] : [],
      meta: { rid: rid || null, squad: typeof row.squad === "string" ? row.squad : null },
    });
  }
  const squads = new Map(out.filter((e) => e.kind === "squad").map((e) => [e.name, e.id]));
  for (const e of out) if (typeof e.meta.squad === "string" && squads.has(e.meta.squad)) e.squadId = squads.get(e.meta.squad);
  return out;
}

export type LeituraFonte = { dado: unknown; estado: EcoFonteEstado };

/** Lê JSON (ou YAML) de uma fonte opcional, dizendo por que veio vazia em vez de lançar. */
export async function lerFonte(file: string | undefined, yaml = false): Promise<LeituraFonte> {
  if (!file) return { dado: null, estado: "nao-configurada" };
  const abs = path.resolve(file);
  if (!caminhoBilhonPermitido(abs)) return { dado: null, estado: "fora-da-raiz" };
  let text: string;
  try {
    text = await lerTextoComTeto(abs);
  } catch (error) {
    return { dado: null, estado: (error as NodeJS.ErrnoException).code === "ENOENT" ? "ausente" : "invalida" };
  }
  try {
    return { dado: yaml ? loadYaml(text) : JSON.parse(text), estado: "ok" };
  } catch {
    return { dado: null, estado: "invalida" };
  }
}

export function parseUso(v: unknown): EcoUso | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!ehEcoUsoStatus(o.status)) return null;
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x) ? x : 0;
  return { eventos: num(o.eventos), logsession: num(o.logsession), invocacao: num(o.invocacao), leitura_fraca: num(o.leitura_fraca),
    sinais: num(o.sinais), status: o.status, dias: num(o.dias), ultimo: typeof o.ultimo === "string" ? o.ultimo : null,
    ambiguo: o.ambiguo === true, tocada_por_teste: o.tocada_por_teste === true,
    proveniencia: o.proveniencia === "incerta" ? "incerta" : "atribuida",
    fontes: Array.isArray(o.fontes) ? o.fontes.filter((s): s is string => typeof s === "string") : [] };
}

let cache: { key: string; at: number; data: Ecosystem } | null = null;

/** Só para teste: a próxima leitura volta a consultar o disco. */
export function limparCacheEcossistema() {
  cache = null;
}

export async function getEcosystem(): Promise<Ecosystem> {
  const registryPath = lerEnv("BILHON_REGISTRO_ENTIDADES");
  const reposPath = lerEnv("BILHON_REPOS_JSON") ?? statePath("repos.json");
  const mirrorsPath = lerEnv("BILHON_AGENTES_JSON") ?? statePath("espelhos.json");
  const key = [bilhonRoot(), registryPath ?? "", reposPath, mirrorsPath, stateDir(), ownersProprios().join(",")].join("|");
  if (cache?.key === key && Date.now() - cache.at < 60_000) return cache.data;
  const [registry, usage, repos, mirrors] = await Promise.all([
    lerFonte(registryPath, true),
    lerFonte(statePath("uso.json")),
    lerFonte(reposPath),
    lerFonte(mirrorsPath),
  ]);
  const raw = registry.dado;
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { entities?: unknown[] }).entities : [];
  const entities = mapearRegistro(Array.isArray(rows) ? rows : []);
  const extras = [...mapRepos(Array.isArray(repos.dado) ? repos.dado : []), ...mapEspelhos(Array.isArray(mirrors.dado) ? mirrors.dado : [])];
  const normalizarFonte = (p: string) => p.replace(/\\/g, "/").replace(/\/SKILL\.md$/i, "").toLowerCase();
  const seen = new Set(entities.map((e) => `${e.kind}|${normalizarFonte(e.path)}`));
  const ids = new Set(entities.map((e) => e.id));
  for (const extra of extras) {
    const key = `${extra.kind}|${normalizarFonte(extra.path)}`;
    if (!seen.has(key) && !ids.has(extra.id)) { entities.push(extra); seen.add(key); ids.add(extra.id); }
  }
  for (const entity of entities) if (entity.squadId && !ids.has(entity.squadId)) delete entity.squadId;
  const overlay = usage.dado && typeof usage.dado === "object" ? (usage.dado as { uso?: Record<string, unknown> }).uso : undefined;
  for (const entity of entities) {
    const parsed = parseUso(overlay?.[entity.id]);
    if (parsed) entity.uso = parsed;
  }
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<EcoKind, number>;
  const countsPorProcedencia = Object.fromEntries(PROCEDENCIAS.map((kind) => [kind, 0])) as Record<EcoProcedencia, number>;
  for (const entity of entities) { counts[entity.kind]++; countsPorProcedencia[entity.procedencia]++; }
  const fontes: EcoFonte[] = [
    { id: "registro", env: "BILHON_REGISTRO_ENTIDADES", estado: registry.estado },
    { id: "repos", env: "BILHON_REPOS_JSON", estado: repos.estado },
    { id: "espelhos", env: "BILHON_AGENTES_JSON", estado: mirrors.estado },
    { id: "uso", env: "BILHON_AGENTE_DIR", estado: usage.estado },
  ];
  const data: Ecosystem = { entities, counts, countsPorProcedencia, geradoEm: new Date().toISOString(), fontes };
  cache = { key, at: Date.now(), data };
  return data;
}

type FavoritoEntry = { em: string };
type OcultoEntry = { em: string; motivo: string | null };
let filaEscrita: Promise<unknown> = Promise.resolve();
function comLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = filaEscrita.then(fn, fn);
  filaEscrita = next.catch(() => {});
  return next;
}

async function readJsonStore<T>(name: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(exigirCaminhoBilhon(statePath(name)), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error; // um arquivo corrompido não pode virar estado vazio e ser sobrescrito
  }
}
async function writeJsonAtomic(name: string, value: unknown): Promise<void> {
  const file = exigirCaminhoBilhon(statePath(name));
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, JSON.stringify(value, null, 1));
  await rename(temp, file);
}

/**
 * Liga/desliga uma marcação pela identidade tipada. Ao desligar, apaga também a
 * chave legada (`legacyId`), para que um estado gravado no formato antigo suma junto.
 * Define a chave por `defineProperty` para que um id como "__proto__" vire chave
 * comum e não mexa no protótipo do objeto.
 */
export function aplicarMarcacaoDual<T>(atual: Record<string, T>, id: string, on: boolean, valor: T, legacyId?: string): Record<string, T> {
  const next = { ...atual };
  if (on) Object.defineProperty(next, id, { value: valor, enumerable: true, configurable: true, writable: true });
  else { delete next[id]; if (legacyId) delete next[legacyId]; }
  return next;
}
export const getFavoritosAgente = () => readJsonStore<Record<string, FavoritoEntry>>("favoritos.json", {});
export const getOcultosAgente = () => readJsonStore<Record<string, OcultoEntry>>("ocultos.json", {});

function setMarcacao<T>(file: string, id: string, on: boolean, value: T, legacyId?: string) {
  return comLock(async () => {
    if (!id || id.length > 500) throw new Error("Identidade inválida.");
    const next = aplicarMarcacaoDual(await readJsonStore<Record<string, T>>(file, {}), id, on, value, legacyId);
    await writeJsonAtomic(file, next);
    return next;
  });
}
export const setFavoritoAgente = (id: string, on: boolean, legacyId?: string) => setMarcacao("favoritos.json", id, on, { em: new Date().toISOString() }, legacyId);
export const setOcultoAgente = (id: string, on: boolean, motivo?: string, legacyId?: string) => setMarcacao("ocultos.json", id, on, { em: new Date().toISOString(), motivo: motivo ?? null }, legacyId);

type RepoSinergia = {
  slug: string;
  path?: string;
  source?: string | null;
  owner?: string | null;
  repo?: string | null;
  url?: string | null;
  procedencia?: string | null;
  readme_first_line?: string | null;
  readme_summary?: { tagline?: string | null; title?: string | null } | null;
  tier?: string | null;
  category?: string | null;
  n_neighbors?: number | null;
  neighbors?: Array<{ slug: string; score?: number }> | null;
  github?: {
    description?: string | null;
    stars?: number | null;
    forks?: number | null;
    language?: string | null;
    topics?: string[] | null;
    license?: string | null;
    archived?: boolean | null;
    fork?: boolean | null;
    last_push?: string | null;
    html_url?: string | null;
  } | null;
};

function mapRepos(repos: RepoSinergia[]): EcoEntity[] {
  return repos.filter((r) => r && typeof r.slug === "string" && typeof r.path === "string" && caminhoBilhonPermitido(path.resolve(bilhonRoot(), r.path))).map((r): EcoEntity => {
    const gh = r.github ?? {};
    const ns = "repos";
    const descricao =
      gh.description ||
      r.readme_summary?.tagline ||
      r.readme_first_line ||
      "Sem descrição no GitHub nem no README.";
    const vizinhos = (r.neighbors ?? []).map((v) => `${v.slug}:${v.score ?? 0}`);
    return {
      id: identidadeTipada("repo", ns, r.slug),
      legacyId: `repo:${ns}:${r.slug}`,
      kind: "repo",
      procedencia: derivarProcedencia({ declarada: r.procedencia, owner: r.owner }),
      namespace: ns,
      name: r.slug,
      subtype: r.source ?? undefined,
      nome: gh.html_url && r.repo && r.owner ? `${r.owner}/${r.repo}` : r.slug,
      descricao: cortaTexto(descricao, 300),
      origem: "repos.json",
      path: relPath(r.path ?? ""),
      tags: [r.tier ?? "UNKNOWN", r.category, gh.language, gh.archived ? "archived" : null].filter(
        Boolean,
      ) as string[],
      meta: {
        stars: gh.stars ?? 0,
        forks: gh.forks ?? 0,
        tier: r.tier ?? "UNKNOWN",
        categoria: r.category ?? "unknown",
        owner: r.owner ?? null,
        url: gh.html_url ?? null,
        linguagem: gh.language ?? null,
        licenca: gh.license ?? null,
        topics: (gh.topics ?? []).join(", ") || null,
        arquivado: gh.archived ?? null,
        fork: gh.fork ?? null,
        ultimo_push: gh.last_push ?? null,
        n_vizinhos: r.n_neighbors ?? vizinhos.length,
        vizinhos: vizinhos.join(", ") || null,
        resolucao: r.source ?? null,
      },
    };
  });
}

type ItemEspelho = {
  id: string;
  type: string;
  category?: string | null;
  name: string;
  label?: string | null;
  description?: string | null;
  source_path?: string | null;
  source_label?: string | null;
  owner_squad?: string | null;
  status?: string | null;
  version?: string | null;
  user_invocable?: boolean | null;
  procedencia?: string | null;
};

function pathDoEspelho(sourcePath: string | null | undefined): string {
  const rel = relPath((sourcePath ?? "").replace(/\\/g, "/"));
  return rel.endsWith(".md") ? path.posix.dirname(rel) : rel;
}

function kindDoEspelho(item: ItemEspelho): EcoKind | null {
  switch (item.type) {
    case "skill":
    case "reference":
      return "skill";
    case "squad":
      return "squad";
    case "clone":
      return "clone";
    case "agent":
      return item.owner_squad ? "worker" : "agent";
    default:
      return null; // type novo na fonte: ignora em vez de inventar kind
  }
}

function mapEspelhos(input: ItemEspelho[]): EcoEntity[] {
  const itens = input.filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.source_path === "string" && caminhoBilhonPermitido(path.resolve(bilhonRoot(), item.source_path)));
  const squadPorNome = new Map<string, string>();
  for (const item of itens) {
    if (item.type !== "squad") continue;
    const ns = `espelho:${item.source_label ?? item.category ?? "desconhecido"}`;
    squadPorNome.set(item.name, identidadeTipada("squad", ns, item.id));
  }

  const out: EcoEntity[] = [];
  for (const item of itens) {
    const kind = kindDoEspelho(item);
    if (!kind) continue;
    const caminho = pathDoEspelho(item.source_path);
    if (!caminho) continue;
    const squadId = item.owner_squad ? squadPorNome.get(item.owner_squad) : undefined;
    const ns = `espelho:${item.source_label ?? item.category ?? "desconhecido"}`;
    const ehReferencia = item.type === "reference";
    out.push({
      id: identidadeTipada(kind, ns, item.id),
      legacyId: `espelho:${item.id}`,
      kind,
      procedencia: derivarProcedencia({ declarada: item.procedencia, terceiroDeclarado: ehReferencia }),
      namespace: ns,
      name: item.id,
      subtype: item.category ?? undefined,
      nome: item.label || item.name,
      descricao: cortaTexto(item.description ?? "", 300),
      origem: "espelhos.json",
      path: caminho,
      squadId,
      tags: [
        item.category,
        item.status,
        ehReferencia ? "reference" : null,
        item.user_invocable === false ? "nao-invocavel" : null,
      ].filter(Boolean) as string[],
      meta: {
        colecao: item.source_label ?? null,
        categoria: item.category ?? null,
        status: item.status ?? null,
        version: item.version ?? null,
        owner_squad: item.owner_squad ?? null,
        invocavel: ehReferencia ? false : (item.user_invocable ?? null),
        tipo_na_fonte: item.type,
      },
    });
  }
  return out;
}
