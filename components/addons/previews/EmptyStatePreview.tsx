"use client";

/**
 * Preview curado do addon design-system:exemplo-empty-state — reimplementação
 * local do padrão CSS (fixture sintética).
 */
import { Inbox } from "lucide-react";

export function EmptyStatePreview() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-white/10 p-8 text-center text-white/40">
      <Inbox size={24} className="opacity-40" />
      <p className="text-sm">Nenhum item por aqui ainda.</p>
    </div>
  );
}
