/**
 * Minhas redes — as contas que você segue, categorizadas por nicho de atuação.
 * Primeira rede: Instagram; outras entram como pastas irmãs (mesmo formato de saída).
 *
 * Fonte (produzida por você, em <BILHON_SOCIAL_DIR>/instagram-contas/; formato em docs/redes-sociais.md):
 *   contas.json                     lista de contas (obrigatório pra a aba "Contas" ter algo)
 *   progresso.json                  opcional: sem ele, os totais saem das próprias contas
 *   nichos.json                     opcional: { "nichos": [{ "id", "rotulo" }] } — nome de cada nicho
 *   perfis/<username>/dossie.json   opcional: análise e posts de uma conta
 *   perfis/<username>/<miniatura>   miniaturas citadas pelo dossiê
 * O app só lê esta pasta. Quem coleta e classifica é você ou um script seu.
 */
import path from "node:path";
import { segmentoSeguro } from "./caminho-seguro";
export { rotuloNicho } from "./social-formato";
import { caminhoSocialPermitido, lerJsonSocial, pastaSocial } from "./social-dir";

export const contasDir = () => pastaSocial("instagram-contas");

export type Rede = "instagram";

export type ContaSocial = {
  username: string;
  nome: string;
  bio: string;
  seguidores: number;
  seguindo: number | null;
  posts: number;
  /** conta business/creator no IG — só essas têm `categoria` preenchida */
  negocio: boolean;
  /** categoria que o PRÓPRIO Instagram atribuiu à conta */
  categoria: string | null;
  privada: boolean;
  /** multi-label — uma conta pode cair em mais de um nicho (ids; o nome vem de nichos.json) */
  nichos: string[];
  rede: Rede;
};

export type ProgressoSocial = {
  atualizadoEm: string | null;
  total: number;
  comBio: number;
  semBio: number;
  porNicho: Record<string, number>;
};

export type SocialMedia = {
  contas: ContaSocial[];
  progresso: ProgressoSocial;
  /** id do nicho → nome de exibição (de nichos.json; id sem nome aparece "humanizado") */
  rotulosNichos: Record<string, string>;
};

/** Totais calculados das próprias contas — usados quando progresso.json não existe. */
export function progressoDe(contas: ContaSocial[]): ProgressoSocial {
  const porNicho: Record<string, number> = {};
  for (const c of contas) for (const n of c.nichos) porNicho[n] = (porNicho[n] ?? 0) + 1;
  const comBio = contas.filter((c) => c.bio.trim() !== "").length;
  return { atualizadoEm: null, total: contas.length, comBio, semBio: contas.length - comBio, porNicho };
}

function normalizarConta(c: ContaSocial): ContaSocial {
  return {
    ...c,
    nome: c.nome ?? "",
    bio: c.bio ?? "",
    seguidores: Number.isFinite(c.seguidores) ? c.seguidores : 0,
    nichos: Array.isArray(c.nichos) ? c.nichos.filter((n) => typeof n === "string") : [],
    categoria: c.categoria ?? null,
    negocio: Boolean(c.negocio),
  };
}

export async function getSocialMedia(): Promise<SocialMedia> {
  const dir = contasDir();
  const [brutas, progressoArq, nichos] = await Promise.all([
    lerJsonSocial<unknown>(path.join(dir, "contas.json"), []),
    lerJsonSocial<Partial<ProgressoSocial> | null>(path.join(dir, "progresso.json"), null),
    lerJsonSocial<{ nichos?: { id: string; rotulo: string }[] }>(path.join(dir, "nichos.json"), {}),
  ]);
  const contas = (Array.isArray(brutas) ? (brutas as ContaSocial[]) : [])
    .filter((c) => c && typeof c.username === "string" && c.username !== "")
    .map(normalizarConta);
  const derivado = progressoDe(contas);
  const progresso: ProgressoSocial =
    progressoArq && typeof progressoArq === "object"
      ? {
          atualizadoEm: progressoArq.atualizadoEm ?? null,
          total: progressoArq.total ?? derivado.total,
          comBio: progressoArq.comBio ?? derivado.comBio,
          semBio: progressoArq.semBio ?? derivado.semBio,
          porNicho: progressoArq.porNicho ?? derivado.porNicho,
        }
      : derivado;
  const rotulosNichos: Record<string, string> = {};
  for (const n of Array.isArray(nichos.nichos) ? nichos.nichos : []) {
    if (n && typeof n.id === "string" && typeof n.rotulo === "string") rotulosNichos[n.id] = n.rotulo;
  }
  return { contas, progresso, rotulosNichos };
}

export async function getConta(username: string): Promise<ContaSocial | null> {
  const { contas } = await getSocialMedia();
  return contas.find((c) => c.username === username) ?? null;
}

/**
 * Post de verdade do perfil (o CONTEÚDO da conta de terceiro, não o que você salvou),
 * coletado por você ou por um script seu. Texto + miniatura leve.
 */
export type PerfilPost = {
  code: string;
  caption: string;
  dataPost: string | null;
  likes: number | null;
  comentarios: number | null;
  tipo: "imagem" | "video" | "carrossel";
  /** nome do arquivo em perfis/<username>/ — null se a miniatura não existe */
  thumb: string | null;
};

export type Dossie = {
  username: string;
  ingeridoEm: string;
  posts: PerfilPost[];
  /** quem é a conta e por que é relevante pro seu benchmark, escrito por quem ingeriu */
  analise: string;
};

/** Componente de caminho seguro — username/arquivo vêm de rota, nunca confiar sem checar antes de virar caminho de disco. */
function nomeSeguro(s: string): boolean {
  return segmentoSeguro(s) && s.length < 200;
}

export async function getDossie(username: string): Promise<Dossie | null> {
  if (!nomeSeguro(username)) return null;
  const d = await lerJsonSocial<Dossie | null>(path.join(contasDir(), "perfis", username, "dossie.json"), null);
  if (!d || typeof d !== "object") return null;
  return { ...d, analise: d.analise ?? "", posts: Array.isArray(d.posts) ? d.posts : [] };
}

/** Caminho absoluto da miniatura de um post do dossiê, recusando qualquer escape. */
export function perfilThumbPathFor(username: string, arquivo: string): string | null {
  if (!nomeSeguro(username) || !nomeSeguro(arquivo)) return null;
  const perfis = path.join(contasDir(), "perfis");
  const abs = path.join(perfis, username, arquivo);
  if (!abs.startsWith(perfis + path.sep)) return null;
  return caminhoSocialPermitido(abs) ? abs : null;
}
