import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Carpetas que no se lintan:
  // - `dist` (build output)
  // - `supabase/functions/_legacy` (edge functions arqueológicas, congeladas
  //   con su lint legacy; conservadas en disco via `_` prefix que el bundler
  //   y los workflows de deploy ignoran)
  // - `supabase/migrations.legacy-backup` (backup gitignored — defensa extra)
  { ignores: ["dist", "supabase/functions/_legacy/**", "supabase/migrations.legacy-backup/**"] },
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
