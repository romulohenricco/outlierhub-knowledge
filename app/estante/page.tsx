import { livrosDaEstante } from "@/lib/livro-conteudo";
import { Estante } from "@/components/Estante";

export const metadata = { title: "Estante · Knowledge" };
export const dynamic = "force-dynamic";

export default async function EstantePage() {
  const books = await livrosDaEstante();
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Estante books={books} />
    </main>
  );
}
