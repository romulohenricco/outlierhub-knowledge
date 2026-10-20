import { mkdir, readFile, writeFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getBooks } from "@/lib/catalog";
import { getKnowledgeProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 120;

import path from "node:path";

const CACHE_JSON =
  process.env.BILHON_AUTOLEARN_CACHE ||
  path.join(process.cwd(), "data", "livros", "autolearn-cache.json");

async function lerCache(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(CACHE_JSON, "utf-8"));
  } catch {
    return {};
  }
}

function chave(conceito?: string, livroArquivo?: string) {
  return conceito ? `c:${conceito.toLowerCase()}` : `l:${livroArquivo}`;
}

/** GET: sugestões já geradas pra este nó (persistidas — "o que já foi procurado"). */
export async function GET(req: NextRequest) {
  const conceito = req.nextUrl.searchParams.get("conceito") ?? undefined;
  const livroArquivo = req.nextUrl.searchParams.get("livroArquivo") ?? undefined;
  if (!conceito && !livroArquivo) return new NextResponse(null, { status: 400 });
  const cache = await lerCache();
  const hit = cache[chave(conceito, livroArquivo)];
  if (!hit) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ ...(hit as Record<string, unknown>), buscaUrl: buscaUrlModelo() });
}

const NIVEIS_JSON =
  process.env.BILHON_NIVEIS ||
  path.join(process.cwd(), "data", "livros", "niveis.json");

const NOME_NIVEL: Record<string, string> = {
  "referencia-academica": "referência/acadêmico",
  profissional: "profissional (trade book)",
  "pratico-mercado": "prático/mercado",
};

/** Host do Ollama: o loopback quando a variável está em branco (infra local,
 *  não é credencial). Lido por requisição, para valer sem reiniciar. */
function ollamaUrl(): string {
  const bruto = (process.env.BILHON_OLLAMA_URL || "").trim() || "http://127.0.0.1:11434";
  return bruto.replace(/\/+$/, "");
}

/** Modelo de URL para buscar a obra sugerida, com `{query}` no lugar do termo
 *  (ex.: https://sua-loja.example/busca?q={query}). Em branco ou inválido, o
 *  painel não mostra o botão. Só http(s): o valor vira `href` na tela. */
function buscaUrlModelo(): string | null {
  const bruto = (process.env.BILHON_AUTOLEARN_SEARCH_URL || "").trim();
  return /^https?:\/\/\S*\{query\}\S*$/i.test(bruto) ? bruto : null;
}

type Sugestao = { assunto: string; query: string; porque: string };

/**
 * Autolearning nivelado: dado um conceito (ou livro), sugere material NOVO do
 * MESMO registro editorial das fontes — manual técnico puxa manual técnico,
 * nunca apostila de curso. Motor 100% local (Ollama).
 */
export async function POST(req: Request) {
  const { conceito, livroArquivo } = (await req.json().catch(() => ({}))) as {
    conceito?: string;
    livroArquivo?: string;
  };
  if (!conceito && !livroArquivo) {
    return NextResponse.json({ erro: "conceito ou livroArquivo obrigatório" }, { status: 400 });
  }
  // Sem modelo configurado não há o que chamar: 503 explícito, em vez de
  // escolher um modelo que a máquina pode nem ter baixado.
  const modelo = (process.env.BILHON_AUTOLEARN_MODEL || "").trim();
  if (!modelo) {
    return NextResponse.json(
      { ok: false, erro: "modelo-nao-configurado", detalhe: "defina BILHON_AUTOLEARN_MODEL" },
      { status: 503 },
    );
  }

  // 1. obras-fonte + relações
  let livros: string[] = [];
  let relacoes: string[] = [];
  let vizinhos: string[] = [];
  if (conceito) {
    const f = await getKnowledgeProvider().fontesDoConceito(conceito.toLowerCase());
    livros = f.livros;
    relacoes = f.relacoes;
    vizinhos = f.vizinhos;
  }
  if (livroArquivo) livros = [...new Set([...livros, livroArquivo])];

  // 2. níveis das fontes (JSON opcional { "<arquivo do livro>": { "nivel": "..." } })
  let niveis: Record<string, { nivel: string }> = {};
  try {
    niveis = JSON.parse(await readFile(NIVEIS_JSON, "utf-8"));
  } catch {
    /* ainda não gerado — segue com nível desconhecido */
  }
  const books = await getBooks();
  const meta = new Map(books.map((b) => [b.arquivo, b]));
  const fontes = livros
    .filter((l) => meta.has(l))
    .map((l) => ({
      titulo: meta.get(l)!.titulo,
      nivel: niveis[l]?.nivel ?? "desconhecido",
    }));

  // nível-alvo = moda dos níveis das fontes (empate → o mais alto)
  const ordem = ["referencia-academica", "profissional", "pratico-mercado"];
  const contagem = new Map<string, number>();
  for (const f of fontes)
    if (f.nivel !== "desconhecido")
      contagem.set(f.nivel, (contagem.get(f.nivel) ?? 0) + 1);
  const nivelAlvo =
    [...contagem.entries()].sort(
      (a, b) => b[1] - a[1] || ordem.indexOf(a[0]) - ordem.indexOf(b[0]),
    )[0]?.[0] ?? "profissional";

  // 3. LLM local gera as sugestões NIVELADAS
  const alvoDesc = {
    "referencia-academica":
      "obras de REFERÊNCIA: manuais técnicos, university press, handbooks, textos acadêmicos. NUNCA ebook de curso ou guia de influencer.",
    profissional:
      "trade books SÉRIOS de editoras estabelecidas, autores reconhecidos no campo. Nem paper acadêmico árido, nem apostila de curso.",
    "pratico-mercado":
      "guias práticos e aplicados, direto ao ponto, formato mercado.",
  }[nivelAlvo];

  const prompt = `Conceito do grafo de conhecimento: "${conceito ?? meta.get(livroArquivo!)?.titulo}"
Conceitos VIZINHOS no grafo (o domínio real deste conceito): ${vizinhos.join(", ") || "—"}
Relações já mapeadas: ${relacoes.join(", ") || "—"}
Obras-fonte no acervo (com nível editorial):
${fontes.map((f) => `- ${f.titulo} [${f.nivel}]`).join("\n") || "—"}

Sugira 5 OBRAS NOVAS (livros/manuais REAIS e conhecidos quando existirem) pra
complementar este conceito no grafo, DENTRO DO DOMÍNIO indicado pelos vizinhos
(ex.: se os vizinhos são juros/inflação/câmbio, o domínio é economia — NÃO culinária).
REGRA DURA DE NÍVEL: as sugestões DEVEM ser do nível "${nivelAlvo}" — ${alvoDesc}
Pra cada uma: título/assunto da obra, query de busca curta em inglês ou português
(3-6 palavras, boa pra achar a obra), e por quê complementa o grafo (1 frase).
Responda SÓ JSON: {"sugestoes":[{"assunto":"...","query":"...","porque":"..."}]}`;

  try {
    const r = await fetch(`${ollamaUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelo,
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0.4, num_predict: 600 },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const parsed = JSON.parse((await r.json()).response) as {
      sugestoes?: Sugestao[];
    };
    const sugestoes = (parsed.sugestoes ?? [])
      .filter((s) => s?.assunto && s?.query)
      .slice(0, 6);
    const resultado = {
      ok: true,
      nivelAlvo,
      nivelAlvoNome: NOME_NIVEL[nivelAlvo] ?? nivelAlvo,
      fontes,
      sugestoes,
      geradoEm: new Date().toISOString(),
    };
    // persiste: o que já foi procurado fica SEMPRE disponível ao reabrir o nó.
    // Não gravar não é falha do Ollama (as sugestões já foram geradas): elas
    // seguem para a tela e a resposta avisa em `persistido: false`, sem caminho.
    let persistido = true;
    try {
      const cache = await lerCache();
      cache[chave(conceito, livroArquivo)] = resultado;
      await mkdir(path.dirname(CACHE_JSON), { recursive: true });
      await writeFile(CACHE_JSON, JSON.stringify(cache, null, 1));
    } catch {
      persistido = false;
    }
    return NextResponse.json({ ...resultado, persistido, buscaUrl: buscaUrlModelo() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: "ollama-offline", detalhe: String(e).slice(0, 120) },
      { status: 503 },
    );
  }
}
