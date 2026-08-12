# p5stage

p5.js スケッチの開発・共有プラットフォーム。Gist / GitHub 連携・バージョン管理・
ライブコーディングを軸に、OpenProcessing.org 類似のサービスを目指す。

- 要件の正本: [docs/requirements.md](docs/requirements.md)
- 実装計画: [docs/roadmap.md](docs/roadmap.md)
- 設計判断: [docs/decisions/](docs/decisions/)

現在 Phase 1 (エディタコア) を実装中。

## 構成

npm workspaces のモノレポ (ADR 0005)。

| ワークスペース | 役割 | Worker | 本番 |
|---|---|---|---|
| `apps/web` | 本体。Astro (SSR) + 静的アセット + API | `p5stage-web` | https://p5stage.org |
| `apps/preview` | 実行 iframe を配信する別オリジン | `p5stage-preview` | https://preview.p5stage.org |
| `packages/shared` | 両者が使う定義 | — | — |

他者コードを実行するため、実行 iframe は本体と必ず別オリジンに置く (要件 5.1)。
本体と実行環境は postMessage だけでやり取りする (ADR 0007)。

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

GitHub OAuth を使う (ログイン・保存) なら、`apps/web/.dev.vars` の
`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` にローカル用の OAuth App の値を入れる。
OAuth App は callback URL を 1 つしか持てないので、本番とは別のアプリを作り、
callback URL は `http://localhost:4321/api/auth/callback` にする
(`apps/web/.dev.vars.example` に手順あり)。

セッションは D1 に置くので、ローカルの D1 にスキーマを当てる。
本番への適用は CI (deploy ジョブ) が `--remote` で行うので、手で流す必要は無い。

```bash
npx wrangler d1 migrations apply p5stage --local --cwd apps/web
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 本体の開発サーバ (http://localhost:4321) |
| `npm run dev:preview` | 実行環境の開発サーバ (http://localhost:8788) |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run typecheck` | `wrangler types` で型を生成してから各ワークスペースを型検査 |
| `npm test` | Vitest (DOM に依存しない純ロジック) |
| `npm run test:e2e` | Playwright (実ブラウザ。下記) |
| `npm run build` | 全ワークスペースのビルド |

エディタ (http://localhost:4321/edit) を触るときは両方を起動する
(本体の iframe が実行環境を読み込む)。実行環境はブラウザ側のコード (`apps/preview/client/`)
を Vite でビルドしてから wrangler が配信するため、`npm run dev:preview` は
ビルドを挟んでから起動する。

`worker-configuration.d.ts` は `wrangler.jsonc` から自動生成される型で、コミットしない。

## E2E (Playwright)

`e2e/` に置く。対象は**本体と実行環境を別オリジンで立てた構成**で、
オリジン境界・iframe の属性・Worker が返すヘッダ・Monaco と IndexedDB の実挙動など、
単体テスト (Vitest) では観測できないものを見る。

初回はブラウザ本体の取得が要る。

```bash
npx playwright install chromium
```

サーバの起動は [playwright.config.ts](playwright.config.ts) が受け持つ。両アプリを
ビルドしてから `wrangler dev` で立て、オリジンは `--var` で渡すので `.dev.vars` は要らない。
ポートは開発サーバ (4321 / 8788) と分けてあり (8790 / 8791)、開発サーバを止めずに回せる。

| コマンド | 内容 |
|---|---|
| `npm run test:e2e` | 全件 |
| `npm run test:e2e -- --grep 別オリジン` | 名前で絞る |
| `npm run test:e2e:ui` | UI モード (対話的に選んで実行・トレース閲覧) |

## マージ運用

main への required check は集約ジョブ **`ci-gate`** 1 本。`verify` / `e2e` / `deploy` /
`preview-deploy` の結果を畳み、すべて success か skipped なら成功する。条件付きで
skip されるジョブを個別に required にすると「実行されない PR」で永久 pending になり
auto-merge が詰まるため、ゲートを 1 本に集約している。

可逆な変更の PR は CI green を待って自動マージする。

```bash
gh pr merge <番号> --auto --squash
```

## デプロイ

main への push で GitHub Actions が Cloudflare Workers へデプロイする。PR では
`wrangler versions upload` で確認用 URL を発行し、PR にコメントする。

必要な設定 (未設定の間はデプロイ / プレビューをスキップする。CI は落とさない)。

| 種別 | 名前 | 用途 |
|---|---|---|
| secret | `CLOUDFLARE_API_TOKEN` | デプロイ・アップロード・D1 のマイグレーション適用 (**Account / D1 / Edit** の権限が要る。無いと migration だけ警告付きでスキップされ、認証が本番で動かない) |
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
