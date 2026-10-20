# -*- coding: utf-8 -*-
"""
kg-extract.py — gera data/kg/livros-kg.sqlite (grafo de conhecimento) a partir
de fontes JÁ DENTRO do repo:

  Fontes de triplas:
    1. Chunks das coleções externas (data/colecoes-external/sources/*/_corpus_bge.sqlite,
       tabela chunks(chunk_id, video, text)) — amostragem com teto de MAX_CHUNKS_COLECAO
       por coleção (stride uniforme sobre rowid; o que ficou de fora é registrado).
    2. Texto dos livros (data/livros/arquivos/*.pdf) via pdftotext, quando o PDF
       tem camada de texto — MAX_TRECHOS_LIVRO trechos por livro (~20%/60% do texto).
       PDFs image-based (sem texto) entram SÓ como node tipo 'livro' (registrado).

  Extração: LLM local via Ollama HTTP (qwen2.5:7b, few-shot, format=json, temp 0),
  triplas conceito-relação-conceito SEMPRE em PT-BR. Time-box global: DEADLINE_S.

  Schema de saída = EXATAMENTE o que lib/kg.ts lê:
    nodes(id TEXT PK, label TEXT, tipo TEXT)               -- tipo: 'conceito' | 'livro'
    edges(id INTEGER PK, src, rel, dst, status, n_fontes, peso)
       status: 'claimed' → 'confirmed' quando n_fontes >= 2 (fontes distintas)
       edges de pertencimento: src='livro:<arquivo>', rel='menciona', dst=<conceito>
    evidences(id INTEGER PK, edge_id, livro, chunk_id, trecho, confianca)
       livro = arquivo do catálogo (livros) ou 'yt-<colecao>:<video>' (coleções,
       casa com data/kg/youtube-map.json — ver ytDe() em lib/kg.ts)

  Escrita exclusiva deste script (lib/kg.ts é read-only). Sidecar de layout é
  gerado depois por scripts/graph-layout.mjs.

  --- v2 ---
  `python scripts/kg-extract.py --v2` NÃO reconstrói o banco: faz MERGE incremental
  no data/kg/livros-kg.sqlite existente, cobrindo os stores que o v1 não amostrou:
    - enumera TODOS os data/colecoes-external/**/_corpus_bge.sqlite;
    - store já coberto = existe evidence com prefixo 'yt-<slug-da-pasta>:' no kg
      (cobre o que o v1 amostrou);
    - mesmo slug em sources/ e dna/persons/ → fica o store com MAIS chunks
      (dedup por slug; o descartado é registrado no report);
    - até MAX_CHUNKS_STORE_V2 chunks por store (stride uniforme sobre rowid, igual
      v1), fila ordenada por tamanho desc (stores maiores primeiro no deadline);
    - mesmo prompt few-shot PT-BR, qwen2.5:7b, format=json, temp 0;
      time-box KG_V2_DEADLINE_S (default 5400 s = 90 min);
    - merge: node/edge deduplicados ((src,rel,dst) idêntico reusa a edge; evidência
      idêntica (edge,livro,chunk) não re-insere); edges existentes NÃO são tocadas
      (n_fontes/status/peso recalculados numa fase posterior — aqui não promove);
      edge nova nasce claimed/n_fontes=1/peso 0.4 (fórmula v1 p/ 1 fonte);
    - report: adiciona bloco "v2" ao data/kg/extract-report.json (v1 preservado).
"""
import glob
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import unicodedata
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLLAMA = (os.environ.get("BILHON_OLLAMA_URL") or "").strip().rstrip("/") or "http://127.0.0.1:11434"
MODELO = os.environ.get("KG_MODELO") or "qwen2.5:7b"
DEADLINE_S = int(os.environ.get("KG_DEADLINE_S") or "1800")  # 30 min de fase LLM
MAX_CHUNKS_COLECAO = 40
MAX_TRECHOS_LIVRO = 2
TAM_TRECHO_LIVRO = 1400  # chars enviados ao LLM por trecho de livro
TAM_MAX_CHUNK = 1500     # chunk de coleção truncado nisso antes do prompt


def descobre_colecoes() -> list:
    """Coleções a amostrar: BILHON_KG_COLECOES (CSV) quando preenchida; em branco,
    descobre as pastas de data/colecoes-external/sources/ que tenham corpus."""
    pedidas = [c.strip() for c in (os.environ.get("BILHON_KG_COLECOES") or "").split(",") if c.strip()]
    if pedidas:
        return pedidas
    base = os.path.join(RAIZ, "data", "colecoes-external", "sources")
    try:
        return sorted(
            nome for nome in os.listdir(base)
            if os.path.isfile(os.path.join(base, nome, "_corpus_bge.sqlite"))
        )
    except OSError:
        return []


COLECOES = descobre_colecoes()

# BILHON_KG_DB é o mesmo sqlite que o app lê (lib/kg.ts): sem isso o grafo seria gerado
# em data/kg e o app leria outro arquivo, sem erro nenhum
DB_SAIDA = os.path.abspath(os.environ.get("BILHON_KG_DB") or os.path.join(RAIZ, "data", "kg", "livros-kg.sqlite"))
REPORT = os.path.join(os.path.dirname(DB_SAIDA), "extract-report.json")
PDFTOTEXT = None
for cand in ["pdftotext"]:
    try:
        subprocess.run([cand, "-v"], capture_output=True, timeout=15)
        PDFTOTEXT = cand
        break
    except Exception:
        continue

PROMPT_BASE = (
    "Extraia triplas conceito-relacao-conceito do TEXTO. Saida SOMENTE JSON.\n"
    "REGRAS: conceitos curtos (2-4 palavras) SEMPRE traduzidos para portugues brasileiro; "
    "sem nomes de pessoas, marcas ou empresas como conceito; "
    "relacoes em pt-br minusculas: usa, gera, exige, reduz, aumenta, faz-parte-de, "
    "precede, resolve, influencia. Max 6 triplas.\n"
    "EXEMPLO — TEXTO: 'Deep work requires blocking distractions to produce rare value.'\n"
    'SAIDA: {"triplas":[{"src":"trabalho profundo","rel":"exige","dst":"bloqueio de distracoes"},'
    '{"src":"trabalho profundo","rel":"gera","dst":"valor raro"}]}\n\n'
    "TEXTO:\n{texto}\nSAIDA:"
)
RELS_OK = {
    "usa", "gera", "exige", "reduz", "aumenta", "faz-parte-de", "precede",
    "resolve", "influencia", "relaciona-se", "depende-de", "aborda",
}
STOPWORDS_LABEL = {"de", "da", "do", "das", "dos", "e", "em", "a", "o", "para", "com", "no", "na"}


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s


def rotulo(s: str) -> str:
    palavras = s.strip().split()
    out = []
    for i, p in enumerate(palavras):
        out.append(p.lower() if (i > 0 and p.lower() in STOPWORDS_LABEL) else p.capitalize())
    return " ".join(out)


def normaliza_rel(rel: str) -> str:
    r = slug(rel)
    return r if (r in RELS_OK or (1 <= len(r) <= 30 and r.count("-") <= 3)) else "relaciona-se"


def conceito_valido(c: str) -> bool:
    c = c.strip()
    return 2 <= len(c) <= 60 and len(c.split()) <= 5 and not re.search(r"[{}\[\]\"<>]", c)


def chama_llm(texto: str) -> list[dict] | None:
    """Uma chamada ao Ollama; retorna lista de triplas ou None em falha."""
    corpo = json.dumps({
        "model": MODELO,
        "prompt": PROMPT_BASE.replace("{texto}", texto),
        "stream": False,
        "format": "json",
        "options": {"temperature": 0, "num_predict": 350},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA}/api/generate", data=corpo, headers={"Content-Type": "application/json"}
    )
    try:
        resp = json.load(urllib.request.urlopen(req, timeout=90))
        dado = json.loads(resp.get("response", "{}"))
        triplas = dado.get("triplas", [])
        return triplas if isinstance(triplas, list) else None
    except Exception:
        return None


class Grafo:
    def __init__(self):
        self.nodes: dict[str, tuple[str, str]] = {}  # id -> (label, tipo)
        self.edges: dict[tuple[str, str, str], list[dict]] = {}  # (src,rel,dst) -> evidences

    def no_conceito(self, surface: str) -> str | None:
        sid = slug(surface)
        if not sid or len(sid) < 2:
            return None
        if sid not in self.nodes:
            self.nodes[sid] = (rotulo(surface), "conceito")
        return sid

    def no_livro(self, arquivo: str, titulo: str) -> str:
        nid = f"livro:{arquivo}"
        self.nodes[nid] = (titulo, "livro")
        return nid

    def aresta(self, src: str, rel: str, dst: str, livro: str, chunk_id: str,
               trecho: str, confianca: float):
        chave = (src, rel, dst)
        self.edges.setdefault(chave, []).append(
            {"livro": livro, "chunk_id": chunk_id,
             "trecho": trecho[:240], "confianca": confianca}
        )


def processa_triplas(g: Grafo, triplas: list[dict], livro_ev: str, chunk_id: str,
                     trecho: str) -> int:
    """Insere triplas válidas no grafo; retorna quantas entraram."""
    ok = 0
    for t in triplas[:6]:
        if not isinstance(t, dict):
            continue
        s, r, d = str(t.get("src", "")), str(t.get("rel", "")), str(t.get("dst", ""))
        if not (conceito_valido(s) and conceito_valido(d) and r.strip()):
            continue
        sid, did = g.no_conceito(s), g.no_conceito(d)
        if not sid or not did or sid == did:
            continue
        g.aresta(sid, normaliza_rel(r), did, livro_ev, chunk_id, trecho, 0.6)
        ok += 1
    return ok


def main():
    inicio = time.time()
    rel: dict = {"modelo": MODELO, "extrator_pdf": PDFTOTEXT or "ausente",
                 "deadline_s": DEADLINE_S, "fontes": {}, "livros": {}, "avisos": []}
    g = Grafo()

    # ---- 1. Catálogo: todos os livros viram nodes tipo 'livro' ----
    with open(os.path.join(RAIZ, "data", "livros", "catalogo.json"), encoding="utf-8") as f:
        catalogo = json.load(f)
    livros = catalogo if isinstance(catalogo, list) else catalogo.get("livros", [])
    for lv in livros:
        g.no_livro(lv["arquivo"], lv["titulo"])

    # ---- 2. Amostragem das coleções (teto MAX_CHUNKS_COLECAO, stride uniforme) ----
    fila = []  # itens: (tipo, fonte, chunk_id, video/arquivo, texto)
    for col in COLECOES:
        db = os.path.join(RAIZ, "data", "colecoes-external", "sources", col, "_corpus_bge.sqlite")
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        total = con.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        n = min(MAX_CHUNKS_COLECAO, total)
        passo = max(1, total // n)
        rows = con.execute(
            "SELECT chunk_id, video, text FROM chunks WHERE rowid % ? = 1 "
            "ORDER BY rowid LIMIT ?", (passo, n)
        ).fetchall()
        con.close()
        rel["fontes"][col] = {"chunks_total": total, "amostrados": len(rows),
                              "fora_da_amostra": total - len(rows),
                              "processados": 0, "falhas_llm": 0, "triplas": 0}
        for cid, video, texto in rows:
            fila.append(("colecao", col, cid, video, texto[:TAM_MAX_CHUNK]))

    # intercala as coleções (round-robin) pra deadline não zerar nenhuma
    por_col: dict[str, list] = {}
    for item in fila:
        por_col.setdefault(item[1], []).append(item)
    fila = []
    while any(por_col.values()):
        for col in COLECOES:
            if por_col.get(col):
                fila.append(por_col[col].pop(0))

    # ---- 3. Livros: trechos via pdftotext (se disponível) ----
    fila_livros = []
    sem_texto, com_texto = [], []
    if PDFTOTEXT:
        for lv in livros:
            caminho = os.path.join(RAIZ, "data", "livros", "arquivos", lv["arquivo"])
            if not os.path.exists(caminho) or lv.get("formato") != "pdf":
                sem_texto.append(lv["arquivo"])
                continue
            try:
                p = subprocess.run([PDFTOTEXT, "-q", caminho, "-"],
                                   capture_output=True, timeout=120)
                texto = p.stdout.decode("utf-8", errors="ignore")
            except Exception:
                texto = ""
            texto = re.sub(r"\s+", " ", texto).strip()
            if len(texto) < 500:
                sem_texto.append(lv["arquivo"])  # image-based / vazio → só node
                continue
            com_texto.append(lv["arquivo"])
            for k, frac in enumerate([0.2, 0.6][:MAX_TRECHOS_LIVRO]):
                ini = int(len(texto) * frac)
                trecho = texto[ini:ini + TAM_TRECHO_LIVRO]
                if len(trecho) > 300:
                    fila_livros.append(("livro", lv["arquivo"], f"{lv['arquivo']}#{k}",
                                        lv["arquivo"], trecho))
    else:
        rel["avisos"].append("pdftotext ausente — livros entraram só como nodes, sem triplas")
    rel["livros"] = {
        "total_catalogo": len(livros), "com_texto": len(com_texto),
        "sem_texto_extraivel": len(sem_texto), "trechos_por_livro": MAX_TRECHOS_LIVRO,
        "tam_trecho_chars": TAM_TRECHO_LIVRO,
        "obs": "amostra = 2 trechos (~20%/60% do texto) por livro; o resto do texto ficou fora",
        "arquivos_sem_texto": sem_texto,
    }

    # ---- 4. Fase LLM (deadline global) ----
    t_llm = time.time()
    pendentes = fila + fila_livros
    processados = 0
    estourou = False
    for tipo, fonte, chunk_id, video, texto in pendentes:
        if time.time() - t_llm > DEADLINE_S:
            estourou = True
            break
        triplas = chama_llm(texto)
        processados += 1
        if tipo == "colecao":
            st = rel["fontes"][fonte]
            st["processados"] += 1
            if triplas is None:
                st["falhas_llm"] += 1
                continue
            livro_ev = f"yt-{fonte}:{video}"
            st["triplas"] += processa_triplas(g, triplas, livro_ev, chunk_id, texto)
        else:
            if triplas is None:
                rel["livros"].setdefault("falhas_llm", 0)
                rel["livros"]["falhas_llm"] = rel["livros"].get("falhas_llm", 0) + 1
                continue
            n_ok = processa_triplas(g, triplas, fonte, chunk_id, texto)
            rel["livros"]["triplas"] = rel["livros"].get("triplas", 0) + n_ok
            # edges de pertencimento livro→conceito ('menciona')
            for t in triplas[:6]:
                if not isinstance(t, dict):
                    continue
                for c in (str(t.get("src", "")), str(t.get("dst", ""))):
                    if conceito_valido(c):
                        cid = g.no_conceito(c)
                        if cid:
                            g.aresta(f"livro:{fonte}", "menciona", cid,
                                     fonte, chunk_id, texto, 0.5)
        if processados % 20 == 0:
            print(f"[{int(time.time()-t_llm)}s] {processados}/{len(pendentes)} itens, "
                  f"{len(g.nodes)} nodes, {len(g.edges)} edges", flush=True)

    nao_processados = len(pendentes) - processados
    rel["deadline_estourado"] = estourou
    rel["itens_na_fila"] = len(pendentes)
    rel["itens_processados"] = processados
    rel["itens_fora_por_deadline"] = nao_processados
    if estourou:
        restantes: dict[str, int] = {}
        for tipo, fonte, *_ in pendentes[processados:]:
            chave = fonte if tipo == "colecao" else "livros"
            restantes[chave] = restantes.get(chave, 0) + 1
        rel["fora_por_deadline_detalhe"] = restantes

    # ---- 5. Consolidação e escrita do sqlite ----
    if os.path.exists(DB_SAIDA):
        # a v1 recria o grafo do zero: guarda o anterior (pode ser o v2 já normalizado)
        copia = f"{os.path.splitext(DB_SAIDA)[0]}.pre-extract-{time.strftime('%Y%m%d-%H%M%S')}.bak.sqlite"
        shutil.copy2(DB_SAIDA, copia)
        print(f"backup do grafo anterior: {copia}")
        os.remove(DB_SAIDA)
    os.makedirs(os.path.dirname(DB_SAIDA), exist_ok=True)
    con = sqlite3.connect(DB_SAIDA)
    con.executescript(
        """
        CREATE TABLE nodes (
          id    TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          tipo  TEXT NOT NULL
        );
        CREATE TABLE edges (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          src      TEXT NOT NULL,
          rel      TEXT NOT NULL,
          dst      TEXT NOT NULL,
          status   TEXT NOT NULL DEFAULT 'claimed',
          n_fontes INTEGER NOT NULL DEFAULT 1,
          peso     REAL NOT NULL DEFAULT 0.3
        );
        CREATE TABLE evidences (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          edge_id   INTEGER NOT NULL REFERENCES edges(id),
          livro     TEXT NOT NULL,
          chunk_id  TEXT NOT NULL,
          trecho    TEXT NOT NULL,
          confianca REAL NOT NULL
        );
        CREATE INDEX idx_evidences_edge ON evidences(edge_id);
        CREATE INDEX idx_evidences_livro ON evidences(livro);
        CREATE INDEX idx_edges_status ON edges(status);
        """
    )
    # só grava nodes com pelo menos 1 aresta OU tipo livro (catálogo completo)
    usados = set()
    for (s, _, d) in g.edges:
        usados.add(s)
        usados.add(d)
    n_nodes = 0
    for nid, (label, tipo) in g.nodes.items():
        if tipo == "livro" or nid in usados:
            con.execute("INSERT INTO nodes (id,label,tipo) VALUES (?,?,?)", (nid, label, tipo))
            n_nodes += 1
    n_conf = 0
    for (src, rl, dst), evs in g.edges.items():
        fontes_distintas = len({e["livro"] for e in evs})
        status = "confirmed" if fontes_distintas >= 2 else "claimed"
        if status == "confirmed":
            n_conf += 1
        peso = round(min(0.95, 0.25 + 0.15 * fontes_distintas), 2)
        cur = con.execute(
            "INSERT INTO edges (src,rel,dst,status,n_fontes,peso) VALUES (?,?,?,?,?,?)",
            (src, rl, dst, status, fontes_distintas, peso),
        )
        eid = cur.lastrowid
        for e in evs:
            con.execute(
                "INSERT INTO evidences (edge_id,livro,chunk_id,trecho,confianca) "
                "VALUES (?,?,?,?,?)",
                (eid, e["livro"], e["chunk_id"], e["trecho"], e["confianca"]),
            )
    con.commit()
    n_edges = con.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    n_evs = con.execute("SELECT COUNT(*) FROM evidences").fetchone()[0]
    con.close()

    rel["resultado"] = {"nodes": n_nodes, "edges": n_edges, "evidences": n_evs,
                        "confirmed": n_conf, "duracao_s": int(time.time() - inicio)}
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(rel, f, ensure_ascii=False, indent=1)
    print(json.dumps(rel["resultado"], ensure_ascii=False))
    print(f"OK -> {DB_SAIDA}")  # ASCII: console Windows pode ser cp1252


# ---------------------------------------------------------------------------
# v2 — merge incremental dos stores que o v1 não amostrou (ver docstring, bloco v2)
# ---------------------------------------------------------------------------
MAX_CHUNKS_STORE_V2 = 30
V2_DEADLINE_S = int(os.environ.get("KG_V2_DEADLINE_S") or "5400")  # 90 min de fase LLM
BAK = os.path.join(os.path.dirname(DB_SAIDA), "livros-kg.v1.bak.sqlite")
DIR_COLEXT = os.path.join(RAIZ, "data", "colecoes-external")


def enumera_stores_v2():
    """Enumera TODOS os **/_corpus_bge.sqlite; dedup por slug da pasta —
    fica o store com MAIS chunks, o outro vai pro report como descartado."""
    achados = []
    for db in glob.glob(os.path.join(DIR_COLEXT, "**", "_corpus_bge.sqlite"),
                        recursive=True):
        s = slug(os.path.basename(os.path.dirname(db)))
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            total = con.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
            con.close()
        except Exception as ex:
            achados.append({"slug": s, "db": db, "caminho": db, "chunks_total": -1,
                            "erro": str(ex)})
            continue
        achados.append({"slug": s, "db": db,
                        "caminho": os.path.relpath(db, DIR_COLEXT).replace(os.sep, "/"),
                        "chunks_total": total})
    por_slug: dict[str, dict] = {}
    descartados = []
    for st in sorted(achados, key=lambda x: (-x["chunks_total"], x["caminho"])):
        if st["slug"] in por_slug:
            descartados.append({"slug": st["slug"], "descartado": st["caminho"],
                                "chunks_total": st["chunks_total"],
                                "mantido": por_slug[st["slug"]]["caminho"]})
        else:
            por_slug[st["slug"]] = st
    return por_slug, descartados


def amostra_stride_v2(db: str, n_max: int):
    """Stride uniforme sobre rowid, igual v1 — mas cobre o caso passo=1
    (stores pequenos: rowid % 1 = 1 nunca casa; aqui vira SELECT direto)."""
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    total = con.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    n = min(n_max, total)
    if n <= 0:
        con.close()
        return total, []
    passo = max(1, total // n)
    if passo == 1:
        rows = con.execute(
            "SELECT chunk_id, video, text FROM chunks ORDER BY rowid LIMIT ?", (n,)
        ).fetchall()
    else:
        rows = con.execute(
            "SELECT chunk_id, video, text FROM chunks WHERE rowid % ? = 1 "
            "ORDER BY rowid LIMIT ?", (passo, n)
        ).fetchall()
    con.close()
    return total, rows


def main_v2():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    inicio = time.time()
    if not os.path.exists(DB_SAIDA):
        print("ERRO: data/kg/livros-kg.sqlite ausente — rode o v1 antes.")
        return 1

    # backup ANTES da primeira mutação (não sobrescreve se já existir)
    if not os.path.exists(BAK):
        shutil.copy2(DB_SAIDA, BAK)
        print(f"backup criado: {BAK}")
    else:
        print(f"backup ja existia (preservado): {BAK}")

    # stores já cobertos = existe evidence com prefixo 'yt-<slug>:' no kg
    con = sqlite3.connect(f"file:{DB_SAIDA}?mode=ro", uri=True)
    prefixos = {
        r[0].split(":", 1)[0][3:]
        for r in con.execute("SELECT DISTINCT livro FROM evidences WHERE livro LIKE 'yt-%'")
    }
    con.close()

    por_slug, descartados = enumera_stores_v2()
    cobertos = sorted(s for s in por_slug if s in prefixos)
    alvo = sorted((st for s, st in por_slug.items() if s not in prefixos),
                  key=lambda x: -x["chunks_total"])  # maiores primeiro no deadline

    v2: dict = {"modelo": MODELO, "deadline_s": V2_DEADLINE_S,
                "max_chunks_store": MAX_CHUNKS_STORE_V2,
                "stores_enumerados": len(por_slug) + len(descartados),
                "stores_unicos": len(por_slug),
                "ja_cobertos": cobertos,
                "dedup_descartados": descartados,
                "stores": {}, "avisos": []}
    for st in alvo:
        if st["chunks_total"] < 0:
            v2["avisos"].append(f"store ilegivel: {st['caminho']} ({st.get('erro')})")

    # ---- amostragem (teto MAX_CHUNKS_STORE_V2, stride uniforme) ----
    fila = []  # (slug_store, chunk_id, video, texto)
    for st in alvo:
        if st["chunks_total"] < 0:
            continue
        total, rows = amostra_stride_v2(st["db"], MAX_CHUNKS_STORE_V2)
        v2["stores"][st["slug"]] = {
            "caminho": st["caminho"], "chunks_total": total,
            "amostrados": len(rows), "fora_da_amostra": total - len(rows),
            "processados": 0, "falhas_llm": 0, "triplas": 0,
        }
        for cid, video, texto in rows:
            fila.append((st["slug"], cid, video, (texto or "")[:TAM_MAX_CHUNK]))
    print(f"v2: {len(alvo)} stores nao cobertos, {len(fila)} chunks na fila "
          f"(cobertos: {len(cobertos)}, dedup descartados: {len(descartados)})", flush=True)

    # ---- fase LLM (mesmo prompt/params do v1; time-box V2_DEADLINE_S) ----
    g = Grafo()
    t_llm = time.time()
    processados = 0
    estourou = False
    for fonte, cid, video, texto in fila:
        if time.time() - t_llm > V2_DEADLINE_S:
            estourou = True
            break
        triplas = chama_llm(texto)
        processados += 1
        stt = v2["stores"][fonte]
        stt["processados"] += 1
        if triplas is None:
            stt["falhas_llm"] += 1
        else:
            stt["triplas"] += processa_triplas(g, triplas, f"yt-{fonte}:{video}", cid, texto)
        if processados % 20 == 0:
            print(f"[{int(time.time()-t_llm)}s] {processados}/{len(fila)} chunks, "
                  f"{len(g.nodes)} conceitos, {len(g.edges)} triplas distintas", flush=True)

    v2["deadline_estourado"] = estourou
    v2["itens_na_fila"] = len(fila)
    v2["itens_processados"] = processados  # = chamadas LLM (1 por chunk)
    v2["itens_fora_por_deadline"] = len(fila) - processados
    if estourou:
        rest: dict[str, int] = {}
        for fonte, *_ in fila[processados:]:
            rest[fonte] = rest.get(fonte, 0) + 1
        v2["fora_por_deadline_detalhe"] = rest

    # ---- merge incremental (uma transação; edges existentes NÃO são tocadas) ----
    con = sqlite3.connect(DB_SAIDA)
    con.execute("PRAGMA busy_timeout=5000")
    cur = con.cursor()
    cur.execute("BEGIN IMMEDIATE")  # falha se outro processo estiver escrevendo
    antes = {t: cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
             for t in ("nodes", "edges", "evidences")}
    node_ids = {r[0] for r in cur.execute("SELECT id FROM nodes")}
    edge_map = {(s, r, d): i for i, s, r, d in
                cur.execute("SELECT id,src,rel,dst FROM edges")}
    ev_set = set(cur.execute("SELECT edge_id,livro,chunk_id FROM evidences"))
    m = {"nodes_novos": 0, "edges_novas": 0, "edges_reusadas": 0,
         "evidences_novas": 0, "evidences_dedup": 0}
    for (src, rl, dst), evs in g.edges.items():
        for nid in (src, dst):
            if nid not in node_ids:
                label, tipo = g.nodes[nid]
                cur.execute("INSERT INTO nodes (id,label,tipo) VALUES (?,?,?)",
                            (nid, label, tipo))
                node_ids.add(nid)
                m["nodes_novos"] += 1
        chave = (src, rl, dst)
        if chave in edge_map:
            eid = edge_map[chave]  # não promove: n_fontes/status/peso ficam pra fase seguinte
            m["edges_reusadas"] += 1
        else:
            cur.execute(
                "INSERT INTO edges (src,rel,dst,status,n_fontes,peso) VALUES (?,?,?,?,?,?)",
                (src, rl, dst, "claimed", 1, 0.4),
            )
            eid = cur.lastrowid
            edge_map[chave] = eid
            m["edges_novas"] += 1
        for e in evs:
            evk = (eid, e["livro"], e["chunk_id"])
            if evk in ev_set:
                m["evidences_dedup"] += 1
                continue
            cur.execute(
                "INSERT INTO evidences (edge_id,livro,chunk_id,trecho,confianca) "
                "VALUES (?,?,?,?,?)",
                (eid, e["livro"], e["chunk_id"], e["trecho"], e["confianca"]),
            )
            ev_set.add(evk)
            m["evidences_novas"] += 1
    con.commit()
    depois = {t: cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ("nodes", "edges", "evidences")}
    solta = cur.execute(
        """SELECT COUNT(*) FROM edges e LEFT JOIN nodes n1 ON n1.id=e.src
           LEFT JOIN nodes n2 ON n2.id=e.dst WHERE n1.id IS NULL OR n2.id IS NULL"""
    ).fetchone()[0]
    ev_solta = cur.execute(
        """SELECT COUNT(*) FROM evidences ev LEFT JOIN edges e ON e.id=ev.edge_id
           WHERE e.id IS NULL"""
    ).fetchone()[0]
    con.close()
    m["antes"] = antes
    m["depois"] = depois
    v2["merge"] = m
    v2["integridade"] = {"edges_ponta_solta": solta, "evidences_orfas": ev_solta}
    v2["duracao_s"] = int(time.time() - inicio)

    # ---- report: preserva o v1, adiciona bloco "v2" ----
    with open(REPORT, encoding="utf-8") as f:
        rel = json.load(f)
    rel["v2"] = v2
    with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(rel, f, ensure_ascii=False, indent=1)
        f.write("\n")
    resumo = {"stores": len(v2["stores"]), "chamadas_llm": processados,
              "triplas": sum(s["triplas"] for s in v2["stores"].values()),
              "merge": m, "deadline_estourado": estourou,
              "duracao_s": v2["duracao_s"]}
    print(json.dumps(resumo, ensure_ascii=False))
    print(f"OK v2 -> {DB_SAIDA}")
    return 1 if (solta or ev_solta) else 0


if __name__ == "__main__":
    sys.exit(main_v2() if "--v2" in sys.argv else main())
