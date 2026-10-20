import { getColecoes } from "@/lib/colecoes";
import { carregarPersonas } from "@/lib/personas";
import { Ingestoes } from "@/components/Ingestoes";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ingestões · Knowledge" };

export default async function IngestoesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const { aba } = await searchParams;
  const [colecoes, { personas, estado, descartadas }] = await Promise.all([getColecoes(), carregarPersonas()]);
  return (
    <main className="w-full px-6 py-8">
      <Ingestoes
        colecoes={colecoes}
        personas={personas}
        estadoPersonas={estado}
        personasDescartadas={descartadas}
        abaInicial={aba === "personas" ? "personas" : "colecoes"}
      />
    </main>
  );
}
