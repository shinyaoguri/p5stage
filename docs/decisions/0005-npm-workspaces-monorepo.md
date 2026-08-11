# 0005: npm workspaces のモノレポで本体と実行環境を分ける

## 状態

採用 (2026-08-11)

## 文脈

要件 5.1 により、他者コードを実行する iframe は本体サイトと別オリジンに置く。
別オリジンということは別のデプロイ単位であり、本体 (Astro + Monaco + API) と
実行環境 (ほぼ静的な HTML + ブリッジ) は依存もビルドも性質が違う。

移植元の canvastage は単一パッケージだが、あちらは同一オリジンの 1 デプロイなので
事情が異なる。両者を 1 つの package.json に同居させると、Monaco などの重い依存が
実行環境側の木にもぶら下がり、境界がツールで担保されない。

## 決定

npm workspaces のモノレポにし、次の 3 つに分ける。

| ワークスペース | 役割 |
|---|---|
| `apps/web` | 本体。Astro (SSR) + 静的アセット + API。Worker `p5stage-web` |
| `apps/preview` | 実行 iframe を配信する別オリジン。Worker `p5stage-preview` |
| `packages/shared` | 両者が使う定義 (オリジン検証、将来の `Files` 型・assets.json スキーマ) |

- パッケージマネージャは npm (canvastage と揃える)
- `packages/shared` はビルドせず `exports` で TS ソースを直接指す。内部専用パッケージなので
  バンドラ (Vite / esbuild) がそのまま解決できればよい
- lint / format / test はルートで一括、typecheck と build は各ワークスペースに委譲する

## 影響

- 本体の重い依存が実行環境に混ざらないことをツールが保証する
- 共有したい定義を置く場所が最初から決まる。Phase 1 の `Files` 型、Phase 3 の
  assets.json スキーマはここに入る
- ワークスペースをまたぐ変更で、どのアプリの再デプロイが要るかを都度判断する必要がある
- Dependabot はルートを見れば全ワークスペースに追随する
