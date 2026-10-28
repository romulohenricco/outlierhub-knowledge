import { execFileSync } from "node:child_process";

/**
 * A CLI `sqlite3` (com FTS5) é a mesma que o app usa para ler busca, grafo e
 * coleções. No Windows ela não vem instalada (docs/dados.md), então os blocos de
 * teste que a chamam são pulados quando ela falta, como em lib/kg-foco.test.ts:
 * `describe.skipIf(!TEM_SQLITE3_FTS5)(...)`.
 */
function sqliteComFts5(): boolean {
  try {
    execFileSync("sqlite3", [":memory:", "CREATE VIRTUAL TABLE t USING fts5(x);"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export const TEM_SQLITE3_FTS5 = sqliteComFts5();
