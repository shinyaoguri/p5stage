# p5stage

p5.js スケッチの開発・共有プラットフォーム。Gist / GitHub 連携・バージョン管理・
ライブコーディングを軸に、OpenProcessing.org 類似のサービスを目指す。

- 要件の正本: [docs/requirements.md](docs/requirements.md)
- 実装計画: [docs/roadmap.md](docs/roadmap.md)
- 設計判断: [docs/decisions/](docs/decisions/)

現在 Phase 0 (基盤) を実装中。

## 構成

npm workspaces のモノレポ (ADR 0005)。

| ワークスペース | 役割 |
|---|---|
| `apps/web` | 本体。Astro (SSR) + 静的アセット + API。Worker `p5stage-web` |
| `apps/preview` | 実行 iframe を配信する別オリジン。Worker `p5stage-preview` |
| `packages/shared` | 両者が使う定義 |

他者コードを実行するため、実行 iframe は本体と必ず別オリジンに置く (要件 5.1)。

## 開発

Node は [.nvmrc](.nvmrc) のバージョンを使う。

```bash
npm ci
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

`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` が未設定の間はデプロイをスキップする
(CI は落とさない)。
