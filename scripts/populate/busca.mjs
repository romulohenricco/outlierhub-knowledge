/**
 * Módulo `busca` — constrói o índice de busca LOCAL (FTS5) do provider "local".
 *
 * Saída: data/search/index.sqlite (reconstruído do zero a cada execução, via
 * arquivo temporário + rename, então o app nunca lê um índice pela metade).
 *
 * Fonte do TEXTO: SOMENTE `ctx.docs` (varredura do mega-brain) + `chunkWords` do
 * contrato comum, e por isso os `chunk_id` daqui coincidem com os de
 * livros/coleções/grafo sem nenhuma tabela de tradução:
 *   - documento da estante (kind "doc")  -> "<doc.arquivo>#<n>"
 *   - o resto (config/código, ou documento fora da estante) -> "<doc.rel>#<n>"
 * com n = índice do trecho (chunkWords: 400 palavras, 50 de sobreposição).
 *
 * Fonte do LINK: o catálogo que o módulo `livros` acabou de gravar
 * (data/livros/catalogo.json; `livros` roda antes deste, ver MODULOS em
 * scripts/populate.mjs). O id natural (`doc.id`) não basta: quando ele colide com
 * uma entrada MANUAL do catálogo (o usuário importou um PDF com o mesmo id), o
 * `livros` dá ao documento gerado o id "<id>-<hash>", e um link /livro/<doc.id>
 * abriria o livro do usuário. Só contam as entradas geradas (`origem`
 * "mega-brain/…" com `proveniencia.origemPath` = doc.rel); as manuais nunca são
 * lidas além disso nem alteradas.
 *
 * Regra do tipo do hit (a que o provider devolve em SearchHit):
 *   kind "doc" listado na estante -> tipo "livro"  | livroId = id do catálogo | link /livro/<id>
 *   todo o resto                  -> tipo "bilhon" | livroId = NULL           | link /colecao/<colecao>/<rel>
 * "Todo o resto" é config/código e, se o catálogo faltar ou não listar o
 * documento, também o documento: a coleção guarda TODOS os kinds (colecoes.mjs),
 * então o link continua abrindo o texto em vez de cair num /livro/<id> que dá 404.
 * O link de coleção é o mesmo que components/ColecaoView.tsx monta
 * (encodeURIComponent no slug e no doc, e doc = caminho relativo = coluna `video`
 * do store da coleção). "bilhon" (rótulo "corpus" na UI) é o único tipo de
 * SearchHit que não promete YouTube nem ClickUp.
 *
 * Determinismo: nada de data/aleatório dentro do arquivo; ordem de inserção por
 * caminho; mesma entrada (corpus + catálogo) => mesmos bytes (a idempotência é
 * verificada por hash).
 */
import { readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { chunkWords, ensureDir, log, openSqlite, readJsonSafe, sha256 } from "./common.mjs";

/** Mudou o esquema/tokenizer/pesos de colunas? Suba aqui: o provider recusa índice de versão diferente. */
export const VERSAO_ESQUEMA = 1;
export const TOKENIZER = "unicode61 remove_diacritics 2";

/** Marcador de entrada gerada no catálogo (o mesmo PREFIXO_ORIGEM de livros.mjs). */
const PREFIXO_ORIGEM = "mega-brain/";

/**
 * Colunas na ORDEM que o provider assume em bm25() e snippet():
 *   0 titulo, 1 caminho, 2 texto  -> pesquisáveis (as únicas indexadas)
 *   demais                         -> metadados, UNINDEXED (nunca casam com MATCH)
 */
const ESQUEMA_SQL = `
CREATE VIRTUAL TABLE busca USING fts5(
  titulo,
  caminho,
  texto,
  tipo UNINDEXED,
  livro_id UNINDEXED,
  livro_titulo UNINDEXED,
  fonte_nome UNINDEXED,
  chunk_id UNINDEXED,
  link_local UNINDEXED,
  doc_rel UNINDEXED,
  chunk_idx UNINDEXED,
  tokenize = '${TOKENIZER}'
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
`;

const nfc = (s) => String(s).normalize("NFC");

/**
 * O título do corpus (common.mjs) ganha sufixo de desempate quando dois arquivos
 * se chamam igual: " (<diretório>)", " [<ext>]", " [<id>]". Esse sufixo é só para
 * o título aparecer único na UI; indexá-lo faria o PESO DO TÍTULO premiar todo
 * arquivo que mora numa pasta com o nome buscado. Aqui sai do texto pesquisável
 * (o título completo continua em livro_titulo; o caminho tem coluna própria).
 */
function tituloPesquisavel(doc) {
  const dir = path.posix.dirname(doc.rel);
  const sufixos = [` (${dir === "." ? "raiz" : dir})`, ` [${doc.ext.slice(1)}]`, ` [${doc.id}]`];
  let t = doc.title;
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const suf of sufixos) {
      if (t.length > suf.length && t.endsWith(suf)) {
        t = t.slice(0, -suf.length);
        mudou = true;
      }
    }
  }
  return t;
}

/**
 * Estante como o app vai lê-la: `doc.rel -> id do livro`, só com as entradas geradas
 * do catálogo. `null` quando o catálogo falta ou não parseia (aí nenhum documento é
 * ligado à estante; ver o cabeçalho).
 */
async function estanteGerada(dataDir) {
  const cat = await readJsonSafe(path.join(dataDir, "livros", "catalogo.json"));
  if (!Array.isArray(cat?.livros)) return null;
  const porRel = new Map();
  for (const l of cat.livros) {
    const rel = l?.proveniencia?.origemPath;
    if (typeof l?.origem !== "string" || !l.origem.startsWith(PREFIXO_ORIGEM)) continue;
    if (typeof l.id !== "string" || l.id === "" || typeof rel !== "string") continue;
    porRel.set(rel, l.id);
  }
  return porRel;
}

function metadadosDoDoc(doc, estante) {
  const livroId = doc.kind === "doc" ? estante?.get(doc.rel) : undefined;
  if (livroId) {
    return {
      tipo: "livro",
      livroId,
      chunkBase: doc.arquivo,
      linkLocal: `/livro/${encodeURIComponent(livroId)}`,
    };
  }
  return {
    tipo: "bilhon",
    livroId: null,
    chunkBase: doc.rel,
    linkLocal: `/colecao/${encodeURIComponent(doc.colecao)}/${encodeURIComponent(doc.rel)}`,
  };
}

/** rename atômico com tentativas: no Windows o destino pode estar aberto por uma leitura em andamento. */
async function renomearComTentativas(de, para) {
  let ultimo;
  for (let i = 0; i < 25; i++) {
    try {
      await rename(de, para);
      return;
    } catch (e) {
      ultimo = e;
      if (!["EPERM", "EBUSY", "EACCES"].includes(e?.code)) throw e;
      await esperar(120);
    }
  }
  throw ultimo;
}

export default async function run(ctx) {
  const dir = path.join(ctx.dataDir, "search");
  const final = path.join(dir, "index.sqlite");
  const tmp = path.join(dir, `index.sqlite.${process.pid}.tmp`);
  await ensureDir(dir);

  // sobras de execuções interrompidas (só os temporários que ESTE módulo cria)
  for (const nome of await readdir(dir)) {
    if (/^index\.sqlite\.\d+\.tmp(-journal|-wal|-shm)?$/.test(nome)) await rm(path.join(dir, nome), { force: true });
  }

  const avisos = [];
  const docs = [...ctx.docs].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  if (docs.length === 0) avisos.push("corpus vazio: índice criado sem linhas (o provider local ficará 'não configurado')");
  const estante = await estanteGerada(ctx.dataDir);
  const documentos = docs.filter((d) => d.kind === "doc").length;
  if (!estante && documentos > 0) {
    avisos.push(
      "catálogo da estante (data/livros/catalogo.json) ausente ou ilegível: os documentos abrem pela coleção, não pela estante (rode o módulo livros)",
    );
  }

  const db = await openSqlite(tmp);
  let trechos = 0;
  let livros = 0;
  let colecoes = 0;
  const hash = [];
  try {
    // arquivo temporário descartável: sem journal e sem fsync, é só montar e renomear
    db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA page_size = 4096;");
    db.exec(ESQUEMA_SQL);
    const ins = db.prepare(
      `INSERT INTO busca (titulo, caminho, texto, tipo, livro_id, livro_titulo, fonte_nome, chunk_id, link_local, doc_rel, chunk_idx)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.exec("BEGIN");
    for (const doc of docs) {
      const m = metadadosDoDoc(doc, estante);
      const pedacos = chunkWords(doc.text);
      if (m.tipo === "livro") livros++;
      else colecoes++;
      hash.push([doc.rel, doc.sha256, m.tipo, doc.title, doc.colecao, m.livroId ?? "", m.linkLocal, pedacos.length].join("\t"));
      pedacos.forEach((texto, n) => {
        ins.run(
          nfc(tituloPesquisavel(doc)),
          nfc(doc.rel),
          nfc(texto),
          m.tipo,
          m.livroId,
          nfc(doc.title),
          doc.colecao,
          `${m.chunkBase}#${n}`,
          m.linkLocal,
          doc.rel,
          n,
        );
        trechos++;
      });
    }
    db.exec("COMMIT");

    const meta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    const linhasMeta = {
      arquivos: String(docs.length),
      chunk_words: "400/50",
      colecoes: String(colecoes),
      conteudo_sha256: sha256(hash.join("\n")),
      fonte: "mega-brain",
      livros: String(livros),
      schema_version: String(VERSAO_ESQUEMA),
      tokenizer: TOKENIZER,
      trechos: String(trechos),
    };
    for (const k of Object.keys(linhasMeta).sort()) meta.run(k, linhasMeta[k]);

    // junta os segmentos do FTS5 (índice menor, consultas mais rápidas) e confere a integridade
    db.exec("INSERT INTO busca (busca) VALUES ('optimize')");
    db.exec("INSERT INTO busca (busca) VALUES ('integrity-check')");
    const contado = db.prepare("SELECT count(*) AS n FROM busca").get().n;
    if (contado !== trechos) throw new Error(`índice inconsistente: ${contado} linhas gravadas, ${trechos} esperadas`);
    db.exec("PRAGMA user_version = " + VERSAO_ESQUEMA);
  } catch (e) {
    try {
      db.close();
    } catch {
      /* já fechado */
    }
    await rm(tmp, { force: true });
    throw e;
  }
  db.close();

  await renomearComTentativas(tmp, final);
  await rm(`${tmp}-journal`, { force: true });

  // documento que a estante não lista (catálogo ausente, módulo livros com falha): abre pela coleção
  const foraDaEstante = documentos - livros;
  if (estante && foraDaEstante > 0) {
    avisos.push(`${foraDaEstante} documento(s) fora do catálogo da estante: a busca os abre pela coleção`);
  }

  log("busca", `índice FTS5: ${trechos} trechos de ${docs.length} arquivos (${livros} na estante, ${colecoes} de coleção)`);
  return {
    resumo: { arquivos: docs.length, trechos, livros, colecoes, foraDaEstante },
    avisos,
  };
}
