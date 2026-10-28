/**
 * Módulo `ontologia` — a página /ontologia a partir das camadas de DNA dos especialistas do mega-brain.
 *
 * Gera (e só isto): data/ontologia/ontologia.yaml, no formato de docs/ontologia.md (lido por
 * lib/ontologia.ts). O módulo `ambiente`, que roda depois, liga BILHON_ONTOLOGIA_MANIFEST a ele.
 *
 * Fontes (somente leitura do mega-brain; todo arquivo passa por `lerTextoSeguro`):
 *   knowledge/<bucket>/dna/persons/<slug>/*.yaml   bucket ∈ {external, business}. `personal` NUNCA entra,
 *                                                  nem com --include-personal (a ontologia é uma tela só)
 *   .claude/CLAUDE.md                              tabela "DNA Schema (10 Layers)": descrição de cada camada
 *   engine/intelligence/rag/ontology_layer.py      hierarquia FILOSOFIA → … → METODOLOGIA: a única regra
 * Sem a tabela, a camada fica sem descrição; sem o .py, sem regra. Nada é escrito sem fonte.
 *
 * Manifesto:
 *   camada `especialistas`  um item por pasta de DNA: id = slug; nome = `pessoa`/`person` dos YAMLs que não
 *                           é o próprio slug (senão o slug); status = `review_status` do DNA-CONFIG;
 *                           dados = DNA-CONFIG (escalares e `composition.*`) + notas do `tone_profile`
 *   uma camada por camada de DNA com itens, na ordem L1…L10 (CAMADAS_DNA; id da camada = nome do arquivo).
 *   Cada item de DNA:
 *     id        `<especialista>/<id do YAML>` (o mesmo `fil_001` existe em vários especialistas). Sem id, id
 *               repetido no especialista ou longo demais: `<especialista>/<lista>-<posição>` (a partir de 1),
 *               contado em `idsDerivados` e avisado
 *     nome, descricao, status   o primeiro campo com valor da tabela da lista (LISTAS em CAMADAS_DNA);
 *               o status leva o rótulo do campo quando o valor é número ("confiança 0.8", "tier 1")
 *     fonte     `knowledge/<bucket>/dna/persons/<slug>/<arquivo>#<id do YAML>` (ou `#<lista>-<posição>`)
 *     dados     os demais campos da entrada, com o nome original (escalar ou lista de escalares, unida por
 *               " | "). Frase repetida em dois campos (`tension_a`/`lado_a`) entra uma vez; o campo do nome
 *               só fica de fora se o nome coube inteiro (ou está dentro da descrição)
 *     ligacoes  `de` → o especialista, sempre; e, para outro item de DNA, SÓ quando um campo `*_id`/`*_ids`
 *               da entrada traz o id de um item que existe no mesmo especialista (rótulo = nome do campo).
 *               `insight_ids`/`source_insight_ids`/`chunk_ids`/`source_ids` apontam para insights, trechos e
 *               fontes, que não são itens: ficam nos dados e não ligam nada (NAO_LIGA)
 *   `communication_patterns` do voice-dna não vira item (não é lista); `tone_profile` vai para os dados do
 *   especialista. Lista de entradas (mapas) de um YAML de DNA que nenhuma LISTA cobre fica fora e é avisada.
 *
 * Tetos: o manifesto já sai dentro dos tetos do leitor (LIMITES = os de lib/ontologia.ts), então o app não
 * descarta nada. O que passa é cortado aqui, de forma determinística, e CONTADO (`resumo.cortes` + aviso):
 * itens além de 2000 saem do fim (mesma ordem em que o leitor os contaria), ligações para itens cortados
 * saem, ligações e dados além de 50 por item saem do fim, e texto acima do limite termina em "…".
 *
 * Arquivo seu: o manifesto gerado leva `gerado_por: populate:ontologia` (o leitor ignora a chave). Um
 * data/ontologia/ontologia.{yaml,yml,json} sem essa marca é seu e manda: nada é gravado por cima dele, e o
 * que este módulo gravou antes sai (o `ambiente` escolhe o primeiro candidato que existir). Sem nenhum
 * especialista com DNA, o manifesto gerado antes é removido. Gravação atômica e só quando os bytes mudam.
 */
import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { ativarExclusoes, caminhoExcluido, lerTextoSeguro, log, writeText } from "./common.mjs";
import { descobrirEspecialistas } from "./especialistas.mjs";

const MODULO = "ontologia";
export const MARCA = "populate:ontologia";
export const ARQUIVO = "ontologia.yaml";
/** Os mesmos candidatos do módulo `ambiente` (ARQUIVOS_OPCIONAIS), na mesma ordem: o primeiro que existir vence. */
const CANDIDATOS = ["ontologia.yaml", "ontologia.yml", "ontologia.json"];

/** Tetos do leitor (MAX_* e T_* de lib/ontologia.ts). Acima deles o app descartaria em silêncio. */
export const LIMITES = {
  camadas: 50,
  itens: 2000,
  ligacoesPorItem: 50,
  dadosPorItem: 50,
  regras: 200,
  id: 120,
  rotulo: 120,
  descricao: 2000,
  status: 40,
  fonte: 300,
  dadoChave: 80,
  dadoValor: 1000,
};

/* ------------------------------------------------------------------ camadas */

/**
 * Como cada lista de um YAML de DNA vira item. `chaves`: nomes da MESMA lista (o MCE grava `patterns` e
 * `behavioral_patterns` como âncora YAML de uma lista só; vale a primeira não vazia). `nome`/`descricao`:
 * o primeiro campo com texto. `status`: [campo, rótulo], o primeiro com valor. `nomeComposto`: sem campo
 * de nome, os dois lados do paradoxo ("A × B"), cada lado pelo primeiro campo com texto.
 */
const ENTRADAS = { chaves: ["entries"], nome: ["name"], descricao: ["description"], status: [["confidence", "confiança"]] };

/** L1…L10 na ordem da tabela "DNA Schema (10 Layers)". `id` = nome do arquivo em dna/persons/<slug>/. */
export const CAMADAS_DNA = [
  { id: "filosofias", codigo: "L1", esquema: "PHILOSOPHIES", rotulo: "Filosofias", composicao: "FILOSOFIAS", listas: [ENTRADAS] },
  { id: "modelos-mentais", codigo: "L2", esquema: "MENTAL-MODELS", rotulo: "Modelos mentais", composicao: "MODELOS_MENTAIS", listas: [ENTRADAS] },
  { id: "heuristicas", codigo: "L3", esquema: "HEURISTICS", rotulo: "Heurísticas", composicao: "HEURISTICAS", listas: [ENTRADAS] },
  { id: "frameworks", codigo: "L4", esquema: "FRAMEWORKS", rotulo: "Frameworks", composicao: "FRAMEWORKS", listas: [ENTRADAS] },
  { id: "metodologias", codigo: "L5", esquema: "METHODOLOGIES", rotulo: "Metodologias", composicao: "METODOLOGIAS", listas: [ENTRADAS] },
  {
    id: "behavioral-patterns", codigo: "L6", esquema: "BEHAVIORAL-PATTERNS", rotulo: "Padrões de comportamento", composicao: "BEHAVIORAL_PATTERNS",
    listas: [{ chaves: ["patterns", "behavioral_patterns"], nome: ["pattern_name", "nome"], descricao: ["action", "resposta", "descricao"], status: [["priority", ""], ["prioridade", ""]] }],
  },
  {
    id: "values-hierarchy", codigo: "L7", esquema: "VALUES-HIERARCHY", rotulo: "Hierarquia de valores", composicao: "VALUES_HIERARCHY",
    listas: [{ chaves: ["values", "value_hierarchy"], nome: ["value", "nome"], descricao: ["evidence", "declaracao"], status: [["tier", "tier"]] }],
  },
  {
    id: "voice-dna", codigo: "L8", esquema: "VOICE-DNA", rotulo: "DNA de voz", composicao: null,
    listas: [
      { chaves: ["signature_phrases"], nome: ["phrase", "frase"], descricao: ["context", "usage_context"], status: [["poder", "poder"]] },
      { chaves: ["metaphors"], nome: ["metafora"], descricao: ["significado"], status: [["poder", "poder"]] },
      { chaves: ["immune_system"], nome: ["trigger"], descricao: ["response"], status: [["intensidade", "intensidade"]] },
      { chaves: ["behavioral_states"], nome: ["nome"], descricao: ["tom"], status: [] },
      // o termo próprio é o nome; o conceito comum que ele substitui, a descrição
      { chaves: ["vocabulary_transforms"], nome: ["transformacao"], descricao: ["conceito_comum"], status: [] },
    ],
  },
  {
    id: "obsessions", codigo: "L9", esquema: "OBSESSIONS", rotulo: "Obsessões", composicao: "OBSESSIONS",
    listas: [{ chaves: ["obsessions"], nome: ["obsession", "nome"], descricao: ["descricao"], status: [["status", ""], ["frequency", "frequência"]] }],
  },
  {
    id: "paradoxes", codigo: "L10", esquema: "PARADOXES", rotulo: "Paradoxos", composicao: "PARADOXES",
    listas: [{
      chaves: ["paradoxes"], nome: ["nome"], nomeComposto: [["tension_a", "lado_a"], ["tension_b", "lado_b"]],
      descricao: ["resolution", "resolucao"], status: [["status", ""]],
    }],
  },
];

const CAMADA_ESPECIALISTAS = "especialistas";
const ROTULO_DE = "de";
const REF = /_ids?$/;
/** Referências a insights, trechos e fontes do MCE: não são itens da ontologia, nunca viram ligação. */
const NAO_LIGA = /(?:^|_)(?:insight|chunk|source)_ids?$/;

/* ------------------------------------------------------------------ texto */

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const norm = (s) => String(s).replace(/\s+/g, " ").trim();

/** Escalar → texto aparado; lista de escalares → unida por " | "; objeto e lista de objetos → undefined. */
export function texto(v) {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  if (Array.isArray(v) && v.length && v.every((x) => x === null || typeof x !== "object" || x instanceof Date)) {
    const partes = v.map(texto).filter(Boolean);
    return partes.length ? partes.join(" | ") : undefined;
  }
  return undefined;
}

/** Corta em `max` code points (o leitor conta assim), terminando em "…", e conta o corte por campo. */
function cortar(valor, max, campo, cortes) {
  const cps = [...valor];
  if (cps.length <= max) return valor;
  cortes.textos[campo] = (cortes.textos[campo] ?? 0) + 1;
  return `${cps.slice(0, max - 1).join("").trimEnd()}…`;
}

const primeiro = (entrada, campos) => {
  for (const campo of campos) {
    const t = texto(entrada[campo]);
    if (t) return { campo, t };
  }
  return null;
};

/** Só as chaves com valor: o YAML sai enxuto. */
function sem(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/* ------------------------------------------------------------------ leitura */

async function lerYaml(repoRoot, rel, avisos) {
  const r = await lerTextoSeguro(path.join(repoRoot, ...rel.split("/")));
  if (r.motivo) {
    if (r.motivo !== "ausente") avisos.push(`${rel} ignorado (${r.motivo})`);
    return null;
  }
  try {
    return loadYaml(r.text);
  } catch (e) {
    avisos.push(`${rel} não é YAML válido (${String(e?.message ?? e).split("\n")[0]})`);
    return null;
  }
}

async function yamlsDaPasta(abs) {
  try {
    return (await readdir(abs, { withFileTypes: true }))
      .filter((e) => e.isFile() && !e.isSymbolicLink() && /\.ya?ml$/i.test(e.name) && !caminhoExcluido(path.join(abs, e.name)))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

const acharArquivo = (nomes, stem) =>
  nomes.find((n) => n.toLowerCase() === `${stem.toLowerCase()}.yaml`) ?? nomes.find((n) => n.toLowerCase() === `${stem.toLowerCase()}.yml`);

/**
 * Descrição de cada camada pela tabela "DNA Schema (10 Layers)" do CLAUDE.md do mega-brain:
 * Map("L1" → { esquema, texto, linha }) + o arquivo e o título da tabela. Sem a tabela, null.
 */
export async function lerEsquemaDna(repoRoot) {
  for (const rel of [".claude/CLAUDE.md", "CLAUDE.md"]) {
    const r = await lerTextoSeguro(path.join(repoRoot, ...rel.split("/")));
    if (r.motivo) continue;
    const linhas = r.text.split("\n");
    const ini = linhas.findIndex((l) => /DNA Schema \(10 Layers\)/.test(l));
    if (ini < 0) continue;
    let i = ini + 1;
    while (i < linhas.length && !linhas[i].trim()) i++;
    const camadas = new Map();
    for (; i < linhas.length && linhas[i].trim().startsWith("|"); i++) {
      const m = linhas[i].trim().match(/^\|\s*(L\d+)\s*\|\s*([A-Z][A-Z-]*)\s*\|\s*(.+?)\s*\|$/);
      if (m) camadas.set(m[1], { esquema: m[2], texto: m[3], linha: i + 1 });
    }
    if (camadas.size) return { rel, titulo: linhas[ini].trim().replace(/:$/, ""), camadas };
  }
  return null;
}

/** A hierarquia FILOSOFIA → … → METODOLOGIA do docstring de ontology_layer.py, com a frase que a apresenta. */
export async function lerRegraHierarquia(repoRoot) {
  const rel = "engine/intelligence/rag/ontology_layer.py";
  const r = await lerTextoSeguro(path.join(repoRoot, ...rel.split("/")));
  if (r.motivo) return null;
  const linhas = r.text.split("\n");
  const i = linhas.findIndex((l) => /^\s*FILOSOFIA\s*→.*→\s*METODOLOGIA\s*$/.test(l));
  if (i < 0) return null;
  // a frase são as linhas não vazias logo acima (até uma vazia, um sublinhado "====" ou as aspas do docstring)
  let j = i - 1;
  while (j >= 0 && !linhas[j].trim()) j--;
  const frase = [];
  for (; j >= 0 && linhas[j].trim() && !/^(?:[=\-]{3,}|"""|''')/.test(linhas[j].trim()); j--) frase.unshift(linhas[j].trim());
  const fonte = `fonte: ${rel}, linha ${i + 1}`;
  return { id: "hierarquia-dna", titulo: norm(linhas[i]), descricao: frase.length ? `${frase.join(" ")} (${fonte})` : fonte };
}

/* ------------------------------------------------------------------ itens */

/**
 * Item de DNA a partir de uma entrada do YAML. Devolve o item (sem ligações) e as referências
 * `*_id`/`*_ids` cruas, resolvidas depois que todos os itens do especialista existirem.
 */
function itemDaEntrada(entrada, def, ctxItem) {
  const { cortes, maisDeUmaLista, chave } = ctxItem;
  const usados = new Set(["id"]);
  const textosUsados = new Set();

  const desc = primeiro(entrada, def.descricao);
  if (desc) {
    usados.add(desc.campo);
    textosUsados.add(norm(desc.t));
  }

  let nome;
  const n = primeiro(entrada, def.nome);
  if (n) {
    nome = cortar(n.t, LIMITES.rotulo, "nome", cortes);
    // o campo do nome sai dos dados se coube inteiro ou se a descrição já o contém
    if (nome === n.t || (desc && norm(desc.t).includes(norm(n.t)))) {
      usados.add(n.campo);
      textosUsados.add(norm(n.t));
    }
  } else if (def.nomeComposto) {
    const lados = def.nomeComposto.map((campos) => primeiro(entrada, campos)?.t);
    if (lados.every(Boolean)) nome = cortar(lados.join(" × "), LIMITES.rotulo, "nome", cortes);
  }

  let status;
  for (const [campo, rotulo] of def.status) {
    const t = texto(entrada[campo]);
    if (!t) continue;
    status = cortar(rotulo && !/[A-Za-zÀ-ÿ]/.test(t) ? `${rotulo} ${t}` : t, LIMITES.status, "status", cortes);
    usados.add(campo);
    break;
  }

  const pares = maisDeUmaLista ? [["lista", chave]] : [];
  const refs = [];
  for (const [k, v] of Object.entries(entrada)) {
    if (REF.test(k) && !NAO_LIGA.test(k) && k !== "id") {
      for (const alvo of Array.isArray(v) ? v : [v]) {
        const t = texto(alvo);
        if (t) refs.push([k, t]);
      }
    }
    if (usados.has(k)) continue;
    const t = texto(v);
    if (t === undefined) continue;
    if (/\s/.test(t)) {
      const chaveTexto = norm(t);
      if (textosUsados.has(chaveTexto)) continue;
      textosUsados.add(chaveTexto);
    }
    pares.push([k, t]);
  }

  return {
    item: sem({
      nome,
      descricao: desc ? cortar(desc.t, LIMITES.descricao, "descricao", cortes) : undefined,
      status,
      dados: dadosLimitados(pares, cortes),
    }),
    refs,
  };
}

/** Pares → objeto `dados` dentro dos tetos do leitor (chave, valor, quantidade), com os cortes contados. */
function dadosLimitados(pares, cortes) {
  const out = {};
  let n = 0;
  for (const [k, v] of pares) {
    const chave = cortar(String(k).trim(), LIMITES.dadoChave, "dados.chave", cortes);
    if (!chave || chave === "__proto__" || chave in out) continue;
    if (n >= LIMITES.dadosPorItem) {
      cortes.dados++;
      continue;
    }
    out[chave] = cortar(v, LIMITES.dadoValor, "dados.valor", cortes);
    n++;
  }
  return n ? out : undefined;
}

/** Item da camada `especialistas`: nome dos YAMLs, status e dados do DNA-CONFIG, notas do tone_profile. */
function itemDoEspecialista({ espId, slug, bucket, base, docs, cfg }, cortes) {
  let nome = slug;
  let nomeDe;
  for (const d of [...CAMADAS_DNA.map((c) => docs.get(c.id)), cfg].filter(Boolean)) {
    const t = texto(obj(d.y)?.pessoa) ?? texto(obj(d.y)?.person);
    if (t && t !== slug) {
      nome = t;
      nomeDe = d.rel;
      break;
    }
  }
  const pares = [["bucket", bucket]];
  if (nomeDe) pares.push(["nome_de", nomeDe]);
  const c = obj(cfg?.y);
  let status;
  if (c) {
    for (const [k, v] of Object.entries(c)) {
      if (k === "pessoa" || k === "person") continue;
      if (k === "review_status" && texto(v)) {
        status = cortar(texto(v), LIMITES.status, "status", cortes);
        continue;
      }
      if (k === "composition" && obj(v)) {
        for (const [kk, vv] of Object.entries(v)) if (texto(vv)) pares.push([`composition.${kk}`, texto(vv)]);
        continue;
      }
      if (texto(v)) pares.push([k, texto(v)]);
    }
  }
  const tom = obj(obj(docs.get("voice-dna")?.y)?.tone_profile);
  for (const [traco, info] of Object.entries(tom ?? {})) {
    const nota = texto(obj(info)?.score);
    if (nota) pares.push([`tone_profile.${traco}`, nota]);
  }
  return sem({
    id: espId,
    nome: cortar(nome, LIMITES.rotulo, "nome", cortes),
    status,
    fonte: cortar(`${base}/`, LIMITES.fonte, "fonte", cortes),
    dados: dadosLimitados(pares, cortes),
  });
}

/* ------------------------------------------------------------------ manifesto */

/**
 * Lê o DNA dos especialistas e devolve o manifesto (objeto, pronto para o YAML) + as contagens.
 * Puro em relação ao disco do app: só lê o mega-brain.
 */
export async function montarOntologia(repoRoot, { avisos = [] } = {}) {
  const cortes = { itens: 0, ligacoes: 0, dados: 0, textos: {} };
  const esquema = await lerEsquemaDna(repoRoot);
  const camadas = CAMADAS_DNA.map((def) => {
    const linha = esquema?.camadas.get(def.codigo);
    let descricao;
    if (linha && linha.esquema === def.esquema) {
      descricao = `${linha.texto} (fonte: ${esquema.rel}, linha ${linha.linha}, tabela "${esquema.titulo}")`;
    } else if (linha) {
      avisos.push(`${esquema.rel}: a linha ${linha.linha} da tabela "${esquema.titulo}" chama ${def.codigo} de ${linha.esquema}, não ${def.esquema}: a camada ${def.id} fica sem descrição`);
    }
    return { def, saida: sem({ id: def.id, rotulo: `${def.codigo} · ${def.rotulo}`, descricao, itens: [] }) };
  });
  const camadaEsp = {
    id: CAMADA_ESPECIALISTAS,
    rotulo: "Especialistas",
    descricao: "Uma pessoa por pasta knowledge/<bucket>/dna/persons/<slug>/ do mega-brain (buckets external e business).",
    itens: [],
  };

  const meta = new Map(); // item → { esp } (para contar cortes por especialista)
  const pendentes = []; // { item, camada, esp, refs }
  const porEspecialista = {};
  const idsEsp = new Set();
  const derivados = new Map(); // "slug · arquivo#lista · motivo" → quantidade
  let idsDerivados = 0;

  for (const { slug, bucket } of await descobrirEspecialistas(repoRoot, { includePersonal: false })) {
    let espId = slug;
    if (idsEsp.has(espId)) {
      espId = `${bucket}-${slug}`;
      avisos.push(`${slug} existe em mais de um bucket: o de ${bucket} vira o especialista ${espId}`);
    }
    const base = `knowledge/${bucket}/dna/persons/${slug}`;
    const nomes = await yamlsDaPasta(path.join(repoRoot, ...base.split("/")));
    const docs = new Map();
    for (const def of CAMADAS_DNA) {
      const nome = acharArquivo(nomes, def.id);
      if (!nome) continue;
      const y = await lerYaml(repoRoot, `${base}/${nome}`, avisos);
      if (obj(y)) docs.set(def.id, { y, rel: `${base}/${nome}` });
      else if (y !== null) avisos.push(`${base}/${nome} não tem um mapa no topo: ignorado`);
    }
    const nomeCfg = acharArquivo(nomes, "DNA-CONFIG");
    const yCfg = nomeCfg ? await lerYaml(repoRoot, `${base}/${nomeCfg}`, avisos) : null;
    const cfg = obj(yCfg) ? { y: yCfg, rel: `${base}/${nomeCfg}` } : null;
    const conhecidos = new Set([...CAMADAS_DNA.map((c) => acharArquivo(nomes, c.id)), nomeCfg].filter(Boolean));
    const soltos = nomes.filter((n) => !conhecidos.has(n));
    if (soltos.length) avisos.push(`${base}: ${soltos.join(", ")} sem camada correspondente no manifesto (fora da ontologia)`);
    if (!docs.size && !cfg) {
      avisos.push(`${base}: nenhum YAML de DNA legível — especialista fora da ontologia`);
      continue;
    }
    idsEsp.add(espId);
    const itemEsp = itemDoEspecialista({ espId, slug, bucket, base, docs, cfg }, cortes);
    camadaEsp.itens.push(itemEsp);
    meta.set(itemEsp, { esp: slug });

    const contagem = {};
    const indice = new Map(); // id do YAML → { camada, id } | null (o mesmo id em duas camadas: ambíguo)
    for (const { def, saida } of camadas) {
      const doc = docs.get(def.id);
      if (!doc) continue;
      const idsDaCamada = new Set();
      let nItens = 0;
      for (const lista of def.listas) {
        let chave = null;
        let entradas = null;
        for (const k of lista.chaves) {
          const v = doc.y[k];
          if (!Array.isArray(v) || !v.length) continue;
          if (!entradas) {
            chave = k;
            entradas = v;
          } else if (v !== entradas && JSON.stringify(v) !== JSON.stringify(entradas)) {
            avisos.push(`${doc.rel}: a lista ${k} difere de ${chave}; vale ${chave}`);
          }
        }
        if (!entradas) continue;
        let invalidas = 0;
        entradas.forEach((bruta, i) => {
          const entrada = obj(bruta);
          if (!entrada) {
            invalidas++;
            return;
          }
          const pos = i + 1;
          const original = typeof entrada.id === "string" || typeof entrada.id === "number" ? texto(entrada.id) : undefined;
          let id = original ? `${espId}/${original}` : undefined;
          const motivo = !original ? "sem id" : [...id].length > LIMITES.id ? "id longo demais" : idsDaCamada.has(id) ? "id repetido" : null;
          if (motivo) {
            const raiz = `${espId}/${chave}-${pos}`;
            id = raiz;
            for (let n = 2; idsDaCamada.has(id); n++) id = `${raiz}~${n}`;
            idsDerivados++;
            const k = `${slug}: ${doc.rel.split("/").pop()}#${chave} — ${motivo}`;
            derivados.set(k, (derivados.get(k) ?? 0) + 1);
          }
          idsDaCamada.add(id);
          const { item, refs } = itemDaEntrada(entrada, lista, { cortes, maisDeUmaLista: def.listas.length > 1, chave });
          const completo = sem({
            id,
            ...item,
            fonte: cortar(`${doc.rel}#${motivo ? `${chave}-${pos}` : original}`, LIMITES.fonte, "fonte", cortes),
          });
          // ordem das chaves no YAML: id, nome, descricao, status, fonte, dados, ligacoes
          const ordenado = sem({
            id: completo.id, nome: completo.nome, descricao: completo.descricao, status: completo.status,
            fonte: completo.fonte, dados: completo.dados, ligacoes: [{ camada: CAMADA_ESPECIALISTAS, item: espId, rotulo: ROTULO_DE }],
          });
          saida.itens.push(ordenado);
          meta.set(ordenado, { esp: slug });
          pendentes.push({ item: ordenado, camada: def.id, refs });
          if (!motivo) indice.set(original, indice.has(original) ? null : { camada: def.id, id });
          nItens++;
        });
        if (invalidas) avisos.push(`${doc.rel}: ${invalidas} entrada(s) de ${chave} não são mapas: ignoradas`);
      }
      // lista de entradas que nenhuma LISTA da camada cobre: fica fora, mas não em silêncio
      const mapeadas = new Set(def.listas.flatMap((l) => l.chaves));
      for (const [k, v] of Object.entries(doc.y)) {
        if (mapeadas.has(k) || !Array.isArray(v) || !v.some((e) => obj(e))) continue;
        avisos.push(`${doc.rel}: a lista ${k} (${v.length} entrada(s)) não tem mapeamento para a camada ${def.id}: fora da ontologia`);
      }
      contagem[def.id] = nItens;
      const declarado = def.composicao ? obj(cfg?.y?.composition)?.[def.composicao] : undefined;
      if (typeof declarado === "number" && declarado !== nItens) {
        avisos.push(`${slug}: DNA-CONFIG declara ${def.composicao}=${declarado}, ${doc.rel.split("/").pop()} tem ${nItens} item(ns)`);
      }
    }
    for (const def of CAMADAS_DNA) {
      const declarado = def.composicao ? obj(cfg?.y?.composition)?.[def.composicao] : undefined;
      if (!docs.has(def.id) && typeof declarado === "number" && declarado > 0) {
        avisos.push(`${slug}: DNA-CONFIG declara ${def.composicao}=${declarado}, mas não há ${def.id}.yaml`);
      }
    }
    // referências explícitas `*_id`/`*_ids` a outro item do MESMO especialista
    for (const p of pendentes.filter((x) => meta.get(x.item)?.esp === slug && x.refs.length)) {
      const vistas = new Set();
      for (const [campo, alvoOriginal] of p.refs) {
        const alvo = indice.get(alvoOriginal);
        if (alvo === null) {
          avisos.push(`${slug}: ${campo} "${alvoOriginal}" existe em mais de uma camada: ligação não criada`);
          continue;
        }
        if (!alvo || (alvo.camada === p.camada && alvo.id === p.item.id)) continue;
        const chave = `${alvo.camada}\u0000${alvo.id}\u0000${campo}`;
        if (vistas.has(chave)) continue;
        vistas.add(chave);
        p.item.ligacoes.push({ camada: alvo.camada, item: alvo.id, rotulo: cortar(campo, LIMITES.rotulo, "ligacoes.rotulo", cortes) });
      }
    }
    porEspecialista[slug] = { id: espId, nome: itemEsp.nome, bucket, itens: contagem, total: Object.values(contagem).reduce((a, b) => a + b, 0) };
  }
  for (const [k, n] of derivados) avisos.push(`${k}: ${n} id(s) derivado(s) da posição (<especialista>/<lista>-<posição>)`);

  // tetos do leitor: itens além de 2000 saem do fim, na ordem em que o leitor os contaria
  const todas = [camadaEsp, ...camadas.map((c) => c.saida)];
  const cortadosPorCamada = {};
  let orcamento = LIMITES.itens;
  for (const c of todas) {
    if (c.itens.length > orcamento) {
      const fora = c.itens.slice(orcamento);
      cortadosPorCamada[c.id] = fora.length;
      cortes.itens += fora.length;
      for (const it of fora) {
        const info = porEspecialista[meta.get(it)?.esp];
        if (info) info.cortados = (info.cortados ?? 0) + 1;
      }
      c.itens = c.itens.slice(0, orcamento);
    }
    orcamento -= c.itens.length;
  }
  if (cortes.itens) {
    avisos.push(`${cortes.itens} item(ns) acima do teto de ${LIMITES.itens} do leitor ficaram fora do manifesto (${Object.entries(cortadosPorCamada).map(([c, n]) => `${c}: ${n}`).join(", ")})`);
  }
  const existe = new Set(todas.flatMap((c) => c.itens.map((i) => `${c.id}\u0000${i.id}`)));
  for (const c of todas) {
    for (const it of c.itens) {
      if (!it.ligacoes) continue;
      const validas = it.ligacoes.filter((l) => existe.has(`${l.camada}\u0000${l.item}`));
      cortes.ligacoes += it.ligacoes.length - validas.length;
      if (validas.length > LIMITES.ligacoesPorItem) cortes.ligacoes += validas.length - LIMITES.ligacoesPorItem;
      it.ligacoes = validas.slice(0, LIMITES.ligacoesPorItem);
      if (!it.ligacoes.length) delete it.ligacoes;
    }
  }
  if (cortes.ligacoes) avisos.push(`${cortes.ligacoes} ligação(ões) fora do manifesto (alvo cortado ou acima de ${LIMITES.ligacoesPorItem} por item)`);
  if (cortes.dados) avisos.push(`${cortes.dados} dado(s) acima de ${LIMITES.dadosPorItem} por item ficaram fora do manifesto`);
  const textos = Object.entries(cortes.textos);
  if (textos.length) avisos.push(`textos acima do limite do leitor cortados com "…": ${textos.map(([c, n]) => `${c} ${n}`).join(", ")}`);

  const regra = await lerRegraHierarquia(repoRoot);
  const regras = regra
    ? [{ id: regra.id, titulo: cortar(regra.titulo, LIMITES.rotulo, "regra.titulo", cortes), descricao: cortar(regra.descricao, LIMITES.descricao, "regra.descricao", cortes) }]
    : [];
  const camadasSaida = todas.filter((c) => c.itens.length);
  const manifesto = {
    gerado_por: MARCA,
    titulo: "DNA dos especialistas",
    camadas: camadasSaida,
    ...(regras.length ? { regras } : {}),
  };
  const porCamada = Object.fromEntries(camadasSaida.map((c) => [c.id, c.itens.length]));
  return {
    manifesto,
    stats: {
      especialistas: camadaEsp.itens.length,
      camadas: camadasSaida.length,
      itens: camadasSaida.reduce((t, c) => t + c.itens.length, 0),
      ligacoes: camadasSaida.reduce((t, c) => t + c.itens.reduce((u, i) => u + (i.ligacoes?.length ?? 0), 0), 0),
      porCamada,
      camadasVazias: camadas.filter((c) => !c.saida.itens.length).map((c) => c.def.id),
      porEspecialista,
      regras: regras.length,
      idsDerivados,
      cortes,
      fontes: {
        descricoesDasCamadas: esquema ? `${esquema.rel} (${esquema.titulo})` : null,
        regras: regra ? regra.descricao.slice(regra.descricao.lastIndexOf("fonte: ") + 7).replace(/\)$/, "") : null,
      },
    },
  };
}

const CABECALHO = [
  "# Ontologia do DNA dos especialistas — GERADA por `npm run populate` (scripts/populate/ontologia.mjs).",
  "# Fonte: knowledge/<bucket>/dna/persons/<slug>/*.yaml do mega-brain (external e business; personal nunca entra).",
  "# Cada item traz `fonte` = arquivo do mega-brain (relativo à raiz) + \"#<id>\"; nada aqui é escrito à mão.",
  "# Reescrito a cada execução. Para editar, copie para outro nome e aponte BILHON_ONTOLOGIA_MANIFEST para",
  "# a cópia numa linha sua do .env.local (fora do bloco do populate). Formato: docs/ontologia.md.",
  "",
].join("\n");

/** Texto do arquivo: cabeçalho + YAML. Sem data nem aleatório: a mesma entrada dá os mesmos bytes. */
export function renderizar(manifesto) {
  return CABECALHO + dumpYaml(manifesto, { lineWidth: -1, noRefs: true, sortKeys: false });
}

/** O arquivo foi gravado por este módulo? (YAML/JSON com `gerado_por: populate:ontologia`; ilegível = não.) */
async function ehNosso(abs) {
  try {
    return obj(loadYaml(await readFile(abs, "utf8")))?.gerado_por === MARCA;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ run */

export default async function run(ctx) {
  ativarExclusoes(ctx);
  const avisos = [];
  if (ctx.opts?.includePersonal) avisos.push("--include-personal não vale para a ontologia: knowledge/personal nunca entra no manifesto");
  const { manifesto, stats } = await montarOntologia(ctx.repoRoot, { avisos });

  const dir = path.join(ctx.dataDir, "ontologia");
  const alvo = path.join(dir, ARQUIVO);
  // Só ontologia.yaml é gravado aqui. Um .yml/.json com a marca é cópia sua (herdou o gerado_por):
  // conta como seu e nunca é apagado.
  const seus = [];
  for (const nome of CANDIDATOS) {
    const abs = path.join(dir, nome);
    if (existsSync(abs) && (nome !== ARQUIVO || !(await ehNosso(abs)))) seus.push(nome);
  }
  const removerNossos = async () => {
    if (seus.includes(ARQUIVO) || !existsSync(alvo) || !(await ehNosso(alvo))) return false;
    await rm(alvo, { force: true });
    return true;
  };

  let acao;
  if (seus.length) {
    const removido = await removerNossos();
    acao = "preservado-arquivo-seu";
    avisos.push(
      `data/ontologia/${seus.join(", data/ontologia/")} não tem gerado_por: ${MARCA} (é seu) e manda: a ontologia do DNA não foi gravada` +
        `${removido ? " e a que este módulo gravou antes foi removida" : ""}. Para usar a gerada, renomeie o seu arquivo e rode de novo.`,
    );
  } else if (!stats.itens) {
    acao = (await removerNossos()) ? "removido" : "sem-dna";
    avisos.push("nenhum especialista com DNA em knowledge/{external,business}/dna/persons/: ontologia não gerada");
  } else {
    const novo = renderizar(manifesto);
    const atual = existsSync(alvo) ? await readFile(alvo, "utf8") : null;
    if (atual === novo) acao = "sem-mudanca";
    else {
      await writeText(alvo, novo);
      acao = atual === null ? "criado" : "atualizado";
    }
  }

  log(
    MODULO,
    `${acao}: ${stats.especialistas} especialista(s), ${stats.camadas} camada(s), ${stats.itens} itens, ${stats.ligacoes} ligações` +
      ` (${Object.entries(stats.porCamada).map(([c, n]) => `${c} ${n}`).join(", ")})`,
  );
  return { resumo: { arquivo: `data/ontologia/${ARQUIVO}`, acao, ...stats }, avisos };
}
