# 0024: Monaco が同梱する DOMPurify はビルド時に npm 版へ差し替える

## 状態

採用 (2026-08-25)

## 文脈

Dependabot に open の警告が 4 件あり、すべて `dompurify` に由来していた (Issue #111)。

```
@p5stage/web -> monaco-editor@0.56.0 -> dompurify@3.4.8
```

`monaco-editor` は最新 (0.56.0) でも `dompurify` を **完全一致で pin** している。
上流が上げないかぎり依存を辿るだけでは動かず、Dependabot も PR を出せない。

### 発見 1: Monaco は npm の DOMPurify を読んでいない

調べると、pin より根の深い問題があった。**Monaco は DOMPurify をソースへインライン
同梱している。**

```
esm/vs/base/browser/dompurify/dompurify.js   ← /*! @license DOMPurify 3.4.8 ... */
esm/vs/base/browser/domSanitize.js:3         ← import purify from './dompurify/dompurify.js';
```

配布物のどこにも `from "dompurify"` という bare import は無い (`min/` と `dev/` の
バンドルにも同じものが焼き込まれている)。`package.json` の `dependencies.dompurify` は
Monaco 自身がビルドに使う材料の宣言でしかない。

つまり **`overrides` で npm 側を上げても、ブラウザへ届くコードは 3.4.8 のまま**に
なる。lockfile と Dependabot の見え方だけが直り、警告が消えるぶん何もしないより悪い。

### 発見 2: 4 件はいずれも Monaco の使い方からは到達不能

`purify` を触るのは `domSanitize.js` 1 本だけで、設定は毎回 `sanitize()` へ渡している
(`ALLOWED_TAGS` / `ALLOWED_ATTR` / `ALLOW_UNKNOWN_PROTOCOLS` と、
`RETURN_DOM_FRAGMENT` か `RETURN_TRUSTED_TYPE`)。フックは毎回 `removeAllHooks()` で畳む。

| GHSA | 前提となる設定 | Monaco は使うか |
|---|---|---|
| GHSA-55q2-fjhq-7xh7 | `IN_PLACE: true` + 要素を消すフック | 使わない |
| GHSA-cmwh-pvxp-8882 | `setConfig()` + フックが `data.allowedAttributes` を書く | 使わない (フックは `keepAttr` しか触らない) |
| GHSA-c2j3-45gr-mqc4 | `CUSTOM_ELEMENT_HANDLING.tagNameCheck` | 使わない |
| GHSA-vxr8-fq34-vvx9 | カスタム `TRUSTED_TYPES_POLICY` + `clearConfig()` | 使わない |

`IN_PLACE` / `setConfig` / `clearConfig` / `CUSTOM_ELEMENT_HANDLING` /
`TRUSTED_TYPES_POLICY` のいずれも `domSanitize.js` にも `markdownRenderer.js` にも
現れない。**今日の時点では 4 件とも踏めない。**

## 決定

### それでも同梱版を差し替える

到達不能なのは「今の Monaco の実装がそうである」というだけで、配信物の安全を上流の
pin に委ねている状態は変わらない。p5stage は **他者の書いたコードをエディタで開く**
サービスで、ホバーや補完の説明文は他人のスケッチの JSDoc から来る。攻撃者の入力が
Monaco のサニタイザを通る面が常にある。

差し替えを選ぶ理由は 3 つ。

1. **配信物が実際に直る。** `overrides` だけでは直らない
2. **以後 Dependabot の警告が実態と一致する。** 今は「直せない警告」で、次の
   advisory も同じ袋小路に入る。npm 版を辿る形にすれば、次からは版を上げれば済む
3. **差分が小さく戻しやすい。** 3.4.8 → 3.4.14 はパッチ版で、Monaco 側の呼び方
   (`sanitize` / `addHook` / `removeAllHooks`) は変わっていない

### 差し替えは Vite プラグインで行う (`apps/web/vite/monaco-dompurify.ts`)

`domSanitize.js` からの `./dompurify/dompurify.js` だけを `dompurify` へ解決し直す。
解決自体は `this.resolve()` で Vite に任せ、`exports` の `import` 条件を辿らせる
(`dist/purify.es.mjs`。default export が DOMPurify インスタンスで、同梱版と同じ形)。

`resolve.alias` を使わないのは、Monaco 側の指定が **相対パス**だからで、
指定文字列だけでは他の `./dompurify/dompurify.js` と見分けられない。
`resolveId(source, importer)` なら import 元まで見て絞れる。

あわせて依存を整える。

- `apps/web` の依存に `dompurify` を足す — 差し替え先の実体
- ルートの `overrides` で `dompurify` を上げる — Monaco の pin を潰し、
  lockfile から 3.4.8 を消す。Monaco は npm 版を import しないので副作用は無い

### 空振りを 3 段のガードで塞ぐ

差し替えは「効かなくなっても画面上は何も起きない」形なので、黙って 3.4.8 へ戻るのが
最大の危険になる。

- **ビルド時**: 同梱版がバンドルに入ったら落とす / `domSanitize.js` は通ったのに
  差し替えが 0 回なら落とす (`npm run build` = CI で効く)
- **単体テスト** (`apps/web/test/monaco-dompurify.test.ts`): 同梱版を読む口が
  `domSanitize.js` 1 本だけであること / 差し替えが downgrade になっていないこと
  (Monaco が pin を上げたのにこちらが古いまま、を防ぐ)
- **E2E** (`e2e/sanitize.spec.ts`): 説明文が実ブラウザで描画されること。
  差し替えたサニタイザが黙って全部落としても気付ける

## 影響

- 配信される DOMPurify は npm の版になる。ビルド成果物の `DOMPurify.version` で
  確かめられる (エディタのチャンクに 1 か所だけ出る)
- **Monaco の Worker には DOMPurify が入らない。** サニタイズは DOM 側の話で、
  言語サービスは触らない。`vite.worker.plugins` への登録は要らない
- 上流が pin を上げたら、この差し替えは要らなくなる。単体テストの版比較が
  気付かせるので、そのときプラグインごと畳んでよい
- Monaco が同梱版を読む口を増やしたら (別ファイルからの import)、単体テストが落ちる。
  差し替えの条件を広げる
- 到達可能性の評価 (発見 2) は **4 件の advisory についてのもの**で、DOMPurify を
  安全と保証するものではない。次の advisory は改めて読む
