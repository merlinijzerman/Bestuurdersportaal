import nextPlugin from "@next/eslint-plugin-next";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

const TSX_FILES = ["app/**/*.{ts,tsx}", "core/**/*.{ts,tsx}", "platform/**/*.{ts,tsx}", "fondsen/**/*.{ts,tsx}"];

function rapporterend(regels) {
  return Object.fromEntries(
    Object.entries(regels).map(([naam, instelling]) => {
      if (instelling === "off" || instelling === 0) return [naam, "off"];
      if (Array.isArray(instelling) && (instelling[0] === "off" || instelling[0] === 0)) {
        return [naam, instelling];
      }
      if (Array.isArray(instelling)) return [naam, ["warn", ...instelling.slice(1)]];
      return [naam, "warn"];
    }),
  );
}

export default [
  {
    ignores: ["node_modules/**", ".next/**", "coverage/**", "playwright-report/**", "test-results/**"],
  },
  {
    files: TSX_FILES,
    plugins: {
      "@next/next": nextPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...rapporterend(reactPlugin.configs.flat.recommended.rules),
      ...rapporterend(reactPlugin.configs.flat["jsx-runtime"].rules),
      ...rapporterend(reactHooksPlugin.configs.flat.recommended.rules),
      ...rapporterend(nextPlugin.configs.recommended.rules),
      ...rapporterend(nextPlugin.configs["core-web-vitals"].rules),
    },
  },
];
