/**
 * Knowledge — types do domínio LIVRO (client + server).
 *
 * Fonte de dados: filesystem local (data/livros) + artefatos de análise
 * gerados a partir dele — sem banco, sem rede externa.
 */

export type Formato = "pdf" | "txt" | "md";

/** Rótulo livre de onde o livro veio (ex.: "INBOX", "demo"). A estante agrupa
 *  pelos valores que o catálogo trouxer; nenhum é obrigatório. */
export type Origem = string;

export type Vizinho = {
  id: string;
  titulo: string;
  score: number; // cosseno bge-m3 entre centroides (0..1)
};

export type Livro = {
  id: string; // slug derivado do nome do arquivo
  titulo: string;
  arquivo: string; // nome real do arquivo na pasta de livros
  formato: Formato;
  tema: string; // tema atribuído ao livro no catálogo
  dominio?: string; // domínio do livro — sidecar livros-dominios.json
  checksum?: string; // SHA-256 do conteúdo — sidecar livros-hashes.json
  cluster: number | null; // nº do cluster kNN-mútuo (null = solitário)
  origem: Origem;
  sizeBytes: number;
  temCapa: boolean;
};

export type LivroDetalhe = Livro & {
  vizinhos: Vizinho[];
  proveniencia: {
    origemPath: string;
    motivo: string;
  } | null;
  /** Path absoluto atual no disco (onde está / qual pasta). */
  path: string;
  /** Nº de páginas (PDF via pdfinfo; null p/ TXT/MD). */
  paginas: number | null;
  /** Nº de chunks indexados no store semântico. */
  chunksTotal: number;
};

export type SearchHit = {
  score: number;
  livroId: string | null; // null se o doc do hit não estiver no catálogo
  livroTitulo: string;
  snippet: string;
  chunkId: string;
  /** federado: de qual acervo o hit veio */
  tipo: "livro" | "canal" | "clickup" | "cursos" | "bilhon";
  fonteNome: string; // slug do store de origem (nome configurado no seu corpus)
  linkLocal: string; // leitura local (leitor de livro ou transcript)
  linkExterno: string | null; // YouTube / ClickUp, quando existir
};

export type SearchResposta =
  | { ok: true; query: string; hits: SearchHit[] }
  | { ok: false; erro: "ollama-offline" | "query-vazia" | "backend"; detalhe?: string };



export type EcoKind =
  | "squad"
  | "agent"
  | "skill"
  | "workflow"
  | "clone"
  | "shadow"
  | "worker"
  | "engine"
  | "repo";


/** Eixo de admissão: "propria" é o que o usuário configurou como seu, "adotada" é de terceiro incorporada de propósito e "terceiro" é conteúdo de fora. */
export type EcoProcedencia = "propria" | "adotada" | "terceiro";


export type EcoUsoStatus = "frequente" | "ocasional" | "raro" | "sem-sinal";

export const ECO_USO_STATUS: readonly EcoUsoStatus[] = [
  "frequente",
  "ocasional",
  "raro",
  "sem-sinal",
] as const;

/** Guarda de runtime: o overlay é um arquivo externo, não dá pra confiar no cast. */
export function ehEcoUsoStatus(v: unknown): v is EcoUsoStatus {
  return typeof v === "string" && (ECO_USO_STATUS as readonly string[]).includes(v);
}


export type EcoUso = {
  eventos: number; // entradas do log de execução com esse id
  logsession: number; // nº de registros de sessão que citam o componente
  invocacao: number; // invocações observadas (skill, comando ou script)
  leitura_fraca: number; // arquivo da skill lido (evidência fraca, fora da classificação)
  sinais: number; // quantas das 3 fontes trouxeram algum sinal (0..3)
  status: EcoUsoStatus;
  dias: number; // dias distintos com atividade no log de execução
  ultimo: string | null; // último dia com atividade (YYYY-MM-DD)
  ambiguo: boolean; // nome colide com palavra comum → menções não contadas
  tocada_por_teste: boolean; // exercitada por teste automatizado: parte do volume pode não ser uso
  proveniencia: "atribuida" | "incerta";
  fontes: string[]; // trilha legível de onde cada número veio
};

/**
 * Identidade tipada: kind+namespace+name é a chave real, livre de colisão (o mesmo
 * `name` pode existir em fontes diferentes, com `namespace` diferente). `id` é sempre
 * derivado dela via `identidadeTipada` — nenhum parser monta `id` na mão — salvo
 * quando o registro traz um `rid` próprio, que então é a identidade. `legacyId` guarda
 * um formato anterior só para ler marcações (favoritos/ocultos) gravadas com ele.
 */
export type EcoEntity = {
  id: string; // = identidadeTipada(kind, namespace, name) — única fonte de escrita
  legacyId: string; // formato antigo, mantido só por compat de leitura (dual-read)
  kind: EcoKind;
  namespace: string; // fonte/proveniência que desambigua `name` repetido entre fontes
  name: string; // slug estável dentro do namespace — kind+namespace+name nunca colide
  subtype?: string; // refinamento do kind, quando a fonte informa (ex.: categoria do item)
  nome: string;
  descricao: string;
  origem: string; // fonte de onde veio (ex.: "registro", "repos.json")
  path: string; // path real, relativo à raiz configurada (BILHON_ROOT)
  /** Eixo de admissão — decidido em `derivarProcedencia`, nunca escrito à mão por
   *  parser (mesmo contrato do `id`/`identidadeTipada`). */
  procedencia: EcoProcedencia;
  squadId?: string; // pai lógico tipado (worker → squad; item → squad dono)
  tags: string[]; // rótulos livres da fonte (status, categoria, linguagem…)
  meta: Record<string, string | number | boolean | null>;
  uso?: EcoUso; // ausente = componente fora do alcance da medição
};

/** Por que uma fonte do inventário veio vazia (para a tela dizer o que configurar). */
export type EcoFonteEstado = "nao-configurada" | "ausente" | "fora-da-raiz" | "invalida" | "ok";

export type EcoFonte = {
  id: "registro" | "repos" | "espelhos" | "uso";
  env: string; // variável que aponta para a fonte
  estado: EcoFonteEstado;
};

export type Ecosystem = {
  entities: EcoEntity[];
  counts: Record<EcoKind, number>;
  /** Quebra por eixo de admissão — responde "quanto disso é meu?" sem varrer
   *  a lista. Soma sempre igual a `entities.length` (testado). */
  countsPorProcedencia: Record<EcoProcedencia, number>;
  geradoEm: string; // ISO — só informativo, dado é sempre lido ao vivo
  fontes?: EcoFonte[]; // estado de cada fonte lida (ausente em fixtures antigas)
};

// ── Kanban — tickets de ingest/clones/autolearning/melhoria ──

/** Coluna é dinâmica (usuário pode criar/renomear/excluir) — id é um slug estável. */
export type KanbanColunaId = string;

export type KanbanColuna = {
  id: KanbanColunaId;
  rotulo: string;
};

/** Tipo do ticket — define o prefixo do ID e o filtro/badge no board. */
export type KanbanTipo = "ingest" | "clone" | "autolearning" | "feature" | "melhoria" | "bug" | "infra" | "outro";


export const TIPOS_COM_GATE_MERGE: KanbanTipo[] = ["bug", "feature", "melhoria", "infra"];

/** Texto do item obrigatório — casamento exato por texto (checklist não tem
 *  id próprio). Servidor re-adiciona sozinho se for apagado (ver
 *  garantirDoD em lib/kanban.ts) — não editável, não removível. */
export const ITEM_GATE_MERGE = "commit + push + PR aberto + merge feito";

/** Definição de Pronto por tipo — o que precisa estar verdadeiro pra um card
 *  entrar em "done".
 *
 *  O board autoconclui quando o checklist chega a 100%; sem um critério na mão
 *  contrária, `moverCard` aceitaria qualquer card em "done" com checklist
 *  vazio — e como status nunca volta, fechar sem critério seria irreversível.
 *
 *  A DoD é avaliada contra este template, não contra o que está gravado no
 *  card — card antigo de checklist vazio é medido igual, sem precisar de
 *  migração em massa do board.json. Troque os textos pelos critérios do seu
 *  time (o casamento no checklist é por texto exato). */
export const DOD_POR_TIPO: Record<KanbanTipo, string[]> = {
  bug: [
    "causa raiz registrada na descrição",
    "teste que falha antes e passa depois",
    "suíte relevante verde",
    ITEM_GATE_MERGE,
  ],
  feature: [
    "critério de aceite verificado item a item",
    "teste cobrindo o critério de aceite",
    "suíte relevante verde",
    ITEM_GATE_MERGE,
  ],
  melhoria: [
    "ganho medido antes/depois (ou por que não é mensurável)",
    "evidência de não-regressão",
    ITEM_GATE_MERGE,
  ],
  infra: [
    "mudança validada no ambiente alvo",
    "rollback documentado",
    "gate de deploy aprovado quando toca deploy ou exposição",
    ITEM_GATE_MERGE,
  ],
  ingest: [
    "contagem conferida: esperado × processado",
    "proveniência registrada por item",
    "artefatos gravados no destino configurado",
    "amostra verificada à mão",
  ],
  clone: [
    "camadas do clone geradas e validadas",
    "recall provado pelo fluxo padrão",
    "dossiê e cópias de referência reconciliados",
  ],
  autolearning: [
    "ciclo rodado com métrica antes/depois",
    "veredito registrado: keep ou discard",
  ],
  outro: [
    "resultado registrado na descrição do card",
    "próximo passo definido (ou explicitamente nenhum)",
  ],
};

export type KanbanPrioridade = "baixa" | "media" | "alta" | "urgente";

/** Projetos que o board aceita num ticket. A lista vem de
 *  NEXT_PUBLIC_KANBAN_PROJETOS (CSV) — com NEXT_PUBLIC_ para que o navegador
 *  (filtro e formulário) e o servidor (validação do PATCH) leiam a MESMA lista.
 *  Variável em branco = ausente: vale ["geral", "outro"]. "outro" é sempre aceito
 *  e fica por último; o primeiro item é o projeto de um ticket novo. */
function lerProjetos(bruto: string): string[] {
  const lista = bruto
    .split(",")
    .map((p) => p.trim())
    .filter((p) => /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u.test(p) && p !== "outro");
  return [...new Set(lista.length > 0 ? lista : ["geral"]), "outro"];
}

export const KANBAN_PROJETOS: readonly string[] = lerProjetos(process.env.NEXT_PUBLIC_KANBAN_PROJETOS || "");
export const KANBAN_PROJETO_PADRAO: string = KANBAN_PROJETOS[0];

/** Projeto ao qual o ticket pertence — um dos valores de KANBAN_PROJETOS. */
export type KanbanProjeto = string;

/** Onde o pedido foi feito — pra nunca perder o "de onde veio isso". */
export type KanbanCanalPedido = "terminal" | "kanban" | "doc" | "chat" | "outro";

/** Bucket de ingestão — mantém separados o que é externo, pessoal e de negócio. */
export type KanbanBucket = "external" | "personal" | "business";

export type KanbanChecklistItem = {
  texto: string;
  feito: boolean;
};

export type KanbanHistoricoEntry = {
  /** ausente = "coluna" (compat com entradas antigas): transição de coluna do
   *  board. "checklist": item marcado feito/reaberto — de/para replicam a
   *  coluna atual do card só pra manter o tipo, o que importa é `nota`. */
  tipo?: "coluna" | "checklist";
  de: KanbanColunaId | null;
  para: KanbanColunaId;
  em: string; // ISO
  /** evidência da transição — o que foi feito de verdade, pra achar o caminho
   *  exato depois (log, trilha de execução, tarefa externa…). Opcional, editável
   *  a qualquer momento, não só na hora da transição. */
  nota?: string;
  links?: KanbanLink[];
};

/** Metadados de origem do pedido — melhor ter todos os campos disponíveis do
 *  que adivinhar; o que não for informado fica vazio pra preencher depois. */
export type KanbanOrigem = {
  canal: KanbanCanalPedido | null;
  pedidoOriginal: string | null; // texto literal do pedido (terminal/kanban/doc)
  solicitadoPor: string | null;
};

export type KanbanFonteTipo = "livro" | "canal" | "clickup" | "curso" | "video" | "pdf" | "doc" | "outro";

/** Metadados específicos de ticket de ingestão (tipo=ingest|clone). Um ticket
 *  costuma puxar de mais de uma fonte ao mesmo tempo (ex.: artigo + instagram
 *  + youtube pro mesmo tema) — por isso fonteTipo/fonteUrl/fontePath são
 *  arrays, nunca valor único (regra: toda "função" de anexar aceita 1+). */
export type KanbanIngestao = {
  fonteTipo: KanbanFonteTipo[];
  fonteUrl: string[];
  fontePath: string[];
  bucket: KanbanBucket | null;
  pessoaAutor: string | null;
};

/** Plataforma do link — cobre execução (clickup/github/output/doc) e conteúdo
 *  externo (cloud/redes/blog/imprensa). Ícone+cor por tipo em components/Kanban.tsx. */
export type KanbanLinkTipo =
  | "clickup"
  | "github"
  | "output"
  | "doc"
  | "drive"
  | "youtube"
  | "instagram"
  | "x"
  | "tiktok"
  | "linkedin"
  | "blog"
  | "imprensa"
  | "outro";

export type KanbanLink = {
  tipo: KanbanLinkTipo;
  url: string;
  /** só usado em tipo=github — nome do repo, pra achar o commit exato sem
   *  confundir entre projetos que rodam em paralelo. */
  repo?: string | null;
};

/** Nota de áudio anexada ao ticket — arquivo vive em
 *  KANBAN_DIR/audio/<cardId>/, referenciado aqui. */
export type KanbanAudio = {
  arquivo: string;
  criadoEm: string; // ISO
};

/** Imagem anexada ao ticket (print de tela, referência visual…) — arquivo vive em
 *  KANBAN_DIR/imagens/<cardId>/, referenciado aqui. */
export type KanbanImagem = {
  arquivo: string;
  criadoEm: string; // ISO
  legenda?: string;
};

/** Vínculo com um item já existente no acervo (livro, canal,
 *  clickup, curso…) — reaproveita a MESMA classificação da busca federada
 *  (`SearchHit.tipo`), sem inventar taxonomia nova. */
export type KanbanVinculo = {
  tipo: SearchHit["tipo"];
  id: string;
  titulo: string;
  linkLocal: string | null;
};

/** Quem executou o ticket de verdade — agente, humano ou os dois.
 *  "misto" é o único modo que usa pctAgente (0-100). */
export type KanbanExecucao = {
  modo: "agente" | "humano" | "misto";
  pctAgente?: number;
  executor?: string; // nome do agent/modelo/squad, ou da pessoa
};

export type KanbanCard = {
  id: string; // ex.: ING-1, CLN-3, MEL-2 — prefixo pelo tipo + contador sequencial
  titulo: string;
  /** tudo que é necessário pra executar o ticket vive aqui (markdown livre). */
  descricao: string;
  tipo: KanbanTipo;
  prioridade: KanbanPrioridade;
  projeto: KanbanProjeto;
  coluna: KanbanColunaId;
  ordem: number; // posição dentro da coluna (drag-and-drop)
  responsavel: string | null;
  tags: string[];
  origem: KanbanOrigem;
  ingestao: KanbanIngestao;
  links: KanbanLink[];
  vinculos: KanbanVinculo[];
  audios: KanbanAudio[];
  imagens: KanbanImagem[];
  checklist: KanbanChecklistItem[];
  historico: KanbanHistoricoEntry[];
  execucao: KanbanExecucao | null;
  criadoEm: string; // ISO
  atualizadoEm: string; // ISO
  concluidoEm: string | null; // ISO — setado ao mover pra "done"
};

export type KanbanBoard = {
  atualizadoEm: string;
  colunas: KanbanColuna[];
  wipLimites: Partial<Record<KanbanColunaId, number>>;
  contadores: Record<KanbanTipo, number>;
  cards: KanbanCard[];
};
