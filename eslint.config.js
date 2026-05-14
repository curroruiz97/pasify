import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Carpetas que no se lintan:
  // - `dist` (build output)
  // - `tools/legacy-supabase-functions` (edge functions arqueológicas
  //   conservadas en disco como referencia histórica; movidas aquí desde
  //   supabase/functions/_legacy/ en mayo 2026 para que ni siquiera
  //   aparezcan en deploy scripts. Lint legacy congelado.)
  // - `supabase/functions/_legacy` (alias por si vuelve durante un
  //   revert; defensa extra)
  // - `supabase/migrations.legacy-backup` (backup gitignored — defensa extra)
  {
    ignores: [
      "dist",
      "tools/legacy-supabase-functions/**",
      "supabase/functions/_legacy/**",
      "supabase/migrations.legacy-backup/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Codebase ha molti `any` legacy — segnalati ma non bloccanti.
      // Da promuovere a "error" quando saranno tutti tipizzati.
      "@typescript-eslint/no-explicit-any": "warn",
      // tailwind.config.ts usa require() per i plugin (pattern standard).
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
