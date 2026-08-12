# 0008: 実行オリジンは same-site サブドメインに置き、セッションは `__Host-` cookie で隔離する

## 状態

採用 (2026-08-12)

## 文脈

ADR 0007 で実行環境を `preview.p5stage.org` に置いた。本体 `p5stage.org` とは
**別オリジンだが same-site** (同じ登録可能ドメイン) になる。要件 5.1 の「実行は必ず
別オリジン」は満たすが、cookie の隔離は完全ではない。

Phase 2 で GitHub OAuth のトークンを扱う = 本体にセッションが生まれる。**セッションを
実装する前に**境界を確定しておく必要がある (Issue #10)。後から隔離を強めても、
それまでに配ったセッションの安全性は遡って上がらない。

### same-site に留めた場合に残る穴

- 本体の cookie に `Domain` 属性を付けなければ preview には送られない。
  `__Host-` プレフィックスを使えば preview 側から上書きもできない
- ただし preview 上で動く**他者コードは `document.cookie` に `domain=.p5stage.org` の
  cookie を書ける** (cookie tossing)。`__Host-` cookie は壊せないが、名前がぶつかる
  設計にすると事故る
- `Set-Cookie` の `SameSite` は same-site 扱いになるため、**CSRF の防御としては効きが弱い**

### 他サービスの実際

| サービス | 実行オリジン | 本体との関係 |
|---|---|---|
| CodePen | `cdpn.io` | 完全に別ドメイン |
| JSFiddle | `jshell.net` | 完全に別ドメイン |
| Glitch | `glitch.me` | 完全に別ドメイン |
| p5.js Web Editor | `preview.p5js.org` | same-site サブドメイン |

完全な隔離を求めるところは別ドメインを取っている。

## 決定

**`preview.p5stage.org` のまま進める**。別ドメインは取得しない。代わりに、same-site で
残る穴を cookie の設計と CSRF 防御で埋め、その前提を Phase 2 の実装制約として固定する。

1. **本体のセッション cookie は `__Host-` プレフィックス必須**。`Secure` / `Path=/` /
   **`Domain` 属性なし** (ホストオンリー)。この 3 条件は `__Host-` の要件そのもので、
   ブラウザが強制するため preview 側から上書きも削除もできない
2. **プレフィックスの無い名前でセッションを持たない**。cookie tossing で同名を
   差し込まれる余地を作らないため、セッションに関わる cookie は例外なく `__Host-` を付ける
3. **CSRF 防御を `SameSite` に期待しない**。状態を変える API は `Origin` /
   `Sec-Fetch-Site` を検証し、本体オリジンからの要求だけを受ける。`SameSite=Lax` は
   付けるが、same-site サブドメインからの要求はこれを素通りする前提で組む
4. **preview オリジンには cookie・トークン・機微情報を一切置かない** (ADR 0007 の再確認)。
   すべてのスケッチが 1 オリジンを共有するため、隔離の境界は「本体 ⇄ preview」であって
   「スケッチ ⇄ スケッチ」ではない
5. **Phase 3 のアセット配信オリジン** (`assets.p5stage.org` を想定) も同じ扱いにする。
   実行コードは載らないので影響は小さいが、cookie を持たせない点は共通

## 影響

- 追加費用ゼロで Phase 2 に進める。DNS も既存の構成のまま
- **`Origin` 検証が Phase 2 の API 設計に必須の制約として乗る**。`SameSite` に頼れない
  以上、状態を変える口はすべてこの検証を通す。後から足すのではなく最初から入れる
- 残るリスクとして、preview 上の他者コードが `domain=.p5stage.org` の cookie を書ける
  ことは変わらない。`__Host-` cookie は壊せないが、**cookie jar を膨らませて本体への
  リクエストヘッダを肥大させる嫌がらせ (cookie bomb)** の余地は残る。Phase 6 の監視項目にする
- **移行余地は残る**。preview オリジンは `wrangler.jsonc` の `vars` と `routes` にある
  設定値で、移すときに変わるのは埋め込み URL と `frame-ancestors` の値だけ。
  一般公開の前 (Phase 6) に、実際の abuse の状況を見て再評価する
- この決定は「同じドメインに置き続ける」ことの承認ではなく、**セッションの守り方を
  cookie プレフィックスと Origin 検証に寄せる**という選択である。別ドメインへ移した場合も
  1〜4 はそのまま有効で、無駄にはならない
