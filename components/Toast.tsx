"use client";


import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

type ToastVariante = "sucesso" | "aviso" | "erro";
type ToastItem = { id: number; texto: string; variante: ToastVariante };

const DURACAO_MS = 3200;

const ToastContext = createContext<((texto: string, variante?: ToastVariante) => void) | null>(null);

export function useToast() {
  const mostrar = useContext(ToastContext);
  if (!mostrar) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return mostrar;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [itens, setItens] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const mostrar = useCallback((texto: string, variante: ToastVariante = "sucesso") => {
    const id = ++idRef.current;
    setItens((atual) => [...atual, { id, texto, variante }]);
    setTimeout(() => setItens((atual) => atual.filter((i) => i.id !== id)), DURACAO_MS);
  }, []);

  const fechar = useCallback((id: number) => {
    setItens((atual) => atual.filter((i) => i.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={mostrar}>
      {children}
      <div className="bl-toast-container" aria-live="polite" role="status">
        {itens.map((item) => (
          <div key={item.id} className={`bl-toast bl-toast--${item.variante} bl-animate-slide-in-right`}>
            {item.variante === "erro" ? (
              <AlertTriangle size={14} strokeWidth={2} />
            ) : (
              <Check size={14} strokeWidth={2} />
            )}
            <span className="bl-toast-texto">{item.texto}</span>
            <button
              type="button"
              onClick={() => fechar(item.id)}
              className="bl-toast-fechar"
              aria-label="fechar notificação"
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
