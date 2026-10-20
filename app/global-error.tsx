"use client";

/**
 * Último recurso: falha no próprio layout raiz, onde `app/error.tsx` não é
 * montado. Precisa trazer <html>/<body> por conta própria e não pode
 * depender de nada do AppShell — se o layout é o que quebrou, qualquer import
 * dele quebraria aqui também. Estilo inline de propósito.
 */
export default function ErroGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          padding: "4rem 1.5rem",
          fontFamily: "system-ui, sans-serif",
          background: "#0b0b0c",
          color: "#e8e8ea",
        }}
      >
        <main style={{ maxWidth: "40rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>O app não conseguiu iniciar</h1>
          <p style={{ color: "#a0a0a8", fontSize: "0.9rem" }}>
            A falha é no layout raiz, então nem a navegação carregou.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#16161a",
              padding: "0.75rem",
              borderRadius: 6,
              fontSize: "0.78rem",
              color: "#c8c8d0",
              overflowX: "auto",
            }}
          >
            {error.message || "erro sem mensagem"}
            {error.digest ? `\n\ndigest ${error.digest}` : ""}
          </pre>
          <button
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.4rem 0.9rem",
              background: "#26262c",
              color: "#e8e8ea",
              border: "1px solid #3a3a44",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            tentar de novo
          </button>
          <p style={{ color: "#7a7a84", fontSize: "0.78rem", marginTop: "1.5rem" }}>
            Nenhum dado é apagado por esta tela. Verifique o terminal onde o
            servidor roda — o erro completo está lá.
          </p>
        </main>
      </body>
    </html>
  );
}
