# p5stage

p5.js スケッチの開発・共有プラットフォーム (OpenProcessing.org 類似)。
差別化は Gist/GitHub 連携・バージョン管理・ライブコーディング。
将来的にチュートリアル機能・教育向けクラス機能を予定。

要件の正本は `docs/requirements.md`、実装計画は `docs/roadmap.md`。
進捗と課題は各フェーズの Issue に積む (Phase 0 は #4)。

## 検証コマンド

```bash
npm run lint          # ESLint
npm run format:check  # Prettier
npm run typecheck     # wrangler types → 各ワークスペースの型検査
npm test              # Vitest
npm run build         # 全ワークスペースのビルド
```

CI (.github/workflows/ci.yml) はこの順で実行する。required check は集約ジョブ
`ci-gate` 1 本。可逆な変更の PR は `gh pr merge <番号> --auto --squash` で
CI green を待って自動マージする。

## リポ固有の注意

- npm workspaces のモノレポ。`apps/web` (本体) / `apps/preview` (別オリジンの実行環境) /
  `packages/shared` (共有定義)
- **他者コードを実行するため、実行 iframe は本体と必ず別オリジンに置く** (要件 5.1)。
  両者を同一オリジンに寄せる変更は入れない
- エディタ機能は `~/Repos/canvastage` (ローカルリポジトリ) を参考にする。ただしあちらは
  same-origin iframe / 単一パッケージ / Pages Functions が前提で、設計が違う箇所は移植ではなく作り替えになる
- `worker-configuration.d.ts` は `wrangler types` の生成物。コミットしない・手で編集しない
- 設計判断 (技術選定・アーキテクチャ・運用方針) は `docs/decisions/` の ADR に残す
