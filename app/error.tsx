"use client";

import Link from "next/link";

/**
 * Fronteira de erro das páginas. Sem ela, qualquer falha de Server Component
 * entrega a tela de erro genérica do Next — e o caso concreto que motiva isto é o
 * board corrompido: as duas páginas do kanban chamam `getBoard()` direto no
 * servidor, então a mensagem acionável ("restaure do snapshot") nunca chegava a
 * quem usa o app, só a clientes de API.
 *
 * Regra: mostra a mensagem e oferece recuperação — nunca sugere apagar dado.
 */
export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold">Essa página falhou ao carregar</h1>
      <p className="mt-3 text-[14px] text-[var(--bl-text-secondary)]">
        O resto do app continua funcionando — dá pra navegar pelas outras seções.
      </p>

      <pre className="mt-5 overflow-x-auto whitespace-pre-wrap rounded-[var(--bl-radius-sm)] bg-[var(--bl-bg-input)] p-3 font-mono text-[12px] text-[var(--bl-text-secondary)] ring-1 ring-[var(--bl-border)]">
        {error.message || "erro sem mensagem"}
      </pre>

      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={reset} className="bl-btn bl-btn-secondary bl-btn-sm">
          tentar de novo
        </button>
        <Link href="/" className="bl-btn bl-btn-secondary bl-btn-sm">
          voltar pra estante
        </Link>
      </div>

      {error.digest && (
        <p className="mt-4 font-mono text-[11px] text-[var(--bl-text-muted)]">
          digest {error.digest} — casa com a linha do log no terminal do servidor
        </p>
      )}

      <p className="mt-6 text-[12.5px] text-[var(--bl-text-muted)]">
        Se a mensagem falar de arquivo de dados corrompido, <strong>não apague nada</strong>:
        o app guarda um snapshot diário do board em <code>data/kanban/backups/</code> (ou na
        pasta de <code>BILHON_KANBAN_DIR</code>): copie o <code>board-AAAAMMDD.json</code> mais
        recente por cima de <code>board.json</code>, ou restaure da sua própria cópia.
      </p>
    </main>
  );
}
