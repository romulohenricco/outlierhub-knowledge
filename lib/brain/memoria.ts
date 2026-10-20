// SERVER-ONLY: lê a pasta de notas do disco. Importado só pela page (server component).
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { caminhoBilhonPermitido, lerEnv } from "../bilhon-paths";
import { agenteDir } from "../ecosystem";
import { cortaTexto } from "../texto";
import type { MemHub, MemNota, Memoria } from "./tipos";

/** Pasta de notas .md que alimenta o núcleo: BILHON_BRAIN_STORE ou `memoria/` na
 *  pasta de estado do agente. Os hubs do núcleo são as pastas de primeiro nível. */
export function memoriaRaiz(): string {
  const env = lerEnv("BILHON_BRAIN_STORE");
  return env ? path.resolve(env) : path.join(agenteDir(), "memoria");
}

/** Tetos de leitura: a pasta de notas é externa ao app e pode ser enorme. */
export const MAX_ARQUIVOS = 5000;
export const MAX_BYTES_ARQUIVO = 512 * 1024;
const MAX_PROFUNDIDADE = 8;
const PASTAS_IGNORADAS = new Set(["node_modules"]);

/** Teto de notas desenhadas no núcleo. Regra: só entram notas com ao menos um
 *  link REAL resolvido (wikilink ou link .md relativo), ordenadas por grau
 *  (desempate pelo caminho). A UI mostra "N de M". */
export const LIMITE_NOTAS = 300;

type Arquivo = { rel: string; texto: string };

const stem = (rel: string) => path.posix.basename(rel, ".md").toLowerCase();

function titulo(a: Arquivo): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(a.texto);
  const nome = fm && /^(?:name|title|titulo):\s*["']?(.+?)["']?\s*$/m.exec(fm[1]);
  if (nome) return cortaTexto(nome[1], 120);
  const h1 = /^#\s+(.+)$/m.exec(a.texto);
  if (h1) return cortaTexto(h1[1].trim(), 120);
  return cortaTexto(path.posix.basename(a.rel, ".md"), 120);
}

/** Pura: dado os arquivos, resolve os links e aplica o recorte. */
export function montarMemoria(arquivos: Arquivo[], limite = LIMITE_NOTAS): Memoria {
  const porStem = new Map<string, string>();
  const existe = new Set(arquivos.map((a) => a.rel));
  for (const a of [...arquivos].sort((x, y) => x.rel.localeCompare(y.rel))) {
    if (!porStem.has(stem(a.rel))) porStem.set(stem(a.rel), a.rel);
  }

  const pares = new Set<string>();
  const ligacoes: [string, string][] = [];
  let naoResolvidos = 0;
  const ligar = (de: string, para: string | undefined) => {
    if (!para) {
      naoResolvidos++;
      return;
    }
    if (para === de) return;
    const k = de < para ? `${de}\u0000${para}` : `${para}\u0000${de}`;
    if (pares.has(k)) return;
    pares.add(k);
    ligacoes.push(de < para ? [de, para] : [para, de]);
  };

  for (const a of arquivos) {
    for (const m of a.texto.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const alvo = m[1].split("|")[0].split("#")[0].trim().replace(/\.md$/i, "");
      if (alvo) ligar(a.rel, porStem.get(path.posix.basename(alvo).toLowerCase()));
    }
    for (const m of a.texto.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/gi)) {
      if (/^[a-z]+:\/\//i.test(m[1])) continue; // URL externa não é nota
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(a.rel), m[1]));
      ligar(a.rel, existe.has(rel) ? rel : porStem.get(stem(m[1])));
    }
  }

  const grau = new Map<string, number>();
  for (const [a, b] of ligacoes) {
    grau.set(a, (grau.get(a) ?? 0) + 1);
    grau.set(b, (grau.get(b) ?? 0) + 1);
  }
  const porRel = new Map(arquivos.map((a) => [a.rel, a]));
  const conectadas = [...grau.keys()].sort((x, y) => (grau.get(y)! - grau.get(x)!) || x.localeCompare(y));
  const escolhidas = conectadas.slice(0, Math.max(0, limite));
  const dentro = new Set(escolhidas);

  const hubsMap = new Map<string, number>();
  for (const a of arquivos) {
    const h = a.rel.split("/")[0];
    hubsMap.set(h, (hubsMap.get(h) ?? 0) + 1);
  }
  const hubs: MemHub[] = [...hubsMap].map(([nome, total]) => ({ id: nome, nome, total })).sort((a, b) => a.nome.localeCompare(b.nome));
  const notas: MemNota[] = escolhidas.map((id) => {
    const a = porRel.get(id)!;
    const corpo = a.texto.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    return {
      id,
      titulo: titulo(a),
      hub: id.split("/")[0],
      grau: grau.get(id)!,
      caminho: id,
      palavras: corpo ? corpo.split(/\s+/).length : 0,
      trecho: cortaTexto(corpo, 480),
    };
  });
  return {
    hubs,
    notas,
    links: ligacoes.filter(([a, b]) => dentro.has(a) && dentro.has(b)),
    total: arquivos.length,
    conectadas: conectadas.length,
    naoResolvidos,
  };
}

async function listarMd(raiz: string, rel = "", prof = 0, saida: string[] = []): Promise<string[]> {
  if (prof > MAX_PROFUNDIDADE || saida.length >= MAX_ARQUIVOS) return saida;
  let itens;
  try {
    itens = await readdir(path.join(raiz, rel), { withFileTypes: true });
  } catch {
    return saida;
  }
  // ordem estável; link simbólico não é seguido (Dirent não o reporta como arquivo/pasta)
  for (const it of itens.sort((a, b) => a.name.localeCompare(b.name))) {
    if (saida.length >= MAX_ARQUIVOS) break;
    if (it.name.startsWith(".") || PASTAS_IGNORADAS.has(it.name)) continue;
    const r = rel ? `${rel}/${it.name}` : it.name;
    if (it.isDirectory()) await listarMd(raiz, r, prof + 1, saida);
    else if (it.isFile() && it.name.toLowerCase().endsWith(".md")) saida.push(r);
  }
  return saida;
}

async function lerNota(raiz: string, rel: string): Promise<string> {
  const abs = path.join(raiz, rel);
  try {
    if ((await stat(abs)).size > MAX_BYTES_ARQUIVO) return "";
    return await readFile(abs, "utf-8");
  } catch {
    return "";
  }
}

let cache: { raiz: string; em: number; valor: Memoria | null } | null = null;
const TTL_MS = 60_000;

/** Lê a pasta de notas (cache de 60 s). Pasta ausente, vazia ou fora de BILHON_ROOT → null, sem lançar. */
export async function lerMemoria(raiz: string = memoriaRaiz()): Promise<Memoria | null> {
  if (cache && cache.raiz === raiz && Date.now() - cache.em < TTL_MS) return cache.valor;
  if (!caminhoBilhonPermitido(raiz)) return null;
  const rels = await listarMd(raiz);
  let valor: Memoria | null = null;
  if (rels.length > 0) {
    const arquivos: Arquivo[] = [];
    for (let i = 0; i < rels.length; i += 64) {
      const lote = await Promise.all(rels.slice(i, i + 64).map(async (rel) => ({ rel, texto: await lerNota(raiz, rel) })));
      arquivos.push(...lote);
    }
    valor = montarMemoria(arquivos);
  }
  cache = { raiz, em: Date.now(), valor };
  return valor;
}

/** Só para testes: esvazia o cache de 60 s. */
export function limparCacheMemoria() {
  cache = null;
}
