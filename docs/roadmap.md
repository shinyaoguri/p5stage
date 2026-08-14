# p5stage 実装計画 (ロードマップ)

要件は docs/requirements.md が正本。ここは v1 (MVP) までの実装順序と各フェーズの
完了条件を定める。進捗と課題は各フェーズの Issue / PR に記録する。

原則: フェーズは縦に薄く切る (各フェーズの終わりに動くものがある)。
canvastage からの移植は「動くものを最小変換で持ち込み、p5stage の設計 (別オリジン実行・
マルチファイル・マニフェスト) に合わせて段階的に作り替える」方針。

## Phase 0: 基盤

プロジェクトの骨格と、監査で見送った標準項目の解消。

- モノレポ構成の決定 (app / preview / workers の分割方針) → **ADR 0005**
- フロントエンドフレームワークの選定 (素の DOM 継続 or 導入) → **ADR 0004**
- 配信基盤を Pages から Workers (static assets) へ → **ADR 0006**
- TypeScript + Astro/Vite + ESLint + Prettier + Vitest の雛形
- CI (.github/workflows/ci.yml: lint / format / typecheck / test / build) → 監査 deferred の ci-workflow-exists / test-dir-exists を解消
- .github/dependabot.yml → 同 dependabot-config を解消
- Cloudflare Workers のデプロイパイプライン (main → 本番 / PR → バージョンプレビュー)
- 完了条件: 空のアプリが CI green で本番 URL に出る

## Phase 1: エディタコア (ローカルで完結)

canvastage 移植の中核。保存機能なしで「書いて実行できる」まで。

- code-editor (透過 Monaco + テーマ) / preview (iframe ダブルバッファ + console / input の 2 ブリッジ) / transitions / settings の移植
- **実行 iframe を別オリジン配信に載せ替え** (canvastage の same-origin 設計は踏襲しない。
  postMessage + origin 検証、sandbox 属性の確定) → **ADR 0007**
- マルチファイル対応 (既定 3 ファイル + 任意テキストファイルの追加・削除。Monaco はファイルごとにモデルを分け undo 履歴を独立させる)
- ドラフト自動保存 (IndexedDB) の**新規実装** (canvastage に相当実装は無い。汎用ストア `idb-store.ts` のみ流用)
- 完了条件: ログイン無しで p5.js スケッチを書き、別オリジン iframe で実行・ドラフト復元できる

## Phase 2: 認証と保存 (Gist 正本)

- GitHub OAuth (scope=gist、popup + state 検証)。クライアント側は canvastage を移植、
  コールバックは Pages Functions ではなく Astro の API ルートとして書き直す (ADR 0006)。scope の意味の明示 UI
- セッションは `__Host-` プレフィックスの cookie に限り、状態を変える API は
  `Origin` / `Sec-Fetch-Site` を検証する (実行オリジンが same-site サブドメインで
  `SameSite` に頼れないため) → **ADR 0008**
- Gist create / debounce PATCH (canvastage gist.ts の状態機械を移植・拡張)
- 正本の出入り: **外部にある自分の Gist をそのまま正本として取り込む** (adopt) と、
  作品を Gist から切り離す (detach)。切り離しは配信のポインタごと外し、次の保存で
  新しい Gist を作る。他人の作品を持ち込む道は fork と D1 の系譜が受け持つ
  (Phase 4 / #44) → **ADR 0012**
- D1 メタデータ (作品・ユーザー・公開範囲) と作品ページ
- **配信層と作品ページは一体で作る** (当初は「作品ページの最小版」と「キャッシュ層」に
  分けていたが、配信の骨格が無いと作品ページは必ず一度壊れた形で本番に出るため統合した)。
  閲覧経路から GitHub を外し (D1 のポインタ → R2 の不変オブジェクト)、鮮度は保存時の
  更新と閲覧時の conditional GET + ETag、消えた Gist は 404 tombstone → **ADR 0011**
- **通しの E2E**: ログインから閲覧までを実ブラウザで踏む。GitHub を叩くのは Worker なので
  ブラウザ側では差し替えられず、**宛先ごとテストダブルへ向ける** (受け付けるのはループバックの
  宛先だけ) → **ADR 0013**
- 完了条件: ログイン → 作成 → 保存 (Gist リビジョン) → 別ブラウザの作品ページで閲覧、まで通る

## Phase 3: アセット (ADR 0003)

- R2 CAS (sha256 キー) + アップロード Worker (検証・dedup・クォータ)
- assets.json マニフェストの読み書きとスキーマ検証 (手書き — ADR 0003 の 3-2 補足)
- エディタのアセット管理 UI (アップロード・一覧・削除)
- 実行時のファイル名 → blob URL 解決 (buildHtml 拡張)
- D1 台帳 (blobs / 参照テーブル) と GC バッチ (参照カウント + 猶予期間)
- 完了条件: 画像・3D モデルを使う作品が保存・閲覧・過去リビジョン再現まで通る

## Phase 4: 共有体験 (p5stage の差別化の中核)

- **リビジョン履歴の閲覧** (4-1): D1 の台帳 (`gist_revisions`) + `?rev=<sha>` +
  履歴 UI。過去の版は台帳と R2 だけで解決し、GitHub へは行かない → **ADR 0016**
- 準リアルタイム同期閲覧: エディタ → Workers 通知 → Durable Objects → SSE/WebSocket 配信 (許容遅延 数秒〜10 秒)
- フォーク (Gist fork API + メタデータ複製。系譜の正典は D1 — #44)
- サムネイル自動取得の**新規実装** (canvastage に相当実装は無い。別オリジン iframe から postMessage で受け渡す) → R2、Cloudflare Images リサイズ
- 完了条件: 作者がライブコーディングし、閲覧者が数秒遅れで追従できる

**限定公開 (secret gist + 注意書き) は Phase 2 で完了済み**。`visibility` の 2 段階・
secret gist の作成・作品ページの注意書き・`noindex`・`private, no-store` まで
2-4 までに入ったため、この Phase の項目から外した。

## Phase 5: 発見 (ギャラリー)

- 全体一覧 (新着)・タグ・検索 (D1)
- ユーザーページ
- 完了条件: ログイン無しで作品を発見 → 閲覧 → (ログインして) フォークの動線が通る

## Phase 6: 公開準備

- abuse 対策: CSAM Scanning 有効化・WAF / rate limit・hotlink 対策
- 利用規約・プライバシーポリシー (gist scope / secret gist / テイクダウンの明記)
- 監視 (エラー・レート制限消費・R2/D1 使用量)
- 完了条件: 一般公開できる状態

## v2 以降 (順不同・未計画)

いいね・コメント・フォロー / チュートリアル / クラス機能 / 有料プラン (クォータ + 付加価値) /
OpenProcessing 書き出し / 外部 embed

## リスクと備え

| リスク | 備え |
|---|---|
| GitHub の裁量による API 制限 | キャッシュ = レプリカ (Phase 2 で最初から)。規約遵守 3 条件を実装レビューの観点にする |
| Gist API の仕様変更 | Gist 依存を gist クライアント層に隔離し、正本の差し替え余地を残す |
| アセットの abuse | Phase 3 の時点で allowlist / クォータを実装し、Phase 6 を待たない |
| canvastage 移植の設計差 (same-origin 前提) | Phase 1 で別オリジン化を最初に済ませ、以降の機能をその上に積む |
