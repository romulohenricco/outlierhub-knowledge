import Link from "next/link";

const ABAS = [
  { id: "home", href: "/mysocialmedia", rotulo: "Início", desc: "visão geral" },
  { id: "instagram", href: "/mysocialmedia/instagram", rotulo: "Instagram", desc: "saves e contas" },
  { id: "youtube", href: "/mysocialmedia/youtube", rotulo: "YouTube", desc: "minhas playlists" },
] as const;

/** Abas entre as redes de /mysocialmedia — cada rede é um pipeline irmão com sua própria página. */
export function SocialAbas({ ativa }: { ativa: (typeof ABAS)[number]["id"] }) {
  return (
    <nav className="mb-5 flex gap-1 border-b border-[var(--bl-border)]" aria-label="Redes sociais">
      {ABAS.map((a) => (
        <Link
          key={a.id}
          href={a.href}
          aria-current={a.id === ativa ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
            a.id === ativa
              ? "border-[var(--bl-accent)] text-white/90"
              : "border-transparent text-white/40 hover:text-white/70"
          }`}
        >
          {a.rotulo}
          <span className="ml-1.5 hidden text-xs text-white/30 sm:inline">{a.desc}</span>
        </Link>
      ))}
    </nav>
  );
}
