/**
 * Infraestrutura da extração DETERMINÍSTICA do grafo de conhecimento (módulo `grafo`).
 *
 * Nada aqui faz rede, usa LLM, relógio ou aleatoriedade. A regra de ouro: toda
 * evidência gravada é, por construção, uma SUBSTRING real do documento de origem
 * (depois de normalizar espaços) — `Grafo.suporte()` recusa o que não for, e a
 * verificação final do módulo prova isso de novo, lendo o SQLite gravado.
 *
 * Vocabulário de confiança (evidences.confianca), por tipo de evidência:
 *   0.95  definição  — cabeçalho de verbete do glossário
 *   0.90  catálogo   — linha de tabela/registro (YAML) que declara o fato
 *   0.85  cadeia     — cadeia explícita (seta "→", lista numerada) escrita no documento
 *   0.80  título     — o termo aparece em título/cabeçalho de seção
 *   0.70  coocorrência estrutural — outro documento repete o mesmo fato (mesma linha)
 *   0.65  destaque   — termo em negrito ou código
 *   0.50  texto corrido
 *
 * Peso da aresta (edges.peso, 0..1) = confiança média das evidências × fator de
 * suporte (1 documento 0.70 · 2 documentos 0.85 · 3 ou mais 1.00), arredondado a
 * 2 casas. n_fontes = documentos DISTINTOS que sustentam (cópias byte a byte
 * idênticas — mesmo sha256 — contam como um só: não são fontes independentes).
 */
import { chunkWords } from "./common.mjs";

export const MAX_TRECHO = 300;
export const MAX_EVIDENCIAS_POR_ARESTA = 8;

export const CONF = {
  definicao: 0.95,
  catalogo: 0.9,
  cadeia: 0.85,
  titulo: 0.8,
  coocorrencia: 0.7,
  destaque: 0.65,
  corrido: 0.5,
};

/* ------------------------------------------------------------------ texto */

export const norm = (s) => String(s).replace(/\s+/g, " ").trim();

export const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Corta em fronteira de palavra para caber em `max` caracteres (sempre um prefixo — continua substring). */
export function cortar(texto, max = MAX_TRECHO) {
  const t = norm(texto);
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const i = c.lastIndexOf(" ");
  return (i > max * 0.6 ? c.slice(0, i) : c).trim();
}

/**
 * `norm(s)` com mapa de posições: `t` é a linha com espaços colapsados e `map[i]` diz onde o
 * caractere `i` da linha BRUTA caiu em `t` (a âncora de uma busca vem em coordenadas brutas).
 * `map` tem `s.length + 1` entradas; a última aponta para o fim de `t`.
 */
export function normComMapa(s) {
  const map = new Array(s.length + 1);
  let t = "";
  let espaco = false;
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) {
      map[i] = t.length;
      espaco = t.length > 0;
      continue;
    }
    if (espaco) t += " ";
    espaco = false;
    map[i] = t.length;
    t += s[i];
  }
  map[s.length] = t.length;
  return { t, map };
}

/**
 * Janela de até `max` caracteres que contém [ini, ini+len) da linha (coordenadas da linha bruta),
 * cortando em espaços. É sempre uma substring da linha normalizada.
 *
 * Com `{ doc, leitor }` a janela ainda é ajustada para o destaque do Leitor do app (ver
 * `alinharAoLeitor`): continua contendo a âncora e continua sendo substring do documento.
 */
export function janela(linha, ini, len, opts = {}) {
  const o = typeof opts === "number" ? { max: opts } : opts;
  const max = o.max ?? MAX_TRECHO;
  const { t, map } = normComMapa(linha);
  const ti = map[Math.min(Math.max(ini, 0), linha.length)];
  const fimBruto = Math.min(Math.max(ini + len, ini), linha.length);
  const tf = fimBruto > ini ? Math.min(t.length, map[fimBruto - 1] + 1) : ti;
  let w;
  let deslocamento = 0;
  if (t.length <= max) {
    w = t;
  } else {
    const tl = Math.max(0, tf - ti);
    const folga = Math.max(0, Math.floor((max - tl) / 2));
    let a = Math.max(0, ti - folga);
    let b = Math.min(t.length, a + max);
    a = Math.max(0, b - max);
    if (a > 0) {
      const i = t.indexOf(" ", a);
      if (i !== -1 && i < ti) a = i + 1;
    }
    if (b < t.length) {
      const i = t.lastIndexOf(" ", b);
      if (i > tf) b = i;
    }
    const bruto = t.slice(a, b);
    deslocamento = a + (bruto.length - bruto.trimStart().length);
    w = bruto.trim();
  }
  if (o.leitor && o.doc) {
    return alinharAoLeitor(o.leitor, o.doc, w, Math.max(0, ti - deslocamento), Math.min(w.length, Math.max(0, tf - deslocamento)));
  }
  return w;
}

/** Remove decoração markdown de uma célula/rótulo. */
export function limpa(s) {
  return String(s)
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ regex de termos */

const ESQ = "(?<![\\p{L}\\p{N}_]|[\\p{L}\\p{N}]-)";
const DIR = "(?![\\p{L}\\p{N}_]|-[\\p{L}\\p{N}])";

/** Regex de um termo com fronteiras de palavra (hífen interno é parte do termo). `exato` = diferencia maiúsculas. */
export function regexTermo(termo, { exato = false } = {}) {
  const corpo = escRe(termo).replace(/\s+/g, "\\s+");
  return new RegExp(`${ESQ}${corpo}${DIR}`, exato ? "u" : "iu");
}

/* ------------------------------------------------------------------ corpus */

/**
 * Visão do corpus para a extração: documentos por caminho, grupos de cópias
 * idênticas, textos normalizados e chunks (chunkWords) sob demanda.
 */
export function criarCorpus(docs) {
  const porRel = new Map(docs.map((d) => [d.rel, d]));
  const grupos = new Map();
  for (const d of docs) {
    const g = grupos.get(d.sha256);
    if (g) g.push(d);
    else grupos.set(d.sha256, [d]);
  }
  const textoNorm = new Map();
  const textoMin = new Map();
  const chunks = new Map();
  const linhasCache = new Map();
  return {
    docs,
    porRel,
    /** simulação do Leitor do app (destaque do deep-link "ir pro trecho no livro") */
    leitor: criarLeitor(),
    doc: (rel) => porRel.get(rel),
    /** documento canônico do grupo de cópias idênticas (o de menor caminho) */
    canon: (d) => grupos.get(d.sha256)[0],
    copias: (d) => grupos.get(d.sha256),
    normTexto(d) {
      let t = textoNorm.get(d.rel);
      if (t === undefined) {
        t = norm(d.text);
        textoNorm.set(d.rel, t);
      }
      return t;
    },
    linhas(d) {
      let l = linhasCache.get(d.rel);
      if (!l) {
        l = d.text.split("\n");
        linhasCache.set(d.rel, l);
      }
      return l;
    },
    minTexto(d) {
      let t = textoMin.get(d.rel);
      if (t === undefined) {
        t = d.text.toLowerCase();
        textoMin.set(d.rel, t);
      }
      return t;
    },
    chunksNorm(d) {
      let c = chunks.get(d.rel);
      if (!c) {
        c = chunkWords(d.text).map(norm);
        chunks.set(d.rel, c);
      }
      return c;
    },
    /** identidade do documento no grafo, conforme o contrato entre módulos */
    ref(d) {
      return d.kind === "doc"
        ? { noId: `livro:${d.arquivo}`, evLivro: d.arquivo, chunkBase: d.arquivo }
        : { noId: `livro:yt-${d.colecao}:${d.rel}`, evLivro: `yt-${d.colecao}:${d.rel}`, chunkBase: d.rel };
    },
  };
}

/* ------------------------------------------------------------------ parsers de estrutura */

const celulas = (l) =>
  l.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

/**
 * Tabelas markdown do documento: { titulo (último cabeçalho acima), header, rows:[{cells, linha, n}] }.
 * Ignora o conteúdo de cercas de código.
 */
export function tabelasMd(doc) {
  const L = doc.text.split("\n");
  const out = [];
  let titulo = "";
  let cerca = false;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (/^\s*```/.test(l)) { cerca = !cerca; continue; }
    if (cerca) continue;
    const h = l.match(/^#{1,6}\s+(.*?)\s*$/);
    if (h) { titulo = limpa(h[1]); continue; }
    if (/^\s*\|/.test(l) && i + 1 < L.length && /^\s*\|[\s:|-]+\|\s*$/.test(L[i + 1])) {
      const rows = [];
      let j = i + 2;
      while (j < L.length && /^\s*\|/.test(L[j])) {
        rows.push({ cells: celulas(L[j]), linha: L[j], n: j });
        j++;
      }
      out.push({ titulo, header: celulas(l).map(limpa), linhaHeader: l, n: i, rows });
      i = j - 1;
    }
  }
  return out;
}

/** Primeiro bloco de código (```) depois de uma linha que casa `re`. Devolve as linhas do bloco. */
export function blocoCodigoApos(doc, re) {
  const L = doc.text.split("\n");
  const i0 = L.findIndex((l) => re.test(l));
  if (i0 === -1) return null;
  let i = i0 + 1;
  while (i < L.length && !/^\s*```/.test(L[i])) i++;
  if (i >= L.length) return null;
  const out = [];
  for (i = i + 1; i < L.length && !/^\s*```/.test(L[i]); i++) out.push({ n: i, texto: L[i] });
  return out;
}

/** Procura a primeira linha (a partir de `desde`) que casa `re`; devolve { n, texto } ou null. */
export function acharLinha(doc, re, desde = 0) {
  const L = doc.text.split("\n");
  for (let i = desde; i < L.length; i++) if (re.test(L[i])) return { n: i, texto: L[i] };
  return null;
}

/* ------------------------------------------------------------------ o grafo em construção */

const FATOR_SUPORTE = (n) => (n >= 3 ? 1 : n === 2 ? 0.85 : 0.7);
const arred = (x) => Math.round(x * 100) / 100;

export class Grafo {
  constructor(corpus) {
    this.c = corpus;
    /** id → conceito */
    this.conceitos = new Map();
    /** "src\0rel\0dst" → { src, rel, dst, suportes: Map(canonRel → evidência) } */
    this.rels = new Map();
    this.avisos = [];
    this.descartes = { relacoesSemSuporte: 0, trechoInvalido: 0 };
  }

  aviso(msg) {
    if (!this.avisos.includes(msg)) this.avisos.push(msg);
  }

  /**
   * Declara (ou enriquece) um conceito.
   *  - estrutural: derivado de registro/configuração/catálogo — dispensa o piso de 2 documentos
   *  - aliases / exatos / padroes: como localizar o termo no texto (só se `mencionavel`)
   *  - excluirDocs: regex de caminhos que NÃO contam como menção (ambiguidade conhecida)
   */
  conceito(id, opts = {}) {
    let c = this.conceitos.get(id);
    if (!c) {
      c = {
        id,
        label: opts.label ?? id,
        origem: opts.origem ?? "",
        estrutural: false,
        mencionavel: false,
        aliases: [],
        exatos: [],
        padroes: [],
        agulhas: [],
        excluirDocs: null,
        definicoes: [],
        topK: null,
      };
      this.conceitos.set(id, c);
    }
    if (opts.topK) c.topK = opts.topK;
    if (opts.label && (c.label === id || opts.forcarLabel)) c.label = opts.label;
    if (opts.origem && !c.origem.split(",").includes(opts.origem)) c.origem = c.origem ? `${c.origem},${opts.origem}` : opts.origem;
    if (opts.estrutural) c.estrutural = true;
    if (opts.mencionavel) c.mencionavel = true;
    for (const a of opts.aliases ?? []) if (!c.aliases.includes(a)) c.aliases.push(a);
    for (const a of opts.exatos ?? []) if (!c.exatos.includes(a)) c.exatos.push(a);
    for (const p of opts.padroes ?? []) c.padroes.push(p);
    for (const a of opts.agulhas ?? []) c.agulhas.push(a.toLowerCase());
    if (opts.excluirDocs) c.excluirDocs = opts.excluirDocs;
    return c;
  }

  /** Evidência de definição (conta como suporte de documento e como menção de alta confiança). */
  definicao(id, doc, trecho, regra = "definicao") {
    const c = this.conceitos.get(id);
    if (!c) return;
    const t = this._validar(doc, trecho);
    if (!t) return;
    c.definicoes.push({ doc: this.c.canon(doc), trecho: t, confianca: CONF.definicao, regra });
  }

  _validar(doc, trecho) {
    const t = cortar(trecho);
    if (!t) return null;
    if (!this.c.normTexto(doc).includes(t)) {
      this.descartes.trechoInvalido++;
      this.aviso(`trecho recusado (não é substring de ${doc.rel}): "${t.slice(0, 60)}"`);
      return null;
    }
    // "## Título" / "- item" / "1. passo": o marcador some na renderização e o Leitor não acharia o trecho com ele
    return semMarcadorDeBloco(this.c.leitor, this.c.canon(doc), t);
  }

  /** Registra que `doc` sustenta a relação src —rel→ dst com `trecho`. Um documento (canônico) vale uma vez. */
  suporte(src, rel, dst, { doc, trecho, regra, confianca }) {
    if (src === dst) return false;
    const t = this._validar(doc, trecho);
    if (!t) return false;
    const key = `${src}\u0000${rel}\u0000${dst}`;
    let r = this.rels.get(key);
    if (!r) {
      r = { src, rel, dst, suportes: new Map() };
      this.rels.set(key, r);
    }
    const cd = this.c.canon(doc);
    const atual = r.suportes.get(cd.rel);
    if (!atual || confianca > atual.confianca) r.suportes.set(cd.rel, { doc: cd, trecho: t, confianca, regra });
    return true;
  }

  /* -------- menções -------- */

  _regexesDe(c) {
    return [
      ...c.aliases.map((a) => regexTermo(a, { exato: false })),
      ...c.exatos.map((a) => regexTermo(a, { exato: true })),
      ...c.padroes,
    ];
  }

  /** Varre o corpus atrás do termo; devolve a melhor ocorrência por documento canônico. */
  _varrer(c) {
    const regs = this._regexesDe(c);
    if (!regs.length) return [];
    const agulhas = [...c.aliases, ...c.exatos].map((a) => a.toLowerCase()).concat(c.agulhas);
    const out = [];
    for (const d of this.c.docs) {
      if (this.c.canon(d) !== d) continue;
      if (c.excluirDocs && c.excluirDocs.test(d.rel)) continue;
      if (agulhas.length && (!c.padroes.length || c.agulhas.length)) {
        const min = this.c.minTexto(d);
        if (!agulhas.some((a) => min.includes(a))) continue;
      }
      const m = this._melhorOcorrencia(d, regs);
      if (m) out.push(m);
    }
    return out;
  }

  /**
   * Janela do trecho `linha` em torno da âncora [ini, ini+len), ajustada para o destaque do Leitor
   * quando `doc` é um livro da estante (ver `alinharAoLeitor`). Usa o documento canônico: é o que
   * a evidência aponta.
   */
  janela(doc, linha, ini, len) {
    return janela(linha, ini, len, { doc: this.c.canon(doc), leitor: this.c.leitor });
  }

  _melhorOcorrencia(d, regs) {
    const L = this.c.linhas(d);
    const leitor = this.c.leitor;
    const livro = leitor.aplica(d);
    let melhor = null;
    let total = 0;
    let avaliadas = 0; // tentativas de desempate por destaque (limite: o custo cresce com o nº de ocorrências)
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      for (const re of regs) {
        const m = re.exec(l);
        if (!m) continue;
        total++;
        const cabecalho = /^\s{0,3}#{1,6}\s/.test(l);
        const destaque = new RegExp(`(\\*\\*|\`)[^\`*]*${escRe(m[0])}[^\`*]*(\\*\\*|\`)`, "i").test(l);
        const confianca = cabecalho ? CONF.titulo : destaque ? CONF.destaque : CONF.corrido;
        const regra = cabecalho ? "mencao-em-titulo" : destaque ? "mencao-em-destaque" : "mencao-em-texto";
        // a confiança manda; a ocorrência que o Leitor consegue destacar só desempata dentro da mesma confiança
        const melhora = !melhor || confianca > melhor.confianca;
        const desempata = melhor && confianca === melhor.confianca && livro && !melhor.destacavel && avaliadas < 24;
        if (melhora || desempata) {
          const trecho = this.janela(d, l, m.index, m[0].length);
          const destacavel = livro ? leitor.acha(d, trecho) : true;
          if (desempata) avaliadas++;
          if (melhora || destacavel) melhor = { doc: d, confianca, regra, trecho, linha: i, destacavel };
        }
        break;
      }
    }
    if (!melhor) return null;
    melhor.ocorrencias = total;
    return melhor;
  }

  /* -------- fechamento -------- */

  /**
   * Aplica as regras de qualidade e devolve { nodes, edges, evidences, stats }.
   *  - conceito entra se estrutural OU se tem >= 2 documentos distintos de apoio
   *    (relações incidentes + menções + definições);
   *  - relação entra se as duas pontas entram;
   *  - conceito sem nenhuma aresta sai;
   *  - menções: no máximo `topK` documentos por conceito (melhor evidência primeiro).
   */
  finalizar({ topK = 5 } = {}) {
    const tipoDoc = { doc: 0, config: 1, code: 2 };

    // 1. menções
    const mencoes = new Map();
    for (const c of this.conceitos.values()) {
      if (c.mencionavel) mencoes.set(c.id, this._varrer(c));
    }

    // 2. documentos de apoio por conceito
    const apoio = new Map([...this.conceitos.keys()].map((id) => [id, new Set()]));
    for (const r of this.rels.values()) {
      for (const rel of r.suportes.keys()) {
        apoio.get(r.src)?.add(rel);
        apoio.get(r.dst)?.add(rel);
      }
    }
    for (const c of this.conceitos.values()) {
      for (const d of c.definicoes) apoio.get(c.id).add(d.doc.rel);
      for (const m of mencoes.get(c.id) ?? []) apoio.get(c.id).add(m.doc.rel);
    }

    // 3. conceitos mantidos
    const mantidos = new Set();
    for (const c of this.conceitos.values()) {
      if (c.estrutural || apoio.get(c.id).size >= 2) mantidos.add(c.id);
    }

    // 4. relações entre conceitos
    let rels = [...this.rels.values()].filter((r) => mantidos.has(r.src) && mantidos.has(r.dst) && r.suportes.size > 0);
    rels.sort((a, b) => (a.src + a.rel + a.dst < b.src + b.rel + b.dst ? -1 : 1));

    const comAresta = new Set();
    for (const r of rels) { comAresta.add(r.src); comAresta.add(r.dst); }

    // 5. menções escolhidas (top-K por conceito)
    const escolhidas = [];
    for (const c of this.conceitos.values()) {
      if (!mantidos.has(c.id)) continue;
      const lista = [];
      for (const d of c.definicoes) lista.push({ doc: d.doc, trecho: d.trecho, confianca: d.confianca, regra: d.regra, ocorrencias: 99 });
      for (const m of mencoes.get(c.id) ?? []) {
        if (lista.some((x) => x.doc === m.doc)) continue;
        lista.push(m);
      }
      lista.sort(
        (a, b) =>
          b.confianca - a.confianca ||
          tipoDoc[a.doc.kind] - tipoDoc[b.doc.kind] ||
          b.ocorrencias - a.ocorrencias ||
          (a.doc.rel < b.doc.rel ? -1 : 1),
      );
      for (const m of lista.slice(0, c.topK ?? topK)) escolhidas.push({ conceito: c.id, ...m });
    }
    for (const m of escolhidas) comAresta.add(m.conceito);

    // conceitos finais: mantidos E com aresta
    const finais = [...this.conceitos.values()].filter((c) => mantidos.has(c.id) && comAresta.has(c.id));
    const idsFinais = new Set(finais.map((c) => c.id));
    rels = rels.filter((r) => idsFinais.has(r.src) && idsFinais.has(r.dst));

    // 6. arestas + evidências
    const edges = [];
    const evidences = [];
    const livros = new Map();
    const noLivro = (d) => {
      const ref = this.c.ref(d);
      if (!livros.has(ref.noId)) livros.set(ref.noId, { id: ref.noId, label: d.title, tipo: "livro" });
      return ref;
    };
    const chunkDe = (d, ref, trecho) => {
      const cs = this.c.chunksNorm(d);
      let i = cs.findIndex((c) => c.includes(trecho));
      if (i === -1) return null;
      return `${ref.chunkBase}#${i}`;
    };
    const peso = (evs) => {
      const media = evs.reduce((s, e) => s + e.confianca, 0) / evs.length;
      return Math.min(1, Math.max(0, arred(media * FATOR_SUPORTE(evs.length))));
    };
    let eid = 0;

    const emitir = (src, rel, dst, evs) => {
      const validos = [];
      for (const e of evs.slice(0, MAX_EVIDENCIAS_POR_ARESTA)) {
        const ref = this.c.ref(e.doc);
        const chunk = chunkDe(e.doc, ref, e.trecho);
        if (!chunk) {
          this.aviso(`sem chunk contendo o trecho de ${e.doc.rel}: "${e.trecho.slice(0, 50)}"`);
          continue;
        }
        validos.push({ ...e, ref, chunk });
      }
      if (!validos.length) { this.descartes.relacoesSemSuporte++; return; }
      eid++;
      const n = new Set(validos.map((v) => v.doc.rel)).size;
      edges.push({ id: eid, src, rel, dst, status: n >= 2 ? "confirmed" : "claimed", n_fontes: n, peso: peso(validos) });
      for (const v of validos) {
        noLivro(v.doc);
        evidences.push({ edge_id: eid, livro: v.ref.evLivro, chunk_id: v.chunk, trecho: v.trecho, confianca: v.confianca, regra: v.regra });
      }
    };

    for (const r of rels) {
      const evs = [...r.suportes.values()].sort(
        (a, b) => b.confianca - a.confianca || (a.doc.rel < b.doc.rel ? -1 : 1),
      );
      emitir(r.src, r.rel, r.dst, evs);
    }
    const ordMencao = escolhidas
      .filter((m) => idsFinais.has(m.conceito))
      .map((m) => ({ ...m, src: this.c.ref(m.doc).noId }))
      .sort((a, b) => (a.src + a.conceito < b.src + b.conceito ? -1 : a.src + a.conceito > b.src + b.conceito ? 1 : 0));
    for (const m of ordMencao) emitir(m.src, "menciona", m.conceito, [m]);

    // nós: conceitos (só os que ficaram com aresta emitida) + livros
    const usados = new Set();
    for (const e of edges) { usados.add(e.src); usados.add(e.dst); }
    const nodes = [
      ...finais.filter((c) => usados.has(c.id)).map((c) => ({ id: c.id, label: c.label, tipo: "conceito" })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      ...[...livros.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    ];
    return { nodes, edges, evidences, conceitos: finais.filter((c) => usados.has(c.id)) };
  }
}

/* ------------------------------------------------------------------ cadeias de setas */

/**
 * Procura, em TODOS os documentos, linhas onde `aliasesA` aparece seguido (a até
 * `gap` caracteres) de uma seta e então de `aliasesB`. Devolve [{doc, n, texto, ini, len}].
 */
export function acharAdjacenciaSeta(corpus, aliasesA, aliasesB, { gap = 14, exato = false, ignorar = null } = {}) {
  const alt = (xs) => xs.map((a) => escRe(a).replace(/\s+/g, "\\s+")).join("|");
  const re = new RegExp(
    `${ESQ}(?:${alt(aliasesA)})${DIR}[^\\n→>]{0,${gap}}?(?:→|──→|─→|-->|->)\\s*[\`*_\\[\\(@]{0,3}(?:${alt(aliasesB)})${DIR}`,
    exato ? "u" : "iu",
  );
  const out = [];
  for (const d of corpus.docs) {
    if (corpus.canon(d) !== d) continue;
    if (ignorar && ignorar.test(d.rel)) continue;
    if (!/(→|-->|->)/.test(d.text)) continue;
    const L = d.text.split("\n");
    for (let i = 0; i < L.length; i++) {
      if (!L[i].includes(">") && !L[i].includes("→")) continue;
      const m = re.exec(L[i]);
      if (m) {
        out.push({ doc: d, n: i, texto: L[i], ini: m.index, len: m[0].length });
        break; // uma linha por documento basta
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ leitor: destaque do deep-link */

/*
 * O link "ir pro trecho no livro" (components/Grafo.tsx) abre /ler/<id>?q=<trecho> e o Leitor
 * (components/Leitor.tsx) procura os 50 primeiros caracteres do trecho DENTRO DE UM ÚNICO nó de
 * texto do HTML renderizado por lib/render-texto.ts. Negrito, código, célula de tabela e item de
 * lista viram nós separados, e o markup cru (|, **, `, ###, "- ") nem aparece no texto renderizado:
 * uma linha de markdown copiada inteira quase nunca casa.
 *
 * Aqui o Leitor é SIMULADO (porta fiel do renderTexto + a mesma regra de busca) para que a extração
 * escolha, entre as janelas que continuam contendo a âncora da evidência, uma que o Leitor consiga
 * destacar. Toda janela escolhida segue sendo substring do documento. Se o Leitor mudar, o teste
 * `grafo-topologia.test.ts` compara esta porta com o `renderTexto` real e acusa a divergência.
 */

const ALVO_MAX = 50; // Leitor.tsx: destaque.trim().slice(0, 50)
const ALVO_MIN = 8; // Leitor.tsx: alvo.length < 8 → não procura
const QUERY_MAX = 60; // Grafo.tsx: cortaTexto(e.trecho, 60)
/** Janela alinhada menor que isto deixa de ser evidência legível: mantém a original (sem destaque). */
export const MIN_JANELA_ALINHADA = 12;

function escHtml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function inlineHtml(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Porta de `renderTexto` (lib/render-texto.ts). Mantida igual de propósito; o teste compara as duas. */
export function renderHtmlLeitor(raw, formato) {
  const linhas = escHtml(raw.replace(/\r\n/g, "\n")).split("\n");
  const out = [];
  let para = [];
  let lista = false;
  let tabela = [];
  let quote = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inlineHtml(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushLista = () => {
    if (lista) {
      out.push("</ul>");
      lista = false;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(`<blockquote><p>${inlineHtml(quote.join(" "))}</p></blockquote>`);
      quote = [];
    }
  };
  const flushTabela = () => {
    if (tabela.length >= 2 && /^\|[\s:\-|]+\|$/.test(tabela[1])) {
      const celulas = (l) => l.replace(/^\||\|$/g, "").split("|").map((c) => inlineHtml(c.trim()));
      const html = ['<div class="tabela-scroll"><table>'];
      html.push("<thead><tr>" + celulas(tabela[0]).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>");
      for (const l of tabela.slice(2)) {
        html.push("<tr>" + celulas(l).map((c) => `<td>${c}</td>`).join("") + "</tr>");
      }
      html.push("</tbody></table></div>");
      out.push(html.join(""));
    } else {
      para.push(...tabela);
      flushPara();
    }
    tabela = [];
  };

  for (const l of linhas) {
    const t = l.trim();
    if (formato === "md" && t.startsWith("|")) {
      flushPara();
      flushLista();
      flushQuote();
      tabela.push(t);
      continue;
    }
    if (tabela.length) flushTabela();
    if (!t) {
      flushPara();
      flushLista();
      flushQuote();
      continue;
    }
    const q = formato === "md" && t.match(/^&gt;\s?(.*)/);
    if (q) {
      flushPara();
      flushLista();
      quote.push(q[1]);
      continue;
    }
    const h = formato === "md" && t.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flushPara();
      flushLista();
      flushQuote();
      const n = Math.min(h[1].length + 1, 4);
      out.push(`<h${n}>${inlineHtml(h[2])}</h${n}>`);
      continue;
    }
    const li = t.match(/^[-*•]\s+(.*)/);
    if (li) {
      flushPara();
      flushQuote();
      if (!lista) {
        out.push("<ul>");
        lista = true;
      }
      out.push(`<li>${inlineHtml(li[1])}</li>`);
      continue;
    }
    para.push(t);
  }
  if (tabela.length) flushTabela();
  flushPara();
  flushLista();
  flushQuote();
  return out.join("\n");
}

const ENTIDADES = { lt: "<", gt: ">", amp: "&" };

/** Nós de texto do HTML do Leitor (o que `TreeWalker(SHOW_TEXT)` enxerga). */
export function nosDeTexto(html) {
  return html
    .split(/<[^>]*>/)
    .map((s) => s.replace(/&(lt|gt|amp);/g, (_, k) => ENTIDADES[k]))
    .filter((s) => s.length > 0);
}

/** O que o Leitor procura: `cortaTexto(trecho, 60)` na URL e depois `trim().slice(0, 50)`. */
export function alvoDoLeitor(trecho) {
  let q = "";
  let n = 0;
  for (const cp of trecho) {
    if (n >= QUERY_MAX) break;
    if (cp.length === 1 && cp.charCodeAt(0) >= 0xd800 && cp.charCodeAt(0) <= 0xdfff) continue; // surrogate órfão
    q += cp;
    n++;
  }
  return q.trim().slice(0, ALVO_MAX);
}

/** Simulador do Leitor, com o HTML de cada documento renderizado uma vez só. */
export function criarLeitor() {
  const blobs = new Map();
  const blobDe = (doc) => {
    const chave = `${doc.sha256}:${doc.ext}`;
    let b = blobs.get(chave);
    if (b === undefined) {
      // "\u0000" separa os nós: uma busca nunca atravessa a fronteira entre dois nós de texto
      b = nosDeTexto(renderHtmlLeitor(doc.text, doc.ext === ".txt" ? "txt" : "md")).join("\u0000");
      blobs.set(chave, b);
    }
    return b;
  };
  return {
    /** só livros da estante (kind "doc") passam pelo Leitor; config/código usam o leitor de coleções */
    aplica: (doc) => doc.kind === "doc",
    /** o Leitor destacaria este trecho? */
    acha(doc, trecho) {
      const a = alvoDoLeitor(trecho);
      return a.length >= ALVO_MIN && blobDe(doc).includes(a);
    },
    /** maior L <= 50 tal que texto.slice(s, s+L) cabe inteiro em UM nó de texto (a ocorrência é monotônica em L) */
    prefixoMax(doc, texto, s) {
      const b = blobDe(doc);
      let lo = 0;
      let hi = Math.min(ALVO_MAX, texto.length - s);
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (b.includes(texto.slice(s, s + mid))) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}

/** A janela começa num início de palavra (depois de espaço ou marca), nunca em pontuação solta como ": " ou ", ". */
const inicioValido = (w, s) =>
  (s === 0 || /[\s*`|[(>_"'“‘«]/u.test(w[s - 1])) && /[\p{L}\p{N}@/.#$([“‘«]/u.test(w[s]);

/**
 * Reduz a janela `w` (substring do documento) à maior sub-janela que (1) contém a âncora
 * [aIni, aFim) e (2) o Leitor consegue destacar. Nunca acrescenta texto. Se a original já é
 * destacável, ou não existe sub-janela destacável com pelo menos `MIN_JANELA_ALINHADA` caracteres
 * (linha de tabela, âncora entre dois trechos de código…), devolve a original.
 */
export function alinharAoLeitor(leitor, doc, w, aIni, aFim) {
  if (!leitor || !doc || !w || !leitor.aplica(doc) || leitor.acha(doc, w)) return w;
  // marcador de bloco ("## ", "- ", "1. ") não é conteúdo: não conta para o tamanho mínimo
  const minimo = Math.min(MIN_JANELA_ALINHADA, w.length - w.match(/^(?:(?:[#>*•|-]+|\d+\.)\s+)*/)[0].length);
  let melhor = null;
  for (let s = 0; s <= Math.min(aIni, w.length - 1); s++) {
    if (!inicioValido(w, s)) continue;
    const L = leitor.prefixoMax(doc, w, s);
    if (L < ALVO_MIN) continue;
    let fim = L >= ALVO_MAX ? w.length : s + L;
    if (fim < w.length && /[\p{L}\p{N}]/u.test(w[fim]) && /[\p{L}\p{N}]/u.test(w[fim - 1])) {
      const i = w.lastIndexOf(" ", fim); // não corta no meio de uma palavra
      if (i > s) fim = i;
    }
    if (fim < aFim) continue;
    const cand = w.slice(s, fim).trimEnd();
    if (cand.length < minimo || s + cand.length < aFim) continue;
    if (!melhor || cand.length > melhor.length) melhor = cand;
  }
  return melhor ?? w;
}

/**
 * Tira o marcador de bloco do início do trecho (`## `, `> `, `- `, `1. `) quando só isso impede o Leitor
 * de destacá-lo. Não perde conteúdo: o marcador não aparece no texto renderizado.
 */
export function semMarcadorDeBloco(leitor, doc, t) {
  if (!leitor || !leitor.aplica(doc) || leitor.acha(doc, t)) return t;
  const sem = t.replace(/^(?:(?:[#>]+|[-*•]|\d+\.)\s+)+/, "");
  return sem !== t && leitor.acha(doc, sem) ? sem : t;
}
