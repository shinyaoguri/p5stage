/**
 * E2E で立てる Worker の設定を整える (Phase 2-7 / #38、Phase 3-5b)。
 *
 * 触るのは**ビルド成果物**であって、リポジトリの設定ファイルではない
 * (`apps/web/wrangler.jsonc` はそのまま)。Astro の Cloudflare アダプタが
 * `dist/server/wrangler.json` に実効設定を書き出し、`wrangler dev` はそれを読む。
 *
 * ## 1. `routes` を外す
 *
 * `wrangler dev` は設定の `routes`(custom_domain) を**リクエスト URL のホストとして
 * 使う**。そのままだと Worker から見た `url.origin` が本番のドメイン (p5stage.org) に
 * なり、OAuth の `redirect_uri` が `http://p5stage.org/api/auth/callback` になって
 * 認可から戻れない。
 *
 * 直し方は 2 つあった。
 *
 * - `wrangler dev --local-upstream localhost:<port>` を渡す
 * - ルートごと持たせない → こちら。本番の設定にもアプリのコードにも触らずに済む
 *
 * 当初はここに「`--local-upstream` を渡すと wrangler dev が落ちる (#38)」と書いていたが、
 * **これは誤り**。外しても落ちることを後の切り分けで確かめた (#38 の原因は上流
 * cloudflare/workers-sdk#14926 で、この引数とは無関係)。どちらでも直るので、
 * 本番の設定に近い形で済むこちらを続ける。
 *
 * この細工が効かなくなったら (アダプタの出力が変わったなど)、
 * `auth.spec.ts` の `redirect_uri` の検証が落ちて気付ける。
 *
 * ## 2. `no_bundle` を外す
 *
 * `wrangler dev --test-scheduled` が開く `/__scheduled` は、**バンドル時に差し込まれる
 * ミドルウェア**として実装されている (wrangler の `templates/middleware/`)。アダプタの
 * 出力は「もうバンドル済み」の印 (`no_bundle: true`) を持つため、そのままでは差し込みが
 * 起きず、`/__scheduled` は Astro の 404 に落ちて **Cron を起こせない**。
 *
 * 外すと wrangler がもう一度バンドルし直すが、応答は変わらない (アプリの動きは E2E 全体が
 * 見ている)。本番のデプロイはアダプタの出力そのままで、この細工は E2E だけに掛かる。
 */

import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2];
if (path === undefined) {
  console.error("usage: node e2e/prepare-dev-worker.ts <wrangler.json>");
  process.exit(1);
}

const config = JSON.parse(readFileSync(path, "utf8")) as Record<
  string,
  unknown
>;

if (!("routes" in config)) {
  // 消す相手がいない = 前提が変わった。黙って通すと redirect_uri が化けるので落とす。
  console.error(
    `[prepare-dev-worker] ${path} に routes がありません (出力の形が変わった可能性)`
  );
  process.exit(1);
}

if (config.no_bundle !== true) {
  // 既に false なら差し込みは起きるので害は無いが、**前提が変わったこと**には
  // 気付きたい (Cron の E2E が黙って素通りするより落とす方がよい)。
  console.error(
    `[prepare-dev-worker] ${path} の no_bundle が true ではありません (出力の形が変わった可能性)`
  );
  process.exit(1);
}

delete config.routes;
config.no_bundle = false;
writeFileSync(path, JSON.stringify(config));
console.log(
  `[prepare-dev-worker] routes を外し、no_bundle を落としました: ${path}`
);
