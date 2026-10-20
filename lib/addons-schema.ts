/**
 * Schema v1 do catálogo de add-ons — tipos, taxonomia e validação
 * fail-closed. Sem `node:*` de propósito: componente client ("use client")
 * importa runtime deste módulo (CATEGORIAS_ADDON/AREAS_BOS) — se ganhasse um
 * import de fs/path/crypto, o webpack tentaria bundlar tudo pro browser
 * (o build falha com "node:fs" UnhandledSchemeError sem essa
 * separação). O loader com fs fica só em lib/addons.ts (server-only).
 */

export type AddonCategoria = "design-system" | "framework-checklist" | "function-utility" | "app-recreation";

export const CATEGORIAS_ADDON: Record<AddonCategoria, string> = {
  "design-system": "Design system",
  "framework-checklist": "Framework / checklist",
  "function-utility": "Função / utilitário",
  "app-recreation": "Recriação de app",
};

/** As 6 áreas de interface do catálogo — faceta secundária, não domínio. */
export type AreaBos = "dashboards" | "login" | "modulos" | "rules" | "skills" | "antipattern";
export const AREAS_BOS: readonly AreaBos[] = [
  "dashboards",
  "login",
  "modulos",
  "rules",
  "skills",
  "antipattern",
] as const;

export type AddonLicenca = "mit" | "apache-2.0" | "bsd" | "unlicensed" | "proprietary" | "unknown";
export type AddonBucket = "confirmed_prod" | "synthetic" | "quarantined";
export type AddonAprovacao = "aprovado" | "pendente" | "quarentena";
export type AddonDistribuicao = "interno" | "nao-redistribuir" | "publico";
export type AddonPreviewKind = "react" | "html-sandbox" | "none";

export type AddonFonte = {
  repository: string | null;
  revision: string | null;
  license: AddonLicenca;
  bucket: AddonBucket;
};

export type AddonArtefato = {
  id: string;
  media_type: string;
  size: number;
  checksum: string; // sha256 hex
};

export type AddonEntry = {
  id: string;
  type: "addon";
  category: AddonCategoria;
  title: string;
  summary: string;
  areaBos?: AreaBos | null;
  source: AddonFonte;
  artifacts: AddonArtefato[];
  preview_kind: AddonPreviewKind;
  approval: AddonAprovacao;
  distribution: AddonDistribuicao;
};

export type AddonCatalogo = {
  entries: AddonEntry[]; // aprovados — os únicos exibidos por padrão em /integracoes
  quarentena: AddonEntry[]; // válidos no schema mas rebaixados — nunca somem em silêncio
  invalidos: number; // registros que nem passaram no schema — contagem, sem detalhe (evita vazar dado bruto)
};

export const TAMANHO_MAX_BYTES = 256 * 1024; // rejeita artefato >256 KiB

const CATEGORIAS_VALIDAS = new Set<string>(Object.keys(CATEGORIAS_ADDON));
const LICENCAS_VALIDAS = new Set<AddonLicenca>(["mit", "apache-2.0", "bsd", "unlicensed", "proprietary", "unknown"]);
const BUCKETS_VALIDOS = new Set<AddonBucket>(["confirmed_prod", "synthetic", "quarantined"]);
const APROVACOES_VALIDAS = new Set<AddonAprovacao>(["aprovado", "pendente", "quarentena"]);
const DISTRIBUICOES_VALIDAS = new Set<AddonDistribuicao>(["interno", "nao-redistribuir", "publico"]);
const PREVIEW_KINDS_VALIDOS = new Set<AddonPreviewKind>(["react", "html-sandbox", "none"]);

// Heurística simples de PII/segredo no texto livre (title/summary) — fail-closed:
// suspeita entra em quarentena, nunca é descartada em silêncio nem aceita sem marca.
const PADRAO_SEGREDO = /(sk-|pk_live_|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const PADRAO_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function textoSuspeito(...campos: string[]): boolean {
  const junto = campos.join(" ");
  return PADRAO_SEGREDO.test(junto) || PADRAO_EMAIL.test(junto);
}

function validarArtefato(v: unknown): AddonArtefato | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== "string" || a.id.length === 0) return null;
  if (typeof a.media_type !== "string" || a.media_type.length === 0) return null;
  if (typeof a.size !== "number" || !Number.isFinite(a.size) || a.size < 0) return null;
  if (a.size > TAMANHO_MAX_BYTES) return null;
  if (typeof a.checksum !== "string" || !/^[0-9a-f]{64}$/.test(a.checksum)) return null;
  return { id: a.id, media_type: a.media_type, size: a.size, checksum: a.checksum };
}

function validarFonte(v: unknown): AddonFonte | null {
  if (!v || typeof v !== "object") return null;
  const f = v as Record<string, unknown>;
  const repository = typeof f.repository === "string" ? f.repository : null;
  const revision = typeof f.revision === "string" ? f.revision : null;
  const license = typeof f.license === "string" && LICENCAS_VALIDAS.has(f.license as AddonLicenca)
    ? (f.license as AddonLicenca)
    : "unknown";
  const bucket = typeof f.bucket === "string" && BUCKETS_VALIDOS.has(f.bucket as AddonBucket)
    ? (f.bucket as AddonBucket)
    : "quarantined";
  return { repository, revision, license, bucket };
}

/**
 * Validação fail-closed do schema v1 — registro inválido, com
 * licença desconhecida ou com indício de PII/segredo NUNCA propaga aprovado;
 * cai em quarentena (source/copy/preview desabilitados por padrão no consumo).
 */
export function validarAddonEntry(raw: unknown): AddonEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (r.type !== "addon") return null;
  if (typeof r.category !== "string" || !CATEGORIAS_VALIDAS.has(r.category)) return null;
  if (typeof r.title !== "string" || r.title.length === 0) return null;
  if (typeof r.summary !== "string") return null;

  const source = validarFonte(r.source);
  if (!source) return null;

  if (!Array.isArray(r.artifacts)) return null;
  const artifacts = r.artifacts.map(validarArtefato);
  if (artifacts.some((a) => a === null)) return null; // qualquer artefato malformado invalida o registro inteiro

  const preview_kind = typeof r.preview_kind === "string" && PREVIEW_KINDS_VALIDOS.has(r.preview_kind as AddonPreviewKind)
    ? (r.preview_kind as AddonPreviewKind)
    : "none";

  let approval = typeof r.approval === "string" && APROVACOES_VALIDAS.has(r.approval as AddonAprovacao)
    ? (r.approval as AddonAprovacao)
    : "quarentena";

  const distribution = typeof r.distribution === "string" && DISTRIBUICOES_VALIDAS.has(r.distribution as AddonDistribuicao)
    ? (r.distribution as AddonDistribuicao)
    : "interno";

  const areaBosRaw = r.areaBos;
  const areaBos = typeof areaBosRaw === "string" && (AREAS_BOS as readonly string[]).includes(areaBosRaw)
    ? (areaBosRaw as AreaBos)
    : null;

  // fail-closed: licença desconhecida, bucket em quarentena ou indício de
  // PII/segredo no texto livre nunca sai como "aprovado" — nunca sobrescreve
  // pra esconder o problema, só rebaixa.
  if (source.license === "unknown" || source.bucket === "quarantined" || textoSuspeito(r.title, r.summary)) {
    approval = "quarentena";
  }

  return {
    id: r.id,
    type: "addon",
    category: r.category as AddonCategoria,
    title: r.title,
    summary: r.summary,
    areaBos,
    source,
    artifacts: artifacts as AddonArtefato[],
    preview_kind,
    approval,
    distribution,
  };
}
