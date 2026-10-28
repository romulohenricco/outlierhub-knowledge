/**
 * Módulo "addons" — catálogo de PADRÕES REAPROVEITÁVEIS do mega-brain para /integracoes (antes /addons, que hoje
 * redireciona). O leitor (lib/addons.ts, lib/addons-schema.ts) e o formato são os mesmos de antes.
 *
 * Gera (e só isto):
 *   data/addons/manifest.json                  { entries: [...] }  (docs/agente-registro.md, lib/addons-schema.ts)
 *   data/addons/artifacts/<slug>/<arquivo>     texto de cada artefato (cópia de arquivo do corpus)
 *
 * O que vira add-on (só arquivos reais do corpus, nunca inventados):
 *   framework-checklist   checklists de squad/skill, regras (.claude/rules), quality gates e rubricas,
 *                         contratos/schemas (squads/<s>/contracts, engine/schemas), protocolos e playbooks
 *   function-utility      templates (agentes, logs, fases, debates, squads, workspace, GitHub, docs) e prompts
 *   design-system         templates de marca (workspace/_templates/brand)
 *   (app-recreation: o repositório não traz app para recriar — não é usada)
 *
 * Artefatos: só .ts .tsx .md .txt .css .json .yaml .yml, ≤ 256 KiB. O conteúdo gravado é o texto do corpus
 * (UTF-8, quebras LF), e `checksum` = SHA-256 desse mesmo texto — exatamente o que lib/addons.ts recalcula.
 * Arquivos de conteúdo idêntico (mesmo SHA-256) entram uma vez só.
 * Título/resumo com e-mail ou chave (quantos houver) são higienizados; se ainda assim o app os poria em
 * quarentena, caem para o nome do arquivo / slug com um aviso. Isso nunca aborta o módulo.
 *
 * Regeneração: entradas do manifesto com `gerado_por: "populate:addons"` são nossas e reescritas; as demais
 * (suas) são preservadas. Só removemos pastas de artefatos que NÓS geramos antes e que não existem mais.
 */
import { existsSync } from "node:fs";
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { ativarExclusoes, caminhoExcluido, detectSecret, humanize, log, sha256, slugify, writeText } from "./common.mjs";
import { corta, frontmatter, lerGit, limpaMd, papelDeDoc, resumoPreferido } from "./agente.mjs";

const MODULO = "addons";
export const MARCA_ADDON = "populate:addons";
const TAMANHO_MAX = 262144;
const EXT_OK = new Set([".ts", ".tsx", ".md", ".txt", ".css", ".json", ".yaml", ".yml"]);
const MEDIA_TYPE = {
  ".md": "text/markdown", ".txt": "text/plain", ".yaml": "application/yaml", ".yml": "application/yaml",
  ".json": "application/json", ".css": "text/css", ".ts": "text/typescript", ".tsx": "text/typescript",
};
// espelha PADRAO_SEGREDO / PADRAO_EMAIL de lib/addons-schema.ts (title/summary suspeitos vão para a quarentena)
const PADRAO_SEGREDO = /(sk-|pk_live_|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const PADRAO_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PADRAO_EMAIL_GLOBAL = new RegExp(PADRAO_EMAIL.source, "g"); // o texto pode ter VÁRIOS e-mails: troca todos

/** Remove do texto livre o que o app trataria como e-mail/chave ("task-" contém "sk-"). */
export function textoSeguro(s) {
  return String(s ?? "")
    .replace(PADRAO_EMAIL_GLOBAL, "[e-mail]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "[chave]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[chave]")
    .replace(/pk_live_/g, "pk live ")
    .replace(/sk-/g, "sk‑"); // hífen não separável: lê igual ("task‑tmpl") e não casa com o padrão de chave do app
}
export const suspeito = (...campos) => PADRAO_SEGREDO.test(campos.join(" ")) || PADRAO_EMAIL.test(campos.join(" "));

/** Título legível do add-on: título do frontmatter → H1 → name → título do corpus; sem extensão nem ponto grudado. */
function tituloDe(d) {
  let t = null;
  if (d.ext === ".md") {
    const { fm, corpo } = frontmatter(d.text);
    const h1 = corpo.match(/^#\s+(.+?)\s*$/m)?.[1];
    // templates de issue do GitHub: `name` é o nome humano, `title` é só o prefixo do assunto ("[BUG] ")
    const nome = typeof fm?.name === "string" ? fm.name : null;
    t = d.rel.startsWith(".github/") && nome ? nome : (typeof fm?.title === "string" && fm.title) || h1 || nome || null;
  } else if (d.ext === ".yaml" || d.ext === ".yml") {
    t = d.text.match(/^(?:title|name):\s*["']?(.+?)["']?\s*$/m)?.[1] ?? null;
  }
  const limpo = limpaMd(t ?? d.title)
    .replace(/\.(md|ya?ml|json|txt)$/i, "")
    .replace(/(?<=[A-Za-z])\.(?=[A-Z])/g, " ")
    .replace(/^[^\p{L}\p{N}{[(]+/u, "") // emoji e símbolos no começo
    .replace(/^[\s:—-]+|[\s:—-]+$/g, "");
  // título que é só placeholder ("{name}") não identifica nada: usa o nome do arquivo
  const semChaves = limpo.replace(/\{[^}]*\}/g, "").replace(/[\s:—-]/g, "");
  return semChaves.length >= 3 ? limpo : humanize(path.posix.basename(d.rel));
}

/** Resumo de checklist: seção de propósito (se houver) + quantidade de itens de verificação. */
function resumoChecklist(d) {
  const { corpo } = frontmatter(d.text);
  const itens = (corpo.match(/^\s*[-*]\s*\[[ xX]\]/gm) ?? []).length;
  return [resumoPreferido(corpo), itens ? `${itens} itens de verificação.` : ""].filter(Boolean).join(" ");
}

/** a ⊂ b ou b ⊂ a depois de normalizar: o "resumo" só repetiria o título. */
function repeteTitulo(resumo, titulo) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const a = norm(resumo);
  const b = norm(titulo);
  return !a || a === b || (a.length >= 6 && b.includes(a));
}

const stemDe = (rel) => path.posix.basename(rel).replace(/\.[^.]+$/, "");
const dirDe = (rel) => path.posix.dirname(rel);
const porRel = (a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);

/** Rótulos legíveis de pastas de workspace/_templates (o que não está aqui usa humanize). */
const ROTULO_WORKSPACE = {
  ai: "IA", analytics: "analytics", brand: "marca", "business-template-v3": "negócio (modelo v3)", company: "empresa",
  content: "conteúdo", delivery: "entrega", features: "features", hiring: "contratação", operations: "operações",
  products: "produtos", "sales-process": "processo de vendas",
};

export default async function run(ctx) {
  ativarExclusoes(ctx);
  const { repoRoot, docs } = ctx;
  const avisos = [];
  const gitInfo = lerGit(ctx);
  if (!gitInfo.ok) avisos.push(`git indisponível (${gitInfo.motivo}) — source.revision fica null`);

  let licenca = "unknown";
  try {
    if (caminhoExcluido(path.join(repoRoot, "LICENSE"))) throw new Error("LICENSE excluído pela configuração");
    const txt = await readFile(path.join(repoRoot, "LICENSE"), "utf8");
    if (/All Rights Reserved/i.test(txt)) licenca = "proprietary";
  } catch { /* sem LICENSE: licença desconhecida */ }
  if (licenca === "unknown") avisos.push("LICENSE ausente ou sem 'All Rights Reserved' — licença 'unknown' (o app põe os add-ons em quarentena)");

  /* ---------------------------------------------------------------- seleção de arquivos */
  const elegivel = (d) => EXT_OK.has(d.ext) && Buffer.byteLength(d.text, "utf8") <= TAMANHO_MAX;
  const candidatos = docs.filter((d) => d.kind !== "code" && elegivel(d));
  const grandes = docs.filter((d) => d.kind !== "code" && EXT_OK.has(d.ext) && !elegivel(d));
  if (grandes.length) avisos.push(`${grandes.length} arquivo(s) do corpus excedem 256 KiB e não podem ser artefato (ex.: ${grandes.slice(0, 2).map((d) => d.rel).join(", ")})`);

  const usados = new Set(); // rel já entregue a algum add-on
  const shaVistos = new Map(); // sha256 -> rel que o levou (duplicatas idênticas entram uma vez)
  const duplicados = [];
  const specs = [];

  /** Cria um add-on com os arquivos ainda não usados e não duplicados. */
  const addon = ({ slug, cat, area, titulo, arquivos, tipo, familia }) => {
    const sel = [];
    for (const d of [...arquivos].sort(porRel)) {
      if (usados.has(d.rel)) continue;
      const jaTem = shaVistos.get(d.sha256);
      if (jaTem && jaTem !== d.rel) { duplicados.push(`${d.rel} = ${jaTem}`); usados.add(d.rel); continue; }
      sel.push(d);
    }
    if (!sel.length) return;
    for (const d of sel) { usados.add(d.rel); shaVistos.set(d.sha256, d.rel); }
    specs.push({ slug, cat, area, titulo, arquivos: sel, tipo, familia: !!familia });
  };

  const doPrefixo = (prefixo, { rec = false, filtro } = {}) => candidatos.filter((d) => {
    if (!d.rel.startsWith(prefixo)) return false;
    if (!rec && d.rel.slice(prefixo.length).includes("/")) return false;
    return filtro ? filtro(d) : true;
  });
  const porStem = (lista) => {
    const m = new Map();
    for (const d of lista) { const k = `${dirDe(d.rel)}/${stemDe(d.rel)}`; m.set(k, [...(m.get(k) ?? []), d]); }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
  };
  const representante = (grupo) => grupo.find((d) => d.ext === ".md") ?? grupo[0];
  const unico = (lista, props) => { for (const g of porStem(lista)) addon({ ...props(representante(g), g), arquivos: g }); };

  /* ---------------------------------------------------------------- framework-checklist */
  const squads = [...new Set(docs.map((d) => d.rel.match(/^squads\/([^/]+)\//)?.[1]).filter(Boolean))].sort();

  // checklists de squad (md + yaml do mesmo nome formam um add-on)
  for (const s of squads) {
    unico(doPrefixo(`squads/${s}/checklists/`), (d) => ({ slug: `${s}-${stemDe(d.rel)}`, cat: "framework-checklist", area: "modulos", titulo: tituloDe(d), tipo: "checklist" }));
  }
  // checklists dentro de skills (uma família por skill)
  for (const skill of [...new Set(candidatos.map((d) => d.rel.match(/^\.claude\/skills\/([^/]+)\/checklists\//)?.[1]).filter(Boolean))].sort()) {
    addon({ slug: `skill-${skill}-checklists`, cat: "framework-checklist", area: "skills", titulo: `Checklists da skill ${skill}`, arquivos: doPrefixo(`.claude/skills/${skill}/checklists/`, { rec: true }), familia: true });
  }
  // regras do projeto
  unico(doPrefixo(".claude/rules/", { filtro: (d) => d.ext === ".md" }), (d) => ({ slug: `regra-${stemDe(d.rel)}`, cat: "framework-checklist", area: "rules", titulo: tituloDe(d) }));
  // quality gates e rubricas
  const gatesRe = /(^|\/)(quality[-_]gates|gates_config|alignment-rubric|PLAN-QUALITY-RUBRIC|gate-review-framework)\.(ya?ml|md)$/;
  unico(candidatos.filter((d) => gatesRe.test(d.rel)), (d) => ({
    slug: `gates-${slugify(dirDe(d.rel).replace(/\/(data|knowledge|tasks|config|pipeline|patterns)$/, ""))}-${slugify(stemDe(d.rel))}`.replace(/-+/g, "-"),
    cat: "framework-checklist", area: "modulos", titulo: tituloDe(d),
  }));
  // contratos e schemas
  for (const s of squads) {
    addon({ slug: `${s}-contratos`, cat: "framework-checklist", area: "modulos", titulo: `Contratos do squad ${s}`, arquivos: doPrefixo(`squads/${s}/contracts/`, { rec: true }), familia: true });
  }
  addon({ slug: "engine-schemas-estado-pipeline", cat: "framework-checklist", area: "modulos", titulo: "Schemas de estado do pipeline (engine)", arquivos: doPrefixo("engine/schemas/"), familia: true });
  unico(candidatos.filter((d) => /^engine\/intelligence\/(pipeline\/filename_sidecar_schema\.json|rag\/domain_contracts\.yaml)$/.test(d.rel)), (d) => ({
    slug: `engine-${slugify(stemDe(d.rel))}`, cat: "framework-checklist", area: "modulos",
    titulo: d.rel.endsWith("domain_contracts.yaml") ? "Contratos de domínio do RAG" : "Contrato do sidecar de nome de arquivo (pipeline)",
  }));
  // protocolos, constituição e playbooks
  const PROTOCOLOS = [
    ["engine/jarvis/protocols/", false, "engine-jarvis-governanca", "Governança do JARVIS: constituição, autoridade e orquestração"],
    ["engine/jarvis/protocols/agents/", true, "engine-jarvis-protocolos-agentes", "Protocolos de agentes do JARVIS: memória, epistemologia e war room"],
    ["engine/jarvis/protocols/company/", true, "engine-jarvis-protocolos-empresa", "Protocolos de documentação e enriquecimento de empresa"],
    ["engine/jarvis/protocols/conclave/", true, "engine-jarvis-protocolos-conclave", "Protocolos do Conclave: debate e deliberação"],
    ["engine/jarvis/protocols/dna/", true, "engine-jarvis-protocolos-dna", "Protocolos de extração de DNA cognitivo"],
    ["engine/jarvis/protocols/pipeline/", true, "engine-jarvis-protocolos-pipeline", "Protocolos e prompts do pipeline JARVIS"],
    ["engine/jarvis/protocols/system/", true, "engine-jarvis-protocolos-sistema", "Protocolos de sistema: log, checkpoint e enforcement"],
  ];
  for (const [pref, rec, slug, titulo] of PROTOCOLOS) {
    addon({ slug, cat: "framework-checklist", area: "modulos", titulo, arquivos: doPrefixo(pref, { rec, filtro: (d) => !/\/_archive\//.test(d.rel) }), familia: true });
  }
  for (const s of squads) {
    addon({ slug: `${s}-conhecimento`, cat: "framework-checklist", area: "modulos", titulo: `Frameworks e playbooks do squad ${s}`, arquivos: doPrefixo(`squads/${s}/knowledge/`, { rec: true }), familia: true });
  }
  addon({ slug: "docs-protocolos", cat: "framework-checklist", area: "modulos", titulo: "Protocolos de logging e modo de plano (docs)", arquivos: candidatos.filter((d) => /^docs\/[^/]*PROTOCOL[^/]*\.md$/.test(d.rel)), familia: true });
  unico(candidatos.filter((d) => d.rel === ".claude/skills/DETECTION-PROTOCOL.md"), (d) => ({ slug: "skills-detection-protocol", cat: "framework-checklist", area: "skills", titulo: tituloDe(d) }));

  /* ---------------------------------------------------------------- function-utility (templates e prompts) */
  const TEMPLATES_ENGINE = [
    ["engine/templates/agents/", "engine-templates-agentes", "Templates de agente: DNA, alma, memória e raciocínio"],
    ["engine/templates/logs/", "engine-templates-logs", "Templates de log: pipeline MCE, pessoal e workspace"],
    ["engine/templates/debates/", "engine-templates-debates", "Templates de debate e Conclave"],
  ];
  for (const [pref, slug, titulo] of TEMPLATES_ENGINE) addon({ slug, cat: "function-utility", area: "modulos", titulo, arquivos: doPrefixo(pref), familia: true });
  const fases = doPrefixo("engine/templates/phases/");
  addon({ slug: "engine-prompts-fases", cat: "function-utility", area: "modulos", titulo: "Prompts das fases do pipeline MCE", arquivos: fases.filter((d) => /\/prompt-/.test(d.rel)), familia: true });
  addon({ slug: "engine-templates-fases", cat: "function-utility", area: "modulos", titulo: "Templates das fases do pipeline: dossiê, narrativa e checkpoint", arquivos: fases.filter((d) => !/\/prompt-/.test(d.rel)), familia: true });
  addon({
    slug: "engine-prompts-mce", cat: "function-utility", area: "modulos", titulo: "Prompts de extração do MCE (engine)", familia: true,
    arquivos: [...doPrefixo("engine/intelligence/pipeline/mce/prompts/"), ...candidatos.filter((d) => d.rel === "engine/intelligence/pipeline/mce/coordinator_prompt.md")],
  });
  unico(doPrefixo("engine/intelligence/pipeline/mce/templates/"), (d) => ({ slug: `engine-mce-${slugify(stemDe(d.rel))}`, cat: "function-utility", area: "modulos", titulo: tituloDe(d) }));
  unico(doPrefixo("engine/tasks/_templates/"), (d) => ({ slug: `engine-tasks-${slugify(stemDe(d.rel))}`, cat: "function-utility", area: "modulos", titulo: tituloDe(d) }));
  unico(doPrefixo("agents/_templates/"), (d) => ({ slug: `agentes-${slugify(stemDe(d.rel))}`, cat: "function-utility", area: "modulos", titulo: tituloDe(d) }));

  // templates de squad: battle-logging é uma família; os demais, um add-on por nome (md + yaml juntos)
  for (const s of squads) {
    addon({ slug: `${s}-battle-logging`, cat: "function-utility", area: "modulos", titulo: `Templates de battle logging (${s})`, arquivos: doPrefixo(`squads/${s}/templates/battle-logging/`, { rec: true }), familia: true });
    unico(doPrefixo(`squads/${s}/templates/`), (d) => ({ slug: `${s}-${stemDe(d.rel)}`, cat: "function-utility", area: "modulos", titulo: tituloDe(d) }));
  }

  // workspace/_templates: uma família por pasta (marca = design-system); pastas só com README ficam de fora
  const wsPastas = [...new Set(candidatos.map((d) => d.rel.match(/^workspace\/_templates\/([^/]+)\//)?.[1]).filter(Boolean))].sort();
  for (const sub of wsPastas) {
    const arquivos = doPrefixo(`workspace/_templates/${sub}/`, { rec: true });
    if (arquivos.every((d) => /(^|\/)README\.md$/i.test(d.rel) && d.bytes < 1024)) continue;
    const rotulo = ROTULO_WORKSPACE[sub] ?? humanize(sub).toLowerCase();
    addon({
      slug: `workspace-templates-${slugify(sub)}`, cat: sub === "brand" ? "design-system" : "function-utility", area: "modulos",
      titulo: `Templates de workspace: ${rotulo}`, arquivos, familia: true,
    });
  }
  addon({ slug: "workspace-templates-mapa", cat: "function-utility", area: "modulos", titulo: "Mapa de camadas e guia dos templates de workspace", arquivos: doPrefixo("workspace/_templates/"), familia: true });

  // skills: templates e guias
  addon({ slug: "roundtable-templates-relatorio", cat: "function-utility", area: "skills", titulo: "Templates de relatório do roundtable: decisão, gaps e revisão", arquivos: doPrefixo(".claude/skills/roundtable/templates/"), familia: true });
  unico(doPrefixo(".claude/skills/_TEMPLATES/"), (d) => ({ slug: `skills-${slugify(stemDe(d.rel))}`, cat: "function-utility", area: "skills", titulo: tituloDe(d) }));
  unico(doPrefixo(".claude/skills/extract-knowledge/assets/"), (d) => ({ slug: `skill-extract-knowledge-${slugify(stemDe(d.rel))}`, cat: "function-utility", area: "skills", titulo: tituloDe(d) }));
  unico(doPrefixo(".claude/templates/", { filtro: (d) => d.ext === ".md" }), (d) => ({ slug: `claude-${slugify(stemDe(d.rel))}`, cat: "function-utility", area: "modulos", titulo: tituloDe(d) }));

  // GitHub e docs
  addon({
    slug: "github-templates", cat: "function-utility", area: "modulos", titulo: "Templates do GitHub: issues e pull request", familia: true,
    arquivos: candidatos.filter((d) => d.rel.startsWith(".github/") && /TEMPLATE/.test(d.rel)),
  });
  addon({ slug: "docs-templates-fase5", cat: "function-utility", area: "modulos", titulo: "Templates visuais da Fase 5 do pipeline", arquivos: doPrefixo("docs/templates/phase5/"), familia: true });
  unico(candidatos.filter((d) => d.rel === "docs/TEMPLATE-MASTER.md"), (d) => ({ slug: "docs-template-master", cat: "function-utility", area: "modulos", titulo: tituloDe(d) }));
  unico(doPrefixo("docs/prompts/"), (d) => ({ slug: `prompt-${slugify(stemDe(d.rel))}`, cat: "function-utility", area: "modulos", titulo: tituloDe(d) }));

  /* ---------------------------------------------------------------- slugs, títulos e resumos */
  const slugsUsuario = new Set();
  const manifestoFile = path.join(ctx.dataDir, "addons", "manifest.json");
  let manifestoAtual = { entries: [] };
  if (existsSync(manifestoFile)) {
    try { manifestoAtual = JSON.parse(await readFile(manifestoFile, "utf8")); } catch (e) {
      throw new Error(`addons: manifest.json existente está ilegível e não será sobrescrito (${String(e?.message ?? e).slice(0, 80)})`);
    }
    if (!Array.isArray(manifestoAtual?.entries)) throw new Error("addons: manifest.json existente não tem 'entries' e não será sobrescrito");
  }
  const entradasUsuario = manifestoAtual.entries.filter((e) => e?.gerado_por !== MARCA_ADDON);
  const slugDoId = (id) => (typeof id === "string" && id.includes(":") ? id.slice(id.indexOf(":") + 1) : String(id ?? ""));
  for (const e of entradasUsuario) slugsUsuario.add(slugDoId(e?.id));
  const slugsAntigos = manifestoAtual.entries.filter((e) => e?.gerado_por === MARCA_ADDON).map((e) => slugDoId(e.id));

  const slugsNovos = new Set();
  for (const sp of specs) {
    let s = slugify(sp.slug).slice(0, 80).replace(/-+$/, "") || "addon";
    if (slugsNovos.has(s) || slugsUsuario.has(s)) s = `${s.slice(0, 72).replace(/-+$/, "")}-${sha256(sp.slug).slice(0, 6)}`;
    slugsNovos.add(s);
    sp.slug = s;
  }
  // títulos repetidos ganham a origem
  const contagem = new Map();
  for (const sp of specs) contagem.set(sp.titulo, (contagem.get(sp.titulo) ?? 0) + 1);
  for (const sp of specs) {
    if (contagem.get(sp.titulo) > 1) sp.titulo = `${sp.titulo} (${dirDe(sp.arquivos[0].rel)})`;
  }

  const resumoDe = (sp, titulo) => {
    if (!sp.familia) {
      const r = representante(sp.arquivos);
      let base = sp.tipo === "checklist" ? resumoChecklist(r) : papelDeDoc(r);
      if (repeteTitulo(base, titulo)) base = ""; // resumo que só repete o título não informa nada
      if (/\{\{|\{[^}]*\}.*\{[^}]*\}/.test(base)) base = ""; // texto de template ({{x}}, {campo}) não descreve o padrão
      const origem = sp.arquivos.length > 1
        ? `Origem: ${r.rel} e mais ${sp.arquivos.length - 1} (${sp.arquivos.map((d) => d.ext.slice(1)).join(" + ")}).`
        : `Origem: ${r.rel}.`;
      return [corta(base, 400 - origem.length - 1), origem].filter(Boolean).join(" ");
    }
    const pasta = comumDir(sp.arquivos.map((d) => d.rel));
    const nomes = sp.arquivos.map((d) => tituloDe(d).replace(/\s*\([^)]*\)$/, "")).filter(Boolean);
    const lista = [...new Set(nomes)].join("; ");
    return `${sp.arquivos.length} arquivo${sp.arquivos.length === 1 ? "" : "s"} em ${pasta}: ${lista}`;
  };

  /* ---------------------------------------------------------------- entradas */
  const rastreado = (d) => gitInfo.ok && gitInfo.rastreados.has(d.rel) && !gitInfo.modificados.has(d.rel);
  const repository = gitInfo.origin ?? null;
  const entries = [];
  const artefatosPorSlug = new Map();
  for (const sp of specs) {
    const nomes = new Set();
    const artifacts = [];
    const arquivos = [];
    for (const d of sp.arquivos) {
      let id = path.posix.basename(d.rel).replace(/[^A-Za-z0-9._-]/g, "-").replace(/\.{2,}/g, ".");
      if (nomes.has(id.toLowerCase())) id = `${slugify(dirDe(d.rel).split("/").slice(-2).join("-"))}__${id}`;
      if (nomes.has(id.toLowerCase())) id = `${sha256(d.rel).slice(0, 6)}__${id}`;
      nomes.add(id.toLowerCase());
      const conteudo = d.text;
      artifacts.push({ id, media_type: MEDIA_TYPE[d.ext], size: Buffer.byteLength(conteudo, "utf8"), checksum: sha256(conteudo) });
      arquivos.push({ id, conteudo, origem: d.rel });
    }
    let titulo = corta(textoSeguro(limpaMd(sp.titulo)), 140);
    let resumo = corta(textoSeguro(resumoDe(sp, titulo)), 400);
    // texto do repositório nunca derruba o módulo: degrau a degrau, cai para algo que o app aceita (sem e-mail/chave)
    if (detectSecret(resumo) || suspeito(titulo, resumo)) resumo = corta(textoSeguro(`${sp.arquivos.length} arquivo(s) de ${comumDir(sp.arquivos.map((d) => d.rel))}`), 400);
    if (detectSecret(titulo) || suspeito(titulo, resumo)) {
      titulo = corta(textoSeguro(humanize(path.posix.basename(sp.arquivos[0].rel))), 140); // o nome do arquivo
      avisos.push(`add-on ${sp.slug}: título/resumo com e-mail ou chave; usado o nome do arquivo como título`);
    }
    if (detectSecret(titulo) || suspeito(titulo, resumo)) {
      titulo = humanize(sp.slug); // slug só tem [a-z0-9-]: sem '@', e o hífen some em humanize
      resumo = `${sp.arquivos.length} arquivo(s)`;
      avisos.push(`add-on ${sp.slug}: nem o nome do arquivo servia como título; usado o próprio slug`);
    }
    const todosLimpos = sp.arquivos.every(rastreado);
    entries.push({
      id: `${sp.cat}:${sp.slug}`,
      type: "addon",
      category: sp.cat,
      title: titulo,
      summary: resumo,
      areaBos: sp.area,
      source: { repository, revision: todosLimpos ? gitInfo.head : null, license: licenca, bucket: "confirmed_prod" },
      artifacts,
      preview_kind: "none",
      approval: "aprovado",
      distribution: "interno",
      gerado_por: MARCA_ADDON,
    });
    artefatosPorSlug.set(sp.slug, arquivos);
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  /* ---------------------------------------------------------------- gravação */
  const raizArtefatos = path.join(ctx.dataDir, "addons", "artifacts");
  let gravados = 0;
  for (const [slug, arquivos] of artefatosPorSlug) {
    const dir = path.join(raizArtefatos, slug);
    for (const a of arquivos) {
      const alvo = path.join(dir, a.id);
      if (existsSync(alvo) && (await readFile(alvo, "utf8")) === a.conteudo) continue;
      await writeText(alvo, a.conteudo);
      gravados++;
    }
    // arquivos que nós gravamos antes e não existem mais neste add-on
    if (existsSync(dir)) {
      const manter = new Set(arquivos.map((a) => a.id));
      for (const nome of await readdir(dir)) {
        if (!manter.has(nome) && (await lstat(path.join(dir, nome))).isFile()) await rm(path.join(dir, nome), { force: true });
      }
    }
  }
  // pastas de add-ons que geramos antes e saíram do catálogo
  let removidos = 0;
  for (const slug of new Set(slugsAntigos)) {
    if (slugsNovos.has(slug) || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) continue;
    const dir = path.join(raizArtefatos, slug);
    if (existsSync(dir) && (await lstat(dir)).isDirectory()) { await rm(dir, { recursive: true, force: true }); removidos++; }
  }

  const manifesto = `${JSON.stringify({ entries: [...entries, ...entradasUsuario] }, null, 2)}\n`;
  if (!existsSync(manifestoFile) || (await readFile(manifestoFile, "utf8")) !== manifesto) await writeText(manifestoFile, manifesto);

  /* ---------------------------------------------------------------- verificação interna */
  let artefatos = 0;
  for (const e of entries) {
    for (const a of e.artifacts) {
      const txt = await readFile(path.join(raizArtefatos, slugDoId(e.id), a.id), "utf8");
      if (sha256(txt) !== a.checksum || Buffer.byteLength(txt, "utf8") !== a.size) throw new Error(`addons: checksum/size divergente em ${e.id}/${a.id}`);
      artefatos++;
    }
  }
  const porCategoria = {};
  for (const e of entries) porCategoria[e.category] = (porCategoria[e.category] ?? 0) + 1;
  if (duplicados.length) avisos.push(`${duplicados.length} arquivo(s) de conteúdo idêntico a outro já incluído foram omitidos (ex.: ${duplicados.slice(0, 2).join("; ")})`);
  log(MODULO, `manifest.json: ${entries.length} add-ons, ${artefatos} artefatos (${gravados} gravados agora, ${removidos} pastas antigas removidas, ${entradasUsuario.length} entradas suas preservadas)`);
  return {
    resumo: { addons: entries.length, artefatos, porCategoria, preservadas: entradasUsuario.length, duplicadosOmitidos: duplicados.length, revisao: gitInfo.head },
    avisos,
  };
}

/** Pasta comum (prefixo de diretório) de uma lista de caminhos posix. */
function comumDir(rels) {
  const partes = rels.map((r) => dirDe(r).split("/"));
  const comum = [];
  for (let i = 0; i < partes[0].length; i++) {
    if (partes.every((p) => p[i] === partes[0][i])) comum.push(partes[0][i]); else break;
  }
  return comum.join("/") || ".";
}
