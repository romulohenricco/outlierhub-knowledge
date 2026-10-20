"use client";

/** Loader do grafo: três anéis girando em direções opostas. Respeita
 *  prefers-reduced-motion. */
export function Carregando({ rotulo = "carregando grafo" }: { rotulo?: string }) {
  return (
    <div role="status" aria-label={rotulo} className="flex h-full min-h-[480px] w-full items-center justify-center">
      <style>{`@keyframes bl-gira{to{transform:rotate(360deg)}}@keyframes bl-gira-r{to{transform:rotate(-360deg)}}.bl-anel{position:absolute;border-radius:9999px;border:2px solid transparent;animation:bl-gira 1.1s linear infinite}@media (prefers-reduced-motion:reduce){.bl-anel{animation-duration:4s}}`}</style>
      <div className="relative h-[84px] w-[84px]">
        <span className="bl-anel inset-0" style={{ borderTopColor: "var(--bl-accent)", borderRightColor: "var(--bl-accent)" }} />
        <span className="bl-anel inset-[12px]" style={{ borderBottomColor: "var(--bl-text-dim)", borderLeftColor: "var(--bl-text-dim)", animationName: "bl-gira-r", animationDuration: "1.6s" }} />
        <span className="bl-anel inset-[26px]" style={{ borderTopColor: "var(--bl-text-secondary)", animationDuration: "0.8s" }} />
      </div>
      <span className="sr-only">{rotulo}</span>
    </div>
  );
}
