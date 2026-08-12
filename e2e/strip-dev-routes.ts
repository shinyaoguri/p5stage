/**
 * E2E で立てる Worker から `routes` を外す (Phase 2-7 / #38)。
 *
 * `wrangler dev` は設定の `routes`(custom_domain) を**リクエスト URL のホストとして
 * 使う**。そのままだと Worker から見た `url.origin` が本番のドメイン (p5stage.org) に
 * なり、OAuth の `redirect_uri` が `http://p5stage.org/api/auth/callback` になって
 * 認可から戻れない。
 *
 * 直し方は 2 つあった。
 *
 * - `wrangler dev --local-upstream localhost:<port>` を渡す → **これは使えない**。
 *   渡すと E2E の途中で wrangler dev がプロセスごと落ちる (#38)。外した途端に
 *   落ちなくなることを CI で確かめた
 * - ルートごと持たせない → こちら。本番の設定にもアプリのコードにも触らずに済む
 *
 * 触るのは**ビルド成果物**であって、リポジトリの設定ファイルではない
 * (`apps/web/wrangler.jsonc` はそのまま)。Astro の Cloudflare アダプタが
 * `dist/server/wrangler.json` に実効設定を書き出し、`wrangler dev` はそれを読む。
 *
 * この細工が効かなくなったら (アダプタの出力が変わったなど)、
 * `auth.spec.ts` の `redirect_uri` の検証が落ちて気付ける。
 */

import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2];
if (path === undefined) {
  console.error("usage: node e2e/strip-dev-routes.ts <wrangler.json>");
  process.exit(1);
}

const config = JSON.parse(readFileSync(path, "utf8")) as Record<
  string,
  unknown
>;

if (!("routes" in config)) {
  // 消す相手がいない = 前提が変わった。黙って通すと redirect_uri が化けるので落とす。
  console.error(
    `[strip-dev-routes] ${path} に routes がありません (出力の形が変わった可能性)`
  );
  process.exit(1);
}

delete config.routes;
writeFileSync(path, JSON.stringify(config));
console.log(`[strip-dev-routes] routes を外しました: ${path}`);
