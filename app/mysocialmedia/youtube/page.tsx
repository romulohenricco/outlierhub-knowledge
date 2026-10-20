import { getYoutubePlaylists } from "@/lib/youtube-playlists";
import { miniaturasYoutubeAtivas } from "@/lib/social-dir";
import { SocialAbas } from "@/components/SocialAbas";
import { YoutubePlaylists } from "@/components/YoutubePlaylists";

export const dynamic = "force-dynamic";

export const metadata = { title: "Playlists do YouTube · Knowledge" };

export default async function YoutubePlaylistsPage() {
  const dados = await getYoutubePlaylists();
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <SocialAbas ativa="youtube" />
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Minhas redes · YouTube</h1>
        <p className="mt-1 text-xs text-white/40">
          todas as suas playlists num lugar só, com cada vídeo por categoria e palavra-chave — pra
          decidir o que vale manter. Só entra em /referencias o que passar por ingestão com prompt reverso.
        </p>
      </div>
      <YoutubePlaylists {...dados} miniaturas={miniaturasYoutubeAtivas()} />
    </main>
  );
}
