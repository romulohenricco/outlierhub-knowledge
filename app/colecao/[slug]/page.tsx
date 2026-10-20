import { notFound } from "next/navigation";
import { getColecao } from "@/lib/colecoes";
import { ColecaoView } from "@/components/ColecaoView";

export const dynamic = "force-dynamic";

export default async function ColecaoPage(ctx: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const r = await getColecao(slug);
  if (!r) notFound();

  // sem atalho para o inventário do /agente: a coleção não depende dele. A prop
  // continua no ColecaoView para quem quiser ligar uma coleção a uma entidade.
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <ColecaoView colecao={r.colecao} itens={r.itens} atalho={null} />
    </main>
  );
}
