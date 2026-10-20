"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { DecisoesTriagem, StatusTriagem } from "@/lib/triagem";

type Ultima = { ids: string[]; antes: Record<string, StatusTriagem | null>; rotulo: string };

async function gravar(endpoint: string, ids: string[], status: StatusTriagem | null): Promise<boolean> {
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, status }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Estado da triagem manual de uma rede: decisões, seleção em lote e desfazer (15 s).
 * Otimista — a tela muda na hora e volta atrás se a gravação falhar.
 */
export function useTriagem(endpoint: string, iniciais: DecisoesTriagem) {
  const [decisoes, setDecisoes] = useState<DecisoesTriagem>(iniciais);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [ultima, setUltima] = useState<Ultima | null>(null);

  const aplicar = useCallback(
    async (ids: string[], status: StatusTriagem | null, rotulo: string) => {
      if (!ids.length) return;
      const antes: Ultima["antes"] = {};
      for (const id of ids) antes[id] = decisoes[id]?.status ?? null;
      const agora = new Date().toISOString();
      setDecisoes((d) => {
        const n = { ...d };
        for (const id of ids) {
          if (status === null) delete n[id];
          else n[id] = { status, em: agora };
        }
        return n;
      });
      setSel(new Set());
      setErro(null);
      setUltima({ ids, antes, rotulo });
      if (!(await gravar(endpoint, ids, status))) {
        setDecisoes(decisoes);
        setUltima(null);
        setErro("Não consegui gravar a triagem — nada foi alterado.");
      }
    },
    [decisoes, endpoint],
  );

  const desfazer = useCallback(async () => {
    if (!ultima) return;
    const porStatus = new Map<StatusTriagem | null, string[]>();
    for (const id of ultima.ids) {
      const s = ultima.antes[id];
      porStatus.set(s, [...(porStatus.get(s) ?? []), id]);
    }
    const restaurado = { ...decisoes };
    for (const [s, ids] of porStatus) {
      for (const id of ids) {
        if (s === null) delete restaurado[id];
        else restaurado[id] = { status: s, em: new Date().toISOString() };
      }
    }
    setDecisoes(restaurado);
    setUltima(null);
    const oks = await Promise.all([...porStatus].map(([s, ids]) => gravar(endpoint, ids, s)));
    if (oks.some((ok) => !ok)) setErro("Não consegui desfazer tudo — recarregue a página pra ver o estado real.");
  }, [ultima, decisoes, endpoint]);

  useEffect(() => {
    if (!ultima) return;
    const t = setTimeout(() => setUltima(null), 15000);
    return () => clearTimeout(t);
  }, [ultima]);

  const alternar = useCallback(
    (id: string) =>
      setSel((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );

  return { decisoes, sel, setSel, alternar, erro, ultima, aplicar, desfazer };
}

export function ChipFiltro({ children, onX }: { children: React.ReactNode; onX: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-white/70">
      {children}
      <button onClick={onX} aria-label="remover filtro" className="text-white/40 hover:text-white">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
