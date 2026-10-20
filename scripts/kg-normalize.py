# -*- coding: utf-8 -*-
"""
kg-normalize.py — Normalização semântica dos conceitos do livros-kg.sqlite.

Problema que resolve: o extract v1 nunca colide variações de superfície do mesmo
conceito ("Venda" vs "Vendas" vs "A Venda"), então quase nenhuma aresta acumula
n_fontes>=2 e o grafo fica preso em 'claimed'.

Pipeline (fases sequenciais do workflow — rodar com o sqlite livre de escritores):
  1. --embed   : embedda TODOS os labels de nodes tipo='conceito' com bge-m3
                 (Ollama /api/embed, em batch) e cacheia em data/kg/concept-embeddings.npz.
  2. --report  : clusteriza por cosseno >= threshold (union-find/componentes conexos),
                 imprime estatísticas, os maiores clusters e pares limítrofes
                 (janela em volta do threshold) para avaliação manual do corte.
  3. --apply   : aplica o merge no sqlite (transação única):
                 - node canônico por cluster = maior grau (arestas incidentes);
                   empate → label mais curto → ordem alfabética;
                 - aliases preservados em data/kg/aliases.json (schema de nodes
                   NÃO tem campo metadata — decisão registrada aqui);
                 - edges repontados pro canônico; self-loops resultantes removidos
                   (aresta conceito→ele-mesmo não significa nada) junto com suas
                   evidences (mantém 0 evidences órfãs);
                 - dedup de edges (src,rel,dst): mantém menor id, evidences
                   repontadas, n_fontes somado (interino) e peso = max;
                 - dedup de evidences exatamente idênticas (edge_id,livro,chunk_id,trecho),
                   mantendo a de maior confiança;
                 - recalcula n_fontes = COUNT(DISTINCT livro) das evidences da aresta
                   (fonte da verdade), promove status='confirmed' quando n_fontes>=2
                   (não demove disputed; claimed com 1 fonte permanece claimed);
                 - recalcula peso = min(0.25 + 0.15*n_fontes, 1.0) — fórmula inferida
                   do extractor v1 (n=1→0.40, n=2→0.55);
                 - remove os nodes fundidos;
                 - checks de integridade: 0 pontas soltas, 0 evidences órfãs,
                   0 edges sem evidence. Falhou → ROLLBACK.

Threshold: o corte de cosseno vem de --threshold (padrão 0.93). Antes do --apply,
rode --report e revise à mão os pares limítrofes: o embedding não distingue
inversão de ordem nem números diferentes, então pares quase iguais mas distintos
podem passar do corte. Falsos positivos residuais são tratados por BLOCKLIST
manual explícita (abaixo), auditável e registrada no report.

Backup: data/kg/livros-kg.v1.bak.sqlite (v1, preexistente — NUNCA sobrescrever).
Antes do --apply este script cria data/kg/livros-kg.pre-normalize.bak.sqlite
(estado imediatamente anterior à normalização) se ainda não existir.

Uso:
  python scripts/kg-normalize.py --embed
  python scripts/kg-normalize.py --report --threshold 0.93
  python scripts/kg-normalize.py --apply --threshold 0.93
"""

import argparse
import io
import json
import os
import shutil
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
# BILHON_KG_DB é o mesmo sqlite que o app lê (lib/kg.ts); backup, cache e relatórios
# ficam ao lado dele, para a pasta padrão não ser exigida quando o grafo mora em outro lugar
DB = Path(os.environ.get("BILHON_KG_DB") or ROOT / "data" / "kg" / "livros-kg.sqlite").resolve()
KG_DIR = DB.parent
EMB_CACHE = KG_DIR / "concept-embeddings.npz"
ALIASES = KG_DIR / "aliases.json"
REPORT = KG_DIR / "normalize-report.json"
PRE_BAK = KG_DIR / "livros-kg.pre-normalize.bak.sqlite"

OLLAMA = (os.environ.get("BILHON_OLLAMA_URL") or "").strip().rstrip("/") or "http://127.0.0.1:11434"
EMB_MODEL = os.environ.get("BILHON_EMBED_MODEL") or "bge-m3"
BATCH = 128


def carregar_blocklist() -> set[frozenset[str]]:
    """Pares de labels que NUNCA se fundem, independente do cosseno. Começa vazia;
    para registrar pares avaliados à mão, crie data/kg/blocklist.json (opcional):
    uma lista de pares de labels, ex.: [["Conceito A", "Conceito B"]]."""
    arquivo = KG_DIR / "blocklist.json"
    if not arquivo.exists():
        return set()
    bruto = json.loads(arquivo.read_text(encoding="utf-8"))
    pares: set[frozenset[str]] = set()
    for par in bruto:
        if isinstance(par, (list, tuple)) and len(par) == 2 and par[0] != par[1]:
            pares.add(frozenset({str(par[0]), str(par[1])}))
    return pares


# Chave = frozenset dos dois labels.
BLOCKLIST: set[frozenset[str]] = carregar_blocklist()


# ---------------------------------------------------------------- embeddings

def ollama_embed(texts: list[str]) -> list[list[float]]:
    body = json.dumps({"model": EMB_MODEL, "input": texts}).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA}/api/embed", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        out = json.loads(r.read().decode("utf-8"))
    return out["embeddings"]


def carregar_conceitos(con: sqlite3.Connection) -> tuple[list[str], list[str]]:
    rows = con.execute(
        "SELECT id,label FROM nodes WHERE tipo='conceito' ORDER BY id"
    ).fetchall()
    return [r[0] for r in rows], [r[1] for r in rows]


def cmd_embed() -> None:
    con = sqlite3.connect(DB)
    ids, labels = carregar_conceitos(con)
    con.close()
    print(f"embeddando {len(ids)} labels de conceito com {EMB_MODEL}…")
    vecs: list[list[float]] = []
    t0 = time.time()
    for i in range(0, len(labels), BATCH):
        chunk = labels[i : i + BATCH]
        vecs.extend(ollama_embed(chunk))
        print(f"  {min(i + BATCH, len(labels))}/{len(labels)}  ({time.time() - t0:.1f}s)")
    m = np.asarray(vecs, dtype=np.float32)
    m /= np.linalg.norm(m, axis=1, keepdims=True)  # normaliza p/ cosseno = dot
    np.savez_compressed(EMB_CACHE, ids=np.array(ids), labels=np.array(labels), vecs=m)
    print(f"cache salvo em {EMB_CACHE} — shape {m.shape}")


# ---------------------------------------------------------------- clustering

def carregar_cache() -> tuple[list[str], list[str], np.ndarray]:
    d = np.load(EMB_CACHE, allow_pickle=False)
    return list(d["ids"]), list(d["labels"]), d["vecs"]


class UnionFind:
    def __init__(self, n: int):
        self.p = list(range(n))

    def find(self, x: int) -> int:
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def pares_acima(vecs: np.ndarray, threshold: float) -> list[tuple[int, int, float]]:
    """Todos os pares (i<j) com cosseno >= threshold. Blocado p/ economizar RAM."""
    n = vecs.shape[0]
    out: list[tuple[int, int, float]] = []
    bs = 1024
    for i0 in range(0, n, bs):
        sims = vecs[i0 : i0 + bs] @ vecs.T  # (bs, n)
        for di in range(sims.shape[0]):
            i = i0 + di
            row = sims[di]
            js = np.nonzero(row >= threshold)[0]
            for j in js:
                if j > i:
                    out.append((i, int(j), float(row[j])))
    return out


def clusterizar(ids: list[str], labels: list[str], vecs: np.ndarray, threshold: float):
    pares = pares_acima(vecs, threshold)
    uf = UnionFind(len(ids))
    bloqueados = 0
    for i, j, _ in pares:
        if frozenset({labels[i], labels[j]}) in BLOCKLIST:
            bloqueados += 1
            continue
        uf.union(i, j)
    grupos: dict[int, list[int]] = {}
    for i in range(len(ids)):
        grupos.setdefault(uf.find(i), []).append(i)
    clusters = [g for g in grupos.values() if len(g) > 1]
    # transitividade não pode reunir um par bloqueado via terceiro node
    raiz = {labels[i]: uf.find(i) for i in range(len(ids))}
    for par in BLOCKLIST:
        a, b = sorted(par)
        if a in raiz and b in raiz and raiz[a] == raiz[b]:
            raise RuntimeError(f"par bloqueado reunido por transitividade: {a!r} ~ {b!r}")
    return clusters, pares, bloqueados


def cmd_report(threshold: float, janela: float) -> None:
    ids, labels, vecs = carregar_cache()
    clusters, pares, bloqueados = clusterizar(ids, labels, vecs, threshold)
    n_merged = sum(len(c) - 1 for c in clusters)
    print(f"threshold={threshold}  pares>=t: {len(pares)}  bloqueados: {bloqueados}  "
          f"clusters: {len(clusters)}  nodes fundidos (perdidos): {n_merged}")
    tam = sorted(clusters, key=len, reverse=True)[:12]
    print("\n-- maiores clusters --")
    for c in tam:
        print(f"  [{len(c)}] " + " | ".join(labels[i] for i in c[:10]) +
              (" …" if len(c) > 10 else ""))
    # pares limítrofes: janela em volta do threshold p/ avaliação manual
    lim: list[tuple[int, int, float]] = []
    lo, hi = threshold - janela, threshold + janela
    n = vecs.shape[0]
    bs = 1024
    for i0 in range(0, n, bs):
        sims = vecs[i0 : i0 + bs] @ vecs.T
        for di in range(sims.shape[0]):
            i = i0 + di
            row = sims[di]
            js = np.nonzero((row >= lo) & (row <= hi))[0]
            for j in js:
                if j > i:
                    lim.append((i, int(j), float(row[j])))
    lim.sort(key=lambda t: -t[2])
    print(f"\n-- pares limítrofes ({lo:.3f}..{hi:.3f}): {len(lim)} --")
    for i, j, s in lim[:40]:
        marca = "MERGE" if s >= threshold else "keep "
        print(f"  {s:.4f} {marca}  {labels[i]!r}  ~  {labels[j]!r}")


# ---------------------------------------------------------------- apply

def escolher_canonico(membros: list[int], ids: list[str], labels: list[str],
                      grau: dict[str, int]) -> int:
    """Canônico = node mais 'frequente' no grafo (maior grau = mais arestas o
    referenciam); empate → label mais curto; empate → alfabético. Interpretação
    registrada: labels de conceito são únicos no DB, então 'mais frequente' só
    faz sentido como frequência de referência (grau), não de string."""
    return min(membros, key=lambda i: (-grau.get(ids[i], 0), len(labels[i]), labels[i]))


def cmd_apply(threshold: float) -> None:
    if not PRE_BAK.exists():
        shutil.copy2(DB, PRE_BAK)
        print(f"backup pré-normalização criado: {PRE_BAK}")
    else:
        print(f"backup pré-normalização já existe (não sobrescrito): {PRE_BAK}")

    ids, labels, vecs = carregar_cache()
    clusters, _, bloqueados = clusterizar(ids, labels, vecs, threshold)

    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys=OFF")  # repontamos na mão, em transação
    cur = con.cursor()

    # sanity: cache de embeddings precisa bater com o DB atual
    db_ids = {r[0] for r in cur.execute("SELECT id FROM nodes WHERE tipo='conceito'")}
    if db_ids != set(ids):
        print("ERRO: cache de embeddings desatualizado em relação ao DB — rode --embed de novo.")
        sys.exit(2)

    antes = {
        "conceitos": cur.execute("SELECT COUNT(*) FROM nodes WHERE tipo='conceito'").fetchone()[0],
        "edges": cur.execute("SELECT COUNT(*) FROM edges").fetchone()[0],
        "evidences": cur.execute("SELECT COUNT(*) FROM evidences").fetchone()[0],
        "confirmed": cur.execute("SELECT COUNT(*) FROM edges WHERE status='confirmed'").fetchone()[0],
    }

    grau: dict[str, int] = {}
    for (nid, cnt) in cur.execute(
        "SELECT x, COUNT(*) FROM (SELECT src x FROM edges UNION ALL SELECT dst FROM edges) GROUP BY x"
    ):
        grau[nid] = cnt

    # mapa old_id -> canonical_id + aliases.json
    mapa: dict[str, str] = {}
    aliases: dict[str, dict] = {}
    for c in clusters:
        k = escolher_canonico(c, ids, labels, grau)
        can_id, can_label = ids[k], labels[k]
        entry = {"label": can_label, "aliases": []}
        for i in c:
            if i == k:
                continue
            mapa[ids[i]] = can_id
            entry["aliases"].append({"id": ids[i], "label": labels[i]})
        entry["aliases"].sort(key=lambda a: a["id"])
        aliases[can_id] = entry

    print(f"clusters: {len(clusters)}  nodes a fundir: {len(mapa)}")

    try:
        cur.execute("BEGIN IMMEDIATE")
        cur.execute("CREATE TEMP TABLE map(old TEXT PRIMARY KEY, new TEXT NOT NULL)")
        cur.executemany("INSERT INTO map VALUES (?,?)", list(mapa.items()))

        # 1) reponta edges pro canônico
        cur.execute("""UPDATE edges SET src=(SELECT new FROM map WHERE old=src)
                       WHERE src IN (SELECT old FROM map)""")
        cur.execute("""UPDATE edges SET dst=(SELECT new FROM map WHERE old=dst)
                       WHERE dst IN (SELECT old FROM map)""")

        # 2) remove self-loops criados pelo merge (+ suas evidences)
        cur.execute("SELECT id FROM edges WHERE src=dst")
        loops = [r[0] for r in cur.fetchall()]
        if loops:
            qm = ",".join("?" * len(loops))
            cur.execute(f"DELETE FROM evidences WHERE edge_id IN ({qm})", loops)
            cur.execute(f"DELETE FROM edges WHERE id IN ({qm})", loops)

        # 3) dedup de edges (src,rel,dst): mantém menor id, reponta evidences,
        #    n_fontes somado (interino — recalculado no passo 5), peso = max
        cur.execute("""
          SELECT MIN(id), GROUP_CONCAT(id), SUM(n_fontes), MAX(peso),
                 MAX(status='confirmed'), MAX(status='disputed')
          FROM edges GROUP BY src, rel, dst HAVING COUNT(*) > 1""")
        dup_grupos = cur.fetchall()
        edges_dedup = 0
        for keep, id_csv, soma, pmax, tem_conf, tem_disp in dup_grupos:
            todos = [int(x) for x in id_csv.split(",")]
            drop = [i for i in todos if i != keep]
            edges_dedup += len(drop)
            qm = ",".join("?" * len(drop))
            cur.execute(f"UPDATE evidences SET edge_id=? WHERE edge_id IN ({qm})", [keep] + drop)
            status = "disputed" if tem_disp else ("confirmed" if tem_conf else "claimed")
            cur.execute("UPDATE edges SET n_fontes=?, peso=?, status=? WHERE id=?",
                        (soma, pmax, status, keep))
            cur.execute(f"DELETE FROM edges WHERE id IN ({qm})", drop)

        # 4) dedup de evidences exatamente idênticas (mantém maior confiança)
        cur.execute("""
          DELETE FROM evidences WHERE id NOT IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (
                PARTITION BY edge_id, livro, chunk_id, trecho
                ORDER BY confianca DESC, id) rn
              FROM evidences) WHERE rn=1)""")
        ev_dedup = cur.rowcount

        # 5) fonte da verdade: n_fontes = COUNT(DISTINCT livro) das evidences;
        #    promove confirmed quando >=2 (não mexe em disputed);
        #    peso = min(0.25 + 0.15*n_fontes, 1.0) — fórmula do extractor v1
        cur.execute("""
          UPDATE edges SET n_fontes = (
            SELECT COUNT(DISTINCT livro) FROM evidences WHERE edge_id = edges.id)
          WHERE EXISTS (SELECT 1 FROM evidences WHERE edge_id = edges.id)""")
        cur.execute("""UPDATE edges SET status='confirmed'
                       WHERE n_fontes >= 2 AND status != 'disputed'""")
        cur.execute("UPDATE edges SET peso = MIN(0.25 + 0.15 * n_fontes, 1.0)")

        # 6) remove nodes fundidos
        cur.execute("DELETE FROM nodes WHERE id IN (SELECT old FROM map)")

        # 7) integridade — falhou → rollback
        soltas = cur.execute("""SELECT COUNT(*) FROM edges e
          WHERE NOT EXISTS(SELECT 1 FROM nodes n WHERE n.id=e.src)
             OR NOT EXISTS(SELECT 1 FROM nodes n WHERE n.id=e.dst)""").fetchone()[0]
        orfas = cur.execute("""SELECT COUNT(*) FROM evidences ev
          WHERE NOT EXISTS(SELECT 1 FROM edges e WHERE e.id=ev.edge_id)""").fetchone()[0]
        sem_ev = cur.execute("""SELECT COUNT(*) FROM edges e
          WHERE NOT EXISTS(SELECT 1 FROM evidences ev WHERE ev.edge_id=e.id)""").fetchone()[0]
        if soltas or orfas or sem_ev:
            raise RuntimeError(
                f"integridade violada: pontas_soltas={soltas} evidences_orfas={orfas} "
                f"edges_sem_evidence={sem_ev}")

        con.commit()
    except Exception:
        con.rollback()
        raise

    depois = {
        "conceitos": cur.execute("SELECT COUNT(*) FROM nodes WHERE tipo='conceito'").fetchone()[0],
        "edges": cur.execute("SELECT COUNT(*) FROM edges").fetchone()[0],
        "evidences": cur.execute("SELECT COUNT(*) FROM evidences").fetchone()[0],
        "confirmed": cur.execute("SELECT COUNT(*) FROM edges WHERE status='confirmed'").fetchone()[0],
    }
    con.execute("VACUUM")
    con.close()

    ALIASES.write_text(
        json.dumps(aliases, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8")
    report = {
        "quando": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "threshold": threshold,
        "decisao_threshold": (
            "corte de cosseno informado em --threshold; pares limítrofes "
            "revisados com --report antes do --apply. Falsos positivos "
            "residuais tratados por blocklist manual."),
        "pares_bloqueados": [sorted(p) for p in sorted(BLOCKLIST, key=lambda s: sorted(s))],
        "modelo_embedding": EMB_MODEL,
        "clusters": len(clusters),
        "nodes_fundidos": len(mapa),
        "self_loops_removidos": len(loops),
        "edges_dedup_removidos": edges_dedup,
        "evidences_dedup_removidas": ev_dedup,
        "antes": antes,
        "depois": depois,
        "canonico": "maior grau; empate: label mais curto, depois alfabético",
        "aliases_em": str(ALIASES.relative_to(ROOT)) if ALIASES.is_relative_to(ROOT) else ALIASES.name,
        "nota_schema": "nodes não tem campo metadata — aliases externalizados em aliases.json",
    }
    REPORT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description="Normalização semântica do livros-kg")
    ap.add_argument("--embed", action="store_true", help="embedda labels e cacheia")
    ap.add_argument("--report", action="store_true", help="estatísticas + pares limítrofes")
    ap.add_argument("--apply", action="store_true", help="aplica merge no sqlite")
    ap.add_argument("--threshold", type=float, default=0.93)
    ap.add_argument("--janela", type=float, default=0.02, help="janela dos pares limítrofes")
    a = ap.parse_args()
    if a.embed:
        cmd_embed()
    elif a.report:
        cmd_report(a.threshold, a.janela)
    elif a.apply:
        cmd_apply(a.threshold)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
