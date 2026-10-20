import type { ReactNode } from "react";
import { FolderOpen } from "lucide-react";

/**
 * Estado vazio das telas de /mysocialmedia: nada foi colocado em BILHON_SOCIAL_DIR ainda.
 * Diz quais arquivos a tela lê (sem caminho absoluto: o da sua máquina não precisa ir à tela).
 */
export function SocialVazio({
  titulo,
  arquivos,
  children,
}: {
  titulo: string;
  /** caminhos relativos à pasta de dados das redes, ex.: "instagram-saves/saves.json" */
  arquivos: string[];
  children?: ReactNode;
}) {
  return (
    <section className="flex gap-3 rounded-[var(--bl-radius-md)] border border-dashed border-[var(--bl-border)] p-5 text-sm text-white/50">
      <FolderOpen className="mt-0.5 h-5 w-5 shrink-0 text-white/25" />
      <div className="min-w-0">
        <p className="mb-1 font-medium text-white/70">{titulo}</p>
        {children ? <div className="mb-2 text-xs leading-relaxed text-white/45">{children}</div> : null}
        <ul className="mb-2 space-y-0.5 text-xs">
          {arquivos.map((a) => (
            <li key={a}>
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-white/65">{a}</code>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-white/35">
          Dentro da pasta de dados das redes (<code className="text-white/55">BILHON_SOCIAL_DIR</code>, padrão{" "}
          <code className="text-white/55">data/social</code>). Formato de cada arquivo em{" "}
          <code className="text-white/55">docs/redes-sociais.md</code>.
        </p>
      </div>
    </section>
  );
}
