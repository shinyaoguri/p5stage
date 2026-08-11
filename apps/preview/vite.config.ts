import { resolve } from "node:path";

import { defineConfig } from "vite";

// ランナー (ブラウザ側) のビルド。出力を wrangler の静的アセットとして配信する。
// Worker 本体 (src/) は wrangler がビルドするので、ここでは扱わない。
export default defineConfig({
  root: resolve(import.meta.dirname, "client"),
  build: {
    outDir: resolve(import.meta.dirname, "dist/client"),
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "client/index.html"),
        runner: resolve(import.meta.dirname, "client/runner/index.html"),
      },
    },
  },
});
