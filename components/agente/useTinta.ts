"use client";

import { useEffect, useState } from "react";

/** Cor de texto/linha do tema atual para canvas (que não herda CSS). Relê quando
 *  `data-theme` muda (ThemePicker). */
export function useTinta(): { ink: string; borda: string; fundo: string } {
  const [t, setT] = useState({ ink: "#d6d8dc", borda: "rgba(128,128,128,0.25)", fundo: "#121316" });
  useEffect(() => {
    const ler = () => {
      const cs = getComputedStyle(document.body);
      setT({
        ink: cs.color || "#d6d8dc",
        borda: cs.getPropertyValue("--bl-border").trim() || "rgba(128,128,128,0.25)",
        fundo: cs.getPropertyValue("--bl-bg-card-solid").trim() || "#121316",
      });
    };
    ler();
    const mo = new MutationObserver(ler);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => mo.disconnect();
  }, []);
  return t;
}
