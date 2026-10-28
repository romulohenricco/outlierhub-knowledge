/**
 * Módulo "agente" — inventário da página /agente a partir do que existe no mega-brain.
 *
 * Gera (e só isto):
 *   data/agente/registro.yaml      registro de entidades (docs/agente-registro.md)
 *   data/agente/repos.json         o próprio repositório
 *   data/agente/espelhos.json      [] (o registro já cobre tudo; ver `resumo.espelhos`)
 *   data/agente/organizacao.json   organização do grafo Radial/Neural (lib/brain/organizacao.ts): pilar = squad ou
 *                                  categoria do ecosystem-registry.yaml; agentes, tarefas (com o `responsavel` que a
 *                                  task declara) e ferramentas (`deterministic_helper(s)` do agent-registry.yaml)
 *
 * NÃO gera uso.json (não há evidência real de uso), nem pessoas/execuções na organização (o mega-brain não as
 * registra), nem data/agente/memoria/ (não há pasta de notas ligadas por [[wikilinks]]; o núcleo só desenha notas
 * com link). NUNCA toca em favoritos.json / ocultos.json (são do app/usuário).
 *
 * Fontes (todas reais, lidas de ctx.docs — o corpus já filtrado contra segredos):
 *   agents/_registry/ecosystem-registry.yaml   status dos agentes (só entradas com arquivo)
 *   agents/** /agent.md, engine/** /AGENT.md    agentes (Conclave, JARVIS, agent-creator, …)
 *   squads/<s>/{squad|config}.yaml              squads; agents/ → worker; tasks/ e workflows/ → workflow
 *   .claude/skills/<n>/SKILL.md                 skills (+ status do skill-registry.yaml)
 *   .claude/commands/** .md                     comandos (kind skill; nome "/x" ou "/ns:x")
 *   .claude/agents/*.md                         subagentes do Claude Code (kind agent)
 *   engine/<dir>                                engines (diretórios com código ou AGENT.md)
 *   engine/workflows, engine/tasks, …/workflows workflows
 *
 * Mapeamento para os tipos do app (que não tem "task" nem "comando"): agente de squad → worker (o filtro
 * por squad da tela lista "workers"); agente avulso e subagente do Claude Code → agent; task e workflow
 * → workflow; skill e comando → skill (comando aparece como "/nome" ou "/ns:nome"); marcador de cobertura
 * (`_executor-coverage`) e entradas sem arquivo viram aviso, não entidade.
 *
 * Procedência/owner pelo git (somente leitura): arquivo que existe desde o commit raiz e
 * nunca foi tocado depois (nem modificado na árvore de trabalho) = "adotada" / owner do
 * remote `upstream`. Tocado por commit posterior, ou ausente do histórico (arquivo local
 * novo) = "propria" / owner do remote `origin`. Diretório: "propria" se QUALQUER arquivo
 * dele for próprio. Sem git: tudo "propria" + aviso. Remote ausente (ou fora do formato
 * https://host/<owner>/…) = owner null: nenhum nome é inventado.
 *
 * Regeneração: as linhas do registro cujo rid começa com "megabrain." são nossas e são
 * reescritas; as demais (suas) são preservadas. Em repos.json/espelhos.json e em cada lista do
 * organizacao.json, linhas com `gerado_por: "populate:agente"` são nossas; as demais ficam (no
 * organizacao.json, na frente das nossas, e uma linha sua com o mesmo `id` de uma nossa vence). Se a linha do próprio repo perdeu a
 * marca (você a assumiu e a enriqueceu), ela é preservada como está e a nossa não é gerada por cima.
 *
 * Nada aborta o módulo por causa do conteúdo do repositório: `rid` repetido (ex.: `foo.md` e `foo.yaml`
 * na mesma pasta; `/foo-bar` e `/foo:bar`) ganha sufixo estável e vira aviso. O git é lido sem nunca
 * escrever em `.git/` (`--no-optional-locks`).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { ativarExclusoes, caminhoExcluido, detectSecret, log, prefixoDoRepositorio, sha256, slugify, writeText } from "./common.mjs";

const MODULO = "agente";
export const PREFIXO_RID = "megabrain.";
export const MARCA_AGENTE = "populate:agente";

const KINDS = ["squad", "agent", "skill", "workflow", "clone", "shadow", "worker", "engine", "repo"];
const ORDEM_KIND = { repo: 0, engine: 1, squad: 2, agent: 3, worker: 4, skill: 5, workflow: 6, clone: 7, shadow: 8 };
const ROLE_MAX = 400;

/* ------------------------------------------------------------------ texto */

/** Remove marcação Markdown/HTML de uma frase e colapsa espaços. */
export function limpaMd(s) {
  return String(s ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Corta em `max` code points, preferindo fim de palavra; acrescenta "…" quando cortou. */
export function corta(s, max = ROLE_MAX) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  const cps = [...t];
  if (cps.length <= max) return t;
  let cut = cps.slice(0, max - 1).join("");
  const sp = cut.lastIndexOf(" ");
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return `${cut.replace(/[\s,;:.\-–—(]+$/, "")}…`;
}

const letras = (s) => (s.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
const palavras = (s) => (s.match(/\S+/g) ?? []).length;

/** Frontmatter YAML (`---` … `---`) + corpo. Frontmatter malformado vira `fm: null`. */
export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { fm: null, corpo: text };
  let fm = null;
  try {
    const v = loadYaml(m[1]);
    if (v && typeof v === "object" && !Array.isArray(v)) fm = v;
  } catch {
    fm = null;
  }
  return { fm, corpo: text.slice(m[0].length) };
}

/** `description:` numa linha das primeiras 40, fora de bloco de código (frontmatter quebrado ou duplicado no meio do arquivo). */
function descricaoPorLinha(text) {
  let cerca = false;
  for (const l of text.split("\n").slice(0, 40)) {
    if (/^\s*```/.test(l)) { cerca = !cerca; continue; }
    if (cerca) continue;
    const m = l.match(/^description:\s*["']?(.+?)["']?\s*(?:---)?\s*$/);
    if (m && letras(m[1]) >= 15) return m[1];
  }
  return null;
}

/** Primeiro valor-texto de uma das chaves (prioridade na ordem de `chaves`), no objeto ou um nível abaixo. */
function cava(obj, chaves) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of chaves) {
    const v = obj[k];
    if (typeof v === "string" && letras(v) >= 15) return v;
    for (const filho of Object.values(obj)) {
      if (filho && typeof filho === "object" && !Array.isArray(filho)) {
        const w = filho[k];
        if (typeof w === "string" && letras(w) >= 15) return w;
      }
    }
  }
  return null;
}

const CHAVES_DESCRICAO = ["description", "descricao", "mission", "purpose", "summary", "resumo", "objetivo", "role"];

/** Primeiro bloco ```yaml parseável do Markdown (definições embutidas de agentes). */
function blocoYaml(corpo) {
  const m = corpo.match(/```ya?ml\n([\s\S]*?)\n```/);
  if (!m) return null;
  try {
    const v = loadYaml(m[1]);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Parágrafos "de prosa" do Markdown, cada um com o último título visto. Itens de lista entram separados por "; ". */
function paragrafos(corpo) {
  const out = [];
  let atual = []; // { txt, lista }
  let titulo = "";
  let ordem = 0; // quantos títulos já passaram (prosa de introdução vem cedo)
  let cerca = false;
  const flush = () => {
    if (atual.length) {
      let texto = "";
      atual.forEach((it, i) => {
        const ant = atual[i - 1];
        texto += i === 0 ? it.txt : it.lista && ant?.lista ? `; ${it.txt}` : ` ${it.txt}`;
      });
      texto = limpaMd(texto);
      if (letras(texto) >= 25 && palavras(texto) >= 4) out.push({ titulo, texto, ordem });
    }
    atual = [];
  };
  for (const bruta of corpo.split("\n")) {
    const l = bruta.trimEnd();
    if (/^\s*```/.test(l)) { flush(); cerca = !cerca; continue; }
    if (cerca) continue;
    if (!l.trim()) { flush(); continue; }
    const h = l.match(/^#{1,6}\s+(.*)$/);
    if (h) { flush(); ordem++; titulo = limpaMd(h[1]).replace(/[^\p{L}\p{N}\s/-]/gu, " ").replace(/\s+/g, " ").trim(); continue; }
    if (/^\s*([-*_=]){3,}\s*$/.test(l)) { flush(); continue; }
    if (/^\s*(>|\||<!--|!\[|\[!\[)/.test(l)) { flush(); continue; }
    if (/^\s*[─═━╔╗╚╝║┌┐└┘│]/.test(l)) { flush(); continue; }
    if (/^\s*(auto-trigger|keywords|prioridade|tools|vers[aã]o|version|criado|status)\s*:/i.test(l)) { flush(); continue; }
    const lista = /^\s*(?:[-*+]|\d+[.)])\s+/.test(l);
    atual.push({ txt: l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s*/, ""), lista });
  }
  flush();
  return out;
}

const SECOES_PREFERIDAS = [
  /^(prop[óo]sito|purpose|objetivo|objective)\b/i,
  /^(descri[çc][ãa]o|description)\b/i,
  /^(o que faz|what (this skill |it |this )?does|conceito|overview|vis[ãa]o geral|mission|miss[ãa]o|resumo|summary|about)\b/i,
];
/** Seções cujo texto não descreve o item (quando NÃO usar, gatilhos, sintaxe, exemplos…). */
const SECOES_RUINS = /^(quando n[aã]o|when not|n[aã]o ativar|gatilhos?|triggers?|instru[cç][ãa]o|sintaxe|syntax|uso|usage|exemplos?|examples?|regras?|rules?|anti|scope|does not|does|a[cç][aã]o obrigat|comportamento|execu[cç][ãa]o|inicializa|formato|template|fluxo|passos?|steps?|etapas?|fontes|c[aá]lculo|arquivos|protocolos?)/i;
const BOILERPLATE = /^(activation-notice|critical:|this file contains your full|ia-?\w*\s*:)/i;

/** Valor da linha de tabela "| **Role** | … |" (Role/Papel/Descrição), quando o Markdown a tem. */
function papelDeTabela(corpo) {
  for (const l of corpo.split("\n")) {
    const c = l.split("|").map((x) => limpaMd(x));
    if (c.length >= 4 && /^(role|papel|descri[çc][ãa]o|description|purpose)$/i.test(c[1]) && letras(c[2]) >= 12) return c[2];
  }
  return null;
}

/** Resumo do Markdown: tabela "Role" → seção "Propósito/Descrição/…" → 1º parágrafo útil → título. */
export function resumoMarkdown(corpo) {
  const tabela = papelDeTabela(corpo);
  if (tabela) return tabela;
  const ps = paragrafos(corpo).filter((p) => !BOILERPLATE.test(p.texto));
  const completa = (p) => {
    // "…acionado quando:" continua no parágrafo seguinte da mesma seção
    if (!/:$/.test(p.texto)) return p.texto;
    const prox = ps[ps.indexOf(p) + 1];
    return prox && prox.titulo === p.titulo ? `${p.texto} ${prox.texto}` : p.texto.replace(/:$/, "");
  };
  for (const re of SECOES_PREFERIDAS) {
    const p = ps.find((x) => re.test(x.titulo));
    if (p) return completa(p);
  }
  const util = ps.find((x) => x.ordem <= 4 && !SECOES_RUINS.test(x.titulo)); // prosa funda no documento costuma ser instrução, não descrição
  if (util) return completa(util);
  // sem prosa aproveitável: o próprio título do documento (H1 + primeiro H2) ainda é conteúdo real
  const h1 = corpo.match(/^#\s+(.+?)\s*$/m)?.[1];
  const h2 = corpo.match(/^#\s+.+\n+##\s+(.+?)\s*$/m)?.[1]; // só o H2 colado ao H1 (subtítulo)
  const titulo = limpaMd([h1?.replace(/^\/[\w:-]+\s+[-–—]\s+/, ""), h2].filter(Boolean).join(" — "));
  return letras(titulo) >= 12 ? titulo : null;
}

/** Parágrafo de uma seção "Propósito/Descrição/…" (sem cair no primeiro parágrafo qualquer), ou null. */
export function resumoPreferido(corpo) {
  const ps = paragrafos(corpo);
  for (const re of SECOES_PREFERIDAS) {
    const p = ps.find((x) => re.test(x.titulo));
    if (p) return p.texto;
  }
  return null;
}

/** Linhas de comentário `#` do topo de um YAML/Python (cabeçalho descritivo), sem separadores. */
function cabecalhoComentario(text) {
  const out = [];
  for (const l of text.split("\n").slice(0, 25)) {
    if (!l.startsWith("#")) { if (out.length) break; else continue; }
    const t = l.replace(/^#+\s?/, "").trim();
    if (!t || /^[=\-_*#]+$/.test(t)) continue;
    if (/^(source|story|version|vers[aã]o|data|date|consumer|legacy|padr[aã]o|schema|adapt)\b/i.test(t)) continue;
    out.push(t);
    if (out.length >= 3) break;
  }
  const txt = limpaMd(out.join(" — "));
  return letras(txt) >= 25 ? txt : null;
}

/**
 * Papel curto (≤400) de um documento, extraído do próprio conteúdo:
 * frontmatter/YAML (`description`, `mission`, …) → seção de propósito → 1º parágrafo → comentário de cabeçalho.
 */
export function papelDeDoc(doc) {
  const t = doc.text;
  let bruto = null;
  if (doc.ext === ".md") {
    const { fm, corpo } = frontmatter(t);
    // sem frontmatter válido o `description:` pode estar quebrado ou no meio do arquivo; com ele, não se procura em código
    bruto = (fm && cava(fm, CHAVES_DESCRICAO)) ?? (fm ? null : descricaoPorLinha(t)) ?? resumoMarkdown(corpo);
  } else if (doc.ext === ".yaml" || doc.ext === ".yml") {
    let y = null;
    try { y = loadYaml(t); } catch { y = null; }
    bruto = cava(y, CHAVES_DESCRICAO) ?? cabecalhoComentario(t);
  } else if (doc.ext === ".json") {
    let j = null;
    try { j = JSON.parse(t); } catch { j = null; }
    bruto = cava(j, ["description", "title"]);
  } else if (doc.ext === ".py" || doc.ext === ".sh") {
    bruto = cabecalhoComentario(t);
  }
  const txt = bruto ? corta(limpaMd(bruto), ROLE_MAX) : "";
  return txt && !detectSecret(txt) ? txt : "";
}

/* ------------------------------------------------------------------ git (somente leitura) */

/**
 * Roda o git SEM nunca escrever em `.git/`: `--no-optional-locks` (+ `GIT_OPTIONAL_LOCKS=0`) faz o
 * `git status` deixar de atualizar/regravar o índice quando o stat dos arquivos está velho. Sem isto, só
 * ler o estado mexeria no `.git/index` do mega-brain (e tomaria o `index.lock`), podendo colidir com um
 * `git add`/`commit` concorrente de outro agente. O mega-brain é SOMENTE LEITURA.
 */
function git(repoRoot, args) {
  return execFileSync("git", ["--no-optional-locks", "-C", repoRoot, "-c", "core.quotepath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

/** `https://user:senha@host/x/y.git` → `https://host/x/y` (nunca devolve credencial). */
export function urlSemCredencial(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const ssh = s.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  try {
    const u = new URL(s);
    u.username = "";
    u.password = "";
    return `${u.protocol}//${u.host}${u.pathname.replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * Lê o git UMA vez (cacheado em ctx.gitInfo): histórico agregado (`git log --name-only`),
 * arquivos rastreados, modificações da árvore e os remotes. Nunca lança: sem git devolve
 * `{ ok: false, motivo }`.
 */
export function lerGit(ctx) {
  if (ctx.gitInfo) return ctx.gitInfo;
  const info = { ok: false, motivo: "", inicial: new Set(), depois: new Set(), modificados: new Set(), rastreados: new Set(), head: null, origin: null, upstream: null };
  try {
    info.head = git(ctx.repoRoot, ["rev-parse", "--short", "HEAD"]).trim() || null;
    // uma única chamada agregada: cada bloco = hash + pais, linha em branco, arquivos
    const bruto = git(ctx.repoRoot, ["log", "--no-renames", "--name-only", "--format=%x01%H %P"]);
    for (const bloco of bruto.split("\x01").slice(1)) {
      const [cab, ...resto] = bloco.split("\n");
      const ehRaiz = cab.trim().split(/\s+/).length === 1; // só o hash: sem pais
      for (const f of resto) {
        const arq = f.trim();
        if (arq) (ehRaiz ? info.inicial : info.depois).add(arq);
      }
    }
    for (const f of git(ctx.repoRoot, ["ls-files", "-z"]).split("\0")) if (f) info.rastreados.add(f);
    for (const l of git(ctx.repoRoot, ["status", "--porcelain", "--untracked-files=no"]).split("\n")) {
      if (l.length > 3) info.modificados.add(l.slice(3).trim().replace(/^"|"$/g, ""));
    }
    for (const nome of ["origin", "upstream"]) {
      try { info[nome] = urlSemCredencial(git(ctx.repoRoot, ["remote", "get-url", nome])); } catch { info[nome] = null; }
    }
    info.ok = true;
  } catch (e) {
    info.motivo = String(e?.message ?? e).split("\n")[0].slice(0, 160);
  }
  ctx.gitInfo = info;
  return info;
}

const donoDaUrl = (u) => u?.match(/^https?:\/\/[^/]+\/([^/]+)\//)?.[1] ?? null;
const nomeDaUrl = (u) => u?.match(/\/([^/]+)$/)?.[1] ?? null;

/* ------------------------------------------------------------------ montagem */

const eMd = (d) => d.ext === ".md";
const base = (rel) => path.posix.basename(rel).replace(/\.[^.]+$/, "");
const semAdmin = (nome) => !/^(readme|index|changelog|license)$/i.test(nome) && !/(^_|-docs$|task-registry$)/i.test(nome);

export default async function run(ctx) {
  ativarExclusoes(ctx);
  const { repoRoot, docs } = ctx;
  const dataDir = ctx.dataDir;
  const avisos = [];
  const git0 = lerGit(ctx);
  if (!git0.ok) avisos.push(`git indisponível (${git0.motivo}) — procedência "propria" e owner vazio para tudo`);

  const dono = {
    propria: donoDaUrl(git0.origin),
    adotada: donoDaUrl(git0.upstream),
  };
  const nomeDono = (o) => o ?? "desconhecido";
  const byRel = new Map(docs.map((d) => [d.rel, d]));
  const sob = (prefixo) => docs.filter((d) => d.rel.startsWith(`${prefixo}/`));

  /* ---- procedência (git) ---- */
  const arquivoPropriedade = (rel) => {
    if (!git0.ok) return "propria";
    if (git0.depois.has(rel) || git0.modificados.has(rel)) return "propria";
    return git0.inicial.has(rel) ? "adotada" : "propria"; // fora do histórico = arquivo local novo
  };
  const procedenciaDe = (rel, ehDir) => {
    if (!git0.ok) return "propria";
    if (rel === ".") return "propria";
    if (!ehDir) return arquivoPropriedade(rel);
    const prefixo = `${rel}/`;
    for (const f of git0.depois) if (f.startsWith(prefixo)) return "propria"; // mexido (inclusive apagado) depois
    for (const f of git0.modificados) if (f.startsWith(prefixo)) return "propria";
    const arquivos = docs.filter((d) => d.rel.startsWith(prefixo));
    return arquivos.length && arquivos.every((d) => arquivoPropriedade(d.rel) === "adotada") ? "adotada" : "propria";
  };

  /* ---- registros existentes de apoio ---- */
  const lerYamlDoc = (rel) => {
    const d = byRel.get(rel);
    if (!d) return null;
    try { return loadYaml(d.text); } catch { return null; }
  };
  const ecoReg = lerYamlDoc("agents/_registry/ecosystem-registry.yaml");
  const skillReg = lerYamlDoc(".claude/skills/skill-registry.yaml");
  const statusAgentePorPath = new Map();
  for (const a of Array.isArray(ecoReg?.agents) ? ecoReg.agents : []) {
    if (a && typeof a.path === "string") statusAgentePorPath.set(a.path, typeof a.status === "string" ? a.status : null);
  }
  const skillRegPorPath = new Map();
  for (const s of Array.isArray(skillReg?.skills) ? skillReg.skills : []) {
    if (s && typeof s.path === "string") skillRegPorPath.set(s.path, s);
  }

  /* ---- coletor ---- */
  const entidades = [];
  const porRid = new Map(); // rid -> entidade que o tomou
  const extDe = (rel) => rel.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  /**
   * O app ignora em silêncio a 2ª linha com o mesmo `rid`, então um rid repetido não pode ir para o registro.
   * Colisão é dado do repositório (um `foo.md` e um `foo.yaml` na mesma pasta; `/foo-bar` e `/foo:bar`), não bug
   * do módulo: nunca derruba a população. A 1ª entidade (ordem estável: caminhos ordenados) mantém o rid de
   * sempre, e é só a(s) seguinte(s) que ganha(m) sufixo: a extensão quando ela distingue, senão um hash curto do
   * caminho. Assim o rid de quem já existia não muda quando um arquivo novo colide com ele.
   */
  const add = (e) => {
    if (!KINDS.includes(e.tipo)) throw new Error(`agente: tipo inválido "${e.tipo}" (${e.rid})`);
    if (!e.rid.startsWith(PREFIXO_RID)) throw new Error(`agente: rid sem prefixo ${PREFIXO_RID}: ${e.rid}`);
    const alvo = e.observed[0];
    const dono0 = porRid.get(e.rid);
    if (dono0) {
      if (dono0.tipo === e.tipo && dono0.observed[0] === alvo) {
        avisos.push(`rid ${e.rid} registrado duas vezes para ${alvo} — a repetição foi ignorada`);
        return;
      }
      const original = e.rid;
      const ext = extDe(alvo);
      const hash = sha256(alvo).slice(0, 6);
      const candidatos = [ext && ext !== extDe(dono0.observed[0]) ? `${original}.${ext}` : "", `${original}-${hash}`].filter(Boolean);
      let novo = candidatos.find((c) => !porRid.has(c));
      for (let n = 2; !novo; n++) if (!porRid.has(`${original}-${hash}-${n}`)) novo = `${original}-${hash}-${n}`;
      avisos.push(`rid ${original} já é de ${dono0.observed[0]}; ${alvo} foi registrado como ${novo}`);
      e = { ...e, rid: novo };
    }
    const ehDir = !/\.[a-z0-9]+$/i.test(alvo) || alvo === ".";
    const procedencia = procedenciaDe(alvo, ehDir);
    const entidade = { ...e, procedencia, owner: dono[procedencia] };
    porRid.set(e.rid, entidade);
    entidades.push(entidade);
  };
  const papel = (txt) => { const t = corta(limpaMd(txt ?? ""), ROLE_MAX); return t && !detectSecret(t) ? t : ""; };

  /* ================= repo ================= */
  const nomeRepo = nomeDaUrl(git0.origin) ?? path.basename(repoRoot);
  const readme = byRel.get("README.md");
  let readmeTagline = "";
  let readmeTitulo = "";
  if (readme) {
    readmeTitulo = readme.text.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() ?? "";
    const bloco = [];
    for (const l of readme.text.split("\n")) {
      if (l.startsWith(">")) bloco.push(l.replace(/^>\s?/, ""));
      else if (bloco.length) break;
    }
    readmeTagline = papel(bloco.join(" ")) || papel(resumoMarkdown(readme.text) ?? "");
  }
  add({ api_name: nomeRepo, tipo: "repo", rid: `${PREFIXO_RID}repo.${slugify(nomeRepo)}`, role: readmeTagline, observed: ["."] });

  /* ================= squads (+ workers, tasks, workflows) ================= */
  const nomesSquad = new Set();
  const squadsOrg = []; // { dir, nome, role, observado } — base dos pilares da organização
  const squadDirs = [...new Set(docs.filter((d) => /^squads\/[^/]+\/(squad|config)\.ya?ml$/.test(d.rel)).map((d) => d.rel.split("/")[1]))].sort();
  for (const dir of squadDirs) {
    const yml = byRel.get(`squads/${dir}/squad.yaml`) ?? byRel.get(`squads/${dir}/config.yaml`);
    let y = null;
    try { y = loadYaml(yml.text); } catch { y = null; }
    const nome = typeof y?.name === "string" && y.name.trim() ? y.name.trim() : dir;
    nomesSquad.add(nome);
    const status = [y?.metadata?.status, y?.status].find((v) => typeof v === "string" && v.trim()) ?? "";
    const roleSquad = papel(typeof y?.description === "string" ? y.description : papelDeDoc(yml));
    add({
      api_name: nome, tipo: "squad", rid: `${PREFIXO_RID}squad.${slugify(nome)}`,
      role: roleSquad,
      status: status.trim(), observed: [`squads/${dir}`],
    });
    squadsOrg.push({ dir, nome, role: roleSquad, observado: `squads/${dir}` });

    // workers = agentes do squad
    const workers = sob(`squads/${dir}/agents`).filter((d) => eMd(d) && d.rel.split("/").length === 4);
    for (const d of workers) {
      const id = base(d.rel);
      if (id.startsWith("_")) { avisos.push(`squads/${dir}/agents/${path.posix.basename(d.rel)} é marcador de cobertura (placeholder), não entra no inventário`); continue; }
      add({ api_name: id, tipo: "worker", rid: `${PREFIXO_RID}worker.${slugify(dir)}.${slugify(id)}`, role: papelDeAgenteMd(d), squad: nome, observed: [d.rel] });
    }
    // tasks e workflows do squad → kind workflow
    for (const [sub, rotulo] of [["tasks", "task"], ["workflows", "workflow"]]) {
      const arquivos = sob(`squads/${dir}/${sub}`).filter((d) => [".md", ".yaml", ".yml"].includes(d.ext) && d.rel.split("/").length === 4 && semAdmin(base(d.rel)));
      for (const d of arquivos) {
        const id = base(d.rel);
        add({ api_name: id, tipo: "workflow", rid: `${PREFIXO_RID}${rotulo}.${slugify(dir)}.${slugify(id)}`, role: papelDeDoc(d), squad: nome, observed: [d.rel] });
      }
      // o que o squad.yaml declara mas não existe no disco
      const declarados = Array.isArray(y?.components?.[sub]) ? y.components[sub].filter((v) => typeof v === "string") : [];
      const noDisco = new Set(sob(`squads/${dir}/${sub}`).map((d) => base(d.rel)));
      const faltam = declarados.filter((n) => !noDisco.has(n));
      if (faltam.length) avisos.push(`squads/${dir}/squad.yaml declara ${faltam.length} de ${declarados.length} ${sub} sem arquivo no disco (ex.: ${faltam.slice(0, 3).join(", ")}) — não registrados`);
    }
    const ag = Array.isArray(y?.components?.agents) ? y.components.agents.filter((v) => typeof v === "string") : [];
    const agDisco = new Set(sob(`squads/${dir}/agents`).map((d) => base(d.rel)));
    const agFaltam = ag.filter((n) => !agDisco.has(n));
    if (agFaltam.length) avisos.push(`squads/${dir}/squad.yaml declara agents sem arquivo: ${agFaltam.join(", ")}`);
  }

  /** Papel de um agente em Markdown: frontmatter → bloco yaml embutido (persona) → resumo. */
  function papelDeAgenteMd(d) {
    const { fm, corpo } = frontmatter(d.text);
    const emb = blocoYaml(corpo);
    const quando = typeof emb?.agent?.whenToUse === "string" && letras(emb.agent.whenToUse) > 15 && !/^agent:\s/i.test(emb.agent.whenToUse) ? emb.agent.whenToUse : "";
    const persona = typeof emb?.persona?.role === "string" ? emb.persona.role : "";
    const fmRole = typeof fm?.role === "string" ? fm.role : "";
    const principal = fmRole || persona || (typeof fm?.description === "string" ? fm.description : "");
    if (principal && quando) return papel(`${principal.trim().replace(/[.:;]$/, "")}. Quando usar: ${quando}`);
    if (principal) return papel(principal);
    if (quando) return papel(quando);
    return papel(resumoMarkdown(corpo) ?? "");
  }

  /* ================= agentes (Conclave, JARVIS, agent-creator, …) ================= */
  // perspectiva por agente, da tabela do README do diretório pai (ex.: agents/system/conclave/README.md)
  const perspectiva = (d) => {
    const readmeDir = byRel.get(`${path.posix.dirname(path.posix.dirname(d.rel))}/README.md`);
    if (!readmeDir) return "";
    const id = path.posix.basename(path.posix.dirname(d.rel));
    for (const l of readmeDir.text.split("\n")) {
      const c = l.split("|").map((s) => s.trim());
      if (c.length >= 5 && c[1] === id && c[3]) return c[3];
    }
    return "";
  };
  const agentFiles = docs.filter((d) => eMd(d)
    && ((/^agents\//.test(d.rel) && /\/agent\.md$/i.test(d.rel) && !/\/(_templates|_registry)\//.test(d.rel))
      || (/^engine\//.test(d.rel) && /\/AGENT\.md$/.test(d.rel))));
  const ridsAgente = new Set();
  for (const d of agentFiles) {
    const { fm } = frontmatter(d.text);
    const dir = path.posix.dirname(d.rel);
    const id = typeof fm?.id === "string" && fm.id.trim() ? fm.id.trim() : path.posix.basename(dir);
    let ridBase = `${PREFIXO_RID}agent.${slugify(id)}`;
    if (ridsAgente.has(ridBase)) ridBase = `${PREFIXO_RID}agent.${slugify(dir)}`;
    ridsAgente.add(ridBase);
    const papelBase = papelDeAgenteMd(d);
    const persp = perspectiva(d);
    add({
      api_name: id, tipo: "agent", rid: ridBase,
      role: papel(persp && papelBase ? `${papelBase} — ${persp}` : papelBase || persp),
      status: statusAgentePorPath.get(d.rel) ?? (typeof fm?.status === "string" ? fm.status : ""),
      observed: [d.rel],
    });
  }
  // entradas do ecosystem-registry.yaml: só as que têm arquivo; as demais viram aviso
  const placeholders = [];
  for (const a of Array.isArray(ecoReg?.agents) ? ecoReg.agents : []) {
    if (!a || typeof a.path !== "string" || typeof a.id !== "string") continue;
    if (!byRel.has(a.path)) { placeholders.push(a.id); continue; }
    if (!entidades.some((e) => e.observed[0] === a.path)) {
      const d = byRel.get(a.path);
      add({ api_name: a.id, tipo: "agent", rid: `${PREFIXO_RID}agent.${slugify(a.id)}`, role: papelDeAgenteMd(d), status: typeof a.status === "string" ? a.status : "", observed: [a.path] });
    }
  }
  if (placeholders.length) avisos.push(`ecosystem-registry.yaml: ${placeholders.length} entrada(s) sem arquivo no disco (${placeholders.join(", ")}) — não registradas`);
  const legados = docs.filter((d) => /^agents\/[^/]+\/[^/]+\/[^/]+\.md$/.test(d.rel) && !/\/README\.md$/i.test(d.rel));
  if (legados.length) avisos.push(`${legados.length} arquivo(s) planos soltos em agents/ (${legados.map((d) => path.posix.basename(d.rel)).join(", ")}) são variantes legadas dos agentes já registrados — não viram entidade própria`);

  /* ---- subagentes do Claude Code (.claude/agents/*.md) ---- */
  for (const d of docs.filter((x) => eMd(x) && /^\.claude\/agents\/[^/]+\.md$/.test(x.rel))) {
    const { fm } = frontmatter(d.text);
    const nome = typeof fm?.name === "string" && fm.name.trim() ? fm.name.trim() : base(d.rel);
    const [pref, resto] = nome.includes("--") ? nome.split("--") : [null, null];
    const squadNome = pref && nomesSquad.has(pref) ? pref : undefined;
    const alvo = squadNome && resto ? byRel.get(`squads/${squadNome}/agents/${resto}.md`) : null;
    const papelAlvo = alvo ? papelDeAgenteMd(alvo) : "";
    const modelo = typeof fm?.model === "string" ? fm.model : "";
    const descricao = typeof fm?.description === "string" ? limpaMd(fm.description) : "";
    const corpoPapel = papelAlvo || (letras(descricao) >= 15 ? descricao : "");
    const sufixo = `Subagente do Claude Code${modelo ? ` (modelo ${modelo})` : ""}${alvo ? ` que projeta squads/${squadNome}/agents/${resto}.md` : ""}.`;
    add({ api_name: nome, tipo: "agent", rid: `${PREFIXO_RID}subagent.${slugify(nome)}`, role: papel(corpoPapel ? `${corpoPapel.replace(/[.]$/, "")}. ${sufixo}` : sufixo), squad: squadNome, observed: [d.rel] });
  }

  /* ================= engines ================= */
  const engDirs = [...new Set(docs.filter((d) => /^engine\/[^/]+\//.test(d.rel)).map((d) => d.rel.split("/")[1]))].sort();
  for (const nome of engDirs) {
    const arqs = sob(`engine/${nome}`);
    const codigoCorpus = arqs.filter((d) => d.kind === "code");
    const temAgente = byRel.has(`engine/${nome}/AGENT.md`);
    if (!codigoCorpus.length && !temAgente) continue; // glossary, patterns, schemas, tasks, templates, workflows: conteúdo, não engine
    // a contagem que o papel afirma é a do DISCO: o corpus deixa de fora __init__.py vazios, nomes e conteúdos
    // sensíveis etc., então contá-lo diria "262" onde há 273 arquivos de código
    const noDisco = await codigoNoDisco(repoRoot, `engine/${nome}`);
    const codigo = noDisco ?? codigoCorpus.map((d) => d.rel); // sem leitura do disco, cai no corpus e o texto diz "indexados"
    const subpacotes = [...new Set(codigo.map((rel) => rel.split("/")[2]).filter((p) => p && !p.includes(".")))].sort();
    let rolePartes = "";
    const init = byRel.get(`engine/${nome}/__init__.py`);
    const agente = byRel.get(`engine/${nome}/AGENT.md`);
    if (agente) {
      const { fm } = frontmatter(agente.text);
      const r = typeof fm?.role === "string" ? fm.role : "";
      const camada = typeof fm?.layer === "string" ? fm.layer : "";
      rolePartes = r ? `${r}${camada ? ` (camada ${camada})` : ""}` : "";
    } else if (init) {
      rolePartes = (cabecalhoComentario(init.text) ?? "").replace(/^(core|engine)\/[\w/]+\/?\s*-\s*/i, "");
    }
    const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
    const indexado = (n) => (noDisco ? "" : n === 1 ? " indexado" : " indexados");
    const estrutura = codigo.length
      ? `${plural(codigo.length, "arquivo", "arquivos")} de código${indexado(codigo.length)}${subpacotes.length ? ` em ${plural(subpacotes.length, "subpacote", "subpacotes")} (${subpacotes.slice(0, 8).join(", ")}${subpacotes.length > 8 ? ", …" : ""})` : ""}`
      : plural(arqs.length, "arquivo indexado", "arquivos indexados");
    add({ api_name: nome, tipo: "engine", rid: `${PREFIXO_RID}engine.${slugify(nome)}`, role: papel(rolePartes ? `${rolePartes} — ${estrutura}` : estrutura), observed: [`engine/${nome}`] });
  }

  /* ================= skills ================= */
  const skillDocs = docs.filter((d) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(d.rel));
  for (const d of skillDocs) {
    const nome = d.rel.split("/")[2];
    const reg = skillRegPorPath.get(d.rel);
    const { fm } = frontmatter(d.text);
    const regDesc = typeof reg?.description === "string" && !/^no description$/i.test(reg.description.trim()) ? reg.description : "";
    const squadDono = [fm?.owner_squad, reg?.owner_squad].find((v) => typeof v === "string" && nomesSquad.has(v));
    add({
      api_name: nome, tipo: "skill", rid: `${PREFIXO_RID}skill.${slugify(nome)}`,
      role: papelDeDoc(d) || papel(regDesc),
      status: typeof reg?.status === "string" ? reg.status : typeof fm?.status === "string" ? fm.status : "",
      squad: squadDono, observed: [d.rel],
    });
  }

  /* ================= comandos (.claude/commands) ================= */
  for (const d of docs.filter((x) => eMd(x) && x.rel.startsWith(".claude/commands/"))) {
    const partes = d.rel.slice(".claude/commands/".length).replace(/\.md$/, "").split("/");
    const nome = `/${partes.join(":")}`;
    add({ api_name: nome, tipo: "skill", rid: `${PREFIXO_RID}command.${slugify(partes.join("-"))}`, role: papelDeDoc(d), observed: [d.rel] });
  }

  /* ================= workflows e tasks fora de squads ================= */
  const wfFiles = docs.filter((d) => [".yaml", ".yml", ".md"].includes(d.ext) && semAdmin(base(d.rel))
    && (/^engine\/workflows\/[^/]+$/.test(d.rel) || /^engine\/.+\/workflows\/[^/]+$/.test(d.rel) || /^\.claude\/skills\/[^/]+\/workflows\/[^/]+$/.test(d.rel)));
  for (const d of wfFiles) {
    const id = base(d.rel);
    const ctxo = d.rel.split("/").slice(0, -1).join("/");
    add({ api_name: id, tipo: "workflow", rid: `${PREFIXO_RID}workflow.${slugify(ctxo)}.${slugify(id)}`, role: papelDeDoc(d), observed: [d.rel] });
  }
  const taskFiles = docs.filter((d) => eMd(d) && semAdmin(base(d.rel)) && !/\/_templates\//.test(d.rel) && /^engine\/(?:.+\/)?tasks\/[^/]+\.md$/.test(d.rel) && !/(^|\/)(CHANGELOG|TASK-REGISTRY)\.md$/.test(d.rel));
  for (const d of taskFiles) {
    const id = base(d.rel);
    const ctxo = d.rel.split("/").slice(0, -1).join("/");
    add({ api_name: id, tipo: "workflow", rid: `${PREFIXO_RID}task.${slugify(ctxo)}.${slugify(id)}`, role: papelDeTaskEngine(d), observed: [d.rel] });
  }

  /** Tasks do engine descrevem-se numa tabela "Task Anatomy" (task_name | output | status). */
  function papelDeTaskEngine(d) {
    const linhas = new Map();
    for (const l of d.text.split("\n")) {
      const c = l.split("|").map((s) => s.trim());
      if (c.length >= 4 && c[1] && c[2] && /^[a-z_]+$/.test(c[1])) linhas.set(c[1], c[2]);
    }
    const nome = linhas.get("task_name");
    if (nome) {
      const partes = [nome];
      if (linhas.get("input")) partes.push(`entrada: ${linhas.get("input")}`);
      if (linhas.get("output")) partes.push(`saída: ${linhas.get("output")}`);
      return papel(partes.join(" — "));
    }
    return papelDeDoc(d);
  }

  /* ================= organização do grafo (organizacao.json) ================= */
  /*
   * Só o que os arquivos declaram (docs/agente-registro.md#organização). Os `id` são os mesmos `rid` do registro
   * (o leitor os prefixa por categoria, então não colidem com o inventário), e cada linha leva a marca.
   *   pilar       um por squad (squad.yaml) e um por `category` do ecosystem-registry.yaml com agente no disco
   *   agentes     agentes do squad (`_placeholder` fora): função = `tier` do config.yaml (ou do agent-registry.yaml),
   *               modelo da projeção .claude/agents/<squad>--<id>.md; da categoria: status do registro e papel
   *               da tabela do README da pasta
   *   tarefas     tasks do squad; executor = o `responsavel` que a task declara, se for agente do squad;
   *               passos = `steps[].name` (ou `process.steps[].name`) das tasks YAML
   *   ferramentas `deterministic_helper(s)` do agent-registry.yaml que existem no disco
   */
  const entidadePorCaminho = new Map(entidades.map((e) => [e.observed[0], e]));
  const curto = (txt, max) => { const t = corta(limpaMd(txt ?? ""), max); return t && !detectSecret(t) ? t : ""; };
  const idOrg = (s) => (s.length <= 120 ? s : `${s.slice(0, 113)}-${sha256(s).slice(0, 6)}`); // o leitor corta id em 120
  const comMarca = (o) => Object.fromEntries([...Object.entries(o).filter(([, v]) => v !== "" && !(Array.isArray(v) && !v.length)), ["gerado_por", MARCA_AGENTE]]);
  const texto = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const pilaresOrg = [];
  const agentesOrg = [];
  const tarefasOrg = [];
  const ferramentasOrg = [];
  const idsAgenteOrg = new Set();

  for (const sq of squadsOrg) {
    const squadEnt = entidadePorCaminho.get(sq.observado);
    if (!squadEnt) continue;
    const pilarId = idOrg(squadEnt.rid);
    pilaresOrg.push(comMarca({ id: pilarId, nome: curto(sq.nome, 80), tagline: curto(sq.role, 200) }));

    const cfg = lerYamlDoc(`squads/${sq.dir}/config.yaml`);
    const regSquad = lerYamlDoc(`squads/${sq.dir}/agent-registry.yaml`);
    const especialistas = regSquad?.specialists && typeof regSquad.specialists === "object" && !Array.isArray(regSquad.specialists) ? regSquad.specialists : {};
    const tierDe = new Map();
    for (const a of Array.isArray(cfg?.agents) ? cfg.agents : []) if (a && typeof a.id === "string" && texto(a.tier)) tierDe.set(a.id, texto(a.tier));
    for (const [id, s] of Object.entries(especialistas)) if (!tierDe.has(id) && texto(s?.tier)) tierDe.set(id, texto(s.tier));

    const agenteDoArquivo = new Map(); // id do arquivo (stem) -> id na organização
    for (const d of sob(`squads/${sq.dir}/agents`).filter((x) => eMd(x) && x.rel.split("/").length === 4)) {
      const idArq = base(d.rel);
      const ent = entidadePorCaminho.get(d.rel);
      if (idArq.startsWith("_") || !ent) continue; // marcador de cobertura já é aviso do inventário
      const ferramentas = [];
      const esp = especialistas[idArq];
      const helpers = [esp?.deterministic_helper, ...(Array.isArray(esp?.deterministic_helpers) ? esp.deterministic_helpers : [])].map(texto).filter(Boolean);
      for (const h of helpers) {
        const rel = path.posix.normalize(`squads/${sq.dir}/${h}`);
        if (!rel.startsWith(`squads/${sq.dir}/`) || caminhoExcluido(path.join(repoRoot, rel)) || !existsSync(path.join(repoRoot, rel))) {
          avisos.push(`organizacao: squads/${sq.dir}/agent-registry.yaml declara o script ${h} para ${idArq}, mas ele não existe — não registrado`);
          continue;
        }
        const fid = idOrg(`${PREFIXO_RID}script.${slugify(sq.dir)}.${slugify(h)}`);
        if (!ferramentasOrg.some((f) => f.id === fid)) {
          ferramentasOrg.push(comMarca({ id: fid, nome: curto(path.posix.basename(rel), 80), categoria: "script determinístico", descricao: descricaoScript(byRel.get(rel)) }));
        }
        if (!ferramentas.includes(fid)) ferramentas.push(fid);
      }
      const { fm, corpo } = frontmatter(d.text);
      const persona = blocoYaml(corpo)?.persona;
      const projecao = byRel.get(`.claude/agents/${sq.nome}--${idArq}.md`) ?? byRel.get(`.claude/agents/${sq.dir}--${idArq}.md`);
      const fmProj = projecao ? frontmatter(projecao.text).fm : null;
      const id = idOrg(ent.rid);
      if (idsAgenteOrg.has(id)) continue;
      idsAgenteOrg.add(id);
      agenteDoArquivo.set(idArq, id);
      agentesOrg.push(comMarca({
        id, nome: curto(idArq, 80), pilarId,
        papel: curto([fm?.role, persona?.role].map(texto).find(Boolean) ?? "", 120),
        status: curto(texto(fm?.status), 40),
        funcao: curto(tierDe.get(idArq) ?? "", 40),
        descricao: ent.role ?? "",
        modelo: curto(texto(fmProj?.model), 80),
        ambiente: projecao ? "Claude Code (subagente)" : "",
        ferramentas,
      }));
    }

    const divergentes = [];
    const semExecutor = [];
    for (const d of sob(`squads/${sq.dir}/tasks`).filter((x) => [".md", ".yaml", ".yml"].includes(x.ext) && x.rel.split("/").length === 4 && semAdmin(base(x.rel)))) {
      const ent = entidadePorCaminho.get(d.rel);
      if (!ent) continue;
      let dado = null;
      let corpo = "";
      if (eMd(d)) ({ fm: dado, corpo } = frontmatter(d.text));
      else {
        try { const v = loadYaml(d.text); dado = v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { dado = null; }
      }
      const titulo = [dado?.title, dado?.name].map(texto).find(Boolean) ?? (corpo.match(/^#\s+(.+?)\s*$/m)?.[1] ?? base(d.rel));
      // o `responsavel` do topo é o do contrato da task; o de `megabrain_frontmatter` (bloco antigo) só é conferido
      const resp = texto(dado?.responsavel).replace(/^@/, "");
      const respAntigo = texto(dado?.megabrain_frontmatter?.responsavel).replace(/^@/, "");
      if (resp && respAntigo && resp !== respAntigo) divergentes.push(`${base(d.rel)} (@${resp} x @${respAntigo})`);
      const tipoResp = texto(dado?.responsavel_type).toLowerCase();
      const executor = resp && (!tipoResp || tipoResp === "agent") ? agenteDoArquivo.get(resp) : undefined;
      if (resp && !executor) semExecutor.push(`${base(d.rel)} (@${resp})`);
      const passosBrutos = Array.isArray(dado?.steps) ? dado.steps : Array.isArray(dado?.process?.steps) ? dado.process.steps : [];
      const passos = passosBrutos.map((p) => curto(typeof p === "string" ? p : texto(p?.name), 300)).filter(Boolean).slice(0, 40);
      tarefasOrg.push(comMarca({
        id: idOrg(ent.rid), titulo: curto(titulo, 160) || base(d.rel), pilarId,
        resumo: ent.role ?? "", passos,
        ...(executor ? { executorTipo: "agent", executorId: executor } : {}),
      }));
    }
    if (divergentes.length) avisos.push(`organizacao: ${divergentes.length} task(s) de squads/${sq.dir} declaram um responsavel no topo e outro em megabrain_frontmatter (ex.: ${divergentes.slice(0, 3).join(", ")}) — vale o do topo`);
    if (semExecutor.length) avisos.push(`organizacao: ${semExecutor.length} task(s) de squads/${sq.dir} têm responsavel que não é agente do squad (ex.: ${semExecutor.slice(0, 3).join(", ")}) — ficam sem executor`);
  }

  // categorias do ecosystem-registry.yaml (ex.: system/conclave): só agentes cujo arquivo existe
  const porCategoria = new Map();
  for (const a of Array.isArray(ecoReg?.agents) ? ecoReg.agents : []) {
    if (!a || typeof a.id !== "string" || typeof a.path !== "string" || !texto(a.category) || !entidadePorCaminho.has(a.path)) continue;
    const cat = texto(a.category);
    porCategoria.set(cat, [...(porCategoria.get(cat) ?? []), a]);
  }
  for (const cat of [...porCategoria.keys()].sort()) {
    const readmeCat = byRel.get(`agents/${cat}/README.md`);
    const h1 = readmeCat?.text.match(/^#\s+(.+?)\s*$/m)?.[1] ?? "";
    const pilarId = idOrg(`${PREFIXO_RID}categoria.${slugify(cat)}`);
    pilaresOrg.push(comMarca({ id: pilarId, nome: curto(h1, 80) || curto(cat, 80), tagline: readmeCat ? curto(papelDeDoc(readmeCat), 200) : "" }));
    for (const a of porCategoria.get(cat)) {
      const ent = entidadePorCaminho.get(a.path);
      const id = idOrg(ent.rid);
      if (idsAgenteOrg.has(id)) continue;
      idsAgenteOrg.add(id);
      agentesOrg.push(comMarca({
        id, nome: curto(a.id, 80), pilarId,
        papel: readmeCat ? curto(celulaDaTabela(readmeCat.text, a.id, 2), 120) : "",
        status: curto(texto(a.status), 40),
        descricao: ent.role ?? "",
      }));
    }
  }

  /** Coluna `col` da linha "| id | … |" de uma tabela Markdown (ex.: Role na tabela do README do Conclave). */
  function celulaDaTabela(text, id, col) {
    for (const l of text.split("\n")) {
      const c = l.split("|").map((s) => s.trim());
      if (c.length > col + 1 && c[1] === id) return c[col];
    }
    return "";
  }
  /** Primeiro parágrafo do comentário de cabeçalho de um script JS (`/** … *\/` ou `//`), sem o "nome.js — ". */
  function descricaoScript(d) {
    if (!d) return "";
    const bloco = d.text.replace(/^#!.*\n/, "").match(/^\s*\/\*\*?([\s\S]*?)\*\//)?.[1]
      ?? (d.text.replace(/^#!.*\n/, "").match(/^(?:\s*\/\/.*\n?)+/)?.[0] ?? "").replace(/^\s*\/\/ ?/gm, "");
    const linhas = bloco.split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim());
    const ini = linhas.findIndex(Boolean);
    if (ini < 0) return "";
    const fim = linhas.indexOf("", ini);
    const par = linhas.slice(ini, fim < 0 ? undefined : fim).join(" ").replace(/^[\w./-]+\.(?:m?js|cjs|ts)\s*[—–-]\s*/, "");
    return letras(par) >= 10 ? curto(par, 600) : "";
  }

  /* ================= saídas ================= */
  const faltando = entidades.filter((e) => e.observed[0] !== "." && !existsSync(path.join(repoRoot, e.observed[0])));
  if (faltando.length) throw new Error(`agente: ${faltando.length} entidade(s) apontam para caminho inexistente (ex.: ${faltando[0].observed[0]})`);

  // `observed` e o `path` de repos.json são resolvidos pelo app contra a BILHON_ROOT. Com o repositório lido
  // dentro de uma raiz maior (BILHON_ROOT=.. e o clone em ../mega-brain-oss) o caminho leva o prefixo da raiz até ele
  const prefixoRaiz = prefixoDoRepositorio(ctx.appRoot, repoRoot);
  const daRaiz = (rel) => (prefixoRaiz ? (rel === "." ? prefixoRaiz : `${prefixoRaiz}/${rel}`) : rel);

  entidades.sort((a, b) => (ORDEM_KIND[a.tipo] - ORDEM_KIND[b.tipo]) || (a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0));
  const linhas = entidades.map((e) => {
    const o = { api_name: e.api_name, tipo: e.tipo, rid: e.rid };
    if (e.role) o.role = e.role;
    if (e.status) o.status = e.status;
    if (e.squad) o.squad = e.squad;
    o.procedencia = e.procedencia;
    o.owner = e.owner;
    o.observed = e.observed.map(daRaiz);
    return o;
  });

  const dirAgente = path.join(dataDir, "agente");

  // ---- lê TUDO o que já existe antes de gravar qualquer coisa: arquivo ilegível aborta sem tocar em nenhum ----
  const arqRegistro = path.join(dirAgente, "registro.yaml");
  const arqRepos = path.join(dirAgente, "repos.json");
  const arqEspelhos = path.join(dirAgente, "espelhos.json");
  const preservadas = []; // linhas do registro que não são nossas (rid sem o prefixo "megabrain.")
  if (existsSync(arqRegistro)) {
    let atual;
    try { atual = loadYaml(await readFile(arqRegistro, "utf8")); } catch (e) {
      throw new Error(`agente: registro.yaml existente está ilegível e não será sobrescrito (${String(e?.message ?? e).split("\n")[0]})`);
    }
    const rows = Array.isArray(atual) ? atual : Array.isArray(atual?.entities) ? atual.entities : [];
    for (const r of rows) if (r && typeof r === "object" && !(typeof r.rid === "string" && r.rid.startsWith(PREFIXO_RID))) preservadas.push(r);
  }
  const slugRepo = slugify(nomeRepo);
  // só a linha COM a marca é nossa. Uma linha do mesmo slug sem a marca foi assumida por você (tier, category,
  // github.* enriquecidos): fica exatamente como está e nós não geramos outra por cima
  const reposUsuario = (await lerArrayExistente(arqRepos)).filter((r) => r?.gerado_por !== MARCA_AGENTE);
  const linhaRepoAssumida = reposUsuario.some((r) => r?.slug === slugRepo);
  if (linhaRepoAssumida) avisos.push(`repos.json: a linha "${slugRepo}" não tem gerado_por="${MARCA_AGENTE}" e foi preservada como está (não regenerada)`);
  const espelhosUsuario = (await lerArrayExistente(arqEspelhos)).filter((r) => r?.gerado_por !== MARCA_AGENTE);
  const arqOrg = path.join(dirAgente, "organizacao.json");
  const orgAtual = await lerOrganizacaoExistente(arqOrg); // null = ainda não existe

  // ---- registro.yaml: reescreve as linhas "megabrain.*", preserva as demais ----
  const cabecalho = [
    "# Registro de entidades do mega-brain — GERADO por `npm run populate` (scripts/populate/agente.mjs).",
    "# Cada linha vem de um arquivo real do repositório (campo `observed`, relativo à BILHON_ROOT: ao repositório quando a raiz é ele).",
    "# Procedência e owner vêm do git: arquivo que existe desde o commit raiz e nunca foi tocado depois =",
    `# "adotada" (owner ${nomeDono(dono.adotada)}, upstream); tocado depois, ou arquivo local novo = "propria" (owner ${nomeDono(dono.propria)}).`,
    '# Linhas com rid iniciado em "megabrain." são reescritas a cada execução; as suas (outro rid) são preservadas.',
    "",
  ].join("\n");
  const yamlTexto = cabecalho + dumpYaml({ entities: [...linhas, ...preservadas] }, { lineWidth: -1, noRefs: true, sortKeys: false });
  await escreveSeDiferente(arqRegistro, yamlTexto);

  // ---- repos.json ----
  const linhaRepo = {
    slug: slugRepo, path: daRaiz("."), owner: dono.propria, repo: nomeRepo, source: "git-remote-origin", procedencia: "propria",
    readme_summary: { title: readmeTitulo || null, tagline: readmeTagline || null },
    github: { description: readmeTagline || null, html_url: git0.origin ?? null, license: await lerLicenca(repoRoot) },
    gerado_por: MARCA_AGENTE,
  };
  const linhasRepos = linhaRepoAssumida ? reposUsuario : [linhaRepo, ...reposUsuario];
  await escreveSeDiferente(arqRepos, `${JSON.stringify(linhasRepos, null, 2)}\n`);

  // ---- espelhos.json: o registro já cobre tudo (squads, agentes, skills, workflows e engines saem dos próprios
  //      arquivos do repo); nada é espelhado de fora, então só sobra o que for seu ----
  await escreveSeDiferente(arqEspelhos, `${JSON.stringify(espelhosUsuario, null, 2)}\n`);

  // ---- organizacao.json: as suas linhas (sem a marca) na frente, as nossas depois; id seu igual ao nosso vence ----
  const geradasOrg = { pilares: pilaresOrg, ferramentas: ferramentasOrg, agentes: agentesOrg, pessoas: [], tarefas: tarefasOrg, execucoes: [] };
  let orgPreservadas = 0;
  let orgGravada = false;
  if (orgAtual || pilaresOrg.length) {
    const saida = { _sobre: SOBRE_ORG };
    for (const [k, v] of Object.entries(orgAtual ?? {})) if (!LISTAS_ORG.includes(k) && k !== "_sobre") saida[k] = v;
    for (const [k, nossas] of Object.entries(geradasOrg)) {
      const suas = (orgAtual?.[k] ?? []).filter((r) => !(r && typeof r === "object" && r.gerado_por === MARCA_AGENTE));
      orgPreservadas += suas.length;
      const idsSeus = new Set(suas.map((r) => (r && typeof r === "object" ? String(r.id ?? "") : "")).filter(Boolean));
      saida[k] = [...suas, ...nossas.filter((r) => !idsSeus.has(r.id))];
    }
    await escreveSeDiferente(arqOrg, `${JSON.stringify(saida, null, 2)}\n`);
    orgGravada = true;
  }

  const porTipo = Object.fromEntries(KINDS.map((k) => [k, entidades.filter((e) => e.tipo === k).length]).filter(([, n]) => n));
  const porProc = { propria: 0, adotada: 0, terceiro: 0 };
  for (const e of entidades) porProc[e.procedencia]++;
  log(MODULO, `registro.yaml: ${entidades.length} entidades (${preservadas.length} linhas suas preservadas)`);
  if (orgGravada) log(MODULO, `organizacao.json: ${pilaresOrg.length} pilares, ${agentesOrg.length} agentes, ${tarefasOrg.length} tarefas, ${ferramentasOrg.length} ferramentas (${orgPreservadas} linhas suas preservadas)`);
  return {
    resumo: {
      entidades: entidades.length, porTipo, procedencia: porProc, preservadas: preservadas.length,
      repos: linhasRepos.length, espelhos: espelhosUsuario.length,
      espelhosMotivo: "vazio de propósito: o registro já cobre squads, agentes, skills, workflows e engines a partir dos próprios arquivos; espelhos são para itens copiados de fora, e aqui não há fonte externa",
      reposNota: "o repo também está no registro com o mesmo tipo e caminho; o app mostra uma vez só (vale o registro)",
      uso: "uso.json não gerado (sem evidência real de uso); favoritos.json e ocultos.json são do app/usuário",
      organizacao: {
        gravada: orgGravada, pilares: pilaresOrg.length, agentes: agentesOrg.length, tarefas: tarefasOrg.length,
        tarefasComExecutor: tarefasOrg.filter((t) => t.executorId).length, ferramentas: ferramentasOrg.length, preservadas: orgPreservadas,
        semFonte: "pessoas e execuções ficam vazias: o mega-brain não registra pessoas da organização nem execuções de agentes",
      },
      memoria: "data/agente/memoria/ não gerada: o mega-brain não tem uma pasta de notas ligadas por [[wikilinks]] ou links .md (o núcleo só desenha notas com link); BILHON_BRAIN_STORE pode apontar para uma sua",
      regraProcedencia: `git: arquivo do commit raiz nunca tocado depois = adotada (owner ${nomeDono(dono.adotada)}); tocado depois ou local novo = propria (owner ${nomeDono(dono.propria)}); diretório = propria se algum arquivo for próprio`,
      gitHead: git0.head,
    },
    avisos,
  };
}

/** Extensões de código e pastas ignoradas: espelham CODE_EXT / PRUNE_DIRS de common.mjs (que não as exporta). */
const EXT_CODIGO = new Set([".py", ".js", ".mjs", ".cjs", ".ts", ".sh"]);
const PASTAS_IGNORADAS = new Set([
  "node_modules", ".git", "__pycache__", ".pytest_cache", ".venv", "venv", "dist", "build",
  ".next", ".data", "coverage", ".mypy_cache", ".ruff_cache",
]);

/**
 * Arquivos de código (caminhos posix a partir da raiz do repo) sob `relDir`, contados no DISCO e não no corpus
 * filtrado. Somente leitura de diretórios; não atravessa link. Qualquer falha de leitura devolve `null`
 * (o chamador cai no corpus e diz "indexados" em vez de afirmar um número que não conferiu).
 */
export async function codigoNoDisco(repoRoot, relDir) {
  const achados = [];
  const visitar = async (rel) => {
    const itens = await readdir(path.join(repoRoot, rel), { withFileTypes: true });
    itens.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const it of itens) {
      if (it.isSymbolicLink()) continue;
      const filho = `${rel}/${it.name}`;
      if (caminhoExcluido(path.join(repoRoot, filho))) continue; // BILHON_POPULATE_EXCLUIR: nem contado
      if (it.isDirectory()) { if (!PASTAS_IGNORADAS.has(it.name)) await visitar(filho); }
      else if (it.isFile() && EXT_CODIGO.has(path.extname(it.name).toLowerCase())) achados.push(filho);
    }
  };
  try {
    await visitar(relDir);
  } catch {
    return null;
  }
  return achados;
}

/** Lê um JSON-array opcional. Ausente = []; corrompido = erro (nunca sobrescreve o que não entende). */
async function lerArrayExistente(file) {
  if (!existsSync(file)) return [];
  let v;
  try { v = JSON.parse(await readFile(file, "utf8")); } catch (e) {
    throw new Error(`agente: ${path.basename(file)} existente está ilegível e não será sobrescrito (${String(e?.message ?? e).slice(0, 80)})`);
  }
  if (!Array.isArray(v)) throw new Error(`agente: ${path.basename(file)} existente não é uma lista e não será sobrescrito`);
  return v;
}

const SOBRE_ORG = "Organização do grafo de /agente gerada por `npm run populate` (scripts/populate/agente.mjs) a partir dos squads e do "
  + "agents/_registry/ecosystem-registry.yaml do mega-brain. Linhas com gerado_por=\"populate:agente\" são reescritas a cada execução; "
  + "as suas (sem essa marca) são preservadas na frente das nossas. Formato: docs/agente-registro.md#organização.";
const LISTAS_ORG = ["pilares", "ferramentas", "agentes", "pessoas", "tarefas", "execucoes"];

/**
 * Lê o organizacao.json existente. Ausente = null; corrompido, que não seja objeto ou com uma das listas em outro
 * formato = erro (nunca sobrescreve o que não entende).
 */
async function lerOrganizacaoExistente(file) {
  if (!existsSync(file)) return null;
  let v;
  try { v = JSON.parse(await readFile(file, "utf8")); } catch (e) {
    throw new Error(`agente: organizacao.json existente está ilegível e não será sobrescrito (${String(e?.message ?? e).slice(0, 80)})`);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("agente: organizacao.json existente não é um objeto e não será sobrescrito");
  const torta = LISTAS_ORG.find((k) => k in v && !Array.isArray(v[k]));
  if (torta) throw new Error(`agente: organizacao.json existente tem "${torta}" que não é lista e não será sobrescrito`);
  return v;
}

/** Só grava quando o conteúdo muda (idempotência sem tocar no mtime à toa). */
async function escreveSeDiferente(file, conteudo) {
  if (existsSync(file) && sha256(await readFile(file, "utf8")) === sha256(conteudo)) return false;
  await writeText(file, conteudo);
  return true;
}

/** Licença declarada no LICENSE do repo (arquivo sem extensão, fora do corpus), ou null. */
async function lerLicenca(repoRoot) {
  try {
    if (caminhoExcluido(path.join(repoRoot, "LICENSE"))) return null;
    const txt = await readFile(path.join(repoRoot, "LICENSE"), "utf8");
    return /All Rights Reserved/i.test(txt) ? "All Rights Reserved" : null;
  } catch {
    return null;
  }
}
