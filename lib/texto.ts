/**
 * Corte seguro de texto vindo de fonte externa (legenda de Instagram, trecho de
 * livro, primeira linha de doc). Sem deps.
 *
 * Por que existe: `String.prototype.slice` corta por CODE UNIT UTF-16.
 * Emoji e texto matemático estilizado (as fontes 𝗕𝗢𝗟𝗗 do Instagram) ocupam 2
 * code units — um par de surrogates. Cortar no meio do par deixa um surrogate
 * solto, que NÃO é UTF-8 representável. As consequências não são cosméticas:
 *
 * - `JSON.stringify` emite `\ud83d` órfão → jq e parsers estritos de outras
 *   linguagens recusam o payload (o navegador aceita, então passa despercebido);
 * - `encodeURIComponent` LANÇA `URIError: URI malformed` → quebra link/rota.
 *
 * O invariante desta função: a saída é sempre well-formed, venha o que vier na
 * entrada — inclusive entrada que já chegou quebrada da origem.
 */

/** Um code point de 1 code unit na faixa D800–DFFF é surrogate órfão. */
function ehSurrogateOrfao(cp: string): boolean {
  if (cp.length !== 1) return false; // par válido vem como string de 2 code units
  const c = cp.charCodeAt(0);
  return c >= 0xd800 && c <= 0xdfff;
}

/**
 * Corta `raw` em no máximo `maxCodePoints` code points, descartando surrogates
 * órfãos. O budget conta code points (não code units) — fica mais perto do
 * comprimento visual, que é o que importa em label/snippet.
 *
 * Não adiciona elipse: é corte, não formatação.
 */
export function cortaTexto(raw: string, maxCodePoints: number): string {
  if (typeof raw !== "string" || raw.length === 0 || maxCodePoints <= 0) return "";

  const out: string[] = [];
  // o for..of de string itera por code point (respeita pares de surrogates)
  for (const cp of raw) {
    if (out.length >= maxCodePoints) break;
    if (ehSurrogateOrfao(cp)) continue;
    out.push(cp);
  }
  return out.join("");
}
