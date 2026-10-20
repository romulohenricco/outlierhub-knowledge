import { getBoard } from "@/lib/kanban";
import { Kanban } from "@/components/Kanban";

export const dynamic = "force-dynamic";

export const metadata = { title: "Kanban · Knowledge" };

export default async function KanbanPage() {
  const board = await getBoard();
  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8">
      <Kanban board={board} />
    </main>
  );
}
