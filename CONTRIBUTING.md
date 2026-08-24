# 貢献について

興味を持っていただいてありがとうございます。まず期待値をはっきりさせておきます。

**これは個人プロジェクトです。** 開発中で、まだ一般に使える状態ではありません。
設計方針とスコープはメンテナ (@shinyaoguri) が決めます。Issue も Pull Request も歓迎
しますが、**必ずマージするとは限りません**。方向性が合わないという理由でお断りすることが
あります。時間を無駄にしていただかないよう、先に書いておきます。

大きめの変更を考えている場合は、**手を動かす前に Issue で相談してください。**
設計判断は `docs/decisions/` の ADR に記録してあるので、関係しそうなものに目を通していただけると
話が早いです。

## ライセンスと著作権

このリポジトリは [AGPL-3.0](LICENSE) です (経緯は
[ADR 0022](docs/decisions/0022-open-sourcing-the-repository.md))。

**CLA (Contributor License Agreement) は求めません。** Pull Request を送っていただいた
時点で、その貢献が AGPL-3.0 の下でライセンスされることに同意したものとみなします。
著作権は貢献者ご自身に残ります。

## 開発環境

Node.js のバージョンは `.nvmrc` に従います。npm workspaces のモノレポです。

```bash
npm install
npm run dev
```

構成とアーキテクチャは [README](README.md) を参照してください。

## 検証

Pull Request を出す前に、以下が通ることを確認してください。CI (`.github/workflows/ci.yml`)
でも同じものが走ります。

```bash
npm run lint          # ESLint
npm run format:check  # Prettier
npm run typecheck     # wrangler types → 各ワークスペースの型検査
npm test              # Vitest (DOM に依存しない純ロジック)
npm run build         # 全ワークスペースのビルド
npm run test:e2e      # Playwright (実ブラウザ。サーバ起動は config が受け持つ)
```

`worker-configuration.d.ts` は `wrangler types` の生成物です。コミットしないでください。

## テスト

- バグ修正には**失敗する再現テストを先に**書いてください
- 正常系に加えて、失敗系か境界値を最低ひとつ
- 新しいテストは、検証対象の振る舞いを一時的に壊して赤くなることを確かめてから仕上げてください
  (壊しても緑のままのテストは、何も守っていません)

## コミットと Pull Request

[Conventional Commits](https://www.conventionalcommits.org/) 形式で書いてください。

```
<type>(<scope>): <要約>
```

type は `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `ci` / `perf` / `build`。
1 コミット 1 関心事でお願いします。

squash merge を使うため、**PR のタイトルがそのまま main のコミットメッセージになります。**
タイトルも同じ形式で書いてください (CI が形式を検査します)。Issue を閉じる `Closes #N` は
**コミットではなく PR 本文**に書いてください (squash ではコミット側の記述が GitHub に届きません)。

PR 本文には目的・変更点・確認方法を書いてください。画面の見た目や動きが変わる変更では、
スクリーンショットやアニメーションを添えていただけると助かります。

要約やコメントは日本語で構いません (コードの識別子は英語)。

## セキュリティ

**脆弱性は公開の Issue に書かないでください。** 報告方法は [SECURITY.md](SECURITY.md) に
あります。このサービスは他者の書いたコードをブラウザで実行するため、実行環境の分離に
関わる問題は特に慎重に扱います。
