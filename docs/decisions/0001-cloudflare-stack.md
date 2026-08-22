# 0001: 技術スタックを Cloudflare プラットフォームにする

## 状態

採用 (2026-08-11)

## 文脈

p5stage は「作品の配信 (バズ耐性)・メタデータ DB・不変 blob ストレージ・準リアルタイム配信」を
必要とする。参考元の canvastage が TypeScript + Vite + Cloudflare Pages (Functions + GitHub Actions
デプロイ) で本番運用されており、テンプレートと運用知見が既にある。
R2 は egress 無料で、UGC 公開配信の「人気作品で転送課金が爆発する」リスクを構造的に消せる。

## 決定

- ホスティング / API: Cloudflare Pages + Workers
  (→ **ADR 0006 で Workers の static assets に更新。Pages は使わない**)
- メタデータ・アセット台帳: D1
- アセット blob・キャッシュ (レプリカ): R2 (+ 軽量キャッシュに KV)
- 準リアルタイム同期の配信 (SSE/WebSocket): Durable Objects
- サムネイル等の画像リサイズ: Cloudflare Images (R2 origin のオンザフライ変換)
  (→ **ADR 0019 の決定 6 で不採用。撮る側が長辺 1200px の PNG を 1 枚だけ作る**)
- 言語・ビルド: TypeScript (strict) + Vite

フロントエンドのフレームワーク選定 (canvastage 同様の素の DOM 継続か、ギャラリー等の
ページ群にフレームワークを導入するか) は Phase 0 で別 ADR として決める。
(→ **ADR 0004 で Astro + islands に決定**)

## 影響

- canvastage のコード資産 (エディタ・プレビュー・設定・ドラフト) を最小の変換で移植できる
- 配信・DB・blob・リアルタイムを単一プラットフォームで賄い、運用面を 1 箇所に集約する
- Cloudflare 固有 API (D1 / R2 / DO) への依存が生じる。作品の正本はユーザーの Gist にあるため、
  データのロックインはメタデータと台帳に限定される
