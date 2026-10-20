"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type PageTopbarCtx = { content: ReactNode; setContent: (n: ReactNode) => void };

const Ctx = createContext<PageTopbarCtx | null>(null);

/** Envolve o app (ver layout.tsx) — guarda o que a página atual "publicou" pra
 *  topbar do AppShell (ex.: abas de visão). Mesmo desenho do PagePanel. */
export function PageTopbarProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  return <Ctx.Provider value={{ content, setContent }}>{children}</Ctx.Provider>;
}

function useCtx() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePageTopbar(Content) precisa estar dentro de <PageTopbarProvider>");
  return ctx;
}

/** AppShell chama isso pra saber o que renderizar na topbar (null = nada além do padrão). */
export function usePageTopbarContent() {
  return useCtx().content;
}

/** Página publica um nó (abas, ações) na topbar do app. Memoize o `node`
 *  (useMemo) — cada mudança de identidade republica. Limpa ao desmontar. */
export function usePageTopbar(node: ReactNode) {
  const { setContent } = useCtx();
  useEffect(() => {
    setContent(node);
    return () => setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);
}
