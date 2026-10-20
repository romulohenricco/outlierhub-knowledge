import { Suspense } from "react";
import { Grafo } from "@/components/Grafo";

export default function GrafoPage() {
  return (
    <main className="w-full px-3 pb-3 pt-6">
      <Suspense fallback={<p className="text-white/40">carregando grafo…</p>}>
        <Grafo />
      </Suspense>
    </main>
  );
}
