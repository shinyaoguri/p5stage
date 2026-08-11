# 0007: 実行 iframe を「別オリジンのランナー + 入れ子 srcdoc」で構成する

## 状態

採用 (2026-08-11)

## 文脈

要件 5.1 により、他者コードを実行する iframe は本体と別オリジンに置く。
移植元の canvastage はこの点が真逆の設計で、`iframe.srcdoc` +
`sandbox="allow-scripts allow-same-origin"` によって**実行フレームを親と同一オリジンにする**
ことを前提に組まれている。その前提の上に、次の仕組みが乗っている。

- `srcdoc` への HTML 文字列注入 (3 ファイルを 1 枚に合成)
- 2 枚の iframe を入れ替えるダブルバッファと、`load` イベント + `requestAnimationFrame`
  による「最初の 1 フレームが描けた」検知 (トランジションの初期フラッシュ防止)
- `contentWindow` の同一性比較によるコンソール送信元の照合
- `getUserMedia` の権限取得と、Web Audio の user activation の伝播

`srcdoc` の文書は**埋め込み側のオリジンを継承する**ため、本体から直接 `srcdoc` を使うと
実行フレームは本体オリジンになる。つまり canvastage の実行部分は、そのままでは移植できない。

一方、上記の仕組み自体は「iframe と、それを操作する文書が同一オリジンである」ことにのみ
依存していて、「**本体**と同一オリジンである」ことは本質的には要らない。

## 決定

実行環境を 2 段の iframe に分ける。

```
本体 (p5stage.org)
└─ iframe src="https://preview.p5stage.org/runner/"   ← クロスオリジン境界。postMessage のみ
   └─ ランナー文書 (preview オリジン)
      ├─ iframe srcdoc=...  ← スケッチ A (preview オリジンを継承)
      └─ iframe srcdoc=...  ← スケッチ B (ダブルバッファのもう 1 枚)
```

- **ランナー文書が合成・ダブルバッファ・トランジションを担う**。ランナーと入れ子 iframe は
  どちらも preview オリジンなので、canvastage が依存していた同一オリジンの仕組み
  (`srcdoc` 注入・`load` 検知・`contentWindow` 照合) を preview オリジンの内側でそのまま使える
- **本体 ⇄ ランナーの境界は postMessage 1 本に集約する**。双方向で `event.origin` と
  `event.source` を検証し、送信時は `targetOrigin` を明示する (`"*"` は使わない)
- ランナーに本体オリジンを教える経路は、preview Worker が配信時に
  `<meta name="p5stage-web-origin">` のプレースホルダを実値へ置換する。
  埋め込み元 (`frame-ancestors`) とあわせて二重に固定する
- ハンドシェイクは `ready` → `run` → `rendered` の ACK 方式にする。
  canvastage の「`load` + 1500ms 固定タイムアウト」は、遅い回線で誤発火する上に
  クロスオリジンでは意味を持たないため引き継がない
- 外側 iframe の属性は次のとおり。
  - `sandbox="allow-scripts allow-same-origin"` — `allow-same-origin` は
    「**preview オリジンとして扱う**」の意味であり、本体オリジンは与えない。
    これを外すと不透明オリジンになり `getUserMedia` も Storage API も使えない
  - `allow="autoplay; camera; microphone; midi; accelerometer; gyroscope; xr-spatial-tracking"` —
    Permissions Policy はクロスオリジンでも委譲できる
- **preview オリジンには Cookie・トークン・機微情報を一切置かない**。すべてのスケッチが
  この 1 オリジンを共有するため、スケッチ同士は互いの Storage を読める。
  隔離の境界は「本体 ⇄ preview」であって「スケッチ ⇄ スケッチ」ではない

マルチファイルの解決は次の 2 層で行う (canvastage の
`href="style.css"` / `src="sketch.js"` のリテラル一致置換は任意パスを扱えないため置き換える)。

1. **静的参照**: HTML 中の `href` / `src` のうち、スケッチ内のファイル名を指すものを
   ランナーが作る blob URL へ書き換える。ユーザーのコードは相対ファイル名のまま
2. **実行時参照**: `fetch` / `XMLHttpRequest` をブリッジで差し替え、同じファイル名への
   リクエストを blob URL へ振り替える (`loadJSON` / `loadStrings` / `loadShader` 用)

blob URL に寄せることで、HTML へのインライン展開で必要になる `</script>` / `</style>`
エスケープ問題が構造的に消える。Phase 3 のアセット (R2 の実体 + assets.json) も、
この解決層に「ファイル名 → 配信 URL」を足すだけで載る。

## 影響

- canvastage の実行系のうち、**同一オリジンに依存する部分はすべて preview 側へ移る**。
  本体側に残るのはプロトコルのクライアント (`PreviewHost`) だけになり、
  本体のコードは他者コードに触れない
- `srcdoc` を使う場所がランナー内に閉じるため、実行のたびに文書が完全に作り直される
  (グローバル状態のリークが無い) という canvastage の利点は維持される
- Web Audio の user activation はクロスオリジン子フレームへ伝播しない。
  `allow="autoplay"` の委譲で足りるかは実機検証が要る。足りなければランナー側に
  「クリックで開始」の導線を置く (Issue #11)
- iframe が 2 段になるぶん、初回のロードが 1 往復増える。ランナーは本体の起動時に
  先読みして `ready` を返せる状態にしておく
- E2E は「別オリジンであること」を検証する。canvastage の
  `preview-origin.spec.ts` / `transition.spec.ts` は主張が逆なので書き直す
