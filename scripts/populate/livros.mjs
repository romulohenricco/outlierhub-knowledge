/**
 * Módulo `livros` — popula a Estante com os documentos (md/txt) do mega-brain.
 *
 * Entrada : ctx.docs com kind "doc" (Markdown e texto do repositório).
 * Saída   : data/livros/
 *             catalogo.json         { "livros": [...] }  (formato exato de docs/dados.md)
 *             arquivos/<arquivo>    texto idêntico a doc.text (UTF-8, LF)
 *             livros-dominios.json  { "porLivro": { id: dominio } }
 *             livros-hashes.json    { "porLivro": { id: sha256 do arquivo gravado } }
 *
 * Não gera capas (`.covers/` é do usuário) nem os sidecars opcionais que a estante do app também
 * lê (lib/livro-conteudo.ts), porque o mega-brain não tem fonte fiel para eles:
 *  - `niveis.json` (registro editorial: referencia-academica | profissional | pratico-mercado);
 *  - `livros-sinopses.json` (o app rotula toda sinopse dele como "gerada por modelo local"; uma
 *    descrição de frontmatter gravada ali sairia com a procedência errada).
 * Sem eles a estante só deixa "Sobre" e o selo de registro vazios; nada cai no demo.
 *
 * REGRAS DERIVADAS (todas determinísticas — sem Date, sem aleatório):
 *
 *  - id / arquivo / titulo / tema / formato / origem
 *      vêm de ctx.docs; `origem` = "mega-brain/<área>" (área = doc.area), o que
 *      também é o marcador de "entrada gerenciada" (ver "Regeneração" abaixo).
 *      id e arquivo são os do documento (contrato com o grafo e com as coleções), salvo
 *      numa colisão com dado do usuário (ver "Colisões").
 *  - chunksTotal = chunkWords(doc.text).length — bate com o store da coleção.
 *  - sizeBytes   = tamanho em bytes do arquivo REALMENTE gravado (stat).
 *  - vizinhos    = até 5 documentos mais parecidos por cosseno TF-IDF sobre os
 *      próprios textos (título + corpo). Tokens: [a-z][a-z0-9]{2,29} sem acento e em
 *      minúsculas, menos stopwords PT/EN; termos com df < 2 ou df > 50% do corpus são
 *      descartados; peso = (1 + ln tf) * (ln((N+1)/(df+1)) + 1), vetor normalizado
 *      em L2. Score arredondado a 3 casas, só vizinhos com score >= 0.05, sem
 *      auto-referência; empate de score desempata por id (ordem alfabética).
 *  - cluster     = componente conexa do grafo kNN MÚTUO (k = 3, score >= 0.15): A e B
 *      ficam juntos quando cada um está entre os 3 mais parecidos do outro e a
 *      similaridade passa do piso. Componentes com 2+ livros recebem número
 *      1..N em ordem de tamanho decrescente (empate: menor id); o resto é `null`
 *      (solitário). Número 0 nunca é usado: a página do livro trata 0 como "solitário".
 *  - proveniencia = { origemPath: doc.rel, motivo } com a regra de caminho que
 *      classificou o documento (área → tema → domínio).
 *  - paginas = null (md/txt não têm páginas).
 *  - mtime do arquivo gravado = mtime da origem no mega-brain (ctx.repoRoot/doc.rel). O /grafo do
 *      app data cada livro pelo mtime do arquivo em BILHON_LIVROS_DIR ("≈ quando entrou no
 *      acervo", lib/kg.ts); sem isto todo documento sairia com o dia em que o populate rodou.
 *      Origem ilegível = mtime da gravação, como antes. Só vale para arquivo nosso (ver "Posse").
 *
 * POSSE DE UM ARQUIVO (quando é seguro sobrescrever ou remover):
 *  um arquivo de arquivos/ só é nosso se (a) não existe, ou (b) já tem exatamente o conteúdo
 *  que seria gravado, ou (c) o catálogo anterior o lista numa entrada nossa ("mega-brain/…") e
 *  o SHA-256 dele em disco bate com o registrado em livros-hashes.json (se não há hash
 *  registrado, vale a entrada do catálogo). Qualquer outro arquivo — solto, de entrada manual,
 *  ou gerado por nós mas editado depois — é do usuário e nunca é sobrescrito nem removido.
 *
 * COLISÕES (dado do usuário × documento gerado) — nada do usuário é descartado:
 *  - id igual ao de uma entrada manual do catálogo → o documento gerado ganha o id
 *    "<id>-<hash do rel>"; o arquivo natural é mantido (o grafo cita "livro:<arquivo>");
 *  - arquivo igual ao de uma entrada manual, ou já ocupado por um arquivo que não é nosso →
 *    o documento gerado ganha o arquivo "<nome>-<hash do rel>.<ext>". O grafo (outro módulo)
 *    continua citando o nome original; por isso cada caso vai para os avisos.
 *  O hash vem de sha256(doc.rel): o mesmo documento sempre recebe o mesmo nome alternativo, e
 *  quando a colisão some (o usuário remove o dado dele) o documento volta ao nome natural.
 *
 * ESTADO ANTERIOR ILEGÍVEL: catalogo.json, livros-dominios.json e livros-hashes.json são lidos
 * ANTES de qualquer escrita. Ausente = sem estado anterior. Existente mas que não parseia (por
 * exemplo, em edição à mão) ou com formato inesperado ABORTA o módulo com erro claro, sem
 * tocar em nada: tratá-lo como "vazio" apagaria as entradas do usuário.
 *
 * REGENERAÇÃO (não destrói o que não é nosso):
 *  - entradas do catálogo ANTERIOR com `origem` "mega-brain/…" são nossas: se o
 *    documento sumiu do repositório, a entrada e o arquivo em arquivos/ são removidos
 *    (o arquivo só se ainda for nosso, conforme "Posse");
 *  - entradas com outra `origem` (acrescentadas à mão) são preservadas como estão,
 *    com os arquivos, domínios e checksums delas;
 *  - arquivos/.covers/ e qualquer arquivo que o catálogo anterior não listava nunca
 *    são tocados.
 */
import { createHash } from "node:crypto";
import { readFile, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { chunkWords, ensureDir, log, writeJson, writeText } from "./common.mjs";

const PREFIXO_ORIGEM = "mega-brain/";
const K_VIZINHOS = 5;
const SCORE_MIN_VIZINHO = 0.05;
const K_CLUSTER = 3;
const SCORE_MIN_CLUSTER = 0.15;
/** Tamanhos (hex) do sufixo de hash tentados, em ordem, para nomes alternativos. */
const TAMANHOS_SUFIXO = [8, 12, 16, 24, 32, 64];
/** Máximo de avisos individuais de colisão; o excedente vira uma linha de resumo. */
const MAX_AVISOS_COLISAO = 10;

const STOPWORDS = new Set(
  ("the and for with that this are from have has not but you your can will all any use used using when which what into also more " +
    "than then they them their there been was were its our out one two per via etc como para com uma uns umas dos das nos nas por " +
    "que mais não nao são sao ser foi tem tém ter está esta este isso essa esse aos ele ela seu sua seus suas pelo pela pelos pelas " +
    "entre sobre sem até ate quando onde cada todo toda todos todas apenas ainda também tambem mas ou se de da do em no na um os as")
    .split(" "),
);

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const minusc = (s) => String(s).toLowerCase();
const ehObjeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function tokens(texto) {
  const t = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return (t.match(/[a-z][a-z0-9]{2,29}/g) ?? []).filter((x) => !STOPWORDS.has(x));
}

/** Vetores TF-IDF L2-normalizados (Map termo → peso), um por documento, na ordem de `livros`. */
function vetores(livros) {
  const n = livros.length;
  const tfs = livros.map((d) => {
    const m = new Map();
    for (const t of tokens(`${d.title}\n${d.text}`)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const df = new Map();
  for (const m of tfs) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  return tfs.map((m) => {
    const v = new Map();
    let norma = 0;
    for (const [t, c] of m) {
      const d = df.get(t);
      if (d < 2 || d > 0.5 * n) continue;
      const w = (1 + Math.log(c)) * (Math.log((n + 1) / (d + 1)) + 1);
      v.set(t, w);
      norma += w * w;
    }
    norma = Math.sqrt(norma) || 1;
    for (const [t, w] of v) v.set(t, w / norma);
    return v;
  });
}

/** Lista de similaridades por documento: [[índiceVizinho, cosseno]...] ordenada (score desc, id asc). */
function similaridades(livros) {
  const vec = vetores(livros);
  const sims = livros.map(() => []);
  for (let i = 0; i < livros.length; i++) {
    for (let j = i + 1; j < livros.length; j++) {
      let a = vec[i];
      let b = vec[j];
      if (a.size > b.size) [a, b] = [b, a];
      let s = 0;
      for (const [t, w] of a) {
        const x = b.get(t);
        if (x) s += w * x;
      }
      if (s > 0) {
        sims[i].push([j, s]);
        sims[j].push([i, s]);
      }
    }
  }
  for (const l of sims) l.sort((x, y) => y[1] - x[1] || cmp(livros[x[0]].id, livros[y[0]].id));
  return sims;
}

/** Componentes do grafo kNN mútuo → Map índice → nº do cluster (só 2+ membros). */
function clusters(livros, sims) {
  const pai = livros.map((_, i) => i);
  const raiz = (x) => {
    while (pai[x] !== x) {
      pai[x] = pai[pai[x]];
      x = pai[x];
    }
    return x;
  };
  const top = sims.map((l) => new Set(l.slice(0, K_CLUSTER).filter((x) => x[1] >= SCORE_MIN_CLUSTER).map((x) => x[0])));
  for (let i = 0; i < livros.length; i++) {
    for (const j of top[i]) if (top[j].has(i)) pai[raiz(i)] = raiz(j);
  }
  const grupos = new Map();
  for (let i = 0; i < livros.length; i++) {
    const r = raiz(i);
    grupos.set(r, [...(grupos.get(r) ?? []), i]);
  }
  const validos = [...grupos.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({ membros: g, menorId: g.map((i) => livros[i].id).sort(cmp)[0] }))
    .sort((a, b) => b.membros.length - a.membros.length || cmp(a.menorId, b.menorId));
  const numero = new Map();
  validos.forEach((g, k) => g.membros.forEach((i) => numero.set(i, k + 1)));
  return { numero, total: validos.length, maior: validos[0]?.membros.length ?? 0 };
}

const sha256Buf = (buf) => createHash("sha256").update(buf).digest("hex");
const hashCurto = (texto, n) => sha256Buf(Buffer.from(texto, "utf8")).slice(0, n);

/**
 * Grava só se o conteúdo mudou (preserva mtime), e devolve o tamanho REAL do arquivo no disco.
 * Só é chamada depois de a posse do arquivo ter sido provada (ver "Posse de um arquivo").
 */
async function gravarArquivo(file, texto) {
  const buf = Buffer.from(texto, "utf8");
  let atual = null;
  try {
    atual = await readFile(file);
  } catch {
    /* ainda não existe */
  }
  const mudou = !atual || !atual.equals(buf);
  if (mudou) await writeText(file, texto);
  const { size } = await stat(file);
  if (size !== buf.length) throw new Error(`livros: tamanho gravado diverge em ${path.basename(file)} (${size} ≠ ${buf.length})`);
  return { mudou, size, hash: sha256Buf(buf) };
}

/** Diferença de mtime tolerada (ms): utimes arredonda, e reaplicar a cada execução mudaria o arquivo à toa. */
const TOLERANCIA_MTIME = 1000;

/**
 * Leva o mtime do arquivo gravado para o da origem no mega-brain (o /grafo data o livro por ele).
 * Origem ausente ou ilegível (p.ex. testes com repoRoot fictício) → não mexe. Devolve true se mudou.
 */
async function alinharMtime(file, repoRoot, rel) {
  let origem;
  try {
    origem = await stat(path.join(repoRoot, ...rel.split("/")));
  } catch {
    return false;
  }
  if (!origem.isFile()) return false;
  const atual = await stat(file);
  if (Math.abs(atual.mtimeMs - origem.mtimeMs) < TOLERANCIA_MTIME) return false;
  await utimes(file, atual.atime, origem.mtime);
  return true;
}

function nomeSeguro(arquivo) {
  return typeof arquivo === "string" && arquivo.length > 0 && arquivo === path.basename(arquivo) && !arquivo.startsWith(".");
}

const ehNosso = (l) => typeof l?.origem === "string" && l.origem.startsWith(PREFIXO_ORIGEM);

function motivo(d) {
  return `área "${d.area}" por regra de caminho do populate → tema "${d.tema}", domínio "${d.dominio}"`;
}

/**
 * Lê um JSON de estado anterior. Ausente → null. Existente mas ilegível → ERRO: nunca é tratado
 * como "vazio", porque o módulo o reescreveria e apagaria o que o usuário pôs ali.
 */
async function lerEstado(file) {
  const nome = path.basename(file);
  let bruto;
  try {
    bruto = await readFile(file, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw new Error(`livros: não consegui ler ${nome} existente (${e?.code ?? "erro"}); nada foi alterado`);
  }
  try {
    return JSON.parse(bruto.replace(/^\uFEFF/, ""));
  } catch (e) {
    const causa = String(e?.message ?? e).split("\n")[0].slice(0, 80);
    throw new Error(
      `livros: ${nome} existente não é um JSON válido (${causa}) e não será sobrescrito; nada foi alterado. ` +
        `Corrija o arquivo (ele pode ter entradas suas) ou mova-o para outro lugar e rode de novo.`,
    );
  }
}

/** `{ porLivro: {...} }` de um sidecar. Ausente → {}; formato inesperado → ERRO (mesma razão de lerEstado). */
async function lerPorLivro(file) {
  const raw = await lerEstado(file);
  if (raw === null) return {};
  const porLivro = ehObjeto(raw) ? (raw.porLivro ?? {}) : null;
  if (!ehObjeto(porLivro)) {
    throw new Error(`livros: ${path.basename(file)} existente não tem o formato { "porLivro": { ... } } e não será sobrescrito; nada foi alterado`);
  }
  return porLivro;
}

export default async function run(ctx) {
  const avisos = [];
  const dirLivros = path.join(ctx.dataDir, "livros");
  const dirArquivos = path.join(dirLivros, "arquivos");
  const catalogoFile = path.join(dirLivros, "catalogo.json");
  const dominiosFile = path.join(dirLivros, "livros-dominios.json");
  const hashesFile = path.join(dirLivros, "livros-hashes.json");

  const docs = ctx.docs.filter((d) => d.kind === "doc");
  const ids = new Set(docs.map((d) => d.id));
  const arqs = new Set(docs.map((d) => d.arquivo));
  if (ids.size !== docs.length || arqs.size !== docs.length) throw new Error("livros: id/arquivo duplicado em ctx.docs");

  // ---- estado ANTERIOR, lido por inteiro antes de qualquer escrita (ilegível aborta sem tocar em nada) ----
  const anterior = await lerEstado(catalogoFile);
  if (anterior !== null && !(ehObjeto(anterior) && Array.isArray(anterior.livros))) {
    throw new Error('livros: catalogo.json existente não tem o formato { "livros": [...] } e não será sobrescrito; nada foi alterado');
  }
  const dominiosAntes = await lerPorLivro(dominiosFile);
  const hashesAntes = await lerPorLivro(hashesFile);

  const livrosAnteriores = anterior?.livros ?? [];
  const nossosAntes = livrosAnteriores.filter(ehNosso);
  // entradas que não são nossas ficam como estão, SEMPRE (inclusive quando colidem com um documento gerado)
  const alheios = livrosAnteriores.filter((l) => !ehNosso(l)).sort((a, b) => cmp(String(a?.id), String(b?.id)));
  const idsManuais = new Set(alheios.map((l) => l?.id).filter((x) => typeof x === "string"));
  const arquivosManuais = new Set(alheios.map((l) => l?.arquivo).filter((x) => typeof x === "string").map(minusc));
  const nossoPorArquivo = new Map();
  for (const l of nossosAntes) if (typeof l.arquivo === "string") nossoPorArquivo.set(minusc(l.arquivo), l);

  /** "novo" | "identico" | "nosso" | "alheio" — ver "Posse de um arquivo" no cabeçalho. */
  const situacaoArquivo = async (nome, buf) => {
    let atual;
    try {
      atual = await readFile(path.join(dirArquivos, nome));
    } catch (e) {
      return e?.code === "ENOENT" ? "novo" : "alheio"; // diretório, sem permissão etc.: não é nosso
    }
    if (atual.equals(buf)) return "identico";
    const ant = nossoPorArquivo.get(minusc(nome));
    if (!ant) return "alheio";
    const registrado = hashesAntes[ant.id];
    return typeof registrado !== "string" || registrado === sha256Buf(atual) ? "nosso" : "alheio";
  };

  // ---- planejamento: id e arquivo FINAIS de cada documento (nenhuma escrita ainda) ----
  const usadosIds = new Set([...ids, ...idsManuais]);
  const usadosArq = new Set([...[...arqs].map(minusc), ...arquivosManuais]);
  const finais = [];
  const colisoes = [];
  for (const d of docs) {
    const buf = Buffer.from(d.text, "utf8");
    let id = d.id;
    let arquivo = d.arquivo;
    const porque = [];

    if (idsManuais.has(d.id)) {
      const n = TAMANHOS_SUFIXO.find((t) => !usadosIds.has(`${d.id}-${hashCurto(d.rel, t)}`));
      if (n === undefined) throw new Error(`livros: sem id alternativo livre para "${d.id}" (${d.rel})`);
      id = `${d.id}-${hashCurto(d.rel, n)}`;
      usadosIds.add(id);
      porque.push(`id "${d.id}" → "${id}" (já é de uma entrada do catálogo que o populate não gerou)`);
    }

    const reservado = arquivosManuais.has(minusc(arquivo));
    if (reservado || (await situacaoArquivo(arquivo, buf)) === "alheio") {
      const { name, ext } = path.parse(d.arquivo);
      let escolhido = null;
      for (const t of TAMANHOS_SUFIXO) {
        const cand = `${name}-${hashCurto(d.rel, t)}${ext}`;
        if (usadosArq.has(minusc(cand))) continue;
        if ((await situacaoArquivo(cand, buf)) === "alheio") continue;
        escolhido = cand;
        break;
      }
      if (escolhido === null) throw new Error(`livros: sem nome de arquivo alternativo livre para "${d.arquivo}" (${d.rel})`);
      arquivo = escolhido;
      usadosArq.add(minusc(arquivo));
      porque.push(
        `arquivo "${d.arquivo}" → "${arquivo}" (${reservado ? "já é de uma entrada do catálogo" : "já existe em livros/arquivos com conteúdo"} que o populate não gerou; o grafo continua citando o nome original)`,
      );
    }

    if (porque.length) colisoes.push(`documento "${d.rel}": ${porque.join("; ")}; o dado do usuário foi preservado`);
    finais.push({ id, arquivo });
  }

  // similaridade, vizinhos e clusters
  const sims = similaridades(docs);
  const cl = clusters(docs, sims);

  await ensureDir(dirArquivos);
  const livros = [];
  const dominios = {};
  const hashes = {};
  let gravados = 0;
  let datasAlinhadas = 0;
  let totalBytes = 0;
  let semVizinhos = 0;
  let comMenosDe5 = 0;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const { id, arquivo } = finais[i];
    const destino = path.join(dirArquivos, arquivo);
    const g = await gravarArquivo(destino, d.text);
    if (g.mudou) gravados++;
    if (await alinharMtime(destino, ctx.repoRoot, d.rel)) datasAlinhadas++;
    totalBytes += g.size;
    const vizinhos = sims[i]
      .map(([j, s]) => ({ id: finais[j].id, titulo: docs[j].title, score: Math.min(1, Math.round(s * 1000) / 1000) }))
      .filter((v) => v.score >= SCORE_MIN_VIZINHO && v.id !== id)
      .slice(0, K_VIZINHOS);
    if (vizinhos.length === 0) semVizinhos++;
    if (vizinhos.length < K_VIZINHOS) comMenosDe5++;
    livros.push({
      id,
      titulo: d.title,
      arquivo,
      formato: d.ext.slice(1),
      tema: d.tema,
      cluster: cl.numero.get(i) ?? null,
      origem: `${PREFIXO_ORIGEM}${d.area}`,
      sizeBytes: g.size,
      paginas: null,
      chunksTotal: chunkWords(d.text).length,
      vizinhos,
      proveniencia: { origemPath: d.rel, motivo: motivo(d) },
    });
    dominios[id] = d.dominio;
    hashes[id] = g.hash;
  }

  // limpeza: arquivos que o catálogo anterior listava como nossos e que não existem mais.
  // Só entra aqui o que não é arquivo de nenhuma entrada do catálogo novo (nem das preservadas)
  // e que ainda é nosso (hash em disco = hash registrado): arquivo editado depois fica.
  const emUso = new Set([...finais.map((f) => minusc(f.arquivo)), ...arquivosManuais]);
  let removidos = 0;
  let mantidosAlterados = 0;
  for (const l of nossosAntes) {
    if (!nomeSeguro(l.arquivo) || emUso.has(minusc(l.arquivo))) continue;
    const file = path.join(dirArquivos, l.arquivo);
    let atual;
    try {
      atual = await readFile(file);
    } catch {
      continue; // já não existe (ou não é um arquivo): nada a remover
    }
    const registrado = hashesAntes[l.id];
    if (typeof registrado === "string" && registrado !== sha256Buf(atual)) {
      mantidosAlterados++;
      avisos.push(`arquivo "${l.arquivo}" foi gerado pelo populate mas alterado depois, e o documento sumiu do repositório: mantido em livros/arquivos (fora do catálogo)`);
      continue;
    }
    await rm(file, { force: true });
    removidos++;
  }

  // auxiliares: preservam chaves de entradas que não são nossas
  const idsAntes = new Set(nossosAntes.map((l) => l.id));
  const mesclar = (antes, novo) => {
    const out = { ...novo };
    for (const [k, v] of Object.entries(antes)) if (!idsAntes.has(k) && !(k in novo)) out[k] = v;
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => cmp(a, b)));
  };

  await writeJson(catalogoFile, { livros: [...livros, ...alheios] });
  await writeJson(dominiosFile, { porLivro: mesclar(dominiosAntes, dominios) });
  await writeJson(hashesFile, { porLivro: mesclar(hashesAntes, hashes) });

  log("livros", `${livros.length} livros gerados (${gravados} arquivos gravados, ${datasAlinhadas} datas da origem aplicadas, ${removidos} removidos${colisoes.length ? `, ${colisoes.length} colisão(ões) com dado seu preservada(s)` : ""})`);

  for (const c of colisoes.slice(0, MAX_AVISOS_COLISAO)) avisos.push(c);
  if (colisoes.length > MAX_AVISOS_COLISAO) avisos.push(`... e mais ${colisoes.length - MAX_AVISOS_COLISAO} colisão(ões) com dado do usuário resolvida(s) do mesmo modo`);
  if (semVizinhos) avisos.push(`${semVizinhos} livro(s) sem nenhum vizinho acima de ${SCORE_MIN_VIZINHO}`);

  return {
    resumo: {
      livros: livros.length,
      preservadosManuais: alheios.length,
      colisoesPreservadas: colisoes.length,
      arquivosGravados: gravados,
      datasAlinhadas,
      arquivosRemovidos: removidos,
      arquivosAlteradosMantidos: mantidosAlterados,
      bytes: totalBytes,
      clusters: cl.total,
      maiorCluster: cl.maior,
      solitarios: livros.filter((l) => l.cluster === null).length,
      semVizinhos,
      comMenosDe5Vizinhos: comMenosDe5,
    },
    avisos,
  };
}
