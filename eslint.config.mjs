import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// eslint-config-next 16 já exporta a configuração no formato flat (sem FlatCompat)
const eslintConfig = defineConfig([
  ...nextVitals,
  {
    // regras do eslint-plugin-react-hooks 7 (React Compiler) que chegaram com o eslint-config-next 16;
    // o código dos componentes é anterior a elas: ficam como aviso até a refatoração
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  globalIgnores(["node_modules/**", ".next/**", ".next-build/**", "out/**", "fixtures/**", "next-env.d.ts"]),
]);

export default eslintConfig;
