import { Busca } from "@/components/Busca";

/** `?q=` é honrado aqui (server) e passado ao client — evita `useSearchParams`
 *  e o Suspense que ele exigiria. Quem gera esses links: Grafo (conceito e
 *  sugestão do autolearn) e ColecaoView. */
export default async function BuscarPage(ctx: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await ctx.searchParams;
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold">Busca semântica no acervo</h1>
      <Busca inicial={q ?? ""} />
    </main>
  );
}
