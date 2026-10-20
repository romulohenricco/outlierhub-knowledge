import { Suspense } from "react";
import { getBoard } from "@/lib/kanban";
import { KanbanBacklog } from "@/components/KanbanBacklog";

export const dynamic = "force-dynamic";

export const metadata = { title: "Backlog · Kanban · Knowledge" };

export default async function BacklogPage() {
  const board = await getBoard();
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Backlog · histórico completo de tickets</h1>
        <p className="mt-1 text-xs text-white/40">
          Tudo que já passou pelo board, com o conteúdo inteiro do card. Abre em DONE — mude o
          filtro de coluna pra ver cancelados ou o board ativo.
        </p>
      </div>
      <Suspense fallback={<p className="text-xs text-white/40">carregando…</p>}>
        <KanbanBacklog board={board} />
      </Suspense>
    </main>
  );
}
