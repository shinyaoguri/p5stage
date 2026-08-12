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
