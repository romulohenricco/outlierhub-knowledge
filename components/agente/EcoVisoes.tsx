"use client";

/** Visões em grafo do /agente (radial | neural) + faixa de saúde. O grafo vive em
 *  components/agente/brain e recebe o recorte JÁ filtrado pelo Ecossistema: uma
 *  fonte de verdade. */
import dynamic from "next/dynamic";
import type { BrainDados } from "@/lib/brain/tipos";
import type { EcoEntity } from "@/lib/types";

const Skel = ({ className }: { className: string }) => (
  <div className={`animate-pulse rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] ${className}`} />
);

// skeletons com a MESMA dimensão do conteúdo assentado (sem salto de layout)
import { Carregando } from "./brain/Carregando";

const BrainGrafo = dynamic(() => import("./brain/BrainGrafo").then((m) => m.BrainGrafo), {
  ssr: false,
  loading: () => <Carregando />,
});
const EcoSaude = dynamic(() => import("./EcoSaude").then((m) => m.EcoSaude), {
  ssr: false,
  loading: () => <Skel className="h-[560px]" />,
});

export function EcoVisoes({
  entities,
  totalEntidades,
  brain,
  visao,
  onAbrirCard,
  filtroSquad,
}: {
  entities: EcoEntity[];
  totalEntidades: number;
  brain: BrainDados;
  visao: "radial" | "neural";
  onAbrirCard: (e: EcoEntity) => void;
  filtroSquad: { nome: string; limpar: () => void } | null;
}) {
  return (
    <div>
      {/* canvas de borda a borda (20px de respiro à direita e embaixo, pras barras de rolagem) */}
      <BrainGrafo entities={entities} totalEntidades={totalEntidades} brain={brain} visao={visao} onAbrirCard={onAbrirCard} filtroSquad={filtroSquad} />
      {/* faixa de saúde: leitura abaixo do canvas, recuada pra fora dos menus flutuantes */}
      <div style={{ paddingLeft: "var(--chrome-left)", paddingRight: 20, paddingBottom: 24 }}>
        <EcoSaude entities={entities} />
      </div>
    </div>
  );
}
