import { describe, it, expect } from "vitest";
import {
  aberturaDoTexto,
  dedupeVizinhos,
  escolheSinopse,
  promptDoLivro,
  repararLigaduras,
  temLigaduraPerdida,
  sumarioDoTexto,
} from "./livro-conteudo";

describe("dedupeVizinhos — o mesmo livro em PDF e TXT não aparece 2×", () => {
  it("mantém só a 1ª ocorrência de cada título (a de maior afinidade)", () => {
    const v = dedupeVizinhos([
      { id: "livro-a", titulo: "Livro A", score: 0.92 },
      { id: "livro-b", titulo: "Livro B Com Titulo Longo", score: 0.914 },
      { id: "livro-b-txt", titulo: "Livro B Com Titulo Longo", score: 0.914 },
    ]);
    expect(v.map((x) => x.id)).toEqual(["livro-a", "livro-b"]);
  });

  it("compara título sem caixa e sem espaço sobrando", () => {
    const v = dedupeVizinhos([
      { id: "x", titulo: "Sapiens ", score: 0.9 },
      { id: "y", titulo: "sapiens", score: 0.8 },
    ]);
    expect(v).toHaveLength(1);
  });
});

describe("aberturaDoTexto — 1º trecho de prosa, pulando ficha técnica", () => {
  const prosa =
    "A inteligência artificial deixou de ser ficção. Ela já decide o que lemos, " +
    "quem é contratado e como o crédito é concedido, e a pergunta que este livro " +
    "faz é simples: o que acontece com a ideia de ser humano quando a máquina " +
    "passa a imitar o que achávamos exclusivo nosso?";

  it("pula copyright/ISBN/créditos e devolve a prosa", () => {
    const texto = [
      "Copyright © 2020 por Fulano de Tal. Todos os direitos reservados, " +
        "nenhuma parte desta publicação pode ser reproduzida sem permissão do editor.",
      "Edição ePub © abril de 2020: ISBN 978-0-310-10958-7 — www.editora-exemplo.com " +
        "e demais endereços de internet são oferecidos apenas como recurso ao leitor.",
      prosa,
    ].join("\n\n");
    expect(aberturaDoTexto(texto)).toContain("A inteligência artificial deixou de ser ficção");
    expect(aberturaDoTexto(texto)).not.toMatch(/ISBN|Copyright/);
  });

  it("junta quebras de linha do PDF dentro do parágrafo", () => {
    const quebrado = prosa.replace(/, /g, ",\n");
    expect(aberturaDoTexto(quebrado)).not.toContain("\n");
  });

  it("respeita o limite e corta por code point (sem surrogate solto)", () => {
    const longo = `${"💡 ideia importante sobre o mundo. ".repeat(80)}`;
    const a = aberturaDoTexto(longo, 300)!;
    expect([...a].length).toBeLessThanOrEqual(301); // + reticência
    expect(a.isWellFormed()).toBe(true);
  });

  it("começa no Prefácio/Introdução de verdade, não no índice nem na ficha", () => {
    const texto = [
      "Sumário\nPrefácio\nIntrodução\n1. Mapeando o território",
      "Sobrenome, Nome Título do livro [recurso eletrônico]: subtítulo qualquer sobre o tema central " +
        "da obra / tradução Fulana. – 1. ed. – Cidade: Editora, 2023. recurso digital",
      "Informações sobre hiperlinks externos neste e-book: as notas de rodapé podem conter links para sites " +
        "externos como parte de citações bibliográficas, que não foram ativados pelo editor do livro.",
      "Prefácio",
      prosa,
    ].join("\n\n");
    expect(aberturaDoTexto(texto)).toMatch(/^A inteligência artificial/);
  });

  it("tira o front-matter YAML e aceita parágrafo longo com link no meio", () => {
    const md = `---\ntitle: "X"\nsource: https://x.com\n---\n\n${prosa} Veja mais em https://exemplo.com depois.`;
    expect(aberturaDoTexto(md)).toMatch(/^A inteligência artificial/);
  });

  it("sem prosa utilizável devolve null (não inventa resumo)", () => {
    expect(aberturaDoTexto("ISBN 123\n\nCapítulo 1\n\n12")).toBeNull();
  });
});

describe("sumarioDoTexto — índice declarado no próprio livro", () => {
  it("lê as linhas curtas logo depois de 'Sumário'", () => {
    const texto = [
      "Dedicatória",
      "",
      "Sumário",
      "Introdução",
      "1. O que é inteligência artificial ........ 13",
      "2. A IA restrita 41",
      "",
      "CAPÍTULO",
      ": Capítulo Final",
      "Agradecimentos",
      "",
      "Este é um parágrafo longo de prosa que já é o corpo do livro e não deve " +
        "entrar no sumário de jeito nenhum porque passa muito do tamanho de um título.",
    ].join("\n");
    expect(sumarioDoTexto(texto)).toEqual([
      "Introdução",
      "1. O que é inteligência artificial",
      "2. A IA restrita",
      "Capítulo Final",
      "Agradecimentos",
    ]);
  });

  it("para quando um item se repete — é o corpo do livro começando", () => {
    const texto = "CONTEÚDO\nPrefácio\nMapeando o Território\nÍndice Geral\nPREFÁCIO\nEste livro representa";
    expect(sumarioDoTexto(texto)).toEqual(["Prefácio", "Mapeando o Território", "Índice Geral"]);
  });

  it("junta item quebrado em 2 linhas ('Índice das' / 'Escrituras Índice' / 'Geral')", () => {
    const texto = [
      "CONTEÚDO",
      "Prefácio",
      "CAPÍTULO 12",
      "Um capítulo sobre o futuro",
      "CAPÍTULO 13",
      "O tempo do fim",
      "Índice das",
      "Escrituras Índice",
      "Geral",
      "",
      "PREFÁCIO",
      "Este livro representa",
    ].join("\n");
    expect(sumarioDoTexto(texto)).toEqual([
      "Prefácio",
      "Um capítulo sobre o futuro",
      "O tempo do fim",
      "Índice das Escrituras",
      "Índice Geral",
    ]);
  });

  it("junta quando a linha seguinte começa com preposição/artigo (continuação)", () => {
    expect(sumarioDoTexto("Contents\nThe Rise\nof the Machines\nEpilogue")).toEqual([
      "The Rise of the Machines",
      "Epilogue",
    ]);
  });

  it("não junta títulos independentes que só terminam em palavra comum", () => {
    expect(sumarioDoTexto("Contents\nPart One\nPart Two")).toEqual(["Part One", "Part Two"]);
  });

  it("aceita Índice/Conteúdo/Contents e devolve [] quando não há", () => {
    expect(sumarioDoTexto("CONTENTS\nPart One\nPart Two")).toEqual(["Part One", "Part Two"]);
    expect(sumarioDoTexto("só prosa, nenhum índice aqui")).toEqual([]);
  });
});

describe("promptDoLivro — contexto pronto pra colar num agente", () => {
  it("traz caminho, chunks indexados, conceitos e o espaço da tarefa", () => {
    const p = promptDoLivro({
      titulo: "Livro de Exemplo",
      path: "data/livros/arquivos/livro-exemplo.pdf",
      formato: "pdf",
      paginas: 257,
      chunksTotal: 177,
      tema: "Tecnologia",
      dominio: "tecnologia",
      nivelNome: "profissional (trade book)",
      conceitos: ["conceito alfa", "conceito beta"],
    });
    expect(p).toContain('"Livro de Exemplo"');
    expect(p).toContain("data/livros/arquivos/livro-exemplo.pdf");
    expect(p).toContain("PDF · 257 págs.");
    expect(p).toContain("177 chunks");
    expect(p).toContain("conceito alfa, conceito beta");
    expect(p).toMatch(/Tarefa:/);
  });

  it("omite linhas sem dado em vez de imprimir 'undefined'", () => {
    const p = promptDoLivro({
      titulo: "Notas",
      path: "/x/notas.md",
      formato: "md",
      paginas: null,
      chunksTotal: 0,
      tema: "Outros",
      conceitos: [],
    });
    expect(p).not.toMatch(/undefined|null|Conceitos/);
  });
});

const DEFEITO = "arti cial signi ca.";
const DEFEITO_OK = "artificial significa.";

describe("repararLigaduras — 'fi'/'fl' que o extrator trocou por espaço", () => {
  it.each([
    ["inteligência arti cial", "inteligência artificial"],
    ["Inteligência arti cial – Aspectos", "Inteligência artificial – Aspectos"],
    ["o que signi cará e signi ca", "o que significará e significa"],
    ["um campo especí co e cientí ca", "um campo específico e científica"],
    ["é in nito, de nição de nido, de nir", "é infinito, definição definido, definir"],
    ["su ciente e su cientes", "suficiente e suficientes"],
    ["no nal, recursos nanceiros", "no final, recursos financeiros"],
    ["o que ca e eles cam", "o que fica e eles ficam"],
    ["o uxo e a in uência", "o fluxo e a influência"],
    ["con ito, re exo, re etir, in ação", "conflito, reflexo, refletir, inflação"],
    ["modi car e veri car", "modificar e verificar"],
    ["di culdade", "dificuldade"],
    ["a gami cação e a o cial", "a gamificação e a oficial"],
    ["In nito começa a frase", "Infinito começa a frase"],
  ])("%s", (entrada, esperado) => {
    // o prefixo liga o gate (≥ 2 sinais do defeito); a linha em si é o que se testa
    expect(repararLigaduras(`${DEFEITO} ${entrada}`)).toBe(`${DEFEITO_OK} ${esperado}`);
  });

  it.each([
    "de nada, no caso, um campo, cada caminho",
    "a ficção e o final já corretos",
    "de nicho, os cientistas, de cada, em casa",
    "a ação, de ação, a agricultura, o rei cruel",
    "Rei de Espanha e a casa",
    "o origami de Nick, de Nicolau, in vitro",
    "veja https://x.org/no-one-ca/y e a-ca",
  ])("não mexe no que está certo: %s", (t) => {
    expect(repararLigaduras(`${DEFEITO} ${t}`)).toBe(`${DEFEITO_OK} ${t}`);
  });
});

describe("escolheSinopse — LLM local vence o classificador", () => {
  it("usa a sinopse do LLM quando existe", () => {
    expect(escolheSinopse({ sinopse: " Ensina X. " }, { justificativa: "registro Y" })).toEqual({
      sinopse: "Ensina X.",
      fonte: "llm-local",
    });
  });
  it("cai na justificativa do niveis.json sem LLM", () => {
    expect(escolheSinopse(undefined, { justificativa: "registro Y" })).toEqual({
      sinopse: "registro Y",
      fonte: "classificador",
    });
    expect(escolheSinopse({ sinopse: "  " }, { justificativa: "registro Y" }).fonte).toBe("classificador");
  });
  it("sem nenhuma das duas → null", () => {
    expect(escolheSinopse(undefined, undefined)).toEqual({ sinopse: null, fonte: null });
  });
});

describe("temLigaduraPerdida — só repara texto que TEM a assinatura do defeito", () => {
  it("detecta o texto com defeito (≥ 2 sinais inequívocos)", () => {
    expect(temLigaduraPerdida("a inteligência arti cial signi ca muito")).toBe(true);
    expect(temLigaduraPerdida("o que é in nito e a de nição de nida")).toBe(true);
  });
  it("1 sinal só ou nenhum → não é o defeito", () => {
    expect(temLigaduraPerdida("a inteligência arti cial é um tema")).toBe(false);
    expect(temLigaduraPerdida("texto normal em português, a ficção é isso")).toBe(false);
  });
  it("texto em inglês com 'car'/'can' fica intacto", () => {
    const en = "The car can stop. A car ca not be final; nal means nothing. I will car about it.";
    expect(repararLigaduras(en)).toBe(en);
  });
  it("PT normal sem defeito fica intacto, mesmo com 'de nada' e 'no caso'", () => {
    const pt = "No caso, de nada. Ele disse que a ficção ca no campo, car é raro.";
    expect(repararLigaduras(pt)).toBe(pt);
  });
  it("texto com o defeito real é reparado (inclusive fragmentos soltos)", () => {
    expect(repararLigaduras("A arti cial signi ca isso e ele ca e no nal")).toBe(
      "A artificial significa isso e ele fica e no final",
    );
  });
});
