"use client";

/**
 * Preview curado do addon function-utility:exemplo-debounce — reimplementação
 * local do debounce (não importa o artefato bruto: preview React nunca executa
 * texto vindo do loader, só demonstra o comportamento com fixture sintética).
 */
import { useEffect, useRef, useState } from "react";

export function DebouncePreview() {
  const [digitado, setDigitado] = useState("");
  const [estabilizado, setEstabilizado] = useState("");
  const [status, setStatus] = useState<"parado" | "digitando">("parado");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onChange(v: string) {
    setDigitado(v);
    setStatus("digitando");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setEstabilizado(v);
      setStatus("parado");
    }, 400);
  }

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <label className="block text-white/50" htmlFor="addon-debounce-preview-input">
        Digite algo (aplica debounce de 400ms)
      </label>
      <input
        id="addon-debounce-preview-input"
        type="text"
        value={digitado}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-white/90 outline-none focus-visible:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
        placeholder="ex.: abacaxi"
      />
      <p className="text-white/60" aria-live="polite">
        Status: <span className={status === "digitando" ? "text-amber-400" : "text-emerald-400"}>{status}</span>
        {" — "}
        último valor estabilizado: <span className="text-white/90">{estabilizado || "(vazio)"}</span>
      </p>
    </div>
  );
}
