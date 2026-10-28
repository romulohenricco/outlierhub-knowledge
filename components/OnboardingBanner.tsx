import { TriangleAlert } from "lucide-react";

/** Renderizado no lugar do app quando o provider ativo não está configurado —
 *  nunca deixa a página quebrar com stack trace genérico. */
export function OnboardingBanner({ reason }: { reason: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
      <TriangleAlert className="h-8 w-8 text-[var(--bl-gold)]" strokeWidth={1.75} />
      <h1 className="mt-4 text-lg font-semibold text-white/90">Provider não configurado</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--bl-text-secondary)]">{reason}</p>
      <p className="mt-4 rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] px-3 py-2 font-mono text-xs text-[var(--bl-text-dim)]">
        BILHON_KNOWLEDGE_PROVIDER=demo
      </p>
      <p className="mt-2 text-xs text-white/30">
        (padrão sem configuração — biblioteca, grafo e busca com dados de exemplo; o kanban começa vazio)
      </p>
      <p className="mt-2 text-xs text-white/30">
        Para usar o seu Supabase: BILHON_KNOWLEDGE_PROVIDER=supabase (veja o .env.example).
      </p>
      <p className="mt-2 text-xs text-white/30">
        Para o índice local do Megabrain: rode npm run populate e use BILHON_KNOWLEDGE_PROVIDER=local (veja docs/provider-local.md).
      </p>
    </main>
  );
}
