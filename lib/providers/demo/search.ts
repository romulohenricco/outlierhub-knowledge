/**
 * DemoProvider — implementação de `SemanticSearchProvider` sobre
 * fixtures/demo/livros.json. Busca léxica simples (contagem de termos, sem
 * embeddings/subprocess) — o suficiente pra exercitar a UI de /buscar sem
 * nenhuma infra externa.
 */
import livrosFixture from "@/fixtures/demo/livros.json";
import type { SearchHit } from "@/lib/types";
import type { SemanticSearchProvider } from "../types";

type DemoLivro = {
  id: string;
  titulo: string;
  tema: string;
  resumo: string;
  arquivo: string;
  formato: "pdf" | "txt" | "md";
};

const LIVROS = livrosFixture as DemoLivro[];

/** Minúsculas e sem acento: quem digita sem acentuar tem que achar o mesmo livro. */
function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Palavras de ligação: sozinhas não dizem o assunto e casam por substring em quase todo texto. */
const LIGACAO = new Set([
  "como", "que", "uma", "uns", "umas", "para", "por", "com", "sem", "dos", "das", "nos", "nas",
  "aos", "mais", "muito", "qual", "quais", "isso", "esse", "essa", "este", "esta", "sobre",
  "entre", "quando", "onde", "pelo", "pela", "seu", "sua", "seus", "suas", "ser", "tem", "ter",
]);

function pontuar(query: string, livro: DemoLivro): number {
  const todos = semAcento(query).split(/\s+/).filter(Boolean);
  const uteis = todos.filter((t) => t.length > 2 && !LIGACAO.has(t));
  const termos = uteis.length > 0 ? uteis : todos;
  if (termos.length === 0) return 0;
  const alvo = semAcento(`${livro.titulo} ${livro.resumo} ${livro.tema}`);
  const acertos = termos.filter((t) => alvo.includes(t)).length;
  return acertos / termos.length;
}

export class DemoSearchProvider implements SemanticSearchProvider {
  async search(query: string, topK = 18): Promise<SearchHit[]> {
    return LIVROS.map((livro) => ({ livro, score: pontuar(query, livro) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ livro, score }) => ({
        score: Math.round(score * 1000) / 1000,
        livroId: livro.id,
        livroTitulo: livro.titulo,
        snippet: livro.resumo,
        chunkId: `${livro.arquivo}#0`,
        tipo: "livro" as const,
        fonteNome: "DEMO-LIVROS",
        linkLocal: `/livro/${livro.id}`,
        linkExterno: null,
      }));
  }
}
