import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // DOM に依存しない純ロジックだけを対象にする。DOM / ブラウザ挙動の検証は
    // Phase 1 以降で E2E (Playwright) を足して分担させる。
    environment: "node",
    // E2E そのもの (Playwright) は別立てだが、E2E を支えるスクリプトの振る舞いは
    // ここで見る (`e2e/test/`)。ブラウザを立てずに確かめられるため。
    include: ["{apps,packages}/*/test/**/*.test.ts", "e2e/test/**/*.test.ts"],
  },
});
