/** Posições do núcleo de memória: força determinística (sem aleatório) dentro
 *  de um círculo. Os hubs (pastas) ficam fixos num triângulo/polígono e as notas
 *  são puxadas pelo próprio hub e pelos links reais entre elas. */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import type { Memoria } from "./tipos";

type Ponto = { x: number; y: number };
type No = SimulationNodeDatum & { id: string; hub: string; r: number };

export function layoutNucleo(mem: Memoria, raio: number): { hubs: Map<string, Ponto>; notas: Map<string, Ponto & { r: number }> } {
  const hubs = new Map<string, Ponto>();
  const n = mem.hubs.length;
  mem.hubs.forEach((h, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
    hubs.set(h.id, n === 1 ? { x: 0, y: 0 } : { x: Math.cos(a) * raio * 0.42, y: Math.sin(a) * raio * 0.42 });
  });
  const nos: No[] = mem.notas.map((nt, i) => {
    const h = hubs.get(nt.hub) ?? { x: 0, y: 0 };
    // semente determinística em espiral ao redor do hub
    const a = i * 2.399963;
    const rr = 6 + Math.sqrt(i) * 3;
    return { id: nt.id, hub: nt.hub, r: 1.6 + Math.sqrt(nt.grau) * 0.6, x: h.x + Math.cos(a) * rr, y: h.y + Math.sin(a) * rr };
  });
  const links: SimulationLinkDatum<No>[] = mem.links.map(([source, target]) => ({ source, target }));
  const sim = forceSimulation(nos)
    .force("link", forceLink<No, SimulationLinkDatum<No>>(links).id((d) => d.id).distance(16).strength(0.08))
    .force("carga", forceManyBody().strength(-4))
    .force("x", forceX<No>((d) => hubs.get(d.hub)?.x ?? 0).strength(0.12))
    .force("y", forceY<No>((d) => hubs.get(d.hub)?.y ?? 0).strength(0.12))
    .force("colisao", forceCollide<No>((d) => d.r + 1))
    .stop();
  for (let i = 0; i < 220; i++) sim.tick();
  const limite = raio - 8;
  const notas = new Map<string, Ponto & { r: number }>();
  for (const d of nos) {
    let x = d.x ?? 0;
    let y = d.y ?? 0;
    const m = Math.hypot(x, y);
    if (m > limite) {
      x = (x / m) * limite;
      y = (y / m) * limite;
    }
    notas.set(d.id, { x, y, r: d.r });
  }
  return { hubs, notas };
}
