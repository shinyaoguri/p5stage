import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // DOM に依存しない純ロジックだけを対象にする。DOM / ブラウザ挙動の検証は
    // Phase 1 以降で E2E (Playwright) を足して分担させる。
    environment: "node",
    include: ["{apps,packages}/*/test/**/*.test.ts"],
  },
});
