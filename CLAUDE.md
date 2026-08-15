# p5stage

p5.js スケッチの開発・共有プラットフォーム (OpenProcessing.org 類似)。
差別化は Gist/GitHub 連携・バージョン管理・ライブコーディング。
将来的にチュートリアル機能・教育向けクラス機能を予定。

要件の正本は `docs/requirements.md`、実装計画は `docs/roadmap.md`。
進捗と課題は各フェーズの Issue に積む (進行中の Phase 1 は #11)。

## 検証コマンド

```bash
npm run lint          # ESLint
npm run format:check  # Prettier
npm run typecheck     # wrangler types → 各ワークスペースの型検査
npm test              # Vitest (DOM に依存しない純ロジック)
npm run build         # 全ワークスペースのビルド
npm run test:e2e      # Playwright (実ブラウザ。サーバ起動は config が受け持つ)
npm run shots         # 画面の証跡を e2e/shots/ へ撮る (検証はしない。普段の E2E からは外してある)
```

CI (.github/workflows/ci.yml) は上から順に `verify` ジョブで、`test:e2e` は
並行する `e2e` ジョブで実行する。required check は集約ジョブ `ci-gate` 1 本。可逆な変更の PR は `gh pr merge <番号> --auto --squash` で
CI green を待って自動マージする。

**web (本体) に PR プレビュー URL は出ない。** Durable Object を持つ Worker には
Cloudflare がプレビュー URL を発行しないため (ADR 0017 の申し送り)。PR での見た目の確認は
`e2e` ジョブが撮って PR に貼る証跡 (Gyazo)、動きの確認は手元の `npm run dev`。
証跡の共有にはリポジトリシークレット `GYAZO_ACCESS_TOKEN` が要る (無ければ黙って省かれる)。

## リポ固有の注意

- npm workspaces のモノレポ。`apps/web` (本体) / `apps/preview` (別オリジンの実行環境) /
  `packages/shared` (共有定義)
- **他者コードを実行するため、実行 iframe は本体と必ず別オリジンに置く** (要件 5.1)。
  両者を同一オリジンに寄せる変更は入れない
- エディタ機能は `~/Repos/canvastage` (ローカルリポジトリ) を参考にする。ただしあちらは
  same-origin iframe / 単一パッケージ / Pages Functions が前提で、設計が違う箇所は移植ではなく作り替えになる
- `worker-configuration.d.ts` は `wrangler types` の生成物。コミットしない・手で編集しない
- 設計判断 (技術選定・アーキテクチャ・運用方針) は `docs/decisions/` の ADR に残す
