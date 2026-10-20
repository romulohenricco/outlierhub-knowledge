"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Botão de copiar pra páginas server-side (o mesmo feedback ✓ dos cards de Referências). */
export function Copiar({
  texto,
  rotulo,
  title,
  className = "text-white/30 hover:text-white/80",
  icone = "h-3.5 w-3.5",
}: {
  texto: string;
  rotulo?: string;
  title: string;
  className?: string;
  icone?: string;
}) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(texto);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={title}
      aria-label={title}
    >
      {ok ? <Check className={`${icone} text-green-300`} /> : <Copy className={icone} />}
      {rotulo && <span>{ok ? "copiado" : rotulo}</span>}
    </button>
  );
}
