import { getReferencias, REFS_DIR } from "@/lib/referencias";
import { Referencias } from "@/components/Referencias";
import { lerFiltros } from "@/lib/referencias-url";
import path from "node:path";

export const dynamic = "force-dynamic";

export const metadata = { title: "Referências · Knowledge" };

export default async function ReferenciasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtrosIniciais = lerFiltros(await searchParams);
  const { posts, colecoes, antipatterns, favoritos, fonte, extraidoEm } =
    await getReferencias();
  const relativo = path.relative(process.cwd(), REFS_DIR);
  const baseParaExibir = relativo && relativo !== ".." && !relativo.startsWith(`..${path.sep}`) && !path.isAbsolute(relativo)
    ? relativo.split(path.sep).join("/") : null;
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          Referências · Instagram + sites + YouTube
        </h1>
        <p className="mt-1 text-xs text-white/40">
          {fonte === "demo" ? "dados de exemplo" : `${fonte} · extraído em ${extraidoEm}`}
        </p>
      </div>
      <Referencias
        posts={posts}
        colecoes={colecoes}
        antipatterns={antipatterns}
        favoritos={favoritos}
        baseDir={baseParaExibir}
        filtrosIniciais={filtrosIniciais}
      />
    </main>
  );
}
