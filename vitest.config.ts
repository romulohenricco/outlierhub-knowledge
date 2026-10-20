import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";

// resolve o alias "@/..." (mesmo do tsconfig paths) para os testes que importam
// rotas/componentes via "@/lib/...".
export default defineConfig(() => {
  const testTemp = path.resolve("node_modules/.cache/knowledge-tests");
  mkdirSync(testTemp, { recursive: true });
  return {
    // componentes .tsx renderizados em teste (react-dom/server) usam o JSX automático do React 19
    oxc: { jsx: { runtime: "automatic" as const } },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL(".", import.meta.url)),
      },
    },
    test: {
      maxWorkers: 2,
      env: { TEMP: testTemp, TMP: testTemp, TMPDIR: testTemp },
      // Volumes lentos (rede, externos) podem ter latência alta para I/O de fixtures no Windows.
      hookTimeout: 60_000,
      testTimeout: 60_000,
      // git worktrees de agents vivem em .claude/worktrees/ e duplicam TODOS os
      // testes: as duas cópias rodam no mesmo processo, mutam a mesma env var no
      // beforeAll e se sabotam (404 falso). Excluir também .next/out (builds).
      exclude: [...configDefaults.exclude, ".claude/**", ".next/**", ".next-build/**", "out/**", "data/**"],
    },
  };
});
