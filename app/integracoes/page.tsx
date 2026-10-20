import { getAddonCatalogo } from "@/lib/addons";
import { Addons } from "@/components/Addons";

export const dynamic = "force-dynamic";

export const metadata = { title: "Integrações · Knowledge" };

export default async function IntegracoesPage() {
  // SSR só passa metadata (id/type/category/title/summary/status/…) — o texto
  // do artefato é carregado on-demand pelo cliente via /api/addons/[id]/artifacts/[artifactId].
  const catalogo = await getAddonCatalogo();
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Integrações</h1>
        <p className="mt-1 text-xs text-white/40">
          Design systems, checklists, utilitários e aplicações aprovados no catálogo local.
        </p>
      </div>
      <Addons catalogo={catalogo} />
    </main>
  );
}
