# 0021: p5.js の型定義は @types/p5 一式をビルド時に束ねてエディタへ配る

## 状態

採用 (2026-08-23)

## 文脈

エディタの Monaco は補完の材料として `lib.dom` と `lib.esnext` しか持っていない。
`createCanvas` と打っても候補に出ず、`fill(` で引数のヒントも出ない。ライブラリの
API を覚えていることが前提の道具になっていて、要件 3.1 の「p5.js スケッチを書く
ための面」として弱い。

材料が無いのは意図的で、Phase 1-2 で意味解析 (`noSemanticValidation`) を止めた
ときの申し送りにあたる。**p5.js のグローバル関数に型定義が無いと、正しいスケッチが
赤線だらけになる**ためだった。ただし止めているのは診断だけで、補完の口は開いている。

Issue #104 の調査で、型定義を言語サービスへ渡すのが最も効くと分かった。渡すと
API 補完・引数名・オーバーロード・p5 リファレンスの説明文つきホバーが一度に手に入る。
追加コストは、**エディタを開くだけで既に払っている `ts.worker` 1454KB (gzip)** に
比べれば小さい。

決めるべきは 4 点 — どのバージョンの型定義を選ぶか / どう束ねるか / どこまで
説明文を残すか / 赤線を戻すかどうか。

## 決定

### 1. `@types/p5` の 1.x を使う (2.x へは追わない)

入手先は 2 つある。DefinitelyTyped の `@types/p5` (1.x 系) と、p5 2.0 から本体に
同梱されるようになった自動生成の `types/global.d.ts`。

**既定テンプレートが読み込むのは `p5@1`** (`packages/shared/src/defaults.ts` の
`P5_CDN_URL`) なので、素直に 1.x に揃える。`index.html` の `<script src>` を読んで
1 系 / 2 系を切り替える余地はあるが、**既定を 2 系へ動かすかは p5.js の配布方法
(Issue #11) と一緒に決める判断**で、補完の話とは別の PR に属する。

2.x の型定義には、JSDoc からの自動生成ゆえにオーバーロードや省略可能引数の欠けが
あるという上流の報告もある (processing/p5.js#7862)。急いで追う理由が無い。

`lib/addons/p5.sound.d.ts` (109KB / 24KB gzip) は積まない。既定テンプレートが
読み込まないアドオンで、必要になったら `index.html` の script タグを見て足せる。

### 2. 1 ファイルへ平坦化せず、パッケージの構成をそのまま写して渡す

`javascriptDefaults.addExtraLib(content, filePath)` は 1 ファイルずつ受ける口なので、
「全部を 1 つの d.ts に束ねて 1 回渡す」形にしたくなる。**やらない。**

`@types/p5` は互いを指し合う形で組まれている。

- `global.d.ts` は `import p5 = require("./index")` で `index.d.ts` を引く
- `index.d.ts` は `export = p5` を名乗り、`/// <reference path="./src/...">` を 56 本持つ
- `literals.d.ts` / `constants.d.ts` は `declare module './index'` で宣言マージする

これを手で 1 ファイルへ畳むには `export =` とモジュール宣言を書き換えることになり、
上流が構成を変えるたびに壊れる。代わりに**各ファイルを元の相対パスのまま**

```
file:///node_modules/@types/p5/global.d.ts
file:///node_modules/@types/p5/index.d.ts
file:///node_modules/@types/p5/src/math/p5.Vector.d.ts   (以下 56 本)
```

として登録し、TypeScript 自身のモジュール解決に辿らせる。extraLib は `ts.worker` の
ルートファイルとして全部プログラムに入るので、`global.d.ts` の `declare global` も
そのまま効く。

**`global.d.ts` 1 本では足りない**ことは測って確かめた。戻り値の `p5.Color` /
`p5.Vector` は `src/**` 側にあり、渡さないと `createVector().mult(` のメソッド補完と
ホバーの型が落ちる。Issue #104 本文のサイズ表 (63KB gzip) はこの 1 本だけを見ていた。

束ねるのは `apps/web/vite/p5-types.ts` の Vite プラグイン。`virtual:p5-types` を
提供し、`node_modules/@types/p5` を読んで `{ filePath, content }[]` を返す。
**生成物はコミットしない** — 依存の版が上がれば自動で追従する。

### 3. 説明文 (JSDoc) は `global.d.ts` だけ残す

p5 リファレンスの本文がそのまま JSDoc に入っているため、全部残すと重い。実測 (gzip):

| 渡すもの | raw | gzip |
|---|---|---|
| 全部そのまま (p5.sound 除く) | 957KB | 148KB |
| **`global.d.ts` は残し / それ以外は除去** | 457KB | **73KB** |
| 全部除去 | 108KB | 17KB |

中段を採る。**ホバーの説明文が効くのはグローバル API** (`fill` / `circle` / `noise` …)
で、そこは初学者がいちばん当たる面。`src/**` 側の JSDoc は `p5.Vector.mult` のような
クラスのメンバに付くもので、名前と型が出れば大体足りる。

除去は正規表現の一括置換ではなく 1 文字ずつ走査して行う。`'/**'` のような**文字列
リテラルをコメントの境界と読み違える**ため (`apps/web/test/p5-types.test.ts` が
この境界を押さえている)。

実際のチャンクは 462KB raw / **76KB gzip** / 59KB brotli になった。

### 4. 遅延ロードする — 初期表示は待たせない

エディタの生成では読まず、`import("virtual:p5-types")` の解決後に登録する。補完は
数百 ms 遅れて効き始めるが、エディタの初期表示 (Issue #18 の関心事) は塞がない。
取り込みに失敗してもエディタは動く — 補完の材料が増えないだけ。

エディタ画面の入口チャンクは 984,301 → 984,388 バイト (gzip) と 87 バイトしか
増えず、型定義は別チャンクに分かれた。

### 5. 赤線 (意味解析) は止めたまま

型定義を渡せば `noSemanticValidation: false` に戻せるが、**Monaco の既定は strict**
なので、そのままだと p5 のふつうの書き方がノイズになる。

- `let img;` (`preload` で代入する定番の書き方) → `TS7034/TS7005 implicitly has an 'any' type`
- `select("#box").mousePressed(...)` → `TS18047 'el' is possibly 'null'`

`noImplicitAny: false` と `strictNullChecks: false` を入れれば消え、タイポ検出
(`Cannot find name`) と引数不足 (`Expected 3 arguments, but got 2`) は残ることも
分かっている。それでも**補完と診断は独立して切れる**ので、効果が大きく後戻りしやすい
補完だけを先に出す。診断は設定パネルのトグル (既定オフ) として足す — Issue #104 の
段階 2。

## 影響

- 補完・引数のヒント・説明文つきホバーが p5 の API に効く。`e2e/completion.spec.ts`
  が実ブラウザで押さえる
- **`setEagerModelSync(true)` は入れなかった。** ファイルを跨ぐ補完のために要ると
  見ていたが、Monaco 0.56 では真偽どちらでも `other.js` の関数が `sketch.js` の候補に
  出る。効かない設定は置かない (この振る舞いも E2E が固定している)
- 型定義は `apps/web` の devDependency。実行時の p5.js は今までどおり CDN から読む
  (ADR 0002 の正本の話とは無関係で、**エディタの中だけの材料**)
- 利用者が `index.html` を書き換えて p5 2.x を読み込んでも、補完は 1.x の型で出る。
  ずれの実害が出たら 1 の判断を見直す (Issue #11 / #104)
