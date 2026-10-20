/** Catálogo local de add-ons: manifesto e artefatos aprovados, lidos de BILHON_ADDONS_DIR (padrão data/addons). */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { TAMANHO_MAX_BYTES, validarAddonEntry, type AddonCatalogo, type AddonEntry } from "./addons-schema";

export * from "./addons-schema";

import { exigirCaminhoBilhon, lerEnv } from "./bilhon-paths";

function addonsRoot(): string {
  return exigirCaminhoBilhon(lerEnv("BILHON_ADDONS_DIR") ?? path.join(process.cwd(), "data", "addons"));
}

const EXTENSOES_TEXTO = new Set([".ts", ".tsx", ".md", ".txt", ".css", ".json", ".yaml", ".yml"]);

let cache: { root: string; em: number; catalogo: AddonCatalogo } | null = null;
const CACHE_MS = 60_000;

export async function getAddonCatalogo(): Promise<AddonCatalogo> {
  let root: string;
  try {
    root = addonsRoot();
  } catch {
    // BILHON_ADDONS_DIR (ou o padrão data/addons) fora da raiz permitida: recusado = sem catálogo
    return { entries: [], quarentena: [], invalidos: 0 };
  }
  if (cache?.root === root && Date.now() - cache.em < CACHE_MS) return cache.catalogo;

  let raw: { entries?: unknown[] } | null = null;
  try {
    raw = JSON.parse(await readFile(exigirCaminhoBilhon(path.join(root, "manifest.json")), "utf-8"));
  } catch {
    raw = null;
  }

  const entries: AddonEntry[] = [];
  const quarentena: AddonEntry[] = [];
  let invalidos = 0;
  const idsVistos = new Set<string>();

  for (const item of Array.isArray(raw?.entries) ? raw.entries : []) {
    const parsed = validarAddonEntry(item);
    if (!parsed) {
      invalidos += 1;
      continue;
    }
    if (idsVistos.has(parsed.id)) {
      // duplicado: fica isolado, nunca sobrescreve o primeiro
      quarentena.push({ ...parsed, approval: "quarentena" });
      continue;
    }
    idsVistos.add(parsed.id);
    if (parsed.approval === "aprovado") entries.push(parsed);
    else quarentena.push(parsed);
  }

  const catalogo: AddonCatalogo = { entries, quarentena, invalidos };
  cache = { root, em: Date.now(), catalogo };
  return catalogo;
}

/**
 * Loader read-only em quarentena: resolve o artefato de um addon
 * aprovado dentro do root allowlisted, com containment por realpath — recusa
 * absoluto, "..", symlink (em qualquer segmento do caminho), tipo não-texto
 * e >256 KiB. Nunca serve conteúdo de um addon que não está "aprovado".
 */
export async function lerArtefatoAddon(addonId: string, artefatoId: string): Promise<string | null> {
  let ARTIFACTS_ROOT: string;
  try {
    ARTIFACTS_ROOT = exigirCaminhoBilhon(path.join(addonsRoot(), "artifacts"));
  } catch {
    return null; // pasta de add-ons fora da raiz permitida: recusada, como no catálogo
  }
  if (!addonId || !artefatoId) return null;
  if (path.isAbsolute(addonId) || path.isAbsolute(artefatoId)) return null;
  if (addonId.includes("..") || artefatoId.includes("..")) return null;
  if (artefatoId.includes(path.sep) || artefatoId.includes("/")) return null;

  const { entries } = await getAddonCatalogo();
  const addon = entries.find((e) => e.id === addonId); // só addons aprovados servem source
  if (!addon) return null;
  const artefato = addon.artifacts.find((a) => a.id === artefatoId);
  if (!artefato) return null;

  const ext = path.extname(artefatoId).toLowerCase();
  if (!EXTENSOES_TEXTO.has(ext)) return null;

  // addonId tem prefixo "<categoria>:<slug>" — a pasta em disco é só o slug.
  const slug = addonId.includes(":") ? addonId.slice(addonId.indexOf(":") + 1) : addonId;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug) || slug.includes("..")) return null;

  const candidato = path.join(ARTIFACTS_ROOT, slug, artefatoId);
  if (!candidato.startsWith(ARTIFACTS_ROOT + path.sep)) return null;
  if (!existsSync(candidato)) return null;

  try {
    exigirCaminhoBilhon(candidato);
    if (lstatSync(path.dirname(candidato)).isSymbolicLink()) return null;
    const st = lstatSync(candidato);
    if (st.isSymbolicLink()) return null; // recusa symlink explicitamente, mesmo se o alvo fosse válido
    if (!st.isFile()) return null;
    if (st.size > TAMANHO_MAX_BYTES) return null;

    // realpath containment: resolve TODOS os symlinks da cadeia (incl. de
    // diretórios pai) e reconfirma que o alvo real ainda está sob o root
    // allowlisted — string-prefix sozinho (padrão de lib/referencias.ts) não
    // pega symlink de diretório intermediário apontando pra fora.
    const real = realpathSync(candidato);
    const realRoot = realpathSync(ARTIFACTS_ROOT);
    if (!real.startsWith(realRoot + path.sep) && real !== realRoot) return null;
  } catch {
    return null;
  }

  const conteudo = await readFile(candidato, "utf-8");
  const bytes = Buffer.byteLength(conteudo, "utf-8");
  if (bytes > TAMANHO_MAX_BYTES) return null;

  const checksumReal = createHash("sha256").update(conteudo, "utf-8").digest("hex");
  if (checksumReal !== artefato.checksum) return null; // integridade: conteúdo em disco tem que bater com o manifest

  return conteudo;
}
