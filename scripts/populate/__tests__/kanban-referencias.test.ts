/**
 * Módulos `kanban` e `referencias` da população do Knowledge, contra o corpus REAL do mega-brain
 * (pulado se o repositório não estiver ao lado do app) e lidos pelos leitores de verdade:
 * `lib/kanban.ts` (board, criação, edição, movimento e exclusão), `lib/referencias.ts`
 * (índice, caminhos de mídia e miniaturas) e `lib/primeiro-uso.ts` + `GET /api/primeiro-uso`
 * (a pergunta "Popular o Knowledge com o seu Megabrain?" fica respondida pela população: não pelo
 * módulo kanban, mas por `responderPrimeiroUso`, que populate.mjs chama depois de todos os módulos).
 *
 * Nada é gravado fora de um diretório temporário dentro de `node_modules/.cache/knowledge-tests`.
 * O mega-brain é só lido. O bloco que lê o data/ REAL do app só roda se foi a população que o gerou
 * (data/.populated.json com o módulo `ok`); o volume desta distribuição só com POPULATE_E2E=1.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MODULOS } from "../../populate.mjs";
import { resolveRepoRoot, scanRepo } from "../common.mjs";
import runKanban, { CANAL, PREFIXO_TIPO as PREFIXO_POPULATE, TAG_CARD_PRIMEIRO_USO, raizDetectadaPeloApp, responderPrimeiroUso } from "../kanban.mjs";
import runReferencias, { extensoesServidas } from "../referencias.mjs";
import type { KanbanBoard, KanbanCard } from "@/lib/types";

// O disco B: sob carga deixa a população do corpus real lenta; o limite padrão de 60 s estourava sem haver defeito.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

const APP = process.cwd();
/**
 * O Megabrain que o populate lê e o app detecta: o do BILHON_MEGABRAIN_ROOT (terminal ou .env.local; ex.: o clone
 * ../mega-brain-oss) ou, sem ele, o mega-brain que contém o app (../..). Assumir ../.. quebrava com o clone.
 */
const REPO = (() => {
  try {
    return resolveRepoRoot();
  } catch {
    return path.resolve(APP, "..", "..");
  }
})();
const temRepo = existsSync(path.join(REPO, "engine")) && existsSync(path.join(REPO, ".claude"));
const DATA_REAL = path.join(APP, "data");
/**
 * Caminho no disco de uma evidência, que é relativa ao repositório lido. As do próprio app saem como
 * `apps/knowledge/...`; com o repositório fora do app (clone ao lado) elas moram na pasta do app, não em REPO.
 */
const noDisco = (rel: string) => {
  const doApp = rel.startsWith("apps/knowledge/") ? path.join(APP, rel.slice("apps/knowledge/".length)) : null;
  return doApp && !existsSync(path.join(REPO, rel)) && existsSync(doApp) ? doApp : path.join(REPO, rel);
};

/** Módulos que `npm run populate` concluiu (`ok: true`) segundo data/.populated.json; vazio sem o marcador. */
function modulosPopulados(dataDir: string): Set<string> {
  try {
    const marcador = JSON.parse(readFileSync(path.join(dataDir, ".populated.json"), "utf8")) as {
      modulos?: Record<string, { ok?: unknown } | null>;
    };
    return new Set(Object.entries(marcador.modulos ?? {}).filter(([, m]) => m?.ok === true).map(([nome]) => nome));
  } catch {
    return new Set();
  }
}
const POPULADOS = modulosPopulados(DATA_REAL);
/** Conteúdo desta distribuição do mega-brain (padrão de livros-colecoes.test.ts): `POPULATE_E2E=1 npx vitest run <arquivo>`. */
const E2E = process.env.POPULATE_E2E === "1";

type Doc = Awaited<ReturnType<typeof scanRepo>>["docs"][number];
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
/** `ctx.resultados` de uma população completa em que todos os módulos de MODULOS terminaram ok. */
const todosOk = () => Object.fromEntries(MODULOS.map((m) => [m, { ok: true }]));
/** Sem BILHON_MEGABRAIN_ROOT no processo, como um `npm run populate` sem ela (vazia ainda vale como "definida" para o Next). */
async function semVariavel<T>(fn: () => Promise<T>): Promise<T> {
  const antes = process.env.BILHON_MEGABRAIN_ROOT;
  delete process.env.BILHON_MEGABRAIN_ROOT;
  try {
    return await fn();
  } finally {
    if (antes === undefined) delete process.env.BILHON_MEGABRAIN_ROOT;
    else process.env.BILHON_MEGABRAIN_ROOT = antes;
  }
}

describe.skipIf(!temRepo)("população do Kanban e das Referências (corpus real, leitores reais)", () => {
  const criados: string[] = [];
  let docs: Doc[];
  let tmp: string;

  const ctxDe = (dataDir: string, lista: Doc[] = docs) => ({ repoRoot: REPO, appRoot: APP, dataDir, docs: lista, excluded: [], opts: {}, resultados: {} });
  async function novoTmp() {
    const base = path.join(APP, "node_modules", ".cache", "knowledge-tests");
    await mkdir(base, { recursive: true });
    const d = await mkdtemp(path.join(base, "populate-kanban-refs-"));
    criados.push(d);
    return d;
  }
  /** Os leitores leem a env no import: recarrega o módulo apontando para o diretório do teste. */
  async function kanbanLib(dataDir: string) {
    vi.resetModules();
    vi.stubEnv("BILHON_KANBAN_DIR", path.join(dataDir, "kanban"));
    return await import("@/lib/kanban");
  }
  async function referenciasLib(dataDir: string) {
    vi.resetModules();
    vi.stubEnv("BILHON_REFERENCIAS_DIR", path.join(dataDir, "referencias-instagram"));
    return await import("@/lib/referencias");
  }
  const lerBoardCru = async (dataDir: string) => JSON.parse(await readFile(path.join(dataDir, "kanban", "board.json"), "utf8")) as KanbanBoard;
  // `populate-megabrain` não está no union KanbanCanalPedido do app (campo é texto livre em runtime)
  const gerenciados = (b: KanbanBoard) => b.cards.filter((c) => (c.origem.canal as string | null) === CANAL);

  beforeAll(async () => {
    docs = (await scanRepo(REPO)).docs;
    tmp = await novoTmp();
    await runKanban(ctxDe(tmp));
    await runReferencias(ctxDe(tmp));
    // como populate.mjs: a pergunta de primeiro uso só é respondida depois de TODOS os módulos, com o resultado deles
    await semVariavel(() => responderPrimeiroUso({ appRoot: APP, dataDir: tmp, repoRoot: REPO, resultados: todosOk() }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await Promise.all(criados.map((d) => rm(d, { recursive: true, force: true })));
  });

  describe("kanban (lib/kanban.ts)", () => {
    it("o prefixo por tipo do módulo é o do app", async () => {
      const lib = await kanbanLib(tmp);
      expect(PREFIXO_POPULATE).toEqual(lib.PREFIXO_TIPO);
    });

    it("o leitor real carrega o board: dezenas de cards, todos completos, ids coerentes e colunas válidas", async () => {
      const lib = await kanbanLib(tmp);
      const board = await lib.getBoard();
      const types = await import("@/lib/types");
      expect(board.cards.length).toBeGreaterThanOrEqual(20);
      expect(board.cards.length).toBeLessThan(150);
      expect(board.colunas.map((c) => c.id)).toEqual(["todo", "doing", "done", "cancel"]);
      const ids = new Set<string>();
      for (const c of board.cards) {
        expect(lib.cardIdValido(c.id), c.id).toBe(true);
        expect(ids.has(c.id), `id repetido ${c.id}`).toBe(false);
        ids.add(c.id);
        expect(c.id.startsWith(`${lib.PREFIXO_TIPO[c.tipo]}-`), `${c.id} × ${c.tipo}`).toBe(true);
        expect(["baixa", "media", "alta", "urgente"]).toContain(c.prioridade);
        expect(types.KANBAN_PROJETOS).toContain(c.projeto);
        expect(board.colunas.some((col) => col.id === c.coluna)).toBe(true);
        for (const campo of ["tags", "links", "vinculos", "audios", "imagens", "checklist", "historico"] as const) {
          expect(Array.isArray(c[campo]), `${c.id}.${campo}`).toBe(true);
        }
        expect(c.titulo.trim().length).toBeGreaterThan(5);
        expect(c.descricao.length).toBeGreaterThan(40);
        expect(c.ingestao.fontePath.length, `${c.id} sem fonte`).toBeGreaterThan(0);
        // sem caminho absoluto de máquina em dado versionável
        expect(`${c.descricao}${c.ingestao.fontePath.join("")}`).not.toMatch(/[A-Za-z]:[\\/]|\/Users\/|\/home\//);
        for (const l of c.links) expect(l.url).toMatch(/^https:\/\//);
        for (const v of c.vinculos) expect(v.linkLocal).toMatch(/^\/livro\//);
        expect(c.origem.canal).toBe(CANAL);
        expect(c.origem.pedidoOriginal).toMatch(/^populate:[a-z-]+:.+/);
      }
      // contadores nunca ficam atrás do maior id
      for (const tipo of Object.keys(lib.PREFIXO_TIPO) as (keyof typeof lib.PREFIXO_TIPO)[]) {
        const maior = Math.max(0, ...board.cards.filter((c) => c.tipo === tipo).map((c) => Number(c.id.split("-")[1])));
        expect(board.contadores[tipo]).toBeGreaterThanOrEqual(maior);
      }
      // WIP: nada em DOING; DONE só com o que o repositório afirma estar decidido
      expect(board.cards.filter((c) => c.coluna === "doing")).toHaveLength(0);
      const feitos = board.cards.filter((c) => c.coluna === "done");
      expect(feitos.length).toBeGreaterThanOrEqual(1);
      for (const c of feitos) expect(c.origem.pedidoOriginal).toMatch(/^populate:adr:/);
    });

    it("cada fato tem evidência verificável: arquivo existe no repositório e a linha citada existe", async () => {
      const board = await lerBoardCru(tmp);
      const dimLinhas = new Map<string, number>();
      for (const c of gerenciados(board)) {
        for (const rel of c.ingestao.fontePath) {
          // evidência do próprio app (README/lock) vive em apps/knowledge; o resto no repositório
          expect(existsSync(noDisco(rel)), `${c.id}: ${rel}`).toBe(true);
        }
        for (const m of c.descricao.matchAll(/`([A-Za-z0-9_.][^`\s]*?):(\d+)`/g)) {
          const rel = m[1];
          if (!existsSync(noDisco(rel))) continue;
          if (!dimLinhas.has(rel)) dimLinhas.set(rel, (await readFile(noDisco(rel), "utf8")).split("\n").length);
          expect(Number(m[2]), `${c.id}: ${rel}:${m[2]}`).toBeLessThanOrEqual(dimLinhas.get(rel)!);
        }
      }
    });

    it("referências quebradas só entram depois de confirmadas ausentes no disco (nenhum alvo existe)", async () => {
      const board = await lerBoardCru(tmp);
      const cards = gerenciados(board).filter((c) => c.origem.pedidoOriginal?.startsWith("populate:ref:alvo:"));
      expect(cards.length).toBeGreaterThanOrEqual(1);
      for (const c of cards) {
        const alvo = c.origem.pedidoOriginal!.slice("populate:ref:alvo:".length);
        expect(existsSync(path.join(REPO, alvo)), alvo).toBe(false);
      }
      // nenhum card afirma que um caminho "não existe" quando ele existe (o mega-brain muda: engine/paths.py
      // e engine/config.py, ausentes quando o módulo foi escrito, hoje existem)
      for (const c of gerenciados(board)) {
        for (const m of c.descricao.matchAll(/`([^`\s]+)`\s+\*\*não existe\*\*/g)) expect(existsSync(path.join(REPO, m[1])), `${c.id}: ${m[1]}`).toBe(false);
      }
      // o card agrupado dos imports só diz "têm card próprio" de módulos que ganharam card nesta execução
      const imports = gerenciados(board).find((c) => c.origem.pedidoOriginal === "populate:ref:imports-ausentes");
      const comCard = imports?.descricao.match(/têm card próprio: (.+)\.$/m)?.[1].match(/`[^`]+`/g)?.map((x) => x.slice(1, -1)) ?? [];
      for (const a of comCard) {
        expect(existsSync(path.join(REPO, a)), a).toBe(false);
        expect(cards.some((c) => c.origem.pedidoOriginal === `populate:ref:alvo:${a}`), a).toBe(true);
      }
      expect(imports?.descricao ?? "").not.toMatch(/engine\/paths\.py`, `engine\/config\.py`, `engine\/memory_manager\.py`\) têm card/);
    });

    it("o card da busca semântica cita onde ESTE app documenta os embeddings, e só o que o documento diz", async () => {
      const board = await lerBoardCru(tmp);
      const card = gerenciados(board).find((c) => c.origem.pedidoOriginal === "populate:integracao:busca-semantica")!;
      expect(card).toBeTruthy();
      // o outlierhub não tem mais "## Embeddings" no README: a seção está em docs/provider-supabase.md
      const cit = card.descricao.match(/descreve o caminho dos embeddings \(`([^`:]+):(\d+)`\)/);
      expect(cit, card.descricao).toBeTruthy();
      const linhas = (await readFile(noDisco(cit![1]), "utf8")).split("\n");
      const ini = Number(cit![2]) - 1;
      expect(linhas[ini]).toMatch(/^##\s+Embeddings/);
      const fim = linhas.findIndex((l, i) => i > ini && /^##\s/.test(l));
      const secao = linhas.slice(ini, fim < 0 ? undefined : fim).join("\n");
      expect(secao).toMatch(/bge-m3/);
      if (/1024 dimensões/.test(card.descricao)) expect(secao).toMatch(/1024 dimens/);
      if (/BILHON_EMBED_MODEL/.test(card.descricao.split("## Pendente")[0])) expect(secao).toMatch(/BILHON_EMBED_MODEL/);
      expect(card.descricao).not.toMatch(/README do app descreve/);
      // o limite declarado do provider local vem do próprio documento, na linha citada
      const local = card.descricao.match(/lexical, sem embeddings; a busca semântica fica com o provider `supabase` \(`([^`:]+):(\d+)`\)/);
      if (existsSync(path.join(APP, "docs", "provider-local.md"))) {
        expect(local).toBeTruthy();
        const l = (await readFile(noDisco(local![1]), "utf8")).split("\n")[Number(local![2]) - 1];
        expect(l).toMatch(/lexical, sem embeddings/i);
      }
    });

    it("é idempotente: rodar de novo não muda um byte do board, do mapa de ids nem do primeiro-uso.json", async () => {
      const arquivos = [path.join(tmp, "kanban", "board.json"), path.join(tmp, "kanban", ".populate-ids.json"), path.join(tmp, "primeiro-uso.json")];
      const antes = (await Promise.all(arquivos.map((f) => readFile(f)))).map(sha);
      const r = await runKanban(ctxDe(tmp));
      const pu = await semVariavel(() => responderPrimeiroUso({ appRoot: APP, dataDir: tmp, repoRoot: REPO, resultados: todosOk() }));
      const depois = (await Promise.all(arquivos.map((f) => readFile(f)))).map(sha);
      expect(depois).toEqual(antes);
      expect(r.resumo).toMatchObject({ criados: 0, atualizados: 0, removidos: 0 });
      // o kanban não responde mais o primeiro uso; a resposta do fim da população fica como estava
      expect(r.resumo).not.toHaveProperty("primeiroUso");
      expect(pu.resumo).toMatchObject({ acao: "mantido", estado: "aceito" });
    });

    it("id do mapa já usado por outro card (board recriado pelo app): o card gerenciado volta com id novo, sem duplicar", async () => {
      const d = await copiaDoBoard();
      const arq = path.join(d, "kanban", "board.json");
      const arqMapa = path.join(d, "kanban", ".populate-ids.json");
      const b = await lerBoardCru(d);
      const mapa = JSON.parse(await readFile(arqMapa, "utf8")) as { cards: Record<string, { id: string; retirado?: boolean }> };
      const alvo = gerenciados(b).find((c) => c.coluna === "todo")!;
      const chave = alvo.origem.pedidoOriginal!.slice("populate:".length);
      // o fato sumiu numa execução anterior (card retirado) e, nesse meio-tempo, o app deu o mesmo id a um card dele
      mapa.cards[chave].retirado = true;
      const doApp = { ...structuredClone(alvo), titulo: "Card do app com o mesmo id", tags: ["meu"], origem: { canal: "kanban", pedidoOriginal: "x", solicitadoPor: null } } as KanbanCard;
      b.cards = b.cards.map((c) => (c.id === alvo.id ? doApp : c));
      await writeFile(arq, JSON.stringify(b, null, 1));
      await writeFile(arqMapa, JSON.stringify(mapa, null, 2));

      const r = await runKanban(ctxDe(d));
      const depois = await lerBoardCru(d);
      const ids = depois.cards.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(depois.cards.find((c) => c.id === alvo.id)?.titulo).toBe("Card do app com o mesmo id");
      const recriado = depois.cards.find((c) => c.origem.pedidoOriginal === alvo.origem.pedidoOriginal)!;
      expect(recriado.id).not.toBe(alvo.id);
      expect(recriado.id.startsWith(`${PREFIXO_POPULATE[alvo.tipo]}-`)).toBe(true);
      expect(r.resumo).toMatchObject({ criados: 1 });
      expect(r.avisos.some((a: string) => a.includes(alvo.id) && /outro card/.test(a))).toBe(true);
      expect((JSON.parse(await readFile(arqMapa, "utf8")) as typeof mapa).cards[chave].id).toBe(recriado.id);
      // o leitor real aceita o board e o contador cobre o id novo
      const board = await (await kanbanLib(d)).getBoard();
      expect(board.cards).toHaveLength(depois.cards.length);
      expect(board.contadores[alvo.tipo]).toBeGreaterThanOrEqual(Number(recriado.id.split("-")[1]));
    });

    it("o app consegue ESCREVER depois: cria, edita, move e exclui sem corromper — e a repopulação preserva tudo isso", async () => {
      const d = await novoTmp();
      await cp(path.join(tmp, "kanban"), path.join(d, "kanban"), { recursive: true });
      const lib = await kanbanLib(d);
      const antes = await lib.getBoard();
      const gerAntes = gerenciados(antes);
      const [editado, movido, apagado, intocado] = gerAntes.filter((c) => c.coluna === "todo");
      expect(intocado).toBeTruthy();

      // usuário cria um card à mão, edita, move e exclui cards gerenciados
      const meu = await lib.criarCard({ titulo: "Card do usuário", tipo: "feature", descricao: "criado à mão", prioridade: "alta", origem: { canal: "terminal" } });
      expect(meu.id).toMatch(/^FEA-\d+$/);
      expect(antes.cards.some((c) => c.id === meu.id)).toBe(false);
      const ed = await lib.atualizarCard(editado.id, { prioridade: editado.prioridade === "alta" ? "baixa" : "alta", titulo: "Título editado pelo usuário" });
      expect(ed.ok).toBe(true);
      const mv = await lib.moverCard(movido.id, "doing", 0);
      expect(mv.ok).toBe(true);
      expect(await lib.excluirCard(apagado.id)).toBe(true);

      // o board continua legível e coerente
      const meio = await lib.getBoard();
      expect(meio.cards.length).toBe(antes.cards.length + 1 - 1);

      // repopula: nada do usuário se perde e nada gerenciado reaparece/duplica
      const r = await runKanban(ctxDe(d));
      const depois = await lerBoardCru(d);
      expect(depois.cards.find((c) => c.id === meu.id)?.titulo).toBe("Card do usuário");
      const ed2 = depois.cards.find((c) => c.id === editado.id)!;
      expect(ed2.titulo).toBe("Título editado pelo usuário");
      expect(ed2.prioridade).not.toBe(editado.prioridade);
      expect(depois.cards.find((c) => c.id === movido.id)?.coluna).toBe("doing");
      expect(depois.cards.some((c) => c.id === apagado.id)).toBe(false);
      expect(depois.cards.some((c) => c.origem.pedidoOriginal === apagado.origem.pedidoOriginal)).toBe(false);
      // (a `ordem` é renumerada pelo próprio app ao mover/excluir cards da coluna; o resto fica igual)
      const semOrdem = (c: KanbanCard | undefined) => ({ ...c, ordem: 0 });
      expect(semOrdem(depois.cards.find((c) => c.id === intocado.id))).toEqual(semOrdem(intocado));
      const ids = depois.cards.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(r.resumo).toMatchObject({ criados: 0, removidos: 0, preservados: 1, apagadosPeloUsuario: 1 });

      // o app continua escrevendo depois da repopulação
      const outro = await lib.criarCard({ titulo: "Segundo card do usuário", tipo: "feature" });
      expect(Number(outro.id.split("-")[1])).toBeGreaterThan(Number(meu.id.split("-")[1]));
      expect(new Set((await lib.getBoard()).cards.map((c) => c.id)).size).toBe(depois.cards.length + 1);
    });

    it("fato que some do repositório: card intocado sai; card mexido pelo usuário fica; id nunca é reaproveitado", async () => {
      const d = await novoTmp();
      await cp(path.join(tmp, "kanban"), path.join(d, "kanban"), { recursive: true });
      const lib = await kanbanLib(d);
      const antes = await lib.getBoard();
      const dosThresholds = antes.cards.filter((c) => c.origem.pedidoOriginal?.startsWith("populate:marcador:threshold:"));
      expect(dosThresholds.length).toBeGreaterThanOrEqual(3);
      const mexido = dosThresholds[0];
      expect((await lib.moverCard(mexido.id, "doing", 0)).ok).toBe(true);
      const idsVistos = new Set(antes.cards.map((c) => c.id));

      const semThresholds = docs.filter((x) => !x.rel.endsWith("pipeline/config/thresholds.yaml"));
      const r = await runKanban(ctxDe(d, semThresholds));
      const depois = await lerBoardCru(d);
      const restantes = depois.cards.filter((c) => c.origem.pedidoOriginal?.startsWith("populate:marcador:threshold:"));
      expect(restantes.map((c) => c.id)).toEqual([mexido.id]);
      expect(r.resumo).toMatchObject({ removidos: dosThresholds.length - 1, obsoletosMantidos: 1 });

      // o fato volta: os cards removidos retornam com o MESMO id; contadores não regridem
      await runKanban(ctxDe(d));
      const volta = await lerBoardCru(d);
      for (const c of dosThresholds) expect(volta.cards.some((x: KanbanCard) => x.id === c.id)).toBe(true);
      for (const c of volta.cards) if (!idsVistos.has(c.id)) throw new Error(`id novo inesperado: ${c.id}`);
    });

    it("board.json ilegível NUNCA é sobrescrito", async () => {
      const d = await novoTmp();
      await mkdir(path.join(d, "kanban"), { recursive: true });
      const lixo = '{"cards": [ não é json';
      await writeFile(path.join(d, "kanban", "board.json"), lixo);
      await expect(runKanban(ctxDe(d))).rejects.toThrow(/ilegível/);
      expect(await readFile(path.join(d, "kanban", "board.json"), "utf8")).toBe(lixo);
    });

    /** Copia o board populado para um diretório novo e devolve o caminho. */
    async function copiaDoBoard() {
      const d = await novoTmp();
      await cp(path.join(tmp, "kanban"), path.join(d, "kanban"), { recursive: true });
      return d;
    }
    const diaLocal = () => {
      const x = new Date();
      const dois = (n: number) => String(n).padStart(2, "0");
      return `${x.getFullYear()}${dois(x.getMonth() + 1)}${dois(x.getDate())}`;
    };

    it("card gravado pelo app DURANTE a varredura dos fatos não se perde, e o snapshot do dia guarda o estado anterior", async () => {
      const d = await copiaDoBoard();
      const arq = path.join(d, "kanban", "board.json");
      const arqMapa = path.join(d, "kanban", ".populate-ids.json");
      // força uma escrita do populate: um card gerenciado some do board e do mapa (será recriado)
      const b0 = JSON.parse(await readFile(arq, "utf8")) as KanbanBoard;
      const mapa0 = JSON.parse(await readFile(arqMapa, "utf8")) as { cards: Record<string, unknown> };
      const sumido = b0.cards.pop()!;
      delete mapa0.cards[sumido.origem.pedidoOriginal!.slice("populate:".length)];
      await writeFile(arq, JSON.stringify(b0, null, 1));
      await writeFile(arqMapa, JSON.stringify(mapa0, null, 2));

      // o "app" grava um card do usuário (tmp + rename, como lib/kanban.ts) no instante em que o populate
      // varre os documentos — a fase lenta que antes ficava ENTRE a leitura e a gravação do board
      let gravou = false;
      const docsComApp = Object.assign([...docs], {
        map(...args: unknown[]) {
          if (!gravou) {
            gravou = true;
            const b = JSON.parse(readFileSync(arq, "utf8")) as KanbanBoard;
            b.cards.push({ ...structuredClone(b.cards[0]), id: "FEA-99", titulo: "Card do usuário durante o populate", origem: { canal: "terminal", pedidoOriginal: "x", solicitadoPor: "eu" } } as KanbanCard);
            b.contadores.feature = Math.max(b.contadores.feature, 99);
            writeFileSync(`${arq}.tmp-app`, JSON.stringify(b, null, 1));
            renameSync(`${arq}.tmp-app`, arq);
          }
          return (Array.prototype.map as (...a: unknown[]) => unknown).apply(this, args);
        },
      }) as unknown as Doc[];

      const r = await runKanban(ctxDe(d, docsComApp));
      expect(gravou).toBe(true);
      expect(r.resumo).toMatchObject({ criados: 1 });
      const depois = await (await kanbanLib(d)).getBoard();
      expect(depois.cards.find((c) => c.id === "FEA-99")?.titulo).toBe("Card do usuário durante o populate");
      expect(depois.cards.some((c) => c.origem.pedidoOriginal === sumido.origem.pedidoOriginal)).toBe(true);
      expect(depois.contadores.feature).toBeGreaterThanOrEqual(99);

      // snapshot do dia = o board exatamente como estava ANTES da sobrescrita (mesma regra de lib/kanban.ts):
      // já com o card que o app gravou, e ainda sem o card gerenciado que o populate recriou
      const snap = path.join(d, "kanban", "backups", `board-${diaLocal()}.json`);
      const noSnapshot = JSON.parse(await readFile(snap, "utf8")) as KanbanBoard;
      expect(noSnapshot.cards.some((c) => c.id === "FEA-99")).toBe(true);
      expect(noSnapshot.cards.some((c) => c.id === sumido.id)).toBe(false);
      expect(noSnapshot.cards).toHaveLength(b0.cards.length + 1);
      // sem arquivo temporário sobrando
      expect(readdirSync(path.join(d, "kanban")).filter((f) => f.includes(".tmp"))).toEqual([]);
      // rodar de novo não muda nada nem cria outro snapshot
      const hash = sha(await readFile(arq));
      await runKanban(ctxDe(d));
      expect(sha(await readFile(arq))).toBe(hash);
      expect(readdirSync(path.join(d, "kanban", "backups"))).toEqual([`board-${diaLocal()}.json`]);
    });

    it("apagar o ÚLTIMO card gerenciado (ou limpar o board) não recria nada; só board novo/zerado recria, com os mesmos ids", async () => {
      const d = await copiaDoBoard();
      const arq = path.join(d, "kanban", "board.json");
      const antes = await lerBoardCru(d);
      const total = antes.cards.length;
      const idsAntes = antes.cards.map((c) => c.id).sort();
      const grava = (b: KanbanBoard) => writeFile(arq, JSON.stringify(b, null, 1));

      // usuário apaga TODOS os cards (contadores ficam, como no app): nada volta
      await grava({ ...antes, cards: [] });
      const r1 = await runKanban(ctxDe(d));
      expect(r1.resumo).toMatchObject({ criados: 0, apagadosPeloUsuario: total });
      expect((await lerBoardCru(d)).cards).toHaveLength(0);
      expect(r1.avisos.some((a) => /apagados pelo usuário/.test(a) && /\.populate-ids\.json/.test(a))).toBe(true);

      // o mesmo vale quando sobra um só e o usuário apaga o último
      await grava({ ...antes, cards: [antes.cards[0]] });
      await runKanban(ctxDe(d));
      const so1 = await lerBoardCru(d);
      so1.cards = [];
      await grava(so1);
      const r2 = await runKanban(ctxDe(d));
      expect(r2.resumo).toMatchObject({ criados: 0 });
      expect((await lerBoardCru(d)).cards).toHaveLength(0);

      // board zerado de verdade (cards vazios E contadores zerados): nunca esteve neste board → recria
      const zerado = await lerBoardCru(d);
      for (const k of Object.keys(zerado.contadores)) zerado.contadores[k as keyof typeof zerado.contadores] = 0;
      await grava(zerado);
      const r3 = await runKanban(ctxDe(d));
      expect(r3.resumo).toMatchObject({ criados: total, apagadosPeloUsuario: 0 });
      expect((await lerBoardCru(d)).cards.map((c) => c.id).sort()).toEqual(idsAntes);

      // board.json ausente (reset) com o mapa antigo: recria tudo com os mesmos ids
      await rm(arq);
      const r4 = await runKanban(ctxDe(d));
      expect(r4.resumo).toMatchObject({ criados: total });
      expect((await lerBoardCru(d)).cards.map((c) => c.id).sort()).toEqual(idsAntes);

      // a saída documentada para recriar de propósito: remover o mapa de ids (sem duplicar ids)
      const b = await lerBoardCru(d);
      await grava({ ...b, cards: [] });
      await rm(path.join(d, "kanban", ".populate-ids.json"));
      const r5 = await runKanban(ctxDe(d));
      expect(r5.resumo).toMatchObject({ criados: total });
      const ids5 = (await lerBoardCru(d)).cards.map((c) => c.id);
      expect(new Set(ids5).size).toBe(ids5.length);
    });

    it("o card do Chronicler só afirma o que o arquivo diz: dados fixos no próprio arquivo, declarados reais (não 'de exemplo')", async () => {
      const board = await lerBoardCru(tmp);
      const card = gerenciados(board).find((c) => c.origem.pedidoOriginal === "populate:marcador:chronicler-cost-tracker")!;
      expect(card).toBeTruthy();
      const rel = ".claude/skills/chronicler/chronicler_v4_render.py";
      expect(card.descricao).not.toMatch(/de exemplo/);
      expect(card.descricao).toMatch(/dados fixos escritos no próprio arquivo/);
      expect(card.descricao).toMatch(/a docstring os declara reais/);
      // a linha citada para a declaração existe e diz mesmo que os dados são reais
      const citada = card.descricao.match(/a docstring os declara reais \(`[^`:]+:(\d+)`\)/);
      expect(citada).toBeTruthy();
      const linhas = (await readFile(path.join(REPO, rel), "utf8")).split("\n");
      expect(linhas[Number(citada![1]) - 1]).toMatch(/full render driver \(real .+ data\)/);
    });
  });

  // Só um data/ gerado pelo populate (data/.populated.json com o módulo ok): sem população, o board.json e as
  // referências são do próprio usuário (ou o demo) e não têm por que seguir o que a população garante.
  describe.skipIf(!POPULADOS.has("kanban") || !existsSync(path.join(DATA_REAL, "kanban", "board.json")))("dados reais já populados em data/ (somente leitura)", () => {
    it("o leitor real enxerga o board de data/ sem rejeitar nada e a pergunta de primeiro uso está respondida", async () => {
      const lib = await kanbanLib(DATA_REAL);
      const board = await lib.getBoard();
      const por = (campo: "coluna" | "tipo" | "prioridade") =>
        Object.fromEntries(Object.entries(board.cards.reduce<Record<string, number>>((a, c) => ((a[c[campo]] = (a[c[campo]] ?? 0) + 1), a), {})).sort());
      expect(new Set(board.cards.map((c) => c.id)).size).toBe(board.cards.length);
      expect(board.cards.every((c) => lib.cardIdValido(c.id))).toBe(true);
      // a pergunta de primeiro uso já está respondida (a resposta do app ou a da população)
      const pu = await (await import("@/lib/primeiro-uso")).lerEstado();
      expect(pu.megabrain.estado).not.toBe("pendente");
      console.log(`[real] primeiro-uso: estado=${pu.megabrain.estado} cardId=${pu.megabrain.cardId}`);
      // saída lida pelo relatório de quem rodou a população
      console.log(`[real] kanban: ${board.cards.length} cards | colunas ${JSON.stringify(por("coluna"))} | tipos ${JSON.stringify(por("tipo"))} | prioridades ${JSON.stringify(por("prioridade"))} | contadores ${JSON.stringify(board.contadores)}`);
    });

    it.skipIf(!POPULADOS.has("referencias"))("o leitor real enxerga as referências de data/, não o demo", async () => {
      const refs = await (await referenciasLib(DATA_REAL)).getReferencias();
      expect(refs.fonte).not.toBe("demo");
      console.log(`[real] referencias: fonte=${refs.fonte} posts=${refs.posts.length} colecoes=${refs.colecoes.length} imagens=${refs.posts.reduce((a, p) => a + p.images.length, 0)}`);
    });

    // quantos cards o corpus rende depende do mega-brain: o patamar é o desta distribuição
    it.skipIf(!E2E)("conteúdo desta distribuição (POPULATE_E2E=1): o board tem ao menos 20 cards", async () => {
      const board = await (await kanbanLib(DATA_REAL)).getBoard();
      expect(board.cards.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe("referências (lib/referencias.ts)", () => {
    it("o app enxerga o índice real (não o demo) com o post de identidade visual e mídias servíveis", async () => {
      const lib = await referenciasLib(tmp);
      const r = await lib.getReferencias();
      expect(r.fonte).toBe("mega-brain");
      expect(r.fonte).not.toBe("demo");
      expect(r.posts.map((p) => p.code)).toContain("mega-brain-identidade");
      const p = r.posts.find((x) => x.code === "mega-brain-identidade")!;
      expect(p.images.length).toBeGreaterThanOrEqual(1);
      expect(p.videoIdx).toEqual([]);
      expect(p.igUrl).toMatch(/^https:\/\/.+\/tree\/main\/\.github\/assets$/);
      expect(p.igUrl).not.toMatch(/@/); // sem credenciais no remote
      expect(r.colecoes.find((c) => c.nome === p.colecoes[0])?.n).toBe(1);
      expect(r.posts.every((x) => x.code !== "demo001")).toBe(true);
      for (const img of p.images) {
        expect(img).not.toMatch(/[/\\]/);
        const abs = lib.imagePathFor(p.dir, img);
        expect(abs, img).not.toBeNull();
        expect(existsSync(abs!)).toBe(true);
        expect(abs!.startsWith(lib.REFS_DIR + path.sep)).toBe(true);
        // a rota de miniatura devolve o original com MIME de imagem (sem .thumbs)
        const t = await lib.thumbPathFor(p.dir, img);
        expect(t?.mime).toMatch(/^image\//);
        // mesma imagem que está no repositório
        expect(sha(await readFile(abs!))).toBe(sha(await readFile(path.join(REPO, ".github", "assets", img))));
      }
      expect(p.checksum).toMatch(/^[0-9a-f]{64}$/); // hashes.json lido pelo app
    });

    it("não serve SVG (a rota responde 400) e por isso nenhum SVG entra no post", async () => {
      const lib = await referenciasLib(tmp);
      const p = (await lib.getReferencias()).posts.find((x) => x.code === "mega-brain-identidade")!;
      expect(p.images.some((i) => /\.svg$/i.test(i))).toBe(false);
      const rota = await readFile(path.join(APP, "app", "api", "referencias", "[dir]", "[img]", "route.ts"), "utf8");
      expect(rota).not.toMatch(/svg/i);
      // outlierhub: a rota decide o MIME por `mimeReal` (primeiros bytes, senão MIME_POR_EXT); SVG não tem nenhum dos dois
      const assets = path.join(REPO, ".github", "assets");
      for (const svg of readdirSync(assets).filter((f) => /\.svg$/i.test(f))) {
        expect(await lib.mimeReal(path.join(assets, svg)), svg).toBeNull();
      }
      expect(extensoesServidas(APP)).not.toContain("svg");
    });

    it("as extensões servidas vêm do código do app: MIME_POR_EXT de lib/referencias.ts (outlierhub) ou o mapa da rota (template antigo)", async () => {
      // a rota do outlierhub não tem mais o mapa: sem ler o lib, o módulo caía no padrão em silêncio
      const rota = await readFile(path.join(APP, "app", "api", "referencias", "[dir]", "[img]", "route.ts"), "utf8");
      expect(rota).not.toMatch(/\{\s*jpg:/);
      expect(extensoesServidas(APP)).toEqual(["jpg", "jpeg", "png", "webp", "heic"]);
      const d = await novoTmp();
      await mkdir(path.join(d, "lib"), { recursive: true });
      await writeFile(path.join(d, "lib", "referencias.ts"), 'const MIME_POR_EXT: Record<string, string> = {\n  png: "image/png",\n};\n');
      expect(extensoesServidas(d)).toEqual(["png"]);
      const e = await novoTmp();
      const dirRota = path.join(e, "app", "api", "referencias", "[dir]", "[img]");
      await mkdir(dirRota, { recursive: true });
      await writeFile(path.join(dirRota, "route.ts"), 'const mime = { jpg: "image/jpeg", webp: "image/webp" }[ext];\n');
      expect(extensoesServidas(e)).toEqual(["jpg", "webp"]);
    });

    it("é idempotente e preserva o estado do usuário (favoritos, posts próprios, vídeos baixados)", async () => {
      const d = await novoTmp();
      await cp(path.join(tmp, "referencias-instagram"), path.join(d, "referencias-instagram"), { recursive: true });
      const dir = path.join(d, "referencias-instagram");
      const ler = async (f: string) => (existsSync(path.join(dir, f)) ? sha(await readFile(path.join(dir, f))) : null);

      const antes = [await ler("referencias.json"), await ler("hashes.json"), await ler(".populate-managed.json")];
      await runReferencias(ctxDe(d));
      expect([await ler("referencias.json"), await ler("hashes.json"), await ler(".populate-managed.json")]).toEqual(antes);

      // estado do usuário: favorito pelo app, post próprio, vídeo baixado no nosso post, hash alheio
      const lib = await referenciasLib(d);
      await lib.setFavorito("mega-brain-identidade", true);
      const idx = JSON.parse(await readFile(path.join(dir, "referencias.json"), "utf8"));
      idx.posts.push({ code: "meu-post", user: "eu", caption: "meu", igUrl: "https://example.com/p", dir: "meu-post", images: ["a.png"], videoIdx: [], colecoes: ["Minhas"] });
      idx.colecoes.push({ id: "minhas", nome: "Minhas", n: 1 });
      idx.posts.find((p: { code: string }) => p.code === "mega-brain-identidade").videos = [{ idx: 1, file: "01.mp4" }];
      await writeFile(path.join(dir, "referencias.json"), JSON.stringify(idx));
      const hashes = JSON.parse(await readFile(path.join(dir, "hashes.json"), "utf8"));
      hashes.porPost["meu-post"] = { checksum: "abc" };
      await writeFile(path.join(dir, "hashes.json"), JSON.stringify(hashes));
      await writeFile(path.join(dir, "antipatterns.json"), JSON.stringify({ x: { em: "2026-01-01T00:00:00.000Z", motivo: null } }));

      await runReferencias(ctxDe(d));
      const lib2 = await referenciasLib(d);
      const r = await lib2.getReferencias();
      expect(Object.keys(r.favoritos)).toContain("mega-brain-identidade");
      expect(Object.keys(r.antipatterns)).toEqual(["x"]);
      expect(r.posts.map((p) => p.code).sort()).toEqual(["mega-brain-identidade", "meu-post"]);
      expect(r.posts.find((p) => p.code === "mega-brain-identidade")?.videos).toEqual([{ idx: 1, file: "01.mp4" }]);
      expect(r.colecoes.map((c) => c.nome).sort()).toEqual(["Identidade visual", "Minhas"]);
      expect(JSON.parse(await readFile(path.join(dir, "hashes.json"), "utf8")).porPost["meu-post"]).toEqual({ checksum: "abc" });
    });

    it("referencias.json ilegível NUNCA é sobrescrito", async () => {
      const d = await novoTmp();
      await mkdir(path.join(d, "referencias-instagram"), { recursive: true });
      await writeFile(path.join(d, "referencias-instagram", "referencias.json"), "{ quebrado");
      await expect(runReferencias(ctxDe(d))).rejects.toThrow(/ilegível/);
      expect(await readFile(path.join(d, "referencias-instagram", "referencias.json"), "utf8")).toBe("{ quebrado");
    });
  });

  describe("primeiro uso (lib/primeiro-uso.ts e GET /api/primeiro-uso)", () => {
    const TS = "2026-10-27T12:00:00.000Z";
    const boardDe = (cards: Partial<KanbanCard>[] = []) => ({ cards }) as unknown as KanbanBoard;
    /** Estado gravado pelo app quando a pessoa respondeu "Agora não" (o data/ que veio do backup). */
    const DISPENSADO = JSON.stringify({ versao: 1, megabrain: { estado: "dispensado", cardId: null, atualizadoEm: "2026-10-16T10:10:57.213Z" } }, null, 1);

    /** `<tmp>/mb/apps/knowledge` com `data/` (e o primeiro-uso.json, se dado). */
    async function layout(conteudo?: string, pastaApps = "apps") {
      const d = await novoTmp();
      const mb = path.join(d, "mb");
      const app = path.join(mb, pastaApps, "knowledge");
      const data = path.join(app, "data");
      await mkdir(data, { recursive: true });
      const arq = path.join(data, "primeiro-uso.json");
      if (conteudo !== undefined) await writeFile(arq, conteudo);
      return { mb, app, data, arq };
    }
    /** O leitor do app lê `<cwd>/data/primeiro-uso.json`: recarrega o módulo com o cwd do app do teste. */
    async function primeiroUsoLib(appDir: string) {
      vi.spyOn(process, "cwd").mockReturnValue(appDir);
      vi.resetModules();
      return await import("@/lib/primeiro-uso");
    }

    it("a tag que marca o card de primeiro uso é a do app", async () => {
      const lib = await import("@/lib/primeiro-uso");
      expect(TAG_CARD_PRIMEIRO_USO).toBe(lib.TAG_CARD_MEGABRAIN);
    });

    it("depois da população a pergunta está respondida (aceito, sem card) e o app não pergunta mais", async () => {
      // o app mora em <mega-brain>/apps/knowledge: é exatamente o Megabrain que foi lido
      expect(raizDetectadaPeloApp(APP)).toMatchObject({ raiz: REPO });
      const salvo = JSON.parse(await readFile(path.join(tmp, "primeiro-uso.json"), "utf8"));
      expect(salvo).toMatchObject({ versao: 1, megabrain: { estado: "aceito", cardId: null } });
      expect(Number.isNaN(Date.parse(salvo.megabrain.atualizadoEm))).toBe(false);
      // o populate não cria o card de primeiro uso (nem afirma DONE de uma população ainda em curso)
      expect((await lerBoardCru(tmp)).cards.some((c) => c.tags.includes(TAG_CARD_PRIMEIRO_USO))).toBe(false);

      // a rota real: Megabrain detectado, pergunta já respondida, inventário vazio (o modal só abre com "pendente")
      const fake = await novoTmp();
      await mkdir(path.join(fake, "data"), { recursive: true });
      await cp(path.join(tmp, "primeiro-uso.json"), path.join(fake, "data", "primeiro-uso.json"));
      vi.stubEnv("BILHON_MEGABRAIN_ROOT", REPO);
      vi.stubEnv("BILHON_KANBAN_DIR", path.join(tmp, "kanban"));
      vi.spyOn(process, "cwd").mockReturnValue(fake);
      vi.resetModules();
      const { GET } = await import("@/app/api/primeiro-uso/route");
      const j = (await (await GET()).json()) as { megabrain: Record<string, unknown> };
      expect(j.megabrain).toMatchObject({ detectado: true, estado: "aceito", cardId: null, inventario: [] });
    });

    it("card que o app já criou ('preparar') antes da população: é mantido intocado e referenciado; nada se duplica", async () => {
      const raiz = await novoTmp();
      const data = path.join(raiz, "data");
      await cp(path.join(tmp, "kanban"), path.join(data, "kanban"), { recursive: true });
      vi.stubEnv("BILHON_MEGABRAIN_ROOT", REPO);
      vi.stubEnv("BILHON_KANBAN_DIR", path.join(data, "kanban"));
      const lib = await primeiroUsoLib(raiz);
      const det = lib.detectarMegabrain();
      expect(det.detectado).toBe(true);
      // o que o app faz ao abrir com a pergunta pendente
      const id = await lib.garantirCardMegabrain(det);
      await lib.gravarEstado("pendente", id);
      const antes = (await lerBoardCru(data)).cards.find((c) => c.id === id)!;
      expect(antes.coluna).toBe("todo");

      // o kanban só prepara o board: a pergunta continua pendente até o fim da população
      const r = await runKanban(ctxDe(data));
      expect(r.resumo).toMatchObject({ criados: 0 });
      expect(r.resumo).not.toHaveProperty("primeiroUso");
      expect(await lib.lerEstado()).toMatchObject({ megabrain: { estado: "pendente", cardId: id } });
      // populate.mjs, depois de todos os módulos ok, responde com o card que o app criou (lido do board no disco);
      // o BILHON_MEGABRAIN_ROOT deste processo leva à mesma raiz que o app detecta: não há divergência
      const pu = await responderPrimeiroUso({ appRoot: APP, dataDir: data, repoRoot: REPO, resultados: todosOk() });
      expect(pu.resumo).toEqual({ acao: "respondido", estado: "aceito", cardId: id });
      expect(pu.avisos.some((a: string) => a.includes(id) && /CANCEL/.test(a))).toBe(true);
      expect(await lib.lerEstado()).toMatchObject({ megabrain: { estado: "aceito", cardId: id } });
      const depois = await lerBoardCru(data);
      expect(depois.cards.find((c) => c.id === id)).toEqual(antes);
      expect(depois.cards.filter((c) => c.tags.includes(TAG_CARD_PRIMEIRO_USO))).toHaveLength(1);
      expect(new Set(depois.cards.map((c) => c.id)).size).toBe(depois.cards.length);

      // repopular não mexe mais no estado (resposta dada) nem no card
      const bytes = await readFile(path.join(data, "primeiro-uso.json"), "utf8");
      await runKanban(ctxDe(data));
      const pu2 = await responderPrimeiroUso({ appRoot: APP, dataDir: data, repoRoot: REPO, resultados: todosOk() });
      expect(pu2.resumo).toEqual({ acao: "mantido", estado: "aceito", cardId: id });
      expect(await readFile(path.join(data, "primeiro-uso.json"), "utf8")).toBe(bytes);
      expect((await lerBoardCru(data)).cards.find((c) => c.id === id)).toEqual(antes);
    });

    it("pergunta pendente ou sem arquivo vira 'aceito'; resposta já dada (o 'dispensado' do backup) nunca é tocada", async () => {
      await semVariavel(async () => {
        // sem arquivo: responde e o leitor real enxerga
        const a = await layout();
        const r1 = await responderPrimeiroUso({ appRoot: a.app, dataDir: a.data, repoRoot: a.mb, board: boardDe(), ts: TS, resultados: todosOk() });
        expect(r1.resumo).toEqual({ acao: "respondido", estado: "aceito", cardId: null });
        expect(JSON.parse(await readFile(a.arq, "utf8"))).toEqual({ versao: 1, megabrain: { estado: "aceito", cardId: null, atualizadoEm: TS } });
        expect(await (await primeiroUsoLib(a.app)).lerEstado()).toEqual({ versao: 1, megabrain: { estado: "aceito", cardId: null, atualizadoEm: TS } });
        // idempotente: a segunda vez não grava
        const bytes = await readFile(a.arq, "utf8");
        const r2 = await responderPrimeiroUso({ appRoot: a.app, dataDir: a.data, repoRoot: a.mb, board: boardDe(), ts: "2030-01-01T00:00:00.000Z", resultados: todosOk() });
        expect(r2.resumo).toEqual({ acao: "mantido", estado: "aceito", cardId: null });
        expect(await readFile(a.arq, "utf8")).toBe(bytes);

        // pendente com o id de um card que a pessoa apagou: sem card, cardId null (o app recria se reabrir)
        const p = await layout(JSON.stringify({ versao: 1, megabrain: { estado: "pendente", cardId: "ING-9", atualizadoEm: TS } }));
        const rp = await responderPrimeiroUso({ appRoot: p.app, dataDir: p.data, repoRoot: p.mb, board: boardDe(), ts: TS, resultados: todosOk() });
        expect(rp.resumo).toMatchObject({ acao: "respondido", cardId: null });
        expect(rp.avisos).toEqual([]);

        // dispensado (o data/ que veio do backup) e aceito: intocados, byte a byte
        for (const conteudo of [DISPENSADO, JSON.stringify({ versao: 1, megabrain: { estado: "aceito", cardId: "ING-3", atualizadoEm: TS } })]) {
          const x = await layout(conteudo);
          const card = { id: "ING-3", coluna: "todo", titulo: "t", tags: [TAG_CARD_PRIMEIRO_USO] } as Partial<KanbanCard>;
          const r = await responderPrimeiroUso({ appRoot: x.app, dataDir: x.data, repoRoot: x.mb, board: boardDe([card]), ts: TS, resultados: todosOk() });
          expect(r.resumo.acao).toBe("mantido");
          expect(r.avisos).toEqual([]);
          expect(await readFile(x.arq, "utf8")).toBe(conteudo);
        }
        expect((await (await primeiroUsoLib(a.app)).lerEstado()).megabrain.estado).toBe("aceito");
      });
    });

    it("módulo com falha (antes ou depois do kanban), não implementado ou sem resultado: não responde (a pergunta continua pendente)", async () => {
      await semVariavel(async () => {
        const x = await layout();
        const responder = (resultados: Record<string, unknown>) =>
          responderPrimeiroUso({ appRoot: x.app, dataDir: x.data, repoRoot: x.mb, board: boardDe(), ts: TS, resultados });
        // `grafo` roda antes do kanban; `busca`, depois: as duas falhas seguram a resposta
        const r = await responder({ ...todosOk(), grafo: { ok: false, erro: "sqlite3 ausente" }, busca: { ok: false, erro: "índice ilegível" } });
        expect(r.resumo).toEqual({ acao: "populacao-com-falha", modulos: ["grafo", "busca"] });
        expect(r.avisos.join(" ")).toMatch(/grafo: falhou, busca: falhou/);
        expect(existsSync(x.arq)).toBe(false);
        // "não implementado" (módulo sem arquivo) não é ok: a população não preencheu aquela tela
        const ni = await responder({ ...todosOk(), agente: { ok: false, motivo: "nao-implementado" } });
        expect(ni.resumo).toEqual({ acao: "populacao-com-falha", modulos: ["agente"] });
        expect(ni.avisos.join(" ")).toMatch(/agente: não implementado/);
        // módulo sem resultado (não rodou)
        const sr = await responder(Object.fromEntries(Object.entries(todosOk()).filter(([m]) => m !== "ambiente")));
        expect(sr.resumo).toEqual({ acao: "populacao-com-falha", modulos: ["ambiente"] });
        expect(sr.avisos.join(" ")).toMatch(/ambiente: sem resultado/);
        expect(existsSync(x.arq)).toBe(false);
        // todos ok: responde
        expect((await responder(todosOk())).resumo.acao).toBe("respondido");
      });
    });

    it("arquivo ilegível ou de outro formato nunca é sobrescrito (o app volta a perguntar)", async () => {
      await semVariavel(async () => {
        for (const conteudo of ["{ quebrado", JSON.stringify({ versao: 2, megabrain: { estado: "pendente" } }), JSON.stringify({ versao: 1, megabrain: { estado: "talvez" } })]) {
          const x = await layout(conteudo);
          const r = await responderPrimeiroUso({ appRoot: x.app, dataDir: x.data, repoRoot: x.mb, board: boardDe(), ts: TS, resultados: todosOk() });
          expect(r.resumo.acao).toBe("ilegivel");
          expect(r.avisos.join(" ")).toMatch(/não foi sobrescrito/);
          expect(await readFile(x.arq, "utf8")).toBe(conteudo);
        }
        // uma pasta no lugar do arquivo (EISDIR)
        const y = await layout();
        await mkdir(y.arq);
        const r = await responderPrimeiroUso({ appRoot: y.app, dataDir: y.data, repoRoot: y.mb, board: boardDe(), ts: TS, resultados: todosOk() });
        expect(r.resumo.acao).toBe("ilegivel");
      });
    });

    it("só responde pelo Megabrain que o app detectaria: fora de apps/ não há pergunta; outro Megabrain não é respondido", async () => {
      await semVariavel(async () => {
        // fora de uma pasta "apps": o app nunca pergunta, nada é gravado
        const f = await layout(undefined, "projetos");
        const rf = await responderPrimeiroUso({ appRoot: f.app, dataDir: f.data, repoRoot: f.mb, board: boardDe(), ts: TS, resultados: todosOk() });
        expect(rf.resumo).toEqual({ acao: "sem-pergunta", motivo: "fora-de-apps" });
        expect(existsSync(f.arq)).toBe(false);

        // populate com --repo de OUTRO Megabrain: a pergunta do app é sobre o de cima de apps/
        const o = await layout();
        const outro = path.join(path.dirname(o.mb), "outro-mb");
        const ro = await responderPrimeiroUso({ appRoot: o.app, dataDir: o.data, repoRoot: outro, board: boardDe(), ts: TS, resultados: todosOk() });
        expect(ro.resumo.acao).toBe("outro-megabrain");
        expect(existsSync(o.arq)).toBe(false);

        // BILHON_MEGABRAIN_ROOT no .env.local do app (relativo à pasta do app) manda, como no `next dev`
        const e = await layout(undefined, "projetos");
        await writeFile(path.join(e.app, ".env.local"), "# raiz à mão\r\nBILHON_MEGABRAIN_ROOT=../..\r\n");
        expect(raizDetectadaPeloApp(e.app)).toEqual({ raiz: e.mb, motivo: "informada" });
        const re = await responderPrimeiroUso({ appRoot: e.app, dataDir: e.data, repoRoot: e.mb, board: boardDe(), ts: TS, resultados: todosOk() });
        expect(re.resumo.acao).toBe("respondido");
      });
      // só no ambiente do processo (o terminal do populate), apontando para outro lugar: o app, iniciado em outro
      // terminal, não vê essa variável; não responde e avisa (os .env* do app decidem o que ele pergunta)
      const x = await layout();
      vi.stubEnv("BILHON_MEGABRAIN_ROOT", path.join(path.dirname(x.mb), "outro-mb"));
      expect(raizDetectadaPeloApp(x.app)).toEqual({ raiz: x.mb, motivo: "pasta-apps" });
      for (const repoRoot of [x.mb, path.join(path.dirname(x.mb), "outro-mb")]) {
        const rx = await responderPrimeiroUso({ appRoot: x.app, dataDir: x.data, repoRoot, board: boardDe(), ts: TS, resultados: todosOk() });
        expect(rx.resumo).toEqual({ acao: "ambiente-divergente", variavel: "BILHON_MEGABRAIN_ROOT" });
        expect(rx.avisos.join(" ")).toMatch(/BILHON_MEGABRAIN_ROOT.*\.env\.local/);
      }
      expect(existsSync(x.arq)).toBe(false);
      // em branco = automático (pasta apps/)
      vi.stubEnv("BILHON_MEGABRAIN_ROOT", "");
      expect(raizDetectadaPeloApp(x.app)).toEqual({ raiz: x.mb, motivo: "pasta-apps" });
    });
  });
});
