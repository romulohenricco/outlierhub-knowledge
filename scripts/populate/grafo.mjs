/**
 * Módulo `grafo` — extrai um grafo de conhecimento REAL do mega-brain, sem LLM,
 * sem rede e sem relógio, e grava `data/kg/livros-kg.sqlite` (+ layout).
 *
 * De onde vêm os conceitos (sempre de ESTRUTURA declarada no repositório):
 *   - `.claude/CLAUDE.md`: Constituição (14 artigos), fases do pipeline MCE, camadas
 *     DNA L1..L10, camadas do workspace L0..L4 (+ regra de precedência), regras
 *     "atom-*", eventos/hooks, buckets de conhecimento, tipos de agente, comandos,
 *     hierarquia de governança;
 *   - glossários (`engine/glossary`, `engine/jarvis/glossary`): termos de negócio
 *     com sinônimos, "Relacionado", "NÃO confundir com" e papéis combinados;
 *   - cadeias com seta ("A → B → C") e listas numeradas escritas nos documentos
 *     (fluxo de dados, navegação KSL, ciclo de story, camadas Synapse, composição…);
 *   - squad `orquestrador-global` (squad.yaml, config.yaml, agent-registry.yaml,
 *     tasks, workflows), Conclave e registry de agentes;
 *   - skills em disco e diretivas `EXECUTE /comando` dos comandos slash.
 *
 * Regras de qualidade e vocabulário de confiança/peso: ver `_extracao.mjs`.
 * Relações usadas (rel): menciona · parte_de · precede · depende_de · usa ·
 * governa · sobrepoe · navega_para · executado_por · relacionado_a · nao_confundir_com.
 * Nenhuma relação nasce de coocorrência pura: toda aresta entre conceitos carrega
 * um trecho literal que a declara (linha de tabela/registro, cadeia com seta,
 * lista numerada, campo YAML ou frase explícita).
 *
 * Saída: `data/kg/livros-kg.sqlite` (nodes/edges/evidences), `data/kg/graph-layout.json`
 * (via scripts/graph-layout.mjs) e `data/kg/populate-grafo.json` (manifesto próprio:
 * hashes, contagens e regras; é por ele que a regeneração reconhece o que gerou). O campo
 * `raiz` (repositório lido, relativo à pasta do manifesto) é o que o leitor do app
 * (lib/kg.ts, `raizDoGrafo`) usa para datar as fontes `yt-<coleção>:<caminho>`.
 *
 * Deep-link "ir pro trecho no livro": o Leitor do app só destaca o trecho se os 50 primeiros
 * caracteres couberem num único nó de texto do HTML renderizado. Por isso cada janela de evidência
 * é ajustada (sempre uma substring do documento que continua contendo a âncora) e, entre
 * ocorrências de mesma confiança, a que o Leitor consegue destacar vence (ver `_extracao.mjs`).
 * Linhas de tabela e âncoras entre dois trechos de código não têm janela destacável: ficam como
 * estão e o manifesto informa quantas evidências o Leitor destaca.
 *
 * Regeneração segura com o app aberto: o SQLite só é substituído se o conteúdo lógico mudou; a troca
 * tenta rename com espera, depois a API de backup do SQLite, e nunca deixa temporário para trás.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { promisify } from "node:util";
import { load } from "js-yaml";
import { ativarExclusoes, ensureDir, log, openSqlite, readJsonSafe, sha256, slugify, toPosix, writeJson } from "./common.mjs";
import { extrairInsightsMce } from "./especialistas.mjs";
import {
  CONF, Grafo, MAX_TRECHO, acharAdjacenciaSeta, acharLinha, blocoCodigoApos, criarCorpus, escRe,
  limpa, regexTermo, tabelasMd,
} from "./_extracao.mjs";

const execFileP = promisify(execFile);
const VERSAO_EXTRATOR = "1.1.0";
const CL = ".claude/CLAUDE.md";
const SQ = "squads/orquestrador-global";

/* ------------------------------------------------------------------ utilidades locais */

function docOuAviso(g, rel) {
  const d = g.c.doc(rel);
  if (!d) g.aviso(`documento ausente: ${rel} — extração correspondente pulada`);
  return d;
}

/** Primeira linha de cada documento canônico em que reA e reB casam juntas. */
function coLinhas(g, reA, reB, { ignorar = null, so = null } = {}) {
  const out = [];
  for (const d of g.c.docs) {
    if (g.c.canon(d) !== d) continue;
    if (ignorar && ignorar.test(d.rel)) continue;
    if (so && !so.test(d.rel)) continue;
    const L = d.text.split("\n");
    for (let i = 0; i < L.length; i++) {
      const a = reA.exec(L[i]);
      if (!a) continue;
      const b = reB.exec(L[i]);
      if (!b) continue;
      const ini = Math.min(a.index, b.index);
      const fim = Math.max(a.index + a[0].length, b.index + b[0].length);
      out.push({ doc: d, n: i, texto: L[i], ini, len: fim - ini });
      break;
    }
  }
  return out;
}

const tituloCase = (s) =>
  s.toLowerCase().replace(/(^|[\s(/-])([a-zà-ú])/g, (_, a, b) => a + b.toUpperCase());

function itemDeLista(doc, chave, nome) {
  const L = doc.text.split("\n");
  const i0 = L.findIndex((l) => new RegExp(`^\\s*${escRe(chave)}:\\s*(#.*)?$`).test(l));
  if (i0 === -1) return null;
  const ind = L[i0].match(/^\s*/)[0].length;
  const re = new RegExp(`^\\s*-\\s*(?:id:\\s*|name:\\s*)?['"]?${escRe(nome)}['"]?\\s*(#.*)?$`);
  for (let i = i0 + 1; i < L.length; i++) {
    const l = L[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const indL = l.match(/^\s*/)[0].length;
    if (indL <= ind && !/^\s*-/.test(l)) break;
    if (re.test(l)) return { n: i, texto: l };
  }
  return null;
}

/* ------------------------------------------------------------------ cadeias de setas e listas */

/**
 * Declara uma cadeia ordenada. `cfg.nos`: { chave-slug: {id, label, adj:[aliases]} } (várias
 * chaves podem apontar para o mesmo nó). Cada `fonte` fornece as linhas/itens; cada par
 * adjacente vira uma relação com o trecho literal que o declara. Em seguida os OUTROS
 * documentos são varridos atrás do mesmo par "A → B". Coesão: se alguma relação da cadeia
 * é sustentada por >= 2 documentos distintos, a cadeia toda é considerada confirmada e seus
 * nós ficam (a cadeia é uma declaração coerente, não pares soltos).
 */
function cadeia(g, cfg) {
  const idx = new Map();
  for (const [chaves, no] of cfg.nos) for (const k of chaves.split(",")) idx.set(slugify(k), no);
  const pares = new Map();
  const todosNos = new Map();
  const no = (n) => {
    todosNos.set(n.id, n);
    g.conceito(n.id, {
      label: n.label, origem: cfg.origem, estrutural: Boolean(cfg.estrutural),
      mencionavel: Boolean(n.exatos || n.aliases), aliases: n.aliases, exatos: n.exatos, topK: n.topK,
    });
  };
  const par = (a, b, doc, trecho, regra, conf) => {
    if (a.id === b.id) return;
    no(a); no(b);
    pares.set(`${a.id}|${b.id}`, [a, b]);
    g.suporte(a.id, cfg.rel, b.id, { doc, trecho, regra, confianca: conf });
  };

  for (const f of cfg.fontes) {
    const doc = g.c.doc(f.rel);
    if (!doc) { g.aviso(`cadeia ${cfg.nome}: documento ausente ${f.rel}`); continue; }
    if (f.itens) {
      // lista ordenada: [{label, linha}] — trecho = duas linhas adjacentes
      const itens = f.itens(doc);
      if (!itens) { g.aviso(`cadeia ${cfg.nome}: lista não encontrada em ${f.rel}`); continue; }
      const nos = itens.map((it) => idx.get(slugify((f.limparItem ?? limpa)(it.label))) ?? null);
      for (let i = 0; i + 1 < itens.length; i++) {
        if (!nos[i] || !nos[i + 1]) continue;
        par(nos[i], nos[i + 1], doc, `${itens[i].linha} ${itens[i + 1].linha}`, "lista-ordenada", CONF.cadeia);
      }
      continue;
    }
    const L = doc.text.split("\n");
    for (const l of L) {
      if (!f.re.test(l)) continue;
      const cap = f.captura ? l.match(f.captura) : null;
      if (f.captura && !cap) continue;
      const txt = cap ? cap[1] : l;
      const base = l.indexOf(txt);
      const segs = [];
      let ult = 0;
      for (const m of txt.matchAll(/\s*(?:→|──→|─→|-->|->|=>)\s*/g)) {
        segs.push({ raw: txt.slice(ult, m.index), ini: ult });
        ult = m.index + m[0].length;
      }
      segs.push({ raw: txt.slice(ult), ini: ult });
      const nos = segs.map((s) => idx.get(slugify((f.limparItem ?? partesLimpa)(s.raw))) ?? null);
      for (let i = 0; i + 1 < segs.length; i++) {
        if (!nos[i] || !nos[i + 1]) continue;
        const a = base + segs[i].ini;
        const b = base + segs[i + 1].ini + segs[i + 1].raw.length;
        par(nos[i], nos[i + 1], doc, g.janela(doc, l, a, b - a), "cadeia-explicita", CONF.cadeia);
      }
    }
  }

  // os mesmos pares escritos em outros documentos
  if (cfg.varrer !== false) {
    for (const [, [a, b]] of pares) {
      const hits = acharAdjacenciaSeta(g.c, a.adj ?? [a.label], b.adj ?? [b.label], { gap: cfg.gap ?? 14, ignorar: cfg.ignorarDocs });
      for (const h of hits) {
        if (cfg.exigir && !cfg.exigir.test(h.texto)) continue; // o mesmo par pode ter outro sentido em outro contexto
        g.suporte(a.id, cfg.rel, b.id, {
          doc: h.doc, trecho: g.janela(h.doc, h.texto, h.ini, h.len), regra: "cadeia-em-outro-documento", confianca: CONF.coocorrencia,
        });
      }
    }
  }

  // coesão da cadeia
  let confirmada = false;
  for (const [, [a, b]] of pares) {
    if ((g.rels.get(`${a.id}\u0000${cfg.rel}\u0000${b.id}`)?.suportes.size ?? 0) >= 2) confirmada = true;
  }
  if (confirmada) for (const n of todosNos.values()) g.conceito(n.id, { estrutural: true });
  return { nos: [...todosNos.values()], pares: [...pares.values()], confirmada };
}

const partesLimpa = (p) =>
  limpa(p).replace(/\s*\([^)]*\)\s*$/g, "").replace(/^\[|\]$/g, "").replace(/[.;:,]+$/g, "").trim();

/* ------------------------------------------------------------------ .claude/CLAUDE.md */

function extrairClaudeMd(g) {
  const doc = docOuAviso(g, CL);
  if (!doc) return;
  const O = "claude-md";
  const tabs = tabelasMd(doc);
  const tab = (h0, h1) => tabs.find((t) => t.header[0] === h0 && (h1 === undefined || t.header[1] === h1));
  const sup = (src, rel, dst, trecho, regra, conf = CONF.catalogo) =>
    g.suporte(src, rel, dst, { doc, trecho, regra, confianca: conf });

  /* ---- Constituição (Art. I..XIV) ---- */
  const HUB_CONST = "constituicao-mega-brain";
  g.conceito(HUB_CONST, {
    label: "Constituição do Mega Brain", origem: O, estrutural: true, mencionavel: true,
    aliases: ["Mega Brain Constitution"], excluirDocs: /^engine\/jarvis\//, topK: 5,
  });
  const tc = tab("Article");
  const artigos = [];
  if (tc) {
    for (const r of tc.rows) {
      const [romano, princ] = r.cells.map(limpa);
      const id = `art-${romano.toLowerCase()}-${slugify(princ)}`;
      g.conceito(id, {
        label: `Art. ${romano} — ${princ}`, origem: O, estrutural: true, mencionavel: true,
        exatos: [`Art. ${romano}`, `Art.${romano}`, `Article ${romano}`], aliases: [princ],
        excluirDocs: /^engine\/jarvis\//, topK: 4,
      });
      sup(id, "parte_de", HUB_CONST, r.linha, "catalogo-tabela-constituicao");
      artigos.push({ id, romano });
    }
    // outros documentos que citam "Constitution ... Art. N" na mesma linha (membership repetido)
    for (const a of artigos) {
      const hits = coLinhas(
        g, /Constitution|Constitui[cç][aã]o/i, new RegExp(`(?<![\\w])Art(?:\\.|icle)\\s?${a.romano}(?![\\w])`),
        { ignorar: /^engine\/jarvis\// },
      );
      for (const h of hits) {
        if (h.doc.rel === CL) continue;
        g.suporte(a.id, "parte_de", HUB_CONST, {
          doc: h.doc, trecho: g.janela(h.doc, h.texto, h.ini, h.len), regra: "coocorrencia-constituicao-artigo", confianca: CONF.coocorrencia,
        });
      }
    }
  } else g.aviso("CLAUDE.md: tabela da Constituição não encontrada");

  /* ---- Pipeline MCE ---- */
  const PIPE = "pipeline-mce";
  g.conceito(PIPE, {
    label: "Pipeline MCE", origem: O, estrutural: true, mencionavel: true,
    aliases: ["Pipeline MCE", "MCE Pipeline"], exatos: ["MCE"], topK: 5,
  });
  const MENCAO_FASE = { "Ingestion Guard": ["Ingestion Guard"], "RAG Indexation": ["RAG Indexation"], "GraphRAG Index": ["GraphRAG"] };
  const tp = tab("Phase", "Name");
  if (tp) {
    const intro = acharLinha(doc, /6 sequential, blocking phases/);
    const fases = tp.rows.map((r) => {
      const fase = (r.cells[0].match(/^[\d.]+b?/) ?? [""])[0];
      const nome = limpa(r.cells[1]);
      return { r, fase, nome, opcional: /opt-in/i.test(r.cells[0]), id: `mce-fase-${fase.replace(".", "-")}-${slugify(nome)}` };
    });
    for (const f of fases) {
      g.conceito(f.id, {
        label: `Fase ${f.fase} — ${f.nome}${f.opcional ? " (opcional)" : ""}`, origem: O, estrutural: true,
        mencionavel: Boolean(MENCAO_FASE[f.nome]), aliases: MENCAO_FASE[f.nome], topK: 3,
      });
      sup(f.id, "parte_de", PIPE, f.r.linha, "catalogo-tabela-pipeline");
    }
    const obrig = fases.filter((f) => !f.opcional);
    for (let i = 0; i + 1 < obrig.length; i++) {
      const a = obrig[i];
      const b = obrig[i + 1];
      const adjacentes = b.r.n === a.r.n + 1;
      if (adjacentes) sup(a.id, "precede", b.id, `${a.r.linha} ${b.r.linha}`, "tabela-ordenada-linhas-adjacentes", CONF.cadeia);
      else if (intro) sup(a.id, "precede", b.id, intro.texto, "tabela-ordenada-fases-sequenciais", CONF.cadeia - 0.1);
    }
  } else g.aviso("CLAUDE.md: tabela do pipeline MCE não encontrada");

  /* ---- Camadas DNA L1..L10 ---- */
  const DNA = "dna-schema";
  g.conceito(DNA, {
    label: "Esquema DNA (10 camadas)", origem: O, estrutural: true, mencionavel: true,
    aliases: ["DNA Schema", "DNA layers", "camadas DNA"], topK: 5,
  });
  const td = tab("Layer", "Name");
  if (td) {
    for (const r of td.rows) {
      const camada = limpa(r.cells[0]);
      const nome = limpa(r.cells[1]);
      const id = `dna-${camada.toLowerCase()}-${slugify(nome)}`;
      const re = new RegExp(`(?<![\\w])${escRe(camada)}[\\s:()\\u2014\\u2013|*\`-]{0,6}${escRe(nome)}(?![\\w])`, "i");
      g.conceito(id, {
        label: `DNA ${camada} — ${tituloCase(nome)}`, origem: O, estrutural: true, mencionavel: true, padroes: [re],
        agulhas: [nome], topK: 3,
      });
      sup(id, "parte_de", DNA, r.linha, "catalogo-tabela-dna");
      for (const h of coLinhas(g, re, /DNA/, { so: /\.(md|yaml|yml)$/ })) {
        if (h.doc.rel === CL) continue;
        g.suporte(id, "parte_de", DNA, {
          doc: h.doc, trecho: g.janela(h.doc, h.texto, h.ini, h.len), regra: "coocorrencia-camada-dna", confianca: CONF.coocorrencia,
        });
      }
    }
  } else g.aviso("CLAUDE.md: tabela das camadas DNA não encontrada");

  /* ---- Camadas do workspace L0..L4 e regra de precedência ---- */
  const WS = "workspace";
  g.conceito(WS, { label: "Workspace (L0–L4)", origem: O, estrutural: true, mencionavel: true, aliases: ["workspace layers"], topK: 4 });
  const bloco = blocoCodigoApos(doc, /^##\s+Workspace \(L0-L4\)/);
  const wsIds = {};
  if (bloco) {
    for (const l of bloco) {
      const m = l.texto.match(/^\s*(L\d)-([a-z]+)\/\s*\(TTL:\s*(\d+d)\)/);
      if (!m) continue;
      const id = `ws-${m[1].toLowerCase()}-${m[2]}`;
      wsIds[m[1]] = id;
      g.conceito(id, {
        label: `Workspace ${m[1]} — ${m[2]} (TTL ${m[3]})`, origem: O, estrutural: true, mencionavel: true,
        exatos: [`${m[1]}-${m[2]}`], topK: 3,
      });
      sup(id, "parte_de", WS, l.texto, "catalogo-bloco-workspace");
    }
    const regra = acharLinha(doc, /^Golden Rule: L0 > L1 > L2 > L3 > L4/);
    if (regra) {
      const camadas = ["L0", "L1", "L2", "L3", "L4"];
      const outros = coLinhas(g, /L0\s*>\s*L1\s*>\s*L2\s*>\s*L3\s*>\s*L4/, /Golden Rule|override|sobrep/i);
      for (let i = 0; i + 1 < camadas.length; i++) {
        const a = wsIds[camadas[i]];
        const b = wsIds[camadas[i + 1]];
        if (!a || !b) continue;
        sup(a, "sobrepoe", b, regra.texto, "regra-de-ouro-explicita", CONF.cadeia);
        for (const h of outros) {
          g.suporte(a, "sobrepoe", b, {
            doc: h.doc, trecho: g.janela(h.doc, h.texto, h.ini, h.len), regra: "regra-de-ouro-em-outro-documento", confianca: CONF.coocorrencia,
          });
        }
      }
    }
  } else g.aviso("CLAUDE.md: bloco do workspace não encontrado");

  /* ---- Atom rules ---- */
  const ATOM = "atom-rules";
  g.conceito(ATOM, { label: "Atom Rules (regras sob demanda)", origem: O, estrutural: true, mencionavel: true, aliases: ["Atom Rules"], topK: 4 });
  const ta = tab("Atom");
  if (ta) {
    for (const r of ta.rows) {
      const nome = limpa(r.cells[0]);
      const id = nome; // já é atom-<assunto>
      g.conceito(id, {
        label: `${nome} — ${limpa(r.cells[1])}`, origem: O, estrutural: true, mencionavel: true, exatos: [nome], topK: 3,
      });
      sup(id, "parte_de", ATOM, r.linha, "catalogo-tabela-atoms");
    }
  } else g.aviso("CLAUDE.md: tabela das atom rules não encontrada");

  /* ---- Hooks (eventos + hooks-chave) ---- */
  const HOOKS = "hooks";
  g.conceito(HOOKS, { label: "Hooks", origem: O, estrutural: true, mencionavel: false });
  const th = tab("Event");
  if (th) {
    for (const r of th.rows) {
      const evento = limpa(r.cells[0]);
      const idEv = `hook-evento-${slugify(evento)}`;
      g.conceito(idEv, {
        label: `Evento ${evento}`, origem: O, estrutural: true,
        mencionavel: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"].includes(evento),
        exatos: [evento], topK: 3,
      });
      sup(idEv, "parte_de", HOOKS, r.linha, "catalogo-tabela-hooks");
      for (const nomeHook of limpa(r.cells[2]).split(",").map((s) => s.trim()).filter(Boolean)) {
        const arq = ["py", "sh", "js"].map((e) => `.claude/hooks/${nomeHook}.${e}`).find((p) => g.c.doc(p));
        if (!arq) { g.aviso(`hook "${nomeHook}" listado no CLAUDE.md sem arquivo em .claude/hooks/`); continue; }
        const idH = `hook-${slugify(nomeHook)}`;
        g.conceito(idH, { label: `${nomeHook} (hook)`, origem: O, estrutural: true, mencionavel: true, exatos: [nomeHook], topK: 3 });
        sup(idH, "parte_de", idEv, r.linha, "catalogo-tabela-hooks");
        // o código do hook também declara o evento em que roda (linha que cita o evento E fala de hook/gatilho/evento)
        const src = g.c.doc(arq);
        const reEvento = new RegExp(`(?<![\\w])${escRe(evento)}(?![\\w])`);
        const lin = g.c.linhas(src).map((texto, n) => ({ n, texto })).find((l) => reEvento.test(l.texto) && /hook|trigger|event|gatilho/i.test(l.texto));
        if (lin) g.suporte(idH, "parte_de", idEv, { doc: src, trecho: lin.texto, regra: "codigo-do-hook-declara-evento", confianca: CONF.coocorrencia });
      }
    }
  } else g.aviso("CLAUDE.md: tabela de hooks não encontrada");

  /* ---- Knowledge buckets ---- */
  const KB = "knowledge-base";
  g.conceito(KB, { label: "Base de conhecimento (3 buckets)", origem: O, estrutural: true, mencionavel: true, aliases: ["Knowledge Architecture"], topK: 4 });
  const tk = tab("Bucket");
  const bucketId = {};
  if (tk) {
    for (const r of tk.rows) {
      const nome = limpa(r.cells[0]).toLowerCase();
      const id = `bucket-${nome}`;
      bucketId[nome] = id;
      g.conceito(id, {
        label: `Bucket ${limpa(r.cells[0])}`, origem: O, estrutural: true, mencionavel: true,
        exatos: [limpa(r.cells[1]).replace(/\/$/, "")], topK: 3,
      });
      sup(id, "parte_de", KB, r.linha, "catalogo-tabela-buckets");
    }
    const iso = acharLinha(doc, /Buckets are \*\*isolated\*\*/);
    const artXiii = artigos.find((a) => a.romano === "XIII");
    if (iso && artXiii) sup(artXiii.id, "governa", KB, iso.texto, "frase-explicita-isolamento", CONF.cadeia);
  } else g.aviso("CLAUDE.md: tabela de buckets não encontrada");

  /* ---- Agentes por tipo ---- */
  const AG = "agentes-mega-brain";
  g.conceito(AG, { label: "Agentes do Mega Brain", origem: O, estrutural: true });
  const tg = tab("Type", "Path");
  const tipoAg = {};
  if (tg) {
    for (const r of tg.rows) {
      const tipo = limpa(r.cells[0]);
      const id = `agentes-tipo-${slugify(tipo)}`;
      tipoAg[tipo.toLowerCase()] = id;
      g.conceito(id, { label: `Agentes ${tipo}`, origem: O, estrutural: true });
      sup(id, "parte_de", AG, r.linha, "catalogo-tabela-agentes");
      const b = limpa(r.cells[2]).match(/knowledge\/(external|business|personal)\//);
      if (b && bucketId[b[1]]) sup(id, "depende_de", bucketId[b[1]], r.linha, "coluna-source-da-tabela", CONF.catalogo);
    }
    const sys = tg.rows.find((r) => /^System$/i.test(limpa(r.cells[0])));
    if (sys) {
      for (const nome of limpa(sys.cells[3]).split(",").map((s) => s.trim()).filter(Boolean)) {
        const id = slugify(nome); // jarvis, conclave
        g.conceito(id, {
          label: nome, origem: O, estrutural: true, mencionavel: true,
          aliases: nome === "Conclave" ? ["Conclave"] : [], exatos: nome === "JARVIS" ? ["JARVIS", "Jarvis"] : [], topK: 5,
        });
        sup(id, "parte_de", tipoAg.system, sys.linha, "coluna-example-da-tabela");
      }
    }
  } else g.aviso("CLAUDE.md: tabela de agentes não encontrada");

  /* ---- Comandos slash da tabela ---- */
  const CMDS = "comandos-slash";
  g.conceito(CMDS, { label: "Comandos slash do Mega Brain", origem: O, estrutural: true });
  const tcm = tab("Command");
  if (tcm) {
    for (const r of tcm.rows) {
      const nome = limpa(r.cells[0]); // /jarvis-briefing
      const id = `cmd-${slugify(nome)}`;
      g.conceito(id, { label: nome, origem: O, estrutural: true, mencionavel: true, exatos: [nome], topK: 3 });
      sup(id, "parte_de", CMDS, r.linha, "catalogo-tabela-comandos");
    }
  }

  /* ---- Hierarquia de governança (setas em bloco de código) ---- */
  const bh = blocoCodigoApos(doc, /^##\s+Governance Hierarchy/);
  if (bh) {
    const mapa = {
      "Constitution": [HUB_CONST], "CLAUDE.md": ["claude-md"], "Atom Rules": [ATOM], "Synapse Engine": ["synapse-engine"],
      "Hooks": [HOOKS], "Skills": ["skills"], "Squads": ["squads"], "Workspace + Knowledge": [WS, KB],
    };
    const ROT = {
      "claude-md": "CLAUDE.md", "synapse-engine": "Synapse Engine", "skills": "Skills", "squads": "Squads", "hooks": "Hooks",
    };
    const niveis = bh
      .map((l) => ({ ...l, rot: l.texto.replace(/^\s*→?\s*/, "").replace(/\s*\(.*$/, "").trim() }))
      .filter((l) => l.rot);
    for (const nv of niveis) {
      for (const id of mapa[nv.rot] ?? []) {
        g.conceito(id, { label: ROT[id] ?? id, origem: O, estrutural: true });
      }
    }
    g.conceito("synapse-engine", { mencionavel: true, exatos: ["SYNAPSE"], aliases: ["Synapse Engine"], topK: 4 });
    g.conceito("skills", { label: "Skills", origem: O, estrutural: true });
    for (let i = 0; i + 1 < niveis.length; i++) {
      const A = mapa[niveis[i].rot];
      const B = mapa[niveis[i + 1].rot];
      if (!A || !B) { g.aviso(`hierarquia de governança: nível desconhecido "${niveis[i].rot}" ou "${niveis[i + 1].rot}"`); continue; }
      for (const a of A) for (const b of B) {
        sup(a, "governa", b, `${niveis[i].texto} ${niveis[i + 1].texto}`, "hierarquia-de-governanca-com-setas", CONF.cadeia);
      }
    }
  } else g.aviso("CLAUDE.md: bloco da hierarquia de governança não encontrado");
}

/* ------------------------------------------------------------------ glossário */

function extrairGlossario(g) {
  const arquivos = g.c.docs.filter(
    (d) => /^engine\/(jarvis\/)?glossary\/(sales|marketing|operations|finance|digital)\.md$/.test(d.rel) && g.c.canon(d) === d,
  );
  if (!arquivos.length) { g.aviso("glossário não encontrado"); return; }
  const SIGLA = /^[A-Z0-9]{2,6}$/;
  const SOLTAS = new Set(["MULTIPLE", "LAUNCH", "COMP", "COMPENSATION", "TROLL"]); // comuns demais para casar sozinhas
  const ACRONIMOS = new Set(["MEDDIC", "EBITDA", "SAAS"]);
  /** Como cada apelido do verbete é procurado no texto (sigla = exato; frase = sem diferenciar caixa; palavra solta = exato, MAIÚSCULA/Capitalizada). */
  const termosDe = (a) => {
    if (a.length < 3 || SOLTAS.has(a.toUpperCase())) return { frases: [], exatos: [] };
    if (/[\s-]/.test(a)) return { frases: [a], exatos: [] };
    if (/^[A-Z0-9]+$/.test(a)) return { frases: [], exatos: a.length >= 5 && !ACRONIMOS.has(a) ? [a, tituloCase(a)] : [a] };
    return { frases: [], exatos: [a, a.toUpperCase()] };
  };

  const verbetes = [];
  for (const d of arquivos) {
    const L = d.text.split("\n");
    for (let i = 0; i < L.length; i++) {
      const m = L[i].match(/^###\s+(.+?)\s*$/);
      if (!m) continue;
      // o verbete vai até o próximo cabeçalho (qualquer nível <= 3)
      let fim = i + 1;
      while (fim < L.length && !/^#{1,3}\s/.test(L[fim])) fim++;
      verbetes.push({ d, L, n: i, fim, h: m[1] });
    }
  }

  // parse do cabeçalho
  const iniciais = (frase) => frase.split(/[\s-]+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase();
  for (const v of verbetes) {
    const h0 = v.h.replace(/\s+-\s+\w+$/, ""); // "QC (Quality Control) - Sales"
    v.siglas = [];
    v.parens = [];
    const h = h0.replace(/\(([^)]*)\)/g, (_, p) => {
      const t = p.trim();
      if (SIGLA.test(t)) v.siglas.push(t);
      v.parens.push(t);
      return " ";
    });
    const partes = h.split("/").map((s) => s.trim()).filter(Boolean);
    v.principal = partes[0];
    // "QC (Quality Control)": o parêntese é a EXPANSÃO quando as iniciais dele formam a sigla
    v.expansoes = v.parens.filter((p) => !SIGLA.test(p) && /\s/.test(p) && iniciais(p) === v.principal.toUpperCase());
    v.aliases = [...new Set([...partes, ...v.siglas, ...v.expansoes])];
    v.parenNaoSigla = v.parens.filter((p) => !SIGLA.test(p) && !v.expansoes.includes(p));
    v.idBase = slugify(v.principal);
  }
  // colisões: variante com parêntese informativo vira id próprio; sem parêntese funde (ex.: LTV)
  const porId = new Map();
  for (const v of verbetes) porId.set(v.idBase, [...(porId.get(v.idBase) ?? []), v]);
  for (const [id, grupo] of porId) {
    for (const v of grupo) {
      v.variante = grupo.length > 1 && v.parenNaoSigla.length ? v.parenNaoSigla[0] : null;
      v.id = v.variante ? `${id}-${slugify(v.variante)}` : id;
    }
  }

  const bonito = (s) => (/^[A-Z0-9 &.-]+$/.test(s) && !/^[A-Z0-9]{2,5}$/.test(s) && !ACRONIMOS.has(s) ? tituloCase(s) : s);
  const rotulo = (v) => {
    const p = v.principal;
    let base;
    if (/^[A-Z0-9]{2,5}$/.test(p)) {
      // sigla: "BDR — Business Development Representative"
      const exp = [...v.expansoes, ...v.aliases.slice(1)].find((a) => a.length > 6 && !SIGLA.test(a));
      base = exp ? `${p} — ${bonito(exp)}` : p;
    } else if (v.siglas.length) {
      base = `${v.siglas[0]} — ${bonito(p)}`; // "LNS — Lead Nurture Specialist"
    } else {
      // palavra isolada com um nome composto equivalente ("LAUNCH / Product Launch")
      const composto = v.aliases.slice(1).find((a) => /\s/.test(a) && a.toLowerCase().split(/\s+/).includes(p.toLowerCase()));
      base = bonito(composto ?? p);
    }
    return v.variante ? `${base} (${v.variante})` : base;
  };

  const resolver = new Map(); // alias normalizado → id
  const norma = (s) => slugify(s);
  for (const v of verbetes) {
    const exatos = [];
    const frases = [];
    for (const a of v.aliases) {
      const t = termosDe(a);
      frases.push(...t.frases);
      exatos.push(...t.exatos);
    }
    g.conceito(v.id, {
      label: rotulo(v), origem: "glossario", mencionavel: true, aliases: frases, exatos, topK: 5,
    });
    for (const a of v.aliases) if (!resolver.has(norma(a))) resolver.set(norma(a), v.id);
    // definição: cabeçalho + primeiras linhas do verbete (contíguas)
    const corpoLinhas = v.L.slice(v.n, Math.min(v.fim, v.n + 6)).join(" ");
    g.definicao(v.id, v.d, corpoLinhas, "verbete-do-glossario");
  }

  // relações declaradas no verbete
  for (const v of verbetes) {
    for (let i = v.n + 1; i < v.fim; i++) {
      const l = v.L[i];
      let m = l.match(/\*\*Relacionado\*\*:\s*(.+)$/);
      if (m) {
        for (const alvo of m[1].split(/[,;]/)) {
          const id = resolver.get(norma(alvo.replace(/\([^)]*\)/g, "").trim()));
          if (id && id !== v.id) g.suporte(v.id, "relacionado_a", id, { doc: v.d, trecho: l, regra: "campo-relacionado-do-verbete", confianca: CONF.catalogo });
        }
      }
      m = l.match(/\*\*N[ÃA]O confundir com\*\*:\s*(.+)$/i);
      if (m) {
        const texto = m[1].replace(/\([^)]*\)/g, " ");
        const vistos = new Set();
        for (const x of verbetes) {
          if (x.id === v.id || vistos.has(x.id)) continue;
          const c = g.conceitos.get(x.id);
          const achou =
            c.exatos.some((a) => regexTermo(a, { exato: true }).test(texto)) ||
            c.aliases.some((a) => regexTermo(a, { exato: false }).test(texto));
          if (achou) {
            vistos.add(x.id);
            g.suporte(v.id, "nao_confundir_com", x.id, { doc: v.d, trecho: l, regra: "campo-nao-confundir-do-verbete", confianca: CONF.catalogo });
          }
        }
      }
      m = l.match(/[Cc]ombinado de ((?:[A-Z][A-Z0-9]+)(?:\s*\+\s*[A-Z][A-Z0-9]+)+)/);
      if (m) {
        for (const parte of m[1].split(/\s*\+\s*/)) {
          const id = resolver.get(norma(parte));
          if (id && id !== v.id) g.suporte(id, "parte_de", v.id, { doc: v.d, trecho: l, regra: "papel-combinado-do-verbete", confianca: CONF.catalogo });
        }
      }
    }
  }

  // funil de vendas: BDR → SDS → Closer (setas em outros documentos, aliases do próprio glossário)
  const aliasDe = (id) => verbetes.filter((v) => v.id === id).flatMap((v) => v.aliases).filter((a) => a.length >= 2);
  const funil = [["bdr", "sds"], ["sds", "closer"]];
  for (const [a, b] of funil) {
    if (!g.conceitos.has(a) || !g.conceitos.has(b)) continue;
    const hits = acharAdjacenciaSeta(g.c, aliasDe(a), aliasDe(b), { gap: 24, exato: true });
    for (const h of hits) {
      g.suporte(a, "precede", b, { doc: h.doc, trecho: g.janela(h.doc, h.texto, h.ini, h.len), regra: "funil-com-setas", confianca: CONF.cadeia });
    }
  }
}

/* ------------------------------------------------------------------ cadeias */

function extrairCadeias(g) {
  const N = (id, label, adj, extra = {}) => ({ id, label, adj, ...extra });

  /* ---- fluxo de dados do pipeline de conhecimento ---- */
  const src = N("source", "Source (fonte)", ["SOURCE", "Source"]);
  const transcript = N("transcript", "Transcript", ["Transcript"]);
  const chunk = N("chunk", "Chunks", ["CHUNKS", "Chunks", "CHUNK", "Chunk"]);
  const entity = N("entity", "Entities", ["Entities", "ENTITIES"]);
  const insight = N("insight", "Insights", ["INSIGHTS", "Insights", "INSIGHT", "Insight"]);
  const narrative = N("narrative", "Narratives", ["NARRATIVES", "Narratives", "NARRATIVE", "Narrative"]);
  const dossier = N("dossier", "Dossiers", ["DOSSIERS", "Dossiers", "DOSSIER", "Dossier"]);
  const agente = N("agent", "Agents", ["AGENTS", "Agents"]);
  const agMem = N("agent-memory", "Agent Memories", ["Agent Memories", "MEMORYs", "MEMORIES"]);
  cadeia(g, {
    nome: "fluxo-de-dados", rel: "precede", origem: "cadeia-fluxo-de-dados", gap: 10,
    nos: [
      ["source", src], ["transcript", transcript], ["chunks,chunk", chunk], ["entities,entity", entity],
      ["insights,insight", insight], ["narratives,narrative", narrative], ["dossier,dossiers", dossier],
      ["agents", agente], ["agent-memories,memorys,memories", agMem],
    ],
    fontes: [
      { rel: "engine/templates/logs/LOG-TEMPLATES.md", re: /CHAIN:\s*SOURCE/, captura: /CHAIN:\s*(.+)$/ },
      { rel: "engine/jarvis/protocols/CONSTITUTION.md", re: /Chunks \(upstream\) →/, captura: /(Chunks \(upstream\).*)$/ },
      { rel: "engine/jarvis/protocols/CONSTITUTION.md", re: /pipeline \(Chunks → Entities/, captura: /\((Chunks → Entities[^)]*)\)/ },
      { rel: "engine/jarvis/protocols/system/ENFORCEMENT.md", re: /^Transcript → Chunks → Entities/, captura: /^(Transcript.*)$/ },
    ],
  });

  /* ---- ativação KSL (agent.md → soul.md → dna-config.yaml → memory.md) ---- */
  const kAgent = N("ksl-agent-md", "agent.md", ["AGENT", "agent.md"]);
  const kSoul = N("ksl-soul-md", "soul.md", ["SOUL", "soul.md"]);
  const kDna = N("ksl-dna-config", "dna-config.yaml", ["DNA-CONFIG", "dna-config.yaml", "dna-config"]);
  const kMem = N("ksl-memory-md", "memory.md", ["MEMORY", "memory.md"]);
  cadeia(g, {
    nome: "ksl-ativacao", rel: "precede", origem: "cadeia-ksl-ativacao", gap: 6, estrutural: false, exigir: /boot|Carregar|Load|activation|ativa/i,
    nos: [["agent,agent-md", kAgent], ["soul,soul-md", kSoul], ["dna-config,dna-config-yaml", kDna], ["memory,memory-md", kMem]],
    fontes: [
      {
        rel: CL,
        itens: (doc) => {
          const L = doc.text.split("\n");
          const out = [];
          for (const l of L) {
            const m = l.match(/^\d+\.\s+Load `([^`]+)`/);
            if (m) out.push({ label: m[1].replace(/\.(md|yaml)$/, ""), linha: l });
          }
          return out.length >= 2 ? out : null;
        },
      },
      { rel: "engine/jarvis/protocols/ORQUESTRACAO-PROTOCOL.md", re: /^\s*Carregar:\s*AGENT/, captura: /Carregar:\s*(.+)$/ },
    ],
  });

  /* ---- navegação KSL e níveis de dossiê (navega_para) ---- */
  const dnaS = N("dna-schema", "Esquema DNA (10 camadas)", ["DNA"]);
  cadeia(g, {
    nome: "ksl-navegacao", rel: "navega_para", origem: "cadeia-ksl-navegacao", gap: 6, exigir: /Navigation chain|Navega[cç]/i,
    nos: [
      ["agent", kAgent], ["soul", kSoul], ["memory", kMem], ["dna", dnaS], ["insights", insight], ["chunks", chunk], ["source", src],
    ],
    fontes: [{ rel: CL, re: /^Navigation chain:/, captura: /chain:\s*(.+)$/ }],
  });
  const canonical = N("canonical", "Canonical", ["CANONICAL", "Canonical"]);
  cadeia(g, {
    nome: "niveis-de-dossie", rel: "navega_para", origem: "cadeia-niveis-de-dossie", gap: 6, exigir: /N[IÍ]VEIS|Navega[cç]/i,
    nos: [["dossier", dossier], ["narrative", narrative], ["insight", insight], ["canonical", canonical], ["chunk", chunk]],
    fontes: [
      {
        rel: "engine/jarvis/protocols/company/COMPANY-ENRICHMENT-PROTOCOL.md", re: /NÍVEIS \(DOSSIER →/,
        captura: /\(([^()]*DOSSIER →[^()]*)\)/, limparItem: (p) => partesLimpa(p).replace(/^lê\s+/i, ""),
      },
    ],
  });

  /* ---- ciclo de desenvolvimento por story (SDC) e fluxos de autoridade ---- */
  const ag = (a) => N(`agente-${a}`, `@${a}`, [`@${a}`]);
  const [sm, po, dev, qa, devops, pm, arch, de] = ["sm", "po", "dev", "qa", "devops", "pm", "architect", "data-engineer"].map(ag);
  const soAgente = (p) => (limpa(p).match(/@[\w-]+/) ?? [""])[0];
  const nosAg = [["@sm", sm], ["@po", po], ["@dev", dev], ["@qa", qa], ["@devops", devops], ["@pm", pm], ["@architect", arch], ["@data-engineer", de]];
  for (const [, n] of nosAg) {
    g.conceito(n.id, { label: n.label, origem: "agent-authority", estrutural: true, mencionavel: true, exatos: n.adj, topK: 3 });
  }
  cadeia(g, {
    nome: "sdc", rel: "precede", origem: "cadeia-sdc", gap: 40, estrutural: true,
    nos: nosAg,
    fontes: [
      { rel: ".claude/rules/agent-authority.md", re: /^@sm \*draft →/, limparItem: soAgente },
      { rel: ".claude/rules/agent-authority.md", re: /^@pm \*create-epic →/, limparItem: soAgente },
      { rel: ".claude/rules/agent-authority.md", re: /^@architect \(decides technology\) →/, limparItem: soAgente },
    ],
  });
  // quem pode o quê: tabela de autoridades exclusivas
  const aa = g.c.doc(".claude/rules/agent-authority.md");
  if (aa) {
    const HUB = "autoridade-de-agentes";
    g.conceito(HUB, { label: "Autoridade exclusiva dos agentes", origem: "agent-authority", estrutural: true, mencionavel: true, aliases: ["Agent Authority"], exatos: ["agent-authority"], topK: 4 });
    const t = tabelasMd(aa).find((x) => x.header[0] === "Agent");
    for (const r of t?.rows ?? []) {
      const nome = limpa(r.cells[0]);
      const id = nome === "@mega-brain-master" ? "agente-mega-brain-master" : `agente-${nome.replace(/^@/, "")}`;
      g.conceito(id, { label: nome, origem: "agent-authority", estrutural: true, mencionavel: true, exatos: [nome], topK: 3 });
      g.suporte(id, "parte_de", HUB, { doc: aa, trecho: r.linha, regra: "catalogo-tabela-autoridades", confianca: CONF.catalogo });
    }
  }

  /* ---- ciclo de vida da story ---- */
  const st = (k, l, a) => N(`story-${k}`, `Story: ${l}`, a);
  const sd = st("draft", "Draft", ["Draft"]);
  const sr = st("ready", "Ready", ["Ready"]);
  const sp = st("inprogress", "InProgress", ["InProgress"]);
  const si = st("inreview", "InReview", ["InReview"]);
  const sn = st("done", "Done", ["Done"]);
  cadeia(g, {
    nome: "story-lifecycle", rel: "precede", origem: "cadeia-story-lifecycle", varrer: false, estrutural: true,
    nos: [["draft", sd], ["ready", sr], ["inprogress", sp], ["inreview", si], ["done", sn]],
    fontes: [{ rel: ".claude/rules/story-lifecycle.md", re: /^Draft → Ready →/ }],
  });
  const sl = g.c.doc(".claude/rules/story-lifecycle.md");
  if (sl) {
    const t = tabelasMd(sl).find((x) => x.header[0] === "Status");
    const resp = { Draft: "sm", Ready: "po", InProgress: "dev", InReview: "qa", Done: "devops" };
    for (const r of t?.rows ?? []) {
      const status = limpa(r.cells[0]);
      const idSt = `story-${status.toLowerCase()}`;
      const a = limpa(r.cells[2]).replace(/^@/, "");
      if (g.conceitos.has(idSt) && resp[status] === a && g.conceitos.has(`agente-${a}`)) {
        g.suporte(idSt, "executado_por", `agente-${a}`, { doc: sl, trecho: r.linha, regra: "tabela-de-transicoes-coluna-agent", confianca: CONF.catalogo });
      }
    }
  }

  /* ---- estados de documento do workspace ---- */
  const ws = (k) => N(`wsdoc-${k.toLowerCase()}`, `Documento do workspace: ${k}`, [k]);
  const estados = ["PLACEHOLDER", "DRAFT", "POPULATED", "VALIDATED", "APPROVED", "STALE", "ARCHIVED"].map(ws);
  cadeia(g, {
    nome: "workspace-doc-estados", rel: "precede", origem: "cadeia-workspace-doc-estados", varrer: false, estrutural: true,
    nos: estados.map((n) => [n.adj[0], n]),
    fontes: [{ rel: ".claude/rules/workspace-docs.md", re: /\*\*States:\*\*/, captura: /States:\*\*\s*(.+)$/ }],
  });

  /* ---- camadas Synapse L0..L7 ---- */
  const syn = (n, nome) => N(`synapse-l${n}-${slugify(nome)}`, `Synapse L${n} — ${nome}`, [`L${n} ${nome}`]);
  const camS = [[0, "Constitution"], [1, "Global"], [2, "Agent"], [3, "Workflow"], [4, "Task"], [5, "Squad"], [6, "Keyword"], [7, "Star-Command"]].map(([n, nome]) => syn(n, nome));
  const rSyn = cadeia(g, {
    nome: "synapse-camadas", rel: "precede", origem: "cadeia-synapse-camadas", gap: 6, estrutural: true,
    nos: camS.map((n) => [n.adj[0], n]),
    fontes: [{ rel: ".claude/skills/synapse/references/layers.md", re: /^L0 Constitution →/ }],
  });
  const syl = g.c.doc(".claude/skills/synapse/references/layers.md");
  if (syl && rSyn.nos.length) {
    g.conceito("synapse-engine", { label: "Synapse Engine", origem: "synapse-layers", estrutural: true, mencionavel: true, aliases: ["Synapse Engine"], exatos: ["SYNAPSE"], topK: 4 });
    const l = acharLinha(syl, /^L0 Constitution →/);
    for (const n of rSyn.nos) g.suporte(n.id, "parte_de", "synapse-engine", { doc: syl, trecho: l.texto, regra: "cadeia-de-camadas-do-engine", confianca: CONF.cadeia });
  }

  /* ---- composição MEGABRAIN ---- */
  const cp = (k) => N(`composicao-${k.toLowerCase()}`, k, [k]);
  const comp = ["Token", "Atom", "Molecule", "Organism", "Template", "Instance"].map(cp);
  const rComp = cadeia(g, {
    nome: "composicao", rel: "precede", origem: "cadeia-composicao", gap: 4, estrutural: true,
    nos: comp.map((n) => [n.adj[0], n]),
    fontes: [{ rel: CL, re: /^Token → Atom → Molecule/ }],
  });
  if (rComp.nos.length) {
    g.conceito("composicao-megabrain", { label: "Composição MEGABRAIN", origem: "cadeia-composicao", estrutural: true, mencionavel: true, aliases: ["MEGABRAIN Composition"], topK: 3 });
    const d = g.c.doc(CL);
    const l = acharLinha(d, /^Token → Atom → Molecule/);
    for (const n of rComp.nos) g.suporte(n.id, "parte_de", "composicao-megabrain", { doc: d, trecho: l.texto, regra: "cadeia-de-composicao", confianca: CONF.cadeia });
  }

  /* ---- cascata de raciocínio ---- */
  const rc = (k, adj) => N(`raciocinio-${slugify(k)}`, tituloCase(k), adj);
  const casc = [
    rc("metodologia", ["METODOLOGIA", "Metodologia"]), rc("framework", ["FRAMEWORK", "Framework"]),
    rc("heuristica", ["HEURISTICA", "Heurística", "Heuristica"]), rc("modelo mental", ["MODELO MENTAL", "Modelo Mental"]),
    rc("filosofia", ["FILOSOFIA", "Filosofia"]),
  ];
  cadeia(g, {
    nome: "cascata-de-raciocinio", rel: "precede", origem: "cadeia-cascata-de-raciocinio", gap: 4,
    nos: [["metodologia", casc[0]], ["framework", casc[1]], ["heuristica", casc[2]], ["modelo-mental", casc[3]], ["filosofia", casc[4]]],
    fontes: [{ rel: ".claude/commands/ask.md", re: /^METODOLOGIA → FRAMEWORK/ }],
  });

  /* ---- maturidade de orquestração (ontology_spine) ---- */
  const mt = (k, l, adj) => N(`orq-${k}`, l, adj);
  const spine = [
    mt("demanda", "Demanda", ["Demanda"]), mt("classificacao", "Classificação", ["Classificacao", "Classificação"]),
    mt("orquestracao", "Orquestração", ["Orquestracao", "Orquestração"]), mt("gate-review", "Gate Review", ["Gate Review"]),
    mt("consolidacao", "Consolidação", ["Consolidacao", "Consolidação"]), mt("melhoria", "Melhoria", ["Melhoria"]),
  ];
  cadeia(g, {
    nome: "maturidade-orquestracao", rel: "precede", origem: "cadeia-maturidade-orquestracao", gap: 4,
    nos: [["demanda", spine[0]], ["classificacao", spine[1]], ["orquestracao", spine[2]], ["gate-review,gate_review", spine[3]], ["consolidacao", spine[4]], ["melhoria", spine[5]]],
    fontes: [
      {
        rel: `${SQ}/config.yaml`,
        itens: (doc) => {
          const L = doc.text.split("\n");
          const i0 = L.findIndex((l) => /^\s*ontology_spine:\s*$/.test(l));
          if (i0 === -1) return null;
          const out = [];
          for (let i = i0 + 1; i < L.length && /^\s*-\s+\S/.test(L[i]); i++) out.push({ label: L[i].replace(/^\s*-\s+/, "").trim(), linha: L[i] });
          return out.length >= 2 ? out : null;
        },
      },
      { rel: `${SQ}/knowledge/ORCHESTRATION-MATURITY-FRAMEWORK.md`, re: /^Demanda --> Classificacao/ },
    ],
  });
}

/* ------------------------------------------------------------------ squad orquestrador-global */

function extrairSquad(g) {
  const sy = docOuAviso(g, `${SQ}/squad.yaml`);
  if (!sy) return;
  let y;
  try { y = load(sy.text); } catch (e) { g.aviso(`squad.yaml inválido: ${String(e.message).slice(0, 80)}`); return; }
  const cfg = g.c.doc(`${SQ}/config.yaml`);
  const reg = g.c.doc(`${SQ}/agent-registry.yaml`);
  const squadId = "squad-orquestrador-global";
  g.conceito(squadId, {
    label: "Squad orquestrador-global", origem: "squad-yaml", estrutural: true, mencionavel: true,
    exatos: ["orquestrador-global"], topK: 5,
  });
  const comp = y?.components ?? {};
  const registro = (id, rel, doc, trecho, regra, conf) => g.suporte(id, "parte_de", squadId, { doc, trecho, regra, confianca: conf });

  /* agentes */
  const agentes = (comp.agents ?? []).map(String);
  for (const a of agentes) {
    const id = `orq-agente-${slugify(a)}`;
    g.conceito(id, { label: `${a} (agente)`, origem: "squad-yaml", estrutural: true, mencionavel: a.includes("-"), exatos: [a], topK: 3 });
    const it = itemDeLista(sy, "agents", a);
    if (it) registro(id, "parte_de", sy, it.texto, "lista-components-agents-do-squad-yaml", CONF.catalogo);
    else g.aviso(`agente "${a}" em components.agents sem linha localizável no squad.yaml`);
    if (cfg) {
      const l = acharLinha(cfg, new RegExp(`^\\s*-\\s*id:\\s*${escRe(a)}\\s*$`));
      if (l) registro(id, "parte_de", cfg, l.texto, "lista-agents-do-config-yaml", CONF.catalogo);
    }
    if (reg) {
      const l = acharLinha(reg, new RegExp(`^\\s*id:\\s*${escRe(a)}\\s*$`));
      if (l) registro(id, "parte_de", reg, l.texto, "agent-registry-do-squad", CONF.catalogo);
    }
    const proj = g.c.doc(`.claude/agents/orquestrador-global--${a}.md`);
    if (proj) {
      const l = acharLinha(proj, new RegExp(`^name:\\s*orquestrador-global--${escRe(a)}\\s*$`));
      if (l) registro(id, "parte_de", proj, l.texto, "projecao-claude-code-do-agente", CONF.coocorrencia);
    }
    if (!g.c.doc(`${SQ}/agents/${a}.md`)) g.aviso(`agente "${a}" listado no squad.yaml sem agents/${a}.md`);
  }

  /* tasks e workflows: lista do squad.yaml + arquivos existentes */
  const familias = [
    ["task", "tasks", comp.tasks ?? []],
    ["workflow", "workflows", comp.workflows ?? []],
  ];
  const idPorNome = {};
  for (const [tipo, pasta, lista] of familias) {
    const nomes = new Set(lista.map(String));
    for (const d of g.c.docs) {
      const m = d.rel.match(new RegExp(`^${escRe(SQ)}/${pasta}/([^/]+)\\.(md|ya?ml)$`));
      if (m) nomes.add(m[1]);
    }
    for (const nome of [...nomes].sort()) {
      const id = `orq-${tipo}-${slugify(nome)}`;
      idPorNome[`${tipo}:${nome}`] = id;
      g.conceito(id, { label: `${nome} (${tipo})`, origem: "squad-yaml", estrutural: true, mencionavel: true, exatos: [nome], topK: 2 });
      if (lista.map(String).includes(nome)) {
        const it = itemDeLista(sy, pasta, nome);
        if (it) registro(id, "parte_de", sy, it.texto, `lista-components-${pasta}-do-squad-yaml`, CONF.catalogo);
      }
      const arquivo = ["md", "yaml", "yml"].map((e) => g.c.doc(`${SQ}/${pasta}/${nome}.${e}`)).find(Boolean);
      if (arquivo) {
        const l = acharLinha(arquivo, /^\s*squad:\s*['"]?orquestrador-global['"]?\s*(#.*)?$/) ?? acharLinha(arquivo, /\*\*Squad:\*\*\s*orquestrador-global/);
        if (l) registro(id, "parte_de", arquivo, l.texto, `campo-squad-do-arquivo-de-${tipo}`, CONF.catalogo);
      } else {
        g.aviso(`${tipo} "${nome}" listado no squad.yaml sem arquivo em ${pasta}/ (referência quebrada)`);
      }
      if (cfg) {
        const l = itemDeLista(cfg, pasta, nome);
        if (l) registro(id, "parte_de", cfg, l.texto, `lista-${pasta}-do-config-yaml`, CONF.catalogo);
      }
      // task → agente responsável
      if (tipo === "task" && arquivo) {
        const l = acharLinha(arquivo, /^responsavel:\s*['"]?@([\w-]+)['"]?\s*$/);
        const alvo = l?.texto.match(/@([\w-]+)/)?.[1];
        if (alvo && agentes.includes(alvo)) {
          g.suporte(id, "executado_por", `orq-agente-${slugify(alvo)}`, { doc: arquivo, trecho: l.texto, regra: "campo-responsavel-da-task", confianca: CONF.catalogo });
        }
      }
    }
  }

  /* dependência declarada entre agentes: "Upstream data provider: `agents/<x>.md`" */
  for (const a of agentes) {
    const d = g.c.doc(`${SQ}/agents/${a}.md`);
    if (!d) continue;
    const l = acharLinha(d, /Upstream data provider:\*\*\s*`agents\/([\w-]+)\.md`/);
    const alvo = l?.texto.match(/agents\/([\w-]+)\.md/)?.[1];
    if (alvo && agentes.includes(alvo) && alvo !== a) {
      g.suporte(`orq-agente-${slugify(a)}`, "depende_de", `orq-agente-${slugify(alvo)}`, {
        doc: d, trecho: l.texto, regra: "upstream-data-provider-declarado", confianca: CONF.catalogo,
      });
    }
  }
}

/* ------------------------------------------------------------------ registros de dados do squad */

/**
 * `squads/orquestrador-global/data/*.yaml`: matriz de contenção da composição, taxonomia de
 * intenções (consumida pelo agente intent-parser), adapters de execução e quality gates.
 * Cada fato vem de uma linha YAML literal (item da lista + a linha seguinte, contíguas).
 */
function extrairRegistrosDoSquad(g) {
  const squadId = "squad-orquestrador-global";
  if (!g.conceitos.has(squadId)) return;
  const lerYaml = (rel) => {
    const d = g.c.doc(`${SQ}/${rel}`);
    if (!d) { g.aviso(`documento ausente: ${SQ}/${rel}`); return null; }
    try { return { d, y: load(d.text), L: d.text.split("\n") }; } catch (e) { g.aviso(`${rel} inválido: ${String(e.message).slice(0, 60)}`); return null; }
  };
  /** Linha `- id: x` dentro da seção `chave:` + a linha seguinte (contíguas). */
  const itemEMais = (r, chave, id, regexId) => {
    const i0 = r.L.findIndex((l) => new RegExp(`^\\s*${escRe(chave)}:\\s*$`).test(l));
    if (i0 === -1) return null;
    for (let i = i0 + 1; i < r.L.length - 1; i++) {
      if (regexId(r.L[i], id)) return `${r.L[i]} ${r.L[i + 1]}`;
    }
    return null;
  };
  const eId = (l, id) => new RegExp(`^\\s*-\\s*id:\\s*["']?${escRe(id)}["']?\\s*$`).test(l);

  /* composição: quem contém quem */
  const comp = lerYaml("data/composition-rules.yaml");
  for (const [cont, membros] of Object.entries(comp?.y?.containment_matrix ?? {})) {
    const idDe = (n) => `composicao-${slugify(n)}`;
    const i = comp.L.findIndex((l) => new RegExp(`^\\s*${escRe(cont)}:\\s*$`).test(l));
    for (const m of membros ?? []) {
      const j = comp.L.findIndex((l, k) => k > i && new RegExp(`^\\s*-\\s*${escRe(m)}\\s*$`).test(l));
      if (i === -1 || j === -1 || j - i > 6 || !g.conceitos.has(idDe(m)) || !g.conceitos.has(idDe(cont))) continue;
      g.suporte(idDe(m), "parte_de", idDe(cont), {
        doc: comp.d, trecho: comp.L.slice(i, j + 1).join(" "), regra: "containment-matrix-explicita", confianca: CONF.catalogo,
      });
    }
  }

  /* taxonomia de intenções */
  const tax = lerYaml("data/intent-taxonomy.yaml");
  const parser = g.conceitos.get("orq-agente-intent-parser");
  if (tax && parser) {
    const HUB = "orq-intent-taxonomy";
    g.conceito(HUB, { label: "Taxonomia de intenções (intent-taxonomy)", origem: "squad-data", estrutural: true, mencionavel: true, exatos: ["intent-taxonomy"], topK: 3 });
    const consumidor = acharLinha(tax.d, /^#\s*Consumer:\s*agents\/intent-parser\.md/);
    if (consumidor) g.suporte("orq-agente-intent-parser", "usa", HUB, { doc: tax.d, trecho: consumidor.texto, regra: "consumer-declarado-no-registro", confianca: CONF.catalogo });
    const ag = g.c.doc(`${SQ}/agents/intent-parser.md`);
    const uso = ag && acharLinha(ag, /^- Data: `data\/intent-taxonomy\.yaml`/);
    if (uso) g.suporte("orq-agente-intent-parser", "usa", HUB, { doc: ag, trecho: uso.texto, regra: "agente-declara-uso-do-registro", confianca: CONF.catalogo });
    for (const [chave, sufixo] of [["primary_domains", "domínio de intenção"], ["task_types", "tipo de tarefa"]]) {
      for (const it of tax.y?.[chave] ?? []) {
        const trecho = itemEMais(tax, chave, it.id, eId);
        if (!trecho) continue;
        const id = `orq-intent-${chave === "primary_domains" ? "dominio" : "tipo"}-${slugify(it.id)}`;
        g.conceito(id, { label: `${it.label ?? it.id} (${sufixo})`, origem: "squad-data", estrutural: true });
        g.suporte(id, "parte_de", HUB, { doc: tax.d, trecho, regra: "lista-yaml-da-taxonomia", confianca: CONF.catalogo });
      }
    }
  }

  /* adapters de execução */
  const ad = lerYaml("data/execution-adapter-registry.yaml");
  if (ad) {
    const HUB = "orq-execution-adapters";
    g.conceito(HUB, { label: "Registro de adapters de execução", origem: "squad-data", estrutural: true, mencionavel: true, exatos: ["execution-adapter-registry"], topK: 3 });
    const nome = acharLinha(ad.d, /^\s*name:\s*"orquestrador-global-execution-adapter-registry"/);
    if (nome) g.suporte(HUB, "parte_de", squadId, { doc: ad.d, trecho: nome.texto, regra: "metadata-name-cita-o-squad", confianca: CONF.catalogo });
    for (const a of ad.y?.adapters ?? []) {
      const i = ad.L.findIndex((l) => eId(l, a.id));
      if (i === -1) continue;
      const id = `orq-adapter-${slugify(a.id)}`;
      g.conceito(id, { label: `${a.id} (adapter)`, origem: "squad-data", estrutural: true, mencionavel: a.id.includes("-"), exatos: [a.id], topK: 3 });
      g.suporte(id, "parte_de", HUB, { doc: ad.d, trecho: ad.L.slice(i, i + 3).join(" "), regra: "lista-adapters-do-registro", confianca: CONF.catalogo });
    }
  }

  /* quality gates */
  const qg = lerYaml("data/quality-gates.yaml");
  for (const gate of qg?.y?.quality_gates ?? []) {
    const i = qg.L.findIndex((l) => eId(l, gate.id));
    if (i === -1) continue;
    const id = `orq-qg-${slugify(gate.name ?? gate.id)}`;
    g.conceito(id, { label: `${gate.id} — ${gate.name} (quality gate)`, origem: "squad-data", estrutural: true, mencionavel: true, exatos: [gate.id], topK: 3 });
    g.suporte(id, "parte_de", squadId, { doc: qg.d, trecho: qg.L.slice(i, i + 2).join(" "), regra: "id-do-gate-cita-o-squad", confianca: CONF.catalogo });
  }
}

/* ------------------------------------------------------------------ Conclave e registry de agentes */

function extrairConclave(g) {
  const readme = g.c.doc("agents/system/conclave/README.md");
  const reg = g.c.doc("agents/_registry/ecosystem-registry.yaml");
  const AGS = "agentes-tipo-system";
  g.conceito("conclave", {
    label: "Conclave", origem: "conclave-readme", estrutural: true, mencionavel: true, aliases: ["Conclave"], topK: 5,
  });
  g.conceito(AGS, { label: "Agentes System", origem: "ecosystem-registry", estrutural: true });
  if (readme) {
    const t = tabelasMd(readme).find((x) => x.header[0] === "ID");
    for (const r of t?.rows ?? []) {
      const nome = limpa(r.cells[0]);
      const id = `conclave-${slugify(nome)}`;
      g.conceito(id, { label: `${nome} (Conclave)`, origem: "conclave-readme", estrutural: true, mencionavel: true, exatos: [nome], topK: 3 });
      g.suporte(id, "parte_de", "conclave", { doc: readme, trecho: r.linha, regra: "catalogo-tabela-conclave", confianca: CONF.catalogo });
      const ag = g.c.doc(`agents/system/conclave/${nome}/agent.md`);
      if (ag) {
        const l = acharLinha(ag, /^category:\s*system\/conclave\s*$/);
        if (l) g.suporte(id, "parte_de", "conclave", { doc: ag, trecho: l.texto, regra: "frontmatter-category-do-agente", confianca: CONF.coocorrencia });
      }
      if (reg) {
        const L = reg.text.split("\n");
        const i = L.findIndex((x) => new RegExp(`^\\s*-\\s*id:\\s*${escRe(nome)}\\s*$`).test(x));
        if (i !== -1) {
          g.suporte(id, "parte_de", "conclave", { doc: reg, trecho: L.slice(i, i + 3).join(" "), regra: "ecosystem-registry-categoria", confianca: CONF.catalogo });
        }
      }
    }
  } else g.aviso("agents/system/conclave/README.md ausente");
  // agentes-sistema "placeholder" do registry
  if (reg) {
    const L = reg.text.split("\n");
    for (let i = 0; i < L.length; i++) {
      const m = L[i].match(/^\s*-\s*id:\s*([\w-]+)\s*$/);
      if (!m) continue;
      const cat = L[i + 1]?.match(/^\s*category:\s*(\S+)\s*$/)?.[1];
      if (cat !== "system") continue;
      const id = `registry-${slugify(m[1])}`;
      const status = L.slice(i, i + 6).map((x) => x.match(/^\s*status:\s*(\S+)/)?.[1]).find(Boolean);
      g.conceito(id, {
        label: `${m[1]} (registry${status ? `, ${status}` : ""})`, origem: "ecosystem-registry", estrutural: true,
        mencionavel: true, exatos: [m[1]], topK: 2,
      });
      g.suporte(id, "parte_de", AGS, { doc: reg, trecho: L.slice(i, i + 3).join(" "), regra: "ecosystem-registry-categoria", confianca: CONF.catalogo });
    }
  }
}

/* ------------------------------------------------------------------ comandos (diretivas EXECUTE) e skills */

function extrairComandosESkills(g) {
  const cmdDocs = g.c.docs.filter((d) => /^\.claude\/commands\/[^/]+\.md$/.test(d.rel));
  const nomes = new Set(cmdDocs.map((d) => d.rel.match(/commands\/([^/]+)\.md$/)[1]));
  const cmdId = (n) => `cmd-${slugify(n)}`;
  const garante = (n) => g.conceito(cmdId(n), { label: `/${n}`, origem: "comandos", estrutural: false, mencionavel: true, exatos: [`/${n}`], topK: 3 });
  for (const d of cmdDocs) {
    const origem = d.rel.match(/commands\/([^/]+)\.md$/)[1];
    for (const l of d.text.split("\n")) {
      const regs = [
        [/^\s*EXECUTE\s+(\/[a-z][\w-]*)/, "diretiva-execute"],
        [/Combina\s+`(\/[\w-]+)`\s*\+\s*`(\/[\w-]+)/, "frase-combina"],
      ];
      for (const [re, regra] of regs) {
        const m = l.match(re);
        if (!m) continue;
        for (const alvo of m.slice(1)) {
          const nome = alvo.replace(/^\//, "");
          if (nome === origem || !nomes.has(nome)) continue;
          garante(origem); garante(nome);
          g.conceito(cmdId(origem), { estrutural: true });
          g.conceito(cmdId(nome), { estrutural: true });
          g.suporte(cmdId(origem), "usa", cmdId(nome), { doc: d, trecho: l, regra, confianca: CONF.cadeia });
        }
      }
    }
  }

  // skills presentes em disco (SKILL.md) — pertencem ao hub "skills"; registry e arquivo se corroboram
  const reg = g.c.doc(".claude/skills/skill-registry.yaml");
  g.conceito("skills", { label: "Skills", origem: "skills", estrutural: true });
  for (const d of g.c.docs) {
    const m = d.rel.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/);
    if (!m) continue;
    const nome = m[1];
    const id = `skill-${slugify(nome)}`;
    const ehComando = nomes.has(nome);
    g.conceito(id, {
      label: `${nome} (skill)`, origem: "skills", estrutural: true, mencionavel: true,
      exatos: [...(ehComando ? [] : [`/${nome}`]), ...(nome.includes("-") ? [nome] : [])], topK: 3,
    });
    const campo = acharLinha(d, /^name:\s*.+$/) ?? acharLinha(d, /^#\s+.+$/);
    if (campo) g.suporte(id, "parte_de", "skills", { doc: d, trecho: campo.texto, regra: "arquivo-skill-md-se-declara", confianca: CONF.catalogo });
    if (reg) {
      const l = acharLinha(reg, new RegExp(`^\\s*-\\s*name:\\s*"${escRe(nome)}"\\s*$`));
      if (l) g.suporte(id, "parte_de", "skills", { doc: reg, trecho: l.texto, regra: "skill-registry", confianca: CONF.catalogo });
    }
  }
}

/* ------------------------------------------------------------------ gravação do SQLite */

const DDL = `
CREATE TABLE nodes (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  tipo  TEXT NOT NULL
);
CREATE TABLE edges (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  src      TEXT NOT NULL,
  rel      TEXT NOT NULL,
  dst      TEXT NOT NULL,
  status   TEXT NOT NULL DEFAULT 'claimed',
  n_fontes INTEGER NOT NULL DEFAULT 1,
  peso     REAL NOT NULL DEFAULT 0.3
);
CREATE TABLE evidences (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  edge_id   INTEGER NOT NULL REFERENCES edges(id),
  livro     TEXT NOT NULL,
  chunk_id  TEXT NOT NULL,
  trecho    TEXT NOT NULL,
  confianca REAL NOT NULL
);
CREATE INDEX idx_evidences_edge ON evidences(edge_id);
CREATE INDEX idx_evidences_livro ON evidences(livro);
CREATE INDEX idx_edges_status ON edges(status);
`;

const sha256Arquivo = (buf) => createHash("sha256").update(buf).digest("hex");

/** Avisos sobre incoerências REAIS do repositório que o grafo não deve esconder. */
function avisosDeConsistencia(g) {
  // artigos citados que a tabela da Constituição (I–XIV) não define
  const citados = new Map();
  for (const d of g.c.docs) {
    if (g.c.canon(d) !== d || /^engine\/jarvis\//.test(d.rel)) continue;
    for (const m of d.text.matchAll(/(?<![\w])Art(?:\.\s?|icle\s)(X{0,3}(?:IX|IV|V?I{0,3}))(?![\w])/g)) {
      if (m[1]) citados.set(m[1], (citados.get(m[1]) ?? new Set()).add(d.rel));
    }
  }
  const definidos = new Set([...g.conceitos.keys()].filter((id) => id.startsWith("art-")).map((id) => id.split("-")[1].toUpperCase()));
  for (const [romano, docs] of [...citados].sort()) {
    if (definidos.size && !definidos.has(romano)) {
      g.aviso(`"Art. ${romano}" é citado em ${docs.size} documento(s) mas a tabela da Constituição só define ${[...definidos].join("/")}: sem nó (nada foi inventado)`);
    }
  }
}

async function gravarSqlite(tmp, { nodes, edges, evidences }) {
  await rm(tmp, { force: true });
  const db = await openSqlite(tmp);
  try {
    db.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = OFF;");
    db.exec(DDL);
    db.exec("BEGIN");
    const n = db.prepare("INSERT INTO nodes (id, label, tipo) VALUES (?, ?, ?)");
    for (const x of nodes) n.run(x.id, x.label, x.tipo);
    const e = db.prepare("INSERT INTO edges (id, src, rel, dst, status, n_fontes, peso) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const x of edges) e.run(x.id, x.src, x.rel, x.dst, x.status, x.n_fontes, x.peso);
    const v = db.prepare("INSERT INTO evidences (edge_id, livro, chunk_id, trecho, confianca) VALUES (?, ?, ?, ?, ?)");
    for (const x of evidences) v.run(x.edge_id, x.livro, x.chunk_id, x.trecho, x.confianca);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  await rm(`${tmp}-journal`, { force: true });
}

/** Verificação independente: reabre o SQLite gravado e prova as invariantes contra o corpus. */
async function verificar(destino, corpus) {
  const db = await openSqlite(destino);
  const falhas = [];
  try {
    const nodes = db.prepare("SELECT id, label, tipo FROM nodes").all();
    const edges = db.prepare("SELECT id, src, rel, dst, status, n_fontes, peso FROM edges").all();
    const evs = db.prepare("SELECT id, edge_id, livro, chunk_id, trecho, confianca FROM evidences").all();
    const ids = new Set(nodes.map((n) => n.id));
    if (ids.size !== nodes.length) falhas.push("ids de nó repetidos");
    // índice de documentos por identidade de livro
    const porLivro = new Map();
    for (const d of corpus.docs) porLivro.set(corpus.ref(d).evLivro, d);
    const evPorAresta = new Map();
    for (const v of evs) evPorAresta.set(v.edge_id, [...(evPorAresta.get(v.edge_id) ?? []), v]);
    let substrings = 0;
    const destaque = { total: 0, comDestaque: 0, porRel: {} };
    const relDaAresta = new Map(edges.map((e) => [e.id, e.rel]));
    for (const v of evs) {
      const d = porLivro.get(v.livro);
      if (!d) { falhas.push(`evidência com livro desconhecido: ${v.livro}`); continue; }
      if (v.trecho.length > MAX_TRECHO) falhas.push(`trecho > ${MAX_TRECHO} chars (edge ${v.edge_id})`);
      if (!corpus.normTexto(d).includes(v.trecho)) { falhas.push(`trecho NÃO é substring de ${d.rel} (edge ${v.edge_id})`); continue; }
      substrings++;
      if (corpus.leitor.aplica(d)) {
        // o deep-link "ir pro trecho no livro" só destaca o que o Leitor enxerga num único nó de texto
        const ok = corpus.leitor.acha(d, v.trecho);
        const r = (destaque.porRel[relDaAresta.get(v.edge_id) === "menciona" ? "menciona" : "relacoes"] ??= { total: 0, comDestaque: 0 });
        destaque.total++;
        r.total++;
        if (ok) { destaque.comDestaque++; r.comDestaque++; }
      }
      const [base, n] = [v.chunk_id.slice(0, v.chunk_id.lastIndexOf("#")), Number(v.chunk_id.slice(v.chunk_id.lastIndexOf("#") + 1))];
      const chunks = corpus.chunksNorm(d);
      if (base !== corpus.ref(d).chunkBase || !(n >= 0 && n < chunks.length) || !chunks[n].includes(v.trecho)) {
        falhas.push(`chunk_id inconsistente (${v.chunk_id}) em ${d.rel}`);
      }
      if (!(v.confianca >= 0 && v.confianca <= 1)) falhas.push("confianca fora de 0..1");
    }
    for (const e of edges) {
      if (!ids.has(e.src) || !ids.has(e.dst)) falhas.push(`aresta ${e.id} com ponta inexistente`);
      const lista = evPorAresta.get(e.id) ?? [];
      if (!lista.length) falhas.push(`aresta ${e.id} sem evidência`);
      const docsDist = new Set(lista.map((x) => corpus.canon(porLivro.get(x.livro)).sha256)).size;
      if (e.n_fontes !== docsDist) falhas.push(`aresta ${e.id}: n_fontes=${e.n_fontes} != documentos distintos=${docsDist}`);
      if ((e.status === "confirmed") !== (docsDist >= 2)) falhas.push(`aresta ${e.id}: status incoerente`);
      if (!(e.peso >= 0 && e.peso <= 1)) falhas.push(`aresta ${e.id}: peso fora de 0..1`);
    }
    const tocados = new Set(edges.flatMap((e) => [e.src, e.dst]));
    for (const n of nodes) if (n.tipo === "conceito" && !tocados.has(n.id)) falhas.push(`conceito órfão: ${n.id}`);
    // todo documento citado por uma evidência tem o seu nó de livro
    for (const v of evs) {
      const d = porLivro.get(v.livro);
      if (d && !ids.has(corpus.ref(d).noId)) falhas.push(`evidência cita ${v.livro} sem nó de livro`);
    }
    for (const n of nodes) {
      if (n.tipo === "livro") {
        const ev = n.id.replace(/^livro:/, "");
        if (!porLivro.has(ev)) falhas.push(`nó de livro sem documento: ${n.id}`);
      } else if (n.tipo === "conceito" && n.id !== n.id.toLowerCase()) falhas.push(`conceito com maiúsculas: ${n.id}`);
    }
    destaque.porRel = Object.fromEntries(Object.entries(destaque.porRel).sort());
    return { falhas, evidencias: evs.length, substrings, destaque };
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ troca do SQLite (app pode estar lendo) */

/** Erros de "arquivo em uso" do Windows: o rename falha enquanto o app mantém o SQLite aberto. */
const ARQUIVO_EM_USO = new Set(["EPERM", "EBUSY", "EACCES"]);
const ESPERAS_MS = [0, 100, 250, 500, 1000, 1500];

async function renomearComTentativas(de, para, esperasMs = ESPERAS_MS) {
  let ultimo;
  for (const ms of esperasMs) {
    if (ms) await esperar(ms);
    try {
      await rename(de, para);
      return;
    } catch (e) {
      if (!ARQUIVO_EM_USO.has(e?.code)) throw e;
      ultimo = e;
    }
  }
  throw ultimo;
}

/** Copia `origem` para dentro de `destino` pela API de backup do SQLite (respeita os locks; não precisa de rename). */
export async function copiarPorBackup(origem, destino) {
  const mod = await import("node:sqlite");
  if (typeof mod.backup !== "function") throw new Error("node:sqlite.backup indisponível nesta versão do Node");
  const db = new mod.DatabaseSync(origem, { readOnly: true });
  try {
    await mod.backup(db, destino);
  } finally {
    db.close();
  }
}

/**
 * Coloca o SQLite novo no lugar do antigo. Tenta rename com espera (leitura rápida do app termina em
 * instantes); se o arquivo continuar preso, tenta a API de backup do SQLite; se também não der, falha
 * com a causa clara e o grafo anterior intacto. Quem chama remove o temporário (try/finally).
 */
export async function trocarSqlite(tmp, destino, esperasMs = ESPERAS_MS) {
  try {
    await renomearComTentativas(tmp, destino, esperasMs);
    return "rename";
  } catch (e) {
    if (!ARQUIVO_EM_USO.has(e?.code)) throw e;
    try {
      await copiarPorBackup(tmp, destino);
      return "backup";
    } catch {
      throw new Error(
        `${path.basename(destino)} está em uso (${e.code}): o app mantém o arquivo aberto numa leitura. Pause o servidor ou aguarde a leitura terminar e rode o populate de novo; o grafo anterior foi mantido e nenhum arquivo temporário sobrou.`,
      );
    }
  }
}

/** Remove temporários `livros-kg.sqlite.<pid>.tmp` de execuções interrompidas (só os de processos que não existem mais). */
export async function limparTmpOrfaos(dir) {
  let nomes;
  try {
    nomes = await readdir(dir);
  } catch {
    return 0;
  }
  let removidos = 0;
  for (const nome of nomes) {
    const m = nome.match(/^livros-kg\.sqlite\.(\d+)\.tmp(?:-journal)?$/);
    if (!m || Number(m[1]) === process.pid) continue;
    let vivo;
    try {
      process.kill(Number(m[1]), 0);
      vivo = true;
    } catch (e) {
      vivo = e?.code === "EPERM";
    }
    if (vivo) continue;
    await rm(path.join(dir, nome), { force: true });
    removidos++;
  }
  return removidos;
}

async function dumpLogicoHash(arquivo) {
  const db = await openSqlite(arquivo);
  try {
    const t = (sql) => JSON.stringify(db.prepare(sql).all());
    return sha256([t("SELECT * FROM nodes ORDER BY id"), t("SELECT * FROM edges ORDER BY id"), t("SELECT * FROM evidences ORDER BY id")].join("\n"));
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ módulo */

export default async function run(ctx) {
  ativarExclusoes(ctx);
  const { appRoot, dataDir, docs, repoRoot } = ctx;
  const kgDir = path.join(dataDir, "kg");
  await ensureDir(kgDir);
  const dbFile = path.join(kgDir, "livros-kg.sqlite");
  const layoutFile = path.join(kgDir, "graph-layout.json");
  const manifestoFile = path.join(kgDir, "populate-grafo.json");

  const corpus = criarCorpus(docs);
  const g = new Grafo(corpus);
  for (const ex of [extrairClaudeMd, extrairGlossario, extrairCadeias, extrairSquad, extrairRegistrosDoSquad, extrairConclave, extrairComandosESkills]) ex(g);
  // insights de especialistas MCE: conceito estrutural + evidência literal na transcrição (ver especialistas.mjs)
  const insightsMce = await extrairInsightsMce(g, corpus, ctx);
  avisosDeConsistencia(g);
  const out = g.finalizar({ topK: 5 });

  const orfaos = await limparTmpOrfaos(kgDir);
  if (orfaos) g.aviso(`${orfaos} arquivo(s) temporário(s) órfão(s) de uma execução interrompida removido(s) de data/kg`);

  // grava num arquivo temporário e só troca pelo definitivo depois de VERIFICADO; o temporário nunca sobra
  const tmp = `${dbFile}.${process.pid}.tmp`;
  let verif;
  try {
    await gravarSqlite(tmp, out);
    verif = await verificar(tmp, corpus);
    if (verif.falhas.length) {
      throw new Error(`verificação do grafo falhou (${verif.falhas.length}): ${verif.falhas.slice(0, 5).join(" | ")}`);
    }

    // proteção: um grafo que não foi gerado por este módulo (kg-extract.py, por exemplo) é preservado
    const anterior = await readJsonSafe(manifestoFile);
    const existente = existsSync(dbFile);
    const hashAtual = existente ? sha256Arquivo(await readFile(dbFile)) : null;
    const eMeu = existente && anterior?.sqliteSha256 === hashAtual;
    if (existente && !eMeu) {
      const bak = path.join(kgDir, `livros-kg.pre-populate-${hashAtual.slice(0, 8)}.bak.sqlite`);
      if (!existsSync(bak)) await renomearComTentativas(dbFile, bak);
      else await rm(dbFile, { force: true });
      log("grafo", `grafo existente que não é deste módulo preservado em ${path.basename(bak)}`);
    }
    // conteúdo lógico igual ao que já está no lugar: não mexe no arquivo (o app pode estar lendo; o mtime e o hash ficam)
    let igual = false;
    if (eMeu) {
      const logicoAtual = anterior.sqliteLogicoSha256 ?? (await dumpLogicoHash(dbFile).catch(() => null));
      igual = logicoAtual !== null && logicoAtual === (await dumpLogicoHash(tmp));
    }
    if (!igual) {
      const como = await trocarSqlite(tmp, dbFile);
      if (como === "backup") g.aviso("livros-kg.sqlite estava em uso pelo app: conteúdo copiado pela API de backup do SQLite");
    }
  } finally {
    await rm(tmp, { force: true });
    await rm(`${tmp}-journal`, { force: true });
  }

  // layout (script existente; d3-force é determinístico para a mesma entrada)
  let layoutOk = true;
  try {
    await execFileP(process.execPath, [path.join(appRoot, "scripts", "graph-layout.mjs")], {
      cwd: appRoot,
      env: { ...process.env, BILHON_KG_DB: dbFile, BILHON_GRAPH_LAYOUT: layoutFile },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    layoutOk = false;
    g.aviso(`graph-layout falhou: ${String(e.stderr ?? e.message).slice(0, 200)}`);
  }

  const contagem = {
    conceitos: out.nodes.filter((n) => n.tipo === "conceito").length,
    livros: out.nodes.filter((n) => n.tipo === "livro").length,
    arestas: out.edges.length,
    evidencias: out.evidences.length,
    confirmed: out.edges.filter((e) => e.status === "confirmed").length,
    claimed: out.edges.filter((e) => e.status === "claimed").length,
    disputed: 0,
    menciona: out.edges.filter((e) => e.rel === "menciona").length,
  };
  const porRel = {};
  for (const e of out.edges) porRel[e.rel] = (porRel[e.rel] ?? 0) + 1;
  const porRegra = {};
  for (const v of out.evidences) porRegra[v.regra] = (porRegra[v.regra] ?? 0) + 1;

  await writeJson(manifestoFile, {
    extrator: "scripts/populate/grafo.mjs",
    versao: VERSAO_EXTRATOR,
    determinismo: "sem LLM, sem rede, sem relógio; ids e ordem estáveis; cópias idênticas (sha256) contam como um documento",
    contagem,
    porRel: Object.fromEntries(Object.entries(porRel).sort()),
    evidenciasPorRegra: Object.fromEntries(Object.entries(porRegra).sort()),
    sqliteSha256: sha256Arquivo(await readFile(dbFile)),
    sqliteLogicoSha256: await dumpLogicoHash(dbFile),
    // repositório lido, relativo à pasta do manifesto (absoluto se estiver em outro drive); fora do hash.
    // lib/kg.ts só o aceita se o sqliteSha256 conferir e a raiz ficar dentro de BILHON_ROOT
    raiz: toPosix(path.relative(kgDir, repoRoot)) || ".",
    layoutGerado: layoutOk,
    insightsMce,
    verificacao: {
      evidenciasSubstringReal: verif.substrings,
      evidenciasTotal: verif.evidencias,
      falhas: verif.falhas.length,
      // evidências de livro (md/txt) cujo deep-link o Leitor consegue destacar (simulação de components/Leitor.tsx)
      destaqueNoLeitor: verif.destaque,
    },
    regras: {
      conceito: "entra se estrutural (registro/config/catálogo/cadeia confirmada) ou se tiver >= 2 documentos distintos de apoio",
      status: "confirmed = >= 2 documentos distintos; claimed = 1; disputed = nenhum conflito explícito encontrado",
      peso: "confiança média das evidências x fator (1 doc 0.70, 2 docs 0.85, >= 3 docs 1.00)",
      confianca: CONF,
      mencoes: "no máximo topK documentos por conceito; melhor evidência primeiro (definição > título > destaque > texto)",
    },
  });

  return { resumo: { ...contagem, porRel, insightsMce }, avisos: g.avisos.slice(0, 40) };
}
