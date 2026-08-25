// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

import { monacoDompurify } from "./vite/monaco-dompurify.ts";
import { p5Types } from "./vite/p5-types.ts";

// ギャラリー・作品ページは D1 のメタデータを引くため既定をオンデマンド描画にし、
// 静的で足りるページ側に `export const prerender = true` を置く。
export default defineConfig({
  adapter: cloudflare({
    // 画像変換 (Cloudflare Images) は使わない (ADR 0019 の決定 6)。
    // サムネイルはランナーが長辺 1200px の PNG を 1 枚だけ作るので、
    // IMAGES バインディングを要求させない。
    imageService: "passthrough",
  }),
  output: "server",
  // 既定でも有効だが、CSRF の一次防御を設定の既定値に委ねない。
  // ただしこれが弾くのは「フォーム系の Content-Type か Content-Type 無し」の要求だけで、
  // `application/json` は素通りする (astro/dist/core/app/origin-check.js)。
  // JSON で叩く API は lib/http/origin-guard.ts が守る (ADR 0008)。
  security: { checkOrigin: true },
  // セッションは GitHub OAuth を入れる Phase 2 で設計する。
  // それまで SESSION KV バインディングを要求させない。
  session: false,
  vite: {
    // エディタが動的 import する `virtual:p5-types` を作る (Issue #104 / ADR 0021)。
    // Monaco が同梱する DOMPurify は npm の dompurify へ向け直す (Issue #111 / ADR 0024)。
    plugins: [p5Types(), monacoDompurify()],
  },
});
