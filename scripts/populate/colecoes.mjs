/**
 * Módulo `colecoes` — popula Ingestões (/ingestoes) e /colecao/<slug> com o corpus do mega-brain.
 *
 * Entrada : ctx.docs (TODOS os kinds: doc, config e code), agrupados por doc.colecao.
 * Saída   : para cada coleção, data/colecoes-external/sources/<colecao>/
 *             _corpus_bge.sqlite  tabela chunks(chunk_id TEXT, video TEXT, text TEXT) + índice em video
 *             .provenance.json    { "tier": "A|B|C", ... }
 *             .ontology.json      { "domain": "<doc.dominio>" }
 *             .populate-managed   marcador: a pasta é gerada por este módulo
 *
 * Contrato com o leitor (lib/colecoes.ts) e com os demais módulos:
 *  - video     = doc.rel (caminho relativo POSIX no mega-brain) — é o "documento" da coleção;
 *  - chunk_id  = "<doc.rel>#<n>", n a partir de 0, na ordem de chunkWords(doc.text);
 *  - o texto de cada trecho vem de chunkWords (400 palavras, 50 repetidas do trecho
 *    anterior): é exatamente a sobreposição que getTranscript descarta ao remontar o
 *    documento, então a leitura completa devolve as MESMAS palavras de doc.text;
 *  - slug da coleção no app = nome da pasta = doc.colecao (ver AREAS/classify em common.mjs);
 *  - sem youtube-map.json: não há link externo real; o título de cada documento sai do
 *    próprio nome (rel) e o app não monta link de vídeo (rel nunca casa "<11 chars>.transcript").
 *
 * REGRA DO TIER (proveniência), por área da coleção — documentada aqui e gravada em
 * `.provenance.json`:
 *   A  fonte normativa/curada, escrita por pessoas: regras, skills/comandos, agentes,
 *      squads, workspace/templates, docs e knowledge/* (buckets);
 *   B  documentação e configuração do engine (`engine-docs`: md/txt/yaml/json de engine/);
 *   C  código-fonte (`codigo`: py/js/ts/sh do engine, hooks e scripts).
 *
 * REGENERAÇÃO:
 *  - a pasta só é tocada se tiver o marcador `.populate-managed` com { modulo: "colecoes" }
 *    (ou se ainda não existir). Pasta sem marcador é de outra origem: nunca é alterada e a
 *    coleção correspondente é pulada com aviso;
 *  - o marcador guarda uma impressão digital do conteúdo (hash de todos os trechos); se ela
 *    não mudou e o store confere, o SQLite NÃO é recriado (o mtime, que o app usa como
 *    "última ingestão", fica estável);
 *  - quando muda, o store é gerado em arquivo temporário e trocado por rename atômico, e
 *    -wal/-shm/-journal residuais são removidos;
 *  - pastas gerenciadas por nós cujo conjunto de documentos sumiu são removidas (só os
 *    arquivos que geramos; se sobrar algo de terceiros na pasta, ela fica e vai para os avisos).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { chunkWords, ensureDir, log, openSqlite, readJsonSafe, writeJson } from "./common.mjs";

const MODULO = "colecoes";
/** Muda quando o desenho do store muda (força a recriação). */
const FORMATO = "colecoes-v1:chunks(chunk_id,video,text)+idx_video";
const STORE = "_corpus_bge.sqlite";
const GERADOS = [STORE, `${STORE}-wal`, `${STORE}-shm`, `${STORE}-journal`, ".provenance.json", ".ontology.json", ".populate-managed"];
const SLUG_OK = /^[a-z0-9][a-z0-9-]*$/;

const REGRA_TIER =
  "A = fonte normativa/curada (regras, skills, agentes, squads, workspace, docs, knowledge); " +
  "B = documentação e configuração do engine; C = código-fonte";

export function tierDaArea(area) {
  if (area === "codigo") return "C";
  if (area === "engine") return "B";
  return "A";
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Trechos de um documento no formato do store: [chunk_id, video, text]. */
function trechosDe(doc) {
  return chunkWords(doc.text).map((t, n) => [`${doc.rel}#${n}`, doc.rel, t]);
}

function impressaoDigital(trechos) {
  const h = createHash("sha256");
  h.update(FORMATO);
  for (const [id, video, text] of trechos) h.update(`\u0000${id}\u0000${video}\u0000${text}`);
  return h.digest("hex");
}

async function abrirLeitura(file) {
  const mod = await import("node:sqlite");
  return new mod.DatabaseSync(file, { readOnly: true });
}

/** O store em disco tem exatamente os trechos e documentos esperados? (reusado por `especialistas`) */
export async function storeConfere(file, esperado) {
  if (!existsSync(file)) return false;
  let db;
  try {
    db = await abrirLeitura(file);
    const r = db.prepare("SELECT COUNT(*) AS c, COUNT(DISTINCT video) AS d FROM chunks").get();
    return Number(r.c) === esperado.chunks && Number(r.d) === esperado.docs;
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      /* já fechado */
    }
  }
}

async function trocar(tmp, destino) {
  let ultimo;
  for (let t = 0; t < 6; t++) {
    try {
      await rename(tmp, destino);
      return;
    } catch (e) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(e?.code)) throw e;
      ultimo = e;
      await dormir(150 * (t + 1));
    }
  }
  throw ultimo;
}

/** Gera o store em arquivo temporário, confere e troca por rename atômico (reusado por `especialistas`). */
export async function construirStore(destino, trechos, esperado) {
  const tmp = `${destino}.${process.pid}.tmp`;
  for (const extra of ["", "-wal", "-shm", "-journal"]) await rm(`${tmp}${extra}`, { force: true });
  const db = await openSqlite(tmp);
  try {
    db.exec("PRAGMA synchronous = OFF; PRAGMA page_size = 4096;");
    db.exec("CREATE TABLE chunks (chunk_id TEXT, video TEXT, text TEXT)");
    db.exec("BEGIN");
    const ins = db.prepare("INSERT INTO chunks (chunk_id, video, text) VALUES (?, ?, ?)");
    for (const [id, video, text] of trechos) ins.run(id, video, text);
    db.exec("COMMIT");
    db.exec("CREATE INDEX idx_chunks_video ON chunks(video)");
    const r = db.prepare("SELECT COUNT(*) AS c, COUNT(DISTINCT video) AS d FROM chunks").get();
    if (Number(r.c) !== esperado.chunks || Number(r.d) !== esperado.docs) {
      throw new Error(`colecoes: store temporário não confere (${r.c}/${r.d} ≠ ${esperado.chunks}/${esperado.docs})`);
    }
  } catch (e) {
    try {
      db.close();
    } catch {
      /* ignora */
    }
    await rm(tmp, { force: true });
    throw e;
  }
  db.close();
  for (const extra of ["-wal", "-shm", "-journal"]) await rm(`${tmp}${extra}`, { force: true });
  await trocar(tmp, destino);
  for (const extra of ["-wal", "-shm", "-journal"]) await rm(`${destino}${extra}`, { force: true });
}

async function marcadorDe(pasta) {
  const m = await readJsonSafe(path.join(pasta, ".populate-managed"));
  return m && m.modulo === MODULO ? m : null;
}

/** Remove uma pasta gerenciada: só os arquivos que geramos; devolve false se sobrou algo de terceiros. */
async function removerGerenciada(pasta) {
  for (const nome of GERADOS) await rm(path.join(pasta, nome), { force: true }); // o marcador é o último
  for (const f of await readdir(pasta)) if (f.endsWith(".tmp")) await rm(path.join(pasta, f), { force: true });
  try {
    await rmdir(pasta);
    return true;
  } catch {
    return false;
  }
}

export default async function run(ctx) {
  const avisos = [];
  const raiz = path.join(ctx.dataDir, "colecoes-external", "sources");

  // agrupa por coleção (todos os kinds), mantendo a ordem por rel
  const grupos = new Map();
  for (const d of [...ctx.docs].sort((a, b) => cmp(a.rel, b.rel))) {
    if (!SLUG_OK.test(d.colecao)) throw new Error(`colecoes: slug de coleção inválido "${d.colecao}" (${d.rel})`);
    if (!grupos.has(d.colecao)) grupos.set(d.colecao, []);
    grupos.get(d.colecao).push(d);
  }

  let reconstruidas = 0;
  let inalteradas = 0;
  let puladas = 0;
  let totalDocs = 0;
  let totalChunks = 0;
  const vivas = new Set();
  const porColecao = {};

  for (const [slug, docs] of [...grupos].sort((a, b) => cmp(a[0], b[0]))) {
    const trechos = docs.flatMap(trechosDe);
    if (trechos.length === 0) continue; // coleção sem trecho não é criada

    const areas = new Set(docs.map((d) => d.area));
    const dominios = new Set(docs.map((d) => d.dominio));
    if (areas.size !== 1 || dominios.size !== 1) {
      throw new Error(`colecoes: coleção "${slug}" mistura áreas (${[...areas]}) ou domínios (${[...dominios]})`);
    }
    const area = docs[0].area;
    const dominio = docs[0].dominio;
    const tier = tierDaArea(area);
    const esperado = { docs: docs.length, chunks: trechos.length };
    const pasta = path.join(raiz, slug);
    const store = path.join(pasta, STORE);

    let marcador = null;
    if (existsSync(pasta)) {
      marcador = await marcadorDe(pasta);
      // pasta vazia sem marcador (p.ex. uma execução interrompida antes do primeiro arquivo) pode ser reivindicada
      if (!marcador && (await readdir(pasta)).length > 0) {
        puladas++;
        avisos.push(`pasta ${path.posix.join("colecoes-external/sources", slug)} existe sem o marcador .populate-managed: não é nossa, coleção "${slug}" pulada`);
        continue;
      }
    }
    vivas.add(slug);

    const fingerprint = impressaoDigital(trechos);
    await ensureDir(pasta);
    // reivindica a pasta ANTES de construir: se a construção falhar, a próxima execução ainda a reconhece como nossa
    if (!marcador) await writeJson(path.join(pasta, ".populate-managed"), { modulo: MODULO, formato: FORMATO, fingerprint: null, colecao: slug });
    const igual = marcador?.fingerprint === fingerprint && (await storeConfere(store, esperado));
    if (igual) {
      inalteradas++;
    } else {
      await construirStore(store, trechos, esperado);
      reconstruidas++;
    }
    await writeJson(path.join(pasta, ".provenance.json"), { tier, fonte: "mega-brain", area, regra: REGRA_TIER });
    await writeJson(path.join(pasta, ".ontology.json"), { domain: dominio });
    await writeJson(path.join(pasta, ".populate-managed"), {
      modulo: MODULO,
      formato: FORMATO,
      fingerprint,
      colecao: slug,
      area,
      docs: esperado.docs,
      chunks: esperado.chunks,
    });
    totalDocs += esperado.docs;
    totalChunks += esperado.chunks;
    porColecao[slug] = { docs: esperado.docs, chunks: esperado.chunks, tier, dominio };
  }

  // pastas gerenciadas por nós que não têm mais documentos
  let removidas = 0;
  if (existsSync(raiz)) {
    for (const nome of (await readdir(raiz)).sort()) {
      const pasta = path.join(raiz, nome);
      if (vivas.has(nome)) continue;
      if (!(await marcadorDe(pasta))) continue;
      if (await removerGerenciada(pasta)) removidas++;
      else avisos.push(`pasta gerenciada "${nome}" sem documentos, mas contém arquivos que não são nossos: mantida`);
    }
  }

  log(MODULO, `${vivas.size} coleções (${reconstruidas} reconstruídas, ${inalteradas} inalteradas, ${removidas} removidas)`);
  return {
    resumo: {
      colecoes: vivas.size,
      docs: totalDocs,
      chunks: totalChunks,
      reconstruidas,
      inalteradas,
      removidas,
      puladasPastaAlheia: puladas,
      porColecao,
    },
    avisos,
  };
}
