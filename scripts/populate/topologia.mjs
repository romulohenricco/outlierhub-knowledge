/**
 * Módulo `topologia` — desenha o PRÓPRIO repositório mega-brain para a camada de
 * topologia do grafo ("se eu mover X, o que quebra?"). Escreve
 * `data/topology/nodes.json` e `data/topology/edges.json` no formato de
 * `docs/agente-registro.md` / `lib/topologia.ts`.
 *
 * O que vira nó (tipos do app): repo, app (este Knowledge), pasta-relevante,
 * engine (pacotes e módulos Python da engine), skill, hook (os ligados em
 * `.claude/settings.json`), script (bin/, scripts/, .claude/scripts), arquivo
 * (demais arquivos que participam de alguma relação), remote (remotes do git) e
 * plano (`plano:<nome>`). Nó só entra se for estrutural (as classes acima) ou se
 * participar de ao menos uma aresta de referência/execução.
 *
 * Arestas:
 *   contem / pertence_a   hierarquia (pasta → filho; nó → plano). Só entre caminhos que EXISTEM.
 *   referencia            import Python/JS e caminho citado em md/yaml/py/json/sh/js
 *                         (n = ocorrências; ver "escopo" abaixo)
 *   executa               `.claude/settings.json` → script de cada hook ligado
 *   git_remote            repo → remote (URL sem credenciais; push desabilitado marcado)
 *
 * Fora do desenho, por regra (mesmas do corpus, `common.mjs`/`scanRepo`):
 *   - bucket pessoal (`knowledge/personal`, `agents/personal`): não é percorrido, lido nem citado
 *     como nó; só entra com `--include-personal`;
 *   - estado de execução (`logs`, `inbox`, `processing`, `artifacts`, `.mega-brain`,
 *     `.claude/{jarvis,logs,mission-control,sessions}`): a pasta aparece, o que há dentro não é
 *     percorrido nem lido, e uma citação para dentro dela aponta para a pasta;
 *   - pastas com nome sensível (`.credentials`, `secrets`…) e arquivos com padrão de segredo.
 *
 * Existência e caixa: o disco é consultado como um sistema de arquivos que diferencia maiúsculas
 * (a resposta não depende de rodar em Windows, macOS ou Linux). Citação com a caixa errada
 * (`docs/quick-start.md` para `docs/QUICK-START.md`) liga ao nó REAL, com a forma
 * `<forma>-caixa-divergente` e `quebrado: true` (funciona em Windows/macOS padrão, quebra em
 * Linux/CI); nunca vira um segundo nó com o caminho errado.
 *
 * Referência para caminho que NÃO existe no disco vira `alvo_morto: true`. O alvo morto é
 * colapsado no primeiro segmento inexistente (`core/scripts/x.mjs` → `core`), para não criar um nó
 * por arquivo imaginário, e é só o alvo de arestas `referencia`: sem `contem` (a pasta não contém
 * o que não existe) e sem `path` (não há o que mover; `impactoDeMover` não o conta no escopo).
 * Não são "mortos" e ficam de fora: caminhos ignorados pelo .gitignore, os que docs/LAYERS.md
 * declara como conteúdo populado/pessoal em tempo de execução e as raízes que o próprio
 * repositório cita com placeholder (`workspace/businesses/{bu}/…` → `workspace/businesses` é
 * criado em tempo de execução). Também não são referência: placeholders (`{bu}`, `<nome>`, `$X`),
 * globs (`*.md`, `kops-*`, `/**`) sobre pasta inexistente, nomes parciais (`agents/kops-*`) e
 * caminho com espaço entre aspas (`".claude/agents/the knowledge system"`).
 *
 * Escopo da aresta `referencia` (lido por `lib/topologia.ts`: só "ativo" conta como "quebra de
 * verdade"; qualquer outro valor é mera menção): "ativo" para código, configuração e para os
 * documentos que agentes e pipeline EXECUTAM como instrução (`.claude/{skills,rules,commands,
 * agents,templates}`, `.claude/CLAUDE.md`, `agents/`, `squads/`, salvo README/CHANGELOG/LICENSE);
 * "documentacao" para o resto dos .md/.txt (docs/, README, knowledge/, workspace/, engine/…):
 * citam o caminho, mas mover o alvo não quebra a execução.
 *
 * Determinístico: tudo ordenado, ids estáveis, nada de aleatório. O carimbo
 * `gerado_em` só muda quando o CONTEÚDO muda (senão rodar duas vezes gera arquivos
 * idênticos byte a byte).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { ativarExclusoes, caminhoExcluido, detectSecret, log, readJsonSafe, sha256, writeJson } from "./common.mjs";

const VERSAO = "1";
const PRUNE = new Set([
  "node_modules", ".git", "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache", ".venv", "venv", "dist", "build",
  ".next", "coverage", ".data",
]);
/** Diretórios de estado de execução: entram como pasta, mas não se desce neles nem se lê o que há dentro. */
const RUNTIME_DIRS = new Set([
  "logs", "inbox", "processing", "artifacts", ".mega-brain", // .mega-brain/handoffs: "gitignored -- runtime state only" (.claude/rules/agent-handoff.md)
  ".claude/jarvis", ".claude/logs", ".claude/mission-control", ".claude/sessions",
]);
/** Mesma regra do `scanRepo` (common.mjs): bucket pessoal fora, salvo --include-personal. */
const PESSOAL = /^(?:knowledge|agents)\/personal(?:\/|$)/i;
const SENSITIVE_NAME = /(^\.env|credential|secret|id_rsa|\.(pem|key|pfx|p12)$|settings\.local\.json$)/i;
const EXT_TEXTO = new Set([".md", ".yaml", ".yml", ".py", ".json", ".sh", ".js", ".mjs", ".cjs", ".txt", ".toml", ".mmd"]);
const EXT_CODIGO = new Set([".py", ".js", ".mjs", ".cjs", ".sh"]);
const EXT_CONFIG = new Set([".json", ".yaml", ".yml", ".toml"]);
const MAX_BYTES = 1024 * 1024;
/** Prefixos de caminho que não existem como pasta hoje mas que o repo cita (legado/runtime) — para reconhecer caminhos mortos. */
const PREFIXOS_EXTRAS = ["core", "mega-brain-core", ".data", "inbox", "artifacts", "processing", "outputs", "services", "apps", ".mega-brain"];
/** Documentos .md/.txt que agentes e pipeline executam como instrução: uma citação quebrada neles quebra de verdade. */
const AREAS_OPERACIONAIS = /^(?:\.claude\/(?:skills|rules|commands|agents|templates)\/|\.claude\/CLAUDE\.md$|agents\/|squads\/)/;
const LEIA_ME = /^(?:readme|changelog|license|contributing)(?:\.|$)/i;

const posix = (p) => p.split(path.sep).join("/");
const nativo = (root, rel) => path.resolve(root, ...rel.split("/").filter(Boolean));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const porOrdem = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** "ativo" só para o que quebra de verdade (ver cabeçalho). */
function escopoDe(rel, ext) {
  if (EXT_CODIGO.has(ext) || EXT_CONFIG.has(ext)) return "ativo";
  if (AREAS_OPERACIONAIS.test(rel) && !LEIA_ME.test(path.posix.basename(rel))) return "ativo";
  return "documentacao";
}

/** A pasta de execução (RUNTIME_DIRS) que contém `rel`, ou null. */
function runtimeDe(rel) {
  for (const r of RUNTIME_DIRS) if (rel === r || rel.startsWith(`${r}/`)) return r;
  return null;
}

/* ------------------------------------------------------------------ varredura */

function varrer(root, { incluirPessoal }) {
  const arquivos = [];
  const dirs = [];
  const walk = (abs, rel) => {
    let es;
    try { es = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    es.sort((a, b) => porOrdem(a.name, b.name));
    for (const e of es) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (!incluirPessoal && PESSOAL.test(r)) continue; // nem a pasta, nem o que há dentro
      if (caminhoExcluido(path.join(abs, e.name))) continue; // BILHON_POPULATE_EXCLUIR: nem listado, nem lido
      if (e.isDirectory()) {
        if (PRUNE.has(e.name) || SENSITIVE_NAME.test(e.name)) continue;
        if (rel === "" && e.name === "apps") continue; // o app Knowledge é um nó só
        dirs.push(r);
        if (RUNTIME_DIRS.has(r)) continue;
        walk(path.join(abs, e.name), r);
      } else if (e.isFile()) {
        arquivos.push(r);
      }
    }
  };
  walk(root, "");
  return { arquivos, dirs };
}

/* ------------------------------------------------------------------ disco (caixa exata) */

/**
 * Acesso ao disco que SEMPRE diferencia maiúsculas: cada segmento do caminho precisa existir com a
 * mesma caixa na listagem do diretório. Em Windows/macOS `statSync("docs/quick-start.md")` acharia
 * `QUICK-START.md`; aqui isso é uma divergência de caixa, não uma existência.
 */
function criarDisco(root) {
  const listas = new Map();
  const nomesDe = (relDir) => {
    let l = listas.get(relDir);
    if (l === undefined) {
      try {
        const nomes = readdirSync(relDir ? nativo(root, relDir) : root);
        const minusc = new Map();
        for (const n of nomes) {
          const k = n.toLowerCase();
          minusc.set(k, [...(minusc.get(k) ?? []), n]);
        }
        l = { exatos: new Set(nomes), minusc };
      } catch {
        l = null;
      }
      listas.set(relDir, l);
    }
    return l;
  };

  const resolvidos = new Map();
  /**
   * { ok: true, rel, divergente }  rel na caixa REAL do disco (divergente = a citada difere dela), ou
   * { ok: false, prefixo, falta }  `prefixo` na caixa real e `falta` = 1º segmento que não existe.
   */
  const resolver = (rel) => {
    let r = resolvidos.get(rel);
    if (r) return r;
    let acum = "";
    let divergente = false;
    r = { ok: true, rel: "", divergente: false };
    for (const s of rel.split("/").filter(Boolean)) {
      const d = nomesDe(acum);
      if (!d) { r = { ok: false, prefixo: acum, falta: s }; break; }
      if (d.exatos.has(s)) {
        acum = acum ? `${acum}/${s}` : s;
        continue;
      }
      const cand = d.minusc.get(s.toLowerCase());
      if (cand && cand.length === 1) { // caixa diferente e sem ambiguidade (um só candidato)
        divergente = true;
        acum = acum ? `${acum}/${cand[0]}` : cand[0];
        continue;
      }
      r = { ok: false, prefixo: acum, falta: s };
      break;
    }
    if (r.ok) r = { ok: true, rel: acum, divergente };
    resolvidos.set(rel, r);
    return r;
  };

  const stats = new Map();
  const stat = (rel) => {
    if (!stats.has(rel)) {
      const r = resolver(rel);
      let st = null;
      if (r.ok && !r.divergente) { try { st = statSync(nativo(root, rel)); } catch { st = null; } }
      stats.set(rel, st);
    }
    return stats.get(rel);
  };
  return {
    resolver,
    stat,
    existe: (rel) => stat(rel) !== null,
    ehDir: (rel) => stat(rel)?.isDirectory() ?? false,
    ehArq: (rel) => stat(rel)?.isFile() ?? false,
  };
}

/* ------------------------------------------------------------------ gitignore (mini) */

function lerGitignore(root) {
  const f = path.join(root, ".gitignore");
  if (caminhoExcluido(f) || !existsSync(f)) return [];
  const pats = [];
  for (let l of readFileSync(f, "utf8").split(/\r?\n/)) {
    l = l.trim();
    if (!l || l.startsWith("#") || l.startsWith("!")) continue;
    l = l.replace(/^\//, "");
    if (l.includes("*") && !l.endsWith("/*")) {
      const re = new RegExp("(^|/)" + l.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "(.*/)?").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "(/|$)");
      pats.push((rel) => re.test(rel));
    } else {
      const base = l.replace(/\/\*$/, "").replace(/\/$/, "");
      pats.push((rel) => rel === base || rel.startsWith(`${base}/`) || rel.split("/").includes(base));
    }
  }
  return pats;
}

/** Caminhos que docs/LAYERS.md declara como conteúdo populado (L2) ou pessoal (L3) em tempo de execução. */
function lerPrefixosDeRuntime(root) {
  const f = path.join(root, "docs", "LAYERS.md");
  if (caminhoExcluido(f) || !existsSync(f)) return [];
  const t = readFileSync(f, "utf8");
  const out = new Set();
  for (const sec of t.split(/^###\s+/m)) {
    if (!/^L[23]\b/.test(sec)) continue;
    const m = sec.match(/\*\*What belongs in L[23]:\*\*([\s\S]*?)(?:\n\n\*\*|\n---)/);
    if (!m) continue;
    for (const p of m[1].matchAll(/`([^`]+\/)`/g)) out.add(p[1].replace(/\/$/, ""));
  }
  return [...out];
}

/** Camadas de distribuição (docs/LAYERS.md): { l1: [caminhos], l2: [...], l3: [...] } a partir de "What belongs in Ln". */
function lerCamadasDeDistribuicao(root) {
  const f = path.join(root, "docs", "LAYERS.md");
  const out = {};
  if (caminhoExcluido(f) || !existsSync(f)) return out;
  const t = readFileSync(f, "utf8");
  for (const sec of t.split(/^###\s+/m)) {
    const h = sec.match(/^(L[123])\s+—\s+([^\n]+)/);
    if (!h) continue;
    const m = sec.match(/\*\*What belongs in L[123]:\*\*([\s\S]*?)(?:\n\n\*\*|\n---)/);
    if (!m) continue;
    const caminhos = [...m[1].matchAll(/^- .*?`([^`]+)`/gm)].map((x) => x[1].replace(/\/$/, ""));
    out[h[1].toLowerCase()] = { titulo: h[2].trim(), caminhos };
  }
  return out;
}

/* ------------------------------------------------------------------ git remotes */

function lerRemotes(root) {
  const f = path.join(root, ".git", "config");
  if (caminhoExcluido(f) || !existsSync(f) || !statSync(f).isFile()) return [];
  const remotes = [];
  let atual = null;
  for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
    const sec = l.match(/^\[(.+?)\]\s*$/);
    if (sec) {
      const r = sec[1].match(/^remote "(.+)"$/);
      atual = r ? { nome: r[1], url: null, pushDesabilitado: false } : null;
      if (atual) remotes.push(atual);
      continue;
    }
    if (!atual) continue; // só nome/URL dos remotes — nada mais do config é lido
    const kv = l.match(/^\s*(url|pushurl)\s*=\s*(.*?)\s*$/);
    if (!kv) continue;
    if (kv[1] === "url") atual.url = semCredenciais(kv[2]);
    else if (/^(DISABLED|disabled|no_push|NO_PUSH)/.test(kv[2])) atual.pushDesabilitado = true;
  }
  return remotes.filter((r) => r.url).sort((a, b) => (a.nome < b.nome ? -1 : 1));
}

/** Tira `usuario:senha@` e query/fragmento de uma URL de remote. */
function semCredenciais(url) {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, "$1").replace(/[?#].*$/, "");
}

/* ------------------------------------------------------------------ extração de referências */

/** Imports de um arquivo Python: { pontos (nível relativo), modulo ("a.b"), nomes importados }. */
function extrairImportsPython(texto) {
  const L = texto.split("\n");
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    let m = l.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+(.*)$/);
    if (m) {
      let nomes = m[3];
      if (/^\s*\(/.test(nomes) && !nomes.includes(")")) {
        for (let j = i + 1; j < Math.min(L.length, i + 30); j++) {
          nomes += ` ${L[j]}`;
          if (L[j].includes(")")) break;
        }
      }
      const lista = nomes.replace(/[()]/g, " ").replace(/#.*$/gm, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter((s) => /^[\w*]+$/.test(s));
      out.push({ pontos: m[1].length, modulo: m[2], nomes: lista });
      continue;
    }
    m = l.match(/^\s*import\s+([\w., ]+?)\s*(?:#.*)?$/);
    if (m) {
      for (const mod of m[1].split(",")) {
        const nome = mod.trim().split(/\s+as\s+/)[0].trim();
        if (/^[\w.]+$/.test(nome)) out.push({ pontos: 0, modulo: nome, nomes: [] });
      }
    }
  }
  return out;
}

/**
 * Como a citação continua DEPOIS do caminho. Decide se ela é mesmo um caminho:
 *   "parcial"  nome incompleto ou placeholder colado (`kops-*`, `{bu}`, `<x>`, `$X`, `%s`) → nunca é caminho
 *   "dir-glob" pasta seguida de glob/placeholder/reticências (`engine/**`, `workspace/businesses/{bu}`)
 *              → só vale se a pasta existe; inexistente não dá para dizer que está "morta"
 *   null       citação normal
 */
function continuacaoDe(resto, antes) {
  // asterisco colado ao caminho: glob se o nome continua depois dele (`kops-*.md`, `rag_*/`, `G*-{x}`);
  // fim de frase/linha depois dele é o fecho de itálico/negrito (`*Arquitetura: docs/x.md*`, `**engine/paths.py**`)
  const g = resto.match(/^[-_]?\*(.?)(.?)/);
  if (g && antes !== "*" && (/[A-Za-z0-9*/_{[-]/.test(g[1]) || (g[1] === "." && /[A-Za-z0-9]/.test(g[2])))) return "parcial";
  if (/^[-_]?[{<$%]/.test(resto)) return "parcial";
  if (/^\/(?:[*{<$%[]|\.\.\.|…)/.test(resto)) return "dir-glob";
  return null;
}

/* ------------------------------------------------------------------ módulo */

export default async function run(ctx) {
  ativarExclusoes(ctx);
  const { repoRoot, appRoot, dataDir } = ctx;
  const incluirPessoal = Boolean(ctx.opts?.includePersonal);
  const topoDir = path.join(dataDir, "topology");
  const avisos = [];

  const disco = criarDisco(repoRoot);
  const { existe, ehDir, ehArq, stat } = disco;
  const ehPessoal = (rel) => !incluirPessoal && PESSOAL.test(rel);

  const { arquivos, dirs } = varrer(repoRoot, { incluirPessoal });
  const topDirs = [...new Set(dirs.filter((d) => !d.includes("/")))].sort();
  const prefixos = [...new Set([...topDirs, ...PREFIXOS_EXTRAS])].sort((a, b) => b.length - a.length);
  const reToken = new RegExp(`(?<![\\w./@~-])((?:${prefixos.map(esc).join("|")})/[A-Za-z0-9_.@/-]*[A-Za-z0-9_])`, "g");
  const ignorado = lerGitignore(repoRoot);
  const runtime = lerPrefixosDeRuntime(repoRoot);
  /** Raízes que o próprio repositório cita com placeholder (`workspace/businesses/{bu}`): criadas em tempo de execução. */
  const raizesDeTemplate = new Set();
  const ehRuntimeEsperado = (rel) =>
    runtimeDe(rel) !== null || // dentro de uma pasta de execução: o que falta é estado ainda não criado, não referência quebrada
    ignorado.some((f) => f(rel)) ||
    runtime.some((p) => rel === p || rel.startsWith(`${p}/`)) ||
    [...raizesDeTemplate].some((p) => rel === p || rel.startsWith(`${p}/`));

  /* ---- tipos ---- */
  const appRel = (() => {
    const r = posix(path.relative(repoRoot, appRoot));
    return r && !r.startsWith("..") ? r : null;
  })();
  const pacotes = new Set(arquivos.filter((f) => f.endsWith("/__init__.py") || f === "__init__.py").map((f) => path.posix.dirname(f)));
  const ehPacoteEngine = (rel) => rel.startsWith("engine") && (pacotes.has(rel) || (ehDir(rel) && existe(`${rel}/__init__.py`)));
  const tipoDe = (rel, dir) => {
    if (dir) {
      if (/^\.claude\/skills\/[^/]+$/.test(rel) && existe(`${rel}/SKILL.md`)) return "skill";
      if (ehPacoteEngine(rel)) return "engine";
      return "pasta-relevante";
    }
    const ext = path.posix.extname(rel).toLowerCase();
    if (/^\.claude\/hooks\//.test(rel) && EXT_CODIGO.has(ext)) return "hook";
    if (/^engine\/.*\.py$/.test(rel)) return "engine";
    if (EXT_CODIGO.has(ext) && /^(bin|scripts|\.claude\/scripts)\//.test(rel)) return "script";
    if (EXT_CODIGO.has(ext) && /(^|\/)scripts\//.test(rel)) return "script";
    if (ext === ".sh") return "script";
    return "arquivo";
  };

  /* ---- nós ---- */
  const nos = new Map(); // id → { id, type, label?, path?, rel? }
  const mortosPorMinusc = new Map(); // caixa baixa → id do nó morto (uma grafia só por caminho inexistente)
  const idRel = (rel) => (rel === "" ? "repo:mega-brain" : `p:${rel}`);
  /** Só recebe caminhos NA CAIXA REAL do disco. */
  const garanteNo = (rel, { dir = null, tipo = null } = {}) => {
    if (appRel && (rel === appRel || rel.startsWith(`${appRel}/`))) return "app:knowledge";
    const id = idRel(rel);
    if (!nos.has(id)) {
      const d = dir ?? ehDir(rel);
      nos.set(id, { id, type: tipo ?? tipoDe(rel, d), rel, path: nativo(repoRoot, rel), dir: d });
    }
    return id;
  };
  nos.set("repo:mega-brain", { id: "repo:mega-brain", type: "repo", label: path.basename(repoRoot), path: repoRoot, rel: "", dir: true });
  if (appRel) nos.set("app:knowledge", { id: "app:knowledge", type: "app", label: "Knowledge (app)", path: appRoot, rel: appRel, dir: true });
  const estruturais = new Set(["repo:mega-brain", ...(appRel ? ["app:knowledge"] : [])]);

  // pastas de 1º e 2º nível (menos as de runtime) e pacotes da engine
  for (const d of dirs) {
    if (runtimeDe(d)) {
      if (d.split("/").length <= 2) estruturais.add(garanteNo(d, { dir: true }));
      continue;
    }
    const prof = d.split("/").length;
    if (prof <= 2 || ehPacoteEngine(d) || (/^\.claude\/skills\/[^/]+$/.test(d) && existe(`${d}/SKILL.md`))) estruturais.add(garanteNo(d, { dir: true }));
  }
  // scripts: bin/, scripts/, .claude/scripts/
  for (const f of arquivos) {
    if (tipoDe(f, false) === "script" && /^(bin|scripts|\.claude\/scripts)\//.test(f)) estruturais.add(garanteNo(f, { dir: false }));
  }

  /* ---- arestas (acumuladores) ---- */
  const arestas = new Map();
  const aresta = (src, dst, type, extra = {}) => {
    if (src === dst) return;
    const key = `${type}\u0000${src}\u0000${dst}`;
    let e = arestas.get(key);
    if (!e) {
      e = { src, dst, type, n: 0, ...extra };
      arestas.set(key, e);
    }
    e.n += extra.n ?? 1;
    delete extra.n;
    return e;
  };
  const somaForma = (e, forma, k = 1) => {
    e.formas = e.formas ?? {};
    e.formas[forma] = (e.formas[forma] ?? 0) + k;
  };
  const SUFIXO_CAIXA = "-caixa-divergente";
  let caixaDivergente = 0;
  const exemplosCaixa = new Map(); // citado → real

  /**
   * Alvo (existente ou morto) de um caminho relativo ao repositório; null = ignorar.
   * Existente: o nó é sempre o da caixa REAL (`divergente` = a citação tinha outra caixa).
   */
  const alvoDe = (relBruto) => {
    const rel = path.posix.normalize(relBruto);
    if (rel.startsWith("..") || path.posix.isAbsolute(rel) || ehPessoal(rel)) return null;
    const r = disco.resolver(rel);
    if (r.ok) {
      let real = r.rel;
      if (ehPessoal(real)) return null;
      const rd = runtimeDe(real);
      if (rd) real = rd; // estado de execução é caixa-preta: a citação aponta para a pasta, não para o que há dentro
      if (r.divergente && !exemplosCaixa.has(rel)) exemplosCaixa.set(rel, real);
      return { id: garanteNo(real), morto: false, divergente: r.divergente };
    }
    const morto = r.prefixo ? `${r.prefixo}/${r.falta}` : r.falta;
    if (ehPessoal(morto) || ehRuntimeEsperado(rel) || ehRuntimeEsperado(morto)) return null;
    let id = mortosPorMinusc.get(morto.toLowerCase());
    if (!id) {
      id = `morto:${morto}`;
      mortosPorMinusc.set(morto.toLowerCase(), id);
      const ehArquivo = Boolean(path.posix.extname(morto));
      nos.set(id, { id, type: ehArquivo ? "arquivo" : "pasta-relevante", rel: morto, dir: !ehArquivo, morto: true });
    }
    return { id, morto: true, divergente: false };
  };

  /* ---- leitura (uma vez) e pré-passo: raízes de template ---- */
  const ehAncestral = (a, b) => b === a || b.startsWith(`${a}/`);
  let pulados = 0;
  const textos = [];
  for (const rel of arquivos) {
    const ext = path.posix.extname(rel).toLowerCase();
    if (!EXT_TEXTO.has(ext)) continue;
    const nome = path.posix.basename(rel);
    if (SENSITIVE_NAME.test(nome)) { pulados++; continue; }
    if (runtimeDe(rel)) continue;
    if (caminhoExcluido(nativo(repoRoot, rel))) continue;
    const st = stat(rel);
    if (!st || st.size > MAX_BYTES) continue;
    let texto;
    try { texto = readFileSync(nativo(repoRoot, rel), "utf8").replace(/\r\n?/g, "\n"); } catch { continue; }
    if (texto.includes("\u0000")) continue;
    if (detectSecret(texto)) { pulados++; continue; } // nunca processa arquivo com segredo (o valor nem é registrado)
    const limpo = texto.replace(/\$\{?[A-Z][A-Z0-9_]*\}?\//g, ""); // "$CLAUDE_PROJECT_DIR/.claude/…" → ".claude/…"
    const citacoes = [];
    for (const m of limpo.matchAll(reToken)) {
      const fim = m.index + m[0].length;
      citacoes.push({ tok: m[1], antes: limpo[m.index - 1] ?? "", resto: limpo.slice(fim, fim + 6) });
    }
    textos.push({ rel, ext, texto, citacoes });
  }
  for (const t of textos) {
    for (const c of t.citacoes) {
      // "workspace/businesses/{bu}/L0-identity": o repositório declara que `workspace/businesses` nasce em tempo de execução
      if (!/^\/[{<]/.test(c.resto)) continue;
      const pai = path.posix.dirname(c.tok);
      if (!disco.resolver(c.tok).ok && (pai === "." || ehDir(pai))) raizesDeTemplate.add(c.tok);
    }
  }

  /* ---- referências por arquivo ---- */
  let ignoradasParciais = 0;
  let ignoradasTemplate = 0;
  for (const { rel, ext, texto, citacoes } of textos) {
    const escopo = escopoDe(rel, ext);
    const dirDoArquivo = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
    let srcId = null;
    const origem = () => (srcId ??= garanteNo(rel, { dir: false }));
    const liga = (relAlvo, forma, deliberado = true) => {
      if (ehAncestral(relAlvo, rel)) return; // citar a própria pasta/arquivo não é dependência
      // pasta inexistente citada em prosa solta ("agents/the pipeline") não é referência: só vale entre aspas/crases ou com "/" no fim
      if (!deliberado && !disco.resolver(relAlvo).ok && !path.posix.extname(relAlvo)) return;
      const a = alvoDe(relAlvo);
      if (!a) return;
      const src = origem();
      if (src === a.id) return;
      const e = aresta(src, a.id, "referencia", { escopo });
      if (a.morto) e.alvo_morto = true;
      if (a.divergente) caixaDivergente++;
      somaForma(e, a.divergente ? `${forma}${SUFIXO_CAIXA}` : forma);
    };

    // 1) imports Python
    if (ext === ".py") {
      for (const imp of extrairImportsPython(texto)) {
        const partes = imp.modulo ? imp.modulo.split(".") : [];
        let base;
        if (imp.pontos > 0) {
          let d = dirDoArquivo;
          for (let k = 1; k < imp.pontos; k++) d = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "";
          base = d;
        } else {
          if (!partes.length || !(topDirs.includes(partes[0]) || ["core", "mega_brain_core"].includes(partes[0]))) continue;
          base = "";
        }
        const juntar = (...xs) => xs.filter(Boolean).join("/");
        const modRel = juntar(base, ...partes);
        if (!modRel) continue; // "from . import x" na raiz
        // melhor alvo do módulo: arquivo .py, senão pacote (pasta); se nada existe, o .py inexistente é o alvo morto
        const alvoDoModulo = ehArq(`${modRel}.py`) ? `${modRel}.py` : ehDir(modRel) ? modRel : `${modRel}.py`;
        const alvos = [];
        if (imp.nomes.length && !imp.nomes.includes("*")) {
          for (const n of imp.nomes) {
            const sub = juntar(modRel, n);
            if (ehArq(`${sub}.py`)) alvos.push(`${sub}.py`);
            else if (ehDir(sub)) alvos.push(sub);
            else alvos.push(alvoDoModulo);
          }
        } else alvos.push(alvoDoModulo);
        for (const a of alvos) liga(a, "import");
      }
    }

    // 2) require/import relativo em JS
    if ([".js", ".mjs", ".cjs"].includes(ext)) {
      for (const m of texto.matchAll(/(?:require\(\s*|from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"\n]+)['"]/g)) {
        const alvo = path.posix.normalize(path.posix.join(dirDoArquivo, m[1]));
        if (alvo.startsWith("..")) continue;
        const cand = [alvo, `${alvo}.js`, `${alvo}.mjs`, `${alvo}.cjs`, `${alvo}.json`, `${alvo}/index.js`].find(existe);
        liga(cand ?? alvo, "relativo");
      }
    }

    // 3) caminhos citados a partir da raiz do repositório
    for (const c of citacoes) {
      const tok = c.tok.replace(/[.]+$/, "");
      const cont = continuacaoDe(c.resto, c.antes);
      if (cont === "parcial") {
        // `DOSSIER-{NOME}.md`, `kops-*.md`: o nome é um padrão, mas a pasta que o contém é uma dependência real
        ignoradasParciais++;
        const pasta = path.posix.dirname(tok);
        if (pasta !== "." && disco.resolver(pasta).ok) liga(pasta, "caminho-repo", true);
        continue;
      }
      if (cont === "dir-glob" && !disco.resolver(tok).ok) { ignoradasTemplate++; continue; }
      // caminho entre aspas que continua em prosa ("'.claude/agents/the knowledge system/agents/'"): o espaço faz parte do nome
      if (/["'`]/.test(c.antes) && /^ [a-z]{2,}/.test(c.resto) && !path.posix.extname(tok) && !disco.resolver(tok).ok) { ignoradasParciais++; continue; }
      liga(tok, "caminho-repo", /["'`]/.test(c.antes) || /["'`/]/.test(c.resto[0] ?? ""));
    }
  }

  /* ---- hooks ligados em .claude/settings.json (executa) ---- */
  const settings = caminhoExcluido(path.join(repoRoot, ".claude", "settings.json")) ? null : readJsonSafe(path.join(repoRoot, ".claude", "settings.json"));
  let hooksLigados = 0;
  const SET = ".claude/settings.json";
  const cfg = await settings;
  if (cfg?.hooks && typeof cfg.hooks === "object") {
    const setId = garanteNo(SET, { dir: false, tipo: "arquivo" });
    estruturais.add(setId);
    const porEvento = Object.entries(cfg.hooks).sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [evento, grupos] of porEvento) {
      for (const g of Array.isArray(grupos) ? grupos : []) {
        for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
          const cmd = String(h?.command ?? "").replace(/\$\{?[A-Z][A-Z0-9_]*\}?\//g, "");
          const alvos = [...cmd.matchAll(/(\.claude\/hooks\/[A-Za-z0-9_.-]+)/g)].map((m) => m[1]);
          if (!alvos.length) continue;
          hooksLigados++;
          for (const a of alvos) {
            const t = alvoDe(a);
            if (!t) continue;
            if (!t.morto) estruturais.add(t.id);
            const e = aresta(setId, t.id, "executa", { papel: evento });
            if (t.morto) e.alvo_morto = true;
            if (t.divergente) { e.quebrado = true; caixaDivergente++; }
            if (e.papel !== evento && !e.papel.split(",").includes(evento)) e.papel = [...new Set([...e.papel.split(","), evento])].sort().join(",");
          }
        }
      }
    }
  } else avisos.push(".claude/settings.json ausente ou sem hooks: nenhuma aresta executa");

  /* ---- git remotes ---- */
  for (const r of lerRemotes(repoRoot)) {
    const id = `remote:${r.nome}`;
    const alias = r.url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, "").replace(/\.git$/, "");
    nos.set(id, { id, type: "remote", label: `${r.nome} (${alias})` });
    estruturais.add(id);
    const e = aresta("repo:mega-brain", id, "git_remote", { remote: r.nome, url: r.url });
    if (r.pushDesabilitado) e.push_desabilitado = true;
  }

  /* ---- planos (prefixo → plano; vale o prefixo mais específico) ---- */
  const planos = new Map(); // nome → { label }
  const prefixosDePlano = []; // { prefixo, plano }
  // camadas do workspace L0..L4 (CLAUDE.md): os diretórios L<n>-<nome> reais do repositório
  for (const d of dirs) {
    const m = d.match(/(^|\/)(L\d)-([a-z]+)$/);
    if (!m) continue;
    const nome = `workspace-${m[2].toLowerCase()}-${m[3]}`;
    planos.set(nome, { label: `Workspace ${m[2]} — ${m[3]}` });
    prefixosDePlano.push({ prefixo: d, plano: nome });
    estruturais.add(garanteNo(d, { dir: true }));
    for (const f of arquivos) {
      if (!f.startsWith(`${d}/`) || !/\.(md|ya?ml)$/.test(f) || SENSITIVE_NAME.test(path.posix.basename(f))) continue;
      estruturais.add(garanteNo(f, { dir: false }));
    }
  }
  // camadas de distribuição (docs/LAYERS.md, listas "What belongs in Ln"): a pasta listada e tudo abaixo dela
  for (const [chave, c] of Object.entries(lerCamadasDeDistribuicao(repoRoot))) {
    const nome = `distribuicao-${chave}`;
    planos.set(nome, { label: `${chave.toUpperCase()} — ${c.titulo}` });
    for (const cam of c.caminhos) {
      if (!existe(cam) || ehPessoal(cam)) continue;
      prefixosDePlano.push({ prefixo: cam, plano: nome });
      estruturais.add(garanteNo(cam));
    }
  }
  prefixosDePlano.sort((x, y) => y.prefixo.length - x.prefixo.length);

  /* ---- poda: nó entra se estrutural, ou se participa de aresta ---- */
  const emAresta = new Set();
  for (const e of arestas.values()) { emAresta.add(e.src); emAresta.add(e.dst); }
  for (const [id, n] of [...nos]) {
    if (id.startsWith("remote:")) continue;
    if (!estruturais.has(id) && !emAresta.has(id) && !n.morto) nos.delete(id);
  }

  /* ---- ancestrais (para a hierarquia ficar conexa) ---- */
  const ancestraisDe = (rel) => {
    const out = [];
    let d = path.posix.dirname(rel);
    while (d && d !== ".") { out.push(d); d = path.posix.dirname(d); }
    return out;
  };
  for (const n of [...nos.values()]) {
    if (n.rel === undefined || n.rel === "" || n.morto || n.id === "app:knowledge") continue;
    for (const a of ancestraisDe(n.rel)) {
      if (RUNTIME_DIRS.has(a) || appRel && a === appRel) continue;
      garanteNo(a, { dir: true });
    }
  }

  /* ---- contem (pasta → filho mais próximo presente no conjunto); alvo morto não é contido por ninguém ---- */
  const porRel = new Map([...nos.values()].filter((n) => n.rel !== undefined && !n.morto).map((n) => [n.rel, n.id]));
  for (const n of nos.values()) {
    if (n.id === "repo:mega-brain" || n.rel === undefined || n.morto) continue;
    let pai = "repo:mega-brain";
    for (const a of ancestraisDe(n.rel)) {
      if (porRel.has(a)) { pai = porRel.get(a); break; }
    }
    if (n.id === "app:knowledge") pai = "repo:mega-brain";
    aresta(pai, n.id, "contem");
  }

  /* ---- pertence_a (planos) ---- */
  const usados = new Set();
  for (const n of [...nos.values()].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (n.rel === undefined || n.rel === "" || n.morto || n.id === "app:knowledge") continue;
    const hit = prefixosDePlano.find((p) => n.rel === p.prefixo || n.rel.startsWith(`${p.prefixo}/`));
    if (!hit) continue;
    usados.add(hit.plano);
    aresta(n.id, `plano:${hit.plano}`, "pertence_a");
  }
  for (const nome of [...usados].sort()) nos.set(`plano:${nome}`, { id: `plano:${nome}`, type: "plano", label: planos.get(nome).label });

  /* ---- rótulos (menor sufixo de caminho único) ---- */
  const comRel = [...nos.values()].filter((n) => n.rel !== undefined && n.id !== "repo:mega-brain" && n.id !== "app:knowledge");
  const sufixos = (rel, k) => rel.split("/").slice(-k).join("/");
  for (const n of comRel) {
    const max = n.rel.split("/").length;
    let k = Math.min(max, 2); // pelo menos "pasta/nome" para dar contexto
    while (k < Math.min(max, 4) && comRel.filter((o) => sufixos(o.rel, k) === sufixos(n.rel, k)).length > 1) k++;
    n.label = `${sufixos(n.rel, k)}${n.dir && !n.morto ? "/" : ""}${n.morto ? " (inexistente)" : ""}`;
  }

  /* ---- serialização determinística ---- */
  const ORDEM_TIPO = { contem: 0, pertence_a: 1, referencia: 2, executa: 3, git_remote: 4 };
  const nodesOut = [...nos.values()]
    .filter((n) => n.label !== undefined)
    // nó morto não tem `path`: não há o que mover, e `impactoDeMover` não deve contá-lo no escopo de uma pasta
    .map((n) => ({ id: n.id, type: n.type, label: n.label, ...(n.path && !n.morto ? { path: n.path } : {}) }))
    .sort((a, b) => porOrdem(a.id, b.id));
  const idsValidos = new Set(nodesOut.map((n) => n.id));
  const edgesOut = [...arestas.values()]
    .filter((e) => idsValidos.has(e.src) && idsValidos.has(e.dst))
    .map((e) => {
      const o = { src: e.src, dst: e.dst, type: e.type, n: e.n };
      if (e.escopo) o.escopo = e.escopo;
      if (e.alvo_morto) o.alvo_morto = true;
      // `quebrado` quando TODAS as citações da aresta têm a caixa errada (se só algumas, as formas mostram quais)
      if (e.quebrado || (e.formas && Object.keys(e.formas).every((f) => f.endsWith(SUFIXO_CAIXA)))) o.quebrado = true;
      if (e.formas) o.formas = Object.fromEntries(Object.entries(e.formas).sort());
      if (e.papel) o.papel = e.papel;
      if (e.remote) o.remote = e.remote;
      if (e.url) o.url = e.url;
      if (e.push_desabilitado) o.push_desabilitado = true;
      return o;
    })
    .sort((a, b) => ORDEM_TIPO[a.type] - ORDEM_TIPO[b.type] || porOrdem(a.src, b.src) || porOrdem(a.dst, b.dst));

  // carimbo só muda quando o conteúdo muda
  const hashConteudo = sha256(JSON.stringify({ nodesOut, edgesOut }));
  const anterior = await readJsonSafe(path.join(topoDir, "nodes.json"));
  const geradoEm = anterior?.conteudo_sha256 === hashConteudo && anterior?.gerado_em ? anterior.gerado_em : new Date().toISOString();
  const env = { versao: VERSAO, gerado_em: geradoEm, conteudo_sha256: hashConteudo, fonte: "mega-brain (somente leitura)", truncado: false };
  // um extrato que não foi gerado por este módulo (sem o nosso carimbo) é preservado ao lado, nunca sobrescrito às cegas
  for (const nome of ["nodes", "edges"]) {
    const atual = path.join(topoDir, `${nome}.json`);
    const bak = path.join(topoDir, `${nome}.pre-populate.json`);
    if (!existsSync(atual) || existsSync(bak)) continue;
    const j = await readJsonSafe(atual);
    if (!j?.conteudo_sha256) {
      await copyFile(atual, bak);
      avisos.push(`${nome}.json existente não era deste módulo: cópia preservada em ${nome}.pre-populate.json`);
    }
  }
  const gravar = async (nome, obj) => {
    const arq = path.join(topoDir, `${nome}.json`);
    const novo = `${JSON.stringify(obj, null, 2)}\n`;
    if (existsSync(arq) && readFileSync(arq, "utf8") === novo) return; // mesmo conteúdo: mantém o mtime (cache do app)
    await writeJson(arq, obj);
  };
  await gravar("nodes", { ...env, total: nodesOut.length, nodes: nodesOut });
  await gravar("edges", { ...env, total: edgesOut.length, edges: edgesOut });

  /* ---- relatório ---- */
  const contagemTipo = (xs, f) => Object.fromEntries(Object.entries(xs.reduce((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {})).sort());
  const mortos = edgesOut.filter((e) => e.alvo_morto && e.type === "referencia");
  const porMorto = new Map();
  for (const e of mortos) {
    const o = porMorto.get(e.dst) ?? { n: 0, origens: new Set(), imports: 0 };
    o.n += e.n;
    o.origens.add(e.src);
    o.imports += e.formas?.import ?? 0;
    porMorto.set(e.dst, o);
  }
  const relDoMorto = (id) => id.replace(/^morto:/, "");
  const ordenados = [...porMorto].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1));
  const fmt = ([id, o]) => `${relDoMorto(id)}×${o.n}${o.imports ? ` (${o.imports} imports)` : ""} em ${o.origens.size} arquivo(s)`;
  const tipoDoNo = new Map(nodesOut.map((n) => [n.id, n.type]));
  const arquivosMortos = ordenados.filter(([id]) => tipoDoNo.get(id) === "arquivo").slice(0, 6).map(fmt);
  const pastasMortas = ordenados.filter(([id]) => tipoDoNo.get(id) !== "arquivo").slice(0, 6).map(fmt);
  if (arquivosMortos.length) avisos.push(`arquivos inexistentes mais citados: ${arquivosMortos.join("; ")}`);
  if (pastasMortas.length) avisos.push(`pastas inexistentes mais citadas: ${pastasMortas.join("; ")}`);
  if (caixaDivergente) {
    const ex = [...exemplosCaixa].sort(([a], [b]) => porOrdem(a, b)).slice(0, 4).map(([citado, real]) => `${citado} → ${real}`);
    avisos.push(
      `${caixaDivergente} citação(ões) com a caixa diferente da real em ${exemplosCaixa.size} caminho(s) (funcionam em Windows/macOS padrão, quebram em Linux/CI): ${ex.join("; ")}`,
    );
  }
  if (ignoradasParciais + ignoradasTemplate) {
    avisos.push(
      `${ignoradasParciais + ignoradasTemplate} citação(ões) com placeholder, glob, nome parcial ou espaço no nome tratadas como padrão, não como caminho (nenhuma virou "inexistente")`,
    );
  }
  if (!incluirPessoal && ["knowledge/personal", "agents/personal"].some((p) => existsSync(nativo(repoRoot, p)))) {
    avisos.push("bucket pessoal (knowledge/personal, agents/personal) fora da topologia; use --include-personal para incluir");
  }
  const settingsDeclarados = Object.values(cfg?.hooks ?? {}).flat().flatMap((g) => g?.hooks ?? []).length;
  if (settingsDeclarados) {
    const claude = !caminhoExcluido(path.join(repoRoot, ".claude", "CLAUDE.md")) && existsSync(path.join(repoRoot, ".claude", "CLAUDE.md")) ? readFileSync(path.join(repoRoot, ".claude", "CLAUDE.md"), "utf8") : "";
    const afirmado = claude.match(/(\d+)\s+wired/)?.[1];
    avisos.push(
      `settings.json liga ${settingsDeclarados} comandos de hook (arestas executa: ${edgesOut.filter((e) => e.type === "executa").length})` +
        (afirmado && Number(afirmado) !== settingsDeclarados ? `; o CLAUDE.md afirma "${afirmado} wired"` : ""),
    );
  }
  if (pulados) avisos.push(`${pulados} arquivo(s) não lidos por regra de segurança (nome sensível ou conteúdo com padrão de segredo)`);
  log("topologia", `${textos.length} arquivos lidos para extrair referências`);

  const refs = edgesOut.filter((e) => e.type === "referencia");
  return {
    resumo: {
      nos: nodesOut.length,
      arestas: edgesOut.length,
      nosPorTipo: contagemTipo(nodesOut, (n) => n.type),
      arestasPorTipo: contagemTipo(edgesOut, (e) => e.type),
      alvosMortos: mortos.length,
      caixaDivergente: edgesOut.filter((e) => e.quebrado && !e.alvo_morto).length,
      escopo: contagemTipo(refs, (e) => e.escopo ?? "sem-escopo"),
      planos: nodesOut.filter((n) => n.type === "plano").length,
      hooksLigados,
    },
    avisos,
  };
}
