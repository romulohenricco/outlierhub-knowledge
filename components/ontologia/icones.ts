import { Box, Layers, Sparkles } from "lucide-react";
import type { OntKind } from "@/lib/ontologia-grafo";

/** Ícone por tipo de nó — compartilhado entre o canvas, o painel e o Raio-X. */
export const ICONE: Record<OntKind, typeof Box> = {
  raiz: Sparkles,
  camada: Layers,
  item: Box,
};
