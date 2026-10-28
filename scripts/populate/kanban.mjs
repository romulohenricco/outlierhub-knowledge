/**
 * Módulo `kanban` — popula `data/kanban/board.json` com tickets derivados de FATOS
 * verificáveis do mega-brain (nada inventado). Fontes:
 *
 *   1. ADRs (`docs/adrs/*.md`): decisão ACEITA vira card em DONE; proposta/pendente e
 *      seções marcadas DEFERRED viram TO DO; as referências do ADR são conferidas no disco.
 *   2. Marcadores explícitos no texto do repositório (TODO TIL-23, `status: not_implemented`,
 *      `status: placeholder`, "not yet implemented", fila `status: pending`...). Cada marcador é
 *      reencontrado a cada execução (arquivo:linha vivos); se sumir, o card some junto.
 *   3. Referências quebradas CONFIRMADAS no disco: caminho citado por código/config/regra que não
 *      existe (imports `engine.*`, listas de verificação, registros). Ocorrências agrupadas por alvo.
 *   4. Backlog de integração do próprio Knowledge (busca semântica, buckets vazios, lock do app).
 *
 * Contrato com o app (lib/kanban.ts, lib/types.ts): cards completos, ids `PPP-n` por tipo,
 * `origem.canal = "populate-megabrain"` e `origem.pedidoOriginal = "populate:<tipo>:<id>"` como
 * chave estável. O mapa chave→id vive em `data/kanban/.populate-ids.json`.
 *
 * Mesclagem (idempotente, nunca destrói estado do usuário):
 *   - cards com `origem.canal` diferente do nosso nunca são tocados;
 *   - card gerenciado e NÃO editado → campos descritivos atualizados só se o fato mudou;
 *   - card gerenciado e editado pelo usuário → preservado integralmente;
 *   - card cujo fato sumiu → removido só se estiver intocado; senão mantido (aviso);
 *   - card apagado pelo usuário → não é recriado, mesmo que seja o último ou que o board tenha sido
 *     limpo (a decisão vem do mapa de ids; só um board NOVO — arquivo ausente, ou contadores menores
 *     que o id — recria; para recriar de propósito, remova `.populate-ids.json`);
 *   - coluna, ordem, checklist marcado, histórico, áudios, imagens e responsável nunca são reescritos.
 *
 * Concorrência com o app (o dev server grava o mesmo board.json, sem lock entre processos):
 *   - a varredura lenta (gerarSpecs) roda ANTES de ler o board; leitura→mescla→gravação levam milissegundos;
 *   - antes do rename o módulo confere que o board.json no disco ainda é o texto que foi mesclado; se o app
 *     gravou no intervalo, refaz a mescla sobre a versão nova (até 6 vezes) em vez de sobrescrevê-la;
 *   - antes de sobrescrever um board existente grava o snapshot diário `backups/board-AAAAMMDD.json`
 *     (mesma regra e retenção de 14 do app, lib/kanban.ts).
 *
 * Primeiro uso (lib/primeiro-uso.ts): rodar o populate É a resposta "sim" à pergunta "Popular o
 * Knowledge com o seu Megabrain?" que o app faz ao se ver em `<Megabrain>/apps/`. Quem responde NÃO é o
 * `run` deste módulo, que roda no meio da população (antes de referencias, busca e ambiente): é
 * populate.mjs, DEPOIS do laço dos módulos, chamando `responderPrimeiroUso` (exportada daqui, único
 * escritor de `<data>/primeiro-uso.json`) com o resultado de todos. Quando a execução é completa (nenhum
 * módulo tirado por `--only`/`--skip`), todos terminaram ok e o Megabrain que o app detectaria (pelos
 * `.env*` dele) é o repositório lido, uma pergunta ainda pendente vira `aceito`, sem card; resposta já
 * dada nunca é tocada.
 *
 * Sem rede. O `run` só grava em `<data>/kanban/`; `responderPrimeiroUso`, só em `<data>/primeiro-uso.json`.
 * O repositório é lido, nunca alterado.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { load as yamlLoad } from "js-yaml";
import { ativarExclusoes, caminhoExcluido, log, sha256, slugify, toPosix, variavelDosArquivosDoApp, writeText } from "./common.mjs";
import { MODULOS, modulosForaDaExecucao } from "../populate.mjs";

export const CANAL = "populate-megabrain";
const PREFIXO_MAPA = "populate:";

/** Espelha PREFIXO_TIPO de lib/kanban.ts (o teste confere a igualdade). */
export const PREFIXO_TIPO = {
  ingest: "ING", clone: "CLN", autolearning: "LRN", feature: "FEA",
  melhoria: "MEL", bug: "BUG", infra: "INF", outro: "TSK",
};
const TIPOS = Object.keys(PREFIXO_TIPO);
const PRIORIDADE_RANK = { urgente: 0, alta: 1, media: 2, baixa: 3 };
const TIPO_ORDEM = ["bug", "infra", "feature", "melhoria", "ingest", "clone", "autolearning", "outro"];
const COLUNAS_PADRAO = [
  { id: "todo", rotulo: "TO DO" },
  { id: "doing", rotulo: "DOING" },
  { id: "done", rotulo: "DONE" },
  { id: "cancel", rotulo: "CANCEL" },
];

/* ------------------------------------------------------------------ utilitários */

const posix = path.posix;
const ordena = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** JSON canônico (chaves ordenadas) — base do hash de conteúdo gerenciado. */
function estavel(v) {
  if (Array.isArray(v)) return v.map(estavel);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, estavel(v[k])]));
  }
  return v;
}
const hashDe = (v) => sha256(JSON.stringify(estavel(v)));

/** Remove emojis/negrito/crases de um título vindo de heading. */
function limpaTitulo(s) {
  return s
    .replace(/[*`_]/g, "")
    .replace(/(?:[\u{1F000}-\u{1FFFF}☀-➿⏰-⏿]|\uFE0F)/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Filtro dos blocos opcionais da descrição: `null`/`false` somem, "" é linha em branco. */
const presente = (x) => x !== null && x !== undefined && x !== false;

const linkMd = (rel, line) => `\`${rel}${line ? `:${line}` : ""}\``;

/** `lib/types.ts` é a fonte da DoD e dos projetos aceitos; importar evita duplicar texto. */
async function carregarTipos(appRoot) {
  const emitir = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return await import(pathToFileURL(path.join(appRoot, "lib", "types.ts")).href);
  } catch {
    return null;
  } finally {
    process.emitWarning = emitir;
  }
}

/** Remote `origin` sem credenciais, em https; `null` se indisponível. */
export function remoteBase(repoRoot) {
  try {
    const bruto = execFileSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    let m = bruto.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (m) return `https://${m[1]}/${m[2]}`;
    if (!/^https?:\/\//i.test(bruto)) return null;
    const u = new URL(bruto);
    u.username = "";
    u.password = "";
    return `${u.protocol}//${u.host}${u.pathname.replace(/\.git$/, "").replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function arquivosVersionados(repoRoot) {
  try {
    const saida = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024,
    });
    return new Set(saida.split("\0").filter(Boolean));
  } catch {
    return new Set();
  }
}

/* ------------------------------------------------------------------ contexto de varredura */

function criarCtx(ctx) {
  const porRel = new Map(ctx.docs.map((d) => [d.rel, d]));
  const cacheLinhas = new Map();
  const linhasDe = (rel) => {
    if (!cacheLinhas.has(rel)) cacheLinhas.set(rel, porRel.get(rel)?.text.split("\n") ?? null);
    return cacheLinhas.get(rel);
  };
  /** Linhas (1-based) de `rel` que casam `re`. */
  const acha = (rel, re) => {
    const ls = linhasDe(rel);
    if (!ls) return [];
    const out = [];
    ls.forEach((l, i) => { if (re.test(l)) out.push({ rel, line: i + 1, text: l.trim() }); });
    return out;
  };
  const existe = (rel) => existsSync(path.join(ctx.repoRoot, rel));
  const tracked = arquivosVersionados(ctx.repoRoot);
  const base = remoteBase(ctx.repoRoot);
  return { ...ctx, porRel, linhasDe, acha, existe, tracked, base, cobertos: new Set(), raizesApps: null };
}

function githubLink(c, ev) {
  if (!c.base || !ev?.line || !c.tracked.has(ev.rel)) return null;
  const caminho = ev.rel.split("/").map(encodeURIComponent).join("/");
  const repo = c.base.split("/").slice(-2).join("/");
  return { tipo: "github", url: `${c.base}/blob/main/${caminho}#L${ev.line}`, repo };
}

/** Vínculo com o livro da estante (só docs md/txt viram livro). */
function vinculoLivro(c, rel) {
  const d = c.porRel.get(rel);
  if (!d || d.kind !== "doc") return null;
  return { tipo: "livro", id: d.id, titulo: d.title, linkLocal: `/livro/${d.id}` };
}

/* ------------------------------------------------------------------ especificação de card */

/**
 * @typedef {Object} Spec
 * @property {string} key  ex.: "adr:ADR-PA-001" (vira pedidoOriginal "populate:<key>")
 * @property {string} tipo
 * @property {"alta"|"media"|"baixa"|"urgente"} prioridade
 * @property {"todo"|"done"} coluna
 * @property {string} titulo
 * @property {string} descricao
 * @property {string[]} tags
 * @property {{rel:string,line?:number}[]} evidencias
 * @property {string[]} [passos]      itens de checklist específicos (a DoD do tipo é somada)
 * @property {string[]} [fonteTipo]
 * @property {string|null} [bucket]
 * @property {object|null} [execucao]
 * @property {string|null} [concluidoEm]
 * @property {string} [nota]          nota da 1ª linha do histórico
 */

function spec(partial) {
  return {
    prioridade: "media", coluna: "todo", tags: [], passos: [], fonteTipo: ["outro"],
    bucket: null, execucao: { modo: "agente" }, concluidoEm: null, nota: "", ...partial,
  };
}

/* ================================================================== FONTE 1 — ADRs */

function secao(linhas, idx, nivel) {
  let fim = linhas.length;
  for (let i = idx + 1; i < linhas.length; i++) {
    const m = linhas[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= nivel) { fim = i; break; }
  }
  return { ini: idx + 1, fim, linhas: linhas.slice(idx, fim) };
}

/** Citação em blockquote, sem linhas em branco nas pontas. */
const citacao = (linhas, max = 40) => {
  let ini = 0;
  let fim = linhas.length;
  while (ini < fim && !linhas[ini].trim()) ini++;
  while (fim > ini && !linhas[fim - 1].trim()) fim--;
  const util = linhas.slice(ini, fim);
  return util.slice(0, max).map((l) => `> ${l}`.trimEnd()).join("\n") + (util.length > max ? "\n> …" : "");
};

function statusAdr(textoStatus) {
  const t = textoStatus.toUpperCase();
  if (/\b(ACCEPTED|ACEIT[OA]|APPROVED|APROVAD[OA])\b/.test(t)) return "aceita";
  if (/\b(PROPOSED|PROPOSTA?|DRAFT|RASCUNHO|PENDING|PENDENTE|IN REVIEW|EM REVIS[AÃ]O)\b/.test(t)) return "pendente";
  return null;
}

/** Referências do ADR conferidas no disco: caminhos em backticks da seção References. */
function referenciasAusentes(c, d) {
  const ls = c.linhasDe(d.rel);
  const idx = ls.findIndex((l) => /^##\s+(References|Refer[eê]ncias)\b/i.test(l));
  const alvos = [];
  const varrer = (ini, fim) => {
    for (let i = ini; i < fim; i++) {
      for (const m of ls[i].matchAll(/`([A-Za-z0-9_.][A-Za-z0-9_\-./]*\/[A-Za-z0-9_\-./]*[A-Za-z0-9_])`/g)) {
        alvos.push({ rel: m[1], line: i + 1 });
      }
    }
  };
  // evidência declarada no cabeçalho + seção References
  varrer(0, Math.min(ls.length, 15));
  if (idx >= 0) varrer(idx, secao(ls, idx, 2).fim);
  const vistos = new Set();
  const ausentes = [];
  let total = 0;
  for (const a of alvos) {
    if (vistos.has(a.rel) || /[*{}<>]/.test(a.rel)) continue;
    vistos.add(a.rel);
    total++;
    if (!c.existe(a.rel)) ausentes.push(a);
  }
  return { ausentes, total };
}

function fontesAdr(c) {
  const out = [];
  const adrs = c.docs.filter((d) => /^docs\/adrs\/[^/]+\.md$/.test(d.rel) && !/readme|template/i.test(d.rel));
  for (const d of adrs) {
    const ls = c.linhasDe(d.rel);
    const id = (d.rel.match(/ADR-[A-Z0-9]+-\d+/) ?? [posix.basename(d.rel, ".md")])[0];
    const h1Idx = ls.findIndex((l) => /^#\s+/.test(l));
    const h1 = h1Idx >= 0 ? limpaTitulo(ls[h1Idx].replace(/^#\s+/, "")) : id;
    const nome = h1.replace(/^ADR-[A-Z0-9-]+\s*[—–-]\s*/, "");
    const cab = ls.slice(0, Math.max(0, ls.findIndex((l, i) => i > 0 && /^(---|##\s)/.test(l))));
    const cabecalho = cab.length ? cab : ls.slice(0, 12);
    const linhaStatus = cabecalho.findIndex((l) => /\*\*Status:?\*\*/i.test(l));
    const textoStatus = linhaStatus >= 0 ? cabecalho[linhaStatus].replace(/^>?\s*\*\*Status:?\*\*:?\s*/i, "").trim() : "";
    const estado = statusAdr(textoStatus);

    // datas do ADR: cabeçalho + "Decision Status Log"
    const idxLog = ls.findIndex((l) => /^##\s+Decision Status Log/i.test(l));
    const trechoDatas = [...cabecalho, ...(idxLog >= 0 ? secao(ls, idxLog, 2).linhas : [])];
    const datas = trechoDatas.flatMap((l) => l.match(/\b20\d\d-\d\d-\d\d\b/g) ?? []).sort();
    const ultima = datas.at(-1) ?? null;

    const ev = [{ rel: d.rel, line: 1 }];
    const vinc = vinculoLivro(c, d.rel);
    const decIdx = ls.findIndex((l) => /^##\s+(Decision|Decis[aã]o)\b/i.test(l));
    const decisao = decIdx >= 0 ? secao(ls, decIdx, 2) : null;
    const meta = cabecalho.filter((l) => /\*\*(Story|Empirical evidence|Plans evaluated|Date):?\*\*/i.test(l))
      .map((l) => `- ${l.replace(/^>\s*/, "")}`);

    if (!estado) {
      log("kanban", `ADR ${id}: status "${textoStatus}" não reconhecido — ignorado`);
    } else {
      const aceita = estado === "aceita";
      out.push(spec({
        key: `adr:${id}`,
        tipo: "outro",
        prioridade: "media",
        coluna: aceita ? "done" : "todo",
        titulo: aceita ? `${id} aceita — ${nome}` : `${id} pendente de decisão — ${nome}`,
        descricao: [
          aceita
            ? `Decisão **aceita**, registrada em ${linkMd(d.rel, linhaStatus >= 0 ? linhaStatus + 1 : 1)} (status no ADR: "${textoStatus}"${ultima ? `; último registro em ${ultima}` : ""}).`
            : `Decisão ainda **não aceita** em ${linkMd(d.rel, linhaStatus >= 0 ? linhaStatus + 1 : 1)} (status no ADR: "${textoStatus}"). Fechar a decisão e registrar o status no próprio ADR.`,
          "",
          meta.length ? ["## Cabeçalho do ADR", ...meta, ""].join("\n") : null,
          decisao ? [`## Decisão (trecho literal, ${d.rel}:${decisao.ini}-${decisao.fim})`, citacao(decisao.linhas.slice(1)), ""].join("\n") : null,
          "## Evidência",
          `- ADR: ${linkMd(d.rel, 1)}`,
        ].filter(presente).join("\n"),
        tags: ["populate", "adr", id.toLowerCase()],
        evidencias: ev,
        vinculos: vinc ? [vinc] : [],
        fonteTipo: ["doc"],
        execucao: aceita ? null : { modo: "humano" },
        concluidoEm: aceita && ultima ? `${ultima}T00:00:00.000Z` : null,
        nota: aceita
          ? `Decisão aceita no ADR (${ultima ?? "sem data"}). Card criado já em DONE pelo populate; nada a executar.`
          : "ADR ainda não aceito — decisão pendente.",
      }));
    }

    // seções DEFERRED
    const diferidas = [];
    ls.forEach((l, i) => {
      const m = l.match(/^(#{2,4})\s+(.*\b(?:DEFERRED|ADIAD[OA])\b.*)$/);
      if (m) diferidas.push({ idx: i, nivel: m[1].length, titulo: m[2] });
    });
    const runsDiferidos = new Set();
    for (const df of diferidas) {
      const s = secao(ls, df.idx, df.nivel);
      for (const r of s.linhas.join("\n").match(/Run #\d+(?:\.\d+)?/g) ?? []) runsDiferidos.add(r);
      for (const r of df.titulo.match(/Run #\d+(?:\.\d+)?/g) ?? []) runsDiferidos.add(r);
      const gatilhos = s.linhas.flatMap((l) => {
        const out2 = [];
        for (const m of l.matchAll(/(\d+)\s*dias/g)) out2.push({ n: Number(m[1]), texto: l.trim().replace(/^[-*]\s+/, "") });
        return out2;
      });
      const titulo = limpaTitulo(df.titulo.replace(/\b(?:DEFERRED|ADIAD[OA])\b(?:\s+to\s+[\w #.]+)?/i, "")).replace(/[—–-]\s*$/, "").trim();
      const slug = slugify(titulo).slice(0, 40).replace(/-+$/, "");
      out.push(spec({
        key: `adr-pendente:${id}:${slug}`,
        tipo: "autolearning",
        prioridade: "media",
        titulo: `${id} · adiado: ${titulo}`,
        descricao: [
          `O ${id} marca esta frente como **DEFERRED** em ${linkMd(d.rel, df.idx + 1)}. Ela não foi executada quando a decisão foi aceita e segue em aberto.`,
          "",
          `## Trecho literal do ADR (${d.rel}:${s.ini}-${s.fim})`,
          citacao(s.linhas, 24),
          "",
          gatilhos.length && ultima
            ? ["## Gatilhos de reavaliação citados (datas calculadas a partir do último registro do ADR)",
              ...gatilhos.map((g) => `- ${g.n} dias após ${ultima} = ${addDias(ultima, g.n)} — "${g.texto}"`), ""].join("\n")
            : null,
          "## Evidência",
          `- ${linkMd(d.rel, df.idx + 1)}`,
        ].filter(presente).join("\n"),
        tags: ["populate", "adr", id.toLowerCase(), "adiado"],
        evidencias: [{ rel: d.rel, line: df.idx + 1 }],
        vinculos: vinc ? [vinc] : [],
        fonteTipo: ["doc"],
        passos: ["Reproduzir o procedimento descrito na seção do ADR", "Registrar o resultado e atualizar o status no próprio ADR"],
        nota: `Seção marcada DEFERRED em ${d.rel}:${df.idx + 1}.`,
      }));
    }

    // gatilhos de reavaliação por prazo (fora das seções DEFERRED, sem duplicar "Run #n")
    const dentroDeDiferida = (i) => diferidas.some((df) => { const s = secao(ls, df.idx, df.nivel); return i >= s.ini - 1 && i < s.fim; });
    const porDias = new Map();
    ls.forEach((l, i) => {
      const m = l.match(/^\s*[-*]\s+(\d+)\s+dias:\s*(.+?)\s*$/);
      if (!m || dentroDeDiferida(i)) return;
      const runs = m[2].match(/Run #\d+(?:\.\d+)?/g) ?? [];
      if (runs.some((r) => runsDiferidos.has(r))) return;
      if (!porDias.has(m[1])) porDias.set(m[1], { n: Number(m[1]), texto: m[2], line: i + 1 });
    });
    for (const g of [...porDias.values()].sort((a, b) => a.n - b.n)) {
      out.push(spec({
        key: `adr-prazo:${id}:${g.n}d`,
        tipo: "melhoria",
        prioridade: "baixa",
        titulo: `${id} · reavaliar em ${g.n} dias: ${g.texto.replace(/[.]+$/, "")}`,
        descricao: [
          `O ${id} define um gatilho de reavaliação de **${g.n} dias** em ${linkMd(d.rel, g.line)}: "${g.texto}".`,
          ultima ? `\nPrazo calculado: ${g.n} dias após o último registro do ADR (${ultima}) = **${addDias(ultima, g.n)}**.` : null,
          "",
          "## Evidência",
          `- ${linkMd(d.rel, g.line)}`,
        ].filter(presente).join("\n"),
        tags: ["populate", "adr", id.toLowerCase(), "reavaliacao"],
        evidencias: [{ rel: d.rel, line: g.line }],
        vinculos: vinc ? [vinc] : [],
        fonteTipo: ["doc"],
        passos: ["Executar a reavaliação descrita no gatilho", "Registrar o resultado no Decision Status Log do ADR"],
        nota: `Gatilho de reavaliação (${g.n} dias) em ${d.rel}:${g.line}.`,
      }));
    }

    // referências do ADR que não existem no repositório
    const { ausentes, total } = referenciasAusentes(c, d);
    if (ausentes.length) {
      out.push(spec({
        key: `adr-refs:${id}`,
        tipo: "melhoria",
        prioridade: "baixa",
        titulo: `${id} cita ${ausentes.length} de ${total} artefatos que não existem no repositório`,
        descricao: [
          `O ${id} aponta, no cabeçalho e na seção References, para ${total} caminhos. Verificados no disco, **${ausentes.length} não existem**:`,
          "",
          ...ausentes.map((a) => `- \`${a.rel}\` (citado em ${linkMd(d.rel, a.line)})`),
          "",
          "A decisão do ADR fica sem a evidência reproduzível enquanto esses artefatos não forem restaurados na distribuição ou as referências não forem corrigidas.",
        ].join("\n"),
        tags: ["populate", "adr", id.toLowerCase(), "referencia-ausente"],
        evidencias: [{ rel: d.rel, line: ausentes[0].line }],
        vinculos: vinc ? [vinc] : [],
        fonteTipo: ["doc"],
        passos: ["Restaurar os artefatos citados ou apontar para o equivalente existente", "Reconferir a lista de referências do ADR"],
        nota: `Referências ausentes conferidas no disco (${ausentes.length}/${total}).`,
      }));
    }
  }
  return out;
}

/* ================================================================== FONTE 2 — marcadores explícitos */

function fontesMarcadores(c) {
  const out = [];
  const add = (s) => out.push(spec(s));

  // 2.1 TODO TIL-23 (authority registry)
  {
    const rel = ".claude/hooks/post_task_suggester.py";
    const hits = c.acha(rel, /TODO TIL-23/);
    if (hits.length) {
      const reg = c.acha(rel, /8 entries/).at(0);
      add({
        key: "marcador:til-23-authority-registry",
        tipo: "melhoria",
        prioridade: "media",
        titulo: "Trocar a AUTHORITY_BLOCKLIST fixa por um registro de autoridade legível por máquina (TIL-23)",
        descricao: [
          `O hook \`${rel}\` carrega uma \`AUTHORITY_BLOCKLIST\` escrita direto no código${reg ? ` (o comentário informa 8 entradas, ${linkMd(rel, reg.line)})` : ""}, espelho manual da tabela "Exclusive Authorities" de \`.claude/rules/agent-authority.md\`. O próprio código marca a pendência: \`TODO TIL-23 — proper machine-readable authority registry\`.`,
          "",
          "Enquanto o registro não existe, qualquer mudança na tabela de autoridade exige editar o dicionário à mão e os dois podem divergir.",
          "",
          "## Evidência",
          ...hits.map((h) => `- ${linkMd(h.rel, h.line)} — \`${h.text.slice(0, 110)}\``),
        ].join("\n"),
        tags: ["populate", "marcador", "hooks", "autoridade", "til-23"],
        evidencias: hits.concat(c.existe(".claude/rules/agent-authority.md") ? [{ rel: ".claude/rules/agent-authority.md" }] : []),
        passos: [
          "Definir o formato do registro (YAML/JSON) a partir da tabela de agent-authority.md",
          "Carregar o registro no hook e remover o dicionário fixo",
          "Cobrir com teste que compara registro × tabela de autoridade",
        ],
        nota: `Marcador TODO TIL-23 em ${rel}:${hits[0].line}.`,
      });
    }
  }

  // 2.2 thresholds com status not_implemented
  {
    const rel = "engine/intelligence/pipeline/config/thresholds.yaml";
    const doc = c.porRel.get(rel);
    if (doc) {
      let dados = null;
      try { dados = yamlLoad(doc.text); } catch { dados = null; }
      const tabela = dados?.thresholds ?? {};
      const meta = {
        role_creation: { prio: "media", t: "T1", titulo: "Implementar a criação automática de cargo agent pelo role tracker (threshold T1)" },
        dna_consolidation: { prio: "baixa", t: "T3", titulo: "Separar o gatilho de consolidação narrativa do DNA (densidade 4/5, threshold T3)" },
        anomaly_detection: { prio: "media", t: "T5", titulo: "Implementar a detecção de anomalia cross-batch (threshold T5)" },
        depara_match_rate: { prio: "media", t: "T6", titulo: "Aplicar OK/WARN/HALT à taxa de match do DE-PARA (threshold T6), hoje só reportada" },
        template_evolution: { prio: "baixa", t: "T9", titulo: "Implementar a evolução de template de agente (Phase 7.5, threshold T9)" },
      };
      const ls = c.linhasDe(rel);
      for (const chave of Object.keys(tabela).sort()) {
        const e = tabela[chave];
        if (!e || e.status !== "not_implemented") continue;
        const ini = ls.findIndex((l) => new RegExp(`^  ${chave}:\\s*$`).test(l));
        let linhaStatus = null;
        for (let i = ini + 1; i < ls.length && ini >= 0; i++) {
          if (/^ {2}\S/.test(ls[i])) break;
          if (/^\s+status:\s*not_implemented/.test(ls[i])) { linhaStatus = i + 1; break; }
        }
        const m = meta[chave] ?? { prio: "media", t: chave, titulo: `Implementar o threshold "${chave}"` };
        const valores = Object.entries(e).filter(([k, v]) => typeof v !== "object" && !["status", "source", "description", "note", "pending_story"].includes(k));
        const extra = chave === "template_evolution" ? c.acha("engine/intelligence/pipeline/mce/decision_gateway.py", /NOP stub/) : [];
        const loader = c.acha("engine/intelligence/pipeline/config/threshold_loader.py", new RegExp(`"${chave}"`));
        const ev = [{ rel, line: linhaStatus ?? (ini >= 0 ? ini + 1 : 1) }, ...extra.slice(0, 1)];
        add({
          key: `marcador:threshold:${chave}`,
          tipo: "feature",
          prioridade: m.prio,
          titulo: m.titulo,
          descricao: [
            `O registro central de thresholds do pipeline MCE marca \`${chave}\` como \`status: not_implemented\` em ${linkMd(rel, ev[0].line)}.`,
            "",
            e.description ? `**Descrição no YAML:** ${e.description}` : null,
            e.source ? `**Fonte declarada:** ${e.source}` : null,
            e.pending_story ? `**Story pendente:** ${e.pending_story}` : null,
            e.note ? `**Nota:** ${e.note}` : null,
            valores.length ? `**Valores já definidos:** ${valores.map(([k, v]) => `\`${k}: ${v}\``).join(", ")}` : null,
            "",
            "## Evidência",
            `- ${linkMd(rel, ev[0].line)} — \`status: not_implemented\``,
            ...extra.slice(0, 1).map((x) => `- ${linkMd(x.rel, x.line)} — \`${x.text.slice(0, 100)}\` (stub sem efeito)`),
            ...loader.slice(0, 1).map((x) => `- ${linkMd(x.rel, x.line)} — default repetido no loader com o mesmo status`),
          ].filter(presente).join("\n"),
          tags: ["populate", "marcador", "pipeline-mce", "threshold", m.t.toLowerCase()],
          evidencias: ev,
          passos: [
            "Implementar o enforcement descrito no YAML no ponto indicado em source",
            "Trocar status para implemented no YAML e no default do threshold_loader.py",
            "Cobrir com teste que exercita o limiar",
          ],
          nota: `thresholds.yaml marca ${chave} como not_implemented.`,
        });
      }
    }
  }

  // 2.3 product_detector é um no-op
  {
    const rel = "engine/intelligence/pipeline/product_detector.py";
    const hits = c.acha(rel, /real router not yet implemented/);
    if (hits.length) {
      add({
        key: "marcador:product-detector-stub",
        tipo: "feature",
        prioridade: "baixa",
        titulo: "Implementar o roteador real do product_detector (hoje devolve detected=False)",
        descricao: [
          `\`${rel}\` é um stub: devolve sempre \`detected: False\` com o motivo "product_detector stub -- real router not yet implemented" (${linkMd(rel, hits[0].line)}). A docstring descreve o que falta: classificar o insight, escolher o YAML de produto alvo e aplicar a mudança ou deixá-la como proposta.`,
          "",
          "Enquanto isso, a etapa de finalização registra \"0 routed / 0 staged\" para qualquer insight.",
          "",
          "## Evidência",
          `- ${linkMd(rel, hits[0].line)}`,
        ].join("\n"),
        tags: ["populate", "marcador", "pipeline-mce", "stub"],
        evidencias: hits,
        passos: ["Definir o critério de classificação de insight para produto", "Implementar roteamento (aplicar ou propor) com dry_run", "Testar com insights reais de um produto de exemplo"],
        nota: `Stub declarado em ${rel}:${hits[0].line}.`,
      });
    }
  }

  // 2.4 dispatcher mcp/api não implementados (+ engine/operations.py ausente)
  {
    const rel = "bin/mega-brain.js";
    const mcp = c.acha(rel, /MCP dispatch mode not yet implemented/);
    const api = c.acha(rel, /API dispatch mode not yet implemented/);
    if (mcp.length || api.length) {
      const hits = [...mcp, ...api];
      const operacoes = !c.existe("engine/operations.py");
      add({
        key: "marcador:dispatch-mcp-api",
        tipo: "feature",
        prioridade: "baixa",
        titulo: "Implementar os modos de despacho mcp e api do CLI (hoje lançam erro)",
        descricao: [
          `O CLI \`${rel}\` aceita \`MEGABRAIN_DISPATCH_MODE\` = \`subprocess\` (padrão), \`mcp\` ou \`api\`, mas os dois últimos apenas lançam \`Error\` ("not yet implemented"): ${hits.map((h) => linkMd(h.rel, h.line)).join(", ")}. O próprio código os chama de "future".`,
          operacoes
            ? "\n**Atenção:** o modo padrão (`subprocess`) executa `from engine.operations import dispatch`, mas `engine/operations.py` **não existe** no disco — o despacho padrão também não tem onde chegar."
            : null,
          "",
          "## Evidência",
          ...hits.map((h) => `- ${linkMd(h.rel, h.line)} — \`${h.text.slice(0, 100)}\``),
        ].filter(presente).join("\n"),
        tags: ["populate", "marcador", "cli", "despacho"],
        evidencias: hits,
        passos: ["Decidir se mcp e api entram no escopo desta distribuição", "Implementar os modos ou remover as opções do CLI", ...(operacoes ? ["Restaurar engine/operations.py (o modo subprocess depende dele)"] : [])],
        nota: `Modos mcp/api lançam Error em ${rel}.`,
      });
    }
  }

  // 2.5 cost-tracker do chronicler
  {
    const rel = ".claude/skills/chronicler/chronicler_v4_render.py";
    const hits = c.acha(rel, /contador centralizado pendente|Wiring do cost-tracker/);
    // O que o arquivo diz sobre a origem dos dados dos 44 passos (docstring: "real Jeremy Haynes data";
    // comentário de STEPS: "real JH values"). A afirmação sai do próprio arquivo, nunca da interpretação.
    const declaraReais = c.acha(rel, /full render driver \(real .+ data\)/).at(0);
    if (hits.length) {
      const origemDados = declaraReais
        ? `a partir de dados fixos escritos no próprio arquivo — a docstring os declara reais (${linkMd(rel, declaraReais.line)}) —`
        : "a partir de dados fixos escritos no próprio arquivo";
      add({
        key: "marcador:chronicler-cost-tracker",
        tipo: "feature",
        prioridade: "baixa",
        titulo: "Ligar o contador central de custo de LLM ao Chronicler v4 (passo 39 está marcado como pendente)",
        descricao: [
          `O driver de render do Chronicler v4 (\`${rel}\`) renderiza os 44 passos ${origemDados} e marca o passo 39 ("LLM COST + PROVIDER") como "$0 · contador centralizado pendente (follow-up conhecido)" e comenta que o wiring do cost-tracker é um follow-up separado (${hits.map((h) => linkMd(h.rel, h.line)).join(", ")}).`,
          "",
          "Enquanto o contador central não for ligado a esse passo, a rastreabilidade de custo por fase que o relatório promete não tem fonte real.",
          "",
          "## Evidência",
          ...hits.map((h) => `- ${linkMd(h.rel, h.line)} — \`${h.text.slice(0, 110)}\``),
        ].join("\n"),
        tags: ["populate", "marcador", "chronicler", "custo"],
        evidencias: hits,
        passos: ["Escolher a fonte única de custo (contador central)", "Ler esse contador no render do passo 39", "Conferir um relatório gerado com custo diferente de zero"],
        nota: `Follow-up declarado em ${rel}:${hits[0].line}.`,
      });
    }
  }

  // 2.6 engines/adapters planejados no orquestrador-global
  {
    const rel = "squads/orquestrador-global/data/execution-engine-registry.yaml";
    const hits = c.acha(rel, /Direct @example-squad SDK invocation remains/);
    if (hits.length) {
      const squadRef = c.acha(rel, /planned\/absent in this branch/);
      add({
        key: "marcador:example-squad-sdk",
        tipo: "feature",
        prioridade: "baixa",
        titulo: "Implementar a invocação direta do example-squad via SDK (hoje validated_stub_v2)",
        descricao: [
          `O registro de engines do orquestrador-global declara que a chamada direta ao example-squad pelo SDK "remains a planned follow-up" (${linkMd(rel, hits[0].line)}); a engine está em \`validated_stub_v2\` e o \`squad_ref\` é comentado como "planned/absent in this branch"${squadRef.length ? ` (${linkMd(rel, squadRef[0].line)})` : ""}.`,
          "",
          "## Evidência",
          ...[...hits, ...squadRef].map((h) => `- ${linkMd(h.rel, h.line)} — \`${h.text.slice(0, 110)}\``),
        ].join("\n"),
        tags: ["populate", "marcador", "orquestrador-global", "planejado"],
        evidencias: [...hits, ...squadRef],
        passos: ["Decidir se o example-squad entra nesta distribuição", "Implementar a invocação via SDK ou formalizar o stub como definitivo"],
        nota: `Follow-up planejado em ${rel}:${hits[0].line}.`,
      });
    }
    const relA = "squads/orquestrador-global/data/execution-adapter-registry.yaml";
    const docA = c.porRel.get(relA);
    if (docA) {
      let adaptadores = [];
      try { adaptadores = yamlLoad(docA.text)?.adapters ?? []; } catch { adaptadores = []; }
      for (const a of adaptadores) {
        if (!a?.id || !((a.status === "backlog") || (a.constraints ?? []).includes("not_implemented"))) continue;
        const ls = c.linhasDe(relA);
        const iniId = ls.findIndex((l) => l.includes(`id: "${a.id}"`) || l.includes(`id: ${a.id}`));
        const linhaStatus = ls.findIndex((l, i) => i > iniId && /status:\s*"?backlog"?/.test(l));
        const linhaConstraint = ls.findIndex((l, i) => i > iniId && /"not_implemented"/.test(l));
        const ev = [
          { rel: relA, line: linhaStatus >= 0 ? linhaStatus + 1 : iniId + 1 },
          ...(linhaConstraint >= 0 ? [{ rel: relA, line: linhaConstraint + 1 }] : []),
        ];
        add({
          key: `marcador:adapter:${a.id}`,
          tipo: "feature",
          prioridade: "baixa",
          titulo: `Adapter "${a.id}" do orquestrador-global está em backlog e marcado not_implemented`,
          descricao: [
            `No registro de adapters de execução, \`${a.id}\` (tipo \`${a.type}\`) está com \`status: ${a.status}\` e restrições ${(a.constraints ?? []).map((x) => `\`${x}\``).join(", ")} (${ev.map((x) => linkMd(x.rel, x.line)).join(", ")}). Risco declarado: ${a.risk_level ?? "n/d"}.`,
            "",
            "Antes de implementar, o próprio registro exige revisão de segurança e um adapter de contrato.",
            "",
            "## Evidência",
            ...ev.map((x) => `- ${linkMd(x.rel, x.line)}`),
          ].join("\n"),
          tags: ["populate", "marcador", "orquestrador-global", "adapter"],
          evidencias: ev,
          passos: ["Fazer a revisão de segurança exigida pelas constraints", "Escrever o adapter de contrato e os schemas de entrada/saída", "Trocar status de backlog e remover not_implemented"],
          nota: `Adapter ${a.id} em backlog no registro.`,
        });
      }
    }
  }

  // 2.7 comentário desatualizado em orchestrate.py (cmds "marker stub" já implementados)
  {
    const rel = "engine/intelligence/pipeline/mce/orchestrate.py";
    const marcadores = c.acha(rel, /marker stub|marker implementations|a G13 follow-up\.|G12 TODO/);
    const doc = c.porRel.get(rel);
    if (marcadores.length && doc) {
      const ini = doc.text.indexOf("_TRIGGER_CMD_MAP: dict");
      const bloco = ini >= 0 ? doc.text.slice(ini, doc.text.indexOf("}", ini)) : "";
      const mapa = [...bloco.matchAll(/"([a-z_0-9]+)"\s*:\s*"([a-z_0-9]+)"/g)].map((m) => [m[1], m[2]]);
      const definidos = new Set([...doc.text.matchAll(/^def (cmd_[a-z_0-9]+)/gm)].map((m) => m[1]));
      const ausentes = mapa.filter(([, cmd]) => !definidos.has(cmd));
      if (mapa.length && ausentes.length === 0) {
        const stubs = ["cmd_entities", "cmd_behavioral", "cmd_identity", "cmd_voice"];
        const defs = stubs.map((s) => ({ nome: s, hit: c.acha(rel, new RegExp(`^def ${s}\\(`))[0] })).filter((x) => x.hit);
        add({
          key: "marcador:orchestrate-comentario-stub",
          tipo: "melhoria",
          prioridade: "baixa",
          titulo: "Atualizar os comentários do orchestrate.py que ainda chamam de stub funções já implementadas",
          descricao: [
            `Comentários em ${marcadores.map((m) => linkMd(m.rel, m.line)).join(", ")} descrevem \`cmd_entities\`, \`cmd_behavioral\`, \`cmd_identity\` e \`cmd_voice\` como "marker stub" / "marker implementations" com extração completa num "G13 follow-up", e o ramo \`G12 TODO\` loga que o comando "is not implemented yet".`,
            "",
            `Conferido no código: **as ${mapa.length} funções do \`_TRIGGER_CMD_MAP\` estão definidas** (${defs.map((d) => `${d.nome} em ${linkMd(rel, d.hit.line)}`).join("; ")}), com docstrings que descrevem extração real (heurística determinística + LLM). Enquanto essas funções existirem, o ramo \`G12 TODO\` não é alcançado e o texto induz a erro.`,
            "",
            "## Evidência",
            ...marcadores.map((m) => `- ${linkMd(m.rel, m.line)} — \`${m.text.slice(0, 100)}\``),
          ].join("\n"),
          tags: ["populate", "marcador", "pipeline-mce", "documentacao"],
          evidencias: [...marcadores.slice(0, 4), ...defs.map((d) => d.hit)],
          passos: ["Reescrever os comentários para o estado real (extração implementada)", "Remover ou rebaixar o ramo G12 TODO, já que todos os comandos existem"],
          nota: `Comentário stale em ${rel}:${marcadores[0].line}.`,
        });
      } else if (ausentes.length) {
        add({
          key: "marcador:orchestrate-cmds-ausentes",
          tipo: "feature",
          prioridade: "media",
          titulo: `Implementar ${ausentes.length} comando(s) do _TRIGGER_CMD_MAP ainda sem função (${ausentes.map((a) => a[1]).join(", ")})`,
          descricao: [
            `O mapa de triggers do FSM aponta para funções que não estão definidas em \`${rel}\`: ${ausentes.map((a) => `\`${a[1]}\` (trigger \`${a[0]}\`)`).join(", ")}. O ramo \`G12 TODO\` só loga e segue.`,
            "",
            "## Evidência",
            ...marcadores.map((m) => `- ${linkMd(m.rel, m.line)} — \`${m.text.slice(0, 100)}\``),
          ].join("\n"),
          tags: ["populate", "marcador", "pipeline-mce", "g12"],
          evidencias: marcadores.slice(0, 4),
          passos: ["Implementar as funções ausentes", "Cobrir o ramo com teste de FSM"],
          nota: `Funções do _TRIGGER_CMD_MAP ausentes em ${rel}.`,
        });
      }
    }
  }

  // 2.8 agentes placeholder no ecosystem-registry
  {
    const rel = "agents/_registry/ecosystem-registry.yaml";
    const doc = c.porRel.get(rel);
    if (doc) {
      let dados = null;
      try { dados = yamlLoad(doc.text); } catch { dados = null; }
      const ls = c.linhasDe(rel);
      for (const a of (dados?.agents ?? []).filter((x) => x?.status === "placeholder").sort((x, y) => ordena(x.id, y.id))) {
        const iniId = ls.findIndex((l) => new RegExp(`^\\s*-\\s*id:\\s*${a.id}\\s*$`).test(l));
        const linhaStatus = ls.findIndex((l, i) => i > iniId && /status:\s*placeholder/.test(l));
        const linhaPath = ls.findIndex((l, i) => i > iniId && /path:/.test(l));
        const existeArquivo = a.path ? c.existe(a.path) : false;
        if (a.path) c.cobertos.add(a.path);
        add({
          key: `marcador:agente-placeholder:${a.id}`,
          tipo: "feature",
          prioridade: "media",
          titulo: `Implementar o agente placeholder "${a.id}" (categoria ${a.category})`,
          descricao: [
            `O registro de agentes lista \`${a.id}\` com \`status: placeholder\` (${linkMd(rel, linhaStatus + 1)}) e \`capabilities: ${JSON.stringify(a.capabilities ?? [])}\`.`,
            a.path
              ? `\nO caminho declarado, \`${a.path}\` (${linkMd(rel, linhaPath + 1)}), ${existeArquivo ? "existe no disco" : "**não existe** no disco (verificado)"}.`
              : null,
            "",
            "Um agente `placeholder` só reserva o lugar no registro: não é um agente ativável até ter a definição e as capacidades reais.",
            "",
            "## Evidência",
            `- ${linkMd(rel, linhaStatus + 1)}`,
          ].filter(presente).join("\n"),
          tags: ["populate", "marcador", "agentes", "placeholder"],
          evidencias: [{ rel, line: linhaStatus + 1 }],
          passos: ["Escrever agent.md com comandos, escopo e autoridade", "Registrar capabilities reais e trocar status para active", "Validar a ativação do agente"],
          nota: `Agente placeholder no registro (${rel}:${linhaStatus + 1}).`,
        });
      }
    }
  }

  // 2.9 templates operacionais ainda placeholder
  {
    const tpl = c.docs.filter((d) => /^workspace\/_templates\/.+\.ya?ml$/.test(d.rel) && /^status:\s*placeholder\s*$/m.test(d.text)).sort((a, b) => ordena(a.rel, b.rel));
    if (tpl.length) {
      const hits = tpl.map((d) => c.acha(d.rel, /^status:\s*placeholder\s*$/)[0]);
      add({
        key: "marcador:templates-placeholder",
        tipo: "feature",
        prioridade: "baixa",
        titulo: `Preencher ${tpl.length} template(s) do workspace que ainda são placeholder`,
        descricao: [
          `Os templates abaixo estão com \`status: placeholder\`, \`fields: {}\` e o cabeçalho "Este template deve ser preenchido com o schema canônico":`,
          "",
          ...hits.map((h, i) => `- ${linkMd(h.rel, h.line)} (\`template_id: ${tpl[i].text.match(/^template_id:\s*"?([^"\n]+)"?/m)?.[1] ?? "?"}\`)`),
          "",
          "Sem o schema, nenhuma saída padronizada desses templates pode ser gerada.",
        ].join("\n"),
        tags: ["populate", "marcador", "workspace", "template", "placeholder"],
        evidencias: hits,
        passos: ["Definir o schema canônico de cada template", "Trocar status para ativo e validar com um exemplo"],
        nota: `${tpl.length} templates placeholder em workspace/_templates.`,
      });
    }
  }

  // 2.10 fila de extração MCE (Wave 2) com status pending
  {
    const rel = "bin/mce-entity-manifest.yaml";
    const doc = c.porRel.get(rel);
    if (doc) {
      let dados = null;
      try { dados = yamlLoad(doc.text); } catch { dados = null; }
      const itens = [];
      for (const t of dados?.tiers ?? []) {
        for (const e of t.entities ?? []) if (e.status === "pending") itens.push({ tier: t.tier, ...e });
      }
      if (itens.length) {
        const hits = c.acha(rel, /^\s+status:\s*pending\s*$/);
        const buckets = [...new Set(itens.map((i) => i.bucket))];
        const prioMin = Math.min(...itens.map((i) => i.priority ?? 9));
        const contaSlug = new Map();
        for (const i of itens) contaSlug.set(i.slug, (contaSlug.get(i.slug) ?? 0) + 1);
        const repetidos = [...contaSlug.entries()].filter(([, n]) => n > 1).map(([k]) => k).sort();
        const vazios = ["external", "business", "personal"].every((b) => !arquivosReais(c.repoRoot, `knowledge/${b}`).length);
        add({
          key: "marcador:fila-mce-wave2",
          tipo: "ingest",
          prioridade: prioMin <= 1 ? "media" : "baixa",
          titulo: `Fila de extração MCE (Wave 2): ${itens.length} entidades com status pending`,
          descricao: [
            `O manifesto \`${rel}\` (fila usada por \`bin/mce-wave-launcher.sh\`) lista **${itens.length} entidades com \`status: pending\`**:`,
            "",
            "| entidade | tier | prioridade | fontes | dossiê | DNA |",
            "|---|---|---|---|---|---|",
            ...itens.map((i) => `| ${i.slug} | ${i.tier} | ${i.priority ?? "?"} | ${i.sources_count ?? "?"} | ${i.has_dossier ? "sim" : "não"} | ${i.has_dna ? "sim" : "não"} |`),
            "",
            vazios
              ? "**Atenção:** as contagens de fontes vêm do manifesto, não do disco. Nesta instalação `knowledge/external|business|personal` têm só `.gitkeep`, então a fila não pode rodar até o material ser ingerido (ver o card de buckets vazios)."
              : "As contagens de fontes vêm do manifesto, não do disco.",
            repetidos.length ? `O manifesto repete o slug ${repetidos.map((r) => `\`${r}\``).join(", ")} (conferir antes de rodar).` : null,
            "",
            "## Evidência",
            `- ${linkMd(rel, hits[0]?.line)} (primeiro \`status: pending\`; ${hits.length} ocorrências)`,
          ].filter(presente).join("\n"),
          tags: ["populate", "marcador", "pipeline-mce", "fila"],
          evidencias: hits.slice(0, 1).length ? hits.slice(0, 1) : [{ rel }],
          fonteTipo: ["outro"],
          bucket: buckets.length === 1 && ["external", "business", "personal"].includes(buckets[0]) ? buckets[0] : null,
          passos: ["Ingerir as fontes de cada entidade da fila (ou remover a entidade do manifesto)", "Rodar bin/mce-wave-launcher.sh --wave 2 e conferir o status no manifesto"],
          nota: `${itens.length} entidades pending em ${rel}.`,
        });
      }
    }
  }
  return out;
}

/** Arquivos de verdade (exclui .gitkeep) sob `dir`, relativos ao repositório. */
function arquivosReais(repoRoot, dir) {
  const abs = path.join(repoRoot, dir);
  const out = [];
  const andar = (d, relDir) => {
    let entradas = [];
    try { entradas = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      if (e.isSymbolicLink() || caminhoExcluido(path.join(d, e.name))) continue; // excluído pela configuração: não conta
      if (e.isDirectory()) andar(path.join(d, e.name), `${relDir}/${e.name}`);
      else if (e.name !== ".gitkeep") out.push(`${relDir}/${e.name}`);
    }
  };
  if (existsSync(abs)) andar(abs, dir);
  return out.sort();
}

/* ================================================================== FONTE 3 — referências quebradas */

const TOPOS = "engine|agents|squads|workspace|docs|knowledge|bin|scripts|infrastructure|tests|mega-brain-core|services|minds|\\.claude|\\.github";
const RE_CITADO = new RegExp(`["'\`]((?:${TOPOS})/[A-Za-z0-9_\\-./]*[A-Za-z0-9_\\-])["'\`]`, "g");
const RE_NU = new RegExp(`(?<![\\w./\\-$}>"'\`])((?:${TOPOS})/[A-Za-z0-9_\\-./]*[A-Za-z0-9_\\-])`, "g");
const RE_NU_DOC = new RegExp(String.raw`(?<![\w./\-$}>])((?:${TOPOS})/[A-Za-z0-9_\-./]*[A-Za-z0-9_\-])`, "g");
const RE_IMPORT = /^\s*(?:from|import)\s+(engine(?:\.[A-Za-z_]\w*)+)/;
const RE_IMPORT_EMBUTIDO = /\bfrom\s+(engine(?:\.[A-Za-z_]\w*)+)\s+import\b/;
/** Caminhos de runtime/gerados/locais: ausentes por desenho, não são referência quebrada. */
const RE_RUNTIME = /^(outputs|\.data|logs|artifacts|processing|inbox)\b|^\.claude\/(sessions|mission-control|jarvis|logs|learning-system|agent-memory|mega-brain|temp|trash)\b|^knowledge\/(external|business|personal)\b|^workspace\/(businesses|inbox)\b|^agents\/(external|business|personal|persons|cargo)\b|\.gitkeep$|settings\.local\.json$|credentials-map|-state\.(ya?ml|json)$/;
const RE_PLACEHOLDER = /[<>{}*$[\]]|XXX|YYYY|NNN|\bNN\b|\.\.\./;
const RE_CRIACAO = /mkdir|makedirs|ensure_?[dD]irs?|create_?[dD]irs?|scaffold|\bdirs\s*=\s*\[|DIRS_TO_CREATE|not in str\(|\.rglob|default=|--output|out_dir|OUT_DIR/;
const RE_LEITURA = /open\(|read_text|read_bytes|json\.load|yaml\.safe_load|readFileSync|existsSync|is_file\(|is_dir\(|\.exists\(\)|require\(|import\(|load_yaml|loadStructuredFile|Path\(/;
const EXT_ARQUIVO = /\.(py|js|mjs|cjs|ts|sh|ya?ml|json|md|csv|txt)$/;

function ehTeste(rel) {
  return /_archived|\/_archive\/|(^|\/)tests?\//.test(rel);
}

/** Raízes de sub-projetos (apps/<nome>): caminhos citados relativos a elas não são quebrados. */
function raizesDeApps(c) {
  if (!c.raizesApps) {
    let nomes = [];
    try { nomes = readdirSync(path.join(c.repoRoot, "apps"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `apps/${e.name}`).sort(); } catch { nomes = []; }
    c.raizesApps = nomes;
  }
  return c.raizesApps;
}

function resolveAncestrais(c, rel, alvo) {
  if (c.existe(alvo)) return true;
  if (raizesDeApps(c).some((r) => c.existe(`${r}/${alvo}`))) return true;
  let dir = posix.dirname(rel);
  while (dir && dir !== ".") {
    if (c.existe(`${dir}/${alvo}`)) return true;
    dir = posix.dirname(dir);
  }
  return false;
}

function modulosPythonAusentes(c, mod) {
  const base = mod.split(".").join("/");
  return !(c.existe(`${base}.py`) || c.existe(`${base}/__init__.py`) || c.existe(base));
}

/** Mapa alvo → citações (código/config/regra de governança, não arquivadas). */
function detectarReferencias(c) {
  const alvos = new Map();
  const registra = (alvo, d, line, via, forca) => {
    if (!alvos.has(alvo)) alvos.set(alvo, []);
    alvos.get(alvo).push({ rel: d.rel, line, kind: d.kind, via, forca });
  };
  const governanca = (rel) => rel === ".claude/CLAUDE.md" || rel === "CLAUDE.md" || /^\.claude\/rules\/[^/]+\.md$/.test(rel);

  for (const d of c.docs) {
    if (ehTeste(d.rel)) continue;
    const ehGov = d.kind === "doc" && governanca(d.rel);
    if (d.kind === "doc" && !ehGov) continue;
    const ls = c.linhasDe(d.rel);
    ls.forEach((l, i) => {
      // imports Python (também embutidos em snippets de scripts JS/shell)
      if (d.kind === "code") {
        const m = (d.ext === ".py" ? l.match(RE_IMPORT) : null) ?? l.match(RE_IMPORT_EMBUTIDO);
        if (m && modulosPythonAusentes(c, m[1])) registra(`${m[1].split(".").join("/")}.py`, d, i + 1, "import", 2);
      }
      if (d.kind === "config" && /^\s*#/.test(l)) return;
      const contexto = ls.slice(Math.max(0, i - 8), i + 1).join("\n");
      if (d.kind === "code" && RE_CRIACAO.test(contexto)) return;
      const critico = d.kind === "code" && /(CRITICAL|REQUIRED)_\w+\s*=\s*\[/.test(ls.slice(Math.max(0, i - 15), i + 1).join("\n"));
      const re = d.kind === "doc" ? RE_NU_DOC : new RegExp(`${RE_CITADO.source}|${RE_NU.source}`, "g");
      for (const m of l.matchAll(re)) {
        const bruto = m[1] ?? m[2];
        if (!bruto) continue;
        const alvo = bruto.replace(/[.,:;]+$/, "");
        if (RE_PLACEHOLDER.test(alvo) || RE_RUNTIME.test(alvo)) continue;
        const depois = l[m.index + m[0].length];
        if (depois && /[<{*[$]/.test(depois)) continue;
        const temExt = EXT_ARQUIVO.test(alvo);
        if (!temExt && !critico) continue; // diretórios só em listas CRITICAL_*/REQUIRED_*
        if (resolveAncestrais(c, d.rel, alvo)) continue;
        let forca;
        if (ehGov) forca = 2;
        else if (critico) forca = 3;
        else if (d.kind === "config") forca = 2;
        else forca = m[1] && RE_LEITURA.test(l) ? 2 : 1;
        registra(alvo, d, i + 1, ehGov ? "governanca" : d.kind === "config" ? "config" : "codigo", forca);
      }
    });
  }
  return alvos;
}

function resumoCitacoes(cits, max = 10) {
  const ord = [...cits].sort((a, b) => ordena(a.rel, b.rel) || a.line - b.line);
  const linhas = ord.slice(0, max).map((x) => `- ${linkMd(x.rel, x.line)} — ${{ import: "import", governanca: "regra/índice de governança", config: "config", codigo: "código" }[x.via]}`);
  if (ord.length > max) linhas.push(`- … e mais ${ord.length - max} ocorrência(s)`);
  return linhas;
}

function fontesReferencias(c) {
  const alvos = detectarReferencias(c);
  // confirmação final no disco (nada vai para o board sem passar aqui)
  const confirmados = new Map();
  for (const [alvo, cits] of alvos) {
    if (cits.length && !c.existe(alvo) && !c.cobertos.has(alvo)) confirmados.set(alvo, cits);
  }
  const info = (alvo) => {
    const cits = confirmados.get(alvo);
    const arquivos = new Map();
    for (const x of cits) arquivos.set(x.rel, Math.max(arquivos.get(x.rel) ?? 0, x.forca));
    const score = [...arquivos.values()].reduce((a, b) => a + b, 0);
    const critico = cits.some((x) => x.forca === 3 && x.via !== "import");
    return { alvo, cits, arquivos, score, critico, imports: cits.filter((x) => x.via === "import").length };
  };
  const todos = [...confirmados.keys()].sort().map(info);
  const usados = new Set();
  const out = [];
  const topoAusente = (a) => !c.existe(a.alvo.split("/")[0]);

  const listar = (itens, max = 40) => {
    const ord = [...itens].sort((a, b) => b.arquivos.size - a.arquivos.size || ordena(a.alvo, b.alvo));
    const linhas = ord.slice(0, max).map((i) => {
      const p = [...i.cits].sort((x, y) => ordena(x.rel, y.rel) || x.line - y.line)[0];
      return `- \`${i.alvo}\` — ${i.arquivos.size} arquivo(s); ex.: ${linkMd(p.rel, p.line)}`;
    });
    if (ord.length > max) linhas.push(`- … e mais ${ord.length - max} alvo(s)`);
    return linhas;
  };
  const evidenciaDe = (itens, max = 6) => {
    const vistos = new Set();
    const ev = [];
    for (const i of itens) for (const x of [...i.cits].sort((p, q) => ordena(p.rel, q.rel) || p.line - q.line)) {
      if (!vistos.has(x.rel)) { vistos.add(x.rel); ev.push({ rel: x.rel, line: x.line }); }
      if (ev.length >= max) return ev;
    }
    return ev;
  };

  // (a) registros: arquivo de config que cita >= 8 alvos ausentes
  const porCitante = new Map();
  for (const i of todos) for (const x of i.cits) {
    if (x.kind !== "config" || topoAusente(i)) continue;
    if (!porCitante.has(x.rel)) porCitante.set(x.rel, new Set());
    porCitante.get(x.rel).add(i.alvo);
  }
  for (const [rel, set] of [...porCitante.entries()].sort((a, b) => ordena(a[0], b[0]))) {
    if (set.size < 8) continue;
    const itens = [...set].sort().map((a) => todos.find((t) => t.alvo === a));
    itens.forEach((i) => usados.add(i.alvo));
    const exemplos = itens.slice(0, 12).map((i) => `- \`${i.alvo}\` (${linkMd(rel, i.cits.find((x) => x.rel === rel).line)})`);
    out.push(spec({
      key: `ref:registro:${rel}`,
      tipo: "infra",
      prioridade: "media",
      titulo: `Registro ${posix.basename(rel)} aponta ${itens.length} arquivos que não existem`,
      descricao: [
        `\`${rel}\` referencia **${itens.length} arquivos inexistentes** (verificado um a um no disco). O registro descreve itens que esta distribuição não traz, então qualquer consumidor que o percorra encontra caminhos quebrados.`,
        "",
        "## Primeiros itens ausentes",
        ...exemplos,
        itens.length > 12 ? `- … e mais ${itens.length - 12}` : null,
        "",
        "## Evidência",
        `- ${linkMd(rel, 1)}`,
      ].filter(presente).join("\n"),
      tags: ["populate", "referencia-quebrada", "registro"],
      evidencias: [{ rel, line: itens[0].cits.find((x) => x.rel === rel).line }],
      passos: ["Decidir: podar o registro para o que a distribuição traz, ou restaurar os arquivos", "Rodar o validador do registro, se existir"],
      nota: `${itens.length} alvos ausentes citados por ${rel}.`,
    }));
  }

  // (b) pastas de topo inteiras ausentes
  const topos = new Map();
  for (const i of todos) {
    if (usados.has(i.alvo) || !topoAusente(i)) continue;
    const t = i.alvo.split("/")[0];
    if (!topos.has(t)) topos.set(t, []);
    topos.get(t).push(i);
  }
  // alvos de governança com score alto ganham card próprio mesmo dentro de pasta ausente
  const proprios = new Set(todos.filter((i) => (i.score >= 3 || i.critico) && !usados.has(i.alvo)).map((i) => i.alvo));
  const auxiliares = [];
  for (const [t, itens] of [...topos.entries()].sort((a, b) => ordena(a[0], b[0]))) {
    const restantes = itens.filter((i) => !proprios.has(i.alvo));
    if (t === "mega-brain-core" || t === "services") {
      restantes.forEach((i) => usados.add(i.alvo));
      const individuais = itens.filter((i) => proprios.has(i.alvo));
      out.push(spec({
        key: `ref:diretorio:${t}`,
        tipo: "infra",
        prioridade: t === "mega-brain-core" ? "alta" : "media",
        titulo: `Pasta "${t}/" é citada em ${itens.length} caminhos, mas não existe no repositório`,
        descricao: [
          `A pasta \`${t}/\` **não existe** na raiz do repositório, e ${itens.length} caminhos dentro dela são citados por código, configuração ou regras de governança.`,
          t === "mega-brain-core" && c.acha(".claude/CLAUDE.md", /mega-brain-core\/constitution\.md/).length
            ? `\nO índice de governança (\`.claude/CLAUDE.md\`) trata \`mega-brain-core/constitution.md\` como a Constituição (lei suprema)${c.existe(".claude/hooks/constitution_gate.py") ? " e há um hook (`constitution_gate.py`) que a protege" : ""} — sem a pasta, nada disso tem alvo.`
            : null,
          individuais.length ? `\nTêm card próprio: ${individuais.map((i) => `\`${i.alvo}\``).join(", ")}.` : null,
          "",
          "## Alvos ausentes",
          ...listar(restantes.length ? restantes : itens),
        ].filter(presente).join("\n"),
        tags: ["populate", "referencia-quebrada", "diretorio-ausente", t],
        evidencias: evidenciaDe(itens),
        passos: ["Restaurar a pasta a partir da origem da distribuição, ou corrigir as referências", "Reexecutar o health check de inicialização"],
        nota: `Pasta ${t}/ ausente; ${itens.length} alvos citados.`,
      }));
    } else {
      auxiliares.push(...restantes);
      restantes.forEach((i) => usados.add(i.alvo));
    }
  }
  if (auxiliares.length) {
    const nomes = [...new Set(auxiliares.map((i) => i.alvo.split("/")[0]))].sort();
    out.push(spec({
      key: "ref:diretorio:auxiliares",
      tipo: "infra",
      prioridade: "baixa",
      titulo: `Pastas ${nomes.map((n) => `"${n}/"`).join(", ")} são citadas por código mas não existem`,
      descricao: [
        `As pastas ${nomes.map((n) => `\`${n}/\``).join(", ")} não existem na raiz do repositório e ${auxiliares.length} caminhos dentro delas são citados por código ou configuração (testes, scripts de apoio e metadados).`,
        "",
        "## Alvos ausentes",
        ...listar(auxiliares),
      ].join("\n"),
      tags: ["populate", "referencia-quebrada", "diretorio-ausente"],
      evidencias: evidenciaDe(auxiliares),
      passos: ["Para cada alvo: restaurar, remover a referência ou documentar que é opcional"],
      nota: `Pastas auxiliares ausentes (${nomes.join(", ")}).`,
    }));
  }

  // (c) cards individuais: score >= 3 ou item crítico de verificação
  const importsComCard = [];
  for (const i of todos) {
    if (usados.has(i.alvo)) continue;
    if (!(i.score >= 3 || i.critico)) continue;
    usados.add(i.alvo);
    const ehImport = i.imports > 0;
    if (ehImport) importsComCard.push(i.alvo);
    const startup = i.cits.filter((x) => /startup_health|health_scorer|doctor/.test(x.rel) && x.forca === 3);
    const prioridade = i.arquivos.size >= 10 ? "alta" : "media";
    const quem = resumoCitacoes(i.cits, 10);
    out.push(spec({
      key: `ref:alvo:${i.alvo}`,
      tipo: ehImport || startup.length ? "bug" : "infra",
      prioridade,
      titulo: `${ehImport ? "Módulo/arquivo ausente" : "Referência quebrada"}: ${i.alvo} (citado por ${i.arquivos.size} arquivo${i.arquivos.size > 1 ? "s" : ""})`,
      descricao: [
        `\`${i.alvo}\` **não existe** no disco (verificado), mas é citado por ${i.arquivos.size} arquivo(s) em ${i.cits.length} ocorrência(s).`,
        ehImport ? `\n${i.imports} ocorrência(s) são \`import\` Python: quem executa esse caminho sem tratamento de exceção falha com \`ImportError\`/\`ModuleNotFoundError\`.` : null,
        startup.length ? `\nO health check de inicialização trata este caminho como **crítico** (${startup.map((x) => linkMd(x.rel, x.line)).join(", ")}), então o diagnóstico de sessão já nasce acusando a falta.` : null,
        "",
        "## Quem cita",
        ...quem,
      ].filter(presente).join("\n"),
      tags: ["populate", "referencia-quebrada", ...(ehImport ? ["import"] : [])],
      evidencias: evidenciaDe([i]),
      passos: ["Restaurar o arquivo a partir da origem da distribuição, ou ajustar os citantes", "Reexecutar os testes/hook que o citam"],
      nota: `Alvo ausente confirmado no disco; ${i.cits.length} citações.`,
    }));
  }

  // (d) módulos Python importados que não existem (um import ausente quebra quem o executa)
  const imports = todos.filter((i) => !usados.has(i.alvo) && i.imports > 0);
  if (imports.length) {
    imports.forEach((i) => usados.add(i.alvo));
    out.push(spec({
      key: "ref:imports-ausentes",
      tipo: "bug",
      prioridade: "media",
      titulo: `${imports.length} módulos Python são importados mas não existem no repositório`,
      descricao: [
        `${imports.length} módulos \`engine.*\` são importados por código ativo (hooks, pipeline, RAG) e **não existem** no disco (verificado: nem \`<módulo>.py\` nem \`<módulo>/__init__.py\`). Onde o import não está protegido por \`try/except\`, a execução falha com \`ModuleNotFoundError\`.`,
        "",
        "## Módulos ausentes",
        ...listar(imports),
        // só os que ganharam card nesta execução (o texto fixo antigo citava módulos que podem já existir)
        importsComCard.length ? `\nOs módulos mais citados têm card próprio: ${importsComCard.map((a) => `\`${a}\``).join(", ")}.` : null,
      ].filter(presente).join("\n"),
      tags: ["populate", "referencia-quebrada", "import", "python"],
      evidencias: evidenciaDe(imports),
      passos: ["Para cada módulo: restaurar, trocar o import ou proteger com fallback", "Rodar os hooks/testes que dependem do módulo"],
      nota: `${imports.length} imports de módulos ausentes.`,
    }));
  }

  // (e) o restante, agrupado por área (triagem)
  const areas = new Map();
  for (const i of todos) {
    if (usados.has(i.alvo)) continue;
    const area = i.alvo.split("/")[0];
    if (!areas.has(area)) areas.set(area, []);
    areas.get(area).push(i);
  }
  const rotuloArea = { engine: "engine/", agents: "agents/", squads: "squads/", scripts: "scripts/", docs: "docs/", knowledge: "knowledge/", workspace: "workspace/", bin: "bin/", ".claude": ".claude/", ".github": ".github/" };
  for (const [area, itens] of [...areas.entries()].sort((a, b) => ordena(a[0], b[0]))) {
    out.push(spec({
      key: `ref:area:${area}`,
      tipo: "infra",
      prioridade: "baixa",
      titulo: `Triagem: ${itens.length} caminho(s) de ${rotuloArea[area] ?? `${area}/`} citados por código/config/regras e ausentes no disco`,
      descricao: [
        `${itens.length} caminho(s) sob \`${rotuloArea[area] ?? `${area}/`}\` aparecem em código, configuração ou regras de governança e **não existem** no disco (cada um verificado). Cada alvo tem poucas citações; decida caso a caso se é arquivo a restaurar, referência a corrigir ou item opcional da distribuição completa.`,
        "",
        "## Alvos",
        ...listar(itens),
      ].join("\n"),
      tags: ["populate", "referencia-quebrada", "triagem", area.replace(/^\./, "")],
      evidencias: evidenciaDe(itens),
      passos: ["Classificar cada alvo: restaurar, corrigir a citação ou marcar como opcional", "Registrar a decisão onde o caminho é citado"],
      nota: `Triagem de ${itens.length} alvos ausentes em ${area}/.`,
    }));
  }
  return out;
}

/* ================================================================== FONTE 4 — backlog de integração do Knowledge */

/** Linhas de um arquivo do app (vazio se não existir). */
function linhasDoApp(c, rel) {
  const abs = path.join(c.appRoot, ...rel.split("/"));
  return existsSync(abs) ? readFileSync(abs, "utf8").split("\n") : [];
}

function fontesIntegracao(c) {
  const out = [];
  // caminho do app dentro do repositório (as evidências são relativas ao repositório)
  const relApp = toPosix(path.relative(c.repoRoot, c.appRoot));
  const appRel = relApp && !relApp.startsWith("..") && !path.isAbsolute(relApp) ? relApp : "apps/knowledge";
  const appAbs = c.appRoot;

  // (a) busca semântica não ligada
  {
    // Onde o app documenta os embeddings: a seção "## Embeddings" do README (template antigo) ou de
    // docs/provider-supabase.md (outlierhub). Só vale a seção que fala mesmo do bge-m3; cada trecho
    // da descrição só entra se a seção o afirmar.
    const emb = ["README.md", "docs/provider-supabase.md"].map((rel) => {
      const ls = linhasDoApp(c, rel);
      const ini = ls.findIndex((l) => /^##\s+Embeddings/.test(l));
      const trecho = ini >= 0 ? ls.slice(ini, secao(ls, ini, 2).fim).join("\n") : "";
      return {
        rel: `${appRel}/${rel}`, line: ini + 1, bge: /bge-m3/.test(trecho), dim: /1024 dimens/.test(trecho),
        vars: /BILHON_OLLAMA_URL/.test(trecho) && /BILHON_EMBED_MODEL/.test(trecho), mesmoModelo: /mesmo modelo/i.test(trecho),
        supabase: /provider-supabase/.test(rel), dedicado: /projeto dedicado/i.test(ls.join("\n")),
      };
    }).find((d) => d.line > 0 && d.bge) ?? null;
    // limite declarado do provider local (docs/provider-local.md, seção Limites)
    const relLocal = "docs/provider-local.md";
    const iLexical = linhasDoApp(c, relLocal).findIndex((l) => /lexical, sem embeddings/i.test(l));
    const busca = path.join(appAbs, "scripts", "populate", "busca.mjs");
    const textoBusca = existsSync(busca) ? readFileSync(busca, "utf8") : "";
    const lexical = /fts5/i.test(textoBusca);
    out.push(spec({
      key: "integracao:busca-semantica",
      tipo: "feature",
      prioridade: "media",
      titulo: "Ligar a busca semântica por embeddings (Ollama + bge-m3) à busca do Knowledge",
      descricao: [
        lexical
          ? "A busca populada nesta instalação é **lexical (SQLite FTS5 local)** — ver `scripts/populate/busca.mjs`. Ela acha termos, não significado."
          : "A busca semântica por embeddings depende do Ollama local com o modelo **bge-m3** (1024 dimensões); sem ele a busca real responde 503 (`ollama-offline`).",
        iLexical >= 0
          ? `\nO app registra o limite do provider \`local\`: lexical, sem embeddings; a busca semântica fica com o provider \`supabase\` (${linkMd(`${appRel}/${relLocal}`, iLexical + 1)}).`
          : null,
        "",
        emb
          ? `A documentação do app descreve o caminho dos embeddings (${linkMd(emb.rel, emb.line)}): a consulta vira vetor pelo Ollama com o modelo \`bge-m3\`${emb.dim ? " (1024 dimensões)" : ""}${emb.vars ? ", configurável por `BILHON_OLLAMA_URL` / `BILHON_EMBED_MODEL`" : ""}${emb.supabase ? `, no provider \`supabase\`${emb.dedicado ? " (projeto Supabase dedicado)" : ""}` : ""}.${emb.mesmoModelo ? " Ingestão e consulta precisam usar o mesmo modelo." : ""}`
          : "A documentação do app não descreve, nesta versão, onde configurar os embeddings.",
        "",
        "## Pendente",
        "- Ollama instalado e `bge-m3` baixado nesta máquina",
        "- Embeddings dos trechos do corpus gerados com o mesmo modelo",
        "- Variáveis no `.env.local` e conferência de uma consulta por significado",
      ].filter(presente).join("\n"),
      tags: ["populate", "integracao", "busca", "embeddings", "ollama"],
      evidencias: [
        ...(emb ? [{ rel: emb.rel, line: emb.line }] : []),
        ...(iLexical >= 0 ? [{ rel: `${appRel}/${relLocal}`, line: iLexical + 1 }] : []),
        ...(textoBusca ? [{ rel: `${appRel}/scripts/populate/busca.mjs` }] : []),
      ],
      passos: ["Instalar o Ollama e rodar `ollama pull bge-m3`", "Definir BILHON_OLLAMA_URL e BILHON_EMBED_MODEL no .env.local", "Gerar os embeddings do corpus e testar uma consulta semântica"],
      execucao: { modo: "misto", pctAgente: 50 },
      nota: "Backlog de integração do Knowledge (busca semântica).",
    }));
  }

  // (b) buckets de conhecimento vazios
  {
    const buckets = ["external", "business", "personal"];
    const contagens = Object.fromEntries(buckets.map((b) => [b, arquivosReais(c.repoRoot, `knowledge/${b}`).length]));
    if (buckets.every((b) => contagens[b] === 0)) {
      out.push(spec({
        key: "integracao:buckets-vazios",
        tipo: "ingest",
        prioridade: "media",
        titulo: "Ingerir material nos buckets knowledge/external, business e personal e repopular o Knowledge",
        descricao: [
          "Os três buckets de conhecimento do mega-brain estão **vazios** (só `.gitkeep`): `knowledge/external` 0 arquivos, `knowledge/business` 0, `knowledge/personal` 0 (contagem feita no disco).",
          "",
          "O Knowledge foi populado com a engine, os agentes, as regras e a documentação do repositório; o conhecimento dos especialistas só aparece depois da ingestão. O bucket `personal` fica fora do corpus por padrão (`--include-personal` para incluir).",
          "",
          "## Para repopular",
          "1. Ingerir o material com `/ingest` (pipeline MCE)",
          "2. Rodar `npm run populate` no app para reindexar estante, coleções, grafo e busca",
        ].join("\n"),
        tags: ["populate", "integracao", "buckets", "ingestao"],
        evidencias: [{ rel: "knowledge/external/sources/.gitkeep" }],
        fonteTipo: ["outro"],
        passos: ["Ingerir ao menos uma fonte por bucket que for usar", "Rodar `npm run populate` e conferir a estante e as coleções"],
        execucao: { modo: "misto", pctAgente: 50 },
        nota: "Buckets de conhecimento vazios no disco.",
      }));
    }
  }

  // (c) lock do app sem hash de integridade
  {
    const lockAbs = path.join(appAbs, "package-lock.json");
    const lock = existsSync(lockAbs) ? JSON.parse(readFileSync(lockAbs, "utf8")) : null;
    if (lock?.packages) {
      const entradas = Object.entries(lock.packages).filter(([k, v]) => k !== "" && !v.link);
      const sem = entradas.filter(([, v]) => !v.integrity);
      if (sem.length > 0) {
        out.push(spec({
          key: "integracao:lock-sem-hash",
          tipo: "melhoria",
          prioridade: "baixa",
          titulo: `Curar o package-lock.json do app: ${sem.length} de ${entradas.length} entradas sem hash de integridade`,
          descricao: [
            `\`${appRel}/package-lock.json\` tem **${sem.length} de ${entradas.length} pacotes sem \`integrity\`/\`resolved\`** (contagem feita sobre o arquivo). O npm não consegue verificar o hash dessas instalações.`,
            "",
            "Só importa para quem for **publicar o template**; para uso local o app roda normalmente.",
            "",
            "## Para curar",
            "- Regenerar o lock com rede e o registry oficial (`npm install --package-lock-only`)",
            "- Conferir que nenhuma entrada ficou sem `integrity`",
          ].join("\n"),
          tags: ["populate", "integracao", "npm", "supply-chain"],
          evidencias: [{ rel: `${appRel}/package-lock.json` }],
          passos: ["Regenerar o lock com rede e registry oficial", "Conferir que todas as entradas têm integrity"],
          nota: "Lock do app sem integrity em parte das entradas.",
        }));
      }
    }
  }
  return out;
}

/* ================================================================== construção e mesclagem de cards */

function dodDoTipo(tipos, tipo) {
  return tipos?.DOD_POR_TIPO?.[tipo] ?? [];
}

function construirCard(s, { id, ts, projeto, tipos, c, ordem }) {
  const evid = [];
  const vistos = new Set();
  for (const e of s.evidencias) { if (!vistos.has(e.rel)) { vistos.add(e.rel); evid.push(e); } }
  const links = [];
  for (const e of s.evidencias) {
    const l = githubLink(c, e);
    if (l && !links.some((x) => x.url === l.url)) links.push(l);
    if (links.length >= 2) break;
  }
  const dod = s.coluna === "done" ? [] : dodDoTipo(tipos, s.tipo);
  const checklist = [...s.passos, ...dod.filter((t) => !s.passos.includes(t))].map((texto) => ({ texto, feito: false }));
  return {
    id,
    titulo: s.titulo,
    descricao: s.descricao,
    tipo: s.tipo,
    prioridade: s.prioridade,
    projeto,
    coluna: s.coluna,
    ordem,
    responsavel: null,
    tags: [...s.tags],
    origem: { canal: CANAL, pedidoOriginal: `${PREFIXO_MAPA}${s.key}`, solicitadoPor: null },
    ingestao: {
      fonteTipo: [...s.fonteTipo],
      fonteUrl: [],
      fontePath: evid.slice(0, 12).map((e) => e.rel),
      bucket: s.bucket,
      pessoaAutor: null,
    },
    links,
    vinculos: s.vinculos ?? [],
    audios: [],
    imagens: [],
    checklist,
    historico: [{ de: null, para: s.coluna, em: ts, ...(s.nota ? { nota: s.nota } : {}) }],
    execucao: s.execucao,
    criadoEm: ts,
    atualizadoEm: ts,
    concluidoEm: s.coluna === "done" ? (s.concluidoEm ?? ts) : null,
  };
}

/** Campos descritivos que o populate gerencia (e cuja edição pelo usuário o protege). */
function camposGerenciados(card) {
  return {
    titulo: card.titulo,
    descricao: card.descricao,
    prioridade: card.prioridade,
    projeto: card.projeto,
    tags: card.tags,
    links: card.links,
    vinculos: (card.vinculos ?? []).map((v) => ({ tipo: v.tipo, id: v.id, titulo: v.titulo, linkLocal: v.linkLocal ?? null })),
    fonteTipo: card.ingestao?.fonteTipo ?? [],
    fontePath: card.ingestao?.fontePath ?? [],
    bucket: card.ingestao?.bucket ?? null,
    execucao: card.execucao ?? null,
  };
}

const sufixo = (id) => Number(String(id).split("-")[1]);

function proximoId(tipo, board, mapa, reservados) {
  const prefixo = PREFIXO_TIPO[tipo];
  let max = board.contadores[tipo] ?? 0;
  for (const cd of board.cards) if (cd.id?.startsWith(`${prefixo}-`)) max = Math.max(max, sufixo(cd.id) || 0);
  for (const e of Object.values(mapa.cards)) if (e.id?.startsWith(`${prefixo}-`)) max = Math.max(max, sufixo(e.id) || 0);
  for (const r of reservados) if (r.startsWith(`${prefixo}-`)) max = Math.max(max, sufixo(r) || 0);
  return `${prefixo}-${max + 1}`;
}

function boardVazio(ts) {
  return {
    atualizadoEm: ts,
    colunas: COLUNAS_PADRAO.map((x) => ({ ...x })),
    wipLimites: { doing: 1 },
    contadores: Object.fromEntries(TIPOS.map((t) => [t, 0])),
    cards: [],
  };
}

/**
 * Mescla `specs` (os fatos de hoje) no `board`, mutando `board` e `mapa`.
 *
 * "Card apagado pelo usuário" é decidido pelo MAPA de ids, nunca por haver (ou não) cards gerenciados
 * vivos: entrada no mapa, não retirada, sem card no board = o usuário o apagou, mesmo que tenha apagado
 * o último ou limpado o board inteiro. A única exceção é o board NOVO, que o chamador declara com
 * `boardNovo` (board.json não existia) ou que se mostra pelos contadores do próprio board: contadores
 * nunca regridem, então um id MAIOR que o contador do seu tipo jamais esteve neste board (board
 * recriado/zerado ou restaurado de uma cópia antiga) — esse card volta, com o mesmo id.
 * Para recriar de propósito o que foi apagado, basta remover `data/kanban/.populate-ids.json`.
 */
export function mesclar({ board, mapa, specs, ts, projeto, tipos, c, boardNovo = false }) {
  const stats = { criados: 0, atualizados: 0, removidos: 0, preservados: 0, apagadosPeloUsuario: 0, obsoletosMantidos: 0 };
  const avisos = [];
  let mudou = false;

  const gerenciados = board.cards.filter((cd) => cd.origem?.canal === CANAL && String(cd.origem?.pedidoOriginal ?? "").startsWith(PREFIXO_MAPA));
  const porChave = new Map(gerenciados.map((cd) => [cd.origem.pedidoOriginal.slice(PREFIXO_MAPA.length), cd]));
  // contadores NO INÍCIO da mescla (a criação os vai elevando)
  const contadoresIniciais = { ...board.contadores };
  const jaEsteveNoBoard = (entrada, tipo) => !boardNovo && (sufixo(entrada.id) || 0) <= (contadoresIniciais[entrada.tipo ?? tipo] ?? 0);
  const colunaIds = new Set(board.colunas.map((x) => x.id));
  const chavesAtuais = new Set(specs.map((s) => s.key));

  // ordem determinística de criação: prioridade, tipo, chave
  const ordenadas = [...specs].sort((a, b) =>
    PRIORIDADE_RANK[a.prioridade] - PRIORIDADE_RANK[b.prioridade]
    || TIPO_ORDEM.indexOf(a.tipo) - TIPO_ORDEM.indexOf(b.tipo)
    || ordena(a.key, b.key));
  const reservados = new Set();

  const proximaOrdem = (coluna) => Math.max(-1, ...board.cards.filter((x) => x.coluna === coluna).map((x) => x.ordem ?? 0)) + 1;

  for (const s of ordenadas) {
    if (!colunaIds.has(s.coluna)) {
      avisos.push(`coluna "${s.coluna}" não existe no board; card "${s.key}" não criado`);
      continue;
    }
    const existente = porChave.get(s.key);
    const entrada = mapa.cards[s.key];
    if (existente) {
      const alvo = construirCard(s, { id: existente.id, ts, projeto, tipos, c, ordem: existente.ordem });
      const hGerado = hashDe(camposGerenciados(alvo));
      const hAtual = hashDe(camposGerenciados(existente));
      if (hAtual === hGerado) {
        // card já está como seria gerado; só garante o registro no mapa (mapa perdido/antigo)
        if (entrada?.h !== hGerado) {
          mapa.cards[s.key] = { ...(entrada ?? {}), id: existente.id, tipo: existente.tipo, h: hGerado, coluna0: entrada?.coluna0 ?? existente.coluna };
        }
        continue;
      }
      // o card difere do que seria gerado: só atualiza se o difere é culpa do FATO (hash antigo bate com o card)
      if (!entrada?.h || hAtual !== entrada.h) {
        stats.preservados++; // editado pelo usuário (ou sem registro de geração): preserva
        continue;
      }
      // fato mudou: atualiza só o descritivo
      existente.titulo = alvo.titulo;
      existente.descricao = alvo.descricao;
      existente.prioridade = alvo.prioridade;
      existente.projeto = alvo.projeto;
      existente.tags = alvo.tags;
      existente.links = alvo.links;
      existente.vinculos = alvo.vinculos;
      existente.ingestao = { ...existente.ingestao, fonteTipo: alvo.ingestao.fonteTipo, fontePath: alvo.ingestao.fontePath, bucket: alvo.ingestao.bucket };
      existente.execucao = alvo.execucao;
      // checklist: textos novos entram; o que já existia (e o que o usuário marcou) fica
      const textos = new Set(existente.checklist.map((x) => x.texto));
      for (const it of alvo.checklist) if (!textos.has(it.texto) && existente.coluna !== "done" && existente.coluna !== "cancel") existente.checklist.push(it);
      existente.atualizadoEm = ts;
      mapa.cards[s.key] = { ...(entrada ?? {}), id: existente.id, tipo: existente.tipo, h: hGerado, coluna0: entrada?.coluna0 ?? s.coluna };
      stats.atualizados++;
      mudou = true;
      continue;
    }
    if (entrada && !entrada.retirado && jaEsteveNoBoard(entrada, s.tipo)) {
      stats.apagadosPeloUsuario++; // criado antes e removido do board pelo usuário: respeita (mesmo o último)
      continue;
    }
    // criar
    const wip = board.wipLimites?.[s.coluna];
    if (typeof wip === "number" && board.cards.filter((x) => x.coluna === s.coluna).length >= wip) {
      avisos.push(`limite WIP de "${s.coluna}" (${wip}) atingido; card "${s.key}" não criado`);
      continue;
    }
    // O id do mapa só volta se ainda estiver livre: um board recriado pelo app pode ter dado esse id a
    // outro card (o card de primeiro uso nasce ING-1 num board novo), e dois cards com o mesmo id
    // quebram o board. Ocupado → id novo (acima de tudo o que o board e o mapa já usaram).
    const livre = (x) => !reservados.has(x) && !board.cards.some((cd) => cd.id === x);
    const id = entrada?.id && livre(entrada.id) ? entrada.id : proximoId(s.tipo, board, mapa, reservados);
    if (entrada?.id && id !== entrada.id) avisos.push(`${entrada.id} já pertence a outro card do board; o card "${s.key}" foi criado como ${id}`);
    reservados.add(id);
    const card = construirCard(s, { id, ts, projeto, tipos, c, ordem: proximaOrdem(s.coluna) });
    board.cards.push(card);
    board.contadores[s.tipo] = Math.max(board.contadores[s.tipo] ?? 0, sufixo(id) || 0);
    mapa.cards[s.key] = { id, tipo: s.tipo, h: hashDe(camposGerenciados(card)), coluna0: s.coluna };
    stats.criados++;
    mudou = true;
  }

  // fatos que sumiram
  for (const chave of Object.keys(mapa.cards).sort()) {
    if (chavesAtuais.has(chave)) continue;
    const entrada = mapa.cards[chave];
    if (entrada.retirado) continue;
    const card = porChave.get(chave);
    if (!card) { entrada.retirado = true; mudou = true; continue; }
    const intocado =
      hashDe(camposGerenciados(card)) === entrada.h
      && card.coluna === entrada.coluna0
      && (card.historico?.length ?? 0) <= 1
      && card.checklist.every((x) => !x.feito)
      && (card.audios?.length ?? 0) === 0
      && (card.imagens?.length ?? 0) === 0
      && !card.responsavel;
    if (intocado) {
      board.cards = board.cards.filter((x) => x.id !== card.id);
      entrada.retirado = true;
      stats.removidos++;
      mudou = true;
    } else {
      stats.obsoletosMantidos++;
      avisos.push(`${card.id}: o fato de origem ("${chave}") sumiu do repositório, mas o card foi alterado e foi mantido`);
    }
  }

  // contadores nunca regridem
  for (const t of TIPOS) {
    const prefixo = PREFIXO_TIPO[t];
    let max = board.contadores[t] ?? 0;
    for (const cd of board.cards) if (cd.id?.startsWith(`${prefixo}-`)) max = Math.max(max, sufixo(cd.id) || 0);
    for (const e of Object.values(mapa.cards)) if (e.id?.startsWith(`${prefixo}-`)) max = Math.max(max, sufixo(e.id) || 0);
    if (board.contadores[t] !== max) { board.contadores[t] = max; mudou = true; }
  }
  if (mudou) board.atualizadoEm = ts;
  return { stats, avisos, mudou };
}

/* ================================================================== entrada do módulo */

export function gerarSpecs(ctx) {
  const c = criarCtx(ctx);
  const specs = [
    ...fontesAdr(c),
    ...fontesMarcadores(c),
    ...fontesReferencias(c),
    ...fontesIntegracao(c),
  ];
  // duplicatas por chave: a primeira vence
  const vistas = new Set();
  return { c, specs: specs.filter((s) => (vistas.has(s.key) ? false : (vistas.add(s.key), true))) };
}

/* ------------------------------------------------------------------ leitura/gravação do board (concorrência com o app) */

/** Espelha RETENCAO_SNAPSHOTS de lib/kanban.ts. */
const RETENCAO_SNAPSHOTS = 14;
const MAX_TENTATIVAS = 6;
/** EBUSY/EPERM/EACCES no Windows são transitórios (antivírus, rename do app em curso): valem nova tentativa. */
const CODIGOS_TRANSITORIOS = new Set(["EBUSY", "EPERM", "EACCES"]);
const dorme = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const ilegivel = (e) => new Error(`data/kanban/board.json está ilegível (${e?.name ?? "erro"}); nada foi gravado. Restaure de data/kanban/backups/ antes de popular.`);

/** Texto cru do board, ou `null` se o arquivo não existe. Qualquer outra falha = ilegível (nada é gravado). */
function lerTextoBoard(arquivo) {
  for (let t = 1; ; t++) {
    try {
      return readFileSync(arquivo, "utf8");
    } catch (e) {
      if (e?.code === "ENOENT") return null;
      if (CODIGOS_TRANSITORIOS.has(e?.code) && t < 3) { dorme(30 * t); continue; }
      throw ilegivel(e);
    }
  }
}

/** Board a partir do texto cru. JSON inválido NUNCA é sobrescrito. `boardNovo` = o arquivo não existia. */
function interpretarBoard(texto, ts) {
  const base = boardVazio(ts);
  if (texto === null) return { board: base, boardNovo: true };
  let bruto;
  try { bruto = JSON.parse(texto); } catch (e) { throw ilegivel(e); }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new Error("data/kanban/board.json não é um objeto; nada foi gravado.");
  return {
    board: { ...base, ...bruto, wipLimites: { ...base.wipLimites, ...bruto.wipLimites }, contadores: { ...base.contadores, ...bruto.contadores }, cards: bruto.cards ?? [] },
    boardNovo: false,
  };
}

function lerMapa(arquivo) {
  let mapa = null;
  try { mapa = JSON.parse(readFileSync(arquivo, "utf8")); } catch { mapa = null; }
  if (!mapa || typeof mapa !== "object" || Array.isArray(mapa)) mapa = { versao: 1, canal: CANAL, cards: {} };
  mapa.cards ??= {};
  return mapa;
}

/** Dia local em YYYYMMDD — a mesma regra do snapshot do app (não UTC). */
function diaLocal(d = new Date()) {
  const dois = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}`;
}

/**
 * Snapshot rotativo do board ANTERIOR à sobrescrita, igual ao que o app faz antes de cada mutação:
 * `backups/board-AAAAMMDD.json`, um por dia (o primeiro do dia vence, é o último estado bom conhecido),
 * poda além de RETENCAO_SNAPSHOTS. Falha aqui não bloqueia (como no app); quem chama avisa.
 */
function snapshotDiario(dir, textoAnterior) {
  const backups = path.join(dir, "backups");
  const nome = `board-${diaLocal()}.json`;
  const destino = path.join(backups, nome);
  try {
    let criado = false;
    if (textoAnterior !== null && !existsSync(destino)) {
      mkdirSync(backups, { recursive: true });
      const tmp = `${destino}.tmp-${process.pid}`;
      writeFileSync(tmp, textoAnterior);
      renameSync(tmp, destino);
      criado = true;
    }
    if (existsSync(backups)) {
      const arquivos = readdirSync(backups).filter((f) => /^board-\d{8}\.json$/.test(f)).sort();
      for (const antigo of arquivos.slice(0, Math.max(0, arquivos.length - RETENCAO_SNAPSHOTS))) unlinkSync(path.join(backups, antigo));
    }
    return { ok: true, criado, nome };
  } catch (e) {
    return { ok: false, criado: false, nome, erro: e?.code ?? e?.name ?? "erro" };
  }
}

/**
 * Lê o board, mescla e grava SEM perder escrita concorrente do app (que não tem lock entre processos):
 *   1. lê o texto do board e mescla em memória (milissegundos; `specs` já vêm calculados);
 *   2. tira o snapshot diário do texto lido;
 *   3. grava o resultado num arquivo temporário e, SÍNCRONO e imediatamente antes do rename, confere
 *      que o board.json no disco ainda é exatamente o texto que foi mesclado;
 *   4. se mudou (o app gravou no intervalo), descarta o temporário e refaz tudo sobre a versão nova.
 * Sobra apenas a janela entre a conferência e o rename (microssegundos, mesma thread). O mapa de ids só é
 * gravado depois do board, e só se mudou.
 */
async function mesclarEGravar({ dir, arquivoBoard, arquivoMapa, specs, ts, projeto, tipos, c }) {
  let refeitas = 0;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const lido = lerTextoBoard(arquivoBoard);
    const { board, boardNovo } = interpretarBoard(lido, ts);
    const mapa = lerMapa(arquivoMapa);
    const m = mesclar({ board, mapa, specs, ts, projeto, tipos, c, boardNovo });

    let snapshot = null;
    if (m.mudou || boardNovo) {
      snapshot = snapshotDiario(dir, lido);
      mkdirSync(dir, { recursive: true });
      const tmp = `${arquivoBoard}.populate-${process.pid}.tmp`;
      let gravou = false;
      try {
        writeFileSync(tmp, `${JSON.stringify(board, null, 2)}\n`);
        if (lerTextoBoard(arquivoBoard) === lido) {
          renameSync(tmp, arquivoBoard);
          gravou = true;
        }
      } catch (e) {
        if (!CODIGOS_TRANSITORIOS.has(e?.code)) throw e;
      } finally {
        if (!gravou) rmSync(tmp, { force: true });
      }
      if (!gravou) { refeitas++; dorme(25 * tentativa); continue; }
    }

    const novoMapa = { versao: 1, canal: CANAL, cards: Object.fromEntries(Object.keys(mapa.cards).sort().map((k) => [k, estavel(mapa.cards[k])])) };
    const textoMapa = `${JSON.stringify(novoMapa, null, 2)}\n`;
    const atualMapa = existsSync(arquivoMapa) ? readFileSync(arquivoMapa, "utf8") : null;
    if (atualMapa !== textoMapa) await writeText(arquivoMapa, textoMapa);
    return { board, stats: m.stats, avisos: m.avisos, refeitas, snapshot };
  }
  throw new Error(`data/kanban/board.json mudou ${MAX_TENTATIVAS} vezes seguidas durante a população (o app está em uso?); nada foi gravado. Feche o app ou rode de novo.`);
}

/* ================================================================== primeiro uso (lib/primeiro-uso.ts) */

/** Espelha TAG_CARD_MEGABRAIN de lib/primeiro-uso.ts (o teste confere a igualdade). */
export const TAG_CARD_PRIMEIRO_USO = "onboarding:megabrain";
const ESTADOS_PRIMEIRO_USO = ["pendente", "aceito", "dispensado"];
/** A variável com que o app (`detectarMegabrain`) e o populate (`resolveRepoRoot`) acham a raiz do Megabrain. */
const VARIAVEL_RAIZ = "BILHON_MEGABRAIN_ROOT";

/** Raiz do Megabrain para um valor de BILHON_MEGABRAIN_ROOT (em branco = automático), pela regra de `detectarMegabrain`. */
function raizPorValor(appRoot, valor) {
  if (valor) return { raiz: path.resolve(appRoot, valor), motivo: "informada" };
  const pai = path.dirname(path.resolve(appRoot));
  if (path.basename(pai).toLowerCase() !== "apps") return { raiz: null, motivo: "fora-de-apps" };
  return { raiz: path.dirname(pai), motivo: "pasta-apps" };
}

/**
 * Raiz do Megabrain que o app detectaria (mesma regra de `detectarMegabrain`, sem os sinais de pasta),
 * lida SÓ dos `.env*` do app: BILHON_MEGABRAIN_ROOT (em branco = automático), senão `<raiz>/apps/<app>`.
 * `null` = o app não pergunta.
 */
export function raizDetectadaPeloApp(appRoot) {
  return raizPorValor(appRoot, variavelDosArquivosDoApp(appRoot, VARIAVEL_RAIZ)?.valor ?? "");
}

const caminhoReal = (p) => { try { return realpathSync.native(p); } catch { return path.resolve(p); } };
const mesmoCaminho = (a, b) => path.relative(caminhoReal(a), caminhoReal(b)) === "";

/**
 * O BILHON_MEGABRAIN_ROOT do terminal do populate leva a outra raiz que a dos `.env*` do app? Com
 * `BILHON_MEGABRAIN_ROOT=/outro npm run populate` o populate lê /outro, mas o app, iniciado em outro
 * terminal, não vê esse ambiente e pergunta pelo Megabrain dos arquivos dele (ou o de cima de `apps/`).
 * Ausente no processo = sem divergência; em branco = automático, como no app; o que se compara é a raiz
 * a que cada lado leva, não o texto. `null` = coerente; senão `{ terminal, app, arquivo }` (raiz `null` =
 * fora de `apps/`; `arquivo` = o `.env*` que define a variável, `null` = nenhum).
 */
export function ambienteDivergente(appRoot) {
  const doTerminal = process.env[VARIAVEL_RAIZ];
  if (doTerminal === undefined) return null;
  const terminal = raizPorValor(appRoot, doTerminal.trim()).raiz;
  const app = raizDetectadaPeloApp(appRoot).raiz;
  const coerente = terminal === null || app === null ? terminal === app : mesmoCaminho(terminal, app);
  return coerente ? null : { terminal, app, arquivo: variavelDosArquivosDoApp(appRoot, VARIAVEL_RAIZ)?.arquivo ?? null };
}

/** Board de `<data>/kanban/board.json` como está no disco agora (ausente = vazio); ilegível lança, como no `run`. */
function boardNoDisco(dataDir, ts) {
  return interpretarBoard(lerTextoBoard(path.join(dataDir, "kanban", "board.json")), ts).board;
}

/** Por que um módulo de MODULOS não conta como ok nesta execução (texto dos avisos). */
function motivoNaoOk(r) {
  if (!r) return "sem resultado";
  if (r.erro !== undefined) return "falhou";
  if (r.motivo === "nao-implementado") return "não implementado";
  return "não ok";
}

/**
 * Responde a pergunta de primeiro uso ("Popular o Knowledge com o seu Megabrain?") pela população que
 * acabou de ser confirmada (`--yes` ou "s" no terminal). Chamada por populate.mjs (`executar`) uma vez,
 * DEPOIS do laço dos módulos, com `resultados` = o de todos os módulos desta execução; o `run` deste
 * módulo não a chama, e nada mais grava `data/primeiro-uso.json`. Semântica de lib/primeiro-uso.ts:
 *   - `pendente` (ou arquivo ausente) → `aceito`: a pessoa aceitou popular, e quem popula é o próprio
 *     populate. SEM card: o card do app é a tarefa de um agente escrever importadores, que o populate
 *     dispensa (em DOING ficaria parado lá; em DONE afirmaria um trabalho de agente que não houve).
 *     `cardId` = o card que o app já tinha criado (se ainda existe no board; ele não é tocado, só
 *     avisado), senão `null`, que o app aceita: se a pessoa chamar `reabrir`, o app cria o card dele com
 *     o próximo id livre do contador;
 *   - `aceito` ou `dispensado` → resposta já dada (pela pessoa ou por uma população anterior): intocada;
 *   - arquivo ilegível ou de outro formato → não é sobrescrito (aviso): o app volta a perguntar.
 * Nada é gravado se a execução é PARCIAL (`opts.only`/`opts.skip`, as opções do populate, tiram algum
 * módulo: todos alimentam telas), se algum módulo de MODULOS não terminou ok (falhou, ainda não
 * implementado ou sem resultado: `resultados` ausente não responde), se o BILHON_MEGABRAIN_ROOT do
 * terminal diverge dos `.env*` do app (`ambienteDivergente`: não se sabe o que o app vai perguntar), se o
 * app não perguntaria (fora de `apps/`) ou se perguntaria sobre OUTRO Megabrain (`--repo`, ou os `.env*`
 * do app, apontando para outro lugar: essa resposta não vale para ele). `opts` ausente = execução completa.
 * `board` ausente = o `<data>/kanban/board.json` do disco, lido só quando vai gravar (o card que o app
 * criou pode ter chegado depois do kanban). Grava como o app (`JSON.stringify(_, null, 1)`, temp + rename)
 * e só se o arquivo não mudou no meio.
 * @param {{ appRoot: string, dataDir: string, repoRoot: string, board?: { cards?: unknown } | null, ts?: string,
 *   resultados?: Record<string, unknown>, opts?: { only?: string[] | null, skip?: string[] } }} args
 */
export async function responderPrimeiroUso({ appRoot, dataDir, repoRoot, board = null, ts = new Date().toISOString(), resultados = {}, opts = {} }) {
  const avisos = [];
  const fora = modulosForaDaExecucao(opts);
  if (fora.length) {
    avisos.push(`primeiro uso: não respondido porque a população foi parcial (--only/--skip deixou de fora: ${fora.join(", ")}); data/primeiro-uso.json não foi alterado: só uma população completa responde a pergunta do app`);
    return { resumo: { acao: "populacao-parcial", modulos: fora }, avisos };
  }
  const naoOk = MODULOS.filter((m) => resultados?.[m]?.ok !== true);
  if (naoOk.length) {
    avisos.push(`primeiro uso: não respondido porque nem todos os módulos terminaram ok nesta execução (${naoOk.map((m) => `${m}: ${motivoNaoOk(resultados?.[m])}`).join(", ")}); data/primeiro-uso.json não foi alterado e o app continua oferecendo o card até uma população completa e sem falhas`);
    return { resumo: { acao: "populacao-com-falha", modulos: naoOk }, avisos };
  }
  const div = ambienteDivergente(appRoot);
  if (div) {
    avisos.push(
      `primeiro uso: não respondido porque o ${VARIAVEL_RAIZ} deste terminal leva a ${div.terminal ?? "nenhum Megabrain (fora de apps/)"}, ` +
        `mas o app, iniciado pelo npm run dev em outro terminal, não vê esse ambiente: pelos arquivos dele (${div.arquivo ?? "nenhum .env* define a variável: automático"}) ` +
        `perguntaria por ${div.app ?? "nenhum (fora de apps/)"}. data/primeiro-uso.json não foi alterado; defina a variável no .env.local do app (ou rode sem ela no terminal) e popule de novo`,
    );
    return { resumo: { acao: "ambiente-divergente", variavel: VARIAVEL_RAIZ }, avisos };
  }
  const det = raizDetectadaPeloApp(appRoot);
  if (!det.raiz) return { resumo: { acao: "sem-pergunta", motivo: det.motivo }, avisos };
  if (!mesmoCaminho(det.raiz, repoRoot)) {
    avisos.push(`primeiro uso: o app perguntaria sobre o Megabrain em ${det.raiz} (${det.motivo}), não sobre o repositório lido; data/primeiro-uso.json não foi alterado`);
    return { resumo: { acao: "outro-megabrain" }, avisos };
  }
  const arquivo = path.join(dataDir, "primeiro-uso.json");
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    let lido = null;
    try {
      lido = readFileSync(arquivo, "utf8");
    } catch (e) {
      if (e?.code !== "ENOENT") {
        avisos.push(`primeiro uso: data/primeiro-uso.json ilegível (${e?.code ?? "erro"}); não foi sobrescrito e o app volta a perguntar`);
        return { resumo: { acao: "ilegivel" }, avisos };
      }
    }
    let atual = null;
    if (lido !== null) {
      try { atual = JSON.parse(lido); } catch { atual = null; }
      const m = atual?.megabrain;
      if (atual?.versao !== 1 || !m || !ESTADOS_PRIMEIRO_USO.includes(m.estado)) {
        avisos.push("primeiro uso: data/primeiro-uso.json não está no formato do app (lib/primeiro-uso.ts); não foi sobrescrito e o app volta a perguntar");
        return { resumo: { acao: "ilegivel" }, avisos };
      }
      if (m.estado !== "pendente") return { resumo: { acao: "mantido", estado: m.estado, cardId: m.cardId ?? null }, avisos };
    }
    // card que o app já criou ("preparar"): o guardado, se ainda existe; senão o marcado pela tag
    board ??= boardNoDisco(dataDir, ts);
    const cards = Array.isArray(board?.cards) ? board.cards : [];
    const salvo = atual?.megabrain?.cardId;
    const card = cards.find((cd) => cd.id === salvo) ?? cards.find((cd) => (cd.tags ?? []).includes(TAG_CARD_PRIMEIRO_USO)) ?? null;
    const valor = { versao: 1, megabrain: { estado: "aceito", cardId: card?.id ?? null, atualizadoEm: ts } };
    mkdirSync(dataDir, { recursive: true });
    const tmp = `${arquivo}.populate-${process.pid}.tmp`;
    let gravou = false;
    try {
      writeFileSync(tmp, JSON.stringify(valor, null, 1));
      let agora = null;
      try { agora = readFileSync(arquivo, "utf8"); } catch { agora = null; }
      if (agora === lido) { renameSync(tmp, arquivo); gravou = true; }
    } finally {
      if (!gravou) rmSync(tmp, { force: true });
    }
    if (!gravou) continue; // o app respondeu no intervalo: relê e respeita a resposta dele
    if (card && card.coluna !== "done" && card.coluna !== "cancel") {
      avisos.push(`primeiro uso: o card ${card.id} ("${card.titulo}"), criado pelo app para um agente fazer a integração, continua em ${card.coluna}; a população já foi feita pelo populate. Se não for usar o caminho do agente, mova-o para CANCEL`);
    }
    return { resumo: { acao: "respondido", estado: "aceito", cardId: valor.megabrain.cardId }, avisos };
  }
  avisos.push("primeiro uso: data/primeiro-uso.json mudou durante a população (o app está aberto?); não foi alterado");
  return { resumo: { acao: "concorrente" }, avisos };
}

export default async function run(ctx) {
  ativarExclusoes(ctx);
  const dir = path.join(ctx.dataDir, "kanban");
  const arquivoBoard = path.join(dir, "board.json");
  const arquivoMapa = path.join(dir, ".populate-ids.json");
  const ts = new Date().toISOString();

  const tipos = await carregarTipos(ctx.appRoot);
  const avisos = [];
  let projeto = "geral";
  if (!tipos) avisos.push("lib/types.ts não pôde ser importado: a DoD por tipo não entrou nos checklists (o app a acrescenta ao primeiro PATCH)");
  else if (!tipos.KANBAN_PROJETOS.includes(projeto)) {
    projeto = tipos.KANBAN_PROJETO_PADRAO;
    avisos.push(`projeto "geral" não é aceito (NEXT_PUBLIC_KANBAN_PROJETOS); usando "${projeto}"`);
  }

  // A parte LENTA (varrer ~1000 docs, ~5 s) vem ANTES de ler o board: o board.json é lido, mesclado e
  // gravado em milissegundos logo depois, em vez de ficar segurado durante a varredura — nesse intervalo
  // qualquer card criado/movido pelo app (dev server) seria sobrescrito em silêncio (lost update).
  const { c, specs } = gerarSpecs(ctx);
  const r = await mesclarEGravar({ dir, arquivoBoard, arquivoMapa, specs, ts, projeto, tipos, c });
  const { board, stats } = r;
  avisos.push(...r.avisos);
  if (r.refeitas) avisos.push(`board.json foi alterado por outro processo durante a população (${r.refeitas}x; o app está aberto?): a mescla foi refeita sobre a versão mais nova e nenhuma alteração do usuário foi perdida`);
  if (r.snapshot && !r.snapshot.ok) avisos.push(`snapshot diário do board não pôde ser gravado em data/kanban/backups/ (${r.snapshot.erro}); a população seguiu mesmo assim`);
  // a pergunta de primeiro uso NÃO é respondida aqui: os módulos seguintes ainda vão rodar (populate.mjs
  // a responde depois do laço, com `responderPrimeiroUso` e o resultado de todos)

  const gerenciados = board.cards.filter((cd) => cd.origem?.canal === CANAL);
  const por = (campo) => Object.fromEntries(Object.entries(gerenciados.reduce((a, cd) => ((a[cd[campo]] = (a[cd[campo]] ?? 0) + 1), a), {})).sort());
  if (stats.preservados) avisos.push(`${stats.preservados} card(s) editados pelo usuário foram preservados sem atualização`);
  if (stats.apagadosPeloUsuario) avisos.push(`${stats.apagadosPeloUsuario} card(s) apagados pelo usuário não foram recriados (para recriá-los de propósito, remova data/kanban/.populate-ids.json e rode de novo)`);
  log("kanban", `board com ${board.cards.length} cards (${gerenciados.length} gerenciados): +${stats.criados} ~${stats.atualizados} -${stats.removidos}${r.snapshot?.criado ? ` · snapshot ${r.snapshot.nome}` : ""}`);
  return {
    resumo: {
      cards: board.cards.length,
      gerenciados: gerenciados.length,
      ...stats,
      porColuna: por("coluna"),
      porTipo: por("tipo"),
      porPrioridade: por("prioridade"),
    },
    avisos,
  };
}
