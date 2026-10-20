import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * O proxy existe para o botão não precisar de CORS aberto no executor. Os testes
 * travam o que importa: sem configuração o recurso está desligado e nada sai
 * daqui, a origem do erro fica visível (não vira 500 genérico) e o texto de erro
 * do executor não é repassado ao navegador.
 */

const fetchMock = vi.fn();
let POST: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

// porta de loopback fictícia: nenhum executor real é contatado (fetch é mock)
const URL_EXECUTOR = "http://127.0.0.1:4411";

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("BILHON_EXECUTION_URL", URL_EXECUTOR);
  vi.stubEnv("BILHON_EXECUTION_PATH", "/tarefas");
  vi.stubEnv("BILHON_EXECUTION_DEFAULT_AGENT", "");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  ({ POST } = await import("./route"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const chamar = (id: string, body: unknown = {}) =>
  POST(
    new NextRequest(`http://127.0.0.1:3300/api/kanban/${id}/escalar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const executorOk = () =>
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, task: { id: "t-abc123" } }) });
const corpoEnviado = () => JSON.parse(fetchMock.mock.calls[0][1].body);

describe("POST /api/kanban/[id]/escalar", () => {
  it("encaminha o ticket ao endpoint configurado e devolve a tarefa criada", async () => {
    executorOk();
    const res = await chamar("ING-1");
    expect(res.status).toBe(201);
    expect((await res.json()).taskId).toBe("t-abc123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${URL_EXECUTOR}/tarefas`);
    expect(init.method).toBe("POST");
    expect(corpoEnviado().ticketId).toBe("ING-1");
  });

  it("sem caminho configurado, a própria URL é o endpoint", async () => {
    vi.stubEnv("BILHON_EXECUTION_URL", `${URL_EXECUTOR}/receber`);
    vi.stubEnv("BILHON_EXECUTION_PATH", "");
    executorOk();
    await chamar("ING-1");
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${URL_EXECUTOR}/receber`);
  });

  it("sem agente padrão nem informado, o corpo não leva toAgent", async () => {
    executorOk();
    await chamar("ING-1");
    expect(corpoEnviado()).toEqual({ ticketId: "ING-1" });
  });

  it("usa o agente padrão configurado, mas respeita o informado", async () => {
    vi.stubEnv("BILHON_EXECUTION_DEFAULT_AGENT", "agente-padrao");
    executorOk();
    await chamar("ING-1");
    expect(corpoEnviado().toAgent).toBe("agente-padrao");

    fetchMock.mockClear();
    await chamar("ING-1", { toAgent: "outro-agente" });
    expect(corpoEnviado().toAgent).toBe("outro-agente");
  });

  it("corpo `null` não derruba a rota", async () => {
    executorOk();
    const res = await chamar("ING-1", null);
    expect(res.status).toBe(201);
  });

  it("agente que não é texto vira 400 antes de sair daqui", async () => {
    const res = await chamar("ING-1", { toAgent: 42 });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("executor fora do ar vira 503 explicando — não 500 mudo", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await chamar("ING-1");
    expect(res.status).toBe(503);
    expect((await res.json()).erro).toMatch(/executor externo/i);
  });

  it("ticket inexistente preserva o 404 da origem", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: "ticket TSK-9 não encontrado" }),
    });
    const res = await chamar("TSK-9");
    expect(res.status).toBe(404);
  });

  it("id fora do formato do kanban é recusado com 400 e nada é enviado ao executor", async () => {
    for (const ruim of ["../../etc", "abc", "ING-", "ING-1/x", "ing-1", "%2e%2e"]) {
      fetchMock.mockClear();
      const res = await chamar(ruim);
      expect(res.status, `id ${ruim}`).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("recusa do executor vira 502 com o status — sem repassar o texto dele", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "detalhe-interno-do-executor" }),
    });
    const res = await chamar("ING-1");
    expect(res.status).toBe(502);
    const { erro } = await res.json();
    expect(erro).toMatch(/recusou.*400/);
    expect(erro).not.toContain("detalhe-interno-do-executor");
  });

  it("200 sem `ok: true` no corpo também é recusa", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ task: { id: "x" } }) });
    const res = await chamar("ING-1");
    expect(res.status).toBe(502);
  });

  it("URL com usuário/senha é configuração inválida e nada é enviado", async () => {
    vi.stubEnv("BILHON_EXECUTION_URL", "http://usuario:senha@127.0.0.1:4411");
    const res = await chamar("ING-1");
    expect(res.status).toBe(503);
    expect((await res.json()).erro).toMatch(/invalida/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("protocolo que não é http(s) é configuração inválida", async () => {
    vi.stubEnv("BILHON_EXECUTION_URL", "file:///tmp/x");
    const res = await chamar("ING-1");
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sem configuração o recurso está desligado", () => {
  it.each([
    ["em branco", ""],
    ["só espaços", "   "],
  ])("BILHON_EXECUTION_URL %s: 503 e nada é enviado", async (_nome, valor) => {
    vi.stubEnv("BILHON_EXECUTION_URL", valor);
    const res = await chamar("ING-1");
    expect(res.status).toBe(503);
    expect((await res.json()).erro).toMatch(/nao configurado/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
