/**
 * Link vindo dos arquivos de dados das redes (`url` de save, de vídeo, de playlist).
 * O dado é de quem o coletou, não do app: só http(s) vira `href`. `javascript:`,
 * `data:` e afins viram `undefined` (o componente não renderiza o link).
 */
export function urlHttp(u: unknown): string | undefined {
  if (typeof u !== "string") return undefined;
  try {
    const url = new URL(u.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
