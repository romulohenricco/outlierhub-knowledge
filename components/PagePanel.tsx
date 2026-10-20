"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type PagePanelCtx = { content: ReactNode; setContent: (n: ReactNode) => void };

const Ctx = createContext<PagePanelCtx | null>(null);

/** Envolve o app inteiro (ver layout.tsx) — guarda o que a página atual "publicou"
 *  pro painel lateral do AppShell (rail de ícones já cobre a navegação; o painel
 *  vira contextual: filtros da página, quando ela tiver). */
export function PagePanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  return <Ctx.Provider value={{ content, setContent }}>{children}</Ctx.Provider>;
}

function useCtx() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePagePanel(Content) precisa estar dentro de <PagePanelProvider>");
  return ctx;
}

/** AppShell chama isso pra saber o que renderizar no painel (null = usa o fallback de navegação). */
export function usePagePanelContent() {
  return useCtx().content;
}

/** Páginas com filtro/contexto próprio chamam isso pra publicar seu conteúdo no
 *  painel lateral em vez de renderizar uma coluna própria. Limpa sozinho ao
 *  desmontar (troca de página volta ao fallback de navegação). */
export function usePagePanel(node: ReactNode) {
  const { setContent } = useCtx();
  useEffect(() => {
    setContent(node);
    return () => setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);
}
