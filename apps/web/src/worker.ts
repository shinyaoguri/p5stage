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
import { runRevisionBackfill } from "./lib/sketches/revision-backfill";

/**
 * 同期チャネル (Phase 4-2 / ADR 0017)。
 *
 * Durable Object のクラスは**エントリから export されていないと**バインディングから
 * 解決できない。実装は `lib/live/channel.ts` にあり、ここは載せる場所。
 */
export { SketchChannel } from "./lib/live/channel";

export default {
  fetch: astroEntry.fetch,

  /**
   * 定期実行。今のところ 2 つ。
   *
   * `waitUntil` に預けず待つのは、Cron の実行時間そのものがこの仕事の長さでよいため。
   * 途中で切れても次の起動が続きから拾う (進捗はどちらも D1 に持つ)。
   *
   * 1. 孤児 blob の回収 (Phase 3-5b)
   * 2. リビジョン台帳のバックフィル (Phase 4-1)
   *
   * **参照台帳のバックフィルが済むまで 2 は走らせない。** どちらも R2 の `gists/` を
   * 舐めるので、同じ起動で二重に走らせると持ち時間を分け合って両方の進みが遅くなる。
   * 回収の方が急ぐ (実体が消えずに溜まる) ので先に通す。済んだ後の起動では 1 は
   * 状態を 1 つ読むだけで返る。
   */
  async scheduled() {
    const report = await runAssetGc(Date.now());
    if (report.backfillDone) await runRevisionBackfill();
  },
} satisfies ExportedHandler<Env>;
