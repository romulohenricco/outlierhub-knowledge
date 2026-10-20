// SERVER-ONLY: lê o arquivo de organização do disco. Importado só pela page (server component).
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { caminhoBilhonPermitido, lerEnv } from "../bilhon-paths";
import { agenteDir } from "../ecosystem";
import { cortaTexto } from "../texto";
import { ehIconePilar } from "./pilar-icones";
import type { AgenteOrg, ExecucaoOrg, FerramentaOrg, OrgData, OrgLeitura, PessoaOrg, PilarOrg, TarefaOrg } from "./tipos";

/** Teto do arquivo lido (evita ler e enviar ao navegador um arquivo gigante por engano). */
export const LIMITE_ARQUIVO_ORG = 4 * 1024 * 1024;
/** Teto de linhas por categoria. */
export const LIMITE_LINHAS_ORG = 2000;
const LIMITE_PASSOS = 40;

const PREFIXO = { pilar: "pilar:", agente: "agente:", pessoa: "pessoa:", tarefa: "tarefa:", ferramenta: "ferramenta:" } as const;

/** Arquivo de organização: BILHON_BRAIN_ORG_JSON ou `organizacao.json` na pasta de estado do agente. */
export function caminhoOrganizacao(): string {
  const env = lerEnv("BILHON_BRAIN_ORG_JSON");
  return env ? path.resolve(env) : path.join(agenteDir(), "organizacao.json");
}

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(ehObj).slice(0, LIMITE_LINHAS_ORG) : []);

function txt(v: unknown, max: number): string {
  if (typeof v === "string") return cortaTexto(v.trim(), max);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function idDe(v: unknown): string {
  const s = txt(v, 120);
  return s;
}

function listaTxt(v: unknown, maxItens: number, maxChars: number): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => cortaTexto(x.trim(), maxChars)).filter(Boolean).slice(0, maxItens) : [];
}

const corValida = (v: unknown): string | null => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : null);

/**
 * Pura: transforma o JSON do usuário em `OrgData` consistente. Nunca lança.
 * - todos os ids ganham prefixo da categoria (sem colisão entre categorias);
 * - id repetido na categoria: vale a primeira linha;
 * - referência que não resolve (ferramenta, pai) é omitida, não inventada;
 * - agente, pessoa ou tarefa cujo pilar não existe não tem onde ser desenhado:
 *   é descartado e contado em `avisos`.
 */
export function normalizarOrganizacao(raw: unknown): { data: OrgData; avisos: string[] } {
  const src: Obj = ehObj(raw) ? raw : {};
  const avisos: string[] = [];
  let descartadosSemPilar = 0;

  const vistos = new Set<string>();
  const novos = <T extends { id: string }>(itens: T[]) =>
    itens.filter((i) => (vistos.has(i.id) ? false : (vistos.add(i.id), true)));

  const pilares: PilarOrg[] = novos(
    lista(src.pilares).flatMap((r, i) => {
      const id = idDe(r.id);
      const nome = txt(r.nome, 80);
      if (!id || !nome) return [];
      const ordem = typeof r.ordem === "number" && Number.isFinite(r.ordem) ? r.ordem : i;
      return [{ id: PREFIXO.pilar + id, nome, tagline: txt(r.tagline, 200), ordem, cor: corValida(r.cor), icone: ehIconePilar(r.icone) ? r.icone : null }];
    }),
  ).sort((a, b) => a.ordem - b.ordem);
  const pilarIds = new Set(pilares.map((p) => p.id));

  const ferramentas: FerramentaOrg[] = novos(
    lista(src.ferramentas).flatMap((r) => {
      const id = idDe(r.id);
      const nome = txt(r.nome, 80);
      if (!id || !nome) return [];
      return [{ id: PREFIXO.ferramenta + id, nome, categoria: txt(r.categoria, 60), status: txt(r.status, 40), descricao: txt(r.descricao, 600) }];
    }),
  );
  const ferrIds = new Set(ferramentas.map((t) => t.id));
  const ferrDe = (v: unknown) => listaTxt(v, 60, 120).map((s) => PREFIXO.ferramenta + s).filter((id) => ferrIds.has(id));

  const comPilar = (r: Obj): string | null => {
    const p = PREFIXO.pilar + idDe(r.pilarId);
    if (pilarIds.has(p)) return p;
    descartadosSemPilar++;
    return null;
  };

  const agentes: AgenteOrg[] = novos(
    lista(src.agentes).flatMap((r) => {
      const id = idDe(r.id);
      const nome = txt(r.nome, 80);
      const pilarId = comPilar(r);
      if (!id || !nome || !pilarId) return [];
      return [{
        id: PREFIXO.agente + id,
        pilarId,
        nome,
        papel: txt(r.papel, 120),
        status: txt(r.status, 40),
        funcao: txt(r.funcao, 40),
        descricao: txt(r.descricao, 600),
        modelo: txt(r.modelo, 80),
        ferramentas: ferrDe(r.ferramentas),
        paiId: idDe(r.paiId) ? PREFIXO.agente + idDe(r.paiId) : null,
        ambiente: txt(r.ambiente, 80),
      }];
    }),
  );
  const agenteIds = new Set(agentes.map((a) => a.id));
  for (const a of agentes) if (a.paiId && (!agenteIds.has(a.paiId) || a.paiId === a.id)) a.paiId = null;

  const pessoas: PessoaOrg[] = novos(
    lista(src.pessoas).flatMap((r) => {
      const id = idDe(r.id);
      const nome = txt(r.nome, 80);
      const pilarId = comPilar(r);
      if (!id || !nome || !pilarId) return [];
      return [{ id: PREFIXO.pessoa + id, pilarId, nome, papel: txt(r.papel, 120), ferramentas: ferrDe(r.ferramentas) }];
    }),
  );

  const tarefas: TarefaOrg[] = novos(
    lista(src.tarefas).flatMap((r) => {
      const id = idDe(r.id);
      const titulo = txt(r.titulo, 160);
      const pilarId = comPilar(r);
      if (!id || !titulo || !pilarId) return [];
      const pessoa = r.executorTipo === "person" || r.executorTipo === "pessoa";
      const exec = idDe(r.executorId);
      return [{
        id: PREFIXO.tarefa + id,
        pilarId,
        titulo,
        resumo: txt(r.resumo, 600),
        passos: listaTxt(r.passos, LIMITE_PASSOS, 300),
        executorTipo: pessoa ? ("person" as const) : ("agent" as const),
        executorId: exec ? (pessoa ? PREFIXO.pessoa : PREFIXO.agente) + exec : "",
      }];
    }),
  );

  const ultimaExecucao: Record<string, ExecucaoOrg> = {};
  for (const r of lista(src.execucoes)) {
    const agente = idDe(r.agenteId);
    const iniciadoEm = txt(r.iniciadoEm, 40);
    if (!agente || !iniciadoEm) continue;
    const id = PREFIXO.agente + agente;
    const atual = ultimaExecucao[id];
    if (atual && atual.iniciadoEm > iniciadoEm) continue;
    ultimaExecucao[id] = {
      agenteId: id,
      iniciadoEm,
      terminadoEm: txt(r.terminadoEm, 40) || null,
      ok: typeof r.ok === "boolean" ? r.ok : null,
      resumo: txt(r.resumo, 300),
      status: txt(r.status, 40),
    };
  }

  if (descartadosSemPilar > 0) avisos.push(`${descartadosSemPilar} linha(s) de agentes, pessoas ou tarefas ficaram de fora: o pilarId não existe em "pilares"`);
  return { data: { pilares, agentes, pessoas, tarefas, ferramentas, ultimaExecucao }, avisos };
}

/**
 * Lê o arquivo de organização. Só dentro de BILHON_ROOT (sem symlink que saia dela),
 * até `LIMITE_ARQUIVO_ORG`. Arquivo ausente, fora da raiz ou inválido: `ok:false` com o
 * motivo, para a tela dizer o que configurar. Nunca lança.
 */
export async function lerOrganizacao(caminho: string = caminhoOrganizacao()): Promise<OrgLeitura> {
  if (!caminhoBilhonPermitido(caminho)) {
    return { ok: false, estado: "fora-da-raiz", motivo: "arquivo fora de BILHON_ROOT (recusado)" };
  }
  try {
    const st = await stat(caminho);
    if (!st.isFile()) return { ok: false, estado: "invalida", motivo: "o caminho não é um arquivo" };
    if (st.size > LIMITE_ARQUIVO_ORG) {
      return { ok: false, estado: "invalida", motivo: `arquivo maior que ${LIMITE_ARQUIVO_ORG / 1024 / 1024} MB` };
    }
  } catch (e) {
    const ausente = (e as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, estado: ausente ? "ausente" : "invalida", motivo: ausente ? "arquivo ainda não existe" : "arquivo ilegível" };
  }
  try {
    const bruto: unknown = JSON.parse(await readFile(caminho, "utf8"));
    const { data, avisos } = normalizarOrganizacao(bruto);
    return { ok: true, data, avisos };
  } catch {
    return { ok: false, estado: "invalida", motivo: "JSON inválido ou ilegível" };
  }
}
