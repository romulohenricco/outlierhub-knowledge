import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getSocialMedia } from "@/lib/social";
import { getInstagramSaves } from "@/lib/instagram-saves";
import { getYoutubePlaylists } from "@/lib/youtube-playlists";
import { getReferencias } from "@/lib/referencias";
import { rotuloNicho } from "@/lib/social-formato";
import { contarStatus } from "@/lib/triagem";
import { SocialAbas } from "@/components/SocialAbas";
import { SocialVazio } from "@/components/SocialVazio";

export const dynamic = "force-dynamic";

export const metadata = { title: "Minhas redes · Knowledge" };

type Numero = { rotulo: string; valor: number | string; dica?: string };

export default async function SocialHomePage() {
  const [{ contas, progresso, rotulosNichos }, ig, yt, refs] = await Promise.all([
    getSocialMedia(),
    getInstagramSaves(),
    getYoutubePlaylists(),
    getReferencias().catch(() => null),
  ]);

  // "pendentes" = sem decisão sua e ainda fora de /referencias — o que de fato espera triagem
  const tIg = contarStatus(ig.saves.length, ig.decisoes, ig.emReferencias);
  const tYt = contarStatus(yt.videos.length, yt.decisoes, yt.emReferencias);
  const nRefs = (plataforma: string) =>
    (refs?.posts ?? []).filter((p) => (p.plataforma ?? "instagram") === plataforma).length;
  const topNichos = Object.entries(progresso.porNicho)
    .filter(([n]) => n !== "outro")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([n, q]) => [rotuloNicho(n, rotulosNichos), q] as const);
  const topCatIg = ig.categorias.filter((c) => c.id !== "outro" && c.n > 0).slice(0, 4);
  const topCatYt = yt.categorias.filter((c) => c.id !== "outro" && c.n > 0).slice(0, 4);
  const semDados = ig.saves.length === 0 && yt.videos.length === 0 && contas.length === 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <SocialAbas ativa="home" />
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Minhas redes</h1>
        <p className="mt-1 text-xs text-white/40">
          o que você segue, o que guardou e o que já virou referência — cada rede é um inventário para triar; só o que passa por ingestão com prompt reverso entra em /referencias
        </p>
      </div>

      {semDados && (
        <div className="mb-6">
          <SocialVazio
            titulo="Nada nas redes ainda"
            arquivos={[
              "instagram-saves/saves.json",
              "instagram-contas/contas.json",
              "youtube-playlists/playlists.json",
              "youtube-playlists/videos.json",
            ]}
          >
            Esta área só lê e organiza o que você coletou: o app não entra em nenhuma conta nem baixa nada. Coloque os arquivos
            abaixo e cada rede passa a mostrar o inventário, os filtros e a triagem.
          </SocialVazio>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CartaoRede
          href="/mysocialmedia/instagram"
          titulo="Instagram"
          cor="#e1306c"
          numeros={[
            { rotulo: "saves a triar", valor: tIg.pendentes, dica: "ainda fora de /referencias, sem decisão" },
            { rotulo: "na fila de referências", valor: tIg.fila },
            { rotulo: "contas que sigo", valor: contas.length },
            { rotulo: "posts em /referencias", valor: nRefs("instagram") },
          ]}
          faixa={[
            ["saves por categoria", topCatIg.map((c) => [c.rotulo, c.n] as const)],
            ["contas por nicho", topNichos],
          ]}
          vazio={ig.saves.length === 0 ? "Inventário de saves vazio — falta o saves.json." : null}
        />
        <CartaoRede
          href="/mysocialmedia/youtube"
          titulo="YouTube"
          cor="#ff4e45"
          numeros={[
            { rotulo: "vídeos a triar", valor: tYt.pendentes, dica: "sem decisão ainda" },
            { rotulo: "na fila de referências", valor: tYt.fila },
            { rotulo: "playlists", valor: yt.playlists.length },
            { rotulo: "vídeos em /referencias", valor: nRefs("youtube") },
          ]}
          faixa={[["vídeos por categoria", topCatYt.map((c) => [c.rotulo, c.n] as const)]]}
          vazio={yt.videos.length === 0 ? "Nenhuma playlist coletada ainda — falta o videos.json." : null}
        />
      </div>
    </main>
  );
}

function CartaoRede({
  href,
  titulo,
  cor,
  numeros,
  faixa,
  vazio,
}: {
  href: string;
  titulo: string;
  cor: string;
  numeros: Numero[];
  faixa: (readonly [string, (readonly [string, number])[]])[];
  vazio: string | null;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-5 shadow-[var(--bl-shadow-md)] transition-colors hover:border-[var(--bl-border-hover)]"
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: cor }} />
        <h2 className="text-base font-semibold text-white/90">{titulo}</h2>
        <ArrowUpRight className="ml-auto h-4 w-4 text-white/25 transition-colors group-hover:text-white/70" />
      </div>
      <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {numeros.map((n) => (
          <div key={n.rotulo} title={n.dica}>
            <dd className="text-2xl font-semibold tabular-nums text-white/90">{n.valor}</dd>
            <dt className="text-[11px] leading-tight text-white/40">{n.rotulo}</dt>
          </div>
        ))}
      </dl>
      {vazio ? (
        <p className="text-xs text-white/35">{vazio}</p>
      ) : (
        faixa.map(([rotulo, itens]) =>
          itens.length ? (
            <div key={rotulo} className="mb-2 last:mb-0">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.06em] text-white/30">{rotulo}</p>
              <div className="flex flex-wrap gap-1">
                {itens.map(([nome, n]) => (
                  <span key={nome} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/60">
                    {nome} <span className="text-white/30">{n}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null,
        )
      )}
    </Link>
  );
}
