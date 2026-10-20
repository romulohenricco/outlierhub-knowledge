import { notFound } from "next/navigation";
import { getConta, getDossie, getSocialMedia } from "@/lib/social";
import { PerfilSocial } from "@/components/PerfilSocial";

export const dynamic = "force-dynamic";

export const metadata = { title: "Conta · Minhas redes · Knowledge" };

export default async function PerfilSocialPage(ctx: {
  params: Promise<{ username: string }>;
}) {
  const { username: raw } = await ctx.params;
  let username: string;
  try {
    username = decodeURIComponent(raw);
  } catch {
    notFound();
  }
  const [conta, dossie, { rotulosNichos }] = await Promise.all([getConta(username), getDossie(username), getSocialMedia()]);
  if (!conta) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <PerfilSocial conta={conta} dossie={dossie} rotulosNichos={rotulosNichos} />
    </main>
  );
}
