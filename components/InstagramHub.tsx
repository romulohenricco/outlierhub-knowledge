"use client";

import { useState } from "react";
import { MySocialMedia } from "./MySocialMedia";
import { InstagramSaves } from "./InstagramSaves";
import type { CategoriaIG, SaveEmReferencias, SaveIG } from "@/lib/instagram-saves-filtro";
import type { ContaSocial, ProgressoSocial } from "@/lib/social";
import { dataHumana } from "@/lib/social-formato";
import type { DecisoesTriagem } from "@/lib/triagem";

export type AbaInstagram = "saves" | "contas";

/**
 * Instagram dentro de /mysocialmedia: duas faces do mesmo inventário —
 * SAVES (o que você guardou e ainda não virou referência) e CONTAS (quem você segue, por nicho).
 * Só uma monta por vez (cada uma publica o próprio painel lateral).
 */
export function InstagramHub({
  abaInicial,
  coletadoEm,
  saves,
  categorias,
  decisoes,
  emReferencias,
  contas,
  progresso,
  rotulosNichos,
}: {
  abaInicial: AbaInstagram;
  coletadoEm: string | null;
  saves: SaveIG[];
  categorias: CategoriaIG[];
  decisoes: DecisoesTriagem;
  emReferencias: SaveEmReferencias;
  contas: ContaSocial[];
  progresso: ProgressoSocial;
  rotulosNichos: Record<string, string>;
}) {
  const [aba, setAba] = useState<AbaInstagram>(abaInicial);

  function trocar(a: AbaInstagram) {
    setAba(a);
    const url = new URL(window.location.href);
    if (a === "saves") url.searchParams.delete("aba");
    else url.searchParams.set("aba", a);
    window.history.replaceState(null, "", url);
  }

  return (
    <div>
      <div className="mb-5 flex w-fit rounded-[var(--bl-radius-sm)] bg-white/5 p-0.5 text-sm">
        {(
          [
            ["saves", `Saves · ${saves.length}`],
            ["contas", `Contas · ${contas.length}`],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            onClick={() => trocar(id)}
            className={`rounded px-3 py-1 ${aba === id ? "bg-white/10 text-white/90" : "text-white/45 hover:text-white/75"}`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === "saves" ? (
        <>
          <p className="mb-4 text-xs text-white/40">
            todos os posts que você guardou — os já ingeridos vêm marcados &quot;em referências&quot;; o que falta, você descarta se não vale ou põe na fila pra ingestão com prompt reverso
          </p>
          <InstagramSaves coletadoEm={coletadoEm} saves={saves} categorias={categorias} decisoes={decisoes} emReferencias={emReferencias} />
        </>
      ) : (
        <>
          <p className="mb-4 text-xs text-white/40">
            quem você segue, por nicho de atuação — os nichos são os do seu arquivo de contas
            {dataHumana(progresso.atualizadoEm) && <> · atualizado em {dataHumana(progresso.atualizadoEm)}</>}
          </p>
          <MySocialMedia contas={contas} progresso={progresso} rotulosNichos={rotulosNichos} />
        </>
      )}
    </div>
  );
}
