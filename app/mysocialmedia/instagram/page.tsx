import { getSocialMedia } from "@/lib/social";
import { getInstagramSaves } from "@/lib/instagram-saves";
import { InstagramHub, type AbaInstagram } from "@/components/InstagramHub";
import { SocialAbas } from "@/components/SocialAbas";

export const dynamic = "force-dynamic";

export const metadata = { title: "Instagram · Minhas redes · Knowledge" };

export default async function InstagramPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { aba } = await searchParams;
  const [{ contas, progresso, rotulosNichos }, ig] = await Promise.all([getSocialMedia(), getInstagramSaves()]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <SocialAbas ativa="instagram" />
      <h1 className="mb-4 text-xl font-semibold">Minhas redes · Instagram</h1>
      <InstagramHub
        abaInicial={(aba === "contas" ? "contas" : "saves") satisfies AbaInstagram}
        coletadoEm={ig.coletadoEm}
        saves={ig.saves}
        categorias={ig.categorias}
        decisoes={ig.decisoes}
        emReferencias={ig.emReferencias}
        contas={contas}
        progresso={progresso}
        rotulosNichos={rotulosNichos}
      />
    </main>
  );
}
