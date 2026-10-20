"use client";

/**
 * Preview curado do addon framework-checklist:exemplo-checklist-lancamento —
 * itens fixos (não fazem parse do artefato bruto).
 * Estado só em memória: sem rede, sem escrita, reseta ao remontar (key do pai).
 */
import { useState } from "react";
import { Check } from "lucide-react";

const ITENS = [
  "Definir a métrica única de sucesso antes de anunciar a data.",
  "Escrever a mensagem de rollback antes da mensagem de anúncio.",
  "Validar o caminho crítico com um usuário real fora do time.",
  "Confirmar que o monitoramento cobre o que vai quebrar primeiro.",
  "Ter um dono nomeado para as primeiras 24h — não \"o time\".",
];

export function ChecklistPreview() {
  const [marcados, setMarcados] = useState<Set<number>>(new Set());

  function alternar(i: number) {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(i)) proximo.delete(i);
      else proximo.add(i);
      return proximo;
    });
  }

  return (
    <ul className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      {ITENS.map((texto, i) => {
        const feito = marcados.has(i);
        return (
          <li key={i}>
            <button
              type="button"
              onClick={() => alternar(i)}
              aria-pressed={feito}
              className="flex min-h-11 w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  feito ? "border-emerald-400 bg-emerald-400/20 text-emerald-400" : "border-white/30 text-transparent"
                }`}
              >
                <Check size={12} />
              </span>
              <span className={feito ? "text-white/40 line-through" : "text-white/80"}>{texto}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
