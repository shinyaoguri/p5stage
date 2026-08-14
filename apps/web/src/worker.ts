/**
 * Worker のエントリ。
 *
 * Astro (`@astrojs/cloudflare`) が用意するサーバエントリを包むだけの層。要求の処理は
 * まるごと委譲し、ここが足すのは **Astro が持てないハンドラ** — 定期実行 (`scheduled`)
 * だけ。Cron は HTTP の経路を持たないので、アダプタの生成物には現れない。
 *
 * Phase 4 の Durable Objects もここに載る (wrangler.jsonc が「Phase 4 で差し替える」と
 * 書いていた分の前倒し)。
 */

import astroEntry from "@astrojs/cloudflare/entrypoints/server";

import { runAssetGc } from "./lib/assets/gc";

export default {
  fetch: astroEntry.fetch,

  /**
   * 孤児 blob の回収 (Phase 3-5b)。
   *
   * `waitUntil` に預けず待つのは、Cron の実行時間そのものがこの仕事の長さでよいため。
   * 途中で切れても次の起動が続きから拾う (進捗は D1 に持つ)。
   */
  async scheduled() {
    await runAssetGc(Date.now());
  },
} satisfies ExportedHandler<Env>;
