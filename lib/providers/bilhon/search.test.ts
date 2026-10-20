/**
 * Fail-fast do segredo `op://` não resolvido + escopo de
 * bucket declarativo. Hermético por construção: `@supabase/supabase-js` e o
 * `fetch` do Ollama são mockados (nenhum teste toca rede, Supabase ou o corpus
 * real) e TODA variável `BILHON_*` é limpa antes de cada caso: sem essa
 * limpeza, variáveis exportadas no shell de quem roda os testes mudariam o resultado.
 *
 * Os valores usados aqui são fixtures fictícias: nenhum segredo real aparece
 * neste arquivo, e as asserções provam que também não aparecem nas mensagens
 * de erro nem no log do provider.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `server-only` é um marcador do Next que lança fora do runtime react-server;
// no vitest ele precisa virar módulo vazio pro provider ser importável
vi.mock("server-only", () => ({}));

const mockSupabase = vi.hoisted(() => ({
  chamadasRpc: [] as { nome: string; args: Record<string, unknown> }[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (nome: string, args: Record<string, unknown>) => {
      mockSupabase.chamadasRpc.push({ nome, args });
      // o builder real é thenable e aceita .abortSignal() — só o suficiente aqui
      return { abortSignal: () => Promise.resolve({ data: [], error: null }) };
    },
  }),
}));

const URL_FICTICIA = "https://projeto-ficticio.example.invalid";
const CHAVE_FICTICIA = "chave-ficticia-de-teste-sem-valor-real";
const REF_OP_NAO_RESOLVIDA = "op:" + "//repositorio-ficticio/item-ficticio/credencial";
const SENTINELA = "__TODO_O_CORPUS__";

let envOriginal: Record<string, string | undefined> = {};

function limparEnvBilhon() {
  envOriginal = {};
  for (const chave of Object.keys(process.env)) {
    if (chave.startsWith("BILHON_")) {
      envOriginal[chave] = process.env[chave];
      delete process.env[chave];
    }
  }
}

function stubOllama() {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ embedding: [0.11, 0.22, 0.33] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Provider real importado com o módulo recém-resetado (o log da sentinela é
 *  "uma vez por processo" — cada caso precisa de instância limpa do módulo). */
async function carregarProvider() {
  const { BilhonCorpusSearchProvider } = await import("./search");
  return new BilhonCorpusSearchProvider();
}

async function erroDaBusca(query = "arquitetura de decisão") {
  const provider = await carregarProvider();
  return provider.search(query).then(
    () => null,
    (e: unknown) => e as Error & { code?: string },
  );
}

beforeEach(() => {
  limparEnvBilhon();
  mockSupabase.chamadasRpc.length = 0;
  vi.resetModules();
});

afterEach(() => {
  for (const [chave, valor] of Object.entries(envOriginal)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("segredoNaoResolvido — detector de referência de segredo não resolvida", () => {
  it("reconhece op:// e só op://", async () => {
    const { segredoNaoResolvido } = await import("./search");
    expect(segredoNaoResolvido(REF_OP_NAO_RESOLVIDA)).toBe(true);
    expect(segredoNaoResolvido(`  ${REF_OP_NAO_RESOLVIDA}  `)).toBe(true);
    expect(segredoNaoResolvido(CHAVE_FICTICIA)).toBe(false);
    expect(segredoNaoResolvido(URL_FICTICIA)).toBe(false);
    expect(segredoNaoResolvido("")).toBe(false);
    expect(segredoNaoResolvido(null)).toBe(false);
    expect(segredoNaoResolvido(undefined)).toBe(false);
  });
});

describe("busca com segredo op:// não resolvido", () => {
  it("lança erro acionável citando o .env.local, sem tocar Ollama nem a RPC", async () => {
    process.env.BILHON_SUPABASE_URL = URL_FICTICIA;
    process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = REF_OP_NAO_RESOLVIDA;
    process.env.BILHON_KNOWLEDGE_BUCKET_FILTER = SENTINELA;
    const fetchMock = stubOllama();

    const erro = await erroDaBusca();
    expect(erro?.name).toBe("ProviderSearchError");
    expect(erro?.code).toBe("backend");
    expect(erro?.message).toContain("BILHON_SUPABASE_SERVICE_ROLE_KEY");
    expect(erro?.message).toContain(".env.local");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSupabase.chamadasRpc).toHaveLength(0);
  });

  it("detecta a referência também em BILHON_SUPABASE_URL", async () => {
    process.env.BILHON_SUPABASE_URL = REF_OP_NAO_RESOLVIDA;
    process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = CHAVE_FICTICIA;
    process.env.BILHON_KNOWLEDGE_BUCKET_FILTER = SENTINELA;
    stubOllama();

    const erro = await erroDaBusca();
    expect(erro?.message).toContain("BILHON_SUPABASE_URL");
    expect(mockSupabase.chamadasRpc).toHaveLength(0);
  });

  it("status() reporta configured:false com motivo acionável", async () => {
    process.env.BILHON_SUPABASE_URL = URL_FICTICIA;
    process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = REF_OP_NAO_RESOLVIDA;
    process.env.BILHON_KNOWLEDGE_BUCKET_FILTER = SENTINELA;
    // grafo deterministicamente ausente (o status combina grafo + busca)
    process.env.BILHON_KG_DB = "C:/caminho/inexistente/kg-de-teste.sqlite";

    const { MegabrainProvider } = await import("../megabrain");
    const status = await new MegabrainProvider().status();
    expect(status.configured).toBe(false);
    expect(status.reason).toContain("BILHON_SUPABASE_SERVICE_ROLE_KEY");
    expect(status.reason).toContain(".env.local");
    expect(status.reason).not.toContain(REF_OP_NAO_RESOLVIDA);
  });

  it("nenhuma mensagem de erro do provider ecoa valor de variável", async () => {
    const cenarios: Record<string, string>[] = [
      {
        BILHON_SUPABASE_URL: URL_FICTICIA,
        BILHON_SUPABASE_SERVICE_ROLE_KEY: REF_OP_NAO_RESOLVIDA,
        BILHON_KNOWLEDGE_BUCKET_FILTER: SENTINELA,
      },
      {
        BILHON_SUPABASE_URL: URL_FICTICIA,
        BILHON_SUPABASE_SERVICE_ROLE_KEY: CHAVE_FICTICIA,
      },
      { BILHON_KNOWLEDGE_BUCKET_FILTER: "setor-ficticio" },
    ];

    for (const cenario of cenarios) {
      limparEnvBilhon();
      Object.assign(process.env, cenario);
      vi.resetModules();
      stubOllama();

      const erro = await erroDaBusca();
      const { bilhonCorpusDiagnostico } = await import("./search");
      const diagnostico = bilhonCorpusDiagnostico();
      const textos = [erro?.message ?? "", diagnostico.ok ? "" : diagnostico.motivo];

      expect(erro).not.toBeNull();
      for (const texto of textos) {
        for (const valor of Object.values(cenario)) {
          expect(texto).not.toContain(valor);
        }
      }
    }
  });
});

describe("escopo de bucket declarativo", () => {
  it("sem BILHON_KNOWLEDGE_BUCKET_FILTER a busca falha citando a variável e a sentinela", async () => {
    process.env.BILHON_SUPABASE_URL = URL_FICTICIA;
    process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = CHAVE_FICTICIA;
    const fetchMock = stubOllama();

    const erro = await erroDaBusca();
    expect(erro?.name).toBe("ProviderSearchError");
    expect(erro?.code).toBe("backend");
    expect(erro?.message).toContain("BILHON_KNOWLEDGE_BUCKET_FILTER");
    expect(erro?.message).toContain(SENTINELA);
    // nenhuma requisição sai com bucket_filter: null por omissão
    expect(mockSupabase.chamadasRpc).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("variável só com espaço conta como ausente", async () => {
    process.env.BILHON_SUPABASE_URL = URL_FICTICIA;
    process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = CHAVE_FICTICIA;
    process.env.BILHON_KNOWLEDGE_BUCKET_FILTER = "   ";
    stubOllama();

    const erro = await erroDaBusca();
    expect(erro?.message).toContain("BILHON_KNOWLEDGE_BUCKET_FILTER");
    expect(mockSupabase.chamadasRpc).toHaveLength(0);
  });

  it("sentinela mantém o comportamento de hoje e registra a escolha UMA vez", async () => {
    process.env.BILHON_SUPABASE_URL = URL_FICTICIA;
    process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = CHAVE_FICTICIA;
    process.env.BILHON_KNOWLEDGE_BUCKET_FILTER = SENTINELA;
    stubOllama();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const provider = await carregarProvider();
    await expect(provider.search("arquitetura de decisão")).resolves.toEqual([]);
    await expect(provider.search("segunda busca no mesmo processo")).resolves.toEqual([]);

    expect(mockSupabase.chamadasRpc).toHaveLength(2);
    for (const chamada of mockSupabase.chamadasRpc) {
      expect(chamada.nome).toBe("match_rag_chunks_hybrid");
      expect(chamada.args.bucket_filter).toBeNull();
      expect(chamada.args.p_rid).toBeNull();
      expect(chamada.args.match_count).toBe(18);
    }

    expect(logSpy).toHaveBeenCalledTimes(1);
    const linha = String(logSpy.mock.calls[0][0]);
    const registro = JSON.parse(linha) as Record<string, unknown>;
    expect(registro.evento).toBe("busca.escopo.corpus-inteiro-declarado");
    expect(registro.variavel).toBe("BILHON_KNOWLEDGE_BUCKET_FILTER");
    expect(registro.sentinela).toBe(SENTINELA);
    expect(linha).not.toContain(CHAVE_FICTICIA);
    expect(linha).not.toContain(URL_FICTICIA);
  });

  it("bucket nomeado chega à RPC (e não gera log de corpus inteiro)", async () => {
    process.env.BILHON_SUPABASE_URL = URL_FICTICIA;
    process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = CHAVE_FICTICIA;
    process.env.BILHON_KNOWLEDGE_BUCKET_FILTER = "  bucket-ficticio  ";
    stubOllama();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const provider = await carregarProvider();
    await provider.search("meta anual");

    expect(mockSupabase.chamadasRpc).toHaveLength(1);
    expect(mockSupabase.chamadasRpc[0].args.bucket_filter).toBe("bucket-ficticio");
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("status() honesto do provider megabrain", () => {
  async function statusMegabrain() {
    process.env.BILHON_KG_DB = "C:/caminho/inexistente/kg-de-teste.sqlite";
    const { MegabrainProvider } = await import("../megabrain");
    return new MegabrainProvider().status();
  }

  it("sem URL/chave: configured:false citando as duas variáveis", async () => {
    const status = await statusMegabrain();
    expect(status.configured).toBe(false);
    expect(status.reason).toContain("BILHON_SUPABASE_URL");
    expect(status.reason).toContain("BILHON_SUPABASE_SERVICE_ROLE_KEY");
  });

  it("com URL/chave e sem escopo: configured:false citando a sentinela", async () => {
    process.env.BILHON_SUPABASE_URL = URL_FICTICIA;
    process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = CHAVE_FICTICIA;
    const status = await statusMegabrain();
    expect(status.configured).toBe(false);
    expect(status.reason).toContain("BILHON_KNOWLEDGE_BUCKET_FILTER");
    expect(status.reason).toContain(SENTINELA);
  });

  it("com sentinela: configured:true e escopo declarado visível no reason", async () => {
    process.env.BILHON_SUPABASE_URL = URL_FICTICIA;
    process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = CHAVE_FICTICIA;
    process.env.BILHON_KNOWLEDGE_BUCKET_FILTER = SENTINELA;
    const status = await statusMegabrain();
    expect(status.configured).toBe(true);
    expect(status.reason).toContain("corpus inteiro");
  });

  it("com bucket nomeado: configured:true sem ecoar o nome do bucket", async () => {
    process.env.BILHON_SUPABASE_URL = URL_FICTICIA;
    process.env.BILHON_SUPABASE_SERVICE_ROLE_KEY = CHAVE_FICTICIA;
    process.env.BILHON_KNOWLEDGE_BUCKET_FILTER = "setor-ficticio";
    const status = await statusMegabrain();
    expect(status.configured).toBe(true);
    expect(status.reason).toContain("bucket declarado");
    expect(status.reason).not.toContain("setor-ficticio");
  });
});

describe("factory — mensagem de provider inválido", () => {
  async function erroDaFactory() {
    const { getKnowledgeProvider } = await import("../index");
    try {
      getKnowledgeProvider();
      return null;
    } catch (e) {
      return e as Error;
    }
  }

  it("não ecoa valor longo/estranho da env (poderia ser segredo trocado por engano)", async () => {
    const valorSuspeito = `${"z".repeat(48)}.parece-credencial`;
    process.env.BILHON_KNOWLEDGE_PROVIDER = valorSuspeito;
    const erro = await erroDaFactory();
    expect(erro?.message).toContain("BILHON_KNOWLEDGE_PROVIDER");
    expect(erro?.message).not.toContain(valorSuspeito);
  });

  // O filtro "ecoa só se for curto e alfanumérico" foi retirado: um token curto
  // passaria nele. A regra é absoluta — a mensagem cita o NOME da
  // variável e os valores aceitos; o valor atual, nunca (nem um typo).
  it("não ecoa nem o typo curto, mas diz o que é aceito", async () => {
    process.env.BILHON_KNOWLEDGE_PROVIDER = "supabse";
    const erro = await erroDaFactory();
    expect(erro?.message).toContain("BILHON_KNOWLEDGE_PROVIDER");
    expect(erro?.message).toContain("supabase"); // o valor VÁLIDO, na dica
    expect(erro?.message).not.toContain("supabse"); // o valor recebido, não
  });
});

describe("modo demo (não pode regredir)", () => {
  it("sobe e busca sem NENHUMA env BILHON_*, sem tocar Supabase nem Ollama", async () => {
    const fetchMock = stubOllama();
    const { getKnowledgeProvider } = await import("../index");
    const provider = getKnowledgeProvider();

    expect((await provider.status()).configured).toBe(true);
    const hits = await provider.search("conhecimento");
    expect(hits.length).toBeGreaterThan(0);
    expect(mockSupabase.chamadasRpc).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** Pares [chave, valor] das linhas `CHAVE=valor` (não comentadas) do .env.example. */
  function linhasDoEnvExample(): [string, string][] {
    const texto = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    return [...texto.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]);
  }

  it("variável em branco (ou só espaço) vale como ausente e cai em demo", async () => {
    for (const valor of ["", "   "]) {
      process.env.BILHON_KNOWLEDGE_PROVIDER = valor;
      vi.resetModules();
      const { getKnowledgeProvider } = await import("../index");
      const { DemoProvider } = await import("../demo");
      expect(getKnowledgeProvider()).toBeInstanceOf(DemoProvider);
    }
  });

  it("com TODAS as chaves do .env.example em branco o app sobe em demo, sem rede", async () => {
    const chaves = linhasDoEnvExample().map(([chave]) => chave);
    expect(chaves).toContain("BILHON_KNOWLEDGE_PROVIDER");
    for (const chave of chaves) process.env[chave] = "";
    try {
      const fetchMock = stubOllama();
      const { getKnowledgeProvider } = await import("../index");
      const provider = getKnowledgeProvider();
      expect((await provider.status()).configured).toBe(true);
      expect((await provider.search("conhecimento")).length).toBeGreaterThan(0);
      expect(mockSupabase.chamadasRpc).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();

      // acesso externo continua fechado: sem time/audience/e-mail não há JWT possível
      const access = await import("../../access");
      expect(access.ACCESS_CONFIGURADO).toBe(false);
      expect(access.precisaDeAccess("localhost:3300")).toBe(false);
      expect(access.precisaDeAccess("example.invalid")).toBe(true);
    } finally {
      for (const chave of chaves) delete process.env[chave];
    }
  });

  it("o .env.example sai sem nenhum valor preenchido", () => {
    const preenchidas = linhasDoEnvExample().filter(([, valor]) => valor !== "");
    expect(preenchidas.map(([chave]) => chave)).toEqual([]);
  });

  it("com BILHON_KNOWLEDGE_PROVIDER=demo explícito, idem", async () => {
    process.env.BILHON_KNOWLEDGE_PROVIDER = "demo";
    const fetchMock = stubOllama();
    const { getKnowledgeProvider } = await import("../index");
    const hits = await getKnowledgeProvider().search("conhecimento");
    expect(hits.length).toBeGreaterThan(0);
    expect(mockSupabase.chamadasRpc).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
