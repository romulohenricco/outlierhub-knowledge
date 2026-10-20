import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "promptreverso-"));
  // REFS_DIR é const de módulo em lib/referencias — o env tem que estar posto
  // ANTES do primeiro import dinâmico (mesmo contrato do teste da rota /thumb)
  process.env.BILHON_REFERENCIAS_DIR = root;
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.BILHON_REFERENCIAS_DIR;
});

function post(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<
    typeof import("./route").POST
  >[0];
}

const VALIDO = {
  prompt: "Fundo vermelho chapado, rosto recortado em preto e branco no centro.",
  negativo: "gradiente, marca d'água",
  proporcao: "16:9 (1280x720)",
  por: "modelo-exemplo (leitura de imagem)",
  analise: {
    sujeito: "cabeça recortada",
    composicao: "simetria bilateral",
    zonaSegura: "sem reserva de interface — arte vai até a borda",
    textoNaImagem: '"texto de exemplo"',
    gancho: "promessa de método",
  },
};

describe("rota /api/referencias/prompt-reverso", () => {
  it("grava o prompt reverso em prompts-reversos.json", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ code: "abc123def45", promptReverso: VALIDO }));
    expect(res.status).toBe(200);

    const salvo = JSON.parse(
      await readFile(path.join(root, "prompts-reversos.json"), "utf-8"),
    );
    expect(salvo["abc123def45"].prompt).toBe(VALIDO.prompt);
    expect(salvo["abc123def45"].analise.gancho).toBe("promessa de método");
    // zonaSegura precisa estar no allowlist da rota — sem isso o campo era
    // descartado em silêncio
    expect(salvo["abc123def45"].analise.zonaSegura).toContain("sem reserva");
    // carimbo de quando foi gerado entra sozinho quando o cliente não manda
    expect(typeof salvo["abc123def45"].geradoEm).toBe("string");
  });

  it("descarta campo desconhecido dentro de analise", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      post({
        code: "abc",
        promptReverso: { ...VALIDO, analise: { ...VALIDO.analise, hexchutado: "#ff0000" } },
      }),
    );
    expect(res.status).toBe(200);
    const salvo = JSON.parse(
      await readFile(path.join(root, "prompts-reversos.json"), "utf-8"),
    );
    expect(salvo.abc.analise).not.toHaveProperty("hexchutado");
    expect(salvo.abc.analise.sujeito).toBe("cabeça recortada");
  });

  it("400 sem prompt, com prompt vazio ou com analise que não é objeto", async () => {
    const { POST } = await import("./route");
    for (const corpo of [
      { code: "x", promptReverso: { negativo: "nada" } },
      { code: "x", promptReverso: { prompt: "" } },
      { code: "", promptReverso: VALIDO },
      { code: "x", promptReverso: { prompt: "ok", analise: "texto solto" } },
      { code: "x", promptReverso: { prompt: "ok", analise: ["lista"] } },
    ]) {
      const res = await POST(post(corpo));
      expect(res.status).toBe(400);
    }
  });
});

describe("getReferencias com fonte youtube", () => {
  it("anexa promptReverso e preserva os metadados do vídeo", async () => {
    const { getReferencias } = await import("@/lib/referencias");
    await writeFile(
      path.join(root, "referencias.json"),
      JSON.stringify({
        fonte: "teste",
        extraidoEm: "2025-01-01",
        colecoes: [{ id: "youtube-referencias", nome: "YouTube", n: 1 }],
        posts: [
          {
            code: "abc123def45",
            user: "canal-ficticio",
            caption: "legenda de exemplo",
            igUrl: "https://www.youtube.com/watch?v=abc123def45",
            dir: "canal-ficticio__abc123def45",
            images: ["legenda de exemplo.jpg"],
            videoIdx: [1],
            videos: [],
            colecoes: ["YouTube"],
            plataforma: "youtube",
            youtube: { videoId: "abc123def45", canal: "canal-ficticio", duracao: 812 },
          },
        ],
      }),
    );
    const { posts } = await getReferencias();
    const p = posts.find((x) => x.code === "abc123def45");
    expect(p?.plataforma).toBe("youtube");
    expect(p?.youtube?.duracao).toBe(812);
    // a thumb é o poster do vídeo — o slot 1 tem que continuar marcado
    expect(p?.videoIdx).toEqual([1]);
    // prompts-reversos.json já foi escrito pelos testes acima
    expect(p?.promptReverso?.prompt).toBe(VALIDO.prompt);
  });
});
