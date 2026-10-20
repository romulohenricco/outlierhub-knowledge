/**
 * Regra ÚNICA pra pedaço de caminho que vem de rota pública (nome de arquivo,
 * slug, nome de usuário). Aceita só UM segmento: nada de separador, nada de
 * `.`/`..`, nada de NUL.
 *
 * Por que não `s.includes("..")`: isso recusava nome legítimo ("Yes,
 * but....jpg" → 400) e dava falsa sensação de cobertura. Quem usa isto deve
 * checar TODOS os segmentos que entram no `path.join`, e manter a checagem de
 * contenção na raiz (`caminhoDentroDaRaiz`) como segunda tranca.
 */
export function segmentoSeguro(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length > 0 &&
    s !== "." &&
    s !== ".." &&
    !s.includes("/") &&
    !s.includes("\\") &&
    !s.includes("\0")
  );
}
