// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

// ギャラリー・作品ページは D1 のメタデータを引くため既定をオンデマンド描画にし、
// 静的で足りるページ側に `export const prerender = true` を置く。
export default defineConfig({
  adapter: cloudflare({
    // 画像変換 (Cloudflare Images) はサムネイルを実装する Phase 4 で有効にする。
    // それまで IMAGES バインディングを要求させない。
    imageService: "passthrough",
  }),
  output: "server",
  // セッションは GitHub OAuth を入れる Phase 2 で設計する。
  // それまで SESSION KV バインディングを要求させない。
  session: false,
});
