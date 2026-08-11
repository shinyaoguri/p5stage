# p5stage

p5.js スケッチの開発・共有プラットフォーム。Gist / GitHub 連携・バージョン管理・
ライブコーディングを軸に、OpenProcessing.org 類似のサービスを目指す。

- 要件の正本: [docs/requirements.md](docs/requirements.md)
- 実装計画: [docs/roadmap.md](docs/roadmap.md)
- 設計判断: [docs/decisions/](docs/decisions/)

現在 Phase 0 (基盤) を実装中。

## 構成

npm workspaces のモノレポ (ADR 0005)。

| ワークスペース | 役割 | Worker | 本番 |
|---|---|---|---|
| `apps/web` | 本体。Astro (SSR) + 静的アセット + API | `p5stage-web` | https://p5stage.org |
| `apps/preview` | 実行 iframe を配信する別オリジン | `p5stage-preview` | https://preview.p5stage.org |
| `packages/shared` | 両者が使う定義 | — | — |

他者コードを実行するため、実行 iframe は本体と必ず別オリジンに置く (要件 5.1)。

## 開発

Node は [.nvmrc](.nvmrc) のバージョンを使う。

```bash
npm ci
```

`wrangler.jsonc` の `vars` は本番値なので、ローカルでは `.dev.vars` で上書きする。

```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/preview/.dev.vars.example apps/preview/.dev.vars
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 本体の開発サーバ (http://localhost:4321) |
| `npm run dev:preview` | 実行環境の開発サーバ (http://localhost:8788) |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run typecheck` | `wrangler types` で型を生成してから各ワークスペースを型検査 |
| `npm test` | Vitest |
| `npm run build` | 全ワークスペースのビルド |

エディタを触るときは両方を起動する (本体の iframe が実行環境を読み込む)。

`worker-configuration.d.ts` は `wrangler.jsonc` から自動生成される型で、コミットしない。

## デプロイ

main への push で GitHub Actions が Cloudflare Workers へデプロイする。PR では
`wrangler versions upload` で確認用 URL を発行し、PR にコメントする。

必要な設定 (未設定の間はデプロイ / プレビューをスキップする。CI は落とさない)。

| 種別 | 名前 | 用途 |
|---|---|---|
| secret | `CLOUDFLARE_API_TOKEN` | デプロイ・アップロード |
| secret | `CLOUDFLARE_ACCOUNT_ID` | 同上 |
| variable | `CLOUDFLARE_WORKERS_SUBDOMAIN` | プレビュー URL の組み立て (`<alias>-<worker 名>.<subdomain>.workers.dev`)。公開 URL の一部なので secret ではなく variable |

PR プレビューは `--preview-alias pr-<番号>` で PR ごとに固定の URL を使い、
`--var` で両者のオリジンを互いのプレビュー URL に差し替える。本番オリジンのままだと
実行 iframe が `frame-ancestors` に弾かれて動かないため (ADR 0007)。

プレビュー URL は Cloudflare 側でオプトインが要る。独自ドメインを `routes` で宣言すると
`workers_dev` が false と推論され、既定ではプレビュー URL も発行されないので、
両 `wrangler.jsonc` に `preview_urls: true` を明示している。この設定はダッシュボードで
切り替えても次のデプロイで設定ファイルの値に戻るため、設定ファイル側が正本になる。

独自ドメインは各 `wrangler.jsonc` の `routes` に `custom_domain: true` で宣言してあり、
DNS レコードと証明書は初回デプロイ時に Cloudflare が作る。ダッシュボードでの手作業は要らない
(ゾーン `p5stage.org` が Cloudflare にあることが前提)。
