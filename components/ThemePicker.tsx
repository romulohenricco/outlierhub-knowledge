"use client";

/**
 * Theme picker — port React do theme-picker vanilla do design system
 * (mesmos temas, mesma chave 'bl-theme', mesmas classes CSS).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Palette, Check } from "lucide-react";

const TEMAS = [
  { id: "bos", label: "Padrão", group: "dark", swatch: "#E85600" },
  { id: "gestao", label: "Verde", group: "dark", swatch: "#6BC950" },
  { id: "moon", label: "Moon", group: "dark", swatch: "#FB923C" },
  { id: "dark", label: "Void", group: "dark", swatch: "#22D3EE" },
  { id: "midnight-blue", label: "Midnight Blue", group: "dark", swatch: "#3B82F6" },
  { id: "synthwave", label: "Synthwave", group: "dark", swatch: "#F472B6" },
  { id: "solarized-dark", label: "Solarized Dark", group: "dark", swatch: "#B58900" },
  { id: "catppuccin", label: "Catppuccin Mocha", group: "dark", swatch: "#CBA6F7" },
  { id: "dracula", label: "Dracula", group: "dark", swatch: "#50FA7B" },
  { id: "nord", label: "Nord", group: "dark", swatch: "#88C0D0" },
  { id: "vercel", label: "Vercel", group: "dark", swatch: "#EDEDED" },
  { id: "retro-terminal", label: "Retro Terminal", group: "dark", swatch: "#00FF41" },
  { id: "sun", label: "Sun", group: "light", swatch: "#E85600" },
  { id: "light", label: "Light", group: "light", swatch: "#6B7280" },
  { id: "paper", label: "Paper", group: "light", swatch: "#8B6914" },
] as const;

// Tema aplicado lido como store externo (sem setState em efeito). O snapshot é o
// atributo data-theme do <html>: o themeInit o define a partir do localStorage
// antes da hidratação e só aplicar() o altera. Assim o marcador reflete o tema
// realmente aplicado nesta aba (outras abas não são sincronizadas, como antes) e
// a leitura nunca lança. Um evento próprio notifica a troca (setItem não dispara
// "storage" na mesma aba).
const EVENTO_TEMA = "bl-theme-change";

function assinarTema(cb: () => void) {
  window.addEventListener(EVENTO_TEMA, cb);
  return () => window.removeEventListener(EVENTO_TEMA, cb);
}

function lerTema() {
  return document.documentElement.getAttribute("data-theme") || "bos";
}

// Servidor e hidratação começam em "bos"; o script themeInit já aplicou o real no <html>.
function lerTemaServidor() {
  return "bos";
}

export function ThemePicker() {
  const [aberto, setAberto] = useState(false);
  const tema = useSyncExternalStore(assinarTema, lerTema, lerTemaServidor);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fecha = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fecha);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fecha);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  function aplicar(id: string) {
    document.documentElement.setAttribute("data-theme", id);
    try {
      localStorage.setItem("bl-theme", id);
    } finally {
      window.dispatchEvent(new Event(EVENTO_TEMA));
    }
    setAberto(false);
  }

  const escuros = TEMAS.filter((t) => t.group === "dark");
  const claros = TEMAS.filter((t) => t.group === "light");

  return (
    <div ref={ref} className="bl-theme-picker">
      <button
        className="bl-topbar__action"
        aria-label="Tema"
        onClick={() => setAberto(!aberto)}
      >
        <Palette size={18} className="bl-topbar__action-icon" />
      </button>
      {aberto && (
        <div className="bl-theme-picker__menu" role="menu">
          <div className="bl-theme-picker__group-label">ESCUROS</div>
          {escuros.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={tema === t.id}
              className={`bl-theme-picker__item${tema === t.id ? " is-active" : ""}`}
              onClick={() => aplicar(t.id)}
            >
              <span
                className="bl-theme-picker__item-swatch"
                style={{ background: t.swatch }}
              />
              {t.label}
              {tema === t.id && <Check size={14} style={{ marginLeft: "auto" }} />}
            </button>
          ))}
          <div className="bl-theme-picker__group-label">CLAROS</div>
          {claros.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={tema === t.id}
              className={`bl-theme-picker__item${tema === t.id ? " is-active" : ""}`}
              onClick={() => aplicar(t.id)}
            >
              <span
                className="bl-theme-picker__item-swatch"
                style={{ background: t.swatch }}
              />
              {t.label}
              {tema === t.id && <Check size={14} style={{ marginLeft: "auto" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
