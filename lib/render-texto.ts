/**
 * Render tipográfico mínimo de TXT/MD pra leitura (server-side, sem deps).
 * Não é um parser Markdown completo — cobre o que a base tem: headings,
 * negrito/itálico, listas, parágrafos. Tudo escapado antes (anti-XSS).
 */

function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function inline(s: string) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderTexto(raw: string, formato: "txt" | "md"): string {
  const linhas = esc(raw.replace(/\r\n/g, "\n")).split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let lista = false;
  let tabela: string[] = [];
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushLista = () => {
    if (lista) {
      out.push("</ul>");
      lista = false;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
      quote = [];
    }
  };
  const flushTabela = () => {
    if (tabela.length >= 2 && /^\|[\s:\-|]+\|$/.test(tabela[1])) {
      const celulas = (l: string) =>
        l.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const html: string[] = ['<div class="tabela-scroll"><table>'];
      html.push(
        "<thead><tr>" +
          celulas(tabela[0]).map((c) => `<th>${c}</th>`).join("") +
          "</tr></thead><tbody>",
      );
      for (const l of tabela.slice(2)) {
        html.push(
          "<tr>" + celulas(l).map((c) => `<td>${c}</td>`).join("") + "</tr>",
        );
      }
      html.push("</tbody></table></div>");
      out.push(html.join(""));
    } else {
      // não era tabela de verdade — vira parágrafo próprio (flush pra não grudar
      // na linha seguinte que disparou o flushTabela)
      para.push(...tabela);
      flushPara();
    }
    tabela = [];
  };

  for (const l of linhas) {
    const t = l.trim();
    if (formato === "md" && t.startsWith("|")) {
      flushPara();
      flushLista();
      flushQuote();
      tabela.push(t);
      continue;
    }
    if (tabela.length) flushTabela();
    if (!t) {
      flushPara();
      flushLista();
      flushQuote();
      continue;
    }
    const q = formato === "md" && t.match(/^&gt;\s?(.*)/);
    if (q) {
      flushPara();
      flushLista();
      quote.push(q[1]);
      continue;
    }
    const h = formato === "md" && t.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flushPara();
      flushLista();
      flushQuote();
      const n = Math.min(h[1].length + 1, 4);
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      continue;
    }
    const li = t.match(/^[-*•]\s+(.*)/);
    if (li) {
      flushPara();
      flushQuote();
      if (!lista) {
        out.push("<ul>");
        lista = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    para.push(t);
  }
  if (tabela.length) flushTabela();
  flushPara();
  flushLista();
  flushQuote();
  return out.join("\n");
}
