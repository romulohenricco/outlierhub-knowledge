import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// eslint-config-next 16 já exporta a configuração no formato flat (sem FlatCompat).
// As regras do eslint-plugin-react-hooks 7 (set-state-in-effect, refs, immutability)
// seguem o padrão do Next: erro.
const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores(["node_modules/**", ".next/**", ".next-build/**", "out/**", "fixtures/**", "next-env.d.ts"]),
]);

export default eslintConfig;
