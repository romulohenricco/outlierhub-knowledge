/**
 * graph-layout.mjs — precomputa posições (x,y) do grafo com d3-force e grava o
 * sidecar data/kg/graph-layout.json (Record<nodeId, {x,y}>), consumido por
 * lib/kg.ts (carregarLayout) para render instantâneo em /grafo.
 *
 * Leitura do sqlite via CLI `sqlite3 -json -readonly` (mesma via de lib/kg.ts).
 * Uso: node scripts/graph-layout.mjs
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";

const exec = promisify(execFile);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KG_DB = (process.env.BILHON_KG_DB || undefined) ?? path.join(RAIZ, "data", "kg", "livros-kg.sqlite");
const SAIDA = (process.env.BILHON_GRAPH_LAYOUT || undefined) ?? path.join(RAIZ, "data", "kg", "graph-layout.json");

async function q(sql) {
  const { stdout } = await exec("sqlite3", ["-json", "-readonly", KG_DB, sql], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

const nodes = await q("SELECT id, tipo FROM nodes");
const edges = await q("SELECT src, dst, n_fontes FROM edges");

const ids = new Set(nodes.map((n) => n.id));
const links = edges
  .filter((e) => ids.has(e.src) && ids.has(e.dst))
  .map((e) => ({ source: e.src, target: e.dst, n: e.n_fontes }));

const grau = new Map();
for (const l of links) {
  grau.set(l.source, (grau.get(l.source) ?? 0) + 1);
  grau.set(l.target, (grau.get(l.target) ?? 0) + 1);
}

const sim = forceSimulation(nodes)
  .force(
    "link",
    forceLink(links)
      .id((d) => d.id)
      .distance((l) => 40 + 10 * Math.min(4, l.n))
      .strength(0.4),
  )
  .force("charge", forceManyBody().strength((d) => (d.tipo === "livro" ? -220 : -90)))
  .force("center", forceCenter(0, 0))
  .force("collide", forceCollide().radius((d) => 10 + 2 * Math.min(8, grau.get(d.id) ?? 0)))
  .force("x", forceX(0).strength(0.04))
  .force("y", forceY(0).strength(0.04))
  .stop();

const ticks = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
for (let i = 0; i < ticks; i++) sim.tick();

const layout = {};
for (const n of nodes) layout[n.id] = { x: Math.round(n.x), y: Math.round(n.y) };

await writeFile(SAIDA, JSON.stringify(layout), "utf-8"); // UTF-8 sem BOM
console.log(`layout: ${nodes.length} nodes, ${links.length} links → ${SAIDA}`);
