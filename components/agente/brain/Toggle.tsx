"use client";

/** Switch de camada (trilho + knob, tokens --bl-*). */
export function Toggle({ ligado, onChange, rotulo }: { ligado: boolean; onChange: () => void; rotulo: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={`mostrar ${rotulo}`}
      title={ligado ? `ocultar ${rotulo}` : `mostrar ${rotulo}`}
      onClick={onChange}
      className="relative h-[16px] w-[28px] shrink-0 rounded-full border transition-colors duration-200"
      style={{
        background: ligado ? "var(--bl-accent-soft, rgba(232,86,0,.25))" : "var(--bl-bg-card-solid)",
        borderColor: ligado ? "var(--bl-border-accent)" : "var(--bl-border)",
      }}
    >
      <span
        className="absolute top-[2px] h-[10px] w-[10px] rounded-full transition-transform duration-200"
        style={{ left: 2, transform: ligado ? "translateX(12px)" : "translateX(0)", background: ligado ? "var(--bl-accent)" : "var(--bl-text-dim)" }}
      />
    </button>
  );
}
