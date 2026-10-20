// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { caminhoOrganizacao, lerOrganizacao, normalizarOrganizacao } from "./organizacao";

const bruto = {
  pilares: [
    { id: "p1", nome: "Vendas", tagline: "Funil", ordem: 2, cor: "#ff0000", icone: "alvo" },
    { id: "p2", nome: "Operação", icone: "inexistente", cor: "vermelho" },
  ],
  ferramentas: [
    { id: "t1", nome: "CRM", categoria: "vendas", status: "ativa" },
    { id: "t2", nome: "Planilha" },
  ],
  agentes: [
    { id: "a1", pilarId: "p1", nome: "Qualificador", funcao: "worker", ferramentas: ["t1", "nao-existe"], paiId: "a0" },
    { id: "a0", pilarId: "p1", nome: "Coordenador", funcao: "lead", ferramentas: ["t1", "t2"] },
    { id: "a9", pilarId: "pilar-fantasma", nome: "Sem pilar" },
  ],
  pessoas: [{ id: "h1", pilarId: "p1", nome: "Pessoa Exemplo", papel: "Responsável", ferramentas: ["t2"] }],
  tarefas: [
    { id: "k1", pilarId: "p1", titulo: "Qualificar lead", passos: ["abrir", "ligar", 3], executorTipo: "agent", executorId: "a1" },
    { id: "k2", pilarId: "p1", titulo: "Revisar", executorTipo: "person", executorId: "h1" },
  ],
  execucoes: [
    { agenteId: "a1", iniciadoEm: "2026-01-01", terminadoEm: "2026-01-02", ok: true, resumo: "feito", status: "done" },
    { agenteId: "a1", iniciadoEm: "2026-02-01", status: "running" },
  ],
};

describe("normalizarOrganizacao", () => {
  const { data, avisos } = normalizarOrganizacao(bruto);

  it("prefixa os ids por categoria e ordena os pilares por `ordem`", () => {
    // `ordem` explícita manda; sem ela vale a posição no arquivo (p2 é o 2º ⇒ ordem 1 < 2)
    expect(data.pilares.map((p) => p.id)).toEqual(["pilar:p2", "pilar:p1"]);
    expect(data.pilares.find((p) => p.id === "pilar:p1")).toMatchObject({ nome: "Vendas", cor: "#ff0000", icone: "alvo", ordem: 2 });
    expect(data.agentes.map((a) => a.id).sort()).toEqual(["agente:a0", "agente:a1"]);
    expect(data.pessoas[0].id).toBe("pessoa:h1");
    expect(data.ferramentas.map((t) => t.id)).toEqual(["ferramenta:t1", "ferramenta:t2"]);
  });

  it("cor e ícone inválidos viram null (o desenho cai na paleta/ícone padrão)", () => {
    const p2 = data.pilares.find((p) => p.id === "pilar:p2")!;
    expect(p2.cor).toBeNull();
    expect(p2.icone).toBeNull();
  });

  it("resolve referências: ferramentas só as que existem, pai só se existir", () => {
    const a1 = data.agentes.find((a) => a.id === "agente:a1")!;
    expect(a1.ferramentas).toEqual(["ferramenta:t1"]);
    expect(a1.paiId).toBe("agente:a0");
    expect(data.agentes.find((a) => a.id === "agente:a0")!.paiId).toBeNull();
    expect(data.pessoas[0].ferramentas).toEqual(["ferramenta:t2"]);
  });

  it("descarta o que não tem onde ficar e avisa, sem lançar", () => {
    expect(data.agentes.some((a) => a.id === "agente:a9")).toBe(false);
    expect(avisos.join(" ")).toMatch(/pilar/i);
  });

  it("tarefa aponta pro executor prefixado; passos não-texto são ignorados", () => {
    const k1 = data.tarefas.find((t) => t.id === "tarefa:k1")!;
    expect(k1).toMatchObject({ executorTipo: "agent", executorId: "agente:a1", passos: ["abrir", "ligar"] });
    expect(data.tarefas.find((t) => t.id === "tarefa:k2")).toMatchObject({ executorTipo: "person", executorId: "pessoa:h1" });
  });

  it("última execução por agente é a de início mais recente", () => {
    expect(data.ultimaExecucao["agente:a1"]).toMatchObject({ status: "running", terminadoEm: null, ok: null });
  });

  it("lixo vira organização vazia, nunca exceção", () => {
    for (const v of [null, undefined, 42, "x", [], { pilares: "nao-lista" }]) {
      const r = normalizarOrganizacao(v);
      expect(r.data.pilares).toEqual([]);
      expect(r.data.agentes).toEqual([]);
    }
  });

  it("id repetido na mesma categoria: vale o primeiro", () => {
    const r = normalizarOrganizacao({ pilares: [{ id: "x", nome: "A" }, { id: "x", nome: "B" }] });
    expect(r.data.pilares.map((p) => p.nome)).toEqual(["A"]);
  });
});

describe("lerOrganizacao", () => {
  const dirs: string[] = [];
  const raizAnterior = process.env.BILHON_ROOT;
  const orgAnterior = process.env.BILHON_BRAIN_ORG_JSON;
  const agenteAnterior = process.env.BILHON_AGENTE_DIR;
  let raiz: string;

  beforeAll(() => {
    raiz = mkdtempSync(path.join(tmpdir(), "org-"));
    dirs.push(raiz);
    process.env.BILHON_ROOT = raiz;
    process.env.BILHON_AGENTE_DIR = path.join(raiz, "agente");
    delete process.env.BILHON_BRAIN_ORG_JSON;
  });
  afterEach(() => {
    delete process.env.BILHON_BRAIN_ORG_JSON;
    vi.restoreAllMocks();
  });
  afterAll(() => {
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
    for (const [k, v] of [["BILHON_ROOT", raizAnterior], ["BILHON_BRAIN_ORG_JSON", orgAnterior], ["BILHON_AGENTE_DIR", agenteAnterior]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("padrão: organizacao.json dentro da pasta de estado do agente", () => {
    expect(caminhoOrganizacao()).toBe(path.join(raiz, "agente", "organizacao.json"));
  });

  it("variável em branco vale como ausente", () => {
    process.env.BILHON_BRAIN_ORG_JSON = "   ";
    expect(caminhoOrganizacao()).toBe(path.join(raiz, "agente", "organizacao.json"));
  });

  it("arquivo ausente: ok=false, estado 'ausente', sem lançar", async () => {
    const r = await lerOrganizacao();
    expect(r).toMatchObject({ ok: false, estado: "ausente" });
  });

  it("lê e normaliza o arquivo configurado", async () => {
    mkdirSync(path.join(raiz, "agente"), { recursive: true });
    writeFileSync(path.join(raiz, "agente", "organizacao.json"), JSON.stringify(bruto));
    const r = await lerOrganizacao();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.pilares).toHaveLength(2);
  });

  it("JSON inválido: ok=false, estado 'invalida'", async () => {
    const f = path.join(raiz, "ruim.json");
    writeFileSync(f, "{ nao e json");
    process.env.BILHON_BRAIN_ORG_JSON = f;
    expect(await lerOrganizacao()).toMatchObject({ ok: false, estado: "invalida" });
  });

  it("arquivo grande demais é recusado antes de ler", async () => {
    const f = path.join(raiz, "enorme.json");
    writeFileSync(f, JSON.stringify({ pilares: [], lixo: "x".repeat(5 * 1024 * 1024) }));
    process.env.BILHON_BRAIN_ORG_JSON = f;
    expect(await lerOrganizacao()).toMatchObject({ ok: false, estado: "invalida" });
  });

  it("caminho fora de BILHON_ROOT é recusado, mesmo que o arquivo exista", async () => {
    const fora = mkdtempSync(path.join(tmpdir(), "fora-"));
    dirs.push(fora);
    const f = path.join(fora, "organizacao.json");
    writeFileSync(f, JSON.stringify(bruto));
    process.env.BILHON_BRAIN_ORG_JSON = f;
    expect(await lerOrganizacao()).toMatchObject({ ok: false, estado: "fora-da-raiz" });
  });

  it("symlink que sai da raiz é recusado", async () => {
    const fora = mkdtempSync(path.join(tmpdir(), "fora-"));
    dirs.push(fora);
    writeFileSync(path.join(fora, "o.json"), JSON.stringify(bruto));
    const elo = path.join(raiz, "elo.json");
    symlinkSync(path.join(fora, "o.json"), elo);
    process.env.BILHON_BRAIN_ORG_JSON = elo;
    expect(await lerOrganizacao()).toMatchObject({ ok: false, estado: "fora-da-raiz" });
  });
});
