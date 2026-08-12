import js from "@eslint/js";
import eslintPluginAstro from "eslint-plugin-astro";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.astro/**",
      "**/.wrangler/**",
      "**/worker-configuration.d.ts",
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...eslintPluginAstro.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
  },
  // ビルド設定・Vitest 設定は Node で動く
  {
    files: ["**/*.config.{js,mjs,ts}"],
    languageOptions: { globals: globals.node },
  },
  // E2E は Playwright (Node) が動かす。偽 GitHub (e2e/fake-github) も同じ。
  {
    files: ["e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  prettier
);
