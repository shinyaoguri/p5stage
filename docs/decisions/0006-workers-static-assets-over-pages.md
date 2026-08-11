# 0006: 配信基盤に Pages ではなく Workers (static assets) を使う

## 状態

採用 (2026-08-11)。ADR 0001 の「ホスティング / API: Cloudflare Pages + Workers」を更新する

## 文脈

ADR 0001 では canvastage の実績 (Cloudflare Pages + Pages Functions) を踏まえて
Pages + Workers と書いていた。Phase 0 で実際に構成するにあたり、現在の Cloudflare の
状況を確認した結果、次が分かった。

- Cloudflare は Pages から Workers への移行を公式に案内している。**Durable Objects・
  Cron Triggers・より充実した Observability は Workers 側にしか無い**
- p5stage は Phase 4 の準リアルタイム同期配信で Durable Objects を使う (ADR 0001)。
  Pages で始めると Phase 4 で必ず移行が発生する
- 静的アセットのリクエストは Pages と同じく無料で、課金構造も同等
- `@cloudflare/vite-plugin` が GA になり、Vite の Environment API 経由で Worker コードを
  workerd 上で開発できる。Astro の Cloudflare アダプタもこれを土台にしている

## 決定

配信基盤は Workers の static assets を使う。Pages は使わない。

- 各アプリに `wrangler.jsonc` を置き、`assets` で静的ファイルを、`main` で Worker を指す
- バインディングと変数の型は `wrangler types` が `worker-configuration.d.ts` に生成する。
  生成物はコミットせず、`typecheck` の中で毎回生成して設定とのドリフトを防ぐ
- デプロイは GitHub Actions から `npx wrangler deploy` (PR は `wrangler versions upload`)。
  Cloudflare の Git 連携は使わない (canvastage と同じ方針)

## 影響

- Phase 4 で Durable Objects を足すとき、基盤の載せ替えが不要になる
- canvastage の `functions/` (Pages Functions) の作法はそのままでは持ち込めない。
  Phase 2 で移植する GitHub OAuth のコールバックは Astro の API ルートとして書き直す
- Astro アダプタが用意するサーバエントリポイントを使うため、Durable Objects を
  エクスポートする段階で自前の `src/worker.ts` に差し替える必要がある
