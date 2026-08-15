/**
 * 偽 GitHub がログインさせる利用者 (Phase 2-7)。
 *
 * サーバ (`server.ts`) とテスト (`flow.spec.ts`) の両方が見る。作者名は作品ページの
 * 正典 URL (`/@<login>/<id>`) に出るので、片方だけ変えると通しが静かにずれる。
 *
 * `e2e/seed.sql` が置く作者 (424242 / e2e-author) とは**別人**にする。種の作品が
 * 他人のものとして扱われることが、所有者の確認が効いていることの確認にもなる。
 */
export const FAKE_VIEWER = {
  id: 20250812,
  login: "e2e-user",
  /**
   * 1x1 の透明 GIF。
   *
   * 本物は https の URL だが、E2E のブラウザを外へ出さないため data URL にする
   * (偽 GitHub を立てる意味が、画像 1 枚で崩れないように)。
   */
  avatarUrl:
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
} as const;

/**
 * 種の作品 (`e2e/seed.sql`) の作者。**ログインする人とは別人**。
 *
 * フォーク (Phase 4-3) が相手にするのは他人の Gist なので、偽 GitHub 側にも
 * この人の持ち物としての Gist が要る (自分の Gist は自分で fork できない — #44)。
 * 数値 ID は seed.sql と揃える。
 */
export const FAKE_AUTHOR = {
  id: 424242,
  login: "e2e-author",
} as const;

/** その作者の Gist として偽 GitHub に置く種。`sketches.gist_id` と対応する。 */
export const FOREIGN_GIST_ID = "e2e-gist-foreign";

/**
 * 限定公開の方 (secret gist)。
 *
 * fork は元が secret なら secret になるので、**公開範囲の意図しない昇格は
 * 起きない** (#44)。代わりに気を付けるのは系譜の表示で、限定公開の親の URL を
 * 公開の子に出すと、URL を知らない相手にまで配られる。
 */
export const FOREIGN_UNLISTED_GIST_ID = "e2e-gist-foreign-unlisted";

/**
 * アセットを使う方。
 *
 * フォークは**他人の blob を自分に計上する**唯一の経路 (ADR 0003)。計上できて
 * いれば、フォーク先はそのまま保存できる (保存経路は自分に計上されていない実体を
 * 参照するマニフェストを断る)。
 */
export const FOREIGN_ASSET_GIST_ID = "e2e-gist-foreign-assets";
